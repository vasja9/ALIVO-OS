import { SecretException } from "./SecretException.ts";

/** Provider-neutral immutable secret identifier. */
export class SecretId {
  readonly value: string;
  constructor(value: string) {
    if (typeof value !== "string" || value.trim().length === 0) throw new SecretException("Secret identifier is required");
    this.value = value;
    Object.freeze(this);
  }
  equals(other: SecretId): boolean { return other instanceof SecretId && this.value === other.value; }
  toString(): string { return this.value; }
}
