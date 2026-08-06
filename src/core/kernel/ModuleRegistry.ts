export interface KernelModule {
  readonly id: string;
  initialize(): void | Promise<void>;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
}

export class ModuleRegistry {
  private readonly modules = new Map<string, KernelModule>();

  register(module: KernelModule): void {
    if (this.modules.has(module.id)) {
      throw new Error(`Module is already registered: ${module.id}`);
    }

    this.modules.set(module.id, module);
  }

  get(moduleId: string): KernelModule | undefined {
    return this.modules.get(moduleId);
  }

  registeredModules(): readonly KernelModule[] {
    return Array.from(this.modules.values());
  }
}
