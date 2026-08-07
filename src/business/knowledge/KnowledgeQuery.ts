import { KnowledgeException } from "./KnowledgeException.ts";
import { KnowledgeItemType } from "./KnowledgeItemType.ts"; import { KnowledgeSource } from "./KnowledgeSource.ts"; import { KnowledgeStatus } from "./KnowledgeStatus.ts";
export interface KnowledgeQueryProperties { readonly type?: KnowledgeItemType; readonly status?: KnowledgeStatus; readonly source?: KnowledgeSource; readonly language?: string; readonly topicLabel?: string; readonly relatedProject?: string; readonly relatedTask?: string; readonly relatedWorkflow?: string; readonly minimumConfidence?: number; readonly createdFrom?: Date; readonly createdTo?: Date; }
export class KnowledgeQuery implements KnowledgeQueryProperties {
  readonly type?: KnowledgeItemType; readonly status?: KnowledgeStatus; readonly source?: KnowledgeSource; readonly language?: string; readonly topicLabel?: string; readonly relatedProject?: string; readonly relatedTask?: string; readonly relatedWorkflow?: string; readonly minimumConfidence?: number; readonly createdFrom?: Date; readonly createdTo?: Date;
  constructor(properties: KnowledgeQueryProperties = {}) {
    if (properties.minimumConfidence !== undefined && (!Number.isFinite(properties.minimumConfidence) || properties.minimumConfidence < 0 || properties.minimumConfidence > 1)) throw new KnowledgeException("Minimum confidence is invalid", "INVALID_QUERY");
    const from = properties.createdFrom?.getTime(), to = properties.createdTo?.getTime(); if (from !== undefined && !Number.isFinite(from) || to !== undefined && !Number.isFinite(to) || from !== undefined && to !== undefined && from > to) throw new KnowledgeException("Creation range is invalid", "INVALID_QUERY");
    Object.assign(this, properties); Object.freeze(this);
  }
}
