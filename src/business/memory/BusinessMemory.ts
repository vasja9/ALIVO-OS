import { AuditEvent } from "../../core/platform/AuditEvent.ts";
import { AuditEventType } from "../../core/platform/AuditEventType.ts";
import { AuditRecorder } from "../../core/platform/AuditRecorder.ts";
import { EntityId } from "../../core/platform/EntityId.ts";
import { Event } from "../../core/platform/Event.ts";
import { EventBus } from "../../core/platform/EventBus.ts";
import { EventContext } from "../../core/platform/EventContext.ts";
import { EventId } from "../../core/platform/EventId.ts";
import { EventType } from "../../core/platform/EventType.ts";
import type { Repository } from "../../core/platform/Repository.ts";
import { RepositoryQuery } from "../../core/platform/RepositoryQuery.ts";
import { RepositoryRecord } from "../../core/platform/RepositoryRecord.ts";
import { VersionToken } from "../../core/platform/VersionToken.ts";
import { IdentityType } from "../../core/platform/IdentityType.ts";
import type { SystemIdentity } from "../../core/platform/SystemIdentity.ts";
import { MemoryEvidence } from "./MemoryEvidence.ts";
import { MemoryException } from "./MemoryException.ts";
import { MemoryId } from "./MemoryId.ts";
import { MemoryQuery } from "./MemoryQuery.ts";
import { MemoryRecord, type MemoryRecordProperties } from "./MemoryRecord.ts";
import { MemoryResult } from "./MemoryResult.ts";
import { MemoryRevision } from "./MemoryRevision.ts";
import { MemorySource } from "./MemorySource.ts";
import { MemoryStatus } from "./MemoryStatus.ts";
import { MemoryType } from "./MemoryType.ts";

export type DraftMemory = Omit<MemoryRecordProperties, "status" | "createdAt" | "approvedAt" | "supersedesRevision">;
export type RevisedMemory = Partial<Omit<DraftMemory, "id">>;
export interface MemoryApproval { readonly identity: SystemIdentity; readonly approvalReference: string; }
export interface MemoryAccessPolicy { canRead(identity: SystemIdentity | undefined, record: MemoryRecord): boolean; }

const RECORD_TYPE = "business-memory-revision";
const eventNames = { created: "memory.created", validated: "memory.validated", approved: "memory.approved", revised: "memory.revised", deprecated: "memory.deprecated", archived: "memory.archived", failed: "memory.operation.failed" } as const;

export class BusinessMemory {
  #eventSequence = 0;
  constructor(
    private readonly repository: Repository,
    private readonly audit: AuditRecorder,
    private readonly events: EventBus,
    private readonly access: MemoryAccessPolicy = { canRead: () => true },
    private readonly now: () => Date = () => new Date(),
  ) {}

  createDraft(properties: DraftMemory, responsibleIdentity: string): MemoryRecord {
    return this.perform("created", properties.id, responsibleIdentity, undefined, undefined, () => {
      if (this.histories().some((history) => history.id.equals(properties.id))) throw new MemoryException("Memory already exists", "SILENT_OVERWRITE_PREVENTED");
      return this.persist(new MemoryRecord({ ...properties, status: MemoryStatus.Draft, createdAt: this.now() }), 1);
    });
  }

  validate(id: MemoryId, responsibleIdentity: string): MemoryRecord {
    return this.transition(id, MemoryStatus.Draft, MemoryStatus.Validated, "validated", responsibleIdentity);
  }

  approve(id: MemoryId, approval: MemoryApproval): MemoryRecord {
    if (typeof approval?.approvalReference !== "string" || approval.approvalReference.trim().length === 0 || approval.identity?.type !== IdentityType.CEO || !approval.identity.enabled) {
      this.publish("failed", id, MemoryStatus.Validated);
      throw new MemoryException("Business Memory approval requires an enabled CEO identity and explicit approval reference", "CEO_APPROVAL_REQUIRED");
    }
    return this.transition(id, MemoryStatus.Validated, MemoryStatus.Approved, "approved", approval.identity.id.value, approval.approvalReference);
  }

