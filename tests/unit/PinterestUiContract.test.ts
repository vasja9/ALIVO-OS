import assert from "node:assert/strict";
import test from "node:test";
import { COMPLETE_JPEG_BASE64, COMPLETE_PNG_BASE64, COMPLETE_WEBP_BASE64 } from "../fixtures/PinterestThumbnailFixtures.ts";
import { readFileSync } from "node:fs";
import { hasPinterestContract, actionAllowed, createPinterestUiState, PINTEREST_UI_STATE, safeObservation, transition } from "../../ui/pinterest-connection-state.js";

const source = readFileSync(new URL("../../ui/pinterest.js", import.meta.url), "utf8");
const stateSource = readFileSync(new URL("../../ui/pinterest-connection-state.js", import.meta.url), "utf8");

test("Pinterest UI uses only the new preload contract and rejects an incomplete preload", () => {
  assert.equal(hasPinterestContract(undefined), false);
  assert.equal(hasPinterestContract({ startOAuth() {}, connectionStatus() {}, verifyConnection() {} }), false);
  assert.equal(hasPinterestContract({ startOAuth() {}, connectionStatus() {}, verifyConnection() {}, readObservation() {} }), false);
  assert.equal(hasPinterestContract({ startOAuth() {}, connectionStatus() {}, verifyConnection() {}, readObservation() {}, readAccountPerformance() {}, readTopPins() {}, readPerformance() {} }), true);
  assert.doesNotMatch(source, /window\.alivoPinterest\?\.read|window\.alivoPinterest\?\.detail|window\.alivoPinterest\?\.command/);
  for (const name of ["startOAuth", "connectionStatus", "verifyConnection", "readObservation", "readAccountPerformance", "readTopPins", "readPerformance"]) assert.match(source, new RegExp(`\\.${name}\\(`));
});

test("Pinterest UI state transitions cover missing configuration, connection, verification, and observation", () => {
  let state = createPinterestUiState();
  state = transition(state, { type: "START_RESULT", value: { ok: false, code: "CONFIGURATION_FAILURE" } });
  assert.equal(state.uiState, PINTEREST_UI_STATE.ConfigurationMissing);
  state = transition(createPinterestUiState(), { type: "STATUS_RESULT", value: { ok: true, state: "AuthenticationRequired" } });
  assert.equal(state.uiState, PINTEREST_UI_STATE.Disconnected);
  state = transition(state, { type: "START_REQUEST" });
  assert.equal(state.uiState, PINTEREST_UI_STATE.Connecting);
  state = transition(state, { type: "STATUS_RESULT", value: { ok: true, state: "Authenticated" } });
  assert.equal(state.uiState, PINTEREST_UI_STATE.Connected);
  state = transition(state, { type: "VERIFY_REQUEST" });
  assert.equal(state.uiState, PINTEREST_UI_STATE.Verifying);
  state = transition(state, { type: "VERIFY_RESULT", value: { ok: true, state: "Available" } });
  assert.equal(state.uiState, PINTEREST_UI_STATE.Connected);
  state = transition(state, { type: "OBSERVATION_REQUEST" });
  state = transition(state, { type: "OBSERVATION_RESULT", value: { ok: true, state: "Completed", summary: { acceptedObservations: 1 } } });
  assert.equal(state.uiState, PINTEREST_UI_STATE.ObservationRead);
  assert.equal(state.observation.summary.acceptedObservations, 1);
});

test("Pinterest UI keeps an authenticated session visible when a read-only scope is limited", () => {
  const state = transition(createPinterestUiState(), {
    type: "VERIFY_RESULT",
    value: {
      ok: true,
      state: "PermissionLimited",
      authenticationState: "Authenticated",
      capabilities: [{ state: "PermissionRequired", reason: "MissingScope", safeMessage: "provider detail accessToken=secret" }],
    },
  });
  assert.equal(state.uiState, PINTEREST_UI_STATE.ConnectedLimitedPermissions);
  assert.match(state.message, /connected.*read-only permissions.*missing/i);
  assert.doesNotMatch(state.message, /provider detail|accessToken|secret/i);
  assert.equal(actionAllowed(state, "connect"), true);
  assert.equal(actionAllowed(state, "observe"), true);
});

