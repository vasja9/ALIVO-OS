import type { KnowledgeItem } from "../KnowledgeItem.ts";
import type { KnowledgeReference } from "../KnowledgeReference.ts";
import type { MemoryEvidence } from "../../memory/MemoryEvidence.ts";
import type { MemoryRecord } from "../../memory/MemoryRecord.ts";

export class KnowledgeContext {
  readonly approvedBusinessMemory: readonly MemoryRecord[]; readonly approvedKnowledgeItems: readonly KnowledgeItem[];
  readonly supportingReferences: readonly (KnowledgeReference | MemoryEvidence)[]; readonly confidenceSummary: Readonly<Record<string, number>>;
  readonly contextMetadata: Readonly<Record<string, string | number>>;
  constructor(memory: readonly MemoryRecord[], knowledge: readonly KnowledgeItem[], references: readonly (KnowledgeReference | MemoryEvidence)[], confidence: Readonly<Record<string, number>>, metadata: Readonly<Record<string, string | number>>) {
    this.approvedBusinessMemory = Object.freeze([...memory]); this.approvedKnowledgeItems = Object.freeze([...knowledge]); this.supportingReferences = Object.freeze([...references]);
    this.confidenceSummary = Object.freeze({ ...confidence }); this.contextMetadata = Object.freeze({ ...metadata }); Object.freeze(this);
  }
}
