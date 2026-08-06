import { AuthorizationException } from "./AuthorizationException.ts";

export interface PermissionProperties {
  readonly identifier: string;
  readonly resourceCategory: string;
  readonly action: string;
  readonly scope?: string;
}

/** One explicit, immutable permitted action. */
export class Permission {
  readonly identifier: string;
  readonly resourceCategory: string;
  readonly action: string;
  readonly scope?: string;

  constructor(properties: PermissionProperties) {
    if (properties === null || typeof properties !== "object") throw new AuthorizationException("Invalid permission");
    for (const [label, value] of Object.entries({ identifier: properties.identifier, resourceCategory: properties.resourceCategory, action: properties.action })) {
      if (typeof value !== "string" || value.trim().length === 0) throw new AuthorizationException(`Invalid permission: ${label} is required`);
      if (value.trim() === "*") throw new AuthorizationException("Invalid permission: unrestricted wildcard is not permitted");
    }
    if (properties.scope !== undefined && (typeof properties.scope !== "string" || properties.scope.trim().length === 0 || properties.scope.trim() === "*")) {
      throw new AuthorizationException("Invalid permission: scope must be explicit");
    }
    this.identifier = properties.identifier;
    this.resourceCategory = properties.resourceCategory;
    this.action = properties.action;
    this.scope = properties.scope;
    Object.freeze(this);
  }

  equals(other: Permission): boolean {
    return other instanceof Permission && this.identifier === other.identifier && this.resourceCategory === other.resourceCategory &&
      this.action === other.action && this.scope === other.scope;
  }
}
