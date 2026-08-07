import { KnowledgeCandidate } from "./KnowledgeCandidate.ts";

export class KnowledgeRanking {
  rank(candidates: readonly KnowledgeCandidate[]): readonly KnowledgeCandidate[] {
    return Object.freeze([...candidates].sort((left, right) =>
      right.authorityLevel - left.authorityLevel ||
      right.relevance - left.relevance ||
      right.confidence - left.confidence ||
      right.freshness - left.freshness ||
      Number(right.ceoPreference) - Number(left.ceoPreference) ||
      left.source.localeCompare(right.source) || left.identifier.localeCompare(right.identifier)));
  }

  summarize(candidates: readonly KnowledgeCandidate[]): readonly string[] {
    return Object.freeze(candidates.map((candidate, index) => `${index + 1}:${candidate.source}:${candidate.identifier}:authority=${candidate.authorityLevel}:relevance=${candidate.relevance}:confidence=${candidate.confidence}:freshness=${candidate.freshness}:ceo=${candidate.ceoPreference}`));
  }
}
