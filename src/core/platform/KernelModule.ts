import { ModuleContext } from "./ModuleContext";
import { ModuleDescriptor } from "./ModuleDescriptor";
import { ModuleState } from "./ModuleState";

/** The lifecycle contract implemented by every ALIVO-OS module. */
export interface KernelModule {
  readonly descriptor: ModuleDescriptor;
  readonly context: ModuleContext;

  initialize(): void | Promise<void>;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  shutdown(): void | Promise<void>;
  health(): ModuleState | Promise<ModuleState>;
}
