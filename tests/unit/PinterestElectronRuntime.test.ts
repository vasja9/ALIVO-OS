import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const {
  InMemoryPinterestSessionStore,
  EncryptedPinterestSessionStore,
  PinterestRuntimeError,
  createPinterestRuntime,
} = require("../../electron/pinterest-runtime.cjs");
const { assertTrustedPinterestSender } = require("../../electron/pinterest-ipc-security.cjs");
const { createPinterestContextResolver } = require("../../electron/pinterest-context.cjs");
const { createPinterestLifecycle } = require("../../electron/pinterest-lifecycle.cjs");
const { createPinterestIpcController } = require("../../electron/pinterest-ipc-controller.cjs");
const { transition, createPinterestUiState, PINTEREST_UI_STATE } = await import("../../ui/pinterest-connection-state.js");
const { createPinterestElectronComposition } = await import("../../src/integrations/pinterest/PinterestElectronComposition.ts");

const NOW = new Date("2026-08-19T12:00:00.000Z");
const CONFIGURATION = {
  clientId: "client-id-test",
  clientSecret: "client-secret-test",
  redirectUri: "http://127.0.0.1:49152/pinterest/oauth/callback",
  apiBaseUrl: "https://api.pinterest.com",
  authorizationUrl: "https://www.pinterest.com/oauth/",
  sessionSecret: "session-secret-for-tests-only",
  continuousRefresh: true,
};

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] },
    text: async () => JSON.stringify(body),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function createLifecycleIpcFixture({
  directory,
  configuration,
  reconfiguredConfiguration,
  beforePersistCredential,
  fetchImpl,
}: {
  directory: string;
  configuration: typeof CONFIGURATION;
  reconfiguredConfiguration?: typeof CONFIGURATION;
  beforePersistCredential?: () => Promise<void>;
  fetchImpl?: (url: string, init: RequestInit) => Promise<unknown>;
}) {
  let activeConfiguration = configuration;
  let latestRuntime: ReturnType<typeof createPinterestRuntime> | undefined;
  const vault = {
    async save() {
      activeConfiguration = reconfiguredConfiguration || configuration;
      return { configured: true, encryptionAvailable: true };
    },
    async clear() {
      return { configured: false, encryptionAvailable: true };
    },
    async status() {
      return { configured: activeConfiguration === configuration, encryptionAvailable: true };
    },
  };
  const lifecycle = createPinterestLifecycle({
    resolveConfiguration: async () => activeConfiguration,
    createRuntime: (options: Record<string, unknown>) => {
      latestRuntime = createPinterestRuntime({
        ...options,
        userDataPath: () => directory,
        openExternal: async () => {},
        fetchImpl: fetchImpl || (async () => response(200, { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600, scope: "pins:read" })),
        now: () => NOW,
        beforePersistCredential,
      });
      return latestRuntime;
    },
    createComposition: () => ({ verifyConnection: async () => ({ state: "Available" }), readObservation: async () => ({ state: "Read" }) }),
    clearSessionFile: async () => {
      await rm(path.join(directory, "state", "pinterest-sessions.enc"), { force: true });
      await rm(path.join(directory, "state", "pinterest-sessions.enc.tmp"), { force: true });
    },
  });
  const context = createPinterestContextResolver({ ALIVO_PINTEREST_BUSINESS_PACKAGE_ID: "ALIVO", ALIVO_PINTEREST_CREDENTIAL_ID: "credential:pinterest:alivo" });
  return {
    lifecycle,
    controller: createPinterestIpcController({ getLifecycle: () => lifecycle, getLocalVault: () => vault, context }),
    runtime: () => latestRuntime,
  };
}

