export type PersistenceFailure =
  | "INVALID_IDENTIFIER"
  | "DUPLICATE_RECORD"
  | "RECORD_NOT_FOUND"
  | "STALE_VERSION"
  | "INACTIVE_TRANSACTION"
  | "INVALID_QUERY"
  | "OPERATION_FAILED";

/** A technology-independent persistence failure. */
export class PersistenceException extends Error {
  constructor(
    message: string,
    readonly failure: PersistenceFailure = "OPERATION_FAILED",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PersistenceException";
    Object.freeze(this);
  }
}