test("Pinterest UI distinguishes an invalid or expired session from a missing scope", () => {
  const state = transition(createPinterestUiState(), {
    type: "VERIFY_RESULT",
    value: {
      ok: true,
      state: "Unavailable",
      authenticationState: "Authenticated",
      capabilities: [{ state: "AuthenticationRequired", reason: "AuthenticationRequired", safeMessage: "raw accessToken=secret" }],
    },
  });
  assert.equal(state.uiState, PINTEREST_UI_STATE.ReauthorizationRequired);
  assert.match(state.message, /expired or invalid|reauthorize/i);
  assert.doesNotMatch(state.message, /raw|accessToken|secret/i);
});

test("Pinterest UI routes encrypted-session integrity failures to reauthorization instead of disconnected", () => {
  const state = transition(createPinterestUiState(), {
    type: "STATUS_RESULT",
    value: { ok: false, state: "ReauthorizationRequired", code: "SESSION_INTEGRITY_FAILURE" },
  });
  assert.equal(state.uiState, PINTEREST_UI_STATE.ReauthorizationRequired);
  assert.match(state.message, /stale or damaged|reauthorize/i);
});

test("Pinterest UI distinguishes denial, reauthorization, rate limit, and network timeout", () => {
  assert.equal(transition(createPinterestUiState(), { type: "START_RESULT", value: { ok: false, code: "OAUTH_DENIED" } }).uiState, PINTEREST_UI_STATE.OAuthDenied);
  assert.equal(transition(createPinterestUiState(), { type: "OBSERVATION_RESULT", value: { ok: true, state: "ReauthorizationRequired" } }).uiState, PINTEREST_UI_STATE.ReauthorizationRequired);
  assert.equal(transition(createPinterestUiState(), { type: "VERIFY_RESULT", value: { ok: true, state: "RateLimited" } }).uiState, PINTEREST_UI_STATE.RateLimited);
  assert.equal(transition(createPinterestUiState(), { type: "OBSERVATION_RESULT", value: { ok: false, code: "TIMEOUT" } }).uiState, PINTEREST_UI_STATE.TimeoutNetworkError);
});

test("Pinterest UI prevents duplicate OAuth requests and restores state from status after reopen", () => {
  let state = transition(createPinterestUiState(), { type: "START_REQUEST" });
  const duplicate = transition(state, { type: "START_REQUEST" });
  assert.equal(duplicate, state);
  assert.equal(actionAllowed(state, "connect"), false);
  assert.equal(transition(createPinterestUiState(), { type: "STATUS_RESULT", value: { ok: true, state: "Authenticated" } }).uiState, PINTEREST_UI_STATE.Connected);
});

test("Pinterest UI redacts sensitive provider fields and never exposes them in rendered source", () => {
  const safe = safeObservation({
    ok: true,
    state: "Read",
    body: { accessToken: "access-secret", refreshToken: "refresh-secret", payload: "safe" },
    warnings: ["accessToken=warning-secret", "callbackUrl=http://127.0.0.1/?code=callback-secret"],
    provenance: { sessionSecret: "session-secret", source: "Pinterest" },
  });
  assert.equal(safe.body, undefined);
  assert.equal(safe.provenance.sessionSecret, "[REDACTED]");
  assert.equal(safe.warningCount, 2);
  assert.equal(safe.warnings, undefined);
  assert.doesNotMatch(source, /console\.(log|error|warn)|accessToken|refreshToken|clientSecret|sessionSecret|codeVerifier|callbackUrl/);
});

test("Pinterest UI accepts only board names and omits ownership and board IDs from safe Pin state",()=>{
  const safe=safeObservation({pins:[{pinId:"pin-1",boardName:"Named board",boardReference:"123456",ownership:"OwnedAuthorizedResource",accessToken:"secret"}]});
  assert.deepEqual(safe.pins,[{pinId:"pin-1",boardName:"Named board",thumbnail:null}]);
  assert.equal(/123456|ownership|accessToken|secret/i.test(JSON.stringify(safe)),false);
});

