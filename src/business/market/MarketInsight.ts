import { ContentOpportunity } from "./ContentOpportunity.ts";
import { KeywordOpportunity } from "./KeywordOpportunity.ts";
import { confidence, text } from "./MarketObservation.ts";
import { MarketIntelligenceException } from "./MarketIntelligenceException.ts";

export interface MarketInsightProperties { readonly summary: string; readonly supportingEvidence: readonly string[]; readonly confidence: number; readonly relatedOpportunities: readonly (KeywordOpportunity | ContentOpportunity)[]; }
export class MarketInsight {
  readonly summary: string; readonly supportingEvidence: readonly string[]; readonly confidence: number; readonly relatedOpportunities: readonly (KeywordOpportunity | ContentOpportunity)[];
  constructor(properties: MarketInsightProperties) {
    if (!properties || !text(properties.summary) || !properties.supportingEvidence?.length || properties.supportingEvidence.some((item) => !text(item)) || !confidence(properties.confidence) || !Array.isArray(properties.relatedOpportunities) || properties.relatedOpportunities.some((item) => !(item instanceof KeywordOpportunity) && !(item instanceof ContentOpportunity))) throw new MarketIntelligenceException("Market insight is invalid", "INVALID_INSIGHT");
    this.summary = properties.summary; this.supportingEvidence = Object.freeze([...properties.supportingEvidence]); this.confidence = properties.confidence; this.relatedOpportunities = Object.freeze([...properties.relatedOpportunities]); Object.freeze(this);
  }
}
