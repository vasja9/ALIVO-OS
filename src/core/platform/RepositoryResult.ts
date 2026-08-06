import { RepositoryRecord } from "./RepositoryRecord.ts";
import type { RepositoryOrdering } from "./RepositoryQuery.ts";

/** An immutable, deterministically ordered query result. */
export class RepositoryResult {
  readonly records: readonly RepositoryRecord[];
  readonly totalCount: number;
  readonly ordering: RepositoryOrdering;

  constructor(records: readonly RepositoryRecord[], totalCount: number, ordering: RepositoryOrdering) {
    this.records = Object.freeze([...records]);
    this.totalCount = totalCount;
    this.ordering = ordering;
    Object.freeze(this);
  }

  static empty(ordering: RepositoryOrdering = "insertion"): RepositoryResult {
    return new RepositoryResult([], 0, ordering);
  }
}
