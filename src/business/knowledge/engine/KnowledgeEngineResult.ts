import { KnowledgeContext } from "./KnowledgeContext.ts";
import { KnowledgeSelection } from "./KnowledgeSelection.ts";
export class KnowledgeEngineResult {
  readonly knowledgeContext: KnowledgeContext; readonly selectionSummary: KnowledgeSelection; readonly confidenceSummary: Readonly<Record<string, number>>; readonly preparationMetadata: Readonly<Record<string, string | number>>;
  constructor(context: KnowledgeContext, selection: KnowledgeSelection, confidence: Readonly<Record<string, number>>, metadata: Readonly<Record<string, string | number>>) {
    this.knowledgeContext = context; this.selectionSummary = selection; this.confidenceSummary = Object.freeze({ ...confidence }); this.preparationMetadata = Object.freeze({ ...metadata }); Object.freeze(this);
  }
}
