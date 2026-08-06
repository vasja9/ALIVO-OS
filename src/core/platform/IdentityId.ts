import { AuthorizationException } from "./AuthorizationException.ts";

/** Provider-neutral, immutable identity identifier. */
export class IdentityId {
  readonly value: string;

  constructor(value: string) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new AuthorizationException("Invalid identity: identifier is required");
    }
    this.value = value;
    Object.freeze(this);
  }

  equals(other: IdentityId): boolean {
    return other instanceof IdentityId && this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
