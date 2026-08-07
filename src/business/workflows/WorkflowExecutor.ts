import { WorkflowContext } from "./WorkflowContext.ts";
import { WorkflowException } from "./WorkflowException.ts";
import { WorkflowStep } from "./WorkflowStep.ts";

/** Boundary implemented by the TCO; the executor never communicates with agents. */
export interface WorkflowExecutionAuthority {
  requestStepExecution(step: WorkflowStep, context: WorkflowContext): Promise<unknown>;
  cancelStep?(step: WorkflowStep, context: WorkflowContext): Promise<void>;
  continueWorkflow?(): void;
}

export class WorkflowExecutor {
  constructor(private readonly authority: WorkflowExecutionAuthority) {}

  executeStep(step: WorkflowStep, context: WorkflowContext): Promise<unknown> {
    return this.authority.requestStepExecution(step, context);
  }

  retryStep(step: WorkflowStep, context: WorkflowContext): Promise<unknown> {
    return this.executeStep(step, context);
  }

  skipStep(_step: WorkflowStep, ceoApproved: boolean): void {
    if (!ceoApproved) throw new WorkflowException("Skipping a workflow step requires CEO approval");
  }

  async cancelStep(step: WorkflowStep, context: WorkflowContext): Promise<void> {
    await this.authority.cancelStep?.(step, context);
  }

  continueWorkflow(): void {
    this.authority.continueWorkflow?.();
  }
}
