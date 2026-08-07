import { AuditEvent } from "../../core/platform/AuditEvent.ts";
import { AuditEventType } from "../../core/platform/AuditEventType.ts";
import { AuditRecorder } from "../../core/platform/AuditRecorder.ts";
import { EntityId } from "../../core/platform/EntityId.ts";
import { Event } from "../../core/platform/Event.ts";
import { EventBus } from "../../core/platform/EventBus.ts";
import { EventContext } from "../../core/platform/EventContext.ts";
import { EventId } from "../../core/platform/EventId.ts";
import { EventType } from "../../core/platform/EventType.ts";
import { IdentityType } from "../../core/platform/IdentityType.ts";
import type { Repository } from "../../core/platform/Repository.ts";
import { RepositoryQuery } from "../../core/platform/RepositoryQuery.ts";
import { RepositoryRecord } from "../../core/platform/RepositoryRecord.ts";
import type { SystemIdentity } from "../../core/platform/SystemIdentity.ts";
import { VersionToken } from "../../core/platform/VersionToken.ts";
import { KnowledgeCollection } from "./KnowledgeCollection.ts";
import { KnowledgeException } from "./KnowledgeException.ts";
import { KnowledgeItem, type KnowledgeItemProperties } from "./KnowledgeItem.ts";
import { KnowledgeItemId } from "./KnowledgeItemId.ts";
import { KnowledgeQuery } from "./KnowledgeQuery.ts";
import { KnowledgeReference } from "./KnowledgeReference.ts";
import { KnowledgeResult } from "./KnowledgeResult.ts";
import { KnowledgeSource } from "./KnowledgeSource.ts";
import { KnowledgeStatus } from "./KnowledgeStatus.ts";
import { KnowledgeItemType } from "./KnowledgeItemType.ts";

export type DraftKnowledgeItem = Omit<KnowledgeItemProperties, "status" | "createdAt" | "validatedAt" | "approvedAt" | "supersedesRevision">;
export type RevisedKnowledgeItem = Partial<Omit<DraftKnowledgeItem, "id">>;
export interface KnowledgeApproval { readonly identity: SystemIdentity; readonly approvalReference: string; }
export interface KnowledgeAccessPolicy { canRead(identity: SystemIdentity | undefined, item: KnowledgeItem): boolean; }

const ITEM_RECORD = "knowledge-item-revision", COLLECTION_RECORD = "knowledge-collection";
const eventNames = { created: "knowledge.item.created", validated: "knowledge.item.validated", approved: "knowledge.item.approved", revised: "knowledge.item.revised", deprecated: "knowledge.item.deprecated", archived: "knowledge.item.archived", failed: "knowledge.operation.failed" } as const;

export class KnowledgeLibrary {
  #eventSequence = 0;
  constructor(private readonly repository: Repository, private readonly audit: AuditRecorder, private readonly events: EventBus,
    private readonly access: KnowledgeAccessPolicy = { canRead: () => true }, private readonly now: () => Date = () => new Date()) {}

