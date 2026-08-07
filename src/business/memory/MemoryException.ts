export class MemoryException extends Error {
  constructor(message: string, readonly code = "MEMORY_OPERATION_FAILED", options?: ErrorOptions) {
    super(message, options);
    this.name = "MemoryException";
  }
}
