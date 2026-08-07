import { MemoryException } from "./MemoryException.ts";
import { MemoryId } from "./MemoryId.ts";
import { MemoryRecord } from "./MemoryRecord.ts";

export class MemoryRevision {
  readonly id: MemoryId; readonly revisions: readonly MemoryRecord[];
  constructor(id: MemoryId, revisions: readonly MemoryRecord[]) {
    if (!(id instanceof MemoryId) || revisions.length === 0 || revisions.some((record) => !(record instanceof MemoryRecord) || !record.id.equals(id))) throw new MemoryException("A revision history requires records for one memory identifier", "INVALID_REVISION_HISTORY");
    revisions.forEach((record, index) => { if (record.supersedesRevision !== (index === 0 ? undefined : index)) throw new MemoryException("Memory revisions are not an ordered immutable chain", "INVALID_REVISION_HISTORY"); });
    this.id = id; this.revisions = Object.freeze([...revisions]); Object.freeze(this);
  }
  get currentRevision(): MemoryRecord { return this.revisions[this.revisions.length - 1]; }
  previousRevision(revisionNumber = this.revisions.length): MemoryRecord | undefined { return revisionNumber <= 1 ? undefined : this.revisions[revisionNumber - 2]; }
  get fullHistory(): readonly MemoryRecord[] { return this.revisions; }
}
