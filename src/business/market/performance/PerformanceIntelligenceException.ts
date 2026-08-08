export class PerformanceIntelligenceException extends Error {
  constructor(message: string, readonly code = "PERFORMANCE_INTELLIGENCE_ERROR") {
    super(message);
    this.name = "PerformanceIntelligenceException";
  }
}
