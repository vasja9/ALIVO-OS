import { EventContext } from "./EventContext.ts";
import { EventException } from "./EventException.ts";
import { EventId } from "./EventId.ts";
import { EventType } from "./EventType.ts";

export interface EventProperties {
  readonly id: EventId;
  readonly type: EventType;
  readonly timestamp: Date;
  readonly source: string;
  readonly correlationId: string;
  readonly context?: EventContext;
}

/** One immutable system event. */
export class Event {
  readonly #timestampMs: number;
  readonly id: EventId;
  readonly type: EventType;
  readonly source: string;
  readonly correlationId: string;
  readonly context?: EventContext;

  constructor(properties: EventProperties) {
    if (properties === null || typeof properties !== "object") {
      throw new EventException("Invalid event");
    }
    if (!(properties.id instanceof EventId) || !(properties.type instanceof EventType)) {
      throw new EventException("Event identifier and type are required");
    }
    if (!(properties.timestamp instanceof Date) || Number.isNaN(properties.timestamp.getTime())) {
      throw new EventException("Event timestamp is invalid");
    }
    if (typeof properties.source !== "string" || properties.source.trim().length === 0) {
      throw new EventException("Event source is required");
    }
    if (typeof properties.correlationId !== "string" || properties.correlationId.trim().length === 0) {
      throw new EventException("Event correlation identifier is required");
    }
    if (properties.context !== undefined && !(properties.context instanceof EventContext)) {
      throw new EventException("Event context is invalid");
    }
    this.id = properties.id;
    this.type = properties.type;
    this.#timestampMs = properties.timestamp.getTime();
    this.source = properties.source;
    this.correlationId = properties.correlationId;
    this.context = properties.context;
    Object.freeze(this);
  }

  get timestamp(): Date {
    return new Date(this.#timestampMs);
  }
}
