import { PersistenceException } from "./PersistenceException.ts";

/** Opaque, immutable record-version information used for optimistic concurrency. */
export class VersionToken {
  readonly #value: string;

  constructor(value: string) {
    if (typeof value !== "string" || value.length === 0) {
      throw new PersistenceException("Version token must not be empty", "OPERATION_FAILED");
    }
    this.#value = value;
    Object.freeze(this);
  }

  get value(): string { return this.#value; }
  equals(other: VersionToken): boolean { return other instanceof VersionToken && this.#value === other.#value; }
  toString(): string { return this.#value; }
}