  revise(id: MemoryId, changes: RevisedMemory, responsibleIdentity: string): MemoryRecord {
    const history = this.getHistory(id);
    const current = history.currentRevision;
    return this.perform("revised", id, responsibleIdentity, history.revisions.length, undefined, () => this.persist(new MemoryRecord({
      id, type: changes.type ?? current.type, title: changes.title ?? current.title, content: changes.content ?? current.content,
      status: MemoryStatus.Draft, source: changes.source ?? current.source, evidence: changes.evidence ?? current.evidence,
      confidence: changes.confidence ?? current.confidence, createdAt: this.now(), supersedesRevision: history.revisions.length,
      relatedTaskIds: changes.relatedTaskIds ?? current.relatedTaskIds, relatedWorkflowIds: changes.relatedWorkflowIds ?? current.relatedWorkflowIds,
    }), history.revisions.length + 1));
  }

  deprecate(id: MemoryId, responsibleIdentity: string): MemoryRecord { return this.transition(id, MemoryStatus.Approved, MemoryStatus.Deprecated, "deprecated", responsibleIdentity); }
  archive(id: MemoryId, responsibleIdentity: string): MemoryRecord {
    const status = this.getHistory(id).currentRevision.status;
    if (status !== MemoryStatus.Deprecated && status !== MemoryStatus.Approved) throw new MemoryException("Only approved or deprecated memory can be archived", "INVALID_STATUS_TRANSITION");
    return this.transition(id, status, MemoryStatus.Archived, "archived", responsibleIdentity);
  }

