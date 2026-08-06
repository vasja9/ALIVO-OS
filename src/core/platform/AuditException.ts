/** Base exception for failures in the audit foundation. */
export class AuditException extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuditException";
  }
}
