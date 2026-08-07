import assert from "node:assert/strict";
import { test } from "node:test";
import { BusinessMemory } from "../../src/business/memory/BusinessMemory.ts";
import { MemoryEvidence } from "../../src/business/memory/MemoryEvidence.ts";
import { MemoryException } from "../../src/business/memory/MemoryException.ts";
import { MemoryId } from "../../src/business/memory/MemoryId.ts";
import { MemoryQuery } from "../../src/business/memory/MemoryQuery.ts";
import { MemorySource } from "../../src/business/memory/MemorySource.ts";
import { MemoryStatus } from "../../src/business/memory/MemoryStatus.ts";
import { MemoryType } from "../../src/business/memory/MemoryType.ts";
import { AuditRecorder } from "../../src/core/platform/AuditRecorder.ts";
import { EventBus } from "../../src/core/platform/EventBus.ts";
import { EventSubscription } from "../../src/core/platform/EventSubscription.ts";
import { EventType } from "../../src/core/platform/EventType.ts";
import { IdentityId } from "../../src/core/platform/IdentityId.ts";
import { IdentityType } from "../../src/core/platform/IdentityType.ts";
import { InMemoryRepository } from "../../src/core/platform/Repository.ts";
import { SystemIdentity } from "../../src/core/platform/SystemIdentity.ts";

const ceo = new SystemIdentity({ id: new IdentityId("ceo"), type: IdentityType.CEO, displayName: "CEO", enabled: true });
const ai = new SystemIdentity({ id: new IdentityId("ai"), type: IdentityType.AIWorker, displayName: "AI", enabled: true });
const evidence = new MemoryEvidence({ evidenceId: "e-1", sourceReference: "source-1", description: "Verified result", confidence: .9, timestamp: new Date(1) });
const draft = (id: string, type = MemoryType.Decision) => ({ id: new MemoryId(id), type, title: `Title ${id}`, content: `Content ${id}`, source: MemorySource.CEO, evidence: [evidence], confidence: .8, relatedTaskIds: ["task-1"], relatedWorkflowIds: ["workflow-1"] });
const setup = () => {
  const audit = new AuditRecorder(); const events = new EventBus(); const observed: string[] = [];
  const types = ["created", "validated", "approved", "revised", "deprecated", "archived", "operation.failed"].map((name) => new EventType(`memory.${name}`));
  events.subscribe(new EventSubscription({ handle: (event) => observed.push(event.name) }, types));
  let time = 10; const memory = new BusinessMemory(new InMemoryRepository(), audit, events, undefined, () => new Date(time += 10));
  return { audit, memory, observed };
};

test("MemoryId is immutable, non-empty, and has stable equality", () => {
  const id = new MemoryId("business-defined");
  assert.ok(Object.isFrozen(id)); assert.ok(id.equals(new MemoryId("business-defined")));
  assert.throws(() => new MemoryId(" "), MemoryException);
});

test("creates, validates, and explicitly approves immutable attributable memory", () => {
  const { memory, audit, observed } = setup(); const id = new MemoryId("one");
  const created = memory.createDraft(draft(id.value), "author");
  assert.equal(created.status, MemoryStatus.Draft); assert.equal(memory.getCurrentApproved(id), undefined);
  assert.equal(memory.validate(id, "validator").status, MemoryStatus.Validated); assert.equal(memory.getCurrentApproved(id), undefined);
  assert.throws(() => memory.approve(id, { identity: ai, approvalReference: "ref" }), /CEO/);
  const approved = memory.approve(id, { identity: ceo, approvalReference: "approval-1" });
  assert.equal(memory.getCurrentApproved(id)?.content, approved.content); assert.ok(Object.isFrozen(approved));
  assert.deepEqual(observed, ["memory.created", "memory.validated", "memory.operation.failed", "memory.approved"]);
  assert.equal(audit.getEvents().length, 3); assert.deepEqual(audit.getEvents()[2].context, { memoryId: "one", previousRevision: 2, resultingStatus: "Approved", approvalReference: "approval-1" });
});

test("revisions preserve prior content and evidence and prevent silent overwrite", () => {
  const { memory } = setup(); const id = new MemoryId("revision");
  memory.createDraft(draft(id.value), "author");
  assert.throws(() => memory.createDraft(draft(id.value), "author"), /exists/);
  const revised = memory.revise(id, { content: "New content" }, "editor"); const history = memory.getHistory(id);
  assert.equal(history.revisions.length, 2); assert.equal(history.previousRevision()?.content, "Content revision");
  assert.equal(revised.supersedesRevision, 1); assert.equal(revised.evidence[0].evidenceId, "e-1");
  assert.throws(() => (revised.evidence as MemoryEvidence[]).push(evidence), TypeError);
});

test("deprecates and archives without deleting revision history", () => {
  const { memory, observed } = setup(); const id = new MemoryId("history");
  memory.createDraft(draft(id.value), "author"); memory.validate(id, "validator"); memory.approve(id, { identity: ceo, approvalReference: "approval" });
  assert.equal(memory.deprecate(id, "owner").status, MemoryStatus.Deprecated); assert.equal(memory.getCurrentApproved(id), undefined);
  assert.equal(memory.archive(id, "owner").status, MemoryStatus.Archived); assert.equal(memory.getHistory(id).revisions.length, 5);
  assert.ok(observed.includes("memory.deprecated")); assert.ok(observed.includes("memory.archived"));
});

test("queries current records with deterministic ordering and supported filters", () => {
  const { memory } = setup();
  memory.createDraft(draft("z", MemoryType.Strategy), "author"); memory.createDraft(draft("a"), "author"); memory.validate(new MemoryId("a"), "validator");
  assert.deepEqual(memory.query().records.map((record) => record.id.value), ["z", "a"]);
  assert.deepEqual(memory.query(new MemoryQuery({ type: MemoryType.Strategy })).records.map((record) => record.id.value), ["z"]);
  assert.deepEqual(memory.query(new MemoryQuery({ status: MemoryStatus.Validated })).records.map((record) => record.id.value), ["a"]);
  assert.equal(memory.query(new MemoryQuery({ relatedTask: "task-1", relatedWorkflow: "workflow-1", minimumConfidence: .8 })).count, 2);
});
