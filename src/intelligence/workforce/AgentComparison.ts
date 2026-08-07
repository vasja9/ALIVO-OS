import { AgentEvaluation } from "./AgentEvaluation.ts";
import { AgentException } from "./AgentException.ts";

export class AgentComparison {
  readonly scoreDifference: number;

  constructor(readonly trusted: AgentEvaluation, readonly candidate: AgentEvaluation) {
    if (trusted.capabilityIdentifier !== candidate.capabilityIdentifier) throw new AgentException("Evaluations must cover the same capability");
    this.scoreDifference = this.score(candidate) - this.score(trusted);
  }

  private score(value: AgentEvaluation): number {
    return value.quality + value.accuracy + value.compliance + value.reliability + value.architectureCompliance
      - value.failureRate - value.executionTime / 1_000_000 - value.cost / 1_000_000;
  }
}
