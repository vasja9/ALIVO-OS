import type { KernelModule } from "../../core/platform/KernelModule.ts";
import type { ModuleContext } from "../../core/platform/ModuleContext.ts";
import { ModuleDescriptor } from "../../core/platform/ModuleDescriptor.ts";
import { ModuleState } from "../../core/platform/ModuleState.ts";
import { InMemoryMarketIntelligenceService } from "./MarketIntelligenceService.ts";

export const MARKET_INTELLIGENCE_SERVICE = "bos.market-intelligence";

interface RegistrationContext extends ModuleContext {
  registerService<T>(serviceId: string, service: T): void;
}

export class MarketIntelligenceModule implements KernelModule {
  readonly descriptor = new ModuleDescriptor(
    "market-intelligence",
    "Market Intelligence Core",
    "1.0.0",
    "advisory",
    [],
    "Immutable market observations, evidence, provenance, and source registration",
  );
  #state = ModuleState.Registered;

  constructor(
    readonly context: RegistrationContext,
    private readonly service = new InMemoryMarketIntelligenceService(),
  ) {}

  initialize(): void {
    if (this.#state !== ModuleState.Registered) throw new Error("Market Intelligence module cannot be initialized from its current state");
    this.context.registerService(MARKET_INTELLIGENCE_SERVICE, this.service);
    this.#state = ModuleState.Initialized;
  }
  start(): void {
    if (this.#state !== ModuleState.Initialized) throw new Error("Market Intelligence module must be initialized before start");
    this.#state = ModuleState.Running;
  }
  stop(): void {
    if (this.#state !== ModuleState.Running) throw new Error("Market Intelligence module must be running before stop");
    this.#state = ModuleState.Stopped;
  }
  shutdown(): void {
    if (this.#state !== ModuleState.Stopped) throw new Error("Market Intelligence module must be stopped before shutdown");
  }
  health(): ModuleState { return this.#state; }
}
