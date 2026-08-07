export class KnowledgeException extends Error {
  constructor(message: string, readonly code: string, options?: ErrorOptions) {
    super(message, options); this.name = "KnowledgeException"; Object.freeze(this);
  }
}
