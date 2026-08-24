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
  readAccountPerformance = async () => ({ ok: true, state: "NotRead", window: null, latestAvailableDate: null, totals: null, daily: [], stale: false }),
  readTopPins = async () => ({ ok: true, state: "NotRead", window: null, sortBy: null, pins: [], stale: false }),
  readPerformance = async () => ({ ok: true, state: "NotRead", window: null, totals: null, pins: [] }),
} = {}) {
  return { startOAuth, connectionStatus, verifyConnection, readObservation, readAccountPerformance, readTopPins, readPerformance };
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

test("content readiness overview and Attention render bounded local audit guidance as text",async()=>{
  const malicious='<img src=x onerror="steal()">';
  const fixedMessage="Add a Pin title.";
  const audit={state:"Available",analyzedPins:2,readyPins:1,attentionPins:1,issueCounts:{TITLE_MISSING:1,TITLE_TOO_LONG:0,DESTINATION_MISSING:0,DESTINATION_OUTSIDE_ALIVO:0,DESCRIPTION_MISSING:0,DESCRIPTION_TOO_LONG:0,THUMBNAIL_MISSING:0,BOARD_UNKNOWN:0,CREATED_AT_INVALID:0,DUPLICATE_TITLE:0,DUPLICATE_CONTENT:0,POSSIBLE_TEST_CONTENT:0},pins:[{pinId:"pin-bad",status:"NeedsAttention",issues:[{code:"TITLE_MISSING",level:"Required",message:"provider-controlled message"}]},{pinId:"pin-ready",status:"Ready",issues:[]}]};
  const harness=await createPinterestDomHarness(preloadFor({connectionStatus:async()=>authenticated,readObservation:async()=>({ok:true,state:"Completed",pins:[{pinId:"pin-bad",title:malicious,description:"safe",createdAt:"2026-08-22T12:00:00.000Z",boardName:"Board",destinationDomain:"alivo.eu",thumbnail:null},{pinId:"pin-ready",title:"Ready Pin",description:"safe",createdAt:"2026-08-21T12:00:00.000Z",boardName:"Board",destinationDomain:"shop.alivo.eu",thumbnail:null}],audit})})).start();
  assert.equal(harness.hasText("No content audit has been run yet."),true);
  await harness.clickAction("verify");
  assert.equal(harness.callCount("readObservation"),0);
  assert.equal(harness.hasText("No content audit has been run yet."),true);
  await harness.clickAction("refresh");
  assert.equal(harness.callCount("readObservation"),0);
  await harness.clickAction("observe");
  assert.equal(harness.hasText("Deterministic content audit · Not performance analytics"),true);
  assert.equal(harness.hasText("Pins analyzed2Ready1Needs attention1Required issues1Review issues0"),true);
  assert.equal(harness.document.querySelector("#pin-attention-count").textContent,"1");
  harness.document.querySelector('[data-pin-view="all"]').click();await harness.settle();
  assert.equal(harness.hasText("Needs attention (1)"),true);assert.equal(harness.hasText("Ready"),true);
  harness.document.querySelector('[data-pin-view="attention"]').click();await harness.settle();
  assert.equal(harness.document.querySelectorAll(".pin-card").length,1);
  assert.equal(harness.hasText(malicious),true);assert.equal(harness.hasText(fixedMessage),true);assert.equal(harness.hasText("provider-controlled message"),false);
  assert.equal(harness.document.querySelectorAll("a").length,0);
});

test("temporary observation failure retains the last safe audit and duplicate read snapshot",async()=>{
  const audit={state:"Available",analyzedPins:1,readyPins:0,attentionPins:1,issueCounts:{TITLE_MISSING:0,TITLE_TOO_LONG:0,DESTINATION_MISSING:0,DESTINATION_OUTSIDE_ALIVO:0,DESCRIPTION_MISSING:1,DESCRIPTION_TOO_LONG:0,THUMBNAIL_MISSING:0,BOARD_UNKNOWN:0,CREATED_AT_INVALID:0,DUPLICATE_TITLE:0,DUPLICATE_CONTENT:0,POSSIBLE_TEST_CONTENT:0},pins:[{pinId:"pin-1",status:"NeedsAttention",issues:[{code:"DESCRIPTION_MISSING",level:"Review",message:"ignored"}]}]};
  const pin={pinId:"pin-1",title:"Retained Pin",createdAt:"2026-08-22T12:00:00.000Z",boardName:"Board",destinationDomain:"alivo.eu",thumbnail:null};
  const harness=await createPinterestDomHarness(preloadFor({connectionStatus:async()=>authenticated,readObservation:sequence({ok:true,state:"Completed",pins:[pin],audit},{ok:true,state:"CompletedWithWarnings",pins:[pin],audit},{ok:false,state:"Unavailable"})})).start();
  await harness.clickAction("verify");await harness.settle();await harness.clickAction("observe");await harness.settle();await harness.clickAction("observe");await harness.settle();
  assert.equal(harness.hasText("Pins analyzed1"),true);assert.equal(harness.document.querySelector("#pin-attention-count").textContent,"1");
  await harness.clickAction("observe");await harness.settle();
  assert.equal(harness.hasText("last valid audit remains visible"),true);assert.equal(harness.hasText("Pins analyzed1"),true);assert.equal(harness.document.querySelector("#pin-attention-count").textContent,"1");
});

test("account performance is explicit, independent, bounded, stale-safe, and provider text stays inert",async()=>{
  const metric=(index,offset)=>index<5?[0,20,100,100,null][(index+offset)%5]:index;
  const daily=Array.from({length:31},(_,index)=>({date:new Date(Date.UTC(2026,6,24+index)).toISOString().slice(0,10),impressions:metric(index,0),saves:metric(index,1),pinClicks:metric(index,2),outboundClicks:metric(index,3),providerPayload:"daily-secret",providerUrl:"https://provider.invalid/private",headers:{authorization:"provider-header"},oauthToken:"provider-token",cookie:"provider-cookie",callbackData:"provider-callback",thumbnail:"provider-thumbnail"}));
  daily[30]={...daily[30],impressions:999,saves:999,pinClicks:999,outboundClicks:999};
  const originalDaily=JSON.stringify(daily);
  const availableAccount={ok:true,state:"Available",window:{startDate:"2026-07-24",endDate:"2026-08-22",completedDays:30},latestAvailableDate:"2026-08-21",totals:{impressions:0,saves:2,pinClicks:null,outboundClicks:1},daily,stale:false,rawProvider:"account-secret",providerUrl:"https://provider.invalid/account",headers:{cookie:"account-header"},oauthToken:"account-token",callbackData:"account-callback"};
  const retained={...availableAccount,state:"Failed",stale:true};
  const harness=await createPinterestDomHarness(preloadFor({connectionStatus:async()=>authenticated,readAccountPerformance:sequence(availableAccount,retained),readPerformance:async()=>({ok:true,state:"Failed",window:null,totals:null,pins:[]})})).start();
  assert.equal(harness.callCount("readAccountPerformance"),0);assert.equal(harness.callCount("readPerformance"),0);
  await harness.clickAction("refresh");await harness.clickAction("verify");await harness.clickAction("observe");
  assert.equal(harness.callCount("readAccountPerformance"),0);assert.equal(harness.callCount("readPerformance"),0);
  harness.document.querySelector('[data-pin-view="performance"]').click();await harness.settle();
  assert.equal(harness.callCount("readAccountPerformance"),0);assert.equal(harness.hasText("Organic account metrics · Read-only"),true);
  assert.equal(harness.document.querySelector(".account-performance-trend"),undefined);assert.equal(harness.document.querySelector(".account-comparison"),undefined);
  await harness.clickAction("account-performance");
  assert.equal(harness.callCount("readAccountPerformance"),1);assert.equal(harness.callCount("readPerformance"),0);
  assert.equal(harness.hasText("2026-07-24 to 2026-08-22 · 30 completed UTC days"),true);assert.equal(harness.hasText("Latest available date: 2026-08-21"),true);
  assert.equal(harness.hasText("Impressions0Saves2Pin clicksUnavailableOutbound clicks1"),true);
  assert.equal(harness.hasText("30-day organic trend"),true);assert.equal(harness.hasText("Local visualization of the already-read organic account metrics."),true);
  const trendButton=key=>harness.document.querySelector(`[data-account-trend-metric="${key}"]`),trendSvg=()=>harness.document.querySelector(".account-trend-chart"),trendPoints=()=>harness.document.querySelectorAll(".account-trend-point"),trendLines=()=>harness.document.querySelectorAll(".account-trend-line");
  const trendKeys=["impressions","saves","pinClicks","outboundClicks"],trendLabels=["Impressions","Saves","Pin clicks","Outbound clicks"],trendButtons=trendKeys.map(trendButton);
  assert.deepEqual(trendButtons.map(button=>button.textContent),trendLabels);assert.equal(trendButtons.every(button=>button.tagName==="BUTTON"&&button.type==="button"),true);
  assert.deepEqual(trendButtons.map(button=>button.getAttribute("aria-pressed")),["true","false","false","false"]);
  const defaultTrend=trendSvg();assert.equal(defaultTrend.tagName,"SVG");assert.equal(defaultTrend.namespaceURI,"http://www.w3.org/2000/svg");assert.equal(defaultTrend.getAttribute("role"),"img");assert.equal(defaultTrend.getAttribute("viewBox"),"0 0 640 280");assert.equal(defaultTrend.getAttribute("aria-label"),"Impressions organic account trend from 24.07.26 to 22.08.26 with 29 usable daily values.");
  assert.equal(harness.document.querySelector(".account-trend-x-label").textContent,"Date (UTC)");assert.equal(harness.document.querySelector(".account-trend-y-label").textContent,"Impressions");assert.deepEqual(harness.document.querySelectorAll(".account-trend-date-label").map(label=>label.textContent),["24.07.26","22.08.26"]);assert.deepEqual(harness.document.querySelectorAll(".account-trend-tick-label").map(label=>label.textContent),["0","25","50","75","100","125"]);assert.notEqual(harness.document.querySelector(".account-trend-x-axis"),undefined);assert.notEqual(harness.document.querySelector(".account-trend-y-axis"),undefined);assert.equal(trendPoints().length,29);assert.equal(trendLines().length,2);
  const initialY=trendPoints().slice(0,3).map(point=>Number(point.getAttribute("cy")));assert.equal(initialY[2]<initialY[1]&&initialY[1]<initialY[0],true);
  const svgTags=[],svgAttributes=[];const inspectSvg=node=>{svgTags.push(node.tagName);assert.equal(node.namespaceURI,"http://www.w3.org/2000/svg");for(const [name,value] of Object.entries(node.attributes)){svgAttributes.push([name,value]);assert.equal(/^on|^(?:href|xlink:href|style)$/i.test(name),false);assert.equal(/NaN|Infinity/.test(value),false)}for(const child of node.children)inspectSvg(child)};inspectSvg(defaultTrend);
  assert.equal(svgTags.some(tag=>["FOREIGNOBJECT","IMAGE","A"].includes(tag)),false);
  for(const [name,value] of svgAttributes){if(["x1","x2","cx","x"].includes(name)){const numeric=Number(value);assert.equal(Number.isFinite(numeric)&&numeric>=0&&numeric<=640,true)}if(["y1","y2","cy","y"].includes(name)){const numeric=Number(value);assert.equal(Number.isFinite(numeric)&&numeric>=0&&numeric<=280,true)}if(name==="points")for(const [index,coordinate] of value.split(/[ ,]/).entries()){const numeric=Number(coordinate);assert.equal(Number.isFinite(numeric)&&numeric>=0&&numeric<=(index%2?280:640),true)}}
  const table=harness.document.querySelector(".account-performance-table"),tableRows=()=>table.children[1].children,headerCells=()=>table.children[0].children[0].children,sortButton=key=>harness.document.querySelector(`[data-account-sort="${key}"]`),rowDates=()=>tableRows().map(row=>row.children[0].textContent),columnValues=index=>tableRows().map(row=>row.children[index].textContent);
  const expectedHeadings=["Date","Impressions","Saves","Pin clicks","Outbound clicks"],accountDailyColumnsForTest=["date","impressions","saves","pinClicks","outboundClicks"],buttons=headerCells().map(cell=>cell.children[0]);
  const assertActive=(key,direction,indicator)=>{for(const cell of headerCells()){const button=cell.children[0],active=button.dataset.accountSort===key;assert.equal(cell.getAttribute("aria-sort"),active?direction:undefined);assert.equal(button.textContent,expectedHeadings[accountDailyColumnsForTest.indexOf(button.dataset.accountSort)]+(active?indicator:""))}};
  assert.equal(table.tagName,"TABLE");assert.deepEqual(headerCells().map(cell=>cell.textContent),expectedHeadings);assert.equal(headerCells().every(cell=>cell.tagName==="TH"&&cell.getAttribute("scope")==="col"&&cell.getAttribute("aria-sort")===undefined),true);assert.equal(buttons.every(button=>button.tagName==="BUTTON"&&button.type==="button"),true);
  assert.equal(tableRows().length,30);assert.deepEqual(tableRows()[0].children.map(cell=>cell.textContent),["24.07.26","0","20","100","100"]);assert.deepEqual([rowDates()[0],rowDates().at(-1)],["24.07.26","22.08.26"]);
  const chronologicalRows=rowDates().slice(),assertTrendPressed=active=>{for(const key of trendKeys)assert.equal(trendButton(key).getAttribute("aria-pressed"),String(key===active))};
  for(let index=0;index<trendKeys.length;index++){const key=trendKeys[index],button=trendButton(key);if(index===0)button.pressKey("Enter");else if(index===1)button.pressKey(" ");else button.click();assertTrendPressed(key);assert.match(trendSvg().getAttribute("aria-label"),new RegExp(`^${trendLabels[index]} organic account trend from 24\\.07\\.26 to 22\\.08\\.26 with \\d+ usable daily values\\.$`));assert.deepEqual(rowDates(),chronologicalRows);assert.equal(harness.document.querySelector(".account-performance-table"),table);assert.equal(harness.callCount("readAccountPerformance"),1)}
  trendButton("impressions").click();assertTrendPressed("impressions");
  const chartBeforeTableSort=trendSvg(),chartCoordinatesBeforeSort=trendPoints().map(point=>[point.getAttribute("cx"),point.getAttribute("cy")]);
  sortButton("date").pressKey("Enter");assert.deepEqual([rowDates()[0],rowDates().at(-1)],["22.08.26","24.07.26"]);assertActive("date","descending","\u25bc");
  assert.equal(trendSvg(),chartBeforeTableSort);assert.deepEqual(trendPoints().map(point=>[point.getAttribute("cx"),point.getAttribute("cy")]),chartCoordinatesBeforeSort);assert.deepEqual(harness.document.querySelectorAll(".account-trend-date-label").map(label=>label.textContent),["24.07.26","22.08.26"]);
  sortButton("date").pressKey(" ");assert.deepEqual([rowDates()[0],rowDates().at(-1)],["24.07.26","22.08.26"]);assertActive("date","ascending","\u25b2");
  for(const [key,index] of [["impressions",1],["saves",2],["pinClicks",3],["outboundClicks",4]]){const equalOrder=()=>tableRows().filter(row=>row.children[index].textContent==="100").map(row=>row.children[0].textContent),before=equalOrder();sortButton(key).click();let values=columnValues(index);assert.equal(values.indexOf("100")<values.indexOf("20"),true);assert.equal(values.includes("0"),true);assert.equal(values.at(-1),"\u2014");assert.deepEqual(equalOrder(),before);assertActive(key,"descending","\u25bc");const descendingEqual=equalOrder();sortButton(key).click();values=columnValues(index);assert.equal(values.indexOf("20")<values.indexOf("100"),true);assert.equal(values.includes("0"),true);assert.equal(values.at(-1),"\u2014");assert.deepEqual(equalOrder(),descendingEqual);assertActive(key,"ascending","\u25b2")}
  assert.equal(JSON.stringify(daily),originalDaily);assert.equal(harness.callCount("readAccountPerformance"),1);assert.equal(harness.callCount("readPerformance"),0);
  const rows=tableRows(),tableTags=[];const visit=node=>{tableTags.push(node.tagName);for(const child of node.children)visit(child)};visit(table);assert.deepEqual([...new Set(tableTags)].sort(),["BUTTON","SPAN","TABLE","TBODY","TD","TH","THEAD","TR"].sort());for(const forbidden of ["daily-secret","account-secret","provider.invalid","provider-header","provider-token","provider-cookie","provider-callback","provider-thumbnail","account-header","account-token","account-callback","2026-08-23"])assert.equal(harness.hasText(forbidden),false);assert.equal(rows.some(row=>row.children.some(cell=>cell.textContent==="999")),false);
  harness.document.querySelector('[data-pin-view="all"]').click();harness.document.querySelector('[data-pin-view="performance"]').click();await harness.settle();
  assert.equal(harness.callCount("readAccountPerformance"),1);assert.equal(harness.callCount("readPerformance"),0);
  await harness.clickAction("account-performance");
  assert.equal(harness.callCount("readAccountPerformance"),2);assert.equal(harness.callCount("readPerformance"),0);assert.equal(harness.hasText("last valid account analytics snapshot remains visible as stale data"),true);
  assert.equal(harness.document.querySelector(".account-trend-chart").getAttribute("aria-label"),"Impressions organic account trend from 24.07.26 to 22.08.26 with 29 usable daily values.");assert.equal(harness.document.querySelector('[data-account-trend-metric="impressions"]').getAttribute("aria-pressed"),"true");assert.notEqual(harness.document.querySelector(".account-comparison"),undefined);
  assert.equal(harness.document.querySelectorAll("a").length,0);
});

test("account trend handles bounded, all-zero, missing, one-point, no-data, and authentication-clearing states",async()=>{
  const window={startDate:"2026-07-24",endDate:"2026-08-22",completedDays:30};
  const available=daily=>({ok:true,state:"Available",window,latestAvailableDate:"2026-08-22",totals:null,daily,stale:false});
  const openAndRead=async preload=>{const harness=await createPinterestDomHarness(preloadFor(preload)).start();harness.document.querySelector('[data-pin-view="performance"]').click();await harness.settle();assert.equal(harness.document.querySelector(".account-performance-trend"),undefined);await harness.clickAction("account-performance");assert.equal(harness.callCount("readAccountPerformance"),1);return harness};

  const boundedDaily=Array.from({length:31},(_,index)=>({date:new Date(Date.UTC(2026,6,24+index)).toISOString().slice(0,10),impressions:index===30?999:index,saves:index,pinClicks:index,outboundClicks:index}));
  const boundedOriginal=JSON.stringify(boundedDaily),bounded=await openAndRead({connectionStatus:async()=>authenticated,readAccountPerformance:async()=>available(boundedDaily)});
  assert.equal(bounded.document.querySelectorAll(".account-trend-point").length,30);assert.equal(bounded.document.querySelector(".account-trend-chart").getAttribute("aria-label"),"Impressions organic account trend from 24.07.26 to 22.08.26 with 30 usable daily values.");assert.equal(bounded.document.querySelector(".account-performance-table").children[1].children.some(row=>row.children.some(cell=>cell.textContent==="999")),false);assert.equal(JSON.stringify(boundedDaily),boundedOriginal);

  const zeroDaily=["2026-07-24","2026-07-25","2026-07-26"].map(date=>({date,impressions:0,saves:0,pinClicks:0,outboundClicks:0}));
  const zero=await openAndRead({connectionStatus:async()=>authenticated,readAccountPerformance:async()=>available(zeroDaily)});
  const zeroPoints=zero.document.querySelectorAll(".account-trend-point"),zeroLine=zero.document.querySelector(".account-trend-line");
  assert.equal(zeroPoints.length,3);assert.equal(new Set(zeroPoints.map(point=>point.getAttribute("cy"))).size,1);assert.equal(zeroPoints[0].getAttribute("cy"),zero.document.querySelector(".account-trend-x-axis").getAttribute("y1"));assert.deepEqual(zero.document.querySelectorAll(".account-trend-tick-label").map(label=>label.textContent),["0","1"]);assert.equal(/NaN|Infinity|-\d/.test(zeroLine.getAttribute("points")),false);
  zero.document.querySelector('[data-account-trend-metric="saves"]').pressKey("Enter");assert.equal(zero.callCount("readAccountPerformance"),1);assert.equal(zero.document.querySelectorAll(".account-trend-point").length,3);

  const one=await openAndRead({connectionStatus:async()=>authenticated,readAccountPerformance:async()=>available([{date:"2026-07-24",impressions:100,saves:null,pinClicks:null,outboundClicks:null}])});
  assert.equal(one.document.querySelectorAll(".account-trend-point").length,1);assert.equal(one.document.querySelectorAll(".account-trend-line").length,0);assert.match(one.document.querySelector(".account-trend-chart").getAttribute("aria-label"),/with 1 usable daily values\.$/);

  const missingDaily=[{date:"2026-07-24",impressions:null,saves:20,pinClicks:null,outboundClicks:null},{date:"2026-07-25",impressions:null,saves:100,pinClicks:null,outboundClicks:null}];
  const missing=await openAndRead({connectionStatus:async()=>authenticated,readAccountPerformance:async()=>available(missingDaily)});
  assert.equal(missing.document.querySelector(".account-trend-chart"),undefined);assert.equal(missing.hasText("No usable daily values"),true);
  missing.document.querySelector('[data-account-trend-metric="saves"]').pressKey(" ");assert.equal(missing.document.querySelectorAll(".account-trend-point").length,2);assert.equal(missing.callCount("readAccountPerformance"),1);

  const noData=await openAndRead({connectionStatus:async()=>authenticated,readAccountPerformance:async()=>({ok:true,state:"NoData",window,latestAvailableDate:null,totals:null,daily:[],stale:false})});
  assert.equal(noData.hasText("No organic account metrics were available for this date window."),true);assert.equal(noData.document.querySelector(".account-performance-trend"),undefined);assert.equal(noData.document.querySelector(".account-comparison"),undefined);

  const clearing=await openAndRead({connectionStatus:sequence(authenticated,{ok:true,state:"ReauthorizationRequired"}),readAccountPerformance:async()=>available(zeroDaily)});
  assert.notEqual(clearing.document.querySelector(".account-trend-chart"),undefined);assert.notEqual(clearing.document.querySelector(".account-comparison"),undefined);await clearing.clickAction("refresh");assert.equal(clearing.document.querySelector(".account-performance-trend"),undefined);assert.equal(clearing.document.querySelector(".account-comparison"),undefined);assert.equal(clearing.hasText("Reauthorization required"),true);assert.equal(clearing.callCount("readAccountPerformance"),1);
});

test("observed 15-day account comparison is canonical, complete per metric, overflow-safe, and request-isolated",async()=>{
  const window={startDate:"2026-07-24",endDate:"2026-08-22",completedDays:30},dates=Array.from({length:30},(_,index)=>new Date(Date.UTC(2026,6,24+index)).toISOString().slice(0,10)),daily=dates.map((date,index)=>({date,impressions:index<15?10:20,saves:5,pinClicks:index<15?10:5,outboundClicks:0,providerPayload:"comparison-secret",pinId:`raw-${index}`,boardName:"private",url:"https://provider.invalid/private"})),available=rows=>({ok:true,state:"Available",window,latestAvailableDate:"2026-08-22",totals:null,daily:rows,stale:false}),open=async rows=>{const h=await createPinterestDomHarness(preloadFor({connectionStatus:async()=>authenticated,readAccountPerformance:async()=>available(rows),readObservation:async()=>({ok:true,state:"Completed",pins:[{pinId:"top-hidden",title:"Safe Pin",boardName:"Board",thumbnail:null}]}),readTopPins:async()=>({ok:true,state:"Available",window,sortBy:"OUTBOUND_CLICK",pins:[{pinId:"top-hidden",impressions:10,saves:1,pinClicks:2,outboundClicks:3}],stale:false})})).start();h.document.querySelector('[data-pin-view="performance"]').click();await h.settle();await h.clickAction("account-performance");return h},comparisonRows=h=>h.document.querySelector(".account-comparison-table").children[1].children;
  const complete=await open(daily),table=complete.document.querySelector(".account-comparison-table"),rows=comparisonRows(complete),snapshot=rows.map(row=>row.children.map(cell=>cell.textContent));assert.equal(complete.hasText("Observed 15-day comparison"),true);assert.equal(complete.hasText("Latest 15 completed UTC days compared with the previous 15 completed UTC days. Descriptive totals only; no prediction or causal attribution."),true);assert.equal(complete.hasText("Previous: 24.07.26 – 07.08.26 · Latest: 08.08.26 – 22.08.26"),true);assert.deepEqual(table.children[0].children[0].children.map(cell=>cell.textContent),["Metric","Previous 15 days","Latest 15 days","Absolute change","Percentage change"]);assert.deepEqual(snapshot,[["Impressions","150","300","+150","+100.00%"],["Saves","75","75","0","0.00%"],["Pin clicks","150","75","−75","−50.00%"],["Outbound clicks","0","0","0","0.00%"]]);assert.equal(table.children[0].children[0].children.every(cell=>cell.getAttribute("scope")==="col"),true);assert.equal(rows.every(row=>row.children[0].getAttribute("scope")==="row"),true);assert.equal(complete.callCount("readAccountPerformance"),1);
  complete.document.querySelector('[data-account-trend-metric="saves"]').pressKey(" ");complete.document.querySelector('[data-account-sort="impressions"]').pressKey("Enter");assert.deepEqual(comparisonRows(complete).map(row=>row.children.map(cell=>cell.textContent)),snapshot);assert.equal(complete.callCount("readAccountPerformance"),1);await complete.clickAction("observe");await complete.clickAction("top-pins");assert.deepEqual(comparisonRows(complete).map(row=>row.children.map(cell=>cell.textContent)),snapshot);assert.equal(complete.callCount("readAccountPerformance"),1);assert.equal(complete.callCount("readTopPins"),1);for(const forbidden of ["comparison-secret","raw-0","private","provider.invalid","top-hidden"])assert.equal(complete.hasText(forbidden),false);
  const zeroBase=daily.map((item,index)=>({...item,outboundClicks:index<15?0:2})),zeroBaseRows=comparisonRows(await open(zeroBase));assert.deepEqual(zeroBaseRows[3].children.map(cell=>cell.textContent),["Outbound clicks","0","30","+30","—"]);
  const nullMetric=daily.map((item,index)=>index===4?{...item,saves:null}:item),isolated=comparisonRows(await open(nullMetric));assert.deepEqual(isolated[1].children.map(cell=>cell.textContent),["Saves","—","—","—","—"]);assert.deepEqual(isolated[0].children.map(cell=>cell.textContent),["Impressions","150","300","+150","+100.00%"]);
  for(const broken of [daily.slice(0,29),daily.map((item,index)=>index===29?{...item,date:daily[0].date}:item),daily.map((item,index)=>index===29?{...item,date:"2026-02-30"}:item)]){const brokenRows=comparisonRows(await open(broken));assert.equal(brokenRows.every(row=>row.children.slice(1).every(cell=>cell.textContent==="—")),true)}
  const overflow=daily.map((item,index)=>({...item,impressions:index<2?Number.MAX_SAFE_INTEGER:0})),overflowRows=comparisonRows(await open(overflow));assert.deepEqual(overflowRows[0].children.map(cell=>cell.textContent),["Impressions","—","—","—","—"]);assert.deepEqual(overflowRows[1].children.map(cell=>cell.textContent),["Saves","75","75","0","0.00%"]);assert.equal(JSON.stringify(daily).includes("comparison-secret"),true);
});

test("observed 15-day account rates use unrounded period totals and fail closed independently",async()=>{
  const window={startDate:"2026-07-24",endDate:"2026-08-22",completedDays:30},dates=Array.from({length:30},(_,index)=>new Date(Date.UTC(2026,6,24+index)).toISOString().slice(0,10)),periodTotals=[{impressions:3624,saves:19,pinClicks:244,outboundClicks:12},{impressions:4816,saves:15,pinClicks:241,outboundClicks:20}],fixture=dates.map((date,index)=>({date,impressions:index===0?periodTotals[0].impressions:index===15?periodTotals[1].impressions:0,saves:index===0?periodTotals[0].saves:index===15?periodTotals[1].saves:0,pinClicks:index===0?periodTotals[0].pinClicks:index===15?periodTotals[1].pinClicks:0,outboundClicks:index===0?periodTotals[0].outboundClicks:index===15?periodTotals[1].outboundClicks:0,providerPayload:"rate-secret",pinId:`private-${index}`,boardName:"private-board",url:"https://provider.invalid/private"})),available=(rows,totals={impressions:8440,saves:34,pinClicks:485,outboundClicks:32})=>({ok:true,state:"Available",window,latestAvailableDate:"2026-08-22",totals,daily:rows,stale:false}),updated=fixture.map((item,index)=>index===15?{...item,saves:16}:item),retained={...available(fixture),state:"Failed",stale:true};
  const pins=[{pinId:"top-secret-id",title:"Safe",boardName:"Board",thumbnail:null}],top={ok:true,state:"Available",window,sortBy:"OUTBOUND_CLICK",pins:[{pinId:"top-secret-id",impressions:100,saves:1,pinClicks:2,outboundClicks:3}],stale:false},harness=await createPinterestDomHarness(preloadFor({connectionStatus:sequence(authenticated,{ok:true,state:"ReauthorizationRequired"}),readObservation:async()=>({ok:true,state:"Completed",pins}),readAccountPerformance:sequence(available(fixture),retained,available(updated)),readTopPins:async()=>top})).start(),rateRows=target=>target.document.querySelector(".account-rate-comparison-table").children[1].children,rateSnapshot=target=>rateRows(target).map(row=>row.children.map(cell=>cell.textContent)),counts=()=>["readAccountPerformance","readTopPins","readPerformance","readObservation"].map(name=>harness.callCount(name));
  assert.deepEqual(counts(),[0,0,0,0]);harness.document.querySelector('[data-pin-view="performance"]').click();await harness.settle();assert.equal(harness.document.querySelector(".account-rate-comparison"),undefined);assert.deepEqual(counts(),[0,0,0,0]);await harness.clickAction("account-performance");const table=harness.document.querySelector(".account-rate-comparison-table"),snapshot=rateSnapshot(harness);assert.equal(harness.hasText("Observed 15-day rate comparison"),true);assert.equal(harness.hasText("Observed interaction rates calculated from organic account totals. Descriptive comparison only; not prediction or causal attribution."),true);assert.equal(harness.hasText("Previous: 24.07.26 – 07.08.26 · Latest: 08.08.26 – 22.08.26"),true);assert.deepEqual(table.children[0].children[0].children.map(cell=>cell.textContent),["Metric","Previous 15 days","Latest 15 days","Change"]);assert.deepEqual(snapshot,[["Save rate","0.52%","0.31%","−0.21 pp"],["Pin click rate","6.73%","5.00%","−1.73 pp"],["Outbound click rate","0.33%","0.42%","+0.08 pp"]]);assert.equal(table.children[0].children[0].children.every(cell=>cell.getAttribute("scope")==="col"),true);assert.equal(rateRows(harness).every(row=>row.children[0].getAttribute("scope")==="row"),true);assert.deepEqual(counts(),[1,0,0,0]);
  harness.document.querySelector('[data-account-trend-metric="saves"]').click();harness.document.querySelector('[data-account-sort="impressions"]').click();assert.deepEqual(rateSnapshot(harness),snapshot);assert.deepEqual(counts(),[1,0,0,0]);harness.document.querySelector('[data-pin-view="all"]').click();harness.document.querySelector('[data-pin-view="performance"]').click();await harness.settle();assert.deepEqual(rateSnapshot(harness),snapshot);assert.deepEqual(counts(),[1,0,0,0]);await harness.clickAction("observe");await harness.clickAction("top-pins");const beforeLocal=counts();harness.document.querySelector('[data-top-pins-metric="saves"]').click();harness.document.querySelector('[data-top-pins-sort="impressions"]').click();assert.deepEqual(rateSnapshot(harness),snapshot);assert.deepEqual(counts(),beforeLocal);assert.deepEqual(beforeLocal,[1,1,0,1]);
  await harness.clickAction("account-performance");assert.deepEqual(rateSnapshot(harness),snapshot);assert.equal(harness.hasText("last valid account analytics snapshot remains visible as stale data"),true);await harness.clickAction("account-performance");assert.deepEqual(rateRows(harness)[0].children.map(cell=>cell.textContent),["Save rate","0.52%","0.33%","−0.19 pp"]);assert.deepEqual(counts(),[3,1,0,1]);for(const forbidden of ["rate-secret","private-0","private-board","provider.invalid","top-secret-id"])assert.equal(harness.hasText(forbidden),false);await harness.clickAction("refresh");assert.equal(harness.document.querySelector(".account-rate-comparison"),undefined);assert.equal(harness.document.querySelector(".account-comparison"),undefined);

  const open=async rows=>{const local=await createPinterestDomHarness(preloadFor({connectionStatus:async()=>authenticated,readAccountPerformance:async()=>available(rows)})).start();local.document.querySelector('[data-pin-view="performance"]').click();await local.clickAction("account-performance");return local},rowsOf=target=>target.document.querySelector(".account-rate-comparison-table").children[1].children,base=dates.map(date=>({date,impressions:1,saves:1,pinClicks:1,outboundClicks:1}));
  const zeroNumerator=await open(base.map(item=>({...item,saves:0})));assert.deepEqual(rowsOf(zeroNumerator)[0].children.map(cell=>cell.textContent),["Save rate","0.00%","0.00%","0.00 pp"]);const zeroDenominator=await open(base.map((item,index)=>({...item,impressions:index<15?0:1,saves:0})));assert.deepEqual(rowsOf(zeroDenominator)[0].children.map(cell=>cell.textContent),["Save rate","—","0.00%","—"]);const uncapped=await open(base.map(item=>({...item,saves:2})));assert.deepEqual(rowsOf(uncapped)[0].children.map(cell=>cell.textContent),["Save rate","200.00%","200.00%","0.00 pp"]);
  const unrounded=base.map((item,index)=>({...item,impressions:index===0?300:index===15?299:0,saves:index===0||index===15?1:0})),unroundedRows=rowsOf(await open(unrounded));assert.deepEqual(unroundedRows[0].children.map(cell=>cell.textContent),["Save rate","0.33%","0.33%","+0.00 pp"]);
  for(const invalid of [null,undefined,"1",1.5,-1,Infinity,Number.MAX_SAFE_INTEGER+1]){const malformed=base.map((item,index)=>index===0?{...item,saves:invalid}:item),rows=rowsOf(await open(malformed));assert.deepEqual(rows[0].children.map(cell=>cell.textContent),["Save rate","—","100.00%","—"]);assert.deepEqual(rows[1].children.map(cell=>cell.textContent),["Pin click rate","100.00%","100.00%","0.00 pp"])}
  const overflow=base.map((item,index)=>({...item,impressions:index<2?Number.MAX_SAFE_INTEGER:1})),overflowRows=rowsOf(await open(overflow));assert.equal(overflowRows.every(row=>row.children[1].textContent==="—"&&row.children[3].textContent==="—"),true);const numeratorOverflow=base.map((item,index)=>({...item,saves:index<2?Number.MAX_SAFE_INTEGER:1})),numeratorOverflowRows=rowsOf(await open(numeratorOverflow));assert.equal(numeratorOverflowRows[0].children[1].textContent,"—");assert.equal(numeratorOverflowRows[1].children[1].textContent,"100.00%");
  for(const broken of [base.map((item,index)=>index===29?{...item,date:base[0].date}:item),base.map((item,index)=>index===29?{...item,date:"2026-02-30"}:item),base.map((item,index)=>index===29?{...item,date:"2026-08-23"}:item)]){const rows=rowsOf(await open(broken));assert.equal(rows.every(row=>row.children[2].textContent==="—"&&row.children[3].textContent==="—"),true)}const incompletePrevious=rowsOf(await open(base.slice(1)));assert.equal(incompletePrevious.every(row=>row.children[1].textContent==="—"&&row.children[2].textContent==="100.00%"&&row.children[3].textContent==="—"),true);const incompleteLatest=rowsOf(await open(base.slice(0,29)));assert.equal(incompleteLatest.every(row=>row.children[1].textContent==="100.00%"&&row.children[2].textContent==="—"&&row.children[3].textContent==="—"),true);const reversed=await open(base.slice().reverse());assert.deepEqual(rowsOf(reversed).map(row=>row.children.map(cell=>cell.textContent)),[["Save rate","100.00%","100.00%","0.00 pp"],["Pin click rate","100.00%","100.00%","0.00 pp"],["Outbound click rate","100.00%","100.00%","0.00 pp"]]);
});

test("organic performance is explicit, snapshot-bound, null-safe, and provider text stays inert",async()=>{
  const pin={pinId:"pin-1",title:'<img src=x onerror="steal()">',boardName:"Board",thumbnail:null};
  const availablePerformance={ok:true,state:"Available",window:{startDate:"2026-07-24",endDate:"2026-08-22",completedDays:30},totals:{impressions:0,saves:2,pinClicks:null,outboundClicks:1},pins:[{pinId:"pin-1",impressions:0,saves:2,pinClicks:null,outboundClicks:1,providerPayload:"must-not-render"},{pinId:"unknown",impressions:999,saves:999,pinClicks:999,outboundClicks:999}],rawProvider:"secret"};
  const retained={...availablePerformance,state:"Failed"};
  const harness=await createPinterestDomHarness(preloadFor({connectionStatus:async()=>authenticated,readObservation:async()=>({ok:true,state:"Completed",pins:[pin]}),readPerformance:sequence(availablePerformance,retained)})).start();
  assert.equal(harness.callCount("readPerformance"),0);
  harness.document.querySelector('[data-pin-view="performance"]').click();await harness.settle();
  assert.equal(harness.callCount("readPerformance"),0);assert.equal(harness.hasText("Read Pins first"),true);
  await harness.clickAction("refresh");await harness.clickAction("verify");assert.equal(harness.callCount("readPerformance"),0);
  await harness.clickAction("observe");assert.equal(harness.callCount("readPerformance"),0);
  harness.document.querySelector('[data-pin-view="all"]').click();harness.document.querySelector('[data-pin-view="performance"]').click();await harness.settle();assert.equal(harness.callCount("readPerformance"),0);
  await harness.clickAction("performance");assert.equal(harness.callCount("readPerformance"),1);
  assert.equal(harness.hasText("Per-Pin metrics · Beta · Read-only"),true);assert.equal(harness.hasText("2026-07-24 to 2026-08-22 · 30 completed UTC days"),true);
  assert.equal(harness.hasText("Impressions0Saves2Pin clicksUnavailableOutbound clicks1"),true);assert.equal(harness.hasText("must-not-render"),false);assert.equal(harness.hasText("secret"),false);assert.equal(harness.hasText("999"),false);
  await harness.clickAction("performance");assert.equal(harness.callCount("readPerformance"),2);assert.equal(harness.hasText("last valid analytics snapshot remains visible"),true);
  assert.equal(harness.document.querySelectorAll("a").length,0);
});

test("analytics authorization denial is shown as capability unavailable without reconnect language",async()=>{
  for(const status of ["Unavailable401","Unavailable403"]){
    const harness=await createPinterestDomHarness(preloadFor({connectionStatus:async()=>authenticated,readObservation:async()=>({ok:true,state:"Completed",pins:[{pinId:"pin-1",title:"Pin",boardName:"Board",thumbnail:null}]}),readPerformance:async()=>({ok:true,state:"Unavailable",window:null,totals:null,pins:[],status})})).start();
    await harness.clickAction("observe");
    harness.document.querySelector('[data-pin-view="performance"]').click();
    await harness.clickAction("performance");
    assert.equal(harness.hasText("Organic Pin analytics is unavailable for this Pinterest application."),true);
    for(const forbidden of ["Reauthorize Pinterest","Pinterest disconnected","Connect Pinterest again"])assert.equal(harness.hasText(forbidden),false);
  }
});

test("Top Pins comparison and table sorting are local, stable, accessible, immutable, and raw-ID safe",async()=>{
  const pins=[{pinId:"secret-1",title:"Zulu",boardName:"Board B",thumbnail:null},{pinId:"secret-2",title:"alpha",boardName:"Board A",thumbnail:null},{pinId:"secret-3",title:"Alpha",boardName:"Board A",thumbnail:null},{pinId:"secret-4",title:"Missing",boardName:"Board C",thumbnail:null}];
  const topPins=[{pinId:"secret-1",impressions:0,saves:4,pinClicks:2,outboundClicks:3},{pinId:"secret-2",impressions:10,saves:4,pinClicks:0,outboundClicks:8},{pinId:"secret-3",impressions:5,saves:1,pinClicks:2,outboundClicks:8},{pinId:"secret-4",impressions:null,saves:null,pinClicks:null,outboundClicks:null}],original=JSON.stringify(topPins),top={ok:true,state:"Available",window:{startDate:"2026-07-24",endDate:"2026-08-22",completedDays:30},sortBy:"OUTBOUND_CLICK",pins:topPins,stale:false};
  const harness=await createPinterestDomHarness(preloadFor({connectionStatus:async()=>authenticated,readObservation:sequence({ok:true,state:"Completed",pins},{ok:true,state:"CompletedWithWarnings",pins}),readTopPins:sequence(top,{...top,state:"Failed",stale:true})})).start();
  await harness.clickAction("refresh");await harness.clickAction("verify");await harness.clickAction("observe");harness.document.querySelector('[data-pin-view="performance"]').click();await harness.settle();await harness.clickAction("top-pins");
  const requestCounts=()=>["readTopPins","readAccountPerformance","readPerformance","readObservation"].map(name=>harness.callCount(name)),selectors=()=>harness.document.querySelectorAll(".top-pins-selector"),chart=()=>harness.document.querySelector(".top-pins-chart"),bars=()=>harness.document.querySelectorAll(".top-pins-bar"),valueLabels=()=>harness.document.querySelectorAll(".top-pins-value-label"),rankLabels=()=>harness.document.querySelectorAll(".top-pins-rank-label"),table=harness.document.querySelector(".top-pins-table"),rows=()=>table.children[1].children,headers=()=>table.children[0].children[0].children,button=key=>harness.document.querySelector(`[data-top-pins-sort="${key}"]`);
  assert.deepEqual(selectors().map(item=>item.textContent),["Impressions","Saves","Pin clicks","Outbound clicks","Save rate","Pin click rate","Outbound click rate"]);assert.deepEqual(selectors().map(item=>item.getAttribute("aria-pressed")),["false","false","false","true","false","false","false"]);assert.equal(chart().getAttribute("viewBox"),"0 0 640 300");assert.equal(chart().getAttribute("width"),"640");assert.equal(chart().getAttribute("height"),"300");assert.equal(chart().getAttribute("role"),"img");assert.equal(chart().getAttribute("aria-label"),"Outbound clicks Top Pins comparison from 24.07.26 to 22.08.26 with 3 usable values.");assert.equal(harness.document.querySelector(".top-pins-x-label").textContent,"Pin rank");assert.equal(harness.document.querySelector(".top-pins-y-label").textContent,"Outbound clicks");assert.deepEqual(harness.document.querySelectorAll(".top-pins-tick-label").map(label=>label.textContent),["0","2","4","6","8","10"]);assert.notEqual(harness.document.querySelector(".top-pins-x-axis"),undefined);assert.notEqual(harness.document.querySelector(".top-pins-y-axis"),undefined);assert.deepEqual(bars().map(bar=>bar.getAttribute("aria-label")),["Rank 2: Outbound clicks: 8","Rank 3: Outbound clicks: 8","Rank 1: Outbound clicks: 3","Rank 4: Outbound clicks: —"]);assert.deepEqual(valueLabels().map(label=>label.textContent),["8","8","3","—"]);assert.deepEqual(rankLabels().map(label=>label.textContent),["#2","#3","#1","#4"]);assert.equal(Number(bars()[0].getAttribute("height"))>Number(bars()[2].getAttribute("height")),true);assert.equal(bars()[3].getAttribute("height"),"0");assert.equal(bars()[3].getAttribute("y"),"242");assert.equal(valueLabels()[3].getAttribute("y"),"236");
  assert.deepEqual(rows().map(row=>row.children[1].textContent),["Zulu","alpha","Alpha","Missing"]);assert.deepEqual(rows().map(row=>row.children.slice(7).map(cell=>cell.textContent)),[["—","—","—"],["40.00%","0.00%","80.00%"],["20.00%","40.00%","160.00%"],["—","—","—"]]);assert.deepEqual(headers().map(cell=>cell.getAttribute("aria-sort")),["ascending",...Array(9).fill("none")]);assert.equal(headers()[0].textContent,"Rank▲");assert.equal(harness.hasText("Observed rates"),true);assert.equal(harness.hasText("Descriptive event ratios for the selected 30-day window. They are not predictions, conversion attribution, or causal analysis."),true);const before=requestCounts();
  for(const selector of selectors()){selector.pressKey(selector===selectors()[0]?"Enter":" ");assert.equal(selectors().filter(item=>item.getAttribute("aria-pressed")==="true").length,1)}assert.deepEqual(requestCounts(),before);assert.deepEqual(rows().map(row=>row.children[1].textContent),["Zulu","alpha","Alpha","Missing"]);const selectMetric=key=>harness.document.querySelector(`[data-top-pins-metric="${key}"]`);selectMetric("saveRate").click();assert.deepEqual(valueLabels().map(label=>label.textContent),["40.00%","20.00%","—","—"]);assert.deepEqual(rankLabels().map(label=>label.textContent),["#2","#3","#1","#4"]);selectMetric("pinClickRate").click();assert.deepEqual(valueLabels().map(label=>label.textContent),["40.00%","0.00%","—","—"]);selectMetric("outboundClickRate").click();assert.deepEqual(requestCounts(),before);
  assert.equal(chart().getAttribute("aria-label"),"Outbound click rate Top Pins comparison from 24.07.26 to 22.08.26 with 2 usable values in percent.");assert.equal(harness.document.querySelector(".top-pins-y-label").textContent,"Outbound click rate (%)");assert.deepEqual(harness.document.querySelectorAll(".top-pins-tick-label").map(label=>label.textContent),["0.00%","50.00%","100.00%","150.00%","200.00%"]);assert.deepEqual(valueLabels().map(label=>label.textContent),["160.00%","80.00%","—","—"]);assert.deepEqual(rankLabels().map(label=>label.textContent),["#3","#2","#1","#4"]);const chartOrder=bars().map(bar=>bar.getAttribute("aria-label"));for(const [key,firstDirection] of [["rank","descending"],["title","ascending"],["boardName","ascending"],["impressions","descending"],["saves","descending"],["pinClicks","descending"],["outboundClicks","descending"],["saveRate","descending"],["pinClickRate","descending"],["outboundClickRate","descending"]]){button(key).pressKey(key==="rank"?"Enter":" ");const active=headers().find(cell=>cell.children[0].dataset.topPinsSort===key);assert.equal(active.getAttribute("aria-sort"),firstDirection);assert.equal(/[▲▼]$/.test(active.textContent),true);assert.equal(headers().filter(cell=>cell.getAttribute("aria-sort")!=="none").length,1);if(!["rank","title","boardName"].includes(key))assert.equal(rows().at(-1).children[1].textContent,"Missing");button(key).click();if(!["rank","title","boardName"].includes(key))assert.equal(rows().at(-1).children[1].textContent,"Missing")}
  assert.deepEqual(bars().map(bar=>bar.getAttribute("aria-label")),chartOrder);assert.deepEqual(requestCounts(),before);assert.equal(JSON.stringify(topPins),original);for(const id of ["secret-1","secret-2","secret-3","secret-4"])assert.equal(harness.hasText(id),false);assert.equal(harness.document.querySelectorAll("a").length,0);
  await harness.clickAction("observe");assert.deepEqual(requestCounts(),[1,0,0,2]);assert.notEqual(harness.document.querySelector(".top-pins-chart"),undefined);await harness.clickAction("top-pins");assert.equal(harness.hasText("last valid result remains visible as stale data"),true);assert.notEqual(harness.document.querySelector(".top-pins-chart"),undefined);
});

test("Top Pins rate charts use only valid same-period retained account references",async()=>{
  const window={startDate:"2026-07-24",endDate:"2026-08-22",completedDays:30},daily=Array.from({length:30},(_,index)=>({date:new Date(Date.UTC(2026,6,24+index)).toISOString().slice(0,10),impressions:0,saves:0,pinClicks:0,outboundClicks:0})),pins=[{pinId:"private-1",title:"One",boardName:"Board",thumbnail:null},{pinId:"private-2",title:"Two",boardName:"Board",thumbnail:null},{pinId:"private-3",title:"Null",boardName:"Board",thumbnail:null}],metrics=[{pinId:"private-1",impressions:100,saves:1,pinClicks:2,outboundClicks:3},{pinId:"private-2",impressions:100,saves:3,pinClicks:7,outboundClicks:9},{pinId:"private-3",impressions:null,saves:null,pinClicks:null,outboundClicks:null}],account={ok:true,state:"Available",window,latestAvailableDate:window.endDate,totals:{impressions:8440,saves:34,pinClicks:485,outboundClicks:32},daily,stale:false,providerPayload:"account-private",oauthToken:"oauth-private"},top={ok:true,state:"Available",window,sortBy:"OUTBOUND_CLICK",pins:metrics.map(item=>({...item,providerPayload:"top-private",url:"https://provider.invalid/private"})),stale:false};
  const harness=await createPinterestDomHarness(preloadFor({connectionStatus:async()=>authenticated,verifyConnection:async()=>({ok:true,state:"ReauthorizationRequired"}),readObservation:async()=>({ok:true,state:"Completed",pins}),readAccountPerformance:async()=>account,readTopPins:async()=>top,readPerformance:async()=>({ok:true,state:"Available",window,totals:{impressions:200,saves:4,pinClicks:9,outboundClicks:12},pins:metrics,stale:false})})).start(),counts=()=>["readAccountPerformance","readTopPins","readPerformance","readObservation"].map(name=>harness.callCount(name)),select=key=>harness.document.querySelector(`[data-top-pins-metric="${key}"]`).click(),referenceLine=()=>harness.document.querySelector(".top-pins-account-reference-line"),referenceLabel=()=>harness.document.querySelector(".top-pins-account-reference-label"),chart=()=>harness.document.querySelector(".top-pins-chart"),chartOrder=()=>harness.document.querySelectorAll(".top-pins-rank-label").map(item=>item.textContent),tableOrder=()=>harness.document.querySelector(".top-pins-table").children[1].children.map(row=>row.children[1].textContent);
  assert.deepEqual(counts(),[0,0,0,0]);harness.document.querySelector('[data-pin-view="performance"]').click();await harness.settle();assert.deepEqual(counts(),[0,0,0,0]);await harness.clickAction("observe");await harness.clickAction("account-performance");assert.deepEqual(counts(),[1,0,0,1]);assert.equal(referenceLine(),undefined);await harness.clickAction("top-pins");assert.deepEqual(counts(),[1,1,0,1]);assert.equal(referenceLine(),undefined);for(const key of ["impressions","saves","pinClicks","outboundClicks"]){select(key);assert.equal(referenceLine(),undefined);assert.equal(harness.hasText("Same-period account rate unavailable."),false);assert.equal(harness.hasText("Same-period organic account rate shown for descriptive context only; it is not a target."),false)}
  const expected={saveRate:account.totals.saves/account.totals.impressions*100,pinClickRate:account.totals.pinClicks/account.totals.impressions*100,outboundClickRate:account.totals.outboundClicks/account.totals.impressions*100};for(const [key,value] of Object.entries(expected)){const before=counts();select(key);const formatted=`${value.toFixed(2)}%`,line=referenceLine(),label=referenceLabel(),svg=chart();assert.notEqual(line,undefined);assert.equal(label.textContent,`Account 30-day rate: ${formatted}`);assert.equal(harness.hasText(`Account 30-day rate: ${formatted}`),true);assert.equal(harness.hasText("Same-period organic account rate shown for descriptive context only; it is not a target."),true);assert.match(svg.getAttribute("aria-label"),new RegExp(`^${key==="saveRate"?"Save rate":key==="pinClickRate"?"Pin click rate":"Outbound click rate"} Top Pins comparison from 24\\.07\\.26 to 22\\.08\\.26 with 2 usable values in percent\\. Account 30-day rate: ${formatted.replace(".","\\.")}\\.$`));assert.equal(Number(line.getAttribute("y1")),Number(line.getAttribute("y2")));assert.equal(Number(line.getAttribute("y1"))>=30&&Number(line.getAttribute("y1"))<=242,true);assert.equal(Number(label.getAttribute("x"))>=0&&Number(label.getAttribute("x"))<=640,true);assert.equal(Number(label.getAttribute("y"))>=0&&Number(label.getAttribute("y"))<=300,true);assert.deepEqual(counts(),before)}
  const fixedChartOrder=chartOrder(),fixedTableOrder=tableOrder(),beforeLocal=counts();harness.document.querySelector('[data-top-pins-sort="outboundClicks"]').click();harness.document.querySelector('[data-account-sort="impressions"]').click();for(const key of ["saveRate","pinClickRate","outboundClickRate","saveRate"])select(key);assert.deepEqual(chartOrder(),fixedChartOrder);assert.notDeepEqual(tableOrder(),fixedTableOrder);assert.deepEqual(counts(),beforeLocal);await harness.clickAction("performance");assert.deepEqual(counts(),[1,1,1,1]);select("saveRate");assert.notEqual(referenceLine(),undefined);for(const forbidden of ["private-1","private-2","private-3","account-private","top-private","oauth-private","provider.invalid"])assert.equal(harness.hasText(forbidden),false);await harness.clickAction("verify");assert.equal(referenceLine(),undefined);assert.equal(harness.document.querySelector(".top-pins-chart"),undefined);

  const open=async({totals={impressions:100,saves:2,pinClicks:2,outboundClicks:2},accountWindow=window,topWindow=window,values=[{impressions:100,saves:1,pinClicks:1,outboundClicks:1},{impressions:100,saves:3,pinClicks:3,outboundClicks:3}],accountState="Available",topState="Available",accountStale=false,topStale=false,readTopFirst=false}={})=>{const localPins=values.map((_,index)=>({pinId:`hidden-${index}`,title:`Safe ${index}`,boardName:"Board",thumbnail:null})),localAccount={ok:true,state:accountState,window:accountWindow,latestAvailableDate:accountWindow?.endDate??null,totals,daily:[],stale:accountStale},localTop={ok:true,state:topState,window:topWindow,sortBy:"OUTBOUND_CLICK",pins:values.map((value,index)=>({pinId:`hidden-${index}`,...value})),stale:topStale},local=await createPinterestDomHarness(preloadFor({connectionStatus:async()=>authenticated,readObservation:async()=>({ok:true,state:"Completed",pins:localPins}),readAccountPerformance:async()=>localAccount,readTopPins:async()=>localTop})).start();await local.clickAction("observe");local.document.querySelector('[data-pin-view="performance"]').click();if(readTopFirst){await local.clickAction("top-pins");local.document.querySelector('[data-top-pins-metric="saveRate"]').click();assert.equal(local.hasText("Same-period account rate unavailable."),true);await local.clickAction("account-performance")}else{await local.clickAction("account-performance");await local.clickAction("top-pins")}local.document.querySelector('[data-top-pins-metric="saveRate"]').click();return local},lineOf=local=>local.document.querySelector(".top-pins-account-reference-line"),labelOf=local=>local.document.querySelector(".top-pins-account-reference-label"),ticks=local=>local.document.querySelectorAll(".top-pins-tick-label").map(item=>Number(item.textContent.replace("%","")));
  const topFirst=await open({readTopFirst:true});assert.equal(labelOf(topFirst).textContent,"Account 30-day rate: 2.00%");assert.deepEqual([topFirst.callCount("readAccountPerformance"),topFirst.callCount("readTopPins")],[1,1]);const zero=await open({totals:{impressions:100,saves:0,pinClicks:0,outboundClicks:0},values:[{impressions:100,saves:0,pinClicks:0,outboundClicks:0}]});assert.equal(labelOf(zero).textContent,"Account 30-day rate: 0.00%");assert.equal(lineOf(zero).getAttribute("y1"),"242");const uncapped=await open({totals:{impressions:10,saves:20,pinClicks:20,outboundClicks:20}});assert.equal(labelOf(uncapped).textContent,"Account 30-day rate: 200.00%");assert.equal(ticks(uncapped).at(-1)>200,true);assert.equal(Number(lineOf(uncapped).getAttribute("y1"))>30,true);
  for(const [key,totals] of [["zero denominator",{impressions:0,saves:0,pinClicks:1,outboundClicks:1}],["missing numerator",{impressions:100,pinClicks:1,outboundClicks:1}],["string numerator",{impressions:100,saves:"1",pinClicks:1,outboundClicks:1}],["fractional numerator",{impressions:100,saves:1.5,pinClicks:1,outboundClicks:1}],["negative numerator",{impressions:100,saves:-1,pinClicks:1,outboundClicks:1}],["non-finite numerator",{impressions:100,saves:Infinity,pinClicks:1,outboundClicks:1}],["unsafe numerator",{impressions:100,saves:Number.MAX_SAFE_INTEGER+1,pinClicks:1,outboundClicks:1}],["null impressions",{impressions:null,saves:1,pinClicks:1,outboundClicks:1}],["string impressions",{impressions:"100",saves:1,pinClicks:1,outboundClicks:1}],["fractional impressions",{impressions:100.5,saves:1,pinClicks:1,outboundClicks:1}],["negative impressions",{impressions:-100,saves:1,pinClicks:1,outboundClicks:1}],["non-finite impressions",{impressions:Infinity,saves:1,pinClicks:1,outboundClicks:1}],["unsafe impressions",{impressions:Number.MAX_SAFE_INTEGER+1,saves:1,pinClicks:1,outboundClicks:1}]]){const invalid=await open({totals});assert.equal(lineOf(invalid),undefined,key);assert.equal(invalid.hasText("Same-period account rate unavailable."),true,key)}
  for(const [key,accountWindow,topWindow] of [["start",{startDate:"2026-07-23",endDate:"2026-08-21",completedDays:30},window],["end",{startDate:"2026-07-25",endDate:"2026-08-23",completedDays:30},window],["days",{...window,completedDays:29},window],["malformed",{...window,startDate:"2026-02-30"},window]]){const mismatch=await open({accountWindow,topWindow});assert.equal(lineOf(mismatch),undefined,key);assert.equal(mismatch.hasText("Same-period account rate unavailable."),true,key);assert.deepEqual([mismatch.callCount("readAccountPerformance"),mismatch.callCount("readTopPins")],[1,1],key)}
  const positioned=async(saves,impressions=100)=>open({totals:{impressions,saves,pinClicks:saves,outboundClicks:saves}}),below=await positioned(1,200),between=await positioned(2),above=await positioned(10);for(const local of [below,between,above])assert.equal(Number(lineOf(local).getAttribute("y1"))>30,true);const barYs=local=>local.document.querySelectorAll(".top-pins-bar").slice(0,2).map(bar=>Number(bar.getAttribute("y")));assert.equal(Number(lineOf(below).getAttribute("y1"))>Math.max(...barYs(below)),true);assert.equal(Number(lineOf(between).getAttribute("y1"))>Math.min(...barYs(between))&&Number(lineOf(between).getAttribute("y1"))<Math.max(...barYs(between)),true);assert.equal(Number(lineOf(above).getAttribute("y1"))<Math.min(...barYs(above)),true);assert.equal(ticks(above).at(-1)>10,true);
  const noUsable=await open({totals:{impressions:100,saves:2,pinClicks:2,outboundClicks:2},values:[{impressions:0,saves:1,pinClicks:1,outboundClicks:1},{impressions:null,saves:null,pinClicks:null,outboundClicks:null}]});assert.equal(noUsable.hasText("No usable Top Pins values"),true);assert.equal(noUsable.document.querySelector(".top-pins-chart"),undefined);assert.equal(noUsable.hasText("Account 30-day rate: 2.00%"),true);const allZero=await open({totals:{impressions:100,saves:0,pinClicks:0,outboundClicks:0},values:[{impressions:100,saves:0,pinClicks:0,outboundClicks:0},{impressions:100,saves:0,pinClicks:0,outboundClicks:0}]});assert.equal(lineOf(allZero).getAttribute("y1"),"242");assert.deepEqual(ticks(allZero),[0,.2,.4,.6,.8,1]);
  const stale=await open({accountState:"Failed",topState:"Failed",accountStale:true,topStale:true});assert.notEqual(lineOf(stale),undefined);assert.equal(stale.hasText("Retained same-period account reference; data may be stale."),true);assert.match(stale.document.querySelector(".top-pins-chart").getAttribute("aria-label"),/Retained same-period account reference; data may be stale\.$/);
  const shiftedWindow={startDate:"2026-07-23",endDate:"2026-08-21",completedDays:30},dynamic=await createPinterestDomHarness(preloadFor({connectionStatus:async()=>authenticated,readObservation:async()=>({ok:true,state:"Completed",pins}),readAccountPerformance:sequence(account,{...account,window:shiftedWindow},account),readTopPins:sequence(top,{...top,window:shiftedWindow},top)})).start(),dynamicSelect=()=>dynamic.document.querySelector('[data-top-pins-metric="saveRate"]').click(),dynamicLine=()=>dynamic.document.querySelector(".top-pins-account-reference-line");await dynamic.clickAction("observe");dynamic.document.querySelector('[data-pin-view="performance"]').click();await dynamic.clickAction("account-performance");await dynamic.clickAction("top-pins");dynamicSelect();assert.notEqual(dynamicLine(),undefined);await dynamic.clickAction("account-performance");dynamicSelect();assert.equal(dynamicLine(),undefined);assert.equal(dynamic.hasText("Same-period account rate unavailable."),true);await dynamic.clickAction("account-performance");dynamicSelect();assert.notEqual(dynamicLine(),undefined);await dynamic.clickAction("top-pins");dynamicSelect();assert.equal(dynamicLine(),undefined);await dynamic.clickAction("top-pins");dynamicSelect();assert.notEqual(dynamicLine(),undefined);assert.deepEqual([dynamic.callCount("readAccountPerformance"),dynamic.callCount("readTopPins"),dynamic.callCount("readPerformance"),dynamic.callCount("readObservation")],[3,3,0,1]);
});

test("Top Pins chart safely handles all-zero, one-value, zero-usable, and maximum-25 inputs",async()=>{
  const open=async metrics=>{const pins=metrics.map((_,index)=>({pinId:`raw-${index}`,title:`Pin ${index+1}`,boardName:"Board",thumbnail:null})),h=await createPinterestDomHarness(preloadFor({connectionStatus:async()=>authenticated,readObservation:async()=>({ok:true,state:"Completed",pins}),readTopPins:async()=>({ok:true,state:"Available",window:{startDate:"2026-07-24",endDate:"2026-08-22",completedDays:30},sortBy:"OUTBOUND_CLICK",pins:metrics.map((value,index)=>({pinId:`raw-${index}`,impressions:value,saves:value,pinClicks:value,outboundClicks:value})),stale:false})})).start();await h.clickAction("observe");h.document.querySelector('[data-pin-view="performance"]').click();await h.clickAction("top-pins");return h};
  const zero=await open([0,0,0]);assert.equal(zero.document.querySelectorAll(".top-pins-bar").length,3);assert.equal(zero.document.querySelectorAll(".top-pins-bar").every(bar=>bar.getAttribute("height")==="0"&&bar.getAttribute("y")==="242"),true);assert.deepEqual(zero.document.querySelectorAll(".top-pins-value-label").map(label=>label.textContent),["0","0","0"]);assert.equal(zero.document.querySelectorAll(".top-pins-value-label").every(label=>label.getAttribute("y")==="236"),true);assert.deepEqual(zero.document.querySelectorAll(".top-pins-tick-label").map(label=>label.textContent),["0","1"]);
  const one=await open([null,7,null]);const oneBars=one.document.querySelectorAll(".top-pins-bar");assert.equal(oneBars.length,3);assert.equal(Number(oneBars[0].getAttribute("x"))>140&&Number(oneBars[0].getAttribute("x"))<170,true);assert.deepEqual(one.document.querySelectorAll(".top-pins-value-label").map(label=>label.textContent),["7","—","—"]);
  const missing=await open([null,null]);missing.document.querySelector('[data-top-pins-metric="saveRate"]').click();assert.equal(missing.hasText("No usable Top Pins values"),true);assert.equal(missing.document.querySelector(".top-pins-chart"),undefined);
  const bounded=await open(Array.from({length:26},(_,index)=>index));const boundedChart=bounded.document.querySelector(".top-pins-chart"),boundedLabels=bounded.document.querySelectorAll(".top-pins-value-label"),boundedRanks=bounded.document.querySelectorAll(".top-pins-rank-label"),xs=boundedLabels.map(label=>Number(label.getAttribute("x")));assert.equal(bounded.document.querySelectorAll(".top-pins-bar").length,25);assert.equal(boundedLabels.length,25);assert.deepEqual(boundedRanks.map(label=>label.textContent),Array.from({length:25},(_,index)=>`#${25-index}`));assert.equal(boundedChart.getAttribute("viewBox"),"0 0 1894 300");assert.equal(boundedChart.getAttribute("width"),"1894");assert.equal(boundedChart.getAttribute("height"),"300");assert.equal(new Set(xs).size,25);assert.equal(xs.every((x,index)=>x>=70&&x<1894&&(index===0||x-xs[index-1]>=70)),true);assert.equal(boundedLabels.every(label=>Number(label.getAttribute("y"))>=22&&Number(label.getAttribute("y"))<300),true);assert.equal(boundedRanks.every(label=>Number(label.getAttribute("y"))>242&&Number(label.getAttribute("y"))<300),true);assert.equal(bounded.document.querySelector(".top-pins-table").children[1].children.length,25);
});

test("Top Pins contribution is metric-local, window-exact, bounded, stale-safe, and request-isolated",async()=>{
  const window={startDate:"2026-07-24",endDate:"2026-08-22",completedDays:30},pins=Array.from({length:3},(_,index)=>({pinId:`hidden-${index}`,title:`Pin ${index+1}`,boardName:"Board",thumbnail:null,providerPayload:"pin-secret"})),metrics=[{pinId:"hidden-0",impressions:100,saves:5,pinClicks:10,outboundClicks:0},{pinId:"hidden-1",impressions:200,saves:5,pinClicks:0,outboundClicks:2},{pinId:"hidden-2",impressions:0,saves:0,pinClicks:5,outboundClicks:3}],account={ok:true,state:"Available",window,latestAvailableDate:"2026-08-22",totals:{impressions:600,saves:20,pinClicks:30,outboundClicks:10},daily:[],stale:false,providerPayload:"account-secret"},top={ok:true,state:"Available",window,sortBy:"OUTBOUND_CLICK",pins:metrics.map(item=>({...item,providerPayload:"top-secret",url:"https://provider.invalid/private"})),stale:false};
  const retainedAccount={...account,state:"RateLimited",stale:true},retainedTop={...top,state:"Failed",stale:true},observations=[{ok:true,state:"Completed",pins},{ok:true,state:"CompletedWithWarnings",pins},{ok:true,state:"Completed",pins:[{pinId:"changed",title:"Changed",boardName:"Board",thumbnail:null}]}],harness=await createPinterestDomHarness(preloadFor({connectionStatus:async()=>authenticated,verifyConnection:async()=>({ok:true,state:"ReauthorizationRequired"}),readObservation:sequence(...observations),readAccountPerformance:sequence(account,retainedAccount),readTopPins:sequence(top,retainedTop)})).start();
  const counts=()=>["readAccountPerformance","readPerformance","readTopPins","readObservation"].map(name=>harness.callCount(name)),table=()=>harness.document.querySelector(".top-pins-contribution-table"),rows=()=>table().children[1].children,snapshot=()=>rows().map(row=>row.children.map(cell=>cell.textContent));
  assert.deepEqual(counts(),[0,0,0,0]);harness.document.querySelector('[data-pin-view="performance"]').click();await harness.settle();assert.deepEqual(counts(),[0,0,0,0]);await harness.clickAction("observe");await harness.clickAction("account-performance");assert.equal(harness.document.querySelector(".top-pins-contribution"),undefined);await harness.clickAction("top-pins");assert.deepEqual(counts(),[1,0,1,1]);
  assert.equal(harness.hasText("Observed Top Pins contribution"),true);assert.equal(harness.hasText("Share of organic account totals represented by snapshot-matched Top Pins. Descriptive coverage only; not attribution or prediction."),true);assert.equal(harness.hasText("Shared period: 24.07.26 – 22.08.26 · 30 completed UTC days"),true);assert.equal(harness.hasText("Snapshot-matched Top Pins used: 3"),true);assert.deepEqual(table().children[0].children[0].children.map(cell=>cell.textContent),["Metric","Snapshot Top Pins","Account total","Observed share"]);assert.deepEqual(snapshot(),[["Impressions","300","600","50.00%"],["Saves","10","20","50.00%"],["Pin clicks","15","30","50.00%"],["Outbound clicks","5","10","50.00%"]]);assert.equal(table().children[0].children[0].children.every(cell=>cell.getAttribute("scope")==="col"),true);assert.equal(rows().every(row=>row.children[0].getAttribute("scope")==="row"),true);
  const fixed=snapshot(),before=counts(),contributionTable=table();harness.document.querySelector('[data-account-trend-metric="saves"]')?.click();harness.document.querySelector('[data-top-pins-metric="impressions"]').click();harness.document.querySelector('[data-top-pins-sort="impressions"]').click();harness.document.querySelector('[data-account-sort="impressions"]')?.click();assert.deepEqual(snapshot(),fixed);assert.equal(table(),contributionTable);assert.deepEqual(counts(),before);
  await harness.clickAction("observe");assert.deepEqual(snapshot(),fixed);assert.deepEqual(counts(),[1,0,1,2]);await harness.clickAction("account-performance");await harness.clickAction("top-pins");assert.deepEqual(snapshot(),fixed);assert.equal(harness.hasText("Contribution uses retained stale account or Top Pins data."),true);assert.deepEqual(counts(),[2,0,2,2]);for(const forbidden of ["hidden-0","account-secret","top-secret","pin-secret","provider.invalid"])assert.equal(harness.hasText(forbidden),false);
  await harness.clickAction("observe");assert.equal(harness.document.querySelector(".top-pins-contribution"),undefined);assert.deepEqual(counts(),[2,0,2,3]);await harness.clickAction("verify");assert.equal(harness.document.querySelector(".top-pins-contribution"),undefined);assert.equal(harness.document.querySelector(".account-performance-table"),undefined);

  const open=async({totals={impressions:10,saves:10,pinClicks:10,outboundClicks:10},values=[{impressions:0,saves:0,pinClicks:0,outboundClicks:0}],accountWindow=window,topWindow=window,topState="Available",topCompletedDays=30}={})=>{const localPins=values.length?values.map((_,index)=>({pinId:`raw-${index}`,title:`Safe ${index}`,boardName:"Board",thumbnail:null})):[{pinId:"snapshot-only",title:"Snapshot only",boardName:"Board",thumbnail:null}],local=await createPinterestDomHarness(preloadFor({connectionStatus:async()=>authenticated,readObservation:async()=>({ok:true,state:"Completed",pins:localPins}),readAccountPerformance:async()=>({ok:true,state:"Available",window:accountWindow,latestAvailableDate:accountWindow?.endDate??null,totals,daily:[],stale:false}),readTopPins:async()=>({ok:true,state:topState,window:topWindow?{...topWindow,completedDays:topCompletedDays}:null,sortBy:"OUTBOUND_CLICK",pins:values.map((item,index)=>({pinId:`raw-${index}`,...item})),stale:false})})).start();await local.clickAction("observe");local.document.querySelector('[data-pin-view="performance"]').click();await local.clickAction("account-performance");await local.clickAction("top-pins");return local},contributionRows=local=>local.document.querySelector(".top-pins-contribution-table")?.children[1].children;
  const zero=await open();assert.deepEqual(contributionRows(zero)[0].children.map(cell=>cell.textContent),["Impressions","0","10","0.00%"]);const zeroDenominator=await open({totals:{impressions:0,saves:10,pinClicks:10,outboundClicks:10}});assert.deepEqual(contributionRows(zeroDenominator)[0].children.map(cell=>cell.textContent),["Impressions","0","0","—"]);
  for(const invalid of [null,"4",4.5,-1,Infinity,Number.MAX_SAFE_INTEGER+1]){const malformed=await open({values:[{impressions:invalid,saves:1,pinClicks:1,outboundClicks:1}]});assert.deepEqual(contributionRows(malformed)[0].children.map(cell=>cell.textContent),["Impressions","—","—","—"]);assert.deepEqual(contributionRows(malformed)[1].children.map(cell=>cell.textContent),["Saves","1","10","10.00%"])}
  const overflow=await open({totals:{impressions:Number.MAX_SAFE_INTEGER,saves:10,pinClicks:10,outboundClicks:10},values:[{impressions:Number.MAX_SAFE_INTEGER,saves:1,pinClicks:1,outboundClicks:1},{impressions:1,saves:1,pinClicks:1,outboundClicks:1}]});assert.deepEqual(contributionRows(overflow)[0].children.map(cell=>cell.textContent),["Impressions","—","—","—"]);const greater=await open({values:[{impressions:11,saves:1,pinClicks:1,outboundClicks:1}]});assert.deepEqual(contributionRows(greater)[0].children.map(cell=>cell.textContent),["Impressions","11","10","—"]);
  const mismatched=await open({topWindow:{startDate:"2026-07-23",endDate:"2026-08-21",completedDays:30}});assert.equal(mismatched.hasText("Top Pins contribution cannot be compared for different periods."),true);assert.equal(mismatched.document.querySelector(".top-pins-contribution-table"),undefined);const wrongDays=await open({topCompletedDays:29});assert.equal(wrongDays.document.querySelector(".top-pins-contribution"),undefined);
  const empty=await open({values:[],topState:"NoData"});assert.equal(empty.hasText("No snapshot-matched Top Pins are available for contribution comparison."),true);const bounded=await open({totals:{impressions:1000,saves:1000,pinClicks:1000,outboundClicks:1000},values:Array.from({length:26},()=>({impressions:1,saves:1,pinClicks:1,outboundClicks:1}))});assert.equal(bounded.hasText("Snapshot-matched Top Pins used: 25"),true);assert.deepEqual(contributionRows(bounded)[0].children.map(cell=>cell.textContent),["Impressions","25","1000","2.50%"]);assert.deepEqual(counts(),[2,0,2,3]);
});

test("observed rates enforce exact local formulas, unrounded sorting, uncapped values, and safe missing states",async()=>{
  const values=[{impressions:3,saves:1,pinClicks:0,outboundClicks:null},{impressions:50000,saves:16667,pinClicks:0,outboundClicks:60000},{impressions:0,saves:1,pinClicks:1,outboundClicks:1},{impressions:null,saves:1,pinClicks:1,outboundClicks:1}],pins=values.map((_,index)=>({pinId:`hidden-${index}`,title:`Rate ${index+1}`,boardName:"Board",thumbnail:null})),original=JSON.stringify(values),harness=await createPinterestDomHarness(preloadFor({connectionStatus:async()=>authenticated,readObservation:async()=>({ok:true,state:"Completed",pins}),readTopPins:async()=>({ok:true,state:"Available",window:{startDate:"2026-07-24",endDate:"2026-08-22",completedDays:30},sortBy:"OUTBOUND_CLICK",pins:values.map((value,index)=>({pinId:`hidden-${index}`,...value})),stale:false})})).start();
  await harness.clickAction("observe");harness.document.querySelector('[data-pin-view="performance"]').click();await harness.clickAction("top-pins");const table=harness.document.querySelector(".top-pins-table"),rows=()=>table.children[1].children,saveSort=harness.document.querySelector('[data-top-pins-sort="saveRate"]');
  assert.deepEqual(rows().map(row=>row.children.slice(7).map(cell=>cell.textContent)),[["33.33%","0.00%","—"],["33.33%","0.00%","120.00%"],["—","—","—"],["—","—","—"]]);saveSort.pressKey("Enter");assert.deepEqual(rows().slice(0,2).map(row=>row.children[1].textContent),["Rate 2","Rate 1"]);assert.equal(JSON.stringify(values),original);assert.equal(harness.callCount("readTopPins"),1);
  harness.document.querySelector('[data-top-pins-metric="pinClickRate"]').pressKey(" ");assert.equal(harness.document.querySelectorAll(".top-pins-bar").length,4);assert.equal(harness.document.querySelectorAll(".top-pins-bar").every(bar=>bar.getAttribute("height")==="0"),true);assert.deepEqual(harness.document.querySelectorAll(".top-pins-value-label").map(label=>label.textContent),["0.00%","0.00%","—","—"]);assert.deepEqual(harness.document.querySelectorAll(".top-pins-tick-label").map(label=>label.textContent),["0.00%","0.20%","0.40%","0.60%","0.80%","1.00%"]);harness.document.querySelector('[data-top-pins-metric="outboundClickRate"]').click();assert.equal(harness.document.querySelectorAll(".top-pins-bar").length,4);assert.equal(harness.document.querySelector(".top-pins-bar").getAttribute("aria-label"),"Rank 2: Outbound click rate: 120.00%");assert.deepEqual(harness.document.querySelectorAll(".top-pins-value-label").map(label=>label.textContent),["120.00%","—","—","—"]);assert.equal(harness.callCount("readTopPins"),1);
  for(const id of ["hidden-0","hidden-1","hidden-2","hidden-3"])assert.equal(harness.hasText(id),false);
});

test("Top Pins nice axes adapt across count magnitudes and uncapped rate ranges",async()=>{
  const open=async values=>{const pins=values.map((_,index)=>({pinId:`axis-hidden-${index}`,title:`Axis ${index+1}`,boardName:"Board",thumbnail:null})),h=await createPinterestDomHarness(preloadFor({connectionStatus:async()=>authenticated,readObservation:async()=>({ok:true,state:"Completed",pins}),readTopPins:async()=>({ok:true,state:"Available",window:{startDate:"2026-07-24",endDate:"2026-08-22",completedDays:30},sortBy:"OUTBOUND_CLICK",pins:values.map((value,index)=>({pinId:`axis-hidden-${index}`,...value})),stale:false})})).start();await h.clickAction("observe");h.document.querySelector('[data-pin-view="performance"]').click();await h.clickAction("top-pins");return h},ticks=h=>h.document.querySelectorAll(".top-pins-tick-label").map(label=>label.textContent),select=(h,key)=>h.document.querySelector(`[data-top-pins-metric="${key}"]`).click();
  const ranged=await open([{impressions:30000,saves:234,pinClicks:30,outboundClicks:300}]);select(ranged,"pinClicks");assert.deepEqual(ticks(ranged),["0","10","20","30","40"]);select(ranged,"outboundClicks");assert.deepEqual(ticks(ranged),["0","100","200","300","400"]);select(ranged,"saveRate");assert.deepEqual(ticks(ranged),["0.00%","0.20%","0.40%","0.60%","0.80%","1.00%"]);assert.equal(ranged.document.querySelector(".top-pins-value-label").textContent,"0.78%");select(ranged,"impressions");assert.deepEqual(ticks(ranged),["0","10000","20000","30000","40000"]);assert.equal(ticks(ranged).some(value=>/[eE][+-]?\d/.test(value)),false);const highest=ranged.document.querySelector(".top-pins-bar"),highestLabel=ranged.document.querySelector(".top-pins-value-label");assert.equal(Number(highest.getAttribute("y"))>30&&Number(highestLabel.getAttribute("y"))>22,true);assert.equal(ranged.callCount("readTopPins"),1);
  const uncapped=await open([{impressions:1000,saves:0,pinClicks:0,outboundClicks:1200}]);select(uncapped,"outboundClickRate");assert.deepEqual(ticks(uncapped),["0.00%","25.00%","50.00%","75.00%","100.00%","125.00%","150.00%"]);assert.equal(uncapped.document.querySelector(".top-pins-value-label").textContent,"120.00%");assert.equal(uncapped.callCount("readTopPins"),1);for(const id of ["axis-hidden-0","axis-hidden-1"])assert.equal(ranged.hasText(id)||uncapped.hasText(id),false);
});
