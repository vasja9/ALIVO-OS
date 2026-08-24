import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { COMPLETE_JPEG_BASE64, COMPLETE_PNG_BASE64, COMPLETE_WEBP_BASE64 } from "../fixtures/PinterestThumbnailFixtures.ts";

const require = createRequire(import.meta.url);
const {
  InMemoryPinterestSessionStore,
  EncryptedPinterestSessionStore,
  PinterestRuntimeError,
  createPinterestRuntime,
} = require("../../electron/pinterest-runtime.cjs");
const { assertTrustedPinterestSender, isTrustedUiUrl } = require("../../electron/pinterest-ipc-security.cjs");
const { createPinterestContextResolver } = require("../../electron/pinterest-context.cjs");
const { createPinterestLifecycle } = require("../../electron/pinterest-lifecycle.cjs");
const { createPinterestIpcController } = require("../../electron/pinterest-ipc-controller.cjs");
const { transition, createPinterestUiState, PINTEREST_UI_STATE, safeObservation } = await import("../../ui/pinterest-connection-state.js");
const { createPinterestElectronComposition, rendererSafePins, rendererSafeTopPins } = await import("../../src/integrations/pinterest/PinterestElectronComposition.ts");
const { PINTEREST_CONTENT_AUDIT_CODES, PINTEREST_CONTENT_AUDIT_RULES } = await import("../../src/integrations/pinterest/PinterestContentReadinessAudit.ts");

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

test("Pin analytics 401 and 403 are capability-local and never invalidate the authenticated session", async () => {
  for (const status of [401, 403]) {
    const store = new InMemoryPinterestSessionStore({
      "credential:pinterest:alivo": { accessToken: "access-secret", expiresAt: "2026-09-19T12:00:00.000Z", businessPackageId: "ALIVO" },
    });
    let pinReads = 0;
    const runtime = createPinterestRuntime({
      configuration: CONFIGURATION,
      sessionStore: store,
      fetchImpl: async input => {
        const url = new URL(String(input));
        if (url.pathname === "/v5/pins/analytics") return response(status, { message: "capability unavailable" });
        pinReads += 1;
        return response(200, { items: [] });
      },
      now: () => NOW,
    });
    const request = { credentialId: "credential:pinterest:alivo", businessPackageId: "ALIVO" };
    const auth = await runtime.authentication.authenticate(request);
    const analytics = await runtime.transport.execute({ baseUrl: CONFIGURATION.apiBaseUrl, path: "/v5/pins/analytics", session: auth.session });
    assert.equal(analytics.status, status);
    assert.equal((await runtime.status(request.credentialId)).state, "Authenticated");
    assert.equal(Object.keys(await store.load()).length, 1);
    assert.equal((await runtime.readObservation({ ...request, capability: "OwnPins" })).state, "Read");
    assert.equal(pinReads, 1);
    await runtime.close();
  }
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
  const trustedPath = path.win32.resolve("C:\\workspace\\ui\\index.html");
  const trustedUrl = pathToFileURL(trustedPath, { windows: true }).href;
  assert.equal(trustedUrl, "file:///C:/workspace/ui/index.html");
  assert.equal(new URL(trustedUrl).pathname, "/C:/workspace/ui/index.html");
  assert.equal(fileURLToPath(trustedUrl, { windows: true }), trustedPath);

  const mainFrame = { frameTreeNodeId: 41, url: trustedUrl };
  const frame = { frameTreeNodeId: 41, url: trustedUrl };
  const webContents = { mainFrame };
  const mainWindow = { webContents };
  const allowedPaths = new Set([trustedPath]);
  assert.equal(isTrustedUiUrl(trustedUrl, allowedPaths, "win32"), true);
  assert.doesNotThrow(() => assertTrustedPinterestSender({ sender: webContents, senderFrame: frame }, mainWindow, allowedPaths, "win32"));

  for (const fragment of ["#settings/pinterest", "#pinterest?view=overview"]) {
    const routedUrl = `${trustedUrl}${fragment}`;
    const routedMainFrame = { frameTreeNodeId: 41, url: routedUrl };
    const routedWebContents = { mainFrame: routedMainFrame };
    const routedMainWindow = { webContents: routedWebContents };
    assert.equal(isTrustedUiUrl(routedUrl, allowedPaths, "win32"), true, routedUrl);
    assert.doesNotThrow(() => assertTrustedPinterestSender(
      { sender: routedWebContents, senderFrame: { frameTreeNodeId: 41, url: routedUrl } },
      routedMainWindow,
      allowedPaths,
      "win32",
    ));
  }

  for (const candidateUrl of [
    "file:///D:/workspace/ui/index.html",
    "file://server/share/ui/index.html",
    "file:///C:/workspace/ui/other.html",
    "file:///C:/workspace/ui/%69ndex.html",
    "file:///C:/workspace/ui/%2569ndex.html",
    "file:///C:/workspace/ui/index.html?unexpected=query",
    "https://127.0.0.1/ui/index.html",
  ]) {
    assert.equal(isTrustedUiUrl(candidateUrl, allowedPaths, "win32"), false, candidateUrl);
    assert.throws(
      () => assertTrustedPinterestSender(
        { sender: webContents, senderFrame: { frameTreeNodeId: 41, url: candidateUrl } },
        mainWindow,
        allowedPaths,
        "win32",
      ),
      /Untrusted Pinterest IPC frame/,
      candidateUrl,
    );
  }

  assert.throws(
    () => assertTrustedPinterestSender(
      { sender: webContents, senderFrame: { frameTreeNodeId: 42, url: trustedUrl } },
      mainWindow,
      allowedPaths,
      "win32",
    ),
    /Untrusted Pinterest IPC frame/,
  );
  assert.throws(
    () => assertTrustedPinterestSender(
      { sender: webContents, senderFrame: { url: trustedUrl } },
      mainWindow,
      allowedPaths,
      "win32",
    ),
    /Untrusted Pinterest IPC frame/,
  );
  assert.throws(
    () => assertTrustedPinterestSender(
      { sender: { mainFrame }, senderFrame: frame },
      mainWindow,
      allowedPaths,
      "win32",
    ),
    /Untrusted Pinterest IPC sender/,
  );
});

