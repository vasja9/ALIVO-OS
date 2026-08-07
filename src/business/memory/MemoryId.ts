import { MemoryException } from "./MemoryException.ts";

export class MemoryId {
  readonly #value: string;
  constructor(value: string) {
    if (typeof value !== "string" || value.trim().length === 0) throw new MemoryException("Memory identifier is required", "INVALID_MEMORY_ID");
    this.#value = value;
    Object.freeze(this);
  }
  get value(): string { return this.#value; }
  equals(other: MemoryId): boolean { return other instanceof MemoryId && other.#value === this.#value; }
  toString(): string { return this.#value; }
}
