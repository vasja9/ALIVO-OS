import { text } from "./MarketObservation.ts";
import { MarketIntelligenceException } from "./MarketIntelligenceException.ts";

export interface CompetitorObservationProperties { readonly publicSource: string; readonly observation: string; readonly timestamp: Date; readonly category: string; }
export class CompetitorObservation {
  readonly publicSource: string; readonly observation: string; readonly category: string; readonly #timestamp: number;
  constructor(properties: CompetitorObservationProperties) {
    this.#timestamp = properties?.timestamp?.getTime();
    if (!properties || !text(properties.publicSource) || !text(properties.observation) || !text(properties.category) || !Number.isFinite(this.#timestamp)) throw new MarketIntelligenceException("Competitor observation is invalid", "INVALID_COMPETITOR_OBSERVATION");
    this.publicSource = properties.publicSource; this.observation = properties.observation; this.category = properties.category; Object.freeze(this);
  }
  get timestamp(): Date { return new Date(this.#timestamp); }
}
