import { IdentityId } from "./IdentityId.ts";
import { SecretException } from "./SecretException.ts";
import { SecretId } from "./SecretId.ts";
import { SecretState } from "./SecretState.ts";

export interface SecretMetadataProperties { readonly secretId: SecretId; readonly description: string; readonly ownerIdentity: IdentityId;
  readonly creationTimestamp: Date; readonly lastRotationTimestamp: Date; readonly expiryTimestamp?: Date; readonly state: SecretState; }

/** Immutable non-sensitive description of a secret. */
export class SecretMetadata {
  readonly secretId: SecretId; readonly description: string; readonly ownerIdentity: IdentityId; readonly state: SecretState;
  readonly #created: number; readonly #rotated: number; readonly #expires?: number;
  constructor(properties: SecretMetadataProperties) {
    if (!(properties?.secretId instanceof SecretId) || !(properties.ownerIdentity instanceof IdentityId) ||
      typeof properties.description !== "string" || !Object.values(SecretState).includes(properties.state)) throw new SecretException("Invalid secret metadata");
    if (!(properties.creationTimestamp instanceof Date) || !(properties.lastRotationTimestamp instanceof Date) ||
      (properties.expiryTimestamp !== undefined && !(properties.expiryTimestamp instanceof Date))) throw new SecretException("Invalid secret metadata timestamp");
    this.#created = properties.creationTimestamp.getTime(); this.#rotated = properties.lastRotationTimestamp.getTime();
    this.#expires = properties.expiryTimestamp?.getTime();
    if ([this.#created, this.#rotated, this.#expires].some((value) => value !== undefined && Number.isNaN(value))) throw new SecretException("Invalid secret metadata timestamp");
    this.secretId = properties.secretId; this.description = properties.description; this.ownerIdentity = properties.ownerIdentity; this.state = properties.state;
    Object.freeze(this);
  }
  get creationTimestamp(): Date { return new Date(this.#created); }
  get lastRotationTimestamp(): Date { return new Date(this.#rotated); }
  get expiryTimestamp(): Date | undefined { return this.#expires === undefined ? undefined : new Date(this.#expires); }
}
