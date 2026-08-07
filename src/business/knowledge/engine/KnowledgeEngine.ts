import type { SystemIdentity } from "../../../core/platform/SystemIdentity.ts";
import { BusinessMemory } from "../../memory/BusinessMemory.ts";
import { MemoryQuery } from "../../memory/MemoryQuery.ts";
import { MemorySource } from "../../memory/MemorySource.ts";
import { MemoryType } from "../../memory/MemoryType.ts";
import { KnowledgeLibrary } from "../KnowledgeLibrary.ts";
import { KnowledgeQuery } from "../KnowledgeQuery.ts";
import { KnowledgeSource } from "../KnowledgeSource.ts";
import { KnowledgeStatus } from "../KnowledgeStatus.ts";
import { KnowledgeCandidate } from "./KnowledgeCandidate.ts";
import { KnowledgeContext } from "./KnowledgeContext.ts";
import { KnowledgeEngineException } from "./KnowledgeEngineException.ts";
import { KnowledgeEngineResult } from "./KnowledgeEngineResult.ts";
import { KnowledgePreparation } from "./KnowledgePreparation.ts";
import { KnowledgeRanking } from "./KnowledgeRanking.ts";
import { KnowledgeRequest } from "./KnowledgeRequest.ts";
import { KnowledgeScopeType } from "./KnowledgeScope.ts";
import { KnowledgeSelection } from "./KnowledgeSelection.ts";

export class KnowledgeEngine {
  constructor(private readonly memory: BusinessMemory, private readonly library: KnowledgeLibrary, private readonly ranking = new KnowledgeRanking(), private readonly preparation = new KnowledgePreparation()) {}

  execute(request: KnowledgeRequest, identity?: SystemIdentity): KnowledgeEngineResult {
    if (!(request instanceof KnowledgeRequest)) throw new KnowledgeEngineException("A valid knowledge request is required", "INVALID_REQUEST");
    const candidates = this.retrieve(request, identity), ranked = this.ranking.rank(candidates), prepared = this.preparation.prepare(ranked);
    const summary = this.confidence(prepared.candidates.map((candidate) => candidate.confidence));
    const selection = new KnowledgeSelection(prepared.candidates, `Approved knowledge selected for ${request.scope.type}`, this.ranking.summarize(prepared.candidates));
    const memory = prepared.candidates.filter((candidate) => candidate.source === "BusinessMemory").map((candidate) => candidate.content as import("../../memory/MemoryRecord.ts").MemoryRecord);
    const knowledge = prepared.candidates.filter((candidate) => candidate.source === "KnowledgeLibrary").map((candidate) => candidate.content as import("../KnowledgeItem.ts").KnowledgeItem);
    const metadata = Object.freeze({ ...prepared.metadata, requestId: request.requestId, correlationId: request.correlationId, scope: request.scope.type });
    const context = new KnowledgeContext(memory, knowledge, prepared.references, summary, metadata);
    return new KnowledgeEngineResult(context, selection, summary, metadata);
  }

  private retrieve(request: KnowledgeRequest, identity?: SystemIdentity): KnowledgeCandidate[] {
    const includeMemory = request.scope.type !== KnowledgeScopeType.KnowledgeLibraryOnly && request.scope.type !== KnowledgeScopeType.Project && request.scope.type !== KnowledgeScopeType.Capability;
    const includeLibrary = request.scope.type !== KnowledgeScopeType.BusinessMemoryOnly;
    const memoryQuery = request.scope.type === KnowledgeScopeType.Workflow ? new MemoryQuery({ relatedWorkflow: request.scope.value }) : new MemoryQuery();
    const knowledgeQuery = new KnowledgeQuery({
      status: KnowledgeStatus.Approved, language: request.language,
      relatedProject: request.scope.type === KnowledgeScopeType.Project ? request.scope.value : undefined,
      relatedWorkflow: request.scope.type === KnowledgeScopeType.Workflow ? request.scope.value : undefined,
      topicLabel: request.scope.type === KnowledgeScopeType.Capability ? request.scope.value : undefined,
    });
    const result: KnowledgeCandidate[] = [];
    if (includeMemory) for (const record of this.memory.queryApproved(memoryQuery, identity).records) result.push(new KnowledgeCandidate({
      identifier: record.id.value, source: "BusinessMemory", authorityLevel: 2, confidence: record.confidence, relevance: this.memoryRelevance(record.relatedTaskIds, record.relatedWorkflowIds, request), freshness: record.approvedAt?.getTime() ?? record.createdAt.getTime(), ceoPreference: record.type === MemoryType.CEOPreference || record.source === MemorySource.CEO, content: record,
    }));
    if (includeLibrary) for (const item of this.library.query(knowledgeQuery, identity).records) result.push(new KnowledgeCandidate({
      identifier: item.id.value, source: "KnowledgeLibrary", authorityLevel: 1, confidence: item.confidence, relevance: this.knowledgeRelevance(item.relatedTask, item.relatedWorkflow, item.topicLabels, request), freshness: item.approvedAt?.getTime() ?? item.createdAt.getTime(), ceoPreference: item.source === KnowledgeSource.CEO, content: item,
    }));
    return result;
  }

  private memoryRelevance(tasks: readonly string[], workflows: readonly string[], request: KnowledgeRequest): number {
    return request.taskId !== undefined && tasks.includes(request.taskId) || request.workflowId !== undefined && workflows.includes(request.workflowId) ? 1 : 0.5;
  }
  private knowledgeRelevance(task: string | undefined, workflow: string | undefined, labels: readonly string[], request: KnowledgeRequest): number {
    return task === request.taskId && task !== undefined || workflow === request.workflowId && workflow !== undefined || labels.includes(request.capability) ? 1 : 0.5;
  }
  private confidence(values: readonly number[]): Readonly<Record<string, number>> {
    return Object.freeze({ minimum: values.length === 0 ? 0 : Math.min(...values), maximum: values.length === 0 ? 0 : Math.max(...values), average: values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length, itemCount: values.length });
  }
}
