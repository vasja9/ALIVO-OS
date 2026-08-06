import { AuditEvent } from "./AuditEvent.ts";
import { AuditEventType } from "./AuditEventType.ts";
import { AuditException } from "./AuditException.ts";

/** Append-only, in-memory recorder for authoritative audit history. */
export class AuditRecorder {
  readonly #events: AuditEvent[] = [];

  append(event: AuditEvent): void {
    if (!(event instanceof AuditEvent)) throw new AuditException("Invalid audit event");
    if (this.#events.some((recorded) => recorded.id === event.id)) {
      throw new AuditException(`Audit event is already recorded: ${event.id}`);
    }
    this.#events.push(event);
  }

  getEvents(): readonly AuditEvent[] {
    return Object.freeze([...this.#events]);
  }

  filterByEventType(type: AuditEventType): readonly AuditEvent[] {
    return Object.freeze(this.#events.filter((event) => event.type === type));
  }

  filterBySource(source: string): readonly AuditEvent[] {
    return Object.freeze(this.#events.filter((event) => event.source === source));
  }

  filterByResponsibleIdentity(identity: string): readonly AuditEvent[] {
    return Object.freeze(this.#events.filter((event) => event.responsibleIdentity === identity));
  }
}
