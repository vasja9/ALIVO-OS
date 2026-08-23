import type { PinterestOrganicAnalyticsWindow } from "./PinterestOrganicAnalytics.ts";

export const PINTEREST_TOP_PINS_METRICS = Object.freeze(["IMPRESSION", "SAVE", "PIN_CLICK", "OUTBOUND_CLICK"] as const);
export type PinterestTopPinsState = "NotRead" | "Available" | "NoData" | "Unavailable" | "RateLimited" | "ReauthorizationRequired" | "Failed";

export interface PinterestTopPin {
  readonly pinId: string;
  readonly impressions: number | null;
  readonly saves: number | null;
  readonly pinClicks: number | null;
  readonly outboundClicks: number | null;
}

export interface PinterestTopPinsResult {
  readonly state: PinterestTopPinsState;
  readonly window: PinterestOrganicAnalyticsWindow | null;
  readonly sortBy: "OUTBOUND_CLICK" | null;
  readonly pins: readonly PinterestTopPin[];
  readonly stale: boolean;
}

const fields = Object.freeze({ IMPRESSION: "impressions", SAVE: "saves", PIN_CLICK: "pinClicks", OUTBOUND_CLICK: "outboundClicks" } as const);
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const hasOwn = (value: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

export function emptyPinterestTopPins(state: PinterestTopPinsState = "NotRead"): PinterestTopPinsResult {
  return Object.freeze({ state, window: null, sortBy: null, pins: Object.freeze([]), stale: false });
}

export function withPinterestTopPinsState(result: PinterestTopPinsResult, state: PinterestTopPinsState): PinterestTopPinsResult {
  if (state === "ReauthorizationRequired") return emptyPinterestTopPins(state);
  if (!result.window || !["Available", "NoData", "Unavailable", "RateLimited", "Failed"].includes(result.state)) return emptyPinterestTopPins(state);
  return Object.freeze({ ...result, state, stale: true });
}

function metric(source: Record<string, unknown>, name: keyof typeof fields): number | null {
  if (!hasOwn(source, name) || source[name] === null) return null;
  const value = source[name];
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) throw new TypeError(`Pinterest Top Pins ${name} is invalid`);
  return value;
}

export function parsePinterestTopPins(body: unknown, window: PinterestOrganicAnalyticsWindow, snapshotPinIds: readonly string[]): PinterestTopPinsResult {
  const root = record(body);
  if (!root || !Array.isArray(root.pins)) throw new TypeError("Pinterest Top Pins response envelope is malformed");
  if (root.pins.length > 25) throw new RangeError("Pinterest Top Pins contains more than 25 entries");
  const allowed = new Set(snapshotPinIds.slice(0, 25));
  const seen = new Set<string>();
  const pins = root.pins.flatMap((raw, index) => {
    const item = record(raw);
    if (!item || typeof item.pin_id !== "string" || !item.pin_id.trim() || item.pin_id !== item.pin_id.trim() || item.pin_id.length > 128) throw new TypeError(`Pinterest Top Pins entry ${index + 1} is malformed`);
    if (seen.has(item.pin_id)) throw new TypeError("Pinterest Top Pins contains duplicate Pin IDs");
    seen.add(item.pin_id);
    const metrics = record(item.metrics);
    if (!metrics) throw new TypeError(`Pinterest Top Pins entry ${index + 1} metrics are malformed`);
    const parsed = Object.fromEntries(PINTEREST_TOP_PINS_METRICS.map(name => [fields[name], metric(metrics, name)])) as Omit<PinterestTopPin, "pinId">;
    return allowed.has(item.pin_id) ? [Object.freeze({ pinId: item.pin_id, ...parsed })] : [];
  });
  return Object.freeze({ state: pins.length ? "Available" : "NoData", window, sortBy: "OUTBOUND_CLICK", pins: Object.freeze(pins), stale: false });
}
