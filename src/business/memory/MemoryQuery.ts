import { MemoryException } from "./MemoryException.ts";
import { MemorySource } from "./MemorySource.ts";
import { MemoryStatus } from "./MemoryStatus.ts";
import { MemoryType } from "./MemoryType.ts";

export interface MemoryQueryProperties { readonly type?: MemoryType; readonly status?: MemoryStatus; readonly source?: MemorySource; readonly minimumConfidence?: number; readonly relatedTask?: string; readonly relatedWorkflow?: string; readonly createdFrom?: Date; readonly createdTo?: Date; }
export class MemoryQuery {
  readonly type?: MemoryType; readonly status?: MemoryStatus; readonly source?: MemorySource; readonly minimumConfidence?: number; readonly relatedTask?: string; readonly relatedWorkflow?: string; readonly #from?: number; readonly #to?: number;
  constructor(properties: MemoryQueryProperties = {}) {
    if (properties.minimumConfidence !== undefined && (!Number.isFinite(properties.minimumConfidence) || properties.minimumConfidence < 0 || properties.minimumConfidence > 1)) throw new MemoryException("Minimum confidence must be between zero and one", "INVALID_QUERY");
    this.#from = properties.createdFrom?.getTime(); this.#to = properties.createdTo?.getTime();
    if ((this.#from !== undefined && !Number.isFinite(this.#from)) || (this.#to !== undefined && !Number.isFinite(this.#to)) || (this.#from !== undefined && this.#to !== undefined && this.#from > this.#to)) throw new MemoryException("Creation range is invalid", "INVALID_QUERY");
    this.type = properties.type; this.status = properties.status; this.source = properties.source; this.minimumConfidence = properties.minimumConfidence; this.relatedTask = properties.relatedTask; this.relatedWorkflow = properties.relatedWorkflow; Object.freeze(this);
  }
  get createdFrom(): Date | undefined { return this.#from === undefined ? undefined : new Date(this.#from); }
  get createdTo(): Date | undefined { return this.#to === undefined ? undefined : new Date(this.#to); }
}
