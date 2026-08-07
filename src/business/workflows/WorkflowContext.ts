import { WorkflowException } from "./WorkflowException.ts";

export class WorkflowContext {
  readonly workflowMetadata: Readonly<Record<string, unknown>>;
  readonly executionMetadata: Readonly<Record<string, unknown>>;

  constructor(
    readonly correlationId: string,
    workflowMetadata: Readonly<Record<string, unknown>> = {},
    executionMetadata: Readonly<Record<string, unknown>> = {},
  ) {
    if (correlationId.trim() === "") throw new WorkflowException("Correlation ID cannot be empty");
    this.workflowMetadata = Object.freeze({ ...workflowMetadata });
    this.executionMetadata = Object.freeze({ ...executionMetadata });
    Object.freeze(this);
  }
}
