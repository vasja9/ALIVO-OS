import { WorkflowContext } from "./WorkflowContext.ts";
import { WorkflowDefinition } from "./WorkflowDefinition.ts";
import { WorkflowException } from "./WorkflowException.ts";
import { WorkflowExecutor } from "./WorkflowExecutor.ts";
import { WorkflowInstance } from "./WorkflowInstance.ts";
import { WorkflowResult } from "./WorkflowResult.ts";
import { WorkflowState } from "./WorkflowState.ts";

export interface WorkflowProgressReporter {
  reportProgress(instance: WorkflowInstance, detail: string): void;
}

export class WorkflowEngine {
  readonly #completed = new Map<string, string[]>();
  readonly #failed = new Map<string, string[]>();
  readonly #contexts = new Map<string, WorkflowContext>();

  constructor(
    private readonly executor: WorkflowExecutor,
    private readonly tco: WorkflowProgressReporter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(instanceId: string, definition: WorkflowDefinition): WorkflowInstance {
    return new WorkflowInstance(instanceId, definition, this.now());
  }

  async executeApproved(instance: WorkflowInstance, context: WorkflowContext): Promise<WorkflowResult | undefined> {
    if (instance.currentState !== WorkflowState.Created) throw new WorkflowException("Only a created workflow can be submitted");
    this.#contexts.set(instance.instanceId, context);
    this.#completed.set(instance.instanceId, []);
    this.#failed.set(instance.instanceId, []);
    instance.transition(WorkflowState.Queued, this.now());
    this.report(instance, "Workflow queued by TCO");
    instance.transition(WorkflowState.Running, this.now());
    return this.run(instance, context);
  }

  pause(instance: WorkflowInstance): void {
    instance.transition(WorkflowState.Paused, this.now());
    this.report(instance, "Workflow paused");
  }

  async resume(instance: WorkflowInstance): Promise<WorkflowResult | undefined> {
    if (instance.currentState !== WorkflowState.Paused) throw new WorkflowException("Only a paused workflow can resume");
    instance.transition(WorkflowState.Running, this.now());
    this.report(instance, "Workflow resumed");
    return this.run(instance, this.requireContext(instance));
  }

  async approve(instance: WorkflowInstance): Promise<WorkflowResult | undefined> {
    if (instance.currentState !== WorkflowState.WaitingForApproval) throw new WorkflowException("Workflow is not waiting for approval");
    instance.transition(WorkflowState.Running, this.now());
    this.report(instance, "Workflow approval received");
    return this.run(instance, this.requireContext(instance), true);
  }

  async cancel(instance: WorkflowInstance): Promise<WorkflowResult> {
    if (instance.currentState === WorkflowState.Running || instance.currentState === WorkflowState.Paused || instance.currentState === WorkflowState.Retrying || instance.currentState === WorkflowState.WaitingForApproval || instance.currentState === WorkflowState.Queued || instance.currentState === WorkflowState.Created) {
      const step = instance.workflowDefinition.steps[instance.currentStep];
      if (step !== undefined) await this.executor.cancelStep(step, this.requireContext(instance));
      instance.transition(WorkflowState.Cancelled, this.now());
      this.report(instance, "Workflow cancelled");
      return this.result(instance, "Workflow cancelled");
    }
    throw new WorkflowException(`Cannot cancel a ${instance.currentState} workflow`);
  }

  private async run(instance: WorkflowInstance, context: WorkflowContext, approvalGranted = false): Promise<WorkflowResult | undefined> {
    const steps = instance.workflowDefinition.steps;
    while (instance.currentStep < steps.length && instance.currentState === WorkflowState.Running) {
      const step = steps[instance.currentStep];
      if (!approvalGranted && instance.workflowDefinition.approvalRequirements.includes(step.stepId)) {
        instance.transition(WorkflowState.WaitingForApproval, this.now());
        this.report(instance, `Approval required for step ${step.stepId}`);
        return undefined;
      }
      approvalGranted = false;
      let succeeded = false;
      for (let attempt = 1; attempt <= step.retryPolicy.maximumAttempts; attempt += 1) {
        try {
          await (attempt === 1 ? this.executor.executeStep(step, context) : this.executor.retryStep(step, context));
          succeeded = true;
          break;
        } catch (error) {
          if (attempt < step.retryPolicy.maximumAttempts) {
            instance.transition(WorkflowState.Retrying, this.now());
            this.report(instance, `Retrying step ${step.stepId}`);
            instance.transition(WorkflowState.Running, this.now());
          } else {
            this.#failed.get(instance.instanceId)!.push(step.stepId);
            instance.transition(WorkflowState.Failed, this.now());
            this.report(instance, `Step ${step.stepId} failed`);
            throw new WorkflowException(`Workflow failed at step ${step.stepId}`, error);
          }
        }
      }
      if (succeeded) {
        this.#completed.get(instance.instanceId)!.push(step.stepId);
        instance.currentStep += 1;
        this.report(instance, `Step ${step.stepId} completed`);
      }
    }
    if (instance.currentStep === steps.length && instance.currentState === WorkflowState.Running) {
      instance.transition(WorkflowState.Completed, this.now());
      this.report(instance, "Workflow completed");
      return this.result(instance, "All workflow steps completed");
    }
    return undefined;
  }

  private result(instance: WorkflowInstance, summary: string): WorkflowResult {
    return new WorkflowResult(instance.currentState, summary, this.#completed.get(instance.instanceId) ?? [], this.#failed.get(instance.instanceId) ?? [], (instance.completionTime?.getTime() ?? this.now().getTime()) - (instance.startTime?.getTime() ?? instance.creationTime.getTime()));
  }

  private report(instance: WorkflowInstance, detail: string): void {
    this.tco.reportProgress(instance, detail);
  }

  private requireContext(instance: WorkflowInstance): WorkflowContext {
    const context = this.#contexts.get(instance.instanceId);
    if (context === undefined) throw new WorkflowException("Workflow has not been submitted by the TCO");
    return context;
  }
}
