import { EventCategory } from "./EventCategory.ts";
import { EventException } from "./EventException.ts";
import type { EventListener } from "./EventListener.ts";
import { SystemEvent } from "./SystemEvent.ts";
import { EventType } from "./EventType.ts";

/** One listener registration; state changes produce a new immutable registration. */
export class EventSubscription {
  readonly id: string;
  readonly listener: EventListener;
  readonly categories: readonly EventCategory[];
  readonly eventTypes: readonly EventType[];
  readonly enabled: boolean;
  readonly registrationOrder: number;

  constructor(id: string, listener: EventListener, categories: readonly EventCategory[], enabled?: boolean, registrationOrder?: number);
  constructor(listener: EventListener, eventTypes: readonly EventType[], enabled?: boolean);
  constructor(idOrListener: string | EventListener, listenerOrTypes: EventListener | readonly EventType[], categoriesOrEnabled: readonly EventCategory[] | boolean = [], enabled = true, registrationOrder = -1) {
    const legacy = typeof idOrListener !== "string";
    this.id = legacy ? crypto.randomUUID() : idOrListener;
    this.listener = (legacy ? idOrListener : listenerOrTypes) as EventListener;
    this.eventTypes = Object.freeze(legacy ? [...listenerOrTypes as readonly EventType[]] : []);
    this.categories = Object.freeze(legacy ? [] : [...categoriesOrEnabled as readonly EventCategory[]]);
    this.enabled = legacy ? (typeof categoriesOrEnabled === "boolean" ? categoriesOrEnabled : true) : enabled;
    this.registrationOrder = legacy ? -1 : registrationOrder;
    if (this.id.trim().length === 0 || typeof this.listener?.handle !== "function") throw new EventException("Event subscription is invalid");
    if ((legacy && (this.eventTypes.length === 0 || this.eventTypes.some(t => !(t instanceof EventType)))) ||
        (!legacy && (this.categories.length === 0 || this.categories.some(c => !Object.values(EventCategory).includes(c))))) throw new EventException("Event subscription requires valid categories");
    const keys = legacy ? this.eventTypes.map(t => t.value) : this.categories;
    if (new Set(keys).size !== keys.length) throw new EventException("Event subscription contains duplicate categories");
    Object.freeze(this);
  }
  accepts(event: SystemEvent): boolean {
    if (!this.enabled) return false;
    if (this.categories.length > 0) return this.categories.includes(event.category);
    return "type" in event && this.eventTypes.some(type => type.equals((event as SystemEvent & { type: EventType }).type));
  }
  withState(enabled: boolean): EventSubscription { return new EventSubscription(this.id, this.listener, this.categories, enabled, this.registrationOrder); }
  withRegistrationOrder(order: number): EventSubscription { return new EventSubscription(this.id, this.listener, this.categories, this.enabled, order); }
}
