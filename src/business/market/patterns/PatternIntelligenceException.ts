export class PatternIntelligenceException extends Error {
  constructor(message: string, readonly code = "PATTERN_INTELLIGENCE_ERROR", options?: ErrorOptions) {
    super(message, options); this.name = "PatternIntelligenceException";
  }
}
