import { confidence, text } from "./MarketObservation.ts";
import { MarketIntelligenceException } from "./MarketIntelligenceException.ts";

export interface KeywordOpportunityProperties { readonly keyword: string; readonly language: string; readonly searchIntent: string; readonly estimatedOpportunity: number; readonly confidence: number; readonly relatedTopics: readonly string[]; }
export class KeywordOpportunity {
  readonly keyword: string; readonly language: string; readonly searchIntent: string; readonly estimatedOpportunity: number; readonly confidence: number; readonly relatedTopics: readonly string[];
  constructor(properties: KeywordOpportunityProperties) {
    if (!properties || !text(properties.keyword) || !text(properties.language) || !text(properties.searchIntent) || !confidence(properties.estimatedOpportunity) || !confidence(properties.confidence) || !Array.isArray(properties.relatedTopics) || properties.relatedTopics.some((topic) => !text(topic))) throw new MarketIntelligenceException("Keyword opportunity is invalid", "INVALID_KEYWORD_OPPORTUNITY");
    this.keyword = properties.keyword; this.language = properties.language; this.searchIntent = properties.searchIntent; this.estimatedOpportunity = properties.estimatedOpportunity; this.confidence = properties.confidence; this.relatedTopics = Object.freeze([...properties.relatedTopics]); Object.freeze(this);
  }
}
