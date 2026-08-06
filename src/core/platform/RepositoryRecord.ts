import { EntityId } from "./EntityId.ts";
import { PersistenceException } from "./PersistenceException.ts";
import { VersionToken } from "./VersionToken.ts";

export type PersistenceValue = null | boolean | number | string | PersistenceValue[] | { [key: string]: PersistenceValue };
export type PersistencePayload = Readonly<Record<string, PersistenceValue>>;

function copy(value: PersistenceValue, seen = new Set<object>()): PersistenceValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PersistenceException("Payload numbers must be finite");
    return value;
  }
  if (typeof value !== "object") {
    throw new PersistenceException("Payload contains an unsupported value");
  }
  if (seen.has(value)) throw new PersistenceException("Payload must not contain cycles");
  seen.add(value);
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new PersistenceException("Payload contains an unsupported object");
  }
  const result = Array.isArray(value)
    ? value.map((item) => copy(item, seen))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item, seen)]));
  seen.delete(value);
  return Object.freeze(result) as PersistenceValue;
}

export interface RepositoryRecordProperties {
  readonly entityId: EntityId;
  readonly version: VersionToken;
  readonly recordType: string;
  readonly payload: PersistencePayload;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A generic immutable record whose diagnostic forms never reveal its payload. */
export class RepositoryRecord {
  readonly entityId: EntityId;
  readonly version: VersionToken;
  readonly recordType: string;
  readonly payload: PersistencePayload;
  readonly #createdAtMs: number;
  readonly #updatedAtMs: number;

  constructor(properties: RepositoryRecordProperties) {
    if (!(properties?.entityId instanceof EntityId) || !(properties.version instanceof VersionToken)) {
      throw new PersistenceException("Record identifier and version are required");
    }
    if (typeof properties.recordType !== "string" || properties.recordType.trim().length === 0) {
      throw new PersistenceException("Record type must not be empty");
    }
    if (properties.payload === null || typeof properties.payload !== "object" || Array.isArray(properties.payload)) {
      throw new PersistenceException("Record payload must be an object");
    }
    this.#createdAtMs = properties.createdAt?.getTime();
    this.#updatedAtMs = properties.updatedAt?.getTime();
    if (!Number.isFinite(this.#createdAtMs) || !Number.isFinite(this.#updatedAtMs) || this.#updatedAtMs < this.#createdAtMs) {
      throw new PersistenceException("Record timestamps are invalid");
    }
    this.entityId = properties.entityId;
    this.version = properties.version;
    this.recordType = properties.recordType;
    this.payload = copy(properties.payload as { [key: string]: PersistenceValue }) as PersistencePayload;
    Object.freeze(this);
  }

  get createdAt(): Date { return new Date(this.#createdAtMs); }
  get updatedAt(): Date { return new Date(this.#updatedAtMs); }
  toString(): string { return `RepositoryRecord(${this.entityId}, ${this.recordType}, payload=[REDACTED])`; }
  toJSON(): object {
    return { entityId: this.entityId.value, version: this.version.value, recordType: this.recordType,
      payload: "[REDACTED]", createdAt: this.createdAt, updatedAt: this.updatedAt };
  }
}
