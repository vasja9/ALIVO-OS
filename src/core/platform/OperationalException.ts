/** Base exception for failures in operational coordination. */
export class OperationalException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationalException";
  }
}
