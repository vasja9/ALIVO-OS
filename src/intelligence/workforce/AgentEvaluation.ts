import { AgentException } from "./AgentException.ts";

export class AgentEvaluation {
  constructor(
    readonly agentIdentifier: string,
    readonly capabilityIdentifier: string,
    readonly quality: number,
    readonly accuracy: number,
    readonly compliance: number,
    readonly executionTime: number,
    readonly cost: number,
    readonly reliability: number,
    readonly failureRate: number,
    readonly architectureCompliance: number,
    readonly ceoFeedback?: string,
  ) {
    if (agentIdentifier.trim() === "" || capabilityIdentifier.trim() === "") throw new AgentException("Agent and capability identifiers are required");
    for (const score of [quality, accuracy, compliance, reliability, architectureCompliance]) {
      if (score < 0 || score > 1) throw new AgentException("Evaluation scores must be between zero and one");
    }
    if (executionTime < 0 || cost < 0 || failureRate < 0 || failureRate > 1) throw new AgentException("Evaluation measurements are invalid");
  }
}
