import { KernelModule } from "../platform/KernelModule";

export { KernelModule } from "../platform/KernelModule";

export class ModuleRegistry {
  private readonly modules = new Map<string, KernelModule>();

  register(module: KernelModule): void {
    const moduleId = module.descriptor.id;
    if (this.modules.has(moduleId)) {
      throw new Error(`Module is already registered: ${moduleId}`);
    }

    this.modules.set(moduleId, module);
  }

  get(moduleId: string): KernelModule | undefined {
    return this.modules.get(moduleId);
  }

  registeredModules(): readonly KernelModule[] {
    return Array.from(this.modules.values());
  }
}
