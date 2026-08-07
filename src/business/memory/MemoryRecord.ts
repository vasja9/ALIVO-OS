import { MemoryEvidence } from "./MemoryEvidence.ts";
import { MemoryException } from "./MemoryException.ts";
import { MemoryId } from "./MemoryId.ts";
import { MemorySource } from "./MemorySource.ts";
import { MemoryStatus } from "./MemoryStatus.ts";
import { MemoryType } from "./MemoryType.ts";

export interface MemoryRecordProperties {
  readonly id: MemoryId; readonly type: MemoryType; readonly title: string; readonly content: string; readonly status: MemoryStatus;
  readonly source: MemorySource; readonly evidence?: readonly MemoryEvidence[]; readonly confidence: number; readonly createdAt: Date;
  readonly approvedAt?: Date; readonly supersedesRevision?: number; readonly relatedTaskIds?: readonly string[]; readonly relatedWorkflowIds?: readonly string[];
}

export class MemoryRecord {
  readonly id: MemoryId; readonly type: MemoryType; readonly title: string; readonly content: string; readonly status: MemoryStatus;
  readonly source: MemorySource; readonly evidence: readonly MemoryEvidence[]; readonly confidence: number; readonly supersedesRevision?: number;
  readonly relatedTaskIds: readonly string[]; readonly relatedWorkflowIds: readonly string[]; readonly #createdMs: number; readonly #approvedMs?: number;
  constructor(properties: MemoryRecordProperties) {
    if (!(properties?.id instanceof MemoryId) || !Object.values(MemoryType).includes(properties.type) || !Object.values(MemoryStatus).includes(properties.status) || !Object.values(MemorySource).includes(properties.source)) throw new MemoryException("Memory identity, type, status and source are required", "INVALID_MEMORY_RECORD");
    if ([properties.title, properties.content].some((value) => typeof value !== "string" || value.trim().length === 0)) throw new MemoryException("Memory title and content are required", "INVALID_MEMORY_RECORD");
    if (!Number.isFinite(properties.confidence) || properties.confidence < 0 || properties.confidence > 1) throw new MemoryException("Memory confidence must be between zero and one", "INVALID_MEMORY_RECORD");
    this.#createdMs = properties.createdAt?.getTime(); this.#approvedMs = properties.approvedAt?.getTime();
    if (!Number.isFinite(this.#createdMs) || (properties.approvedAt !== undefined && !Number.isFinite(this.#approvedMs))) throw new MemoryException("Memory timestamps are invalid", "INVALID_MEMORY_RECORD");
    if (properties.status === MemoryStatus.Approved && this.#approvedMs === undefined) throw new MemoryException("Approved memory requires an approval timestamp", "INVALID_MEMORY_RECORD");
    if (properties.supersedesRevision !== undefined && (!Number.isInteger(properties.supersedesRevision) || properties.supersedesRevision < 1)) throw new MemoryException("Superseded revision is invalid", "INVALID_MEMORY_RECORD");
    if (properties.evidence?.some((item) => !(item instanceof MemoryEvidence))) throw new MemoryException("Memory evidence is invalid", "INVALID_MEMORY_RECORD");
    const related = [...(properties.relatedTaskIds ?? []), ...(properties.relatedWorkflowIds ?? [])];
    if (related.some((value) => typeof value !== "string" || value.trim().length === 0)) throw new MemoryException("Related identifiers must not be empty", "INVALID_MEMORY_RECORD");
    this.id = properties.id; this.type = properties.type; this.title = properties.title; this.content = properties.content; this.status = properties.status; this.source = properties.source;
    this.evidence = Object.freeze([...(properties.evidence ?? [])]); this.confidence = properties.confidence; this.supersedesRevision = properties.supersedesRevision;
    this.relatedTaskIds = Object.freeze([...(properties.relatedTaskIds ?? [])]); this.relatedWorkflowIds = Object.freeze([...(properties.relatedWorkflowIds ?? [])]); Object.freeze(this);
  }
  get createdAt(): Date { return new Date(this.#createdMs); }
  get approvedAt(): Date | undefined { return this.#approvedMs === undefined ? undefined : new Date(this.#approvedMs); }
}
