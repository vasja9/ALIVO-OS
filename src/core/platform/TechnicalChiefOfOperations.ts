import { OperationalDecision, OperationalDecisionType } from "./OperationalDecision.ts";
import { OperationalException } from "./OperationalException.ts";
import { OperationalQueue } from "./OperationalQueue.ts";
import { OperationalState } from "./OperationalState.ts";
import { OperationalTask } from "./OperationalTask.ts";

/** Central coordinator. Work is delegated through registered execution boundaries. */
export class TechnicalChiefOfOperations {
  readonly queue: OperationalQueue;
  state = OperationalState.Idle;
  readonly #capabilities = new Map<string, boolean>();
  readonly #agents = new Map<string, boolean>();
  readonly #decisions: OperationalDecision[] = [];
  readonly #events: unknown[] = [];

  constructor(queue: OperationalQueue = new OperationalQueue()) {
    this.queue = queue;
  }

  registerCapability(identifier: string, available = true): void {
    this.#capabilities.set(this.requireIdentifier(identifier), available);
  }

  registerAgent(identifier: string, available = true): void {
    this.#agents.set(this.requireIdentifier(identifier), available);
  }

  setAgentAvailability(identifier: string, available: boolean): void {
    if (!this.#agents.has(identifier)) throw new OperationalException(`Agent is not approved: ${identifier}`);
    this.#agents.set(identifier, available);
  }

  coordinate(task: OperationalTask): OperationalDecision {
    task.transition(OperationalState.Preparing);
    if (task.assignedAgent !== undefined && this.#agents.get(task.assignedAgent) !== true) {
      return this.degrade(task, `Assigned agent unavailable: ${task.assignedAgent}`);
    }
    if (task.assignedCapability !== undefined && this.#capabilities.get(task.assignedCapability) !== true) {
      return this.degrade(task, `Assigned capability unavailable: ${task.assignedCapability}`);
    }
    if (task.assignedAgent === undefined && task.assignedCapability === undefined) {
      throw new OperationalException("Task must be assigned to an approved capability or agent");
    }
    task.transition(OperationalState.Executing);
    this.state = OperationalState.Executing;
    return this.record(OperationalDecisionType.Assignment, task, task.assignedAgent ?? task.assignedCapability!);
  }

  receiveEvent(event: unknown): void {
    this.#events.push(event);
  }

  monitorExecution(task: OperationalTask): OperationalState {
    return task.status;
  }

  monitorHealth(): boolean {
    return [...this.#capabilities.values(), ...this.#agents.values()].every(Boolean);
  }

  failover(task: OperationalTask, replacementAgent: string): OperationalDecision {
    if (this.#agents.get(replacementAgent) !== true) throw new OperationalException(`Failover agent is unavailable: ${replacementAgent}`);
    task.assignedAgent = replacementAgent;
    return this.record(OperationalDecisionType.Failover, task, replacementAgent);
  }

  recover(task: OperationalTask): OperationalDecision {
    if (task.status !== OperationalState.Failed && task.status !== OperationalState.Waiting && task.status !== OperationalState.Paused) {
      throw new OperationalException(`Task cannot recover from ${task.status}`);
    }
    task.transition(OperationalState.Recovering);
    task.transition(OperationalState.Preparing);
    task.retryAt = undefined;
    this.state = OperationalState.Recovering;
    return this.record(OperationalDecisionType.Recovery, task, "Automatic recovery prepared");
  }

  requestApproval(task: OperationalTask, reason: string): OperationalDecision {
    if (task.status === OperationalState.Preparing || task.status === OperationalState.Executing) task.transition(OperationalState.Waiting);
    return this.record(OperationalDecisionType.ApprovalRequest, task, reason);
  }

  complete(task: OperationalTask): OperationalDecision {
    task.transition(OperationalState.Completed);
    this.state = OperationalState.Completed;
    return this.record(OperationalDecisionType.Completion, task, "Execution completed by assignee");
  }

  decisions(): readonly OperationalDecision[] { return Object.freeze([...this.#decisions]); }
  events(): readonly unknown[] { return Object.freeze([...this.#events]); }

  private degrade(task: OperationalTask, reason: string): OperationalDecision {
    task.transition(OperationalState.Waiting);
    this.queue.enqueue(task);
    this.state = OperationalState.Waiting;
    return this.record(OperationalDecisionType.Retry, task, reason);
  }

  private record(type: OperationalDecisionType, task: OperationalTask, detail: string): OperationalDecision {
    const decision = new OperationalDecision(type, task, detail);
    this.#decisions.push(decision);
    return decision;
  }

  private requireIdentifier(identifier: string): string {
    if (identifier.trim() === "") throw new OperationalException("Operational identifier cannot be empty");
    return identifier;
  }
}
