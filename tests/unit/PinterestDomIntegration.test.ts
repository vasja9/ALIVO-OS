import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createPinterestDomHarness, pinterestUiModuleToHarnessScript, sequence } from "../harness/PinterestDomHarness.js";
import { COMPLETE_JPEG_BASE64 } from "../fixtures/PinterestThumbnailFixtures.ts";

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
  assert.throws(
    () => pinterestUiModuleToHarnessScript('import unused from "./other-module.js";\r\nimport { transition } from "./pinterest-connection-state.js";\r\nconst state = transition;\r\n'),
    /Unexpected Pinterest UI ESM import in DOM harness/,
  );
});

test("DOM harness accepts LF and CRLF source with the same transform semantics", () => {
  const lfSource = 'import { transition } from "./pinterest-connection-state.js";\nconst state = transition;\n';
  const crlfSource = lfSource.replace(/\n/g, "\r\n");
  assert.equal(pinterestUiModuleToHarnessScript(crlfSource), pinterestUiModuleToHarnessScript(lfSource).replace(/\n/g, "\r\n"));
});

test("DOM harness reads observations only from the explicit action without rendering provider payloads", async () => {
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
  assert.equal(harness.callCount("verifyConnection"), 0);
  assert.equal(harness.callCount("readObservation"), 0);
  await harness.clickAction("verify");
  assert.equal(harness.callCount("verifyConnection"), 1);
  assert.equal(harness.callCount("readObservation"), 0);
  await harness.clickAction("observe");
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

test("DOM harness refresh and reopen update status without automatic verification or observation reads", async () => {
  const harness = await createPinterestDomHarness(preloadFor({
    connectionStatus: sequence(authenticated, authenticated),
  })).start();

  assert.equal(harness.hasText("Connected"), true);
  assert.equal(harness.callCount("verifyConnection"), 0);
  assert.equal(harness.callCount("readObservation"), 0);
  const oauthCalls = harness.callCount("startOAuth");
  await harness.reopen();

  assert.equal(harness.callCount("connectionStatus"), 2);
  assert.equal(harness.callCount("verifyConnection"), 0);
  assert.equal(harness.callCount("readObservation"), 0);
  assert.equal(harness.callCount("startOAuth"), oauthCalls);
  assert.equal(harness.hasText("Connected"), true);
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
  await harness.clickAction("verify");
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

  await harness.clickAction("verify");
  assert.equal(harness.snapshotHistory.some(snapshot => snapshot.includes("Connected")), true);
  assert.equal(harness.callCount("readObservation"), 0);
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

  await harness.clickAction("verify");
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
      await harness.clickAction("verify");
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

test("All Pins renders safe DTO values as text and exposes empty and unavailable states", async () => {
  const maliciousTitle = '<img src=x onerror="steal()">';
  const maliciousBoard = '<svg onload="steal()">Board</svg>';
  const harness = await createPinterestDomHarness(preloadFor({
    connectionStatus: async () => authenticated,
    readObservation: sequence(
      { ok: true, state: "Completed", summary: { acceptedObservations: 2 }, pins: [{ pinId: "pin-1", title: maliciousTitle, description: "<script>bad()</script>", createdAt: "2026-08-22T23:59:00.000-05:00", boardName: maliciousBoard, destinationDomain: "example.test" }, { pinId: "pin-2", createdAt: "invalid", boardName: "Unknown board" }] },
      { ok: true, state: "Unavailable", pins: [{ pinId: "pin-1", title: maliciousTitle, boardName: maliciousBoard }] },
    ),
  })).start();
  await harness.clickAction("verify");
  await harness.clickAction("observe");
  harness.document.querySelector('[data-pin-view="all"]').click();
  await harness.settle();
  assert.equal(harness.hasText(maliciousTitle), true);
  assert.equal(harness.hasText("<script>bad()</script>"), true);
  assert.equal(harness.hasText("Datum: 23.08.26 · Board: " + maliciousBoard + " · Destination: example.test"), true);
  assert.equal(harness.document.querySelector(".pin-metadata").textContent,"Datum: 23.08.26 · Board: " + maliciousBoard + " · Destination: example.test");
  assert.equal(harness.hasText("Unknown board"), true);
  assert.equal(harness.hasText("Invalid Date"), false);
  assert.equal(harness.hasText("board-1"), false);
  assert.equal(harness.hasText("Ownership:"), false);
  assert.equal(harness.callCount("readObservation"), 1);
  await harness.clickAction("observe");
  assert.equal(harness.hasText("temporarily unavailable"), true);
  assert.equal(harness.hasText(maliciousTitle), true);
  assert.equal(harness.hasText("Disconnected"), false);

  const empty = await createPinterestDomHarness(preloadFor({ connectionStatus: async () => authenticated, readObservation: async () => ({ ok: true, state: "NoData", pins: [] }) })).start();
  empty.document.querySelector('[data-pin-view="all"]').click();
  await empty.settle();
  assert.equal(empty.hasText("No observation has been read yet"), true);
  await empty.clickAction("verify");
  await empty.clickAction("observe");
  assert.equal(empty.hasText("completed successfully with no Pins"), true);
});

test("All Pins creates only validated data images and neutral placeholders",async()=>{
  const jpeg=COMPLETE_JPEG_BASE64;
  const malicious='<img src="https://evil.example/steal">';
  const harness=await createPinterestDomHarness(preloadFor({connectionStatus:async()=>authenticated,readObservation:async()=>({ok:true,state:"Completed",pins:[{pinId:"pin-1",title:malicious,boardName:"Board",thumbnail:{mimeType:"image/jpeg",base64:jpeg,url:"https://i.pinimg.com/private.jpg"}},{pinId:"pin-2",boardName:"Board",thumbnail:null}]})})).start();
  await harness.clickAction("verify");await harness.clickAction("observe");harness.document.querySelector('[data-pin-view="all"]').click();await harness.settle();
  const images=harness.document.querySelectorAll(".pin-thumbnail-image");
  assert.equal(images.length,1);assert.equal(images[0].src,`data:image/jpeg;base64,${jpeg}`);assert.ok(images[0].src.length>263);assert.equal(images[0].src.slice(23),jpeg);assert.equal(images[0].loading,"lazy");assert.equal(images[0].decoding,"async");assert.equal(images[0].alt,malicious);
  assert.equal(harness.document.querySelectorAll(".pin-thumbnail-placeholder").length,1);assert.equal(harness.hasText("No image"),true);assert.equal(harness.hasText(malicious),true);
  assert.equal(images.some(image=>String(image.src).includes("pinimg.com")),false);assert.equal(harness.document.querySelectorAll("a").length,0);
});
