export const PINTEREST_ACCOUNT_ORGANIC_METRICS = Object.freeze(["IMPRESSION", "SAVE", "PIN_CLICK", "OUTBOUND_CLICK"] as const);
export type PinterestAccountAnalyticsState = "NotRead" | "Available" | "NoData" | "Unavailable" | "RateLimited" | "ReauthorizationRequired" | "Failed";

export interface PinterestAccountAnalyticsWindow {
  readonly startDate: string;
  readonly endDate: string;
  readonly completedDays: 30;
}

export interface PinterestAccountAnalyticsMetrics {
  readonly impressions: number | null;
  readonly saves: number | null;
  readonly pinClicks: number | null;
  readonly outboundClicks: number | null;
}

export interface PinterestAccountAnalyticsDaily extends PinterestAccountAnalyticsMetrics {
  readonly date: string;
}

export interface PinterestAccountAnalyticsResult {
  readonly state: PinterestAccountAnalyticsState;
  readonly window: PinterestAccountAnalyticsWindow | null;
  readonly latestAvailableDate: string | null;
  readonly totals: PinterestAccountAnalyticsMetrics | null;
  readonly daily: readonly PinterestAccountAnalyticsDaily[];
  readonly stale: boolean;
}

const metricFields = Object.freeze({ IMPRESSION: "impressions", SAVE: "saves", PIN_CLICK: "pinClicks", OUTBOUND_CLICK: "outboundClicks" } as const);
type MutableMetrics = { impressions: number | null; saves: number | null; pinClicks: number | null; outboundClicks: number | null };
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const emptyMetrics = (): MutableMetrics => ({ impressions: null, saves: null, pinClicks: null, outboundClicks: null });
const isoDay = (date: Date): string => date.toISOString().slice(0, 10);
const hasOwn = (value: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

function validDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && isoDay(parsed) === value;
}

function requestedMetrics(value: unknown, field: string): { metrics: MutableMetrics; usable: boolean } {
  if (value === undefined) return { metrics: emptyMetrics(), usable: false };
  const source = record(value);
  if (!source) throw new TypeError(`Pinterest account analytics ${field} metrics are malformed`);
  const metrics = emptyMetrics();
  let usable = false;
  for (const metric of PINTEREST_ACCOUNT_ORGANIC_METRICS) {
    if (!hasOwn(source, metric) || source[metric] === null || source[metric] === undefined) continue;
    const candidate = source[metric];
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || !Number.isSafeInteger(candidate) || candidate < 0) {
      throw new TypeError(`Pinterest account analytics ${metric} is invalid`);
    }
    metrics[metricFields[metric]] = candidate;
    usable = true;
  }
  return { metrics, usable };
}

function latestAvailableDay(value: unknown): string | null {
  const availability = record(value);
  if (!availability) return null;
  const candidate = availability.latest_available_timestamp ?? availability.latest_available_date;
  if (validDay(candidate)) return candidate;
  if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) return null;
  const parsed = new Date(candidate);
  return Number.isFinite(parsed.getTime()) ? isoDay(parsed) : null;
}

function metricsEnvelope(root: Record<string, unknown>): Record<string, unknown> | undefined {
  const candidates = Object.entries(root).flatMap(([key, value]) => {
    if (key === "date_availability") return [];
    const candidate = record(value);
    return candidate && (hasOwn(candidate, "daily_metrics") || hasOwn(candidate, "summary_metrics")) ? [candidate] : [];
  });
  if (candidates.length > 1) throw new TypeError("Pinterest account analytics NO_SPLIT response contains multiple metric groups");
  if (candidates.length === 1) return candidates[0];
  const objectValues = Object.entries(root).flatMap(([key, value]) => key === "date_availability" ? [] : record(value) ? [record(value)!] : []);
  return objectValues.length === 1 ? objectValues[0] : undefined;
}

export function emptyPinterestAccountAnalytics(state: PinterestAccountAnalyticsState = "NotRead"): PinterestAccountAnalyticsResult {
  return Object.freeze({ state, window: null, latestAvailableDate: null, totals: null, daily: Object.freeze([]), stale: false });
}

export function withPinterestAccountAnalyticsState(result: PinterestAccountAnalyticsResult, state: PinterestAccountAnalyticsState): PinterestAccountAnalyticsResult {
  if (state === "ReauthorizationRequired") return emptyPinterestAccountAnalytics(state);
  if (!result.window || !["Available", "NoData", "Unavailable", "RateLimited", "Failed"].includes(result.state)) return emptyPinterestAccountAnalytics(state);
  return Object.freeze({ ...result, state, stale: true });
}

export function parsePinterestAccountAnalytics(body: unknown, window: PinterestAccountAnalyticsWindow): PinterestAccountAnalyticsResult {
  const root = record(body);
  if (!root) throw new TypeError("Pinterest account analytics response is malformed");
  const envelope = metricsEnvelope(root);
  if (!envelope) return Object.freeze({ ...emptyPinterestAccountAnalytics("NoData"), window });
  const summary = requestedMetrics(envelope.summary_metrics, "summary");
  const rawDaily = envelope.daily_metrics;
  if (rawDaily !== undefined && !Array.isArray(rawDaily)) throw new TypeError("Pinterest account analytics daily metrics are malformed");
  if (Array.isArray(rawDaily) && rawDaily.length > 30) throw new RangeError("Pinterest account analytics contains more than 30 daily records");
  const seen = new Set<string>();
  let dailyUsable = false;
  const aggregates = Object.fromEntries(Object.values(metricFields).map(field => [field, 0])) as Record<keyof MutableMetrics, number>;
  const daily = (rawDaily ?? []).map((raw, index) => {
    const item = record(raw);
    if (!item) throw new TypeError(`Pinterest account analytics daily record ${index + 1} is malformed`);
    if (!validDay(item.date) || item.date < window.startDate || item.date > window.endDate || seen.has(item.date)) {
      throw new TypeError("Pinterest account analytics contains a duplicate, malformed, or out-of-window date");
    }
    seen.add(item.date);
    const parsed = requestedMetrics(item.metrics, "daily");
    dailyUsable ||= parsed.usable;
    for (const field of Object.values(metricFields)) {
      const value = parsed.metrics[field];
      if (value === null) continue;
      if (aggregates[field] > Number.MAX_SAFE_INTEGER - value) throw new RangeError("Pinterest account analytics aggregate exceeds the safe integer boundary");
      aggregates[field] += value;
    }
    return Object.freeze({ date: item.date, ...parsed.metrics });
  }).sort((left, right) => left.date.localeCompare(right.date));
  return Object.freeze({
    state: summary.usable || dailyUsable ? "Available" : "NoData",
    window,
    latestAvailableDate: latestAvailableDay(root.date_availability),
    totals: summary.usable ? Object.freeze(summary.metrics) : null,
    daily: Object.freeze(daily),
    stale: false,
  });
}
