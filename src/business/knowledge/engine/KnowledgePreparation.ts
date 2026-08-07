import type { KnowledgeReference } from "../KnowledgeReference.ts";
import type { MemoryEvidence } from "../../memory/MemoryEvidence.ts";
import { KnowledgeCandidate } from "./KnowledgeCandidate.ts";

export interface PreparedKnowledge {
  readonly candidates: readonly KnowledgeCandidate[];
  readonly references: readonly (KnowledgeReference | MemoryEvidence)[];
  readonly metadata: Readonly<Record<string, string | number>>;
}
export class KnowledgePreparation {
  prepare(ordered: readonly KnowledgeCandidate[]): PreparedKnowledge {
    const seen = new Set<string>(), candidates: KnowledgeCandidate[] = [];
    for (const candidate of ordered) {
      const key = candidate.identifier;
      if (!seen.has(key)) { seen.add(key); candidates.push(candidate); }
    }
    const references: (KnowledgeReference | MemoryEvidence)[] = [];
    for (const candidate of candidates) {
      if ("references" in candidate.content) references.push(...candidate.content.references);
      else references.push(...candidate.content.evidence);
    }
    return Object.freeze({
      candidates: Object.freeze(candidates), references: Object.freeze(references),
      metadata: Object.freeze({ ordering: "deterministic-ranking", deduplication: "identifier-with-authority-precedence", selectedCount: candidates.length, referenceCount: references.length, sourceAttribution: "preserved" }),
    });
  }
}
