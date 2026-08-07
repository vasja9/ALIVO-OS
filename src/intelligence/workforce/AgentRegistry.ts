import { AgentException } from "./AgentException.ts";
import { AgentStatus } from "./AgentStatus.ts";
import { AgentTrustLevel } from "./AgentTrustLevel.ts";

export class AgentRegistry {
  readonly #agents = new Map<string, { capabilities: Set<string>; trust: AgentTrustLevel; status: AgentStatus; previousTrust?: AgentTrustLevel }>();

  register(identifier: string, capabilities: readonly string[], trust = AgentTrustLevel.Discovered): void {
    if (identifier.trim() === "" || capabilities.length === 0 || capabilities.some((value) => value.trim() === "")) throw new AgentException("Agent identifier and capabilities are required");
    if (this.#agents.has(identifier)) throw new AgentException(`Agent is already registered: ${identifier}`);
    this.#agents.set(identifier, { capabilities: new Set(capabilities), trust, status: AgentStatus.Available });
  }

  trust(identifier: string): AgentTrustLevel { return this.require(identifier).trust; }
  status(identifier: string): AgentStatus { return this.require(identifier).status; }
  setStatus(identifier: string, status: AgentStatus): void { this.require(identifier).status = status; }
  supports(identifier: string, capability: string): boolean { return this.require(identifier).capabilities.has(capability); }
  identifiers(): readonly string[] { return Object.freeze([...this.#agents.keys()]); }

  transition(identifier: string, target: AgentTrustLevel, ceoApproved = false): void {
    const agent = this.require(identifier);
    const path = [AgentTrustLevel.Discovered, AgentTrustLevel.Candidate, AgentTrustLevel.Trial, AgentTrustLevel.Approved, AgentTrustLevel.Trusted, AgentTrustLevel.FullTrust];
    const normal = path.indexOf(target) === path.indexOf(agent.trust) + 1;
    const exceptional = target === AgentTrustLevel.Suspended || target === AgentTrustLevel.Retired;
    if ((!normal && !exceptional) || (normal && path.indexOf(target) >= path.indexOf(AgentTrustLevel.Approved) && !ceoApproved)) {
      throw new AgentException(`Invalid or unapproved trust transition: ${agent.trust} to ${target}`);
    }
    agent.trust = target;
  }

  makeTemporaryProduction(identifier: string): void {
    const agent = this.require(identifier);
    if (![AgentTrustLevel.Approved, AgentTrustLevel.Trusted, AgentTrustLevel.FullTrust].includes(agent.trust)) throw new AgentException("Temporary production agent must already be approved");
    agent.previousTrust = agent.trust;
    agent.trust = AgentTrustLevel.TemporaryProduction;
  }

  restoreTemporary(identifier: string): void {
    const agent = this.require(identifier);
    if (agent.trust !== AgentTrustLevel.TemporaryProduction || agent.previousTrust === undefined) throw new AgentException("Agent is not temporary production");
    agent.trust = agent.previousTrust;
    agent.previousTrust = undefined;
  }

  private require(identifier: string) {
    const agent = this.#agents.get(identifier);
    if (!agent) throw new AgentException(`Agent is not registered: ${identifier}`);
    return agent;
  }
}
