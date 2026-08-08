export class OpportunityIntelligenceException extends Error {
  constructor(message: string, readonly code = "OPPORTUNITY_INTELLIGENCE_ERROR") {
    super(message);
    this.name = "OpportunityIntelligenceException";
  }
}
