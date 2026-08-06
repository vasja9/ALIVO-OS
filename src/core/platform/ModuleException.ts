/** Base exception for failures originating in a module. */
export class ModuleException extends Error {
  constructor(
    message: string,
    readonly moduleId: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ModuleException";
  }
}
