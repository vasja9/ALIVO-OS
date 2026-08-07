import assert from "node:assert/strict";
import { test } from "node:test";

import { AuditRecorder } from "../../src/core/platform/AuditRecorder.ts";
import { EventCategory } from "../../src/core/platform/EventCategory.ts";
import { EventContext } from "../../src/core/platform/EventContext.ts";
import { EventDispatcher } from "../../src/core/platform/EventDispatcher.ts";
import { EventException } from "../../src/core/platform/EventException.ts";
import { EventId } from "../../src/core/platform/EventId.ts";
import { EventRegistry } from "../../src/core/platform/EventRegistry.ts";
import { EventSeverity } from "../../src/core/platform/EventSeverity.ts";
import { EventStream } from "../../src/core/platform/EventStream.ts";
import { EventSubscription } from "../../src/core/platform/EventSubscription.ts";
import { Logger } from "../../src/core/platform/Logger.ts";
import { SystemEvent } from "../../src/core/platform/SystemEvent.ts";

function operational(name: string, overrides: Partial<ConstructorParameters<typeof SystemEvent>[0]> = {}): SystemEvent {
  return new SystemEvent({ id: new EventId(name), category: EventCategory.AgentAvailability, severity: EventSeverity.Notice,
    timestamp: new Date("2026-08-07T12:00:00Z"), source: "AWM", name, correlationId: "operation-1",
    taskId: "task-1", workflowId: "workflow-1", agentId: "agent-1", ...overrides });
}

test("system events and redacted structured context are immutable and traceable", () => {
  const timestamp = new Date("2026-08-07T12:00:00Z");
  const input = { apiKey: "secret", nested: { password: "hidden", safe: true } };
  const event = operational("PrimaryAgentRecovered", { timestamp, context: new EventContext(input) });
  timestamp.setTime(0); input.nested.safe = false;
  assert.equal(event.timestamp.toISOString(), "2026-08-07T12:00:00.000Z");
  assert.deepEqual(event.context?.values, { apiKey: "[REDACTED]", nested: { password: "[REDACTED]", safe: true } });
  assert.equal(event.correlationId, "operation-1");
  assert.equal(Object.isFrozen(event), true);
});

test("registry rejects duplicates and preserves deterministic order and enabled state", () => {
  const registry = new EventRegistry(); const received: string[] = [];
  registry.register(new EventSubscription("first", { handle: () => received.push("first") }, [EventCategory.AgentAvailability]));
  registry.register(new EventSubscription("second", { handle: () => received.push("second") }, [EventCategory.AgentAvailability]));
  assert.throws(() => registry.register(new EventSubscription("first", { handle() {} }, [EventCategory.Recovery])), EventException);
  registry.disable("first"); new EventDispatcher(registry).dispatch(operational("TemporaryAgentActivated"));
  assert.deepEqual(received, ["second"]); registry.enable("first");
  new EventDispatcher(registry).dispatch(operational("PrimaryAgentRestored"));
  assert.deepEqual(received, ["second", "first", "second"]);
  assert.deepEqual(registry.list().map(s => s.registrationOrder), [0, 1]);
});

test("dispatcher isolates a failed listener, continues, and reports through logging and audit", () => {
  const registry = new EventRegistry(); const delivered: string[] = []; const logger = new Logger(); const audit = new AuditRecorder();
  registry.register(new EventSubscription("bad", { handle() { throw new Error("offline"); } }, [EventCategory.AgentAvailability]));
  registry.register(new EventSubscription("good", { handle: event => delivered.push(event.name) }, [EventCategory.AgentAvailability]));
  const failures = new EventDispatcher(registry, logger, audit).dispatch(operational("TemporaryAgentActivated"));
  assert.deepEqual(delivered, ["TemporaryAgentActivated"]); assert.equal(failures.length, 1);
  assert.equal(logger.getEntries().length, 1); assert.equal(audit.getEvents().length, 1);
});

test("append-only chronological stream supports operational filters and recovery facts", () => {
  const stream = new EventStream();
  const recovered = operational("PrimaryAgentRecovered", { category: EventCategory.Recovery });
  const activated = operational("TemporaryAgentActivated", { id: new EventId("activated"), timestamp: new Date("2026-08-07T12:01:00Z"), severity: EventSeverity.Critical });
  stream.append(recovered); stream.append(activated);
  assert.deepEqual(stream.getEvents(), [recovered, activated]);
  assert.deepEqual(stream.filterByCategory(EventCategory.Recovery), [recovered]);
  assert.deepEqual(stream.filterBySeverity(EventSeverity.Critical), [activated]);
  assert.deepEqual(stream.filterBySource("AWM"), [recovered, activated]);
  assert.deepEqual(stream.filterByCorrelationId("operation-1"), [recovered, activated]);
  assert.deepEqual(stream.filterByTask("task-1"), [recovered, activated]);
  assert.deepEqual(stream.filterByWorkflow("workflow-1"), [recovered, activated]);
  assert.deepEqual(stream.filterByAgent("agent-1"), [recovered, activated]);
  assert.throws(() => (stream.getEvents() as SystemEvent[]).pop(), TypeError);
  assert.throws(() => stream.append(operational("late", { timestamp: new Date("2026-08-07T11:00:00Z") })), EventException);
  assert.equal("assignAgent" in stream || "recover" in stream || "startWorkflow" in stream, false);
});
