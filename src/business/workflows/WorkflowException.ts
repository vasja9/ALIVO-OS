export class WorkflowException extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "WorkflowException";
  }
}
