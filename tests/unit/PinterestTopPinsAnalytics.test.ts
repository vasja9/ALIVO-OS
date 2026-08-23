import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { emptyPinterestTopPins, parsePinterestTopPins, withPinterestTopPinsState } from "../../src/integrations/pinterest/PinterestTopPinsAnalytics.ts";

const window = Object.freeze({ startDate: "2026-07-24", endDate: "2026-08-22", completedDays: 30 as const });
const metrics = (overrides: Record<string, unknown> = {}) => ({ IMPRESSION: 0, SAVE: null, PIN_CLICK: 2, OUTBOUND_CLICK: 3, ...overrides });

test("Top Pins parses only the documented bounded envelope and safely joins in endpoint order", () => {
  const result=parsePinterestTopPins({pins:[{pin_id:"unknown",metrics:metrics({IMPRESSION:999}),providerPayload:{secret:true}},{pin_id:"pin-2",metrics:metrics()},{pin_id:"pin-1",metrics:metrics({SAVE:0})}],data_status:"READY",sort_by:"OUTBOUND_CLICK",date_availability:{secret:true}},window,["pin-1","pin-2"]);
  assert.equal(result.state,"Available");assert.deepEqual(result.pins.map(pin=>pin.pinId),["pin-2","pin-1"]);assert.equal(result.pins[0].impressions,0);assert.equal(result.pins[0].saves,null);assert.equal(result.pins[1].saves,0);
  assert.equal(/provider|secret|data_status|date_availability|url|token/i.test(JSON.stringify(result)),false);
  assert.equal(parsePinterestTopPins({pins:[{pin_id:"unknown",metrics:metrics()}]},window,["pin-1"]).state,"NoData");
});

test("Top Pins parser rejects malformed variants, duplicates, excess rows, and invalid metrics", () => {
  for(const body of [null,{}, {pins:{}},{items:[]},{pins:[null]},{pins:[{pin_id:"",metrics:metrics()}]},{pins:[{pin_id:"pin-1",metrics:null}]},{pins:[{pin_id:"pin-1",metrics:metrics()},{pin_id:"pin-1",metrics:metrics()}]}, {pins:Array.from({length:26},(_,i)=>({pin_id:`pin-${i}`,metrics:metrics()}))}]) assert.throws(()=>parsePinterestTopPins(body,window,["pin-1"]));
  for(const invalid of ["1",1.5,-1,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>parsePinterestTopPins({pins:[{pin_id:"pin-1",metrics:metrics({IMPRESSION:invalid})}]},window,["pin-1"]));
});

test("Top Pins state retains prior valid data only as stale and clears on authentication loss", () => {
  const valid=parsePinterestTopPins({pins:[{pin_id:"pin-1",metrics:metrics()}]},window,["pin-1"]);
  for(const state of ["Unavailable","RateLimited","Failed"] as const){const retained=withPinterestTopPinsState(valid,state);assert.equal(retained.stale,true);assert.equal(retained.pins.length,1)}
  assert.deepEqual(withPinterestTopPinsState(valid,"ReauthorizationRequired"),emptyPinterestTopPins("ReauthorizationRequired"));
});

test("Top Pins wiring is explicit, trusted, read-only, and contains the exact request contract", () => {
  const composition=readFileSync("src/integrations/pinterest/PinterestElectronComposition.ts","utf8"),preload=readFileSync("electron/preload.cjs","utf8"),main=readFileSync("electron/main.cjs","utf8"),lifecycle=readFileSync("electron/pinterest-lifecycle.cjs","utf8"),ui=readFileSync("ui/pinterest.js","utf8");
  assert.match(composition,/path:"\/v5\/user_account\/analytics\/top_pins"/);
  for(const pair of ['start_date:window.startDate','end_date:window.endDate','sort_by:"OUTBOUND_CLICK"','from_claimed_content:"BOTH"','pin_format:"ALL"','app_types:"ALL"','content_type:"ORGANIC"','metric_types:PINTEREST_TOP_PINS_METRICS.join(",")','num_of_pins:"25"'])assert.equal(composition.includes(pair),true,pair);
  const query=composition.match(/path:"\/v5\/user_account\/analytics\/top_pins",query:\{([^}]*)\}/)?.[1]??"";
  for(const omitted of ["source","ad_account_id","created_in_last_n_days","pagination","report","retry","paid","advertising"])assert.doesNotMatch(query,new RegExp(omitted,"i"));
  assert.match(preload,/readTopPins:.*pinterest:top-pins:read/);assert.match(lifecycle,/readTopPins:.*readTopPins/);assert.match(main,/ipcMain\.handle\("pinterest:top-pins:read"[\s\S]*?assertTrustedPinterestSender/);
  assert.match(ui,/Top organic Pins · Read-only/);assert.match(ui,/Read Top Pins/);assert.doesNotMatch(ui,/innerHTML|createElement\("a"|\.href\s*=/);
});