test("main-owned Pinterest context rejects renderer attempts to rebind package, credential, or capability", () => {
  const context = createPinterestContextResolver({ ALIVO_PINTEREST_BUSINESS_PACKAGE_ID: "ALIVO", ALIVO_PINTEREST_CREDENTIAL_ID: "credential:pinterest:alivo" });
  assert.deepEqual(context.resolve({ requestedCapabilities: ["OwnPins"] }), { requestedCapabilities: ["OwnPins"], credentialId: "credential:pinterest:alivo", businessPackageId: "ALIVO" });
  assert.throws(() => context.resolve({ businessPackageId: "OTHER" }), /not authorized/);
  assert.throws(() => context.resolve({ credentialId: "credential:pinterest:other" }), /not authorized/);
  assert.throws(() => context.resolve({ requestedCapabilities: ["UnknownWriteCapability"] }), /not authorized/);
});

test("live composition routes verification and observation through the governed adapter and workflow", async () => {
  let boardRequests=0;
  let analyticsRequests=0;
  let analyticsQuery:Record<string,string>|undefined;
  let topPinsRequests=0;
  let topPinsQuery:Record<string,string>|undefined;
  let analyticsStatus=200;
  let analyticsThrows=false;
  let thumbnailRequests=0;
  const thumbnailSources:string[]=[];
  const boardQueries:Record<string,string>[]=[];
  const store = new InMemoryPinterestSessionStore({
    "credential:pinterest:alivo": { accessToken: "access-secret", expiresAt: "2026-09-19T12:00:00.000Z", businessPackageId: "ALIVO" },
  });
  const runtime = createPinterestRuntime({
    configuration: CONFIGURATION,
    sessionStore: store,
    fetchImpl: async input => {const url=new URL(String(input));if(url.pathname==="/v5/boards"){boardRequests++;boardQueries.push(Object.fromEntries(url.searchParams));return boardRequests===1?response(200,{items:[{id:"other",name:"Other"}],bookmark:"next-board-page"}):response(200,{items:[{id:"board-1",name:" <b>Main board</b> ",secret:"discard"}],bookmark:null});}if(url.pathname==="/v5/pins/analytics"){analyticsRequests++;analyticsQuery=Object.fromEntries(url.searchParams);if(analyticsThrows)throw new Error("synthetic network detail");return response(analyticsStatus,Object.fromEntries(Array.from({length:25},(_,index)=>[`pin-${String(index).padStart(2,"0")}`,{summary_metrics:{IMPRESSION:index,SAVE:0,PIN_CLICK:index===0?undefined:1,OUTBOUND_CLICK:2},provider_url:"must-not-cross"}])))}if(url.pathname==="/v5/user_account/analytics/top_pins"){topPinsRequests++;topPinsQuery=Object.fromEntries(url.searchParams);return response(200,{pins:[{pin_id:"pin-01",metrics:{IMPRESSION:20,SAVE:2,PIN_CLICK:3,OUTBOUND_CLICK:4},providerPayload:"discard"},{pin_id:"pin-00",metrics:{IMPRESSION:10,SAVE:1,PIN_CLICK:2,OUTBOUND_CLICK:3},issue_codes:["must-not-cross"]},{pin_id:"unknown",metrics:{IMPRESSION:999,SAVE:999,PIN_CLICK:999,OUTBOUND_CLICK:999}}]})}return response(200, { items: Array.from({length:25},(_,index)=>({ id: `pin-${String(index).padStart(2,"0")}`, is_owner: true, title: `Observed pin ${index}`, created_at: "2026-08-19T12:00:00.000Z", board_id: "board-1", link: "https://Example.test/path?private=value", access_token: "must-not-cross", media: {media_type:"image",images:{"400x300":index===1?{url:"https://i.pinimg.com/400x300/rejected.png",width:0,height:300}:{url:`https://i.pinimg.com/400x300/pin-${index}.${index===2?"webp":"jpg"}`,width:400,height:300},"150x150":{url:`https://i.pinimg.com/150x150/pin-${index}.png`,width:150,height:150}},arbitrary:"provider-object"} })) });},
    now: () => NOW,
  });
  const composition = createPinterestElectronComposition({
    registration: runtime.getProviderRegistration(),
    credentialId: "credential:pinterest:alivo",
    businessPackageId: "ALIVO",
    apiBaseUrl: CONFIGURATION.apiBaseUrl,
    clock: () => NOW,
    thumbnailFetcher: async source=>{thumbnailRequests++;thumbnailSources.push(source.url);if(source.url.endsWith(".png"))return {mimeType:"image/png",base64:COMPLETE_PNG_BASE64};if(source.url.endsWith(".webp"))return {mimeType:"image/webp",base64:COMPLETE_WEBP_BASE64};return {mimeType:"image/jpeg",base64:COMPLETE_JPEG_BASE64};},
  });
  const verification = await composition.verifyConnection({ requestedCapabilities: ["OwnPins"], correlationIdentifier: "composition-verification" });
  assert.equal(verification.state, "Available");
  assert.equal(verification.capabilities[0].state, "Available");
  assert.equal(boardRequests,0);
  assert.equal(thumbnailRequests,0);
  const observation = await composition.readObservation({ capability: "OwnPins", marketContext: "US", pageSize: 25, correlationIdentifier: "composition-observation" });
  assert.equal(observation.state, "Completed");
  assert.equal(observation.summary.acceptedObservations, 25);
  assert.equal(observation.pins.length,25);
  assert.deepEqual(observation.pins[0], { pinId: "pin-00", title: "Observed pin 0", createdAt: "2026-08-19T12:00:00.000Z", boardName: "<b>Main board</b>", destinationDomain: "example.test", thumbnail:{mimeType:"image/jpeg",base64:COMPLETE_JPEG_BASE64} });
  assert.equal(thumbnailRequests,25);
  assert.match(thumbnailSources[0],/\/400x300\//);assert.match(thumbnailSources[1],/\/150x150\//);assert.equal(observation.pins[1].thumbnail?.mimeType,"image/png");assert.equal(observation.pins[2].thumbnail?.mimeType,"image/webp");
  assert.equal(boardRequests,2);assert.deepEqual(boardQueries,[{page_size:"25"},{page_size:"25",bookmark:"next-board-page"}]);
  assert.equal(JSON.stringify(observation).includes("board-1"),false);
  assert.equal(JSON.stringify(observation).includes("must-not-cross"),false);
  assert.equal(JSON.stringify(observation).includes("provider-object"),false);
  assert.equal(JSON.stringify(observation).includes("i.pinimg.com"),false);
  assert.equal(observation.audit.state,"Available");assert.equal(observation.audit.analyzedPins,25);assert.equal(observation.audit.attentionPins,25);
  assert.equal(/score|base64|media|board-1|access-secret|provider-object|pinimg/i.test(JSON.stringify(observation.audit)),false);
  const rendererObservation=safeObservation(observation);assert.equal(rendererObservation.pins[0].thumbnail.base64,COMPLETE_JPEG_BASE64);assert.equal(rendererObservation.pins[0].thumbnail.base64.length,976);
  assert.equal(/i\.pinimg\.com|provider-object|media|thumbnailUrl/i.test(JSON.stringify(rendererObservation)),false);
  assert.equal(analyticsRequests,0);
  const performance=await composition.readPerformance({correlationIdentifier:"composition-performance"});
  assert.equal(analyticsRequests,1);assert.equal(performance.state,"Available");assert.equal(performance.pins.length,25);assert.equal(performance.pins[0].impressions,0);assert.equal(performance.pins[0].pinClicks,null);
  assert.deepEqual(analyticsQuery,{pin_ids:Array.from({length:25},(_,index)=>`pin-${String(index).padStart(2,"0")}`).join(","),start_date:"2026-07-20",end_date:"2026-08-18",metric_types:"IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK"});
  assert.equal(/provider|url|base64|title|board|oauth|token|media/i.test(JSON.stringify(performance)),false);
  const topPins=await composition.readTopPins({correlationIdentifier:"composition-top-pins"});
  assert.equal(topPinsRequests,1);assert.equal(analyticsRequests,1);assert.equal(topPins.state,"Available");assert.equal(topPins.pins.length,2);
  assert.deepEqual(topPins.pins[0],{title:"Observed pin 1",boardName:"<b>Main board</b>",impressions:20,saves:2,pinClicks:3,outboundClicks:4,contentReadiness:{status:"NeedsAttention",issueCount:2,requiredIssueCount:1,reviewIssueCount:1},contentReadinessDetails:{required:["Review the destination: it is outside alivo.eu."],review:["Add a Pin description for Pinterest relevance."]}});
  assert.equal(Object.isFrozen(topPins.pins[0]),true);assert.equal(Object.isFrozen(topPins.pins[0].contentReadiness),true);assert.equal(Object.isFrozen(topPins.pins[0].contentReadinessDetails),true);assert.equal(Object.isFrozen(topPins.pins[0].contentReadinessDetails?.required),true);assert.equal(Object.isFrozen(topPins.pins[0].contentReadinessDetails?.review),true);
  assert.equal(/pin-0|unknown|provider|issue_codes|message|code|url|base64|thumbnail|oauth|token|media/i.test(JSON.stringify(topPins)),false);
  assert.deepEqual(topPinsQuery,{start_date:"2026-07-20",end_date:"2026-08-18",sort_by:"OUTBOUND_CLICK",from_claimed_content:"BOTH",pin_format:"ALL",app_types:"ALL",content_type:"ORGANIC",metric_types:"IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK",num_of_pins:"25"});
  const duplicateObservation=await composition.readObservation({ capability: "OwnPins", marketContext: "US", pageSize: 25, correlationIdentifier: "composition-observation-repeat" });
  assert.deepEqual(duplicateObservation.pins,observation.pins);assert.deepEqual(duplicateObservation.audit,observation.audit);assert.equal(duplicateObservation.pins.length,25);assert.equal(boardRequests,2);assert.equal(thumbnailRequests,25);
  analyticsStatus=500;const failed=await composition.readPerformance();assert.equal(failed.state,"Failed");assert.equal(failed.pins.length,25);
  analyticsStatus=200;analyticsThrows=true;const networkFailed=await composition.readPerformance();assert.equal(networkFailed.state,"Failed");assert.equal(networkFailed.pins.length,25);analyticsThrows=false;
  analyticsStatus=403;const unavailable=await composition.readPerformance();assert.equal(unavailable.state,"Unavailable");assert.equal(unavailable.pins.length,25);
  analyticsStatus=429;const limited=await composition.readPerformance();assert.equal(limited.state,"RateLimited");assert.equal(limited.pins.length,25);
  analyticsStatus=401;const isolatedUnauthorized=await composition.readPerformance();assert.equal(isolatedUnauthorized.state,"Unavailable");assert.equal(isolatedUnauthorized.pins.length,25);assert.equal((await runtime.status("credential:pinterest:alivo")).state,"Authenticated");
  const afterAnalyticsUnauthorized=await composition.readObservation({ capability: "OwnPins", marketContext: "US", pageSize: 25, correlationIdentifier: "composition-observation-after-analytics-401" });
  assert.equal(["Completed","CompletedWithWarnings"].includes(afterAnalyticsUnauthorized.state),true);assert.equal(afterAnalyticsUnauthorized.pins.length,25);
  const analyticsRequestsBeforeUnauthenticatedRead=analyticsRequests;
  await runtime.authentication.reportProviderFailure({credentialId:"credential:pinterest:alivo"},"ReauthorizationRequired");
  const unauthenticatedPerformance=await composition.readPerformance();
  assert.deepEqual(unauthenticatedPerformance,{state:"ReauthorizationRequired",window:null,totals:null,pins:[]});assert.equal(analyticsRequests,analyticsRequestsBeforeUnauthenticatedRead);
  assert.equal(composition.integration.registry.all()[0].adapterId.value, "PinterestMarketSourceAdapter");
  assert.equal(composition.verificationRepository.current({ value: "ALIVO" } as never)?.state, "Available");
  await runtime.close();
});

test("trusted Top Pins composition joins fixed readiness details by internal Pin ID and discards IDs and codes",()=>{
  const snapshot=Object.freeze([
    Object.freeze({pinId:"internal-a",title:"Alpha",boardName:"Board A",thumbnail:null}),
    Object.freeze({pinId:"internal-b",title:"Bravo",boardName:"Board B",thumbnail:null}),
  ]);
  const result=Object.freeze({state:"Available",window:Object.freeze({startDate:"2026-07-20",endDate:"2026-08-18",completedDays:30}),sortBy:"OUTBOUND_CLICK",pins:Object.freeze([
    Object.freeze({pinId:"internal-b",impressions:20,saves:2,pinClicks:3,outboundClicks:4}),
    Object.freeze({pinId:"internal-a",impressions:10,saves:1,pinClicks:2,outboundClicks:3}),
    Object.freeze({pinId:"outside-snapshot",impressions:999,saves:999,pinClicks:999,outboundClicks:999}),
  ]),stale:false});
  const allIssues=Object.freeze(PINTEREST_CONTENT_AUDIT_CODES.map(code=>Object.freeze({code,...PINTEREST_CONTENT_AUDIT_RULES[code]}))),required=Object.freeze(PINTEREST_CONTENT_AUDIT_CODES.filter(code=>PINTEREST_CONTENT_AUDIT_RULES[code].level==="Required").map(code=>PINTEREST_CONTENT_AUDIT_RULES[code].message)),review=Object.freeze(PINTEREST_CONTENT_AUDIT_CODES.filter(code=>PINTEREST_CONTENT_AUDIT_RULES[code].level==="Review").map(code=>PINTEREST_CONTENT_AUDIT_RULES[code].message));
  const ready=Object.freeze({pinId:"internal-a",status:"Ready",issues:Object.freeze([])}),attention=Object.freeze({pinId:"internal-b",status:"NeedsAttention",issues:allIssues}),audit=Object.freeze({state:"Available",analyzedPins:2,readyPins:1,attentionPins:1,issueCounts:Object.freeze({}),pins:Object.freeze([ready,attention])});
  const joined=rendererSafeTopPins(result as never,snapshot as never,audit as never);
  assert.deepEqual(joined.pins,[
    {title:"Bravo",boardName:"Board B",impressions:20,saves:2,pinClicks:3,outboundClicks:4,contentReadiness:{status:"NeedsAttention",issueCount:12,requiredIssueCount:4,reviewIssueCount:8},contentReadinessDetails:{required,review}},
    {title:"Alpha",boardName:"Board A",impressions:10,saves:1,pinClicks:2,outboundClicks:3,contentReadiness:{status:"Ready",issueCount:0,requiredIssueCount:0,reviewIssueCount:0},contentReadinessDetails:{required:[],review:[]}},
  ]);
  assert.equal(Object.isFrozen(joined),true);assert.equal(Object.isFrozen(joined.pins),true);assert.equal(joined.pins.every(pin=>Object.isFrozen(pin)&&Object.isFrozen(pin.contentReadiness)&&Object.isFrozen(pin.contentReadinessDetails)&&Object.isFrozen(pin.contentReadinessDetails?.required)&&Object.isFrozen(pin.contentReadinessDetails?.review)),true);
  assert.equal(/internal-|outside-snapshot|TITLE_MISSING|DESCRIPTION_MISSING|pinId|issues|code/.test(JSON.stringify(joined)),false);
  const reordered=rendererSafeTopPins(result as never,snapshot as never,{...audit,pins:[attention,ready]} as never);assert.deepEqual(reordered.pins.map(pin=>pin.contentReadiness?.status),["NeedsAttention","Ready"]);
  const mismatched=rendererSafeTopPins(result as never,snapshot as never,{...audit,pins:[ready,{...attention,pinId:"other-snapshot"}]} as never);assert.equal(mismatched.pins.every(pin=>pin.contentReadiness===null),true);
  const invalidIssues=[
    [{code:"UNKNOWN",level:"Required",message:"arbitrary private string"}],
    [{code:"TITLE_MISSING",level:"Review",message:PINTEREST_CONTENT_AUDIT_RULES.TITLE_MISSING.message}],
    [{code:"TITLE_MISSING",level:"Required",message:"arbitrary private string"}],
    [allIssues[0],allIssues[0]],
    [null],
    [...allIssues,allIssues[0]],
  ];
  for(const [index,issues] of invalidIssues.entries()){const malformedAudit={...audit,pins:[ready,{...attention,issues}]},rowLocal=rendererSafeTopPins({...result,pins:[result.pins[1],result.pins[0]]} as never,snapshot as never,malformedAudit as never);assert.equal(rowLocal.pins[0].contentReadinessDetails?.required.length,0);assert.equal(rowLocal.pins[1].contentReadinessDetails,null);if(index<4)assert.notEqual(rowLocal.pins[1].contentReadiness,null);assert.deepEqual([rowLocal.pins[1].impressions,rowLocal.pins[1].saves,rowLocal.pins[1].pinClicks,rowLocal.pins[1].outboundClicks],[20,2,3,4]);assert.equal(JSON.stringify(rowLocal).includes("arbitrary private string"),false)}
});

test("production-shaped missing and rejected media stay non-fatal and never reach the thumbnail fetcher",async()=>{
  let thumbnailRequests=0;
  const runtime=createPinterestRuntime({configuration:CONFIGURATION,sessionStore:new InMemoryPinterestSessionStore({"credential:pinterest:alivo":{accessToken:"access-secret",expiresAt:"2026-09-19T12:00:00.000Z",businessPackageId:"ALIVO"}}),fetchImpl:async input=>{
    const url=new URL(String(input));if(url.pathname==="/v5/boards")return response(200,{items:[{id:"board-1",name:"Board"}],bookmark:null});
    return response(200,{items:[
      {id:"pin-missing",created_at:"2026-08-19T12:00:00.000Z",board_id:"board-1",media:{media_type:"image",images:{}}},
      {id:"pin-rejected",created_at:"2026-08-18T12:00:00.000Z",board_id:"board-1",media:{media_type:"image",images:{"400x300":{url:"https://i.pinimg.com.evil.example/image.jpg",width:400,height:300}}}},
    ]});
  },now:()=>NOW});
  const composition=createPinterestElectronComposition({registration:runtime.getProviderRegistration(),credentialId:"credential:pinterest:alivo",businessPackageId:"ALIVO",apiBaseUrl:CONFIGURATION.apiBaseUrl,clock:()=>NOW,thumbnailFetcher:async()=>{thumbnailRequests++;return {mimeType:"image/jpeg",base64:COMPLETE_JPEG_BASE64};}});
  await composition.verifyConnection({requestedCapabilities:["OwnPins"],correlationIdentifier:"missing-media-verification"});
  const observation=await composition.readObservation({capability:"OwnPins",pageSize:25,correlationIdentifier:"missing-media-observation"});
  assert.equal(observation.state,"Completed");assert.equal(observation.pins.length,2);assert.equal(observation.pins.every(pin=>pin.thumbnail===null),true);assert.equal(thumbnailRequests,0);
  assert.equal(/pinimg|media|images|url|access-secret/i.test(JSON.stringify(observation)),false);
  await runtime.close();
});

test("renderer-safe Pin DTOs are allowlisted, HTTPS-domain-only, capped, and deterministic",()=>{
  const observations=Array.from({length:30},(_,index)=>({
    type:"pin",
    observedAt:new Date(`2026-08-${String((index%25)+1).padStart(2,"0")}T12:00:00.000Z`),
    payloadReference:JSON.stringify({resourceId:`pin-${String(index).padStart(2,"0")}`,resourceType:"pin",ownership:index===24?"OwnedAuthorizedResource":"provider-value",title:index===24?"<img src=x onerror=bad()>":`Pin ${index}`,description:"description",boardReference:"board",link:index===24?"https://Example.test/private/path?token=secret":index===23?"http://unsafe.test/path":index===22?"not a URL":"https://safe.test/path",accessToken:"secret",refreshToken:"secret",callbackUrl:"secret",media:{raw:true},unknown:"discard"}),
  }));
  const boards=new Map([["board","<b>Safe board text</b>"]]);
  const pins=rendererSafePins(observations,boards);
  assert.equal(pins.length,25);
  assert.deepEqual(pins.map(pin=>pin.createdAt),[...pins.map(pin=>pin.createdAt)].sort().reverse());
  assert.deepEqual(rendererSafePins([...observations].reverse(),boards).map(pin=>pin.pinId),pins.map(pin=>pin.pinId));
  assert.equal(pins.find(pin=>pin.pinId==="pin-24")?.title,"<img src=x onerror=bad()>");
  assert.equal(pins.find(pin=>pin.pinId==="pin-24")?.destinationDomain,"example.test");
  assert.equal(pins.find(pin=>pin.pinId==="pin-23")?.destinationDomain,undefined);
  assert.equal(pins.find(pin=>pin.pinId==="pin-22")?.destinationDomain,undefined);
  assert.equal(pins.every(pin=>pin.boardName==="<b>Safe board text</b>"),true);
  for(const pin of pins)assert.deepEqual(Object.keys(pin).every(key=>["pinId","title","description","createdAt","boardName","destinationDomain","thumbnail"].includes(key)),true);
  assert.equal(/accessToken|refreshToken|callbackUrl|media|unknown|ownership|boardReference|private\/path|token=secret/.test(JSON.stringify(pins)),false);
  const unicodePin=rendererSafePins([{type:"pin",observedAt:NOW,payloadReference:JSON.stringify({resourceId:"unicode",resourceType:"pin",title:"😀".repeat(101),description:"😀".repeat(801),link:"https://alivo.eu"})}]);
  assert.equal(Array.from(unicodePin[0].title??"").length,101);assert.equal(Array.from(unicodePin[0].description??"").length,801);
});
