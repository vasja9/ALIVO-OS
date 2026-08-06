import { PersistenceException } from "./PersistenceException.ts";

/** An immutable identifier with no storage or business format assumptions. */
export class EntityId {
  readonly #value: string;

  constructor(value: string) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new PersistenceException("Entity identifier must not be empty", "INVALID_IDENTIFIER");
    }
    this.#value = value;
    Object.freeze(this);
  }

  get value(): string { return this.#value; }
  equals(other: EntityId): boolean { return other instanceof EntityId && this.#value === other.#value; }
  toString(): string { return this.#value; }
}
