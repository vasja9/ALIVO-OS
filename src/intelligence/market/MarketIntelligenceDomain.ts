export class MarketIntelligenceError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "MarketIntelligenceError";
  }
}

function required(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MarketIntelligenceError(`${field} must not be empty`, "INVALID_DOMAIN_STATE");
  }
  return value;
}

function validDate(value: Date, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new MarketIntelligenceError(`${field} must be a valid date`, "INVALID_DOMAIN_STATE");
  }
  return new Date(value.getTime());
}

abstract class Identifier {
  readonly #value: string;
  protected constructor(value: string, field: string) {
    this.#value = required(value, field);
  }
  get value(): string { return this.#value; }
  toString(): string { return this.#value; }
}

export class ObservationId extends Identifier {
  constructor(value: string) { super(value, "Observation identifier"); Object.freeze(this); }
}
export class EvidenceId extends Identifier {
  constructor(value: string) { super(value, "Evidence identifier"); Object.freeze(this); }
}
export class MarketSourceId extends Identifier {
  constructor(value: string) { super(value, "Source identifier"); Object.freeze(this); }
}
export class BusinessPackageId extends Identifier {
  constructor(value: string) { super(value, "Business Package identifier"); Object.freeze(this); }
}

export class Confidence {
  constructor(readonly value: number) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new MarketIntelligenceError("Confidence must be between 0 and 1", "INVALID_CONFIDENCE");
    }
    Object.freeze(this);
  }
}

export enum FreshnessStatus {
  Current = "Current",
  Ageing = "Ageing",
  Stale = "Stale",
  Expired = "Expired",
}

export class Freshness {
  readonly #assessedAt: number;
  constructor(readonly status: FreshnessStatus, assessedAt: Date) {
    if (!Object.values(FreshnessStatus).includes(status)) {
      throw new MarketIntelligenceError("Freshness status is invalid", "INVALID_FRESHNESS");
    }
    this.#assessedAt = validDate(assessedAt, "Freshness assessment timestamp").getTime();
    Object.freeze(this);
  }
  get assessedAt(): Date { return new Date(this.#assessedAt); }
}

export class Provenance {
  readonly #observedAt: number;
  readonly supportingReferences: readonly string[];
  constructor(
    readonly origin: string,
    observedAt: Date,
    readonly sourceId: MarketSourceId,
    supportingReferences: readonly string[] = [],
  ) {
    required(origin, "Provenance origin");
    this.#observedAt = validDate(observedAt, "Provenance observation timestamp").getTime();
    this.supportingReferences = Object.freeze(supportingReferences.map((reference) => required(reference, "Supporting reference")));
    Object.freeze(this);
  }
  get observedAt(): Date { return new Date(this.#observedAt); }
}

export class MarketSource {
  constructor(
    readonly id: MarketSourceId,
    readonly name: string,
    readonly kind: string,
  ) {
    required(name, "Source name");
    required(kind, "Source kind");
    Object.freeze(this);
  }
}

export class MarketObservation {
  readonly #observedAt: number;
  constructor(
    readonly id: ObservationId,
    readonly sourceId: MarketSourceId,
    observedAt: Date,
    readonly marketContext: string,
    readonly businessPackageId: BusinessPackageId | undefined,
    readonly subject: string,
    readonly type: string,
    readonly payloadReference: string,
    readonly provenance: Provenance,
    readonly freshness: Freshness,
    readonly confidence?: Confidence,
  ) {
    this.#observedAt = validDate(observedAt, "Observation timestamp").getTime();
    required(marketContext, "Market context");
    required(subject, "Observed subject");
    required(type, "Observation type");
    required(payloadReference, "Payload reference");
    if (sourceId.value !== provenance.sourceId.value || this.#observedAt !== provenance.observedAt.getTime()) {
      throw new MarketIntelligenceError("Observation and provenance must identify the same source and timestamp", "INVALID_PROVENANCE");
    }
    Object.freeze(this);
  }
  get observedAt(): Date { return new Date(this.#observedAt); }
}

export enum EvidenceStatus {
  Active = "Active",
  Superseded = "Superseded",
  Invalidated = "Invalidated",
}

export class Evidence {
  readonly observationIds: readonly ObservationId[];
  readonly #recordedAt: number;
  constructor(
    readonly id: EvidenceId,
    observationIds: readonly ObservationId[],
    readonly provenance: Provenance,
    recordedAt: Date,
    readonly confidence: Confidence,
    readonly freshness: Freshness,
    readonly status: EvidenceStatus,
  ) {
    if (observationIds.length === 0) {
      throw new MarketIntelligenceError("Evidence must reference at least one observation", "INVALID_EVIDENCE");
    }
    if (!Object.values(EvidenceStatus).includes(status)) {
      throw new MarketIntelligenceError("Evidence status is invalid", "INVALID_EVIDENCE");
    }
    this.observationIds = Object.freeze([...observationIds]);
    this.#recordedAt = validDate(recordedAt, "Evidence timestamp").getTime();
    Object.freeze(this);
  }
  get recordedAt(): Date { return new Date(this.#recordedAt); }
}
