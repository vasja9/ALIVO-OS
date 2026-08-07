import { KnowledgeEngineException } from "./KnowledgeEngineException.ts";

export enum KnowledgeScopeType {
  BusinessMemoryOnly = "BusinessMemoryOnly",
  KnowledgeLibraryOnly = "KnowledgeLibraryOnly",
  Combined = "Combined",
  Project = "Project",
  Workflow = "Workflow",
  Capability = "Capability",
}

export class KnowledgeScope {
  readonly type: KnowledgeScopeType;
  readonly value?: string;

  constructor(type: KnowledgeScopeType, value?: string) {
    if (!Object.values(KnowledgeScopeType).includes(type)) throw new KnowledgeEngineException("Knowledge scope is invalid", "INVALID_SCOPE");
    const needsValue = type === KnowledgeScopeType.Project || type === KnowledgeScopeType.Workflow || type === KnowledgeScopeType.Capability;
    if (needsValue !== (typeof value === "string" && value.trim().length > 0)) throw new KnowledgeEngineException("Scoped project, workflow, or capability requires exactly one value", "INVALID_SCOPE");
    this.type = type;
    this.value = value;
    Object.freeze(this);
  }

  static businessMemoryOnly(): KnowledgeScope { return new KnowledgeScope(KnowledgeScopeType.BusinessMemoryOnly); }
  static knowledgeLibraryOnly(): KnowledgeScope { return new KnowledgeScope(KnowledgeScopeType.KnowledgeLibraryOnly); }
  static combined(): KnowledgeScope { return new KnowledgeScope(KnowledgeScopeType.Combined); }
  static project(identifier: string): KnowledgeScope { return new KnowledgeScope(KnowledgeScopeType.Project, identifier); }
  static workflow(identifier: string): KnowledgeScope { return new KnowledgeScope(KnowledgeScopeType.Workflow, identifier); }
  static capability(identifier: string): KnowledgeScope { return new KnowledgeScope(KnowledgeScopeType.Capability, identifier); }
}
