import { AgentAssignment } from "./AgentAssignment.ts";
import { AgentComparison } from "./AgentComparison.ts";
import { AgentEvaluation } from "./AgentEvaluation.ts";
import { AgentException } from "./AgentException.ts";
import { AgentRegistry } from "./AgentRegistry.ts";
import { AgentStatus } from "./AgentStatus.ts";
import { AgentTrustLevel } from "./AgentTrustLevel.ts";
import { CapabilityRegistry } from "./CapabilityRegistry.ts";
import { DiscoveryPolicy } from "./DiscoveryPolicy.ts";
import { HealthMonitor } from "./HealthMonitor.ts";
import { RecoveryPolicy } from "./RecoveryPolicy.ts";

export class AgentWorkforceManager {
  readonly agents: AgentRegistry;
  readonly capabilities: CapabilityRegistry;
  readonly health: HealthMonitor;
  readonly #assignments: AgentAssignment[] = [];
  readonly #comparisons: AgentComparison[] = [];

  constructor(agents = new AgentRegistry(), capabilities = new CapabilityRegistry(), health = new HealthMonitor()) {
    this.agents = agents;
    this.capabilities = capabilities;
    this.health = health;
  }

  discoverCandidates(capabilityIdentifier: string, discoveredIdentifiers: readonly string[]): readonly string[] {
    const policy = this.capabilities.policy(capabilityIdentifier).discoveryPolicy;
    if (policy === DiscoveryPolicy.HOLD || policy === DiscoveryPolicy.CURRENT_ONLY) return Object.freeze([]);
    return Object.freeze([...discoveredIdentifiers]);
  }

  recommendAgent(capabilityIdentifier: string): string | undefined {
    this.capabilities.policy(capabilityIdentifier);
    const rank = [AgentTrustLevel.FullTrust, AgentTrustLevel.Trusted, AgentTrustLevel.TemporaryProduction, AgentTrustLevel.Approved];
    return this.agents.identifiers().filter((id) => rank.includes(this.agents.trust(id)) && this.agents.supports(id, capabilityIdentifier) && [AgentStatus.Available, AgentStatus.Recovered].includes(this.agents.status(id)))
      .sort((a, b) => rank.indexOf(this.agents.trust(a)) - rank.indexOf(this.agents.trust(b)))[0];
  }

  monitorHealth(agentIdentifier: string, observation: { availability: boolean; latency: number; providerStatus: boolean; maintenance: boolean; quota: number; failureRate: number }): AgentStatus {
    const status = this.health.observe(agentIdentifier, observation);
    this.agents.setStatus(agentIdentifier, status);
    return status;
  }

  shadowTest(trusted: AgentEvaluation, candidate: AgentEvaluation): AgentComparison {
    if (![AgentTrustLevel.Trusted, AgentTrustLevel.FullTrust].includes(this.agents.trust(trusted.agentIdentifier))) throw new AgentException("Shadow baseline must be a trusted agent");
    if (![AgentTrustLevel.Candidate, AgentTrustLevel.Trial, AgentTrustLevel.Approved].includes(this.agents.trust(candidate.agentIdentifier))) throw new AgentException("Shadow subject must be a candidate agent");
    const comparison = new AgentComparison(trusted, candidate);
    this.#comparisons.push(comparison);
    return comparison;
  }

  recordAssignment(assignment: AgentAssignment): void { this.#assignments.push(assignment); }
  assignmentHistory(): readonly AgentAssignment[] { return Object.freeze([...this.#assignments]); }
  comparisons(): readonly AgentComparison[] { return Object.freeze([...this.#comparisons]); }

  useTemporaryProduction(trustedIdentifier: string, temporaryIdentifier: string): void {
    if (![AgentTrustLevel.Trusted, AgentTrustLevel.FullTrust].includes(this.agents.trust(trustedIdentifier))) throw new AgentException("Failover source must be trusted");
    if (this.agents.status(trustedIdentifier) !== AgentStatus.Unavailable) throw new AgentException("Trusted agent is still available");
    this.agents.makeTemporaryProduction(temporaryIdentifier);
  }

  recover(trustedIdentifier: string, temporaryIdentifier: string, policy: RecoveryPolicy, notify: (recipient: "TCO" | "CEO", message: string) => void, approved = false): boolean {
    if (this.agents.status(trustedIdentifier) !== AgentStatus.Recovered && this.agents.status(trustedIdentifier) !== AgentStatus.Available) return false;
    notify("TCO", `Trusted agent recovered: ${trustedIdentifier}`);
    notify("CEO", `Trusted agent recovered: ${trustedIdentifier}`);
    if (policy === RecoveryPolicy.MANUAL && !approved) return false;
    this.agents.restoreTemporary(temporaryIdentifier);
    return true;
  }
}