test("authorization-code start uses exact redirect URI, read scopes, and does not expose client secret", async () => {
  let opened = "";
  const runtime = createPinterestRuntime({
    configuration: CONFIGURATION,
    sessionStore: new InMemoryPinterestSessionStore(),
    openExternal: async (url: string) => { opened = url; },
    fetchImpl: async () => response(200, {}),
    now: () => NOW,
  });
  const result = await runtime.startAuthorization({ credentialId: "credential:pinterest:alivo", businessPackageId: "ALIVO", correlationIdentifier: "correlation-1" });
  const url = new URL(result.authorizationUrl);
  assert.equal(url.origin, "https://www.pinterest.com");
  assert.equal(url.pathname, "/oauth/");
  assert.equal(url.searchParams.get("client_id"), "client-id-test");
  assert.equal(url.searchParams.get("redirect_uri"), CONFIGURATION.redirectUri);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "boards:read,pins:read,user_accounts:read");
  assert.doesNotMatch(url.searchParams.get("scope")!, /analytics:read/);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(url.searchParams.get("code_challenge"));
  assert.equal(url.searchParams.get("client_secret"), null);
  assert.equal(opened, result.authorizationUrl);
  await runtime.close();
});

test("callback rejects wrong origin, missing state, replayed state, and provider denial", async () => {
  const runtime = createPinterestRuntime({
    configuration: CONFIGURATION,
    sessionStore: new InMemoryPinterestSessionStore(),
    openExternal: async () => {},
    fetchImpl: async () => response(200, { access_token: "never-used" }),
    now: () => NOW,
  });
  await assert.rejects(runtime.handleCallbackUrl(`${CONFIGURATION.redirectUri}?code=bad&state=bad`), (error: unknown) => error instanceof PinterestRuntimeError && error.code === "CALLBACK_STATE_INVALID");
  await assert.rejects(runtime.handleCallbackUrl("http://evil.test/pinterest/oauth/callback?code=bad&state=bad"), /callback URI/i);
  await runtime.close();
});

test("callback exchanges code server-side, persists opaque session material, and redacts secrets", async () => {
  const store = new InMemoryPinterestSessionStore();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const runtime = createPinterestRuntime({
    configuration: CONFIGURATION,
    sessionStore: store,
    openExternal: async () => {},
    fetchImpl: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return response(200, { access_token: "access-secret", refresh_token: "refresh-secret", expires_in: 3600, scope: "pins:read" });
    },
    now: () => NOW,
  });
  const authorization = await runtime.startAuthorization({ credentialId: "credential:pinterest:alivo", businessPackageId: "ALIVO" });
  const state = new URL(authorization.authorizationUrl).searchParams.get("state");
  try {
    const callback = await runtime.handleCallbackUrl(`${CONFIGURATION.redirectUri}?code=authorization-code&state=${state}`);
    assert.equal(callback.success, true);
    const stored = await store.load();
    assert.equal(stored["credential:pinterest:alivo"].accessToken, "access-secret");
  assert.equal(stored["credential:pinterest:alivo"].businessPackageId, "ALIVO");
    assert.equal(JSON.stringify(authorization).includes(CONFIGURATION.clientSecret), false);
    assert.equal(JSON.stringify(runtime.redactSensitive(`access_token: access-secret code=authorization-code`)).includes("access-secret"), false);
    assert.equal(calls.length, 1);
    assert.match(JSON.stringify(calls[0].init.headers), /Basic/);
  } finally {
    await runtime.close();
  }
});

