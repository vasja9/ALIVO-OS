import { KnowledgeItem } from "./KnowledgeItem.ts";
export class KnowledgeResult { readonly records: readonly KnowledgeItem[]; readonly count: number; constructor(records: readonly KnowledgeItem[]) { this.records = Object.freeze([...records]); this.count = records.length; Object.freeze(this); } }
