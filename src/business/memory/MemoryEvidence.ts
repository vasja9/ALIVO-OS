import { MemoryException } from "./MemoryException.ts";

export interface MemoryEvidenceProperties { readonly evidenceId: string; readonly sourceReference: string; readonly description: string; readonly confidence: number; readonly timestamp: Date; }

export class MemoryEvidence {
  readonly evidenceId: string;
  readonly sourceReference: string;
  readonly description: string;
  readonly confidence: number;
  readonly #timestampMs: number;
  constructor(properties: MemoryEvidenceProperties) {
    if (!properties || [properties.evidenceId, properties.sourceReference, properties.description].some((value) => typeof value !== "string" || value.trim().length === 0)) throw new MemoryException("Evidence identity, source reference and description are required", "INVALID_EVIDENCE");
    if (!Number.isFinite(properties.confidence) || properties.confidence < 0 || properties.confidence > 1) throw new MemoryException("Evidence confidence must be between zero and one", "INVALID_EVIDENCE");
    this.#timestampMs = properties.timestamp?.getTime();
    if (!Number.isFinite(this.#timestampMs)) throw new MemoryException("Evidence timestamp is invalid", "INVALID_EVIDENCE");
    this.evidenceId = properties.evidenceId; this.sourceReference = properties.sourceReference; this.description = properties.description; this.confidence = properties.confidence;
    Object.freeze(this);
  }
  get timestamp(): Date { return new Date(this.#timestampMs); }
}
