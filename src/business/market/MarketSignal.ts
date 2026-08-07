import { confidence, text } from "./MarketObservation.ts";
import { MarketIntelligenceException } from "./MarketIntelligenceException.ts";

export enum MarketSignalType { GrowingKeyword = "GrowingKeyword", DecliningKeyword = "DecliningKeyword", EmergingTopic = "EmergingTopic", SeasonalTopic = "SeasonalTopic", CompetitorActivity = "CompetitorActivity", TrafficOpportunity = "TrafficOpportunity" }
export interface MarketSignalProperties { readonly signalIdentifier: string; readonly type: MarketSignalType; readonly confidence: number; readonly supportingObservationIds: readonly string[]; }
export class MarketSignal {
  readonly signalIdentifier: string; readonly type: MarketSignalType; readonly confidence: number; readonly supportingObservationIds: readonly string[];
  constructor(properties: MarketSignalProperties) {
    if (!properties || !text(properties.signalIdentifier) || !Object.values(MarketSignalType).includes(properties.type) || !confidence(properties.confidence) || !properties.supportingObservationIds?.length || properties.supportingObservationIds.some((id) => !text(id))) throw new MarketIntelligenceException("Market signal is invalid", "INVALID_SIGNAL");
    this.signalIdentifier = properties.signalIdentifier; this.type = properties.type; this.confidence = properties.confidence; this.supportingObservationIds = Object.freeze([...properties.supportingObservationIds]); Object.freeze(this);
  }
}
