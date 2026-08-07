import { IdentityId } from "./IdentityId.ts";
import { SecretException } from "./SecretException.ts";
import { SecretId } from "./SecretId.ts";

export enum SecretAccessDecisionValue { Allowed = "Allowed", Denied = "Denied" }
export class SecretAccessDecision {
  readonly decision: SecretAccessDecisionValue; readonly reason: string; readonly requestingIdentity: IdentityId; readonly secretId: SecretId; readonly #timestamp: number;
  constructor(properties: { decision: SecretAccessDecisionValue; reason: string; requestingIdentity: IdentityId; secretId: SecretId; timestamp?: Date }) {
    if (!Object.values(SecretAccessDecisionValue).includes(properties?.decision) || typeof properties.reason !== "string" || properties.reason.trim().length === 0 ||
      !(properties.requestingIdentity instanceof IdentityId) || !(properties.secretId instanceof SecretId)) throw new SecretException("Invalid secret access decision");
    this.#timestamp = properties.timestamp?.getTime() ?? Date.now(); if (Number.isNaN(this.#timestamp)) throw new SecretException("Invalid secret access decision timestamp");
    this.decision = properties.decision; this.reason = properties.reason; this.requestingIdentity = properties.requestingIdentity; this.secretId = properties.secretId; Object.freeze(this);
  }
  get timestamp(): Date { return new Date(this.#timestamp); }
}
