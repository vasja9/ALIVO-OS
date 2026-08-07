import assert from "node:assert/strict";
import { test } from "node:test";
import { KnowledgeItem } from "../../src/business/knowledge/KnowledgeItem.ts";
import { KnowledgeItemId } from "../../src/business/knowledge/KnowledgeItemId.ts";
import { KnowledgeItemType } from "../../src/business/knowledge/KnowledgeItemType.ts";
import { KnowledgeReference } from "../../src/business/knowledge/KnowledgeReference.ts";
import { KnowledgeSource } from "../../src/business/knowledge/KnowledgeSource.ts";
import { KnowledgeStatus } from "../../src/business/knowledge/KnowledgeStatus.ts";
import { MemoryId } from "../../src/business/memory/MemoryId.ts";
import { MemoryRecord } from "../../src/business/memory/MemoryRecord.ts";
import { MemorySource } from "../../src/business/memory/MemorySource.ts";
import { MemoryStatus } from "../../src/business/memory/MemoryStatus.ts";
import { MemoryType } from "../../src/business/memory/MemoryType.ts";
import { KnowledgeEngine } from "../../src/business/knowledge/engine/KnowledgeEngine.ts";
import { KnowledgeRequest } from "../../src/business/knowledge/engine/KnowledgeRequest.ts";
import { KnowledgeScope } from "../../src/business/knowledge/engine/KnowledgeScope.ts";

type Query = { relatedWorkflow?: string; relatedProject?: string; topicLabel?: string; language?: string };
const reference = new KnowledgeReference({ referenceIdentifier: "ref", referenceType: "source", targetIdentifier: "target", relationshipDescription: "supports" });
const memory = (id: string, confidence = .8, workflow = "wf") => new MemoryRecord({ id: new MemoryId(id), type: MemoryType.BusinessRule, title: id, content: `original-${id}`, status: MemoryStatus.Approved, source: MemorySource.CEO, confidence, createdAt: new Date(10), approvedAt: new Date(20), relatedWorkflowIds: [workflow] });
const knowledge = (id: string, confidence = .8, project = "project", workflow = "wf", labels = ["sales"]) => new KnowledgeItem({ id: new KnowledgeItemId(id), type: KnowledgeItemType.Document, title: id, content: `original-${id}`, status: KnowledgeStatus.Approved, source: KnowledgeSource.UploadedDocument, references: [reference], confidence, createdAt: new Date(10), validatedAt: new Date(15), approvedAt: new Date(20), relatedProject: project, relatedWorkflow: workflow, language: "en", topicLabels: labels });
const engine = (memories: readonly MemoryRecord[], items: readonly KnowledgeItem[]) => new KnowledgeEngine(
  { queryApproved: (query: Query) => ({ records: memories.filter((record) => query.relatedWorkflow === undefined || record.relatedWorkflowIds.includes(query.relatedWorkflow)), count: memories.length }) } as never,
  { query: (query: Query) => ({ records: items.filter((item) => (query.language === undefined || item.language === query.language) && (query.relatedWorkflow === undefined || item.relatedWorkflow === query.relatedWorkflow) && (query.relatedProject === undefined || item.relatedProject === query.relatedProject) && (query.topicLabel === undefined || item.topicLabels.includes(query.topicLabel))), count: items.length }) } as never,
);
const request = (scope = KnowledgeScope.combined()) => new KnowledgeRequest({ requestId: "request", capability: "sales", purpose: "execute", scope, language: "en", taskId: "task", workflowId: "wf", correlationId: "correlation" });

test("knowledge requests and contexts are immutable", () => {
  const value = request(); assert.ok(Object.isFrozen(value));
  const result = engine([memory("memory")], [knowledge("knowledge")]).execute(value);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.knowledgeContext)); assert.ok(Object.isFrozen(result.knowledgeContext.approvedBusinessMemory));
  assert.throws(() => (result.knowledgeContext.approvedKnowledgeItems as KnowledgeItem[]).push(knowledge("other")), TypeError);
});

test("combined retrieval ranks Business Memory first deterministically and deduplicates by identifier", () => {
  const service = engine([memory("shared", .2), memory("memory", .4)], [knowledge("shared", 1), knowledge("library", .9)]);
  const first = service.execute(request()), second = service.execute(request());
  assert.deepEqual(first.selectionSummary.selectedItems.map((item) => `${item.source}:${item.identifier}`), ["BusinessMemory:memory", "BusinessMemory:shared", "KnowledgeLibrary:library"]);
  assert.deepEqual(first.selectionSummary.rankingSummary, second.selectionSummary.rankingSummary);
  assert.equal(first.knowledgeContext.approvedBusinessMemory.length, 2); assert.equal(first.knowledgeContext.approvedKnowledgeItems.length, 1);
});

test("scope filtering supports each repository and project, workflow, and capability", () => {
  const service = engine([memory("m-wf"), memory("m-other", .8, "other")], [knowledge("k-project"), knowledge("k-other", .8, "other", "other", ["other"])]);
  assert.deepEqual(service.execute(request(KnowledgeScope.businessMemoryOnly())).selectionSummary.selectedItems.map((item) => item.identifier), ["m-wf", "m-other"]);
  assert.deepEqual(service.execute(request(KnowledgeScope.knowledgeLibraryOnly())).selectionSummary.selectedItems.map((item) => item.identifier), ["k-project", "k-other"]);
  assert.deepEqual(service.execute(request(KnowledgeScope.project("project"))).selectionSummary.selectedItems.map((item) => item.identifier), ["k-project"]);
  assert.deepEqual(service.execute(request(KnowledgeScope.workflow("wf"))).selectionSummary.selectedItems.map((item) => item.identifier), ["m-wf", "k-project"]);
  assert.deepEqual(service.execute(request(KnowledgeScope.capability("sales"))).selectionSummary.selectedItems.map((item) => item.identifier), ["k-project"]);
});

test("preparation preserves original content, references, attribution, and confidence", () => {
  const item = knowledge("document"), result = engine([], [item]).execute(request(KnowledgeScope.knowledgeLibraryOnly()));
  assert.equal(result.knowledgeContext.approvedKnowledgeItems[0].content, "original-document"); assert.equal(result.knowledgeContext.supportingReferences[0], reference);
  assert.equal(result.preparationMetadata.sourceAttribution, "preserved"); assert.deepEqual(result.confidenceSummary, { minimum: .8, maximum: .8, average: .8, itemCount: 1 });
});
