import { KnowledgeCandidate } from "./KnowledgeCandidate.ts";
import { KnowledgeEngineException } from "./KnowledgeEngineException.ts";
export class KnowledgeSelection {
  readonly selectedItems: readonly KnowledgeCandidate[]; readonly selectionReason: string; readonly rankingSummary: readonly string[];
  constructor(selectedItems: readonly KnowledgeCandidate[], selectionReason: string, rankingSummary: readonly string[]) {
    if (selectedItems.some((item) => !(item instanceof KnowledgeCandidate)) || typeof selectionReason !== "string" || selectionReason.trim().length === 0) throw new KnowledgeEngineException("Knowledge selection is invalid", "INVALID_SELECTION");
    this.selectedItems = Object.freeze([...selectedItems]); this.selectionReason = selectionReason; this.rankingSummary = Object.freeze([...rankingSummary]); Object.freeze(this);
  }
}
