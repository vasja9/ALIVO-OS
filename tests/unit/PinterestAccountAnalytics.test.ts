import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  emptyPinterestAccountAnalytics,
  parsePinterestAccountAnalytics,
  PINTEREST_ACCOUNT_ORGANIC_METRICS,
  withPinterestAccountAnalyticsState,
} from "../../src/integrations/pinterest/PinterestAccountAnalytics.ts";
import { createPinterestElectronComposition } from "../../src/integrations/pinterest/PinterestElectronComposition.ts";
import { pinterestCompletedUtcWindow } from "../../src/integrations/pinterest/PinterestOrganicAnalytics.ts";

const require = createRequire(import.meta.url);
const { createPinterestRuntime, InMemoryPinterestSessionStore, DEFAULT_SCOPES } = require("../../electron/pinterest-runtime.cjs");
const { createPinterestLifecycle } = require("../../electron/pinterest-lifecycle.cjs");
const NOW = new Date("2026-08-19T12:00:00.000Z");
const WINDOW = pinterestCompletedUtcWindow(NOW);
const CONFIGURATION = {
  clientId: "client-id-test",
  clientSecret: "client-secret-test",
  redirectUri: "http://127.0.0.1:49152/pinterest/oauth/callback",
  apiBaseUrl: "https://api.pinterest.com",
  authorizationUrl: "https://www.pinterest.com/oauth/",
  sessionSecret: "session-secret-for-tests-only",
  continuousRefresh: true,
};

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => undefined }, text: async () => JSON.stringify(body) };
}

function officialBody(overrides: Record<string, unknown> = {}) {
  return {
    NO_SPLIT: {
      summary_metrics: { IMPRESSION: 0, SAVE: 2, PIN_CLICK: null, OUTBOUND_CLICK: 1, CTR: 99 },
      daily_metrics: [
        { date: "2026-08-18", metrics: { IMPRESSION: 4, SAVE: null, PIN_CLICK: 0, OUTBOUND_CLICK: 1 }, data_status: "READY", raw_url: "https://provider.invalid" },
        { date: "2026-07-20", metrics: { IMPRESSION: 0, SAVE: 1, OUTBOUND_CLICK: null }, data_status: { provider: "discard" } },
      ],
      account_id: "discard",
      ...overrides,
    },
    date_availability: { latest_available_timestamp: Date.UTC(2026, 7, 17, 23, 59, 59), is_realtime: false, raw: "discard" },
    profile: "discard",
  };
}

test("account analytics parses only official summary, daily, and availability fields", () => {
  const result = parsePinterestAccountAnalytics(officialBody(), WINDOW);
  assert.equal(result.state, "Available");
  assert.deepEqual(result.window, { startDate: "2026-07-20", endDate: "2026-08-18", completedDays: 30 });
  assert.equal(result.latestAvailableDate, "2026-08-17");
  assert.deepEqual(result.totals, { impressions: 0, saves: 2, pinClicks: null, outboundClicks: 1 });
  assert.deepEqual(result.daily, [
    { date: "2026-07-20", impressions: 0, saves: 1, pinClicks: null, outboundClicks: null },
    { date: "2026-08-18", impressions: 4, saves: null, pinClicks: 0, outboundClicks: 1 },
  ]);
  assert.equal(result.stale, false);
  assert.equal(/CTR|account|profile|provider|url|data_status|timestamp|is_realtime/i.test(JSON.stringify(result)), false);
});

test("account analytics distinguishes explicit zero from missing and valid no-data", () => {
  const zero = parsePinterestAccountAnalytics({ TOTAL: { summary_metrics: { IMPRESSION: 0 }, daily_metrics: [] } }, WINDOW);
  assert.equal(zero.state, "Available");
  assert.deepEqual(zero.totals, { impressions: 0, saves: null, pinClicks: null, outboundClicks: null });
  const noData = parsePinterestAccountAnalytics({ TOTAL: { summary_metrics: {}, daily_metrics: [{ date: WINDOW.startDate, metrics: { IMPRESSION: null } }] } }, WINDOW);
  assert.equal(noData.state, "NoData");
  assert.equal(noData.totals, null);
  assert.equal(noData.daily[0].impressions, null);
});

