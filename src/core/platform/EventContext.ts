import { EventException } from "./EventException.ts";

export type EventContextValue =
  | string
  | number
  | boolean
  | null
  | readonly EventContextValue[]
  | { readonly [key: string]: EventContextValue };

const SENSITIVE_KEY = /(?:authorization|credential|password|secret|token|api[-_]?key|private[-_]?key|sensitive|restricted[-_]?payload)/i;

function protect(value: EventContextValue, key?: string): EventContextValue {
  if (key !== undefined && SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return Object.freeze(value.map((item) => protect(item)));
  if (value !== null && typeof value === "object") {
    const copy: Record<string, EventContextValue> = {};
    for (const [childKey, child] of Object.entries(value)) copy[childKey] = protect(child, childKey);
    return Object.freeze(copy);
  }
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))) return value;
  throw new EventException("Event context contains an invalid value");
}

/** Immutable structured metadata attached to an event. */
export class EventContext {
  readonly values: Readonly<Record<string, EventContextValue>>;

  constructor(values: Readonly<Record<string, EventContextValue>>) {
    if (values === null || typeof values !== "object" || Array.isArray(values)) {
      throw new EventException("Event context must be a structured object");
    }
    this.values = protect(values) as Readonly<Record<string, EventContextValue>>;
    Object.freeze(this);
  }

  toJSON(): Readonly<Record<string, EventContextValue>> {
    return this.values;
  }
}
