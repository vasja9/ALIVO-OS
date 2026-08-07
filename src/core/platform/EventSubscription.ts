import { EventException } from "./EventException.ts";
import type { EventListener } from "./EventListener.ts";
import { EventType } from "./EventType.ts";

/** Immutable listener registration. */
export class EventSubscription {
  readonly listener: EventListener;
  readonly eventTypes: readonly EventType[];
  readonly enabled: boolean;

  constructor(listener: EventListener, eventTypes: readonly EventType[], enabled = true) {
    if (listener === null || typeof listener !== "object" || typeof listener.handle !== "function") {
      throw new EventException("Event subscription listener is invalid");
    }
    if (!Array.isArray(eventTypes) || eventTypes.length === 0 ||
        eventTypes.some((type) => !(type instanceof EventType))) {
      throw new EventException("Event subscription requires at least one event type");
    }
    if (new Set(eventTypes.map((type) => type.value)).size !== eventTypes.length) {
      throw new EventException("Event subscription contains duplicate event types");
    }
    if (typeof enabled !== "boolean") throw new EventException("Event subscription enabled state is invalid");
    this.listener = listener;
    this.eventTypes = Object.freeze([...eventTypes]);
    this.enabled = enabled;
    Object.freeze(this);
  }

  accepts(type: EventType): boolean {
    return this.enabled && this.eventTypes.some((subscribedType) => subscribedType.equals(type));
  }
}
