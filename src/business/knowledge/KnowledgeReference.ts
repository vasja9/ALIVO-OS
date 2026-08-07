import { KnowledgeException } from "./KnowledgeException.ts";

export interface KnowledgeReferenceProperties { readonly referenceIdentifier: string; readonly referenceType: string; readonly targetIdentifier: string; readonly relationshipDescription: string; }
export class KnowledgeReference {
  readonly referenceIdentifier: string; readonly referenceType: string; readonly targetIdentifier: string; readonly relationshipDescription: string;
  constructor(properties: KnowledgeReferenceProperties) {
    if ([properties?.referenceIdentifier, properties?.referenceType, properties?.targetIdentifier, properties?.relationshipDescription].some((value) => typeof value !== "string" || value.trim().length === 0)) throw new KnowledgeException("Knowledge reference fields must not be empty", "INVALID_REFERENCE");
    Object.assign(this, properties); this.referenceIdentifier = properties.referenceIdentifier; this.referenceType = properties.referenceType; this.targetIdentifier = properties.targetIdentifier; this.relationshipDescription = properties.relationshipDescription; Object.freeze(this);
  }
}
