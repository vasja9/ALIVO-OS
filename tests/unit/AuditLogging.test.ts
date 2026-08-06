import assert from "node:assert/strict";
import { test } from "node:test";

import { AuditEvent } from "../../src/core/platform/AuditEvent.ts";
import { AuditEventType } from "../../src/core/platform/AuditEventType.ts";
import { AuditException } from "../../src/core/platform/AuditException.ts";
import { AuditRecorder } from "../../src/core/platform/AuditRecorder.ts";
import { LogEntry } from "../../src/core/platform/LogEntry.ts";
import { LogLevel } from "../../src/core/platform/LogLevel.ts";
import { Logger } from "../../src/core/platform/Logger.ts";

function audit(overrides: Partial<ConstructorParameters<typeof AuditEvent>[0]> = {}): AuditEvent {
  return new AuditEvent({
    id: "event-1",
    timestamp: new Date("2026-01-01T00:00:00Z"),
    type: AuditEventType.SecurityEvent,
    source: "platform",
    action: "authenticate",
    result: "accepted",
    responsibleIdentity: "operator-1",
    ...overrides,
  });
}

test("log entries are immutable detached records with redacted context", () => {
  const context = { request: { token: "secret", count: 1 }, password: "hidden" };
  const entry = new LogEntry({ level: LogLevel.Information, source: "kernel", message: "started", context });
  context.request.count = 2;
  const exposedTimestamp = entry.timestamp;
  exposedTimestamp.setUTCFullYear(1999);

  assert.equal(Object.isFrozen(entry), true);
  assert.equal(Object.isFrozen(entry.context), true);
  assert.deepEqual(entry.context, { request: { token: "[REDACTED]", count: 1 }, password: "[REDACTED]" });
  assert.notEqual(entry.timestamp.getUTCFullYear(), 1999);
  assert.equal(JSON.stringify(entry).includes("secret"), false);
  assert.equal(JSON.stringify(entry).includes("hidden"), false);
});

test("logger preserves insertion order, filters entries, and clears explicitly", () => {
  const logger = new Logger();
  const first = new LogEntry({ id: "1", level: LogLevel.Warning, source: "kernel", message: "first" });
  const second = new LogEntry({ id: "2", level: LogLevel.Error, source: "module", message: "second" });
  const third = new LogEntry({ id: "3", level: LogLevel.Warning, source: "kernel", message: "third" });
  logger.record(first);
  logger.record(second);
  logger.record(third);

  assert.deepEqual(logger.getEntries(), [first, second, third]);
  assert.deepEqual(logger.filterByLevel(LogLevel.Warning), [first, third]);
  assert.deepEqual(logger.filterBySource("module"), [second]);
  assert.throws(() => (logger.getEntries() as LogEntry[]).pop(), TypeError);
  logger.clear();
  assert.deepEqual(logger.getEntries(), []);
});

test("audit events are immutable, attributable, and centrally redacted", () => {
  const event = audit({ context: { apiKey: "key", nested: { credential: "value" } } });
  const timestamp = event.timestamp;
  timestamp.setTime(0);

  assert.equal(Object.isFrozen(event), true);
  assert.deepEqual(event.context, { apiKey: "[REDACTED]", nested: { credential: "[REDACTED]" } });
  assert.notEqual(event.timestamp.getTime(), 0);
  assert.equal(JSON.stringify(event).includes("key"), false);
  assert.equal(JSON.stringify(event).includes("value"), false);
});

test("audit recorder is append-only and preserves chronological append order", () => {
  const recorder = new AuditRecorder();
  const first = audit({ id: "first", timestamp: new Date("2026-02-01Z") });
  const second = audit({ id: "second", timestamp: new Date("2026-01-01Z"), source: "module", responsibleIdentity: "operator-2", type: AuditEventType.ModuleLifecycle });
  recorder.append(first);
  recorder.append(second);

  assert.deepEqual(recorder.getEvents(), [first, second]);
  assert.deepEqual(recorder.filterByEventType(AuditEventType.ModuleLifecycle), [second]);
  assert.deepEqual(recorder.filterBySource("platform"), [first]);
  assert.deepEqual(recorder.filterByResponsibleIdentity("operator-2"), [second]);
  assert.throws(() => (recorder.getEvents() as AuditEvent[]).reverse(), TypeError);
  assert.throws(() => recorder.append(audit({ id: "first" })), AuditException);
});

test("invalid audit records and contexts are rejected clearly", () => {
  assert.throws(() => audit({ source: " " }), /source is required/);
  assert.throws(() => audit({ responsibleIdentity: "" }), /responsible identity is required/);
  assert.throws(() => audit({ type: "invalid" as AuditEventType }), /Invalid audit event type/);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => audit({ context: cyclic }), /Invalid audit event context/);
  assert.throws(() => new AuditRecorder().append({} as AuditEvent), /Invalid audit event/);
});
