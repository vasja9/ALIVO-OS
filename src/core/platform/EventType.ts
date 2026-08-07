import { EventException } from "./EventException.ts";

/** Immutable event classification without a business-specific catalogue. */
export class EventType {
  readonly value: string;

  constructor(value: string) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new EventException("Event type is required");
    }
    this.value = value;
    Object.freeze(this);
  }

  equals(other: EventType): boolean {
    return other instanceof EventType && this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
