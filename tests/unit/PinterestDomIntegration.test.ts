import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createPinterestDomHarness, pinterestUiModuleToHarnessScript, sequence } from "../harness/PinterestDomHarness.js";

const authenticationRequired = { ok: true, state: "AuthenticationRequired" };
const authenticated = { ok: true, state: "Authenticated" };
const available = { ok: true, state: "Available" };
const harnessSource = readFileSync(new URL("../harness/PinterestDomHarness.js", import.meta.url), "utf8");

function preloadFor({
  startOAuth = async () => ({ ok: true }),
  connectionStatus = async () => authenticationRequired,
  verifyConnection = async () => available,
  readObservation = async () => ({ ok: true, state: "Completed", summary: { acceptedObservations: 2 } }),
} = {}) {
  return { startOAuth, connectionStatus, verifyConnection, readObservation };
}

test("DOM harness normalizes Windows ESM line endings and rejects unhandled imports", () => {
  assert.equal(
    pinterestUiModuleToHarnessScript('import { transition } from "./pinterest-connection-state.js";\r\nconst state = transition;\r\n'),
    "const state = transition;\r\n",
  );
  assert.throws(
    () => pinterestUiModuleToHarnessScript('import { transition } from "./other-module.js";\r\nconst state = transition;\r\n'),
    /Unexpected Pinterest UI ESM import in DOM harness/,
  );
});

test("DOM harness runs startOAuth to connectionStatus to verifyConnection to readObservation without rendering provider payloads", async () => {
  const secretPayload = {
    ok: true,
    state: "CompletedWithWarnings",
    summary: { acceptedObservations: 2, pinterestAvailability: 1 },
    body: { accessToken: "access-secret", clientSecret: "client-secret", sessionSecret: "session-secret" },
    warnings: ["raw provider warning token=warning-secret callbackUrl=https://localhost/?code=callback-secret"],
  };
  const harness = await createPinterestDomHarness(preloadFor({
    connectionStatus: sequence(authenticationRequired, authenticated),
    readObservation: async () => secretPayload,
  })).start();

  assert.equal(harness.hasText("Not connected"), true);
  const firstConnect = harness.invokeActionHandlerWithoutWaiting("connect");
  harness.invokeActionHandlerWithoutWaiting("connect");
  await harness.settle();

  assert.equal(harness.callCount("startOAuth"), 1);
  assert.equal(harness.hasText("Connecting"), true);
  assert.equal(await harness.runNextTimer(), true);
  assert.equal(harness.callCount("connectionStatus"), 2);
  assert.equal(harness.callCount("verifyConnection"), 1);
  assert.equal(harness.callCount("readObservation"), 1);
  assert.equal(harness.snapshotHistory.some(snapshot => snapshot.includes("Connected")), true);
  assert.equal(harness.snapshotHistory.some(snapshot => snapshot.includes("Checking connection")), true);
  assert.equal(harness.hasText("Read-only observation ready"), true);
  assert.equal(harness.hasText("accepted Observations2"), true);
  assert.equal(harness.hasText("access-secret"), false);
  assert.equal(harness.hasText("client-secret"), false);
  assert.equal(harness.hasText("session-secret"), false);
  assert.equal(harness.hasText("warning-secret"), false);
  assert.equal(harness.hasText("callback-secret"), false);
  assert.equal(harness.logs.length, 0);
  for (const snapshot of harness.snapshotHistory) {
    for (const secret of ["access-secret", "client-secret", "session-secret", "warning-secret", "callback-secret"]) {
      assert.equal(snapshot.includes(secret), false);
    }
  }
  assert.equal(harness.calls.find(call => call.name === "startOAuth" && call.type === "invoke")?.input.correlationIdentifier, "pinterest-ui-connect");
  await firstConnect;
});

test("DOM harness restores a connected read-only workspace on reopen without starting OAuth again", async () => {
  const harness = await createPinterestDomHarness(preloadFor({
    connectionStatus: sequence(authenticated, authenticated),
  })).start();

  assert.equal(harness.hasText("Read-only observation ready"), true);
  const oauthCalls = harness.callCount("startOAuth");
  await harness.reopen();

  assert.equal(harness.callCount("connectionStatus"), 2);
  assert.equal(harness.callCount("verifyConnection"), 2);
  assert.equal(harness.callCount("readObservation"), 2);
  assert.equal(harness.callCount("startOAuth"), oauthCalls);
  assert.equal(harness.hasText("Read-only observation ready"), true);
});

test("DOM harness keeps OAuth success plus PermissionLimited verification connected and offers reauthorization", async () => {
  const harness = await createPinterestDomHarness(preloadFor({
    connectionStatus: sequence(authenticationRequired, authenticated),
    verifyConnection: async () => ({
      ok: true,
      state: "PermissionLimited",
      authenticationState: "Authenticated",
      capabilities: [{ capability: "MarketObservation", state: "PermissionRequired", reason: "MissingScope", safeMessage: "raw provider accessToken=secret" }],
    }),
  })).start();

  await harness.clickAction("connect");
  assert.equal(await harness.runNextTimer(), true);
  assert.equal(harness.callCount("startOAuth"), 1);
  assert.equal(harness.callCount("connectionStatus"), 2);
  assert.equal(harness.callCount("verifyConnection"), 1);
  assert.equal(harness.hasText("Connected with limited permissions"), true);
  assert.equal(harness.hasText("Reauthorize Pinterest"), true);
  assert.equal(harness.hasText("Disconnected"), false);
  assert.equal(harness.hasText("accessToken"), false);
  assert.equal(harness.hasText("raw provider"), false);
  assert.equal(harness.logs.length, 0);
});