  createDraft(properties: DraftKnowledgeItem, responsibleIdentity: string): KnowledgeItem {
    return this.perform("created", properties.id, responsibleIdentity, undefined, undefined, () => {
      if (this.histories().has(properties.id.value)) throw new KnowledgeException("Knowledge item already exists", "SILENT_OVERWRITE_PREVENTED");
      return this.persistItem(new KnowledgeItem({ ...properties, status: KnowledgeStatus.Draft, createdAt: this.now() }), 1);
    });
  }
  validate(id: KnowledgeItemId, responsibleIdentity: string): KnowledgeItem { return this.transition(id, KnowledgeStatus.Draft, KnowledgeStatus.Validated, "validated", responsibleIdentity); }
  approve(id: KnowledgeItemId, approval: KnowledgeApproval): KnowledgeItem {
    if (typeof approval?.approvalReference !== "string" || approval.approvalReference.trim().length === 0 || !approval.identity?.enabled || approval.identity.type === IdentityType.AIWorker) {
      this.publish("failed", id); throw new KnowledgeException("Knowledge approval requires an enabled non-AI identity and explicit approval reference", "APPROVAL_REQUIRED");
    }
    return this.transition(id, KnowledgeStatus.Validated, KnowledgeStatus.Approved, "approved", approval.identity.id.value, approval.approvalReference);
  }
  revise(id: KnowledgeItemId, changes: RevisedKnowledgeItem, responsibleIdentity: string): KnowledgeItem {
    const history = this.history(id), current = history[history.length - 1];
    return this.perform("revised", id, responsibleIdentity, history.length, undefined, () => this.persistItem(new KnowledgeItem({
      id, type: changes.type ?? current.type, title: changes.title ?? current.title, content: changes.content ?? current.content, status: KnowledgeStatus.Draft,
      source: changes.source ?? current.source, references: changes.references ?? current.references, confidence: changes.confidence ?? current.confidence,
      createdAt: this.now(), relatedProject: changes.relatedProject ?? current.relatedProject, relatedTask: changes.relatedTask ?? current.relatedTask,
      relatedWorkflow: changes.relatedWorkflow ?? current.relatedWorkflow, language: changes.language ?? current.language,
      topicLabels: changes.topicLabels ?? current.topicLabels, supersedesRevision: history.length,
    }), history.length + 1));
  }
  deprecate(id: KnowledgeItemId, responsibleIdentity: string): KnowledgeItem { return this.transition(id, KnowledgeStatus.Approved, KnowledgeStatus.Deprecated, "deprecated", responsibleIdentity); }
  archive(id: KnowledgeItemId, responsibleIdentity: string): KnowledgeItem {
    const current = this.current(id); if (current.status !== KnowledgeStatus.Approved && current.status !== KnowledgeStatus.Deprecated) throw new KnowledgeException("Only approved or deprecated knowledge may be archived", "INVALID_STATUS_TRANSITION");
    return this.transition(id, current.status, KnowledgeStatus.Archived, "archived", responsibleIdentity);
  }
  getCurrentApproved(id: KnowledgeItemId, identity?: SystemIdentity): KnowledgeItem | undefined { const item = this.current(id); return item.trusted && this.access.canRead(identity, item) ? item : undefined; }
  getHistory(id: KnowledgeItemId, identity?: SystemIdentity): readonly KnowledgeItem[] {
    const records = this.history(id).filter((item) => this.access.canRead(identity, item)); if (records.length === 0) throw new KnowledgeException("Knowledge item was not found or is not authorized", "KNOWLEDGE_NOT_FOUND"); return Object.freeze(records);
  }
  createCollection(collection: KnowledgeCollection): KnowledgeCollection {
    const time = this.now(); this.repository.create(new RepositoryRecord({ entityId: this.collectionId(collection.identifier), version: new VersionToken("1"), recordType: COLLECTION_RECORD, payload: this.serializeCollection(collection), createdAt: time, updatedAt: time })); return collection;
  }
  getCollection(identifier: string): KnowledgeCollection {
    try { return this.deserializeCollection(this.repository.retrieve(this.collectionId(identifier))); } catch (error) { throw new KnowledgeException("Knowledge collection was not found", "COLLECTION_NOT_FOUND", { cause: error }); }
  }
  addApprovedItemReferenceToCollection(identifier: string, id: KnowledgeItemId, identity?: SystemIdentity): KnowledgeCollection {
    if (this.getCurrentApproved(id, identity) === undefined) throw new KnowledgeException("Only authorized approved knowledge may be added to a collection", "APPROVED_ITEM_REQUIRED");
    const stored = this.repository.retrieve(this.collectionId(identifier)), updated = this.deserializeCollection(stored).withItem(id), time = this.now();
    this.repository.update(new RepositoryRecord({ entityId: stored.entityId, version: new VersionToken(String(Number(stored.version.value) + 1)), recordType: COLLECTION_RECORD, payload: this.serializeCollection(updated), createdAt: stored.createdAt, updatedAt: time }), stored.version); return updated;
  }
  query(query = new KnowledgeQuery(), identity?: SystemIdentity): KnowledgeResult {
    const records = [...this.histories().values()].map((history) => history[history.length - 1]).filter((item) => this.matches(item, query) && this.access.canRead(identity, item));
    records.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.value.localeCompare(b.id.value)); return new KnowledgeResult(records);
  }

  private transition(id: KnowledgeItemId, expected: KnowledgeStatus, resulting: KnowledgeStatus, action: keyof typeof eventNames, identity: string, approvalReference?: string): KnowledgeItem {
    const history = this.history(id), current = history[history.length - 1]; if (current.status !== expected) throw new KnowledgeException(`Knowledge item must be ${expected} before it can become ${resulting}`, "INVALID_STATUS_TRANSITION");
    const timestamp = this.now(); return this.perform(action, id, identity, history.length, approvalReference, () => this.persistItem(new KnowledgeItem({
      id, type: current.type, title: current.title, content: current.content, status: resulting, source: current.source, references: current.references,
      confidence: current.confidence, createdAt: timestamp, validatedAt: resulting === KnowledgeStatus.Validated ? timestamp : current.validatedAt,
      approvedAt: resulting === KnowledgeStatus.Approved ? timestamp : current.approvedAt, relatedProject: current.relatedProject, relatedTask: current.relatedTask,
      relatedWorkflow: current.relatedWorkflow, language: current.language, topicLabels: current.topicLabels, supersedesRevision: history.length,
    }), history.length + 1));
  }
  private perform(action: keyof typeof eventNames, id: KnowledgeItemId, identity: string, previous: number | undefined, approvalReference: string | undefined, operation: () => KnowledgeItem): KnowledgeItem {
    try {
      if (typeof identity !== "string" || identity.trim().length === 0) throw new KnowledgeException("Responsible identity is required", "ATTRIBUTION_REQUIRED"); const item = operation();
      this.audit.append(new AuditEvent({ type: action === "approved" ? AuditEventType.ApprovalDecision : AuditEventType.DataLifecycle, source: "KnowledgeLibrary", action: eventNames[action], result: item.status, responsibleIdentity: identity, timestamp: this.now(), context: { knowledgeItemId: id.value, previousRevision: previous ?? null, resultingStatus: item.status, approvalReference: approvalReference ?? null } }));
      this.publish(action, id, item.status, previous, approvalReference); return item;
    } catch (error) { this.publish("failed", id); throw error instanceof KnowledgeException ? error : new KnowledgeException("Knowledge operation failed", "KNOWLEDGE_OPERATION_FAILED", { cause: error }); }
  }
  private publish(action: keyof typeof eventNames, id: KnowledgeItemId, status?: KnowledgeStatus, previous?: number, approvalReference?: string): void {
    this.events.publish(new Event({ id: new EventId(`knowledge-library-${++this.#eventSequence}`), type: new EventType(eventNames[action]), timestamp: this.now(), source: "KnowledgeLibrary", correlationId: id.value, context: new EventContext({ knowledgeItemId: id.value, previousRevision: previous ?? null, resultingStatus: status ?? null, approvalReference: approvalReference ?? null }) }));
  }
  private persistItem(item: KnowledgeItem, revision: number): KnowledgeItem { const time = item.createdAt; this.repository.create(new RepositoryRecord({ entityId: new EntityId(JSON.stringify([item.id.value, revision])), version: new VersionToken(String(revision)), recordType: ITEM_RECORD, payload: this.serializeItem(item, revision), createdAt: time, updatedAt: time })); return item; }
  private histories(): Map<string, KnowledgeItem[]> { const grouped = new Map<string, { revision: number; item: KnowledgeItem }[]>(); for (const stored of this.repository.query(new RepositoryQuery({ recordType: ITEM_RECORD, ordering: "entity-id" })).records) { const value = this.deserializeItem(stored), list = grouped.get(value.item.id.value) ?? []; list.push(value); grouped.set(value.item.id.value, list); } return new Map([...grouped].map(([id, entries]) => [id, entries.sort((a, b) => a.revision - b.revision).map((entry) => entry.item)])); }
  private history(id: KnowledgeItemId): KnowledgeItem[] { const history = this.histories().get(id.value); if (!history) throw new KnowledgeException("Knowledge item was not found", "KNOWLEDGE_NOT_FOUND"); return history; }
  private current(id: KnowledgeItemId): KnowledgeItem { const history = this.history(id); return history[history.length - 1]; }
  private serializeItem(item: KnowledgeItem, revision: number) { return { revision, id: item.id.value, type: item.type, title: item.title, content: item.content, status: item.status, source: item.source, references: item.references.map((r) => ({ referenceIdentifier: r.referenceIdentifier, referenceType: r.referenceType, targetIdentifier: r.targetIdentifier, relationshipDescription: r.relationshipDescription })), confidence: item.confidence, createdAt: item.createdAt.toISOString(), validatedAt: item.validatedAt?.toISOString() ?? null, approvedAt: item.approvedAt?.toISOString() ?? null, relatedProject: item.relatedProject ?? null, relatedTask: item.relatedTask ?? null, relatedWorkflow: item.relatedWorkflow ?? null, language: item.language ?? null, topicLabels: [...item.topicLabels], supersedesRevision: item.supersedesRevision ?? null }; }
  private deserializeItem(stored: RepositoryRecord): { revision: number; item: KnowledgeItem } { const v = stored.payload as any; return { revision: v.revision, item: new KnowledgeItem({ id: new KnowledgeItemId(v.id), type: v.type as KnowledgeItemType, title: v.title, content: v.content, status: v.status as KnowledgeStatus, source: v.source as KnowledgeSource, references: v.references.map((r: any) => new KnowledgeReference(r)), confidence: v.confidence, createdAt: new Date(v.createdAt), validatedAt: v.validatedAt === null ? undefined : new Date(v.validatedAt), approvedAt: v.approvedAt === null ? undefined : new Date(v.approvedAt), relatedProject: v.relatedProject ?? undefined, relatedTask: v.relatedTask ?? undefined, relatedWorkflow: v.relatedWorkflow ?? undefined, language: v.language ?? undefined, topicLabels: v.topicLabels, supersedesRevision: v.supersedesRevision ?? undefined }) }; }
  private collectionId(identifier: string): EntityId { if (typeof identifier !== "string" || identifier.trim().length === 0) throw new KnowledgeException("Collection identifier is required", "INVALID_COLLECTION"); return new EntityId(`knowledge-collection:${identifier}`); }
  private serializeCollection(c: KnowledgeCollection) { return { identifier: c.identifier, name: c.name, description: c.description, itemReferences: c.itemReferences.map((id) => id.value) }; }
  private deserializeCollection(stored: RepositoryRecord): KnowledgeCollection { const v = stored.payload as any; return new KnowledgeCollection(v.identifier, v.name, v.description, v.itemReferences.map((id: string) => new KnowledgeItemId(id))); }
  private matches(item: KnowledgeItem, q: KnowledgeQuery): boolean { const time = item.createdAt.getTime(); return (q.type === undefined || item.type === q.type) && (q.status === undefined || item.status === q.status) && (q.source === undefined || item.source === q.source) && (q.language === undefined || item.language === q.language) && (q.topicLabel === undefined || item.topicLabels.includes(q.topicLabel)) && (q.relatedProject === undefined || item.relatedProject === q.relatedProject) && (q.relatedTask === undefined || item.relatedTask === q.relatedTask) && (q.relatedWorkflow === undefined || item.relatedWorkflow === q.relatedWorkflow) && (q.minimumConfidence === undefined || item.confidence >= q.minimumConfidence) && (q.createdFrom === undefined || time >= q.createdFrom.getTime()) && (q.createdTo === undefined || time <= q.createdTo.getTime()); }
}
