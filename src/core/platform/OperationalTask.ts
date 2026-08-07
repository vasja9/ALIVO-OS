import { OperationalException } from "./OperationalException.ts";
import { OperationalState } from "./OperationalState.ts";

/** One approved request for execution by a capability or AI agent. */
export class OperationalTask {
  assignedCapability?: string;
  assignedAgent?: string;
  status = OperationalState.Idle;
  executionTime?: Date;
  completionTime?: Date;
  retryAt?: Date;

  constructor(
    readonly taskIdentifier: string,
    readonly taskType: string,
    readonly priority: number,
    readonly creationTime: Date = new Date(),
    readonly relatedWorkflow?: string,
  ) {
    if (taskIdentifier.trim() === "" || taskType.trim() === "") {
      throw new OperationalException("Operational tasks require an identifier and type");
    }
    if (!Number.isFinite(priority)) {
      throw new OperationalException("Operational task priority must be finite");
    }
  }

  assignCapability(capability: string): void {
    this.assignedCapability = this.requireAssignment(capability);
  }

  assignAgent(agent: string): void {
    this.assignedAgent = this.requireAssignment(agent);
  }

  transition(next: OperationalState, at: Date = new Date()): void {
    const allowed: Readonly<Record<OperationalState, readonly OperationalState[]>> = {
      [OperationalState.Idle]: [OperationalState.Preparing],
      [OperationalState.Preparing]: [OperationalState.Executing, OperationalState.Waiting, OperationalState.Failed],
      [OperationalState.Executing]: [OperationalState.Waiting, OperationalState.Paused, OperationalState.Completed, OperationalState.Failed],
      [OperationalState.Waiting]: [OperationalState.Preparing, OperationalState.Paused, OperationalState.Recovering, OperationalState.Failed],
      [OperationalState.Paused]: [OperationalState.Preparing, OperationalState.Recovering, OperationalState.Failed],
      [OperationalState.Recovering]: [OperationalState.Preparing, OperationalState.Waiting, OperationalState.Failed],
      [OperationalState.Completed]: [],
      [OperationalState.Failed]: [OperationalState.Recovering],
    };
    if (!allowed[this.status].includes(next)) {
      throw new OperationalException(`Invalid operational transition: ${this.status} -> ${next}`);
    }
    this.status = next;
    if (next === OperationalState.Executing && this.executionTime === undefined) this.executionTime = at;
    if (next === OperationalState.Completed) this.completionTime = at;
  }

  private requireAssignment(value: string): string {
    if (value.trim() === "") throw new OperationalException("Operational assignments cannot be empty");
    return value;
  }
}
