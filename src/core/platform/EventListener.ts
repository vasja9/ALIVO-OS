import { Event } from "./Event.ts";

/** Standard synchronous event-listener contract. */
export interface EventListener {
  handle(event: Event): void;
}
