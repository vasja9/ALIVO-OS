import { AuthorizationDecision } from "./AuthorizationDecision.ts";
import { AuthorizationRequest } from "./AuthorizationRequest.ts";

/** Read-only contract implemented by deterministic authorization policies. */
export interface AuthorizationPolicy {
  readonly identifier: string;
  readonly description: string;
  evaluate(request: AuthorizationRequest): AuthorizationDecision;
}