test("Pinterest UI thumbnail boundary accepts only bounded image DTO data",()=>{
  const jpeg=COMPLETE_JPEG_BASE64;
  const safe=safeObservation({pins:[{pinId:"pin-1",boardName:"Board",thumbnail:{mimeType:"image/jpeg",base64:jpeg,url:"https://i.pinimg.com/private.jpg",headers:{Cookie:"secret"}},thumbnailUrl:"https://i.pinimg.com/private.jpg",media:{raw:true}}]});
  assert.deepEqual(safe.pins,[{pinId:"pin-1",boardName:"Board",thumbnail:{mimeType:"image/jpeg",base64:jpeg}}]);
  assert.equal(/pinimg|private|cookie|thumbnailUrl|media|raw/i.test(JSON.stringify(safe)),false);
  assert.equal(safeObservation({pins:[{pinId:"bad",boardName:"Board",thumbnail:{mimeType:"image/svg+xml",base64:jpeg}}]}).pins[0].thumbnail,null);
  assert.equal(safeObservation({pins:[{pinId:"bad",boardName:"Board",thumbnail:{mimeType:"image/jpeg",base64:"A".repeat(400000)}}]}).pins[0].thumbnail,null);
  assert.equal(safeObservation({pins:[{pinId:"bad",boardName:"Board",thumbnail:{mimeType:"image/jpeg",base64:jpeg.slice(0,-4)}}]}).pins[0].thumbnail,null);
  assert.equal(safeObservation({pins:[{pinId:"bad",boardName:"Board",thumbnail:{mimeType:"image/png",base64:COMPLETE_PNG_BASE64.slice(0,-16)}}]}).pins[0].thumbnail,null);
  assert.equal(safeObservation({pins:[{pinId:"bad",boardName:"Board",thumbnail:{mimeType:"image/webp",base64:COMPLETE_WEBP_BASE64.slice(0,-4)}}]}).pins[0].thumbnail,null);
  assert.equal(safe.pins[0].thumbnail.base64.length,976);
  assert.match(stateSource,/return Object\.freeze\(\{ \.\.\.envelope, pins: Object\.freeze\(pins\), audit: safeContentAudit\(value\.audit, pins\) \}\)/);
  assert.doesNotMatch(stateSource,/base64\.(?:trim|slice)|text\(thumbnail\.base64\)|slice\(0,\s*240\).*base64/);
});

