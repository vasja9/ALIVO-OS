import assert from "node:assert/strict";
import test from "node:test";
import { emptyPinterestOrganicAnalytics, parsePinterestOrganicAnalytics, pinterestCompletedUtcWindow, PINTEREST_ORGANIC_METRICS } from "../../src/integrations/pinterest/PinterestOrganicAnalytics.ts";

test("completed UTC window covers exactly 30 completed days across boundaries", () => {
  assert.deepEqual(pinterestCompletedUtcWindow(new Date("2026-01-01T00:00:00.000Z")), { startDate: "2025-12-02", endDate: "2025-12-31", completedDays: 30 });
  assert.deepEqual(pinterestCompletedUtcWindow(new Date("2024-03-01T23:59:59.999Z")), { startDate: "2024-01-31", endDate: "2024-02-29", completedDays: 30 });
  assert.deepEqual(pinterestCompletedUtcWindow(new Date("2025-03-01T12:00:00.000Z")), { startDate: "2025-01-30", endDate: "2025-02-28", completedDays: 30 });
});

test("bulk parsing uses summary_metrics, preserves order, zero, and missing nulls", () => {
  const result = parsePinterestOrganicAnalytics({
    unknown: { summary_metrics: { IMPRESSION: 999 } },
    a: { summary_metrics: { IMPRESSION: 0, SAVE: 2, PIN_CLICK: 3, OUTBOUND_CLICK: 1, UNKNOWN: 500 }, daily_metrics: [{ IMPRESSION: 100 }] },
    b: { summary_metrics: { IMPRESSION: 5 } },
  }, ["b", "a"], pinterestCompletedUtcWindow(new Date("2026-08-23T01:00:00Z")));
  assert.equal(result.state, "Available");
  assert.deepEqual(result.pins, [
    { pinId: "b", impressions: 5, saves: null, pinClicks: null, outboundClicks: null },
    { pinId: "a", impressions: 0, saves: 2, pinClicks: 3, outboundClicks: 1 },
  ]);
  assert.deepEqual(result.totals, { impressions: 5, saves: 2, pinClicks: 3, outboundClicks: 1 });
  assert.equal(JSON.stringify(result).includes("unknown"), false);
});

test("invalid metric values are discarded and no usable records is NoData", () => {
  const values = [-1, 1.5, "2", Number.POSITIVE_INFINITY, Number.NaN, Number.MAX_SAFE_INTEGER + 1];
  for (const value of values) {
    const result = parsePinterestOrganicAnalytics({ a: { summary_metrics: { IMPRESSION: value } } }, ["a"], pinterestCompletedUtcWindow(new Date("2026-08-23T00:00:00Z")));
    assert.equal(result.state, "NoData");
    assert.equal(result.pins[0].impressions, null);
  }
  assert.throws(() => parsePinterestOrganicAnalytics(null, ["a"], pinterestCompletedUtcWindow(new Date("2026-08-23T00:00:00Z"))), /malformed/);
  assert.throws(() => parsePinterestOrganicAnalytics({ a: "raw-provider-record" }, ["a"], pinterestCompletedUtcWindow(new Date("2026-08-23T00:00:00Z"))), /Pin record is malformed/);
  assert.throws(() => parsePinterestOrganicAnalytics({ a: { summary_metrics: [] } }, ["a"], pinterestCompletedUtcWindow(new Date("2026-08-23T00:00:00Z"))), /summary metrics are malformed/);
});

test("totals reject safe-integer overflow and results are bounded", () => {
  assert.throws(() => parsePinterestOrganicAnalytics({ a: { summary_metrics: { IMPRESSION: Number.MAX_SAFE_INTEGER } }, b: { summary_metrics: { IMPRESSION: 1 } } }, ["a", "b"], pinterestCompletedUtcWindow(new Date("2026-08-23T00:00:00Z"))), /safe integer boundary/);
  const ids = Array.from({ length: 30 }, (_, index) => `pin-${index}`);
  const body = Object.fromEntries(ids.map(id => [id, { summary_metrics: { SAVE: 1 } }]));
  assert.equal(parsePinterestOrganicAnalytics(body, ids, pinterestCompletedUtcWindow(new Date("2026-08-23T00:00:00Z"))).pins.length, 25);
  assert.deepEqual(PINTEREST_ORGANIC_METRICS, ["IMPRESSION", "SAVE", "PIN_CLICK", "OUTBOUND_CLICK"]);
  assert.deepEqual(emptyPinterestOrganicAnalytics(), { state: "NotRead", window: null, totals: null, pins: [] });
});
