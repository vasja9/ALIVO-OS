import { confidence, text } from "./MarketObservation.ts";
import { MarketIntelligenceException } from "./MarketIntelligenceException.ts";

export enum TrendDirection { Growing = "Growing", Declining = "Declining", Emerging = "Emerging", Seasonal = "Seasonal", Stable = "Stable" }
export interface TrendProperties { readonly trendIdentifier: string; readonly direction: TrendDirection; readonly confidence: number; readonly timeWindow: { readonly start: Date; readonly end: Date }; readonly supportingObservationIds: readonly string[]; }
export class Trend {
  readonly trendIdentifier: string; readonly direction: TrendDirection; readonly confidence: number; readonly supportingObservationIds: readonly string[]; readonly #start: number; readonly #end: number;
  constructor(properties: TrendProperties) {
    this.#start = properties?.timeWindow?.start?.getTime(); this.#end = properties?.timeWindow?.end?.getTime();
    if (!properties || !text(properties.trendIdentifier) || !Object.values(TrendDirection).includes(properties.direction) || !confidence(properties.confidence) || !Number.isFinite(this.#start) || !Number.isFinite(this.#end) || this.#start > this.#end || !properties.supportingObservationIds?.length || properties.supportingObservationIds.some((id) => !text(id))) throw new MarketIntelligenceException("Trend is invalid", "INVALID_TREND");
    this.trendIdentifier = properties.trendIdentifier; this.direction = properties.direction; this.confidence = properties.confidence; this.supportingObservationIds = Object.freeze([...properties.supportingObservationIds]); Object.freeze(this);
  }
  get timeWindow(): Readonly<{ start: Date; end: Date }> { return Object.freeze({ start: new Date(this.#start), end: new Date(this.#end) }); }
}
