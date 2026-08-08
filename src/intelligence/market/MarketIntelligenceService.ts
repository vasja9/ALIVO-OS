import {
  Evidence,
  EvidenceId,
  MarketIntelligenceError,
  MarketObservation,
  MarketSource,
  MarketSourceId,
  ObservationId,
} from "./MarketIntelligenceDomain.ts";

export interface MarketIntelligenceService {
  registerSource(source: MarketSource): void;
  source(id: MarketSourceId): MarketSource | undefined;
  sources(): readonly MarketSource[];
  registerObservation(observation: MarketObservation): void;
  observation(id: ObservationId): MarketObservation | undefined;
  registerEvidence(evidence: Evidence): void;
  evidence(id: EvidenceId): Evidence | undefined;
}

export class InMemoryMarketIntelligenceService implements MarketIntelligenceService {
  readonly #sources = new Map<string, MarketSource>();
  readonly #observations = new Map<string, MarketObservation>();
  readonly #evidence = new Map<string, Evidence>();

  registerSource(source: MarketSource): void {
    this.add(this.#sources, source.id.value, source, "source");
  }
  source(id: MarketSourceId): MarketSource | undefined { return this.#sources.get(id.value); }
  sources(): readonly MarketSource[] {
    return Object.freeze([...this.#sources.values()].sort((left, right) => left.id.value.localeCompare(right.id.value)));
  }
  registerObservation(observation: MarketObservation): void {
    if (!this.#sources.has(observation.sourceId.value)) {
      throw new MarketIntelligenceError(`Observation source is not registered: ${observation.sourceId.value}`, "UNKNOWN_SOURCE");
    }
    this.add(this.#observations, observation.id.value, observation, "observation");
  }
  observation(id: ObservationId): MarketObservation | undefined { return this.#observations.get(id.value); }
  registerEvidence(evidence: Evidence): void {
    for (const observationId of evidence.observationIds) {
      if (!this.#observations.has(observationId.value)) {
        throw new MarketIntelligenceError(`Evidence observation is not registered: ${observationId.value}`, "UNKNOWN_OBSERVATION");
      }
    }
    this.add(this.#evidence, evidence.id.value, evidence, "evidence");
  }
  evidence(id: EvidenceId): Evidence | undefined { return this.#evidence.get(id.value); }

  private add<T>(records: Map<string, T>, id: string, value: T, kind: string): void {
    if (records.has(id)) {
      throw new MarketIntelligenceError(`Market Intelligence ${kind} is already registered: ${id}`, "DUPLICATE_RECORD");
    }
    records.set(id, value);
  }
}
