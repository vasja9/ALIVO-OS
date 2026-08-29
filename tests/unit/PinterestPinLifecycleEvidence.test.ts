import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pinterestPinAgeCohort, pinterestPinLifecycleEvidence } from "../../src/integrations/pinterest/PinterestPinLifecycleEvidence.ts";
import { rendererSafePins, rendererSafeTopPins } from "../../src/integrations/pinterest/PinterestElectronComposition.ts";
import { emptyPinterestContentAudit } from "../../src/integrations/pinterest/PinterestContentReadinessAudit.ts";
import { parsePinterestTopPins } from "../../src/integrations/pinterest/PinterestTopPinsAnalytics.ts";

const endDate = "2026-08-22";
const endExclusive = Date.parse("2026-08-23T00:00:00.000Z");
const createdForAge = (days: number) => new Date(endExclusive - days * 86_400_000 - (days === 0 ? 1 : 0)).toISOString();

test("Pinterest Pin lifecycle cohorts use completed UTC days with exact inclusive boundaries", () => {
  for (const [days, cohort] of [[0,"Days0To59"],[59,"Days0To59"],[60,"Days60To90"],[90,"Days60To90"],[91,"Days91To180"],[180,"Days91To180"],[181,"Days181To600"],[600,"Days181To600"],[601,"Days601Plus"]] as const) {
    const evidence = pinterestPinLifecycleEvidence(createdForAge(days), endDate, 0);
    assert.equal(evidence.completedAgeDays, days);
    assert.equal(evidence.cohort, cohort);
    assert.equal(evidence.coverage, "Observed30CompletedUtcDays");
    assert.equal(Object.isFrozen(evidence), true);
  }
});

test("Pinterest Pin lifecycle distinguishes positive evidence, observed zero, and unavailable metrics", () => {
  assert.equal(pinterestPinLifecycleEvidence(createdForAge(60), endDate, 1).outboundState, "ReachedAlivoEu");
  assert.equal(pinterestPinLifecycleEvidence(createdForAge(60), endDate, 0).outboundState, "NoOutboundClickInWindow");
  for (const value of [null, undefined, "0", -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(pinterestPinLifecycleEvidence(createdForAge(60), endDate, value).outboundState, "Unavailable");
});

test("Pinterest Pin lifecycle fails closed for malformed, missing, or future publication evidence", () => {
  for (const createdAt of [null, "2026-08-01", "2026-02-30T00:00:00.000Z", "2026-08-23T00:00:00.000Z", "2026-08-24T00:00:00.000Z"]) {
    const evidence = pinterestPinLifecycleEvidence(createdAt, endDate, 0);
    assert.equal(evidence.createdAt, null);
    assert.equal(evidence.completedAgeDays, null);
    assert.equal(evidence.cohort, "Unknown");
  }
  assert.equal(pinterestPinLifecycleEvidence(createdForAge(60), "2026-02-30", 0).cohort, "Unknown");
  for (const age of [null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(pinterestPinAgeCohort(age), "Unknown");
});

test("renderer lifecycle uses provider creation evidence and never substitutes observation time", () => {
  const observations=[
    {type:"pin",observedAt:new Date("2026-08-22T12:00:00.000Z"),payloadReference:JSON.stringify({resourceId:"private-pin-1",resourceType:"pin",createdAt:createdForAge(60),title:"Dated"})},
    {type:"pin",observedAt:new Date("2026-01-01T00:00:00.000Z"),payloadReference:JSON.stringify({resourceId:"private-pin-2",resourceType:"pin",title:"Undated"})},
  ],snapshot=rendererSafePins(observations),metrics=parsePinterestTopPins({pins:[{pin_id:"private-pin-1",metrics:{IMPRESSION:10,SAVE:0,PIN_CLICK:0,OUTBOUND_CLICK:0}},{pin_id:"private-pin-2",metrics:{IMPRESSION:10,SAVE:0,PIN_CLICK:0,OUTBOUND_CLICK:1}}]},Object.freeze({startDate:"2026-07-24",endDate,completedDays:30 as const}),snapshot.map(pin=>pin.pinId)),safe=rendererSafeTopPins(metrics,snapshot,emptyPinterestContentAudit());
  assert.equal(snapshot[0].createdAt,createdForAge(60));
  assert.equal(snapshot[1].createdAt,undefined);
  assert.deepEqual(safe.pins.map(pin=>pin.lifecycle),[
    {createdAt:createdForAge(60),completedAgeDays:60,cohort:"Days60To90",outboundState:"NoOutboundClickInWindow",coverage:"Observed30CompletedUtcDays"},
    {createdAt:null,completedAgeDays:null,cohort:"Unknown",outboundState:"ReachedAlivoEu",coverage:"Observed30CompletedUtcDays"},
  ]);
  assert.equal(/private-pin/.test(JSON.stringify(safe)),false);
});

test("Pinterest Pin lifecycle UI remains read-only, bounded, descriptive, and history-honest", () => {
  const composition=readFileSync("src/integrations/pinterest/PinterestElectronComposition.ts","utf8"),adapter=readFileSync("src/integrations/pinterest/PinterestMarketSourceAdapter.ts","utf8"),state=readFileSync("ui/pinterest-connection-state.js","utf8"),ui=readFileSync("ui/pinterest.js","utf8"),section=ui.slice(ui.indexOf("function topPinsLifecycleView"),ui.indexOf("function topPinsTable"));
  assert.match(adapter,/createdAt:p\.type==="pin"/);
  assert.match(composition,/pinterestPinLifecycleEvidence\(pin\.createdAt\?\?null,result\.window\?\.endDate\?\?null,metrics\.outboundClicks\)/);
  assert.match(state,/Observed30CompletedUtcDays/);
  for (const text of ["Observed Pin lifecycle","No outbound click yet","It does not mean the Pin failed","Creative variant eligibility is not determined here","complete since-publication click history"]) assert.match(section,new RegExp(text));
  assert.match(section,/sourceRows\.slice\(0,25\)/);
  assert.doesNotMatch(section,/fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|sendBeacon|\.publish\(|\.delete\(|\.edit\(|createElement\("(?:a|img|script|style)"|innerHTML|insertAdjacentHTML/i);
});
