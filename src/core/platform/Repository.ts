import { EntityId } from "./EntityId.ts";
import { PersistenceException } from "./PersistenceException.ts";
import { RepositoryQuery } from "./RepositoryQuery.ts";
import { RepositoryRecord } from "./RepositoryRecord.ts";
import { RepositoryResult } from "./RepositoryResult.ts";
import type { RepositoryTransaction } from "./RepositoryTransaction.ts";
import { VersionToken } from "./VersionToken.ts";

export interface Repository {
  create(record: RepositoryRecord): RepositoryRecord;
  retrieve(entityId: EntityId): RepositoryRecord;
  query(query: RepositoryQuery): RepositoryResult;
  update(record: RepositoryRecord, expectedVersion: VersionToken): RepositoryRecord;
  delete(entityId: EntityId, expectedVersion: VersionToken): void;
  exists(entityId: EntityId): boolean;
}

/** In-memory contract-validation adapter; it makes no production storage decision. */
export class InMemoryRepository implements Repository, RepositoryTransaction {
  private records = new Map<string, RepositoryRecord>();
  private snapshot?: Map<string, RepositoryRecord>;

  create(record: RepositoryRecord): RepositoryRecord {
    this.requireRecord(record);
    const key = record.entityId.value;
    if (this.records.has(key)) throw new PersistenceException(`Record already exists: ${key}`, "DUPLICATE_RECORD");
    this.records.set(key, record);
    return record;
  }

  retrieve(entityId: EntityId): RepositoryRecord {
    this.requireId(entityId);
    const record = this.records.get(entityId.value);
    if (record === undefined) throw new PersistenceException(`Record not found: ${entityId}`, "RECORD_NOT_FOUND");
    return record;
  }

  query(query: RepositoryQuery): RepositoryResult {
    if (!(query instanceof RepositoryQuery)) throw new PersistenceException("Invalid repository query", "INVALID_QUERY");
    const ids = query.entityIds === undefined ? undefined : new Set(query.entityIds.map((id) => id.value));
    let records = [...this.records.values()].filter((record) =>
      (query.recordType === undefined || record.recordType === query.recordType) &&
      (ids === undefined || ids.has(record.entityId.value)));
    if (query.ordering === "entity-id") records.sort((left, right) =>
      left.entityId.value < right.entityId.value ? -1 : left.entityId.value > right.entityId.value ? 1 : 0);
    const totalCount = records.length;
    if (query.limit !== undefined) records = records.slice(0, query.limit);
    return totalCount === 0 ? RepositoryResult.empty(query.ordering) : new RepositoryResult(records, totalCount, query.ordering);
  }

  update(record: RepositoryRecord, expectedVersion: VersionToken): RepositoryRecord {
    this.requireRecord(record);
    const current = this.retrieve(record.entityId);
    this.requireExpectedVersion(current, expectedVersion);
    this.records.set(record.entityId.value, record);
    return record;
  }

  delete(entityId: EntityId, expectedVersion: VersionToken): void {
    const current = this.retrieve(entityId);
    this.requireExpectedVersion(current, expectedVersion);
    this.records.delete(entityId.value);
  }

  exists(entityId: EntityId): boolean {
    this.requireId(entityId);
    return this.records.has(entityId.value);
  }

  begin(): void {
    if (this.snapshot !== undefined) throw new PersistenceException("A transaction is already active", "OPERATION_FAILED");
    this.snapshot = new Map(this.records);
  }

  commit(): void {
    this.requireActiveTransaction();
    this.snapshot = undefined;
  }

  rollback(): void {
    this.requireActiveTransaction();
    this.records = this.snapshot as Map<string, RepositoryRecord>;
    this.snapshot = undefined;
  }

  isActive(): boolean { return this.snapshot !== undefined; }

  private requireActiveTransaction(): void {
    if (!this.isActive()) throw new PersistenceException("Transaction is not active", "INACTIVE_TRANSACTION");
  }

  private requireId(entityId: EntityId): void {
    if (!(entityId instanceof EntityId)) throw new PersistenceException("Invalid entity identifier", "INVALID_IDENTIFIER");
  }

  private requireRecord(record: RepositoryRecord): void {
    if (!(record instanceof RepositoryRecord)) throw new PersistenceException("Invalid repository record");
  }

  private requireExpectedVersion(record: RepositoryRecord, expectedVersion: VersionToken): void {
    if (!(expectedVersion instanceof VersionToken) || !record.version.equals(expectedVersion)) {
      throw new PersistenceException(`Stale version for record: ${record.entityId}`, "STALE_VERSION");
    }
  }
}
