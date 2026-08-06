import { AuthorizationException } from "./AuthorizationException.ts";
import { protectStructuredContext, type StructuredContext } from "./LogEntry.ts";
import { Permission } from "./Permission.ts";
import { SystemIdentity } from "./SystemIdentity.ts";

export interface AuthorizationRequestProperties {
  readonly identity: SystemIdentity;
  readonly permission: Permission;
  readonly protectedResourceId: string;
  readonly taskOrWorkflowId?: string;
  readonly context?: StructuredContext;
}

/** Immutable and attributable authorization evaluation input. */
export class AuthorizationRequest {
  readonly identity: SystemIdentity;
  readonly permission: Permission;
  readonly protectedResourceId: string;
  readonly taskOrWorkflowId?: string;
  readonly context?: StructuredContext;

  constructor(properties: AuthorizationRequestProperties) {
    if (!(properties?.identity instanceof SystemIdentity) || !(properties.permission instanceof Permission) ||
        typeof properties.protectedResourceId !== "string" || properties.protectedResourceId.trim().length === 0) {
      throw new AuthorizationException("Invalid authorization request");
    }
    if (properties.taskOrWorkflowId !== undefined && (typeof properties.taskOrWorkflowId !== "string" || properties.taskOrWorkflowId.trim().length === 0)) {
      throw new AuthorizationException("Invalid authorization request task or workflow identifier");
    }
    this.identity = properties.identity;
    this.permission = properties.permission;
    this.protectedResourceId = properties.protectedResourceId;
    this.taskOrWorkflowId = properties.taskOrWorkflowId;
    try { this.context = protectStructuredContext(properties.context); } catch (error) {
      throw new AuthorizationException("Invalid authorization request context", { cause: error });
    }
    Object.freeze(this);
  }
}
