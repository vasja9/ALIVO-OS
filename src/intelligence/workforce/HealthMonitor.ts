import { AgentException } from "./AgentException.ts";
import { AgentStatus } from "./AgentStatus.ts";

export class HealthMonitor {
  readonly #health = new Map<string, { availability: boolean; latency: number; providerStatus: boolean; maintenance: boolean; quota: number; failureRate: number; status: AgentStatus }>();

  observe(agentIdentifier: string, health: { availability: boolean; latency: number; providerStatus: boolean; maintenance: boolean; quota: number; failureRate: number }): AgentStatus {
    if (agentIdentifier.trim() === "" || health.latency < 0 || health.quota < 0 || health.failureRate < 0 || health.failureRate > 1) throw new AgentException("Health observation is invalid");
    const previous = this.#health.get(agentIdentifier)?.status;
    let status: AgentStatus;
    if (health.maintenance) status = AgentStatus.Maintenance;
    else if (!health.availability || !health.providerStatus || health.quota === 0) status = AgentStatus.Unavailable;
    else if (health.failureRate > 0.1) status = AgentStatus.Degraded;
    else if (previous === AgentStatus.Unavailable || previous === AgentStatus.Degraded || previous === AgentStatus.Maintenance) status = AgentStatus.Recovered;
    else status = AgentStatus.Available;
    this.#health.set(agentIdentifier, { ...health, status });
    return status;
  }

  status(agentIdentifier: string): AgentStatus {
    const health = this.#health.get(agentIdentifier);
    if (!health) throw new AgentException(`Agent has no health observation: ${agentIdentifier}`);
    return health.status;
  }
}
