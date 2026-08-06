import { EntityId } from "./EntityId.ts";
import { PersistenceException } from "./PersistenceException.ts";

export type RepositoryOrdering = "insertion" | "entity-id";

export interface RepositoryQueryProperties {
  readonly recordType?: string;
  readonly entityIds?: readonly EntityId[];
  readonly limit?: number;
  readonly ordering?: RepositoryOrdering;
}

/** A deliberately small, technology-independent persistence query. */
export class RepositoryQuery {
  readonly recordType?: string;
  readonly entityIds?: readonly EntityId[];
  readonly limit?: number;
  readonly ordering: RepositoryOrdering;

  constructor(properties: RepositoryQueryProperties = {}) {
    if (properties.recordType !== undefined && (typeof properties.recordType !== "string" || properties.recordType.trim().length === 0)) {
      throw new PersistenceException("Query record type is invalid", "INVALID_QUERY");
    }
    if (properties.limit !== undefined && (!Number.isSafeInteger(properties.limit) || properties.limit < 0)) {
      throw new PersistenceException("Query limit is invalid", "INVALID_QUERY");
    }
    if (properties.entityIds?.some((id) => !(id instanceof EntityId))) {
      throw new PersistenceException("Query entity identifiers are invalid", "INVALID_QUERY");
    }
    if (properties.ordering !== undefined && properties.ordering !== "insertion" && properties.ordering !== "entity-id") {
      throw new PersistenceException("Query ordering is invalid", "INVALID_QUERY");
    }
    this.recordType = properties.recordType;
    this.entityIds = properties.entityIds === undefined ? undefined : Object.freeze([...properties.entityIds]);
    this.limit = properties.limit;
    this.ordering = properties.ordering ?? "insertion";
    Object.freeze(this);
  }
}
