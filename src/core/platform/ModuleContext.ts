/** The narrow service boundary through which modules access kernel services. */
export interface ModuleContext {
  getService<T>(serviceId: string): T | undefined;
  requireService<T>(serviceId: string): T;
}
