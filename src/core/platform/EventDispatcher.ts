import { Event } from "./Event.ts";
import { EventException } from "./EventException.ts";
import { EventSubscription } from "./EventSubscription.ts";

/** Synchronously dispatches an event while isolating individual listener failures. */
export class EventDispatcher {
  dispatch(event: Event, subscriptions: readonly EventSubscription[]): readonly EventException[] {
    const failures: EventException[] = [];
    for (const subscription of subscriptions) {
      if (!subscription.accepts(event.type)) continue;
      try {
        subscription.listener.handle(event);
      } catch (cause) {
        failures.push(new EventException(
          `Event listener failed while handling event: ${event.id.value}`,
          { cause },
        ));
      }
    }
    return Object.freeze(failures);
  }
}
