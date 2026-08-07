import { SecretException } from "./SecretException.ts";

/** Sensitive immutable material, redacted except through explicit access. */
export class SecretValue {
  readonly #value: string;
  constructor(value: string) {
    if (typeof value !== "string" || value.length === 0) throw new SecretException("Secret value is required");
    this.#value = value;
    Object.freeze(this);
  }
  access(): string { return this.#value; }
  toString(): string { return "[REDACTED]"; }
  toJSON(): string { return "[REDACTED]"; }
}
