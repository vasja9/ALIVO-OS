import { SystemEvent } from "./SystemEvent.ts";

/** Standard synchronous event-listener contract. */
export interface EventListener {
  handle(event: SystemEvent): void;
}
