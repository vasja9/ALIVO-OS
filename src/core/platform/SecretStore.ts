import type { IdentityId } from "./IdentityId.ts";
import type { SecretAccessRequest } from "./SecretAccessRequest.ts";
import type { SecretId } from "./SecretId.ts";
import type { SecretMetadata } from "./SecretMetadata.ts";
import type { SecretValue } from "./SecretValue.ts";

export interface SecretStore {
  register(metadata: SecretMetadata, value: SecretValue): void;
  retrieve(request: SecretAccessRequest): SecretValue;
  rotate(secretId: SecretId, value: SecretValue, identity: IdentityId, timestamp?: Date): void;
  revoke(secretId: SecretId, identity: IdentityId, timestamp?: Date): void;
  getMetadata(secretId: SecretId): SecretMetadata;
  exists(secretId: SecretId): boolean;
  listMetadata(): readonly SecretMetadata[];
}
