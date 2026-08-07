import { MarketIntelligenceException } from "./MarketIntelligenceException.ts";
import { MarketSource } from "./MarketSource.ts";

export interface MarketObservationProperties { readonly observationId: string; readonly source: MarketSource; readonly timestamp: Date; readonly category: string; readonly language: string; readonly confidence: number; readonly evidence: readonly string[]; }
export class MarketObservation {
  readonly observationId: string; readonly source: MarketSource; readonly category: string; readonly language: string; readonly confidence: number; readonly evidence: readonly string[]; readonly #timestamp: number;
  constructor(properties: MarketObservationProperties) {
    if (!properties || !text(properties.observationId) || !Object.values(MarketSource).includes(properties.source) || !text(properties.category) || !text(properties.language)) throw new MarketIntelligenceException("Observation classification is invalid", "INVALID_OBSERVATION");
    this.#timestamp = properties.timestamp?.getTime();
    if (!Number.isFinite(this.#timestamp) || !confidence(properties.confidence) || !Array.isArray(properties.evidence) || properties.evidence.length === 0 || properties.evidence.some((item) => !text(item))) throw new MarketIntelligenceException("Observation evidence, timestamp, or confidence is invalid", "INVALID_OBSERVATION");
    this.observationId = properties.observationId; this.source = properties.source; this.category = properties.category; this.language = properties.language; this.confidence = properties.confidence; this.evidence = Object.freeze([...properties.evidence]); Object.freeze(this);
  }
  get timestamp(): Date { return new Date(this.#timestamp); }
}
export const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
export const confidence = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
