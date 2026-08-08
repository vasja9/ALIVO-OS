import type { ModuleMetadata } from "./ModuleMetadata.ts";

/** Immutable identity and registration information for a module. */
export class ModuleDescriptor {
  readonly dependencies: readonly string[];
  readonly metadata: ModuleMetadata;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly version: string,
    readonly authorityLevel: string,
    dependencies: readonly string[],
    readonly description: string,
    metadata: ModuleMetadata = {},
  ) {
    this.dependencies = Object.freeze([...dependencies]);
    this.metadata = Object.freeze({ ...metadata });
    Object.freeze(this);
  }
}