test("account analytics rejects non-integer, negative, non-finite, unsafe, and coerced metrics", () => {
  for (const invalid of ["1", 1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parsePinterestAccountAnalytics({ TOTAL: { summary_metrics: { IMPRESSION: invalid }, daily_metrics: [] } }, WINDOW), /invalid/);
    assert.throws(() => parsePinterestAccountAnalytics({ TOTAL: { summary_metrics: {}, daily_metrics: [{ date: WINDOW.startDate, metrics: { SAVE: invalid } }] } }, WINDOW), /invalid/);
  }
});

test("account analytics enforces the bounded unique in-window daily shape", () => {
  const days = Array.from({ length: 31 }, (_, index) => ({ date: new Date(Date.UTC(2026, 6, 19 + index)).toISOString().slice(0, 10), metrics: {} }));
  assert.throws(() => parsePinterestAccountAnalytics({ TOTAL: { daily_metrics: days } }, WINDOW), /more than 30/);
  for (const daily of [
    [{ date: WINDOW.startDate, metrics: {} }, { date: WINDOW.startDate, metrics: {} }],
    [{ date: "2026-02-30", metrics: {} }],
    [{ date: "2026-07-19", metrics: {} }],
    [{ date: "2026-08-19", metrics: {} }],
  ]) assert.throws(() => parsePinterestAccountAnalytics({ TOTAL: { daily_metrics: daily } }, WINDOW), /duplicate, malformed, or out-of-window/);
  assert.throws(() => parsePinterestAccountAnalytics({ TOTAL: { daily_metrics: "invalid" } }, WINDOW), /daily metrics are malformed/);
  assert.throws(() => parsePinterestAccountAnalytics({ A: { daily_metrics: [] }, B: { summary_metrics: {} } }, WINDOW), /multiple metric groups/);
});

test("account analytics prevents aggregate overflow without inventing summary totals", () => {
  assert.throws(() => parsePinterestAccountAnalytics({ TOTAL: { daily_metrics: [
    { date: WINDOW.startDate, metrics: { IMPRESSION: Number.MAX_SAFE_INTEGER } },
    { date: WINDOW.endDate, metrics: { IMPRESSION: 1 } },
  ] } }, WINDOW), /aggregate exceeds/);
  const dailyOnly = parsePinterestAccountAnalytics({ TOTAL: { daily_metrics: [{ date: WINDOW.startDate, metrics: { SAVE: 3 } }] } }, WINDOW);
  assert.equal(dailyOnly.state, "Available");
  assert.equal(dailyOnly.totals, null);
});

test("availability accepts only a valid finite timestamp or canonical date and omits invalid metadata", () => {
  assert.equal(parsePinterestAccountAnalytics({ TOTAL: {}, date_availability: { latest_available_date: "2026-08-16" } }, WINDOW).latestAvailableDate, "2026-08-16");
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -1, "2026-02-30", "2026-08-17T12:00:00Z", { raw: true }]) {
    assert.equal(parsePinterestAccountAnalytics({ TOTAL: {}, date_availability: { latest_available_timestamp: invalid } }, WINDOW).latestAvailableDate, null);
  }
});

test("completed UTC windows are deterministic across month, year, and leap-year boundaries", () => {
  assert.deepEqual(pinterestCompletedUtcWindow(new Date("2026-03-01T00:00:00.000Z")), { startDate: "2026-01-30", endDate: "2026-02-28", completedDays: 30 });
  assert.deepEqual(pinterestCompletedUtcWindow(new Date("2026-01-01T23:59:59.999Z")), { startDate: "2025-12-02", endDate: "2025-12-31", completedDays: 30 });
  assert.deepEqual(pinterestCompletedUtcWindow(new Date("2024-03-01T12:00:00.000Z")), { startDate: "2024-01-31", endDate: "2024-02-29", completedDays: 30 });
});

