import { EventCategory } from "./EventCategory.ts";
import { EventContext } from "./EventContext.ts";
import { EventException } from "./EventException.ts";
import { EventId } from "./EventId.ts";
import { EventSeverity } from "./EventSeverity.ts";

export interface SystemEventProperties {
  readonly id: EventId;
  readonly category: EventCategory;
  readonly severity: EventSeverity;
  readonly timestamp: Date;
  readonly source: string;
  readonly name: string;
  readonly correlationId: string;
  readonly taskId?: string;
  readonly workflowId?: string;
  readonly agentId?: string;
  readonly context?: EventContext;
}

/** An immutable operational fact. It contains no commands or orchestration behavior. */
export class SystemEvent {
  readonly #timestampMs: number;
  readonly id: EventId;
  readonly category: EventCategory;
  readonly severity: EventSeverity;
  readonly source: string;
  readonly name: string;
  readonly correlationId: string;
  readonly taskId?: string;
  readonly workflowId?: string;
  readonly agentId?: string;
  readonly context?: EventContext;

  constructor(properties: SystemEventProperties) {
    if (properties === null || typeof properties !== "object") throw new EventException("Invalid system event");
    if (!(properties.id instanceof EventId)) throw new EventException("Event identifier is required");
    if (!Object.values(EventCategory).includes(properties.category)) throw new EventException("Event category is invalid");
    if (!Object.values(EventSeverity).includes(properties.severity)) throw new EventException("Event severity is invalid");
    if (!(properties.timestamp instanceof Date) || Number.isNaN(properties.timestamp.getTime())) throw new EventException("Event timestamp is invalid");
    for (const [label, value] of [["source", properties.source], ["name", properties.name], ["correlation identifier", properties.correlationId]] as const) {
      if (typeof value !== "string" || value.trim().length === 0) throw new EventException(`Event ${label} is required`);
    }
    for (const value of [properties.taskId, properties.workflowId, properties.agentId]) {
      if (value !== undefined && (typeof value !== "string" || value.trim().length === 0)) throw new EventException("Optional event identifiers must not be empty");
    }
    if (properties.context !== undefined && !(properties.context instanceof EventContext)) throw new EventException("Event context is invalid");
    this.id = properties.id; this.category = properties.category; this.severity = properties.severity;
    this.#timestampMs = properties.timestamp.getTime(); this.source = properties.source; this.name = properties.name;
    this.correlationId = properties.correlationId; this.taskId = properties.taskId; this.workflowId = properties.workflowId;
    this.agentId = properties.agentId; this.context = properties.context;
    if (new.target === SystemEvent) Object.freeze(this);
  }

  get timestamp(): Date { return new Date(this.#timestampMs); }
}
