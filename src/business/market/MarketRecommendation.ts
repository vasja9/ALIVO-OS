import { confidence, text } from "./MarketObservation.ts";
import { MarketIntelligenceException } from "./MarketIntelligenceException.ts";

export enum RecommendationPriority { Low = "Low", Medium = "Medium", High = "High" }
export interface MarketRecommendationProperties { readonly recommendationIdentifier: string; readonly description: string; readonly priority: RecommendationPriority; readonly supportingEvidence: readonly string[]; readonly confidence: number; readonly recommendedCapability: string; }
export class MarketRecommendation {
  readonly recommendationIdentifier: string; readonly description: string; readonly priority: RecommendationPriority; readonly supportingEvidence: readonly string[]; readonly confidence: number; readonly recommendedCapability: string; readonly advisory = true;
  constructor(properties: MarketRecommendationProperties) {
    if (!properties || !text(properties.recommendationIdentifier) || !text(properties.description) || !Object.values(RecommendationPriority).includes(properties.priority) || !properties.supportingEvidence?.length || properties.supportingEvidence.some((item) => !text(item)) || !confidence(properties.confidence) || !text(properties.recommendedCapability)) throw new MarketIntelligenceException("Market recommendation is invalid", "INVALID_RECOMMENDATION");
    this.recommendationIdentifier = properties.recommendationIdentifier; this.description = properties.description; this.priority = properties.priority; this.supportingEvidence = Object.freeze([...properties.supportingEvidence]); this.confidence = properties.confidence; this.recommendedCapability = properties.recommendedCapability; Object.freeze(this);
  }
}
