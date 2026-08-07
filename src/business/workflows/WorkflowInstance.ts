import { WorkflowDefinition } from "./WorkflowDefinition.ts";
import { WorkflowException } from "./WorkflowException.ts";
import { WorkflowState } from "./WorkflowState.ts";

const transitions: Readonly<Record<WorkflowState, readonly WorkflowState[]>> = {
  [WorkflowState.Created]: [WorkflowState.Queued, WorkflowState.Cancelled],
  [WorkflowState.Queued]: [WorkflowState.Running, WorkflowState.Cancelled],
  [WorkflowState.Running]: [WorkflowState.Paused, WorkflowState.WaitingForApproval, WorkflowState.Retrying, WorkflowState.Completed, WorkflowState.Cancelled, WorkflowState.Failed],
  [WorkflowState.Paused]: [WorkflowState.Running, WorkflowState.Cancelled],
  [WorkflowState.WaitingForApproval]: [WorkflowState.Running, WorkflowState.Cancelled],
  [WorkflowState.Retrying]: [WorkflowState.Running, WorkflowState.Cancelled, WorkflowState.Failed],
  [WorkflowState.Completed]: [],
  [WorkflowState.Cancelled]: [],
  [WorkflowState.Failed]: [],
};

export class WorkflowInstance {
  currentStep = 0;
  currentState = WorkflowState.Created;
  startTime?: Date;
  completionTime?: Date;

  constructor(
    readonly instanceId: string,
    readonly workflowDefinition: WorkflowDefinition,
    readonly creationTime: Date = new Date(),
  ) {
    if (instanceId.trim() === "") throw new WorkflowException("Instance ID cannot be empty");
  }

  transition(next: WorkflowState, at: Date = new Date()): void {
    if (!transitions[this.currentState].includes(next)) {
      throw new WorkflowException(`Invalid workflow transition: ${this.currentState} -> ${next}`);
    }
    this.currentState = next;
    if (next === WorkflowState.Running && this.startTime === undefined) this.startTime = at;
    if ([WorkflowState.Completed, WorkflowState.Cancelled, WorkflowState.Failed].includes(next)) this.completionTime = at;
  }
}
