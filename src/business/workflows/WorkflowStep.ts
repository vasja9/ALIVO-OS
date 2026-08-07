import { WorkflowException } from "./WorkflowException.ts";

export interface RetryPolicy {
  readonly maximumAttempts: number;
}

export class WorkflowStep {
  readonly retryPolicy: RetryPolicy;

  constructor(
    readonly stepId: string,
    readonly description: string,
    readonly requiredCapability: string,
    readonly assignedAgent: string | undefined,
    readonly expectedResult: string,
    retryPolicy: RetryPolicy = { maximumAttempts: 1 },
  ) {
    if ([stepId, description, requiredCapability, expectedResult].some((value) => value.trim() === "")) {
      throw new WorkflowException("Workflow step fields cannot be empty");
    }
    if (!Number.isInteger(retryPolicy.maximumAttempts) || retryPolicy.maximumAttempts < 1) {
      throw new WorkflowException("Retry attempts must be a positive integer");
    }
    this.retryPolicy = Object.freeze({ ...retryPolicy });
    Object.freeze(this);
  }
}
