import { AuthorizationException } from "./AuthorizationException.ts";
import { IdentityId } from "./IdentityId.ts";
import { IdentityType } from "./IdentityType.ts";
import { Permission } from "./Permission.ts";

export interface SystemIdentityProperties {
  readonly id: IdentityId;
  readonly type: IdentityType;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly permissions?: readonly Permission[];
  readonly description?: string;
}

/** Immutable description of an actor known to the system. */
export class SystemIdentity {
  readonly id: IdentityId;
  readonly type: IdentityType;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly permissions: readonly Permission[];
  readonly description?: string;

  constructor(properties: SystemIdentityProperties) {
    if (!(properties?.id instanceof IdentityId) || !Object.values(IdentityType).includes(properties.type) ||
        typeof properties.displayName !== "string" || properties.displayName.trim().length === 0 || typeof properties.enabled !== "boolean") {
      throw new AuthorizationException("Invalid identity");
    }
    if (properties.description !== undefined && typeof properties.description !== "string") throw new AuthorizationException("Invalid identity description");
    if (properties.permissions?.some((permission) => !(permission instanceof Permission))) throw new AuthorizationException("Invalid identity permission");
    this.id = properties.id;
    this.type = properties.type;
    this.displayName = properties.displayName;
    this.enabled = properties.enabled;
    this.permissions = Object.freeze([...(properties.permissions ?? [])]);
    this.description = properties.description;
    Object.freeze(this);
  }

  hasPermission(permission: Permission): boolean {
    return this.permissions.some((assigned) => assigned.equals(permission));
  }

  withEnabled(enabled: boolean): SystemIdentity {
    return new SystemIdentity({ id: this.id, type: this.type, displayName: this.displayName, enabled, permissions: this.permissions, description: this.description });
  }
}
