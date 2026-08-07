import { WorkflowException } from "./WorkflowException.ts";
import { WorkflowStep } from "./WorkflowStep.ts";

export class WorkflowDefinition {
  readonly steps: readonly WorkflowStep[];
  readonly requiredCapabilities: readonly string[];
  readonly approvalRequirements: readonly string[];

  constructor(
    readonly workflowId: string,
    readonly workflowName: string,
    readonly description: string,
    steps: readonly WorkflowStep[],
    requiredCapabilities: readonly string[],
    approvalRequirements: readonly string[] = [],
  ) {
    if ([workflowId, workflowName, description].some((value) => value.trim() === "")) {
      throw new WorkflowException("Workflow definition fields cannot be empty");
    }
    if (steps.length === 0) throw new WorkflowException("A workflow requires at least one step");
    if (new Set(steps.map((step) => step.stepId)).size !== steps.length) {
      throw new WorkflowException("Workflow step IDs must be unique");
    }
    const stepIds = new Set(steps.map((step) => step.stepId));
    if (approvalRequirements.some((stepId) => !stepIds.has(stepId))) {
      throw new WorkflowException("Approval requirements must identify workflow steps");
    }
    this.steps = Object.freeze([...steps]);
    this.requiredCapabilities = Object.freeze([...requiredCapabilities]);
    this.approvalRequirements = Object.freeze([...approvalRequirements]);
    Object.freeze(this);
  }
}
