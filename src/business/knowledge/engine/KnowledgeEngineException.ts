export class KnowledgeEngineException extends Error {
  constructor(message: string, readonly code = "KNOWLEDGE_ENGINE_FAILED", options?: ErrorOptions) {
    super(message, options);
    this.name = "KnowledgeEngineException";
    Object.freeze(this);
  }
}
