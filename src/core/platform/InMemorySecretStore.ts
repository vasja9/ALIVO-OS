import { AuditEvent } from "./AuditEvent.ts";
import { AuditEventType } from "./AuditEventType.ts";
import type { AuditRecorder } from "./AuditRecorder.ts";
import { AuthorizationDecisionValue } from "./AuthorizationDecision.ts";
import { AuthorizationRequest } from "./AuthorizationRequest.ts";
import type { AuthorizationService } from "./AuthorizationService.ts";
import { IdentityId } from "./IdentityId.ts";
import { Permission } from "./Permission.ts";
import { SecretAccessDecision, SecretAccessDecisionValue } from "./SecretAccessDecision.ts";
import { SecretAccessRequest } from "./SecretAccessRequest.ts";
import { SecretException } from "./SecretException.ts";
import { SecretId } from "./SecretId.ts";
import { SecretMetadata } from "./SecretMetadata.ts";
import type { SecretStore } from "./SecretStore.ts";
import { SecretState } from "./SecretState.ts";
import { SecretValue } from "./SecretValue.ts";

const retrievePermission = new Permission({ identifier: "secrets.retrieve", resourceCategory: "secret", action: "retrieve" });
interface StoredSecret { metadata: SecretMetadata; value: SecretValue }

/** Non-persistent validation implementation of the secrets contract. */
export class InMemorySecretStore implements SecretStore {
  readonly #secrets = new Map<string, StoredSecret>();
  constructor(private readonly authorizationService: AuthorizationService, private readonly auditRecorder: AuditRecorder) {}

  register(metadata: SecretMetadata, value: SecretValue): void {
    if (!(metadata instanceof SecretMetadata) || !(value instanceof SecretValue)) throw new SecretException("Invalid secret registration");
    if (this.#secrets.has(metadata.secretId.value)) throw new SecretException(`Secret is already registered: ${metadata.secretId}`);
    this.#secrets.set(metadata.secretId.value, { metadata, value });
    this.record("registration", "registered", metadata.ownerIdentity, metadata.secretId, metadata.creationTimestamp);
  }

  retrieve(request: SecretAccessRequest): SecretValue {
    if (!(request instanceof SecretAccessRequest)) throw new SecretException("Invalid secret access request");
    this.record("access attempt", "requested", request.requestingIdentity.id, request.secretId, request.timestamp, request.taskOrWorkflowId);
    const stored = this.#required(request.secretId);
    const now = request.timestamp;
    if (stored.metadata.state === SecretState.Revoked) return this.reject(request, "Secret is revoked", "denied access");
    if (stored.metadata.state === SecretState.Expired || (stored.metadata.expiryTimestamp !== undefined && stored.metadata.expiryTimestamp.getTime() <= now.getTime())) {
      if (stored.metadata.state !== SecretState.Expired) stored.metadata = this.copyMetadata(stored.metadata, SecretState.Expired);
      this.record("expiry rejection", "denied", request.requestingIdentity.id, request.secretId, now, request.taskOrWorkflowId);
      return this.reject(request, "Secret is expired", "denied access");
    }
    let authorized = false; let reason = "Authorization did not explicitly allow secret retrieval";
    try {
      const decision = this.authorizationService.evaluate(new AuthorizationRequest({ identity: request.requestingIdentity, permission: retrievePermission,
        protectedResourceId: request.secretId.value, taskOrWorkflowId: request.taskOrWorkflowId, context: { purpose: request.purpose } }));
      authorized = decision.decision === AuthorizationDecisionValue.Allowed; reason = decision.reason;
    } catch { reason = "Authorization evaluation rejected the request"; }
    if (!authorized) return this.reject(request, reason, "denied access");
    const accessDecision = new SecretAccessDecision({ decision: SecretAccessDecisionValue.Allowed, reason, requestingIdentity: request.requestingIdentity.id,
      secretId: request.secretId, timestamp: now });
    this.record("successful access", accessDecision.decision, accessDecision.requestingIdentity, accessDecision.secretId, accessDecision.timestamp, request.taskOrWorkflowId);
    return stored.value;
  }

  rotate(secretId: SecretId, value: SecretValue, identity: IdentityId, timestamp = new Date()): void {
    if (!(value instanceof SecretValue) || !(identity instanceof IdentityId) || Number.isNaN(timestamp.getTime())) throw new SecretException("Invalid secret rotation");
    const stored = this.#required(secretId);
    stored.value = value;
    stored.metadata = new SecretMetadata({ secretId: stored.metadata.secretId, description: stored.metadata.description, ownerIdentity: stored.metadata.ownerIdentity,
      creationTimestamp: stored.metadata.creationTimestamp, lastRotationTimestamp: timestamp, expiryTimestamp: stored.metadata.expiryTimestamp, state: stored.metadata.state });
    this.record("rotation", "rotated", identity, secretId, timestamp);
  }
  revoke(secretId: SecretId, identity: IdentityId, timestamp = new Date()): void {
    if (!(identity instanceof IdentityId) || Number.isNaN(timestamp.getTime())) throw new SecretException("Invalid secret revocation");
    const stored = this.#required(secretId); stored.metadata = this.copyMetadata(stored.metadata, SecretState.Revoked);
    this.record("revocation", "revoked", identity, secretId, timestamp);
  }
  getMetadata(secretId: SecretId): SecretMetadata { return this.#required(secretId).metadata; }
  exists(secretId: SecretId): boolean { return secretId instanceof SecretId && this.#secrets.has(secretId.value); }
  listMetadata(): readonly SecretMetadata[] { return Object.freeze([...this.#secrets.values()].map(({ metadata }) => metadata)); }

  #required(secretId: SecretId): StoredSecret {
    if (!(secretId instanceof SecretId)) throw new SecretException("Invalid secret identifier");
    const stored = this.#secrets.get(secretId.value); if (!stored) throw new SecretException(`Secret is not registered: ${secretId}`); return stored;
  }
  private reject(request: SecretAccessRequest, reason: string, action: string): never {
    const decision = new SecretAccessDecision({ decision: SecretAccessDecisionValue.Denied, reason, requestingIdentity: request.requestingIdentity.id,
      secretId: request.secretId, timestamp: request.timestamp });
    this.record(action, decision.decision, decision.requestingIdentity, decision.secretId, decision.timestamp, request.taskOrWorkflowId);
    throw new SecretException(reason);
  }
  private copyMetadata(metadata: SecretMetadata, state: SecretState): SecretMetadata {
    return new SecretMetadata({ secretId: metadata.secretId, description: metadata.description, ownerIdentity: metadata.ownerIdentity,
      creationTimestamp: metadata.creationTimestamp, lastRotationTimestamp: metadata.lastRotationTimestamp, expiryTimestamp: metadata.expiryTimestamp, state });
  }
  private record(action: string, result: string, identity: IdentityId, secretId: SecretId, timestamp: Date, taskOrWorkflowId?: string): void {
    this.auditRecorder.append(new AuditEvent({ timestamp, type: AuditEventType.SecurityEvent, source: "InMemorySecretStore", action, result,
      responsibleIdentity: identity.value, relatedTaskOrWorkflowId: taskOrWorkflowId, context: { secretId: secretId.value, decision: result } }));
  }
}