test("account snapshot state retains only valid data as stale and clears on reauthorization", () => {
  const valid = parsePinterestAccountAnalytics(officialBody(), WINDOW);
  for (const state of ["Unavailable", "RateLimited", "Failed"] as const) {
    const stale = withPinterestAccountAnalyticsState(valid, state);
    assert.equal(stale.state, state);
    assert.equal(stale.stale, true);
    assert.deepEqual(stale.daily, valid.daily);
  }
  assert.deepEqual(withPinterestAccountAnalyticsState(valid, "ReauthorizationRequired"), emptyPinterestAccountAnalytics("ReauthorizationRequired"));
});

test("composition issues one deterministic organic account request and keeps Pin analytics isolated", async () => {
  let accountRequests = 0, pinAnalyticsRequests = 0, pinRequests = 0;
  let accountStatus = 200, accountBody: unknown = officialBody(), accountThrows = false;
  let accountUrl: URL | undefined;
  const runtime = createPinterestRuntime({
    configuration: CONFIGURATION,
    sessionStore: new InMemoryPinterestSessionStore({ "credential:pinterest:alivo": { accessToken: "access-secret", expiresAt: "2026-09-19T12:00:00.000Z", businessPackageId: "ALIVO" } }),
    fetchImpl: async (input: unknown) => {
      const url = new URL(String(input));
      if (url.pathname === "/v5/user_account/analytics") { accountRequests += 1; accountUrl = url; if (accountThrows) throw new Error("network detail"); return response(accountStatus, accountBody); }
      if (url.pathname === "/v5/pins/analytics") { pinAnalyticsRequests += 1; return response(200, { "pin-1": { summary_metrics: { IMPRESSION: 1, SAVE: 0, PIN_CLICK: 0, OUTBOUND_CLICK: 0 } } }); }
      if (url.pathname === "/v5/pins") { pinRequests += 1; return response(200, { items: [{ id: "pin-1", title: "Pin", created_at: "2026-08-18T12:00:00.000Z" }] }); }
      return response(500, {});
    },
    now: () => NOW,
  });
  const composition = createPinterestElectronComposition({ registration: runtime.getProviderRegistration(), credentialId: "credential:pinterest:alivo", businessPackageId: "ALIVO", apiBaseUrl: CONFIGURATION.apiBaseUrl, clock: () => NOW, thumbnailFetcher: async () => null });
  await composition.verifyConnection({ requestedCapabilities: ["OwnPins"] });
  await composition.readObservation({ capability: "OwnPins", pageSize: 25 });
  assert.equal(accountRequests, 0);
  const pinResult = await composition.readPerformance();
  assert.equal(pinResult.state, "Available");
  assert.equal(pinAnalyticsRequests, 1);
  assert.equal(accountRequests, 0);
  const account = await composition.readAccountPerformance({ correlationIdentifier: "explicit-account-action" });
  assert.equal(accountRequests, 1);
  assert.equal(pinAnalyticsRequests, 1);
  assert.equal(account.state, "Available");
  assert.equal(pinRequests > 0, true);
  assert.equal(accountUrl!.pathname, "/v5/user_account/analytics");
  assert.equal(accountUrl!.search, "?start_date=2026-07-20&end_date=2026-08-18&from_claimed_content=BOTH&pin_format=ALL&app_types=ALL&metric_types=IMPRESSION%2CSAVE%2CPIN_CLICK%2COUTBOUND_CLICK&split_field=NO_SPLIT&content_type=ORGANIC");
  assert.deepEqual(Object.fromEntries(accountUrl!.searchParams), { start_date: "2026-07-20", end_date: "2026-08-18", from_claimed_content: "BOTH", pin_format: "ALL", app_types: "ALL", metric_types: "IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK", split_field: "NO_SPLIT", content_type: "ORGANIC" });
  assert.equal(accountUrl!.search.includes("source=ORGANIC"), false);
  assert.equal(accountUrl!.searchParams.has("source"), false);
  for (const forbidden of ["ad_account_id", "bookmark", "page_size", "cursor", "report", "report_id", "retry", "retries", "top_pins"]) assert.equal(accountUrl!.searchParams.has(forbidden), false);
  assert.deepEqual(accountUrl!.searchParams.get("metric_types")?.split(","), [...PINTEREST_ACCOUNT_ORGANIC_METRICS]);
  assert.deepEqual(PINTEREST_ACCOUNT_ORGANIC_METRICS, ["IMPRESSION", "SAVE", "PIN_CLICK", "OUTBOUND_CLICK"]);
  assert.deepEqual(DEFAULT_SCOPES, ["boards:read", "pins:read", "user_accounts:read"]);
  assert.equal(DEFAULT_SCOPES.includes("analytics:read"), false);

  for (const status of [401, 403]) {
    accountStatus = status;
    const isolated = await composition.readAccountPerformance();
    assert.equal(isolated.state, "Unavailable");
    assert.equal(isolated.stale, true);
    assert.equal((await runtime.status("credential:pinterest:alivo")).state, "Authenticated");
    assert.equal((await composition.readPerformance()).state, "Available");
  }
  accountStatus = 429;
  assert.equal((await composition.readAccountPerformance()).state, "RateLimited");
  accountStatus = 500;
  assert.equal((await composition.readAccountPerformance()).state, "Failed");
  accountStatus = 200; accountThrows = true;
  assert.equal((await composition.readAccountPerformance()).state, "Failed");
  accountThrows = false; accountBody = [];
  assert.equal((await composition.readAccountPerformance()).state, "Failed");
  const beforeUnauthenticated = accountRequests;
  await runtime.authentication.reportProviderFailure({ credentialId: "credential:pinterest:alivo" }, "ReauthorizationRequired");
  const unauthenticated = await composition.readAccountPerformance();
  assert.deepEqual(unauthenticated, emptyPinterestAccountAnalytics("ReauthorizationRequired"));
  assert.equal(accountRequests, beforeUnauthenticated);
  await runtime.close();
});

