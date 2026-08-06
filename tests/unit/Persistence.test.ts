import assert from "node:assert/strict";
import { test } from "node:test";

import { EntityId } from "../../src/core/platform/EntityId.ts";
import { PersistenceException } from "../../src/core/platform/PersistenceException.ts";
import { InMemoryRepository } from "../../src/core/platform/Repository.ts";
import { RepositoryQuery } from "../../src/core/platform/RepositoryQuery.ts";
import { RepositoryRecord, type PersistencePayload } from "../../src/core/platform/RepositoryRecord.ts";
import { VersionToken } from "../../src/core/platform/VersionToken.ts";

const instant = new Date("2026-08-06T00:00:00Z");

function record(id: string, version: string, payload: PersistencePayload = { value: id }, type = "generic"): RepositoryRecord {
  return new RepositoryRecord({
    entityId: new EntityId(id),
    version: new VersionToken(version),
    recordType: type,
    payload,
    createdAt: instant,
    updatedAt: instant,
  });
}

test("entity identifiers and version tokens are immutable value objects", () => {
  const id = new EntityId("arbitrary value");
  const version = new VersionToken("opaque/version");
  assert.equal(Object.isFrozen(id), true);
  assert.equal(Object.isFrozen(version), true);
  assert.equal(id.equals(new EntityId("arbitrary value")), true);
  assert.equal(version.equals(new VersionToken("opaque/version")), true);
  assert.throws(() => new EntityId(" "), (error: PersistenceException) => error.failure === "INVALID_IDENTIFIER");
});

test("records detach and deeply freeze payload and timestamps", () => {
  const payload = { nested: { count: 1 }, values: ["one"] };
  const createdAt = new Date(instant);
  const stored = new RepositoryRecord({ entityId: new EntityId("one"), version: new VersionToken("1"),
    recordType: "generic", payload, createdAt, updatedAt: createdAt });
  payload.nested.count = 2;
  payload.values.push("two");
  createdAt.setTime(0);

  assert.deepEqual(stored.payload, { nested: { count: 1 }, values: ["one"] });
  assert.equal(Object.isFrozen(stored.payload.nested), true);
  assert.equal(stored.createdAt.getTime(), instant.getTime());
  assert.throws(() => (stored.payload.nested as { count: number }).count = 3, TypeError);
});

test("create, duplicate rejection, retrieval, existence, and immutable returned records", () => {
  const repository = new InMemoryRepository();
  const created = repository.create(record("one", "1"));
  assert.equal(repository.retrieve(new EntityId("one")), created);
  assert.equal(repository.exists(new EntityId("one")), true);
  assert.equal(Object.isFrozen(repository.retrieve(new EntityId("one"))), true);
  assert.throws(() => repository.create(record("one", "2")),
    (error: PersistenceException) => error.failure === "DUPLICATE_RECORD");
});

test("queries preserve deterministic insertion order, support requested ordering, and return immutable empty results", () => {
  const repository = new InMemoryRepository();
  repository.create(record("z", "1", {}, "selected"));
  repository.create(record("a", "1", {}, "selected"));
  repository.create(record("m", "1", {}, "other"));

  const insertion = repository.query(new RepositoryQuery({ recordType: "selected" }));
  assert.deepEqual(insertion.records.map((item) => item.entityId.value), ["z", "a"]);
  assert.equal(insertion.totalCount, 2);
  assert.throws(() => (insertion.records as RepositoryRecord[]).pop(), TypeError);
  const ordered = repository.query(new RepositoryQuery({ ordering: "entity-id", limit: 2 }));
  assert.deepEqual(ordered.records.map((item) => item.entityId.value), ["a", "m"]);
  assert.equal(ordered.totalCount, 3);
  const empty = repository.query(new RepositoryQuery({ entityIds: [new EntityId("missing")] }));
  assert.deepEqual(empty.records, []);
  assert.equal(empty.totalCount, 0);
  assert.equal(Object.isFrozen(empty), true);
});

test("updates and deletions enforce expected versions", () => {
  const repository = new InMemoryRepository();
  repository.create(record("one", "1"));
  const updated = record("one", "2", { value: "changed" });
  assert.equal(repository.update(updated, new VersionToken("1")), updated);
  assert.throws(() => repository.update(record("one", "3"), new VersionToken("1")),
    (error: PersistenceException) => error.failure === "STALE_VERSION");
  assert.throws(() => repository.delete(new EntityId("one"), new VersionToken("1")),
    (error: PersistenceException) => error.failure === "STALE_VERSION");
  repository.delete(new EntityId("one"), new VersionToken("2"));
  assert.equal(repository.exists(new EntityId("one")), false);
});

test("transactions commit, rollback, and reject inactive operations", () => {
  const repository = new InMemoryRepository();
  repository.begin();
  repository.create(record("committed", "1"));
  assert.equal(repository.isActive(), true);
  repository.commit();
  assert.equal(repository.exists(new EntityId("committed")), true);
  repository.begin();
  repository.create(record("rolled-back", "1"));
  repository.rollback();
  assert.equal(repository.exists(new EntityId("rolled-back")), false);
  assert.throws(() => repository.commit(),
    (error: PersistenceException) => error.failure === "INACTIVE_TRANSACTION");
  assert.throws(() => repository.rollback(),
    (error: PersistenceException) => error.failure === "INACTIVE_TRANSACTION");
});

test("ordinary record diagnostics redact the entire payload", () => {
  const stored = record("sensitive", "1", { password: "hidden", nested: { credential: "secret" } });
  assert.match(stored.toString(), /\[REDACTED\]/);
  assert.equal(stored.toString().includes("hidden"), false);
  const diagnostic = JSON.stringify(stored);
  assert.match(diagnostic, /\[REDACTED\]/);
  assert.equal(diagnostic.includes("hidden"), false);
  assert.equal(diagnostic.includes("secret"), false);
});
