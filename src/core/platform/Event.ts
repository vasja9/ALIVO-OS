import { EventCategory } from "./EventCategory.ts";
import { EventContext } from "./EventContext.ts";
import { EventId } from "./EventId.ts";
import { EventSeverity } from "./EventSeverity.ts";
import { SystemEvent } from "./SystemEvent.ts";
import { EventType } from "./EventType.ts";

export interface EventProperties { readonly id: EventId; readonly type: EventType; readonly timestamp: Date; readonly source: string; readonly correlationId: string; readonly context?: EventContext; }

/** Compatibility form of SystemEvent retained for existing foundation consumers. */
export class Event extends SystemEvent {
  readonly type: EventType;
  constructor(properties: EventProperties) {
    super({ ...properties, category: EventCategory.SystemLifecycle, severity: EventSeverity.Informational, name: properties.type?.value });
    this.type = properties.type;
    Object.freeze(this);
  }
}
