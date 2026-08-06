/** Informational, non-runtime data associated with a module. */
export interface ModuleMetadata {
  readonly [key: string]: string | number | boolean | undefined;
}
