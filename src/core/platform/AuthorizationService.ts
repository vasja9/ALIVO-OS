import { AuditEvent } from "./AuditEvent.ts";
import { AuditEventType } from "./AuditEventType.ts";
import type { AuditRecorder } from "./AuditRecorder.ts";
import { AuthorizationDecision, AuthorizationDecisionValue } from "./AuthorizationDecision.ts";
import { AuthorizationException } from "./AuthorizationException.ts";
import type { AuthorizationPolicy } from "./AuthorizationPolicy.ts";
import { AuthorizationRequest } from "./AuthorizationRequest.ts";
import { SystemIdentity } from "./SystemIdentity.ts";

/** Ordered, deny-by-default authorization policy coordinator. */
export class AuthorizationService {
  readonly #policies: AuthorizationPolicy[] = [];
  constructor(private readonly auditRecorder?: AuditRecorder) {}

  registerPolicy(policy: AuthorizationPolicy): void {
    if (policy === null || typeof policy !== "object" || typeof policy.identifier !== "string" || policy.identifier.trim().length === 0 ||
        typeof policy.description !== "string" || typeof policy.evaluate !== "function") throw new AuthorizationException("Invalid authorization policy");
    if (this.#policies.some(({ identifier }) => identifier === policy.identifier)) throw new AuthorizationException(`Duplicate authorization policy: ${policy.identifier}`);
    this.#policies.push(policy);
  }
  getPolicyIdentifiers(): readonly string[] { return Object.freeze(this.#policies.map(({ identifier }) => identifier)); }
  disableIdentity(identity: SystemIdentity): SystemIdentity { return this.replaceIdentityState(identity, false); }
  enableIdentity(identity: SystemIdentity): SystemIdentity { return this.replaceIdentityState(identity, true); }

  evaluate(request: AuthorizationRequest): AuthorizationDecision {
    if (!(request instanceof AuthorizationRequest)) throw new AuthorizationException("Invalid authorization request");
    if (!request.identity.enabled) throw new AuthorizationException(`Disabled identity: ${request.identity.id}`);
    let finalDecision: AuthorizationDecision | undefined;
    try {
      for (const policy of this.#policies) {
        const decision = policy.evaluate(request);
        if (!(decision instanceof AuthorizationDecision)) throw new AuthorizationException(`Authorization evaluation failure in policy: ${policy.identifier}`);
        finalDecision ??= decision;
        if (decision.decision === AuthorizationDecisionValue.Allowed) { finalDecision = decision; break; }
      }
    } catch (error) {
      if (error instanceof AuthorizationException) throw error;
      throw new AuthorizationException("Authorization evaluation failure", { cause: error });
    }
    finalDecision ??= new AuthorizationDecision({ decision: AuthorizationDecisionValue.Denied, reason: "No registered policy explicitly allowed the requested permission",
      identity: request.identity.id, permission: request.permission });
    this.record(request, finalDecision);
    return finalDecision;
  }

  private replaceIdentityState(identity: SystemIdentity, enabled: boolean): SystemIdentity {
    if (!(identity instanceof SystemIdentity)) throw new AuthorizationException("Invalid identity");
    return identity.withEnabled(enabled);
  }
  private record(request: AuthorizationRequest, decision: AuthorizationDecision): void {
    this.auditRecorder?.append(new AuditEvent({ type: AuditEventType.SecurityEvent, source: "AuthorizationService",
      action: `${request.permission.identifier}:${request.protectedResourceId}`, result: `${decision.decision}: ${decision.reason}`,
      responsibleIdentity: request.identity.id.value, relatedTaskOrWorkflowId: request.taskOrWorkflowId,
      context: { permission: request.permission.identifier, protectedResource: request.protectedResourceId, decision: decision.decision, reason: decision.reason } }));
  }
}
