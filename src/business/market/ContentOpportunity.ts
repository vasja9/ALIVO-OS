import { confidence, text } from "./MarketObservation.ts";
import { MarketIntelligenceException } from "./MarketIntelligenceException.ts";

export enum ContentOpportunityType { Blog = "Blog", Book = "Book", Pinterest = "Pinterest", Product = "Product", LandingPage = "Landing Page", FAQ = "FAQ" }
export interface ContentOpportunityProperties { readonly opportunityIdentifier: string; readonly type: ContentOpportunityType; readonly description: string; readonly supportingEvidence: readonly string[]; readonly confidence: number; }
export class ContentOpportunity {
  readonly opportunityIdentifier: string; readonly type: ContentOpportunityType; readonly description: string; readonly supportingEvidence: readonly string[]; readonly confidence: number; readonly recommendationOnly = true;
  constructor(properties: ContentOpportunityProperties) {
    if (!properties || !text(properties.opportunityIdentifier) || !Object.values(ContentOpportunityType).includes(properties.type) || !text(properties.description) || !properties.supportingEvidence?.length || properties.supportingEvidence.some((item) => !text(item)) || !confidence(properties.confidence)) throw new MarketIntelligenceException("Content opportunity is invalid", "INVALID_CONTENT_OPPORTUNITY");
    this.opportunityIdentifier = properties.opportunityIdentifier; this.type = properties.type; this.description = properties.description; this.supportingEvidence = Object.freeze([...properties.supportingEvidence]); this.confidence = properties.confidence; Object.freeze(this);
  }
}
