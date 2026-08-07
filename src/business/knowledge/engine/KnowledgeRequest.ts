import { KnowledgeEngineException } from "./KnowledgeEngineException.ts";
import { KnowledgeScope } from "./KnowledgeScope.ts";

export interface KnowledgeRequestProperties {
  readonly requestId: string; readonly capability: string; readonly purpose: string; readonly scope: KnowledgeScope; readonly language: string;
  readonly taskId?: string; readonly workflowId?: string; readonly correlationId: string;
}

export class KnowledgeRequest {
  readonly requestId: string; readonly capability: string; readonly purpose: string; readonly scope: KnowledgeScope; readonly language: string;
  readonly taskId?: string; readonly workflowId?: string; readonly correlationId: string;
  constructor(properties: KnowledgeRequestProperties) {
    const required = [properties?.requestId, properties?.capability, properties?.purpose, properties?.language, properties?.correlationId];
    if (required.some((value) => typeof value !== "string" || value.trim().length === 0) || !(properties?.scope instanceof KnowledgeScope)) throw new KnowledgeEngineException("Knowledge request fields are invalid", "INVALID_REQUEST");
    if ([properties.taskId, properties.workflowId].some((value) => value !== undefined && (typeof value !== "string" || value.trim().length === 0))) throw new KnowledgeEngineException("Optional request identifiers must not be empty", "INVALID_REQUEST");
    Object.assign(this, properties);
    this.requestId = properties.requestId; this.capability = properties.capability; this.purpose = properties.purpose; this.scope = properties.scope;
    this.language = properties.language; this.taskId = properties.taskId; this.workflowId = properties.workflowId; this.correlationId = properties.correlationId;
    Object.freeze(this);
  }
}