  getCurrentApproved(id: MemoryId, identity?: SystemIdentity): MemoryRecord | undefined {
    const record = this.getHistory(id).currentRevision;
    return record.status === MemoryStatus.Approved && this.access.canRead(identity, record) ? record : undefined;
  }
  getHistory(id: MemoryId, identity?: SystemIdentity): MemoryRevision {
    const records = this.histories().find((item) => item.id.equals(id))?.revisions.filter((record) => this.access.canRead(identity, record));
    if (!records?.length) throw new MemoryException("Memory was not found or is not authorized", "MEMORY_NOT_FOUND");
    return new MemoryRevision(id, records);
  }
  queryApproved(query = new MemoryQuery(), identity?: SystemIdentity): MemoryResult { return this.query(new MemoryQuery({ ...this.queryProperties(query), status: MemoryStatus.Approved }), identity); }
  query(query = new MemoryQuery(), identity?: SystemIdentity): MemoryResult {
    const records = this.histories().map((history) => history.currentRevision).filter((record) => this.matches(record, query) && this.access.canRead(identity, record));
    records.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.value.localeCompare(right.id.value));
    return new MemoryResult(records);
  }
  getRelated(taskId: string | undefined, workflowId: string | undefined, identity?: SystemIdentity): MemoryResult {
    if (!taskId && !workflowId) throw new MemoryException("A related task or workflow identifier is required", "INVALID_QUERY");
    return this.query(new MemoryQuery({ relatedTask: taskId, relatedWorkflow: workflowId }), identity);
  }

  private transition(id: MemoryId, expected: MemoryStatus, resulting: MemoryStatus, action: keyof typeof eventNames, responsibleIdentity: string, approvalReference?: string): MemoryRecord {
    const history = this.getHistory(id); const current = history.currentRevision;
    if (current.status !== expected) throw new MemoryException(`Memory must be ${expected} before it can become ${resulting}`, "INVALID_STATUS_TRANSITION");
    return this.perform(action, id, responsibleIdentity, history.revisions.length, approvalReference, () => this.persist(new MemoryRecord({
      id, type: current.type, title: current.title, content: current.content, status: resulting, source: current.source, evidence: current.evidence,
      confidence: current.confidence, createdAt: this.now(), approvedAt: resulting === MemoryStatus.Approved ? this.now() : current.approvedAt,
      supersedesRevision: history.revisions.length, relatedTaskIds: current.relatedTaskIds, relatedWorkflowIds: current.relatedWorkflowIds,
    }), history.revisions.length + 1));
  }

  private perform(action: keyof typeof eventNames, id: MemoryId, identity: string, previous: number | undefined, approvalReference: string | undefined, operation: () => MemoryRecord): MemoryRecord {
    try {
      if (typeof identity !== "string" || identity.trim().length === 0) throw new MemoryException("Responsible identity is required", "ATTRIBUTION_REQUIRED");
      const record = operation();
      this.audit.append(new AuditEvent({ type: action === "approved" ? AuditEventType.ApprovalDecision : AuditEventType.DataLifecycle, source: "BusinessMemory", action: eventNames[action], result: record.status, responsibleIdentity: identity, timestamp: this.now(), context: { memoryId: id.value, previousRevision: previous ?? null, resultingStatus: record.status, approvalReference: approvalReference ?? null } }));
      this.publish(action, id, record.status, previous, approvalReference);
      return record;
    } catch (error) { this.publish("failed", id); throw error instanceof MemoryException ? error : new MemoryException("Business Memory operation failed", "MEMORY_OPERATION_FAILED", { cause: error }); }
  }

  private publish(action: keyof typeof eventNames, id: MemoryId, status?: MemoryStatus, previous?: number, approvalReference?: string): void {
    this.#eventSequence += 1;
    this.events.publish(new Event({ id: new EventId(`business-memory-${this.#eventSequence}`), type: new EventType(eventNames[action]), timestamp: this.now(), source: "BusinessMemory", correlationId: id.value, context: new EventContext({ memoryId: id.value, previousRevision: previous ?? null, resultingStatus: status ?? null, approvalReference: approvalReference ?? null }) }));
  }

  private persist(record: MemoryRecord, revision: number): MemoryRecord {
    const timestamp = record.createdAt;
    this.repository.create(new RepositoryRecord({ entityId: new EntityId(JSON.stringify([record.id.value, revision])), version: new VersionToken(String(revision)), recordType: RECORD_TYPE, payload: this.serialize(record, revision), createdAt: timestamp, updatedAt: timestamp }));
    return record;
  }

  private histories(): MemoryRevision[] {
    const records = this.repository.query(new RepositoryQuery({ recordType: RECORD_TYPE, ordering: "entity-id" })).records.map((stored) => this.deserialize(stored));
    const grouped = new Map<string, { revision: number; record: MemoryRecord }[]>();
    for (const item of records) { const list = grouped.get(item.record.id.value) ?? []; list.push(item); grouped.set(item.record.id.value, list); }
    return [...grouped.entries()].map(([id, items]) => new MemoryRevision(new MemoryId(id), items.sort((a, b) => a.revision - b.revision).map((item) => item.record)));
  }

  private serialize(record: MemoryRecord, revision: number) { return { revision, id: record.id.value, type: record.type, title: record.title, content: record.content, status: record.status, source: record.source, confidence: record.confidence, createdAt: record.createdAt.toISOString(), approvedAt: record.approvedAt?.toISOString() ?? null, supersedesRevision: record.supersedesRevision ?? null, relatedTaskIds: [...record.relatedTaskIds], relatedWorkflowIds: [...record.relatedWorkflowIds], evidence: record.evidence.map((item) => ({ evidenceId: item.evidenceId, sourceReference: item.sourceReference, description: item.description, confidence: item.confidence, timestamp: item.timestamp.toISOString() })) }; }
  private deserialize(stored: RepositoryRecord): { revision: number; record: MemoryRecord } {
    const value = stored.payload as any;
    return { revision: value.revision, record: new MemoryRecord({ id: new MemoryId(value.id), type: value.type as MemoryType, title: value.title, content: value.content, status: value.status as MemoryStatus, source: value.source as MemorySource, confidence: value.confidence, createdAt: new Date(value.createdAt), approvedAt: value.approvedAt === null ? undefined : new Date(value.approvedAt), supersedesRevision: value.supersedesRevision ?? undefined, relatedTaskIds: value.relatedTaskIds, relatedWorkflowIds: value.relatedWorkflowIds, evidence: value.evidence.map((item: any) => new MemoryEvidence({ ...item, timestamp: new Date(item.timestamp) })) }) };
  }
  private matches(record: MemoryRecord, query: MemoryQuery): boolean { const time = record.createdAt.getTime(); return (query.type === undefined || record.type === query.type) && (query.status === undefined || record.status === query.status) && (query.source === undefined || record.source === query.source) && (query.minimumConfidence === undefined || record.confidence >= query.minimumConfidence) && (query.relatedTask === undefined || record.relatedTaskIds.includes(query.relatedTask)) && (query.relatedWorkflow === undefined || record.relatedWorkflowIds.includes(query.relatedWorkflow)) && (query.createdFrom === undefined || time >= query.createdFrom.getTime()) && (query.createdTo === undefined || time <= query.createdTo.getTime()); }
  private queryProperties(query: MemoryQuery) { return { type: query.type, source: query.source, minimumConfidence: query.minimumConfidence, relatedTask: query.relatedTask, relatedWorkflow: query.relatedWorkflow, createdFrom: query.createdFrom, createdTo: query.createdTo }; }
}
