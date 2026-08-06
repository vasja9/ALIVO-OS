import { KernelLifecycle } from "./KernelLifecycle";
import { KernelModule, ModuleRegistry } from "./ModuleRegistry";
import { ServiceRegistry } from "./ServiceRegistry";
import { KernelState } from "./KernelState";

export class Kernel {
  private readonly lifecycle = new KernelLifecycle();
  private readonly modules = new ModuleRegistry();
  private readonly services = new ServiceRegistry();

  get state(): KernelState {
    return this.lifecycle.state;
  }

  registerModule(module: KernelModule): void {
    if (this.state !== KernelState.Created) {
      throw new Error("Modules can only be registered before the kernel starts");
    }

    this.modules.register(module);
  }

  registerService<T>(serviceId: string, service: T): void {
    if (
      this.state !== KernelState.Created &&
      this.state !== KernelState.Initializing
    ) {
      throw new Error("Services can only be registered before the kernel is running");
    }

    this.services.register(serviceId, service);
  }

  getService<T>(serviceId: string): T | undefined {
    return this.services.get<T>(serviceId);
  }

  requireService<T>(serviceId: string): T {
    return this.services.require<T>(serviceId);
  }

  async start(): Promise<void> {
    this.lifecycle.transitionTo(KernelState.Initializing);

    try {
      const modules = this.modules.registeredModules();
      for (const module of modules) {
        await module.initialize();
      }
      for (const module of modules) {
        await module.start();
      }
      this.lifecycle.transitionTo(KernelState.Running);
    } catch (error) {
      this.lifecycle.fail();
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.lifecycle.transitionTo(KernelState.Stopping);

    try {
      const modules = [...this.modules.registeredModules()].reverse();
      for (const module of modules) {
        await module.stop();
      }
      this.lifecycle.transitionTo(KernelState.Stopped);
    } catch (error) {
      this.lifecycle.fail();
      throw error;
    }
  }
}
