import { AuditEventType } from "./AuditEventType.ts";
import { AuditException } from "./AuditException.ts";
import { protectStructuredContext, type StructuredContext } from "./LogEntry.ts";

export interface AuditEventProperties {
  readonly id?: string;
  readonly timestamp?: Date;
  readonly type: AuditEventType;
  readonly source: string;
  readonly action: string;
  readonly result: string;
  readonly responsibleIdentity: string;
  readonly relatedTaskOrWorkflowId?: string;
  readonly context?: StructuredContext;
}

/** One immutable, attributable and security-filtered audit record. */
export class AuditEvent {
  readonly #timestampMs: number;
  readonly id: string;
  readonly type: AuditEventType;
  readonly source: string;
  readonly action: string;
  readonly result: string;
  readonly responsibleIdentity: string;
  readonly relatedTaskOrWorkflowId?: string;
  readonly context?: StructuredContext;

  constructor(properties: AuditEventProperties) {
    if (properties === null || typeof properties !== "object") throw new AuditException("Invalid audit event");
    if (typeof properties.source !== "string" || properties.source.trim().length === 0) {
      throw new AuditException("Audit event source is required");
    }
    if (typeof properties.responsibleIdentity !== "string" || properties.responsibleIdentity.trim().length === 0) {
      throw new AuditException("Audit event responsible identity is required");
    }
    if (!Object.values(AuditEventType).includes(properties.type)) throw new AuditException("Invalid audit event type");
    if (typeof properties.action !== "string" || properties.action.trim().length === 0 ||
        typeof properties.result !== "string" || properties.result.trim().length === 0) {
      throw new AuditException("Audit event action and result are required");
    }

    this.id = properties.id ?? crypto.randomUUID();
    this.#timestampMs = properties.timestamp?.getTime() ?? Date.now();
    if (Number.isNaN(this.#timestampMs)) throw new AuditException("Invalid audit event timestamp");
    this.type = properties.type;
    this.source = properties.source;
    this.action = properties.action;
    this.result = properties.result;
    this.responsibleIdentity = properties.responsibleIdentity;
    this.relatedTaskOrWorkflowId = properties.relatedTaskOrWorkflowId;
    try {
      this.context = protectStructuredContext(properties.context);
    } catch (error) {
      throw new AuditException("Invalid audit event context", { cause: error });
    }
    Object.freeze(this);
  }

  get timestamp(): Date {
    return new Date(this.#timestampMs);
  }
}
