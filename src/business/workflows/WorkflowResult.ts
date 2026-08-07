import { WorkflowState } from "./WorkflowState.ts";

export class WorkflowResult {
  readonly completedSteps: readonly string[];
  readonly failedSteps: readonly string[];

  constructor(
    readonly status: WorkflowState,
    readonly executionSummary: string,
    completedSteps: readonly string[],
    failedSteps: readonly string[],
    readonly executionTime: number,
  ) {
    this.completedSteps = Object.freeze([...completedSteps]);
    this.failedSteps = Object.freeze([...failedSteps]);
    Object.freeze(this);
  }
}
