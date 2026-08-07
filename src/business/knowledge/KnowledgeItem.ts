import { KnowledgeException } from "./KnowledgeException.ts";
import { KnowledgeItemId } from "./KnowledgeItemId.ts";
import { KnowledgeItemType } from "./KnowledgeItemType.ts";
import { KnowledgeReference } from "./KnowledgeReference.ts";
import { KnowledgeSource } from "./KnowledgeSource.ts";
import { KnowledgeStatus } from "./KnowledgeStatus.ts";

export interface KnowledgeItemProperties {
  readonly id: KnowledgeItemId; readonly type: KnowledgeItemType; readonly title: string; readonly content: string; readonly status: KnowledgeStatus;
  readonly source: KnowledgeSource; readonly references?: readonly KnowledgeReference[]; readonly confidence: number; readonly createdAt: Date;
  readonly validatedAt?: Date; readonly approvedAt?: Date; readonly relatedProject?: string; readonly relatedTask?: string;
  readonly relatedWorkflow?: string; readonly language?: string; readonly topicLabels?: readonly string[]; readonly supersedesRevision?: number;
}
export class KnowledgeItem {
  readonly id: KnowledgeItemId; readonly type: KnowledgeItemType; readonly title: string; readonly content: string; readonly status: KnowledgeStatus; readonly source: KnowledgeSource;
  readonly references: readonly KnowledgeReference[]; readonly confidence: number; readonly relatedProject?: string; readonly relatedTask?: string; readonly relatedWorkflow?: string;
  readonly language?: string; readonly topicLabels: readonly string[]; readonly supersedesRevision?: number;
  readonly #createdMs: number; readonly #validatedMs?: number; readonly #approvedMs?: number;
  constructor(properties: KnowledgeItemProperties) {
    if (!(properties?.id instanceof KnowledgeItemId) || !Object.values(KnowledgeItemType).includes(properties.type) || !Object.values(KnowledgeStatus).includes(properties.status) || !Object.values(KnowledgeSource).includes(properties.source)) throw new KnowledgeException("Knowledge item classification is invalid", "INVALID_ITEM");
    if ([properties.title, properties.content].some((value) => typeof value !== "string" || value.trim().length === 0)) throw new KnowledgeException("Knowledge title and content reference must not be empty", "INVALID_ITEM");
    if (!Number.isFinite(properties.confidence) || properties.confidence < 0 || properties.confidence > 1) throw new KnowledgeException("Knowledge confidence must be between zero and one", "INVALID_ITEM");
    this.#createdMs = properties.createdAt?.getTime(); this.#validatedMs = properties.validatedAt?.getTime(); this.#approvedMs = properties.approvedAt?.getTime();
    if (!Number.isFinite(this.#createdMs) || (this.#validatedMs !== undefined && !Number.isFinite(this.#validatedMs)) || (this.#approvedMs !== undefined && !Number.isFinite(this.#approvedMs))) throw new KnowledgeException("Knowledge timestamps are invalid", "INVALID_ITEM");
    if (properties.status === KnowledgeStatus.Validated && this.#validatedMs === undefined || properties.status === KnowledgeStatus.Approved && (this.#validatedMs === undefined || this.#approvedMs === undefined)) throw new KnowledgeException("Lifecycle timestamps are required", "INVALID_ITEM");
    if (properties.references?.some((item) => !(item instanceof KnowledgeReference))) throw new KnowledgeException("Knowledge references are invalid", "INVALID_ITEM");
    const optional = [properties.relatedProject, properties.relatedTask, properties.relatedWorkflow, properties.language, ...(properties.topicLabels ?? [])];
    if (optional.some((value) => value !== undefined && (typeof value !== "string" || value.trim().length === 0))) throw new KnowledgeException("Optional identifiers and labels must not be empty", "INVALID_ITEM");
    if (properties.supersedesRevision !== undefined && (!Number.isInteger(properties.supersedesRevision) || properties.supersedesRevision < 1)) throw new KnowledgeException("Superseded revision is invalid", "INVALID_ITEM");
    this.id = properties.id; this.type = properties.type; this.title = properties.title; this.content = properties.content; this.status = properties.status; this.source = properties.source; this.confidence = properties.confidence;
    this.references = Object.freeze([...(properties.references ?? [])]); this.relatedProject = properties.relatedProject; this.relatedTask = properties.relatedTask; this.relatedWorkflow = properties.relatedWorkflow;
    this.language = properties.language; this.topicLabels = Object.freeze([...(properties.topicLabels ?? [])]); this.supersedesRevision = properties.supersedesRevision; Object.freeze(this);
  }
  get createdAt(): Date { return new Date(this.#createdMs); } get validatedAt(): Date | undefined { return this.#validatedMs === undefined ? undefined : new Date(this.#validatedMs); }
  get approvedAt(): Date | undefined { return this.#approvedMs === undefined ? undefined : new Date(this.#approvedMs); } get trusted(): boolean { return this.status === KnowledgeStatus.Approved; }
}
