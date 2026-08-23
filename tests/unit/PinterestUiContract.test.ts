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
  assert.equal(hasPinterestContract({ startOAuth() {}, connectionStatus() {}, verifyConnection() {}, readObservation() {}, readPerformance() {} }), true);
  assert.doesNotMatch(source, /window\.alivoPinterest\?\.read|window\.alivoPinterest\?\.detail|window\.alivoPinterest\?\.command/);
  for (const name of ["startOAuth", "connectionStatus", "verifyConnection", "readObservation"]) assert.match(source, new RegExp(`\\.${name}\\(`));
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
