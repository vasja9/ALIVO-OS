import assert from "node:assert/strict";
import { test } from "node:test";

import { WorkflowContext } from "../../src/business/workflows/WorkflowContext.ts";
import { WorkflowDefinition } from "../../src/business/workflows/WorkflowDefinition.ts";
import { WorkflowEngine } from "../../src/business/workflows/WorkflowEngine.ts";
import { WorkflowException } from "../../src/business/workflows/WorkflowException.ts";
import { WorkflowExecutor } from "../../src/business/workflows/WorkflowExecutor.ts";
import type { WorkflowExecutionAuthority } from "../../src/business/workflows/WorkflowExecutor.ts";
import { WorkflowState } from "../../src/business/workflows/WorkflowState.ts";
import { WorkflowStep } from "../../src/business/workflows/WorkflowStep.ts";

const step = (id: string, attempts = 1) => new WorkflowStep(id, `Execute ${id}`, "operations", "assigned-by-tco", `${id} done`, { maximumAttempts: attempts });
const definition = (steps = [step("one")], approvals: string[] = []) => new WorkflowDefinition("workflow", "Approved workflow", "Sequential work", steps, ["operations"], approvals);
const context = new WorkflowContext("correlation", { source: "TCO" }, { request: 1 });

class Authority implements WorkflowExecutionAuthority {
  calls: string[] = [];
  failures = 0;
  cancelled = false;

  async requestStepExecution(item: WorkflowStep): Promise<string> {
    this.calls.push(item.stepId);
    if (this.failures-- > 0) throw new Error("execution failed");
    return item.expectedResult;
  }

  async cancelStep(): Promise<void> { this.cancelled = true; }
}

const setup = (authority = new Authority()) => {
  const progress: string[] = [];
  let time = 0;
  const engine = new WorkflowEngine(new WorkflowExecutor(authority), { reportProgress: (_instance, detail) => progress.push(detail) }, () => new Date(time += 10));
  return { authority, engine, progress };
};

test("creates an immutable workflow and executes its steps sequentially", async () => {
  const { authority, engine } = setup();
  const template = definition([step("one"), step("two")]);
  const instance = engine.create("instance", template);

  const result = await engine.executeApproved(instance, context);

  assert.deepEqual(authority.calls, ["one", "two"]);
  assert.equal(instance.currentState, WorkflowState.Completed);
  assert.deepEqual(result?.completedSteps, ["one", "two"]);
  assert.ok((result?.executionTime ?? 0) >= 0);
  assert.throws(() => (template.steps as WorkflowStep[]).push(step("three")), TypeError);
});

test("rejects invalid state transitions", () => {
  const { engine } = setup();
  const instance = engine.create("instance", definition());
  assert.throws(() => instance.transition(WorkflowState.Completed), WorkflowException);
});

test("pauses an active workflow and resumes from the current step", async () => {
  let release!: () => void;
  const authority: WorkflowExecutionAuthority = { requestStepExecution: () => new Promise<void>((resolve) => { release = resolve; }) };
  const progress: string[] = [];
  const engine = new WorkflowEngine(new WorkflowExecutor(authority), { reportProgress: (_instance, detail) => progress.push(detail) });
  const instance = engine.create("instance", definition());
  const running = engine.executeApproved(instance, context);
  await Promise.resolve();
  engine.pause(instance);
  release();
  assert.equal(await running, undefined);
  authority.requestStepExecution = async () => "done";
  const result = await engine.resume(instance);
  assert.equal(result?.status, WorkflowState.Completed);
  assert.ok(progress.includes("Workflow paused"));
  assert.ok(progress.includes("Workflow resumed"));
});

test("retries a failed step within its approved retry policy", async () => {
  const { authority, engine, progress } = setup();
  authority.failures = 1;
  const instance = engine.create("instance", definition([step("retry", 2)]));
  const result = await engine.executeApproved(instance, context);
  assert.equal(authority.calls.length, 2);
  assert.equal(result?.status, WorkflowState.Completed);
  assert.ok(progress.includes("Retrying step retry"));
});

test("waits for approval before requesting step execution", async () => {
  const { authority, engine, progress } = setup();
  const instance = engine.create("instance", definition([step("gate")], ["gate"]));
  assert.equal(await engine.executeApproved(instance, context), undefined);
  assert.equal(instance.currentState, WorkflowState.WaitingForApproval);
  assert.deepEqual(authority.calls, []);
  assert.equal((await engine.approve(instance))?.status, WorkflowState.Completed);
  assert.ok(progress.includes("Approval required for step gate"));
});

test("cancels workflow execution through the TCO authority boundary", async () => {
  const { authority, engine } = setup();
  const instance = engine.create("instance", definition([step("gate")], ["gate"]));
  await engine.executeApproved(instance, context);
  const result = await engine.cancel(instance);
  assert.equal(authority.cancelled, true);
  assert.equal(result.status, WorkflowState.Cancelled);
});

test("fails after exhausting retries and reports progress", async () => {
  const { authority, engine, progress } = setup();
  authority.failures = 2;
  const instance = engine.create("instance", definition([step("broken", 2)]));
  await assert.rejects(() => engine.executeApproved(instance, context), WorkflowException);
  assert.equal(instance.currentState, WorkflowState.Failed);
  assert.ok(progress.includes("Step broken failed"));
});

test("only the explicit approved execution entry point starts a workflow", async () => {
  const { engine } = setup();
  const instance = engine.create("instance", definition());
  assert.equal(instance.currentState, WorkflowState.Created);
  await engine.executeApproved(instance, context);
  assert.equal(instance.currentState, WorkflowState.Completed);
});
