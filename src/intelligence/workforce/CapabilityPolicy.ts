import { AgentException } from "./AgentException.ts";
import { DiscoveryPolicy } from "./DiscoveryPolicy.ts";

export class CapabilityPolicy {
  readonly capabilityIdentifier: string;
  discoveryPolicy: DiscoveryPolicy;
  discoveryIntervalDays: number;

  constructor(capabilityIdentifier: string, discoveryPolicy = DiscoveryPolicy.ACTIVE, discoveryIntervalDays = 30) {
    if (capabilityIdentifier.trim() === "") throw new AgentException("Capability identifier is required");
    if (!Number.isInteger(discoveryIntervalDays) || discoveryIntervalDays < 1) throw new AgentException("Discovery interval must be a positive number of days");
    this.capabilityIdentifier = capabilityIdentifier;
    this.discoveryPolicy = discoveryPolicy;
    this.discoveryIntervalDays = discoveryIntervalDays;
  }
}
