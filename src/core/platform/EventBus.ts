import { Event } from "./Event.ts";
import { EventDispatcher } from "./EventDispatcher.ts";
import { EventException } from "./EventException.ts";
import { EventSubscription } from "./EventSubscription.ts";

/** In-memory, synchronous publication and subscription boundary. */
export class EventBus {
  readonly #subscriptions: EventSubscription[] = [];

  constructor(private readonly dispatcher = new EventDispatcher()) {}

  publish(event: Event): readonly EventException[] {
    if (!(event instanceof Event)) throw new EventException("Cannot publish an invalid event");
    return this.dispatcher.dispatch(event, this.#subscriptions);
  }

  subscribe(subscription: EventSubscription): void {
    if (!(subscription instanceof EventSubscription)) {
      throw new EventException("Cannot register an invalid event subscription");
    }
    const duplicate = this.#subscriptions.some((registered) =>
      registered.listener === subscription.listener &&
      registered.eventTypes.length === subscription.eventTypes.length &&
      registered.eventTypes.every((type) =>
        subscription.eventTypes.some((candidate) => candidate.equals(type))),
    );
    if (duplicate) throw new EventException("Event subscription is already registered");
    this.#subscriptions.push(subscription);
  }

  unsubscribe(subscription: EventSubscription): void {
    const index = this.#subscriptions.indexOf(subscription);
    if (index < 0) throw new EventException("Event subscription is not registered");
    this.#subscriptions.splice(index, 1);
  }

  getSubscriptions(): readonly EventSubscription[] {
    return Object.freeze([...this.#subscriptions]);
  }
}
