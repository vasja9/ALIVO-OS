import assert from "node:assert/strict";
import { test } from "node:test";

import { Event } from "../../src/core/platform/Event.ts";
import { EventBus } from "../../src/core/platform/EventBus.ts";
import { EventContext } from "../../src/core/platform/EventContext.ts";
import { EventDispatcher } from "../../src/core/platform/EventDispatcher.ts";
import { EventException } from "../../src/core/platform/EventException.ts";
import { EventId } from "../../src/core/platform/EventId.ts";
import type { EventListener } from "../../src/core/platform/EventListener.ts";
import { EventSubscription } from "../../src/core/platform/EventSubscription.ts";
import { EventType } from "../../src/core/platform/EventType.ts";

const type = new EventType("platform.lifecycle");

function event(id: string, correlationId = "correlation-1"): Event {
  return new Event({
    id: new EventId(id),
    type,
    timestamp: new Date("2026-08-07T12:00:00.000Z"),
    source: "test",
    correlationId,
    context: new EventContext({ nested: { values: [1, "two"] } }),
  });
}

test("events and their structured context are immutable", () => {
  const originalTimestamp = new Date("2026-08-07T12:00:00.000Z");
  const contextSource = { nested: { value: "initial" } };
  const systemEvent = new Event({
    id: new EventId("event-1"), type, timestamp: originalTimestamp,
    source: "test", correlationId: "correlation-immutable",
    context: new EventContext(contextSource),
  });

  originalTimestamp.setUTCFullYear(2000);
  contextSource.nested.value = "changed";

  assert.equal(systemEvent.timestamp.toISOString(), "2026-08-07T12:00:00.000Z");
  assert.equal((systemEvent.context?.values.nested as { readonly value: string }).value, "initial");
  assert.equal(Object.isFrozen(systemEvent), true);
  assert.equal(Object.isFrozen(systemEvent.context?.values.nested), true);
  assert.notEqual(systemEvent.timestamp, systemEvent.timestamp);
});

test("registers and enumerates subscriptions in registration order", () => {
  const bus = new EventBus();
  const first = new EventSubscription({ handle() {} }, [type]);
  const second = new EventSubscription({ handle() {} }, [type]);
  bus.subscribe(first);
  bus.subscribe(second);

  assert.deepEqual(bus.getSubscriptions(), [first, second]);
  assert.equal(Object.isFrozen(bus.getSubscriptions()), true);
});

test("rejects duplicate listener registrations for the same event types", () => {
  const bus = new EventBus();
  const listener: EventListener = { handle() {} };
  bus.subscribe(new EventSubscription(listener, [type]));

  assert.throws(
    () => bus.subscribe(new EventSubscription(listener, [new EventType(type.value)])),
    EventException,
  );
});

test("unsubscribe removes a registration from future publications", () => {
  const received: string[] = [];
  const subscription = new EventSubscription(
    { handle(value) { received.push(value.id.value); } },
    [type],
  );
  const bus = new EventBus();
  bus.subscribe(subscription);
  bus.unsubscribe(subscription);
  bus.publish(event("event-after-unsubscribe"));

  assert.deepEqual(received, []);
  assert.deepEqual(bus.getSubscriptions(), []);
});

test("publishes events synchronously in deterministic publication and listener order", () => {
  const received: string[] = [];
  const bus = new EventBus();
  bus.subscribe(new EventSubscription(
    { handle(value) { received.push(`first:${value.id.value}`); } }, [type],
  ));
  bus.subscribe(new EventSubscription(
    { handle(value) { received.push(`second:${value.id.value}`); } }, [type],
  ));

  bus.publish(event("one"));
  bus.publish(event("two"));

  assert.deepEqual(received, ["first:one", "second:one", "first:two", "second:two"]);
});

test("isolates listener failure and continues dispatching remaining listeners", () => {
  const received: string[] = [];
  const bus = new EventBus();
  bus.subscribe(new EventSubscription({ handle() { throw new Error("failure"); } }, [type]));
  bus.subscribe(new EventSubscription(
    { handle(value) { received.push(value.id.value); } }, [type],
  ));

  const failures = bus.publish(event("resilient"));

  assert.deepEqual(received, ["resilient"]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0] instanceof EventException, true);
  assert.equal((failures[0].cause as Error).message, "failure");
});

test("dispatcher skips disabled and unrelated subscriptions while continuing", () => {
  const received: string[] = [];
  const subscriptions = [
    new EventSubscription({ handle() { received.push("disabled"); } }, [type], false),
    new EventSubscription({ handle() { received.push("unrelated"); } }, [new EventType("other")]),
    new EventSubscription({ handle() { received.push("matching"); } }, [type]),
  ];

  const failures = new EventDispatcher().dispatch(event("direct"), subscriptions);

  assert.deepEqual(received, ["matching"]);
  assert.deepEqual(failures, []);
});

test("preserves the correlation identifier for every listener", () => {
  const correlations: string[] = [];
  const bus = new EventBus();
  bus.subscribe(new EventSubscription(
    { handle(value) { correlations.push(value.correlationId); } }, [type],
  ));
  bus.subscribe(new EventSubscription(
    { handle(value) { correlations.push(value.correlationId); } }, [type],
  ));

  bus.publish(event("correlated", "correlation-preserved"));

  assert.deepEqual(correlations, ["correlation-preserved", "correlation-preserved"]);
});
