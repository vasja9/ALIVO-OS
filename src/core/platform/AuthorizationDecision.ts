import { AuthorizationException } from "./AuthorizationException.ts";
import { IdentityId } from "./IdentityId.ts";
import { Permission } from "./Permission.ts";

export enum AuthorizationDecisionValue { Allowed = "Allowed", Denied = "Denied" }

export interface AuthorizationDecisionProperties {
  readonly decision: AuthorizationDecisionValue;
  readonly reason: string;
  readonly identity: IdentityId;
  readonly permission: Permission;
  readonly timestamp?: Date;
  readonly policyIdentifier?: string;
}

/** Explained, immutable result of one authorization evaluation. */
export class AuthorizationDecision {
  readonly #timestampMs: number;
  readonly decision: AuthorizationDecisionValue;
  readonly reason: string;
  readonly identity: IdentityId;
  readonly permission: Permission;
  readonly policyIdentifier?: string;

  constructor(properties: AuthorizationDecisionProperties) {
    if (!Object.values(AuthorizationDecisionValue).includes(properties?.decision) || typeof properties.reason !== "string" ||
        properties.reason.trim().length === 0 || !(properties.identity instanceof IdentityId) || !(properties.permission instanceof Permission)) {
      throw new AuthorizationException("Invalid authorization decision");
    }
    this.#timestampMs = properties.timestamp?.getTime() ?? Date.now();
    if (Number.isNaN(this.#timestampMs)) throw new AuthorizationException("Invalid authorization decision timestamp");
    this.decision = properties.decision;
    this.reason = properties.reason;
    this.identity = properties.identity;
    this.permission = properties.permission;
    this.policyIdentifier = properties.policyIdentifier;
    Object.freeze(this);
  }
  get timestamp(): Date { return new Date(this.#timestampMs); }
}
