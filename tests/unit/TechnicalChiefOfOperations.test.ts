import assert from "node:assert/strict";
import { test } from "node:test";

import { OperationalDecisionType } from "../../src/core/platform/OperationalDecision.ts";
import { OperationalException } from "../../src/core/platform/OperationalException.ts";
import { OperationalQueue } from "../../src/core/platform/OperationalQueue.ts";
import { OperationalState } from "../../src/core/platform/OperationalState.ts";
import { OperationalTask } from "../../src/core/platform/OperationalTask.ts";
import { TechnicalChiefOfOperations } from "../../src/core/platform/TechnicalChiefOfOperations.ts";

const task = (identifier: string, priority = 1, created = 0) =>
  new OperationalTask(identifier, "approved-work", priority, new Date(created));

test("enforces operational state transitions and records execution times", () => {
  const item = task("one");
  item.transition(OperationalState.Preparing, new Date(10));
  item.transition(OperationalState.Executing, new Date(20));
  item.transition(OperationalState.Completed, new Date(30));

  assert.equal(item.executionTime?.getTime(), 20);
  assert.equal(item.completionTime?.getTime(), 30);
  assert.throws(() => item.transition(OperationalState.Executing), OperationalException);
});

test("orders queued work by priority and then creation time", () => {
  const queue = new OperationalQueue();
  queue.enqueue(task("low", 1, 0));
  queue.enqueue(task("new-high", 3, 20));
  queue.enqueue(task("old-high", 3, 10));

  assert.deepEqual(queue.inspect().map((item) => item.taskIdentifier), ["old-high", "new-high", "low"]);
  assert.equal(queue.dequeue(new Date(100))?.taskIdentifier, "old-high");
  assert.equal(queue.peek(new Date(100))?.taskIdentifier, "new-high");
});

test("keeps retries queued until their scheduled time", () => {
  const queue = new OperationalQueue();
  const retry = task("retry", 10);
  const ready = task("ready", 1);
  queue.scheduleRetry(retry, new Date(100));
  queue.enqueue(ready);

  assert.equal(queue.dequeue(new Date(50)), ready);
  assert.equal(queue.dequeue(new Date(50)), undefined);
  assert.equal(queue.dequeue(new Date(100)), retry);
});

test("coordinates assignments without executing business work", () => {
  const coordinator = new TechnicalChiefOfOperations();
  const item = task("assigned");
  item.assignCapability("billing");
  coordinator.registerCapability("billing");

  const decision = coordinator.coordinate(item);

  assert.equal(decision.type, OperationalDecisionType.Assignment);
  assert.equal(decision.detail, "billing");
  assert.equal(item.status, OperationalState.Executing);
});

test("creates failover decisions only for available approved agents", () => {
  const coordinator = new TechnicalChiefOfOperations();
  const item = task("failover");
  item.assignAgent("primary");
  coordinator.registerAgent("primary", false);
  coordinator.registerAgent("secondary");

  const decision = coordinator.failover(item, "secondary");

  assert.equal(decision.type, OperationalDecisionType.Failover);
  assert.equal(item.assignedAgent, "secondary");
  assert.throws(() => coordinator.failover(item, "unknown"), OperationalException);
});

test("automatically prepares waiting work for recovery", () => {
  const coordinator = new TechnicalChiefOfOperations();
  const item = task("recovery");
  item.transition(OperationalState.Preparing);
  item.transition(OperationalState.Waiting);

  const decision = coordinator.recover(item);

  assert.equal(decision.type, OperationalDecisionType.Recovery);
  assert.equal(item.status, OperationalState.Preparing);
  assert.equal(coordinator.state, OperationalState.Recovering);
});

test("generates CEO approval requests without approving work", () => {
  const coordinator = new TechnicalChiefOfOperations();
  const item = task("approval");
  item.transition(OperationalState.Preparing);

  const decision = coordinator.requestApproval(item, "CEO decision required");

  assert.equal(decision.type, OperationalDecisionType.ApprovalRequest);
  assert.equal(decision.detail, "CEO decision required");
  assert.equal(item.status, OperationalState.Waiting);
});

test("degrades gracefully and preserves work when an agent is unavailable", () => {
  const queue = new OperationalQueue();
  const coordinator = new TechnicalChiefOfOperations(queue);
  const item = task("preserved");
  item.assignAgent("worker");
  coordinator.registerAgent("worker", false);

  const decision = coordinator.coordinate(item);

  assert.equal(decision.type, OperationalDecisionType.Retry);
  assert.equal(item.status, OperationalState.Waiting);
  assert.equal(queue.peek(), item);
  assert.equal(coordinator.monitorHealth(), false);

  coordinator.setAgentAvailability("worker", true);
  coordinator.recover(item);
  assert.equal(queue.inspect().includes(item), true);
  assert.equal(coordinator.monitorHealth(), true);
});