test("DOM harness keeps a valid pins connection connected when analytics scope is absent", async () => {
  const harness = await createPinterestDomHarness(preloadFor({
    connectionStatus: async () => authenticated,
    verifyConnection: async input => {
      assert.equal(Array.from(input.requestedCapabilities).join(","), "MarketObservation");
      return { ok: true, state: "Available", capabilities: [{ capability: "MarketObservation", state: "Available" }] };
    },
  })).start();

  assert.equal(harness.snapshotHistory.some(snapshot => snapshot.includes("Connected")), true);
  assert.equal(harness.hasText("Read-only observation ready"), true);
  assert.equal(harness.hasText("Disconnected"), false);
  assert.equal(harness.calls.find(call => call.name === "verifyConnection")?.input.requestedCapabilities.includes("AnalyticsObservation"), false);
  assert.equal(harness.logs.length, 0);
});

test("DOM harness maps an actually invalid session to reauthorization without rendering provider details", async () => {
  const harness = await createPinterestDomHarness(preloadFor({
    connectionStatus: async () => authenticated,
    verifyConnection: async () => ({
      ok: true,
      state: "Unavailable",
      authenticationState: "Authenticated",
      capabilities: [{ capability: "MarketObservation", state: "AuthenticationRequired", reason: "AuthenticationRequired", safeMessage: "raw accessToken=secret" }],
    }),
  })).start();

  assert.equal(harness.hasText("Reauthorization required"), true);
  assert.equal(harness.hasText("Connected with limited permissions"), false);
  assert.equal(harness.hasText("raw"), false);
  assert.equal(harness.hasText("accessToken"), false);
  assert.equal(harness.logs.length, 0);
});

test("DOM harness exposes safe denial and expired OAuth state transitions", async () => {
  for (const result of [
    { ok: false, code: "OAUTH_DENIED", message: "raw provider error accessToken=secret" },
    { ok: false, code: "CALLBACK_STATE_INVALID", message: "state=expired authorizationCode=secret" },
  ]) {
    const harness = await createPinterestDomHarness(preloadFor({
      startOAuth: async () => result,
    })).start();
    await harness.clickAction("connect");
    assert.equal(harness.hasText("OAuth denied"), true);
    assert.equal(harness.hasText("raw provider error"), false);
    assert.equal(harness.hasText("secret"), false);
    assert.equal(harness.logs.length, 0);
  }
});

test("DOM harness covers reauthorization after 401, timeout, rate limit, and failed verification", async () => {
  const scenarios = [
    {
      verifyConnection: async () => ({ ok: false, status: 401, code: "AUTHENTICATION_REQUIRED", message: "raw 401 accessToken=secret" }),
      text: "Reauthorization required",
    },
    {
      startOAuth: async () => ({ ok: false, code: "TIMEOUT", message: "raw timeout callbackUrl=secret" }),
      text: "Timeout / network error",
    },
    {
      verifyConnection: async () => ({ ok: true, state: "RateLimited", message: "raw rate-limit token=secret" }),
      text: "Rate limited",
    },
    {
      verifyConnection: async () => ({ ok: false, code: "UNEXPECTED_VERIFY_FAILURE", message: "raw provider error secret" }),
      text: "Not connected",
    },
  ];

  for (const scenario of scenarios) {
    const harness = await createPinterestDomHarness(preloadFor({
      ...scenario,
      connectionStatus: scenario.startOAuth ? async () => authenticationRequired : async () => authenticated,
    })).start();
    if (scenario.startOAuth) {
      await harness.clickAction("connect");
    } else {
      assert.equal(harness.hasText(scenario.text), true);
    }
    assert.equal(harness.hasText(scenario.text), true);
    assert.equal(harness.hasText("secret"), false);
    assert.equal(harness.hasText("raw provider error"), false);
    assert.equal(harness.logs.length, 0);
  }
});

test("DOM harness shows configuration missing and rejects missing or incomplete preload contracts", async () => {
  const configuration = await createPinterestDomHarness(preloadFor({
    startOAuth: async () => ({ ok: false, code: "CONFIGURATION_FAILURE", message: "clientSecret=secret" }),
  })).start();
  await configuration.clickAction("connect");
  assert.equal(configuration.hasText("Configuration missing"), true);
  assert.equal(configuration.hasText("clientSecret"), false);
  assert.equal(configuration.hasText("secret"), false);

  const missing = await createPinterestDomHarness({}).start();
  assert.equal(missing.hasText("Preload unavailable"), true);
  assert.equal(missing.callCount("connectionStatus"), 0);

  const incomplete = await createPinterestDomHarness({
    startOAuth: async () => ({ ok: true }),
    connectionStatus: async () => authenticationRequired,
    verifyConnection: async () => available,
  }).start();
  assert.equal(incomplete.hasText("Preload unavailable"), true);
  assert.equal(incomplete.callCount("startOAuth"), 0);
  assert.equal(incomplete.callCount("connectionStatus"), 0);
});

test("DOM harness has no network transport or alternate Pinterest test API", () => {
  assert.doesNotMatch(harnessSource, /\b(fetch|XMLHttpRequest|WebSocket)\s*\(/);
  assert.doesNotMatch(harnessSource, /\b(readPin|pinDetail|createPin|publishPin|executeCommand)\b/);
});