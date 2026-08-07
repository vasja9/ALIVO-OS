import type { KnowledgeItem } from "../KnowledgeItem.ts";
import type { MemoryRecord } from "../../memory/MemoryRecord.ts";
import { KnowledgeEngineException } from "./KnowledgeEngineException.ts";

export type KnowledgeCandidateContent = KnowledgeItem | MemoryRecord;
export type KnowledgeCandidateSource = "BusinessMemory" | "KnowledgeLibrary";

export interface KnowledgeCandidateProperties {
  readonly identifier: string; readonly source: KnowledgeCandidateSource; readonly authorityLevel: number; readonly confidence: number;
  readonly relevance: number; readonly freshness: number; readonly ceoPreference: boolean; readonly content: KnowledgeCandidateContent;
}
export class KnowledgeCandidate {
  readonly identifier: string; readonly source: KnowledgeCandidateSource; readonly authorityLevel: number; readonly confidence: number;
  readonly relevance: number; readonly freshness: number; readonly ceoPreference: boolean; readonly content: KnowledgeCandidateContent;
  constructor(properties: KnowledgeCandidateProperties) {
    if (typeof properties?.identifier !== "string" || properties.identifier.trim().length === 0 || !["BusinessMemory", "KnowledgeLibrary"].includes(properties.source)) throw new KnowledgeEngineException("Knowledge candidate is invalid", "INVALID_CANDIDATE");
    if (![properties.authorityLevel, properties.confidence, properties.relevance, properties.freshness].every(Number.isFinite) || properties.confidence < 0 || properties.confidence > 1 || properties.relevance < 0 || properties.relevance > 1) throw new KnowledgeEngineException("Knowledge candidate ranking values are invalid", "INVALID_CANDIDATE");
    Object.assign(this, properties);
    this.identifier = properties.identifier; this.source = properties.source; this.authorityLevel = properties.authorityLevel; this.confidence = properties.confidence; this.relevance = properties.relevance; this.freshness = properties.freshness; this.ceoPreference = properties.ceoPreference; this.content = properties.content;
    Object.freeze(this);
  }
}
