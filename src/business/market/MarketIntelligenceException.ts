export class MarketIntelligenceException extends Error {
  constructor(message: string, readonly code: string) {
    super(message); this.name = "MarketIntelligenceException"; Object.freeze(this);
  }
}
