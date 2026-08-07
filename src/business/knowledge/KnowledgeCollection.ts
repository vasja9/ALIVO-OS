import { KnowledgeException } from "./KnowledgeException.ts";
import { KnowledgeItemId } from "./KnowledgeItemId.ts";

export class KnowledgeCollection {
  readonly identifier: string; readonly name: string; readonly description: string; readonly itemReferences: readonly KnowledgeItemId[];
  constructor(identifier: string, name: string, description: string, itemReferences: readonly KnowledgeItemId[] = []) {
    if ([identifier, name, description].some((value) => typeof value !== "string" || value.trim().length === 0) || itemReferences.some((id) => !(id instanceof KnowledgeItemId))) throw new KnowledgeException("Knowledge collection is invalid", "INVALID_COLLECTION");
    if (new Set(itemReferences.map((id) => id.value)).size !== itemReferences.length) throw new KnowledgeException("Collection item references must be unique", "DUPLICATE_COLLECTION_REFERENCE");
    this.identifier = identifier; this.name = name; this.description = description; this.itemReferences = Object.freeze([...itemReferences]); Object.freeze(this);
  }
  withItem(id: KnowledgeItemId): KnowledgeCollection {
    if (this.itemReferences.some((item) => item.equals(id))) throw new KnowledgeException("Knowledge item is already in the collection", "DUPLICATE_COLLECTION_REFERENCE");
    return new KnowledgeCollection(this.identifier, this.name, this.description, [...this.itemReferences, id]);
  }
}
