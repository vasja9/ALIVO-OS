import { MemoryRecord } from "./MemoryRecord.ts";
export class MemoryResult {
  readonly records: readonly MemoryRecord[]; readonly count: number;
  constructor(records: readonly MemoryRecord[]) { this.records = Object.freeze([...records]); this.count = records.length; Object.freeze(this); }
}
