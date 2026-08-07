import { OperationalTask } from "./OperationalTask.ts";

export enum OperationalDecisionType {
  Assignment = "Assignment",
  Retry = "Retry",
  Failover = "Failover",
  Recovery = "Recovery",
  Escalation = "Escalation",
  ApprovalRequest = "Approval Request",
  Completion = "Completion",
}

/** Immutable record of one coordination decision. */
export class OperationalDecision {
  constructor(
    readonly type: OperationalDecisionType,
    readonly task: OperationalTask,
    readonly detail: string,
    readonly createdAt: Date = new Date(),
  ) {
    Object.freeze(this);
  }
}