test("Top Pins readiness DTO validation is exact, frozen, bounded, row-local, and private-field free",()=>{
  const window={startDate:"2026-07-24",endDate:"2026-08-22",completedDays:30},base={title:"<img src=x onerror=private()>",boardName:"Board",impressions:100,saves:2,pinClicks:3,outboundClicks:4,pinId:"raw-private-id",providerPayload:{secret:true},issueCodes:["PRIVATE_CODE"],issueMessages:["private message"]},result=pins=>({state:"Available",window,sortBy:"OUTBOUND_CLICK",pins,stale:false}),ready={status:"Ready",issueCount:0,requiredIssueCount:0,reviewIssueCount:0},attention={status:"NeedsAttention",issueCount:3,requiredIssueCount:1,reviewIssueCount:2},readyDetails={required:[],review:[],providerPayload:"discard"},attentionDetails={required:["Add a Pin title."],review:["Add a Pin description for Pinterest relevance.","Add or repair the Pin image."],unknown:"discard"};
  const sourceRows=[{...base,contentReadiness:ready,contentReadinessDetails:readyDetails},{...base,title:"Attention",contentReadiness:attention,contentReadinessDetails:attentionDetails},{...base,title:"Unavailable",contentReadiness:null,contentReadinessDetails:{required:["arbitrary private string"],review:[]}}],sourceBefore=JSON.stringify(sourceRows);
  let state=transition(createPinterestUiState(),{type:"TOP_PINS_RESULT",value:result(sourceRows)});
  assert.deepEqual(state.topPins.pins,[
    {title:"<img src=x onerror=private()>",boardName:"Board",impressions:100,saves:2,pinClicks:3,outboundClicks:4,lifecycle:null,contentReadiness:ready,contentReadinessDetails:{required:[],review:[]}},
    {title:"Attention",boardName:"Board",impressions:100,saves:2,pinClicks:3,outboundClicks:4,lifecycle:null,contentReadiness:attention,contentReadinessDetails:{required:["Add a Pin title."],review:["Add a Pin description for Pinterest relevance.","Add or repair the Pin image."]}},
    {title:"Unavailable",boardName:"Board",impressions:100,saves:2,pinClicks:3,outboundClicks:4,lifecycle:null,contentReadiness:null,contentReadinessDetails:null},
  ]);
  assert.equal(JSON.stringify(sourceRows),sourceBefore);assert.equal(Object.isFrozen(state.topPins),true);assert.equal(Object.isFrozen(state.topPins.pins),true);assert.equal(state.topPins.pins.every(pin=>Object.isFrozen(pin)&&(!pin.contentReadiness||Object.isFrozen(pin.contentReadiness))&&(!pin.contentReadinessDetails||Object.isFrozen(pin.contentReadinessDetails)&&Object.isFrozen(pin.contentReadinessDetails.required)&&Object.isFrozen(pin.contentReadinessDetails.review))),true);
  assert.equal(/raw-private-id|providerPayload|secret|PRIVATE_CODE|private message|arbitrary private string|issueCodes|issueMessages|pinId|unknown|discard/.test(JSON.stringify(state.topPins)),false);
  const lifecycle={createdAt:"2026-06-24T00:00:00.000Z",completedAgeDays:60,cohort:"Days60To90",outboundState:"NoOutboundClickInWindow",coverage:"Observed30CompletedUtcDays"};state=transition(createPinterestUiState(),{type:"TOP_PINS_RESULT",value:result([{...base,lifecycle,contentReadiness:null}])});assert.deepEqual(state.topPins.pins[0].lifecycle,lifecycle);assert.equal(Object.isFrozen(state.topPins.pins[0].lifecycle),true);
  for(const malformed of [{...lifecycle,cohort:"Days0To59"},{...lifecycle,completedAgeDays:59},{...lifecycle,createdAt:"2026-06-23T00:00:00.000Z"},{...lifecycle,coverage:"Lifetime"},{...lifecycle,outboundState:"Failed"},{...lifecycle,createdAt:"2026-06-24"},{...lifecycle,providerPayload:"private"}]){state=transition(createPinterestUiState(),{type:"TOP_PINS_RESULT",value:result([{...base,lifecycle:malformed,contentReadiness:null}])});assert.equal(state.topPins.pins[0].lifecycle,null)}
  const cleared=transition(state,{type:"STATUS_RESULT",value:{ok:true,state:"ReauthorizationRequired"}});assert.equal(cleared.topPins.state,"NotRead");assert.deepEqual(cleared.topPins.pins,[]);
  const prototypeReadiness=Object.assign(Object.create({inherited:true}),{status:"Ready",issueCount:0,requiredIssueCount:0,reviewIssueCount:0}),invalid=[
    undefined,{},[],prototypeReadiness,{status:"Unknown",issueCount:0,requiredIssueCount:0,reviewIssueCount:0},{status:"Ready",issueCount:1,requiredIssueCount:1,reviewIssueCount:0},{status:"NeedsAttention",issueCount:0,requiredIssueCount:0,reviewIssueCount:0},{status:"NeedsAttention",issueCount:2,requiredIssueCount:1,reviewIssueCount:0},{status:"NeedsAttention",issueCount:-1,requiredIssueCount:0,reviewIssueCount:0},{status:"NeedsAttention",issueCount:1.5,requiredIssueCount:1,reviewIssueCount:0},{status:"NeedsAttention",issueCount:"1",requiredIssueCount:1,reviewIssueCount:0},{status:"NeedsAttention",issueCount:Infinity,requiredIssueCount:1,reviewIssueCount:0},{status:"NeedsAttention",issueCount:Number.MAX_SAFE_INTEGER,requiredIssueCount:1,reviewIssueCount:0},{status:"NeedsAttention",issueCount:13,requiredIssueCount:12,reviewIssueCount:1},{status:"NeedsAttention",issueCount:1,requiredIssueCount:1,reviewIssueCount:0,issues:[{code:"PRIVATE",message:"private"}]},
  ];
  for(const contentReadiness of invalid){state=transition(createPinterestUiState(),{type:"TOP_PINS_RESULT",value:result([{...base,contentReadiness,contentReadinessDetails:attentionDetails}])});assert.equal(state.topPins.pins[0].contentReadiness,null);assert.equal(state.topPins.pins[0].contentReadinessDetails,null);assert.deepEqual([state.topPins.pins[0].impressions,state.topPins.pins[0].saves,state.topPins.pins[0].pinClicks,state.topPins.pins[0].outboundClicks],[100,2,3,4])}
  const oneRequired={status:"NeedsAttention",issueCount:1,requiredIssueCount:1,reviewIssueCount:0},twoRequired={status:"NeedsAttention",issueCount:2,requiredIssueCount:2,reviewIssueCount:0},oneReview={status:"NeedsAttention",issueCount:1,requiredIssueCount:0,reviewIssueCount:1},invalidDetails=[
    {summary:oneRequired,details:undefined},{summary:oneRequired,details:{}},{summary:oneRequired,details:[]},{summary:oneRequired,details:{required:["arbitrary private string"],review:[]}},{summary:oneRequired,details:{required:["Add a Pin description for Pinterest relevance."],review:[]}},{summary:oneReview,details:{required:[],review:["Add a Pin title."]}},{summary:twoRequired,details:{required:["Add a destination to alivo.eu.","Add a Pin title."],review:[]}},{summary:twoRequired,details:{required:["Add a Pin title.","Add a Pin title."],review:[]}},{summary:oneRequired,details:{required:[],review:[]}},{summary:oneRequired,details:{required:["Add a Pin title."],review:Array(12).fill("Add a Pin description for Pinterest relevance.")}},
  ];
  for(const [index,item] of invalidDetails.entries()){const source={...base,title:`Invalid details ${index}`,contentReadiness:item.summary,contentReadinessDetails:item.details},before=JSON.stringify(source);state=transition(createPinterestUiState(),{type:"TOP_PINS_RESULT",value:result([source])});assert.deepEqual(state.topPins.pins[0].contentReadiness,item.summary);assert.equal(state.topPins.pins[0].contentReadinessDetails,null);assert.deepEqual([state.topPins.pins[0].impressions,state.topPins.pins[0].saves,state.topPins.pins[0].pinClicks,state.topPins.pins[0].outboundClicks],[100,2,3,4]);assert.equal(JSON.stringify(source),before)}
  state=transition(createPinterestUiState(),{type:"TOP_PINS_RESULT",value:result(Array.from({length:26},(_,index)=>({...base,title:`Bounded ${index}`,contentReadiness:ready,contentReadinessDetails:readyDetails})))});assert.equal(state.topPins.pins.length,25);
  const prototypeRow=Object.assign(Object.create({providerPayload:"private"}),base,{contentReadiness:null});state=transition(createPinterestUiState(),{type:"TOP_PINS_RESULT",value:result([prototypeRow])});assert.deepEqual(state.topPins.pins,[]);
  const safeTopPinsSource=stateSource.slice(stateSource.indexOf("const plainRecord"),stateSource.indexOf("function safeContentAudit"));assert.doesNotMatch(safeTopPinsSource,/allowed\.has|snapshot\.slice|return\[Object\.freeze\(\{pinId/);assert.match(safeTopPinsSource,/requiredIssueCount\+reviewIssueCount!==issueCount/);assert.match(safeTopPinsSource,/value\.required\.length\+value\.review\.length>12/);assert.match(safeTopPinsSource,/AUDIT_RULES\[code\]\.message===message/);
});

test("account trend renderer input is an immutable five-field DTO cleared by authentication loss",()=>{
  const snapshot={ok:true,state:"Available",window:{startDate:"2026-07-24",endDate:"2026-08-22",completedDays:30},latestAvailableDate:"2026-08-22",totals:null,daily:[
    {date:"2026-07-25",impressions:100,saves:0,pinClicks:null,outboundClicks:2,pin:{title:"private"},board:{name:"private"},thumbnail:"private",url:"https://provider.invalid/private",providerPayload:{secret:true},headers:{authorization:"secret"},oauthToken:"secret",cookie:"secret",callbackData:"secret",credential:"secret"},
    {date:"2026-07-24",impressions:20,saves:1,pinClicks:3,outboundClicks:4},
  ],stale:false};
  let state=transition(createPinterestUiState(),{type:"ACCOUNT_PERFORMANCE_RESULT",value:snapshot});
  assert.deepEqual(state.accountPerformance.daily,[
    {date:"2026-07-24",impressions:20,saves:1,pinClicks:3,outboundClicks:4},
    {date:"2026-07-25",impressions:100,saves:0,pinClicks:null,outboundClicks:2},
  ]);
  assert.deepEqual(Object.keys(state.accountPerformance.daily[0]),["date","impressions","saves","pinClicks","outboundClicks"]);
  assert.equal(Object.isFrozen(state.accountPerformance),true);assert.equal(Object.isFrozen(state.accountPerformance.daily),true);assert.equal(Object.isFrozen(state.accountPerformance.daily[0]),true);
  assert.equal(/"(?:pin|board|thumbnail|url|providerPayload|headers|oauthToken|cookie|callbackData|credential)"|secret/i.test(JSON.stringify(state.accountPerformance.daily)),false);
  assert.equal(snapshot.daily[0].providerPayload.secret,true);assert.equal(snapshot.daily[0].saves,0);

  for(const status of [{ok:true,state:"ReauthorizationRequired"},{ok:true,state:"AuthenticationRequired"}]){
    let authenticatedState=transition(createPinterestUiState(),{type:"STATUS_RESULT",value:{ok:true,state:"Authenticated"}});
    authenticatedState=transition(authenticatedState,{type:"ACCOUNT_PERFORMANCE_RESULT",value:snapshot});
    const cleared=transition(authenticatedState,{type:"STATUS_RESULT",value:status});
    assert.equal(cleared.accountPerformance.state,"NotRead");assert.deepEqual(cleared.accountPerformance.daily,[]);
  }
  state=transition(state,{type:"ACCOUNT_PERFORMANCE_RESULT",value:{state:"ReauthorizationRequired",daily:snapshot.daily}});
  assert.equal(state.accountPerformance.state,"ReauthorizationRequired");assert.deepEqual(state.accountPerformance.daily,[]);
});

test("Pinterest UI preserves a verified connection when observation data is unavailable", () => {
  let state = transition(createPinterestUiState(), { type: "VERIFY_RESULT", value: { ok: true, state: "Available", authenticationState: "Authenticated" } });
  state = transition(state, { type: "OBSERVATION_REQUEST" });
  for (const value of [{ ok: true, state: "Failed" }, { ok: true, state: "Unavailable" }, { ok: true, state: "NoData" }, { ok: false, code: "INVALID_RESPONSE" }]) {
    const result = transition(state, { type: "OBSERVATION_RESULT", value });
    assert.equal(result.uiState, PINTEREST_UI_STATE.Connected);
    assert.match(result.message, /observation is unavailable/i);
  }
  assert.equal(transition(state, { type: "OBSERVATION_RESULT", value: { ok: true, state: "ReauthorizationRequired" } }).uiState, PINTEREST_UI_STATE.ReauthorizationRequired);
  assert.equal(transition(state, { type: "OBSERVATION_RESULT", value: { ok: true, state: "RateLimited" } }).uiState, PINTEREST_UI_STATE.RateLimited);
});
