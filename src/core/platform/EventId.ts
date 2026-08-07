import { EventException } from "./EventException.ts";

/** Immutable, technology-independent event identifier. */
export class EventId {
  readonly value: string;

  constructor(value: string) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new EventException("Event identifier is required");
    }
    this.value = value;
    Object.freeze(this);
  }

  equals(other: EventId): boolean {
    return other instanceof EventId && this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
