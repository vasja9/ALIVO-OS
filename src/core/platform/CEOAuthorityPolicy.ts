import { AuthorizationDecision, AuthorizationDecisionValue } from "./AuthorizationDecision.ts";
import type { AuthorizationPolicy } from "./AuthorizationPolicy.ts";
import { AuthorizationRequest } from "./AuthorizationRequest.ts";
import { IdentityType } from "./IdentityType.ts";

export class CEOAuthorityPolicy implements AuthorizationPolicy {
  readonly identifier = "foundation.ceo-authority";
  readonly description = "Allows a CEO identity only its explicitly assigned permissions.";
  evaluate(request: AuthorizationRequest): AuthorizationDecision {
    const allowed = request.identity.type === IdentityType.CEO && request.identity.hasPermission(request.permission);
    return new AuthorizationDecision({ decision: allowed ? AuthorizationDecisionValue.Allowed : AuthorizationDecisionValue.Denied,
      reason: allowed ? "Requested permission is explicitly assigned to the CEO identity" : "Policy does not explicitly allow this identity and permission",
      identity: request.identity.id, permission: request.permission, policyIdentifier: this.identifier });
  }
}