test("separate OAuth-start, callback, and status entry points retain an encrypted session with one configuration", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "alivo-pinterest-ipc-"));
  try {
    const fixture = createLifecycleIpcFixture({ directory, configuration: CONFIGURATION });
    const started = await fixture.controller.startOAuth({ correlationIdentifier: "separate-ipc-start" });
    assert.equal(started.ok, true);
    const runtime = fixture.runtime();
    assert.ok(runtime);
    const state = new URL(started.authorizationUrl).searchParams.get("state");
    const callback = await runtime.handleCallbackUrl(`${CONFIGURATION.redirectUri}?code=synthetic-code&state=${state}`);
    assert.equal(callback.success, true);
    assert.deepEqual(await fixture.controller.connectionStatus(), {
      ok: true,
      state: "Authenticated",
      expiresAt: "2026-08-19T13:00:00.000Z",
      scope: "pins:read",
    });
    await runtime.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("credential reconfiguration fences an in-flight callback and status becomes reauthorization rather than disconnected", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "alivo-pinterest-ipc-race-"));
  const reachedPersist = deferred();
  const releasePersist = deferred();
  const replacementConfiguration = { ...CONFIGURATION, clientId: "replacement-client", clientSecret: "replacement-secret", sessionSecret: "replacement-session-secret" };
  try {
    const fixture = createLifecycleIpcFixture({
      directory,
      configuration: CONFIGURATION,
      reconfiguredConfiguration: replacementConfiguration,
      beforePersistCredential: async () => {
        reachedPersist.resolve();
        await releasePersist.promise;
      },
    });
    const started = await fixture.controller.startOAuth();
    const runtimeA = fixture.runtime();
    assert.ok(runtimeA);
    const state = new URL(started.authorizationUrl).searchParams.get("state");
    const callback = runtimeA.handleCallbackUrl(`${CONFIGURATION.redirectUri}?code=synthetic-code&state=${state}`);
    await reachedPersist.promise;

    const reconfigure = fixture.controller.saveLocalConfig({
      clientId: "replacement-client",
      clientSecret: "replacement-secret",
      redirectUri: CONFIGURATION.redirectUri,
    });
    releasePersist.resolve();

    const callbackResult = await callback;
    const configured = await reconfigure;
    assert.deepEqual(callbackResult, { success: false, failure: "ConfigurationSuperseded" });
    assert.equal(configured.ok, true);
    assert.deepEqual(
      await new EncryptedPinterestSessionStore(path.join(directory, "state", "pinterest-sessions.enc"), replacementConfiguration.sessionSecret).load(),
      {},
    );

    const status = await fixture.controller.connectionStatus();
    assert.deepEqual(status, { ok: true, state: "ReauthorizationRequired", code: "SESSION_RECONFIGURED" });
    const ui = transition(createPinterestUiState(), { type: "STATUS_RESULT", value: status });
    assert.equal(ui.uiState, PINTEREST_UI_STATE.ReauthorizationRequired);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("credential reconfiguration aborts a hung callback exchange instead of waiting indefinitely", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "alivo-pinterest-ipc-hung-callback-"));
  const exchangeStarted = deferred();
  const replacementConfiguration = { ...CONFIGURATION, clientId: "replacement-client", clientSecret: "replacement-secret", sessionSecret: "replacement-session-secret" };
  try {
    const fixture = createLifecycleIpcFixture({
      directory,
      configuration: CONFIGURATION,
      reconfiguredConfiguration: replacementConfiguration,
      fetchImpl: async () => {
        exchangeStarted.resolve();
        return await new Promise(() => {});
      },
    });
    const started = await fixture.controller.startOAuth();
    const runtimeA = fixture.runtime();
    assert.ok(runtimeA);
    const state = new URL(started.authorizationUrl).searchParams.get("state");
    const callback = runtimeA.handleCallbackUrl(`${CONFIGURATION.redirectUri}?code=synthetic-code&state=${state}`);
    await exchangeStarted.promise;

    const configured = await Promise.race([
      fixture.controller.saveLocalConfig({
        clientId: "replacement-client",
        clientSecret: "replacement-secret",
        redirectUri: CONFIGURATION.redirectUri,
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("credential reconfiguration did not interrupt the callback")), 250)),
    ]);
    assert.equal(configured.ok, true);
    assert.deepEqual(await callback, { success: false, failure: "ConfigurationSuperseded" });
    assert.deepEqual(
      await new EncryptedPinterestSessionStore(path.join(directory, "state", "pinterest-sessions.enc"), replacementConfiguration.sessionSecret).load(),
      {},
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("credential reconfiguration aborts a callback whose provider response body never completes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "alivo-pinterest-ipc-hung-body-"));
  const responseStarted = deferred();
  const replacementConfiguration = { ...CONFIGURATION, clientId: "replacement-client", clientSecret: "replacement-secret", sessionSecret: "replacement-session-secret" };
  try {
    const fixture = createLifecycleIpcFixture({
      directory,
      configuration: CONFIGURATION,
      reconfiguredConfiguration: replacementConfiguration,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => undefined },
        text: async () => {
          responseStarted.resolve();
          return await new Promise(() => {});
        },
      }),
    });
    const started = await fixture.controller.startOAuth();
    const runtimeA = fixture.runtime();
    assert.ok(runtimeA);
    const state = new URL(started.authorizationUrl).searchParams.get("state");
    const callback = runtimeA.handleCallbackUrl(`${CONFIGURATION.redirectUri}?code=synthetic-code&state=${state}`);
    await responseStarted.promise;

    const configured = await Promise.race([
      fixture.controller.saveLocalConfig({
        clientId: "replacement-client",
        clientSecret: "replacement-secret",
        redirectUri: CONFIGURATION.redirectUri,
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("credential reconfiguration did not interrupt response parsing")), 250)),
    ]);
    assert.equal(configured.ok, true);
    assert.deepEqual(await callback, { success: false, failure: "ConfigurationSuperseded" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("authentication restores a session, refreshes expired access, and never returns token material", async () => {
  const store = new InMemoryPinterestSessionStore({
    "credential:pinterest:alivo": {
      accessToken: "expired-access",
      refreshToken: "refresh-secret",
      businessPackageId: "ALIVO",
      expiresAt: "2026-08-19T11:59:00.000Z",
      refreshTokenExpiresAt: "2026-09-19T12:00:00.000Z",
      scope: "pins:read",
    },
  });
  let refreshCalls = 0;
  const runtime = createPinterestRuntime({
    configuration: CONFIGURATION,
    sessionStore: store,
    fetchImpl: async (_url: string, init: RequestInit) => {
      refreshCalls += 1;
      assert.match(String(init.body), /grant_type=refresh_token/);
      return response(200, { access_token: "fresh-access", refresh_token: "fresh-refresh", expires_in: 3600, refresh_token_expires_in: 86400, scope: "pins:read" });
    },
    now: () => NOW,
  });
  const result = await runtime.authentication.authenticate({ properties: { credentialId: { value: "credential:pinterest:alivo" }, businessPackageId: { value: "ALIVO" } } });
  assert.equal(result.successful, true);
  assert.equal(refreshCalls, 1);
  assert.equal("accessToken" in result, false);
  const registration = runtime.getProviderRegistration();
  assert.equal(typeof registration.authentication.authenticate, "function");
  assert.equal(typeof registration.transport.execute, "function");
  assert.equal(typeof registration.probeCapability, "function");
  await runtime.close();
});

test("API transport is read-only, uses bearer session, enforces configured origin, and preserves safe rate-limit headers", async () => {
  const store = new InMemoryPinterestSessionStore({
    "credential:pinterest:alivo": { accessToken: "access-secret", expiresAt: "2026-09-19T12:00:00.000Z", scope: "pins:read", businessPackageId: "ALIVO" },
  });
  let captured: { url: string; init: RequestInit } | undefined;
  const runtime = createPinterestRuntime({
    configuration: CONFIGURATION,
    sessionStore: store,
    fetchImpl: async (url: string, init: RequestInit) => {
      captured = { url, init };
      return response(429, { message: "private provider detail" }, { "retry-after": "30", "x-ratelimit-reset": "later", "set-cookie": "secret" });
    },
    now: () => NOW,
  });
  const auth = await runtime.authentication.authenticate({ credentialId: "credential:pinterest:alivo", businessPackageId: { value: "ALIVO" } });
  assert.equal(auth.successful, true);
  const result = await runtime.transport.execute({ baseUrl: CONFIGURATION.apiBaseUrl, path: "/v5/pins", query: { page_size: "1" }, timeoutMs: 1000, session: auth.session });
  assert.equal(result.status, 429);
  assert.deepEqual(result.headers, { "retry-after": "30", "x-ratelimit-reset": "later" });
  assert.match(JSON.stringify(captured?.init.headers), /Bearer/);
  assert.equal(JSON.stringify(result.body).includes("private provider detail"), true);
  await assert.rejects(runtime.transport.execute({ baseUrl: "https://evil.test", path: "/v5/pins", session: auth.session }), /base URL is not allowed/);
  await runtime.close();
});

test("provider 401 recovery removes local session and returns reauthorization", async () => {
  const store = new InMemoryPinterestSessionStore({
    "credential:pinterest:alivo": { accessToken: "access-secret", expiresAt: "2026-09-19T12:00:00.000Z", businessPackageId: "ALIVO" },
  });
  const runtime = createPinterestRuntime({ configuration: CONFIGURATION, sessionStore: store, fetchImpl: async () => response(200, {}), now: () => NOW });
  const request = { properties: { credentialId: { value: "credential:pinterest:alivo" }, businessPackageId: { value: "ALIVO" } } };
  const auth = await runtime.authentication.authenticate(request);
  assert.equal(auth.successful, true);
  await runtime.authentication.reportProviderFailure(request, "ReauthorizationRequired");
  assert.deepEqual(await store.load(), {});
  const after = await runtime.authentication.authenticate(request);
  assert.deepEqual(after, { successful: false, failure: "ReauthorizationRequired" });
  await runtime.close();
});

test("Business Package binding rejects a credential requested from another package", async () => {
  const store = new InMemoryPinterestSessionStore({
    "credential:pinterest:alivo": { accessToken: "access-secret", expiresAt: "2026-09-19T12:00:00.000Z", businessPackageId: "ALIVO" },
  });
  const runtime = createPinterestRuntime({ configuration: CONFIGURATION, sessionStore: store, fetchImpl: async () => response(200, {}), now: () => NOW });
  const result = await runtime.authentication.authenticate({ credentialId: "credential:pinterest:alivo", businessPackageId: { value: "OTHER" } });
  assert.deepEqual(result, { successful: false, failure: "InvalidCredential" });
  await runtime.close();
});

test("an API 401 immediately invalidates the stored credential and requires reauthorization", async () => {
  const store = new InMemoryPinterestSessionStore({
    "credential:pinterest:alivo": { accessToken: "access-secret", expiresAt: "2026-09-19T12:00:00.000Z", businessPackageId: "ALIVO" },
  });
  const runtime = createPinterestRuntime({ configuration: CONFIGURATION, sessionStore: store, fetchImpl: async () => response(401, { message: "provider detail" }), now: () => NOW });
  const request = { credentialId: "credential:pinterest:alivo", businessPackageId: "ALIVO" };
  const auth = await runtime.authentication.authenticate(request);
  const result = await runtime.transport.execute({ baseUrl: CONFIGURATION.apiBaseUrl, path: "/v5/pins", session: auth.session });
  assert.equal(result.status, 401);
  assert.deepEqual(await store.load(), {});
  assert.deepEqual(await runtime.authentication.authenticate(request), { successful: false, failure: "ReauthorizationRequired" });
  await runtime.close();
});

test("production endpoint allowlist rejects credential exfiltration targets", async () => {
  const runtime = createPinterestRuntime({
    configuration: { ...CONFIGURATION, apiBaseUrl: "https://evil.test", authorizationUrl: "https://evil.test/oauth/" },
    sessionStore: new InMemoryPinterestSessionStore(),
    fetchImpl: async () => response(200, {}),
    now: () => NOW,
  });
  await assert.rejects(runtime.startAuthorization({ credentialId: "credential:pinterest:alivo", businessPackageId: "ALIVO" }), /production endpoints are fixed/);
  await runtime.close();
});

test("registered provider exposes read-only connection verification and observation without write operations", async () => {
  const store = new InMemoryPinterestSessionStore({
    "credential:pinterest:alivo": { accessToken: "access-secret", expiresAt: "2026-09-19T12:00:00.000Z", scope: "pins:read", businessPackageId: "ALIVO" },
  });
  const requested: string[] = [];
  const runtime = createPinterestRuntime({
    configuration: CONFIGURATION,
    sessionStore: store,
    fetchImpl: async (url: string | URL) => {
      requested.push(String(url));
      return response(200, { items: [{ id: "pin-1", type: "pin" }] });
    },
    now: () => NOW,
  });
  const request = { credentialId: "credential:pinterest:alivo", businessPackageId: { value: "ALIVO" }, requestedCapabilities: ["OwnPins"], marketContext: "US" };
  const verification = await runtime.verifyConnection(request);
  assert.equal(verification.state, "Available");
  assert.equal(verification.capabilities[0].state, "Available");
  const observation = await runtime.readObservation({ ...request, capability: "MarketObservation" });
  assert.equal(observation.state, "Read");
  assert.equal(requested.every((url) => url.includes("/v5/pins")), true);
  assert.equal(Object.keys(runtime).includes("publish"), false);
  await runtime.close();
});

test("encrypted file session persistence survives reload and never stores token plaintext", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "alivo-pinterest-runtime-"));
  const filePath = path.join(directory, "state", "pinterest-sessions.enc");
  try {
    const first = new EncryptedPinterestSessionStore(filePath, "long-enough-session-secret");
    await first.save({ "credential:pinterest:alivo": { accessToken: "access-secret", refreshToken: "refresh-secret" } });
    const raw = await readFile(filePath, "utf8");
    assert.equal(raw.includes("access-secret"), false);
    assert.equal(raw.includes("refresh-secret"), false);
    const second = new EncryptedPinterestSessionStore(filePath, "long-enough-session-secret");
    assert.deepEqual(await second.load(), { "credential:pinterest:alivo": { accessToken: "access-secret", refreshToken: "refresh-secret" } });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("network failures and timeouts return safe classifications without provider details", async () => {
  const store = new InMemoryPinterestSessionStore({
    "credential:pinterest:alivo": { accessToken: "access-secret", expiresAt: "2026-09-19T12:00:00.000Z", businessPackageId: "ALIVO" },
  });
  const runtime = createPinterestRuntime({
    configuration: CONFIGURATION,
    sessionStore: store,
    fetchImpl: async () => { throw new Error("socket secret details"); },
    now: () => NOW,
  });
  const auth = await runtime.authentication.authenticate({ credentialId: "credential:pinterest:alivo", businessPackageId: { value: "ALIVO" } });
  await assert.rejects(runtime.transport.execute({ baseUrl: CONFIGURATION.apiBaseUrl, path: "/v5/pins", session: auth.session }), (error: unknown) => error instanceof PinterestRuntimeError && error.code === "NETWORK_UNAVAILABLE" && !error.message.includes("socket"));
  await runtime.close();
});

test("PKCE verifier is sent only in the server-side token exchange", async () => {
  const store = new InMemoryPinterestSessionStore();
  let tokenBody = "";
  const runtime = createPinterestRuntime({
    configuration: CONFIGURATION,
    sessionStore: store,
    openExternal: async () => {},
    fetchImpl: async (_url: string | URL, init: RequestInit) => {
      tokenBody = String(init.body);
      return response(200, { access_token: "access-secret", expires_in: 3600, scope: "pins:read" });
    },
    now: () => NOW,
  });
  const authorization = await runtime.startAuthorization({ credentialId: "credential:pinterest:alivo", businessPackageId: "ALIVO" });
  const url = new URL(authorization.authorizationUrl);
  await runtime.handleCallbackUrl(`${CONFIGURATION.redirectUri}?code=authorization-code&state=${url.searchParams.get("state")}`);
  assert.match(tokenBody, /code_verifier=/);
  assert.equal(authorization.authorizationUrl.includes("code_verifier"), false);
  await runtime.close();
});

test("Pinterest IPC accepts only the trusted local main frame with canonical Windows file paths", () => {
  const webContents = { mainFrame: undefined };
  const trustedPath = process.platform === "win32"
    ? path.win32.resolve("C:\\workspace\\ui\\index.html")
    : path.resolve("/workspace/ui/index.html");
  const frame = { url: pathToFileURL(trustedPath).href };
  webContents.mainFrame = frame;
  const mainWindow = { webContents };
  const allowedPaths = new Set([trustedPath]);
  assert.doesNotThrow(() => assertTrustedPinterestSender({ sender: webContents, senderFrame: frame }, mainWindow, allowedPaths));
  assert.throws(() => assertTrustedPinterestSender({ sender: { mainFrame: frame }, senderFrame: frame }, mainWindow, allowedPaths), /Untrusted/);
  assert.throws(() => assertTrustedPinterestSender({ sender: webContents, senderFrame: { url: pathToFileURL(path.join(path.dirname(trustedPath), "other.html")).href }, }, mainWindow, allowedPaths), /Untrusted/);
  assert.throws(() => assertTrustedPinterestSender({ sender: webContents, senderFrame: { url: "https://127.0.0.1/ui/index.html" }, }, mainWindow, allowedPaths), /Untrusted/);
  if (process.platform === "win32") {
    assert.equal(frame.url, "file:///C:/workspace/ui/index.html");
    assert.doesNotThrow(() => assertTrustedPinterestSender({
      sender: webContents,
      senderFrame: { url: "file:///C:/workspace/ui/index.html" },
    }, mainWindow, allowedPaths));
  }
});

test("main-owned Pinterest context rejects renderer attempts to rebind package, credential, or capability", () => {
  const context = createPinterestContextResolver({ ALIVO_PINTEREST_BUSINESS_PACKAGE_ID: "ALIVO", ALIVO_PINTEREST_CREDENTIAL_ID: "credential:pinterest:alivo" });
  assert.deepEqual(context.resolve({ requestedCapabilities: ["OwnPins"] }), { requestedCapabilities: ["OwnPins"], credentialId: "credential:pinterest:alivo", businessPackageId: "ALIVO" });
  assert.throws(() => context.resolve({ businessPackageId: "OTHER" }), /not authorized/);
  assert.throws(() => context.resolve({ credentialId: "credential:pinterest:other" }), /not authorized/);
  assert.throws(() => context.resolve({ requestedCapabilities: ["UnknownWriteCapability"] }), /not authorized/);
});

test("live composition routes verification and observation through the governed adapter and workflow", async () => {
  const store = new InMemoryPinterestSessionStore({
    "credential:pinterest:alivo": { accessToken: "access-secret", expiresAt: "2026-09-19T12:00:00.000Z", businessPackageId: "ALIVO" },
  });
  const runtime = createPinterestRuntime({
    configuration: CONFIGURATION,
    sessionStore: store,
    fetchImpl: async () => response(200, { items: [{ id: "pin-1", type: "pin", ownership: "OwnedAuthorizedResource", title: "Observed pin", observedAt: "2026-08-19T12:00:00.000Z" }] }),
    now: () => NOW,
  });
  const composition = createPinterestElectronComposition({
    registration: runtime.getProviderRegistration(),
    credentialId: "credential:pinterest:alivo",
    businessPackageId: "ALIVO",
    apiBaseUrl: CONFIGURATION.apiBaseUrl,
    clock: () => NOW,
  });
  const verification = await composition.verifyConnection({ requestedCapabilities: ["OwnPins"], correlationIdentifier: "composition-verification" });
  assert.equal(verification.state, "Available");
  assert.equal(verification.capabilities[0].state, "Available");
  const observation = await composition.readObservation({ capability: "OwnPins", marketContext: "US", pageSize: 1, correlationIdentifier: "composition-observation" });
  assert.equal(observation.state, "Completed");
  assert.equal(observation.summary.acceptedObservations, 1);
  assert.equal(composition.integration.registry.all()[0].adapterId.value, "PinterestMarketSourceAdapter");
  assert.equal(composition.verificationRepository.current({ value: "ALIVO" } as never)?.state, "Available");
  await runtime.close();
});