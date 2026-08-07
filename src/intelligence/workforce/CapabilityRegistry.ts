import { AgentCapability } from "./AgentCapability.ts";
import { AgentException } from "./AgentException.ts";
import { CapabilityPolicy } from "./CapabilityPolicy.ts";

export class CapabilityRegistry {
  readonly #capabilities = new Map<string, AgentCapability>();
  readonly #policies = new Map<string, CapabilityPolicy>();

  register(capability: AgentCapability, policy = new CapabilityPolicy(capability.identifier)): void {
    if (policy.capabilityIdentifier !== capability.identifier) throw new AgentException("Capability policy does not match capability");
    if (this.#capabilities.has(capability.identifier)) throw new AgentException(`Capability is already registered: ${capability.identifier}`);
    this.#capabilities.set(capability.identifier, capability);
    this.#policies.set(capability.identifier, policy);
  }

  get(identifier: string): AgentCapability | undefined { return this.#capabilities.get(identifier); }
  policy(identifier: string): CapabilityPolicy {
    const policy = this.#policies.get(identifier);
    if (!policy) throw new AgentException(`Capability is not registered: ${identifier}`);
    return policy;
  }
  all(): readonly AgentCapability[] { return Object.freeze([...this.#capabilities.values()]); }
}
