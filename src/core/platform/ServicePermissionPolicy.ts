import { AuthorizationDecision, AuthorizationDecisionValue } from "./AuthorizationDecision.ts";
import type { AuthorizationPolicy } from "./AuthorizationPolicy.ts";
import { AuthorizationRequest } from "./AuthorizationRequest.ts";
import { IdentityType } from "./IdentityType.ts";

export class ServicePermissionPolicy implements AuthorizationPolicy {
  readonly identifier = "foundation.service-permission";
  readonly description = "Allows non-CEO system actors only explicitly assigned permissions.";
  evaluate(request: AuthorizationRequest): AuthorizationDecision {
    const supported = request.identity.type !== IdentityType.CEO;
    const outputIdentityId = request.context?.outputIdentityId;
    const selfApproval = request.permission.action.toLowerCase() === "approve" && outputIdentityId === request.identity.id.value;
    const allowed = supported && !selfApproval && request.identity.hasPermission(request.permission);
    const reason = selfApproval ? "An identity may not approve its own output" : allowed ?
      "Requested permission is explicitly assigned to the service identity" : "Policy does not explicitly allow this identity and permission";
    return new AuthorizationDecision({ decision: allowed ? AuthorizationDecisionValue.Allowed : AuthorizationDecisionValue.Denied,
      reason, identity: request.identity.id, permission: request.permission, policyIdentifier: this.identifier });
  }
}
