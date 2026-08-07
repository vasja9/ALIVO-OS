import assert from "node:assert/strict";
import { test } from "node:test";
import { KnowledgeCollection } from "../../src/business/knowledge/KnowledgeCollection.ts";
import { KnowledgeException } from "../../src/business/knowledge/KnowledgeException.ts";
import { KnowledgeItemId } from "../../src/business/knowledge/KnowledgeItemId.ts";
import { KnowledgeItemType } from "../../src/business/knowledge/KnowledgeItemType.ts";
import { KnowledgeLibrary } from "../../src/business/knowledge/KnowledgeLibrary.ts";
import { KnowledgeQuery } from "../../src/business/knowledge/KnowledgeQuery.ts";
import { KnowledgeSource } from "../../src/business/knowledge/KnowledgeSource.ts";
import { KnowledgeStatus } from "../../src/business/knowledge/KnowledgeStatus.ts";
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
const draft = (id: string, type = KnowledgeItemType.Document, language = "en", labels = ["operations"]) => ({ id: new KnowledgeItemId(id), type, title: `Title ${id}`, content: `content-ref:${id}`, source: KnowledgeSource.UploadedDocument, references: [], confidence: .8, relatedProject: "project-1", relatedTask: "task-1", relatedWorkflow: "workflow-1", language, topicLabels: labels });
const setup = () => {
  const audit = new AuditRecorder(), events = new EventBus(), observed: string[] = [];
  events.subscribe(new EventSubscription({ handle: (event) => observed.push(event.name) }, ["created", "validated", "approved", "revised", "deprecated", "archived", "operation.failed"].map((name) => new EventType(`knowledge.${name === "operation.failed" ? name : `item.${name}`}`))));
  let time = 0; return { audit, observed, library: new KnowledgeLibrary(new InMemoryRepository(), audit, events, undefined, () => new Date(time += 10)) };
};

test("KnowledgeItemId is immutable, non-empty, and has stable equality", () => {
  const id = new KnowledgeItemId("business-defined"); assert.ok(Object.isFrozen(id)); assert.ok(id.equals(new KnowledgeItemId("business-defined"))); assert.throws(() => new KnowledgeItemId(" "), KnowledgeException);
});

test("draft validation and explicit approval establish trust with audit and events", () => {
  const { library, audit, observed } = setup(), id = new KnowledgeItemId("one");
  const created = library.createDraft(draft(id.value), "author"); assert.equal(created.status, KnowledgeStatus.Draft); assert.equal(created.source, KnowledgeSource.UploadedDocument); assert.equal(library.getCurrentApproved(id), undefined);
  assert.equal(library.validate(id, "validator").status, KnowledgeStatus.Validated); assert.throws(() => library.approve(id, { identity: ai, approvalReference: "ref" }), /non-AI/);
  assert.equal(library.approve(id, { identity: ceo, approvalReference: "approval-1" }).trusted, true); assert.equal(library.getCurrentApproved(id)?.id.value, "one");
  assert.deepEqual(observed, ["knowledge.item.created", "knowledge.item.validated", "knowledge.operation.failed", "knowledge.item.approved"]); assert.equal(audit.getEvents().length, 3);
  assert.deepEqual(audit.getEvents()[2].context, { knowledgeItemId: "one", previousRevision: 2, resultingStatus: "Approved", approvalReference: "approval-1" });
});

test("revisions preserve immutable history and prevent silent overwrite", () => {
  const { library } = setup(), id = new KnowledgeItemId("revision"); library.createDraft(draft(id.value), "author"); assert.throws(() => library.createDraft(draft(id.value), "author"), /exists/);
  const revised = library.revise(id, { content: "new-ref" }, "editor"), history = library.getHistory(id); assert.equal(history.length, 2); assert.equal(history[0].content, "content-ref:revision"); assert.equal(revised.status, KnowledgeStatus.Draft); assert.equal(revised.supersedesRevision, 1);
  assert.throws(() => (revised.topicLabels as string[]).push("mutable"), TypeError); assert.throws(() => (history as unknown as object[]).push(revised), TypeError);
});

test("deprecation and archive retain all versions without silent deletion", () => {
  const { library } = setup(), id = new KnowledgeItemId("lifecycle"); library.createDraft(draft(id.value), "author"); library.validate(id, "validator"); library.approve(id, { identity: ceo, approvalReference: "approval" });
  assert.equal(library.deprecate(id, "owner").status, KnowledgeStatus.Deprecated); assert.equal(library.getCurrentApproved(id), undefined); assert.equal(library.archive(id, "owner").status, KnowledgeStatus.Archived); assert.equal(library.getHistory(id).length, 5);
});

test("queries deterministically filter current items and collections contain approved references only", () => {
  const { library } = setup(); library.createDraft(draft("z", KnowledgeItemType.Research, "fr", ["market"]), "author"); library.createDraft(draft("a"), "author"); library.validate(new KnowledgeItemId("a"), "validator");
  assert.deepEqual(library.query().records.map((item) => item.id.value), ["z", "a"]); assert.deepEqual(library.query(new KnowledgeQuery({ type: KnowledgeItemType.Research, status: KnowledgeStatus.Draft, language: "fr", topicLabel: "market" })).records.map((item) => item.id.value), ["z"]);
  library.createCollection(new KnowledgeCollection("collection", "Approved", "Approved references")); assert.throws(() => library.addApprovedItemReferenceToCollection("collection", new KnowledgeItemId("a")), /approved/);
  library.approve(new KnowledgeItemId("a"), { identity: ceo, approvalReference: "approval" }); const collection = library.addApprovedItemReferenceToCollection("collection", new KnowledgeItemId("a")); assert.deepEqual(collection.itemReferences.map((id) => id.value), ["a"]); assert.equal(library.getCollection("collection").itemReferences.length, 1);
});
