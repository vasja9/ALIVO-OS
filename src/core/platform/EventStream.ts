import { EventCategory } from "./EventCategory.ts";
import { EventException } from "./EventException.ts";
import { EventSeverity } from "./EventSeverity.ts";
import { SystemEvent } from "./SystemEvent.ts";

export class EventStream {
  readonly #events: SystemEvent[] = [];
  append(event: SystemEvent): void {
    if (!(event instanceof SystemEvent)) throw new EventException("Cannot append an invalid system event");
    if (this.#events.some(recorded => recorded.id.equals(event.id))) throw new EventException(`Event is already present: ${event.id}`);
    const previous = this.#events.at(-1);
    if (previous !== undefined && event.timestamp.getTime() < previous.timestamp.getTime()) throw new EventException("Events must be appended in chronological order");
    this.#events.push(event);
  }
  getEvents(): readonly SystemEvent[] { return Object.freeze([...this.#events]); }
  filterByCategory(value: EventCategory): readonly SystemEvent[] { return this.#filter(e => e.category === value); }
  filterBySeverity(value: EventSeverity): readonly SystemEvent[] { return this.#filter(e => e.severity === value); }
  filterBySource(value: string): readonly SystemEvent[] { return this.#filter(e => e.source === value); }
  filterByCorrelationId(value: string): readonly SystemEvent[] { return this.#filter(e => e.correlationId === value); }
  filterByTask(value: string): readonly SystemEvent[] { return this.#filter(e => e.taskId === value); }
  filterByWorkflow(value: string): readonly SystemEvent[] { return this.#filter(e => e.workflowId === value); }
  filterByAgent(value: string): readonly SystemEvent[] { return this.#filter(e => e.agentId === value); }
  #filter(predicate: (event: SystemEvent) => boolean): readonly SystemEvent[] { return Object.freeze(this.#events.filter(predicate)); }
}