test("lifecycle clears account state on real unauthentication and credentials reconfiguration", async () => {
  let status = "Authenticated", generation = 0, clearCalls = 0, compositionInstances = 0;
  const lifecycle = createPinterestLifecycle({
    resolveConfiguration: async () => ({}),
    createRuntime: () => ({ status: async () => ({ state: status }), close: async () => {}, startAuthorization: async () => ({}), }),
    createComposition: () => {
      const instance = ++compositionInstances;
      return { readAccountPerformance: async () => ({ state: instance === 1 ? "Available" : "NotRead" }), clearAccountPerformance: () => { clearCalls += 1; }, verifyConnection: async () => ({}), readObservation: async () => ({}), readPerformance: async () => ({}) };
    },
    clearSessionFile: async () => { generation += 1; },
  });
  assert.equal((await lifecycle.readAccountPerformance()).state, "Available");
  await lifecycle.status("credential:pinterest:alivo");
  assert.equal(clearCalls, 0);
  status = "AuthenticationRequired";
  await lifecycle.status("credential:pinterest:alivo");
  assert.equal(clearCalls, 1);
  await lifecycle.reconfigure(async () => ({ configured: false }));
  assert.equal(generation, 1);
  assert.equal((await lifecycle.readAccountPerformance()).state, "NotRead");
  assert.equal(compositionInstances, 2);
});

test("account analytics has a separate trusted IPC channel and no renderer transport or persistence", () => {
  const preload = readFileSync("electron/preload.cjs", "utf8"), main = readFileSync("electron/main.cjs", "utf8"), controller = readFileSync("electron/pinterest-ipc-controller.cjs", "utf8"), ui = readFileSync("ui/pinterest.js", "utf8");
  assert.match(preload, /readAccountPerformance:.*pinterest:account-performance:read/);
  assert.match(preload, /readPerformance:.*pinterest:performance:read/);
  assert.match(main, /pinterest:account-performance:read[\s\S]*assertTrustedPinterestSender[\s\S]*readAccountPerformance/);
  assert.match(controller, /async readAccountPerformance[\s\S]*getLifecycle\(\)\.readAccountPerformance/);
  assert.doesNotMatch(ui, /fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|innerHTML|\.href\s*=/);
});
