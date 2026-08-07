import { KnowledgeException } from "./KnowledgeException.ts";

export class KnowledgeItemId {
  readonly value: string;
  constructor(value: string) {
    if (typeof value !== "string" || value.trim().length === 0) throw new KnowledgeException("Knowledge item identifier must not be empty", "INVALID_IDENTIFIER");
    this.value = value; Object.freeze(this);
  }
  equals(other: KnowledgeItemId): boolean { return other instanceof KnowledgeItemId && other.value === this.value; }
  toString(): string { return this.value; }
}
