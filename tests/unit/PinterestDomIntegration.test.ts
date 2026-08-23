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
  assert.equal(harness.document.querySelector(".account-performance-trend"),undefined);
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
  assert.equal(harness.document.querySelector(".account-trend-chart").getAttribute("aria-label"),"Impressions organic account trend from 24.07.26 to 22.08.26 with 29 usable daily values.");assert.equal(harness.document.querySelector('[data-account-trend-metric="impressions"]').getAttribute("aria-pressed"),"true");
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
  assert.equal(noData.hasText("No organic account metrics were available for this date window."),true);assert.equal(noData.document.querySelector(".account-performance-trend"),undefined);

  const clearing=await openAndRead({connectionStatus:sequence(authenticated,{ok:true,state:"ReauthorizationRequired"}),readAccountPerformance:async()=>available(zeroDaily)});
  assert.notEqual(clearing.document.querySelector(".account-trend-chart"),undefined);await clearing.clickAction("refresh");assert.equal(clearing.document.querySelector(".account-performance-trend"),undefined);assert.equal(clearing.hasText("Reauthorization required"),true);assert.equal(clearing.callCount("readAccountPerformance"),1);
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

test("Top Pins chart safely handles all-zero, one-value, zero-usable, and maximum-25 inputs",async()=>{
  const open=async metrics=>{const pins=metrics.map((_,index)=>({pinId:`raw-${index}`,title:`Pin ${index+1}`,boardName:"Board",thumbnail:null})),h=await createPinterestDomHarness(preloadFor({connectionStatus:async()=>authenticated,readObservation:async()=>({ok:true,state:"Completed",pins}),readTopPins:async()=>({ok:true,state:"Available",window:{startDate:"2026-07-24",endDate:"2026-08-22",completedDays:30},sortBy:"OUTBOUND_CLICK",pins:metrics.map((value,index)=>({pinId:`raw-${index}`,impressions:value,saves:value,pinClicks:value,outboundClicks:value})),stale:false})})).start();await h.clickAction("observe");h.document.querySelector('[data-pin-view="performance"]').click();await h.clickAction("top-pins");return h};
  const zero=await open([0,0,0]);assert.equal(zero.document.querySelectorAll(".top-pins-bar").length,3);assert.equal(zero.document.querySelectorAll(".top-pins-bar").every(bar=>bar.getAttribute("height")==="0"&&bar.getAttribute("y")==="242"),true);assert.deepEqual(zero.document.querySelectorAll(".top-pins-value-label").map(label=>label.textContent),["0","0","0"]);assert.equal(zero.document.querySelectorAll(".top-pins-value-label").every(label=>label.getAttribute("y")==="236"),true);assert.deepEqual(zero.document.querySelectorAll(".top-pins-tick-label").map(label=>label.textContent),["0","1"]);
  const one=await open([null,7,null]);const oneBars=one.document.querySelectorAll(".top-pins-bar");assert.equal(oneBars.length,3);assert.equal(Number(oneBars[0].getAttribute("x"))>140&&Number(oneBars[0].getAttribute("x"))<170,true);assert.deepEqual(one.document.querySelectorAll(".top-pins-value-label").map(label=>label.textContent),["7","—","—"]);
  const missing=await open([null,null]);missing.document.querySelector('[data-top-pins-metric="saveRate"]').click();assert.equal(missing.hasText("No usable Top Pins values"),true);assert.equal(missing.document.querySelector(".top-pins-chart"),undefined);
  const bounded=await open(Array.from({length:26},(_,index)=>index));const boundedChart=bounded.document.querySelector(".top-pins-chart"),boundedLabels=bounded.document.querySelectorAll(".top-pins-value-label"),boundedRanks=bounded.document.querySelectorAll(".top-pins-rank-label"),xs=boundedLabels.map(label=>Number(label.getAttribute("x")));assert.equal(bounded.document.querySelectorAll(".top-pins-bar").length,25);assert.equal(boundedLabels.length,25);assert.deepEqual(boundedRanks.map(label=>label.textContent),Array.from({length:25},(_,index)=>`#${25-index}`));assert.equal(boundedChart.getAttribute("viewBox"),"0 0 1894 300");assert.equal(boundedChart.getAttribute("width"),"1894");assert.equal(boundedChart.getAttribute("height"),"300");assert.equal(new Set(xs).size,25);assert.equal(xs.every((x,index)=>x>=70&&x<1894&&(index===0||x-xs[index-1]>=70)),true);assert.equal(boundedLabels.every(label=>Number(label.getAttribute("y"))>=22&&Number(label.getAttribute("y"))<300),true);assert.equal(boundedRanks.every(label=>Number(label.getAttribute("y"))>242&&Number(label.getAttribute("y"))<300),true);assert.equal(bounded.document.querySelector(".top-pins-table").children[1].children.length,25);
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
