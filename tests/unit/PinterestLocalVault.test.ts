import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DEFAULT_LOCAL_REDIRECT_URI,
  PinterestLocalVaultError,
  createPinterestLocalVault,
  createSafeStorageAdapter,
} = require("../../electron/pinterest-local-vault.cjs");

const SENTINEL_APP_ID = "sentinel-local-app-id";
const SENTINEL_APP_SECRET = "sentinel-local-app-secret";

function fakeSafeStorage({ available = true, decryptFailure = false } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value: string) => Buffer.from(value, "utf8").map((byte) => byte ^ 0xa5),
    decryptString: (value: Buffer) => {
      if (decryptFailure) throw new Error("decrypt failure");
      return Buffer.from(value).map((byte) => byte ^ 0xa5).toString("utf8");
    },
  };
}

async function createFixture(options: Record<string, unknown> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "alivo-pinterest-vault-"));
  const filePath = path.join(directory, "state", "pinterest-local-config.enc");
  const vault = createPinterestLocalVault({ filePath, safeStorage: fakeSafeStorage(), ...options });
  return { directory, filePath, vault };
}

test("safeStorage adapter contract saves status-only local configuration and supports clear/reconfigure", async () => {
  const fixture = await createFixture();
  try {
    assert.equal(createSafeStorageAdapter(fakeSafeStorage()).isEncryptionAvailable(), true);
    const first = await fixture.vault.save({
      clientId: SENTINEL_APP_ID,
      clientSecret: SENTINEL_APP_SECRET,
      redirectUri: DEFAULT_LOCAL_REDIRECT_URI,
    });
    assert.deepEqual(
      {
        configured: first.configured,
        appIdConfigured: first.appIdConfigured,
        appSecretConfigured: first.appSecretConfigured,
        redirectUriConfigured: first.redirectUriConfigured,
        sessionMaterialConfigured: first.sessionMaterialConfigured,
        encryptionAvailable: first.encryptionAvailable,
      },
      {
        configured: true,
        appIdConfigured: true,
        appSecretConfigured: true,
        redirectUriConfigured: true,
        sessionMaterialConfigured: true,
        encryptionAvailable: true,
      },
    );
    assert.equal(JSON.stringify(first).includes(SENTINEL_APP_SECRET), false);
    const storedDocument = await readFile(fixture.filePath, "utf8");
    assert.equal(storedDocument.includes(SENTINEL_APP_SECRET), false);
    const loaded = await fixture.vault.load();
    assert.equal(loaded.clientId, SENTINEL_APP_ID);
    assert.equal(loaded.clientSecret, SENTINEL_APP_SECRET);
    const beforeReconfigure = loaded.sessionSecret;

    await fixture.vault.save({
      clientId: "reconfigured-local-app-id",
      clientSecret: "reconfigured-local-app-secret",
      redirectUri: DEFAULT_LOCAL_REDIRECT_URI,
    });
    const afterReconfigure = await fixture.vault.load();
    assert.notEqual(afterReconfigure.sessionSecret, beforeReconfigure);
    assert.equal(afterReconfigure.clientSecret, "reconfigured-local-app-secret");

    const cleared = await fixture.vault.clear();
    assert.equal(cleared.configured, false);
    assert.equal(cleared.appSecretConfigured, false);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("local vault fails closed when encryption is unavailable", async () => {
  const fixture = await createFixture({ safeStorage: fakeSafeStorage({ available: false }) });
  try {
    const status = await fixture.vault.status();
    assert.equal(status.ok, false);
    assert.equal(status.encryptionAvailable, false);
    await assert.rejects(
      fixture.vault.save({ clientId: "id", clientSecret: "secret", redirectUri: DEFAULT_LOCAL_REDIRECT_URI }),
      (error: unknown) => error instanceof PinterestLocalVaultError && error.code === "ENCRYPTION_UNAVAILABLE",
    );
    const fallback = await fixture.vault.resolveConfiguration(
      { ALIVO_PINTEREST_CLIENT_ID: "environment-id", ALIVO_PINTEREST_CLIENT_SECRET: "environment-secret" },
      true,
    );
    assert.equal(fallback.clientId, "environment-id");
    assert.equal(fallback.clientSecret, "environment-secret");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("local vault accepts only the exact localhost callback and rejects unsafe variants", async () => {
  for (const redirectUri of [
    "http://localhost:48123/pinterest/oauth/callback?code=bad",
    "http://localhost:48123/pinterest/oauth/callback#bad",
    "http://127.0.0.1:48123/pinterest/oauth/callback",
    "http://evil.test:48123/pinterest/oauth/callback",
    "http://localhost:0/pinterest/oauth/callback",
  ]) {
    const fixture = await createFixture();
    try {
      await assert.rejects(
        fixture.vault.save({ clientId: "id", clientSecret: "secret", redirectUri: redirectUri }),
        (error: unknown) => error instanceof PinterestLocalVaultError && error.code === "LOCAL_CONFIG_INVALID",
      );
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }
});

test("local vault reports corruption without releasing payload and can be cleared", async () => {
  const fixture = await createFixture();
  try {
    await mkdir(path.dirname(fixture.filePath), { recursive: true });
    await writeFile(fixture.filePath, JSON.stringify({ version: 1, provider: "electron-safeStorage", ciphertext: "corrupt" }));
    const status = await fixture.vault.status();
    assert.equal(status.ok, false);
    assert.equal(status.corrupt, true);
    assert.equal(status.configured, false);
    await assert.rejects(fixture.vault.load(), /could not be opened/);
    const cleared = await fixture.vault.clear();
    assert.equal(cleared.configured, false);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("decryptable malformed vault records are treated as recoverable corruption", async () => {
  const fixture = await createFixture();
  try {
    await mkdir(path.dirname(fixture.filePath), { recursive: true });
    const encryptedMalformedValue = fakeSafeStorage().encryptString(JSON.stringify({
      clientId: "id-only",
      redirectUri: DEFAULT_LOCAL_REDIRECT_URI,
    }));
    await writeFile(fixture.filePath, JSON.stringify({
      version: 1,
      provider: "electron-safeStorage",
      ciphertext: Buffer.from(encryptedMalformedValue).toString("base64"),
    }));
    const status = await fixture.vault.status();
    assert.equal(status.corrupt, true);
    await assert.rejects(fixture.vault.load(), /could not be opened/);
    const saved = await fixture.vault.save({
      clientId: "recovered-id",
      clientSecret: "recovered-secret",
      redirectUri: DEFAULT_LOCAL_REDIRECT_URI,
    });
    assert.equal(saved.configured, true);
    assert.equal((await fixture.vault.load()).clientId, "recovered-id");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("local vault gives local configuration precedence and only allows environment fallback when requested", async () => {
  const fixture = await createFixture();
  try {
    const environment = {
      ALIVO_PINTEREST_CLIENT_ID: "environment-id",
      ALIVO_PINTEREST_CLIENT_SECRET: "environment-secret",
      ALIVO_PINTEREST_REDIRECT_URI: DEFAULT_LOCAL_REDIRECT_URI,
      ALIVO_PINTEREST_SESSION_SECRET: "environment-session",
    };
    const fallback = await fixture.vault.resolveConfiguration(environment, true);
    assert.equal(fallback.clientId, "environment-id");
    assert.equal(fallback.clientSecret, "environment-secret");
    assert.equal(await fixture.vault.resolveConfiguration(environment, false), undefined);
    await fixture.vault.save({ clientId: "local-id", clientSecret: "local-secret", redirectUri: DEFAULT_LOCAL_REDIRECT_URI });
    const local = await fixture.vault.resolveConfiguration(environment, true);
    assert.equal(local.clientId, "local-id");
    assert.equal(local.clientSecret, "local-secret");
    assert.equal(local.redirectUri, DEFAULT_LOCAL_REDIRECT_URI);
    assert.equal(local.apiBaseUrl, "https://api.pinterest.com");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
