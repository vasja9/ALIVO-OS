/** Base exception for failures in the event foundation. */
export class EventException extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EventException";
  }
}
