import { AgentException } from "./AgentException.ts";

export class AgentAssignment {
  constructor(
    readonly capabilityIdentifier: string,
    readonly agentIdentifier: string,
    readonly executionDuration: number,
    readonly success: boolean,
    readonly confidence: number,
    readonly cost: number,
    readonly recordedAt = new Date(),
  ) {
    if (capabilityIdentifier.trim() === "" || agentIdentifier.trim() === "") throw new AgentException("Assignment identifiers are required");
    if (executionDuration < 0 || cost < 0 || confidence < 0 || confidence > 1) throw new AgentException("Assignment measurements are invalid");
  }

  get failure(): boolean { return !this.success; }
}
