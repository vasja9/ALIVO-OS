export const PINTEREST_ORGANIC_METRICS = Object.freeze(["IMPRESSION", "SAVE", "PIN_CLICK", "OUTBOUND_CLICK"] as const);
export type PinterestOrganicAnalyticsState = "NotRead" | "Available" | "NoData" | "Unavailable" | "RateLimited" | "ReauthorizationRequired" | "Failed";

export interface PinterestOrganicAnalyticsWindow {
  readonly startDate: string;
  readonly endDate: string;
  readonly completedDays: 30;
}

export interface PinterestOrganicAnalyticsPin {
  readonly pinId: string;
  readonly impressions: number | null;
  readonly saves: number | null;
  readonly pinClicks: number | null;
  readonly outboundClicks: number | null;
}

export interface PinterestOrganicAnalyticsResult {
  readonly state: PinterestOrganicAnalyticsState;
  readonly window: PinterestOrganicAnalyticsWindow | null;
  readonly totals: Omit<PinterestOrganicAnalyticsPin, "pinId"> | null;
  readonly pins: readonly PinterestOrganicAnalyticsPin[];
}

const metricFields = Object.freeze({ IMPRESSION: "impressions", SAVE: "saves", PIN_CLICK: "pinClicks", OUTBOUND_CLICK: "outboundClicks" } as const);
type MutableMetrics = { impressions: number | null; saves: number | null; pinClicks: number | null; outboundClicks: number | null };
const isoDay = (date: Date): string => date.toISOString().slice(0, 10);
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const safeInteger = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const emptyMetrics = (): MutableMetrics => ({ impressions: null, saves: null, pinClicks: null, outboundClicks: null });

export function pinterestCompletedUtcWindow(now: Date): PinterestOrganicAnalyticsWindow {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError("A valid clock value is required");
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = new Date(today - 86_400_000);
  const start = new Date(end.getTime() - 29 * 86_400_000);
  return Object.freeze({ startDate: isoDay(start), endDate: isoDay(end), completedDays: 30 as const });
}

export function emptyPinterestOrganicAnalytics(state: PinterestOrganicAnalyticsState = "NotRead"): PinterestOrganicAnalyticsResult {
  return Object.freeze({ state, window: null, totals: null, pins: Object.freeze([]) });
}

export function withPinterestOrganicAnalyticsState(result: PinterestOrganicAnalyticsResult, state: PinterestOrganicAnalyticsState): PinterestOrganicAnalyticsResult {
  if (state === "ReauthorizationRequired") return emptyPinterestOrganicAnalytics(state);
  return Object.freeze({ ...result, state });
}

export function parsePinterestOrganicAnalytics(body: unknown, submittedPinIds: readonly string[], window: PinterestOrganicAnalyticsWindow): PinterestOrganicAnalyticsResult {
  const allowed = Object.freeze([...new Set(submittedPinIds.filter(id => typeof id === "string" && id.length > 0).slice(0, 25))]);
  const root = record(body);
  if (!root) throw new TypeError("Pinterest analytics response is malformed");
  let usableRecords = 0;
  const pins = allowed.map(pinId => {
    const metrics = emptyMetrics();
    const rawPin = root[pinId];
    const pin = record(rawPin);
    if (rawPin !== undefined && !pin) throw new TypeError("Pinterest analytics Pin record is malformed");
    const rawSummary = pin?.summary_metrics;
    const summary = record(rawSummary);
    if (rawSummary !== undefined && !summary) throw new TypeError("Pinterest analytics summary metrics are malformed");
    if (summary) {
      let usable = false;
      for (const metric of PINTEREST_ORGANIC_METRICS) {
        const value = safeInteger(summary[metric]);
        if (value !== null) {
          metrics[metricFields[metric]] = value;
          usable = true;
        }
      }
      if (usable) usableRecords += 1;
    }
    return Object.freeze({ pinId, ...metrics });
  });
  const totals = emptyMetrics();
  for (const field of Object.values(metricFields)) {
    const values = pins.flatMap(pin => pin[field] === null ? [] : [pin[field]]);
    if (!values.length) continue;
    let total = 0;
    for (const value of values) {
      if (!Number.isSafeInteger(total + value)) throw new RangeError("Pinterest analytics totals exceed the safe integer boundary");
      total += value;
    }
    totals[field] = total;
  }
  return Object.freeze({
    state: usableRecords ? "Available" : "NoData",
    window,
    totals: Object.freeze(totals),
    pins: Object.freeze(pins),
  });
}
