import { EventException } from "./EventException.ts";
import { EventSubscription } from "./EventSubscription.ts";

export class EventRegistry {
  readonly #subscriptions = new Map<string, EventSubscription>();
  #nextOrder = 0;
  register(subscription: EventSubscription): EventSubscription {
    if (!(subscription instanceof EventSubscription)) throw new EventException("Cannot register an invalid event subscription");
    if (this.#subscriptions.has(subscription.id)) throw new EventException(`Duplicate event subscription: ${subscription.id}`);
    const registered = subscription.withRegistrationOrder(this.#nextOrder++);
    this.#subscriptions.set(registered.id, registered);
    return registered;
  }
  enable(id: string): void { this.#replaceState(id, true); }
  disable(id: string): void { this.#replaceState(id, false); }
  remove(id: string): void { if (!this.#subscriptions.delete(id)) throw new EventException(`Event subscription is not registered: ${id}`); }
  list(): readonly EventSubscription[] { return Object.freeze([...this.#subscriptions.values()].sort((a, b) => a.registrationOrder - b.registrationOrder)); }
  #replaceState(id: string, enabled: boolean): void {
    const current = this.#subscriptions.get(id);
    if (current === undefined) throw new EventException(`Event subscription is not registered: ${id}`);
    this.#subscriptions.set(id, current.withState(enabled));
  }
}
