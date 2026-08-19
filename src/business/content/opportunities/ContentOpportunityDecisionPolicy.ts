import {
  ContentOpportunityQualificationGate,
  ContentOpportunityQualificationStatus,
  type ContentOpportunityQualificationResult,
} from "./ContentOpportunityQualificationGate.ts";
import type {
  ContentOpportunityRankedScore,
  ContentOpportunityScore,
} from "./ContentOpportunityScoring.ts";

export enum ContentOpportunityDecisionStatus {
  Proceed = "Proceed",
  ResearchRequired = "ResearchRequired",
  Hold = "Hold",
}

export interface ContentOpportunityDecision {
  readonly status: ContentOpportunityDecisionStatus;
  readonly qualificationStatus: ContentOpportunityQualificationStatus;
  readonly uncertaintyStatus: ContentOpportunityQualificationResult["uncertaintyStatus"];
  readonly scoreStatus: ContentOpportunityQualificationResult["scoreStatus"];
  readonly opportunityId: ContentOpportunityQualificationResult["opportunityId"];
  readonly topic: ContentOpportunityQualificationResult["topic"];
  readonly score: number;
  readonly rank?: number;
  readonly threshold: number;
  readonly scoreReference: string;
  readonly rankReference?: string;
  readonly uncertaintyReasons: readonly string[];
  readonly reason: string;
  readonly qualificationResult: ContentOpportunityQualificationResult;
}

const decision = (
  qualificationResult: ContentOpportunityQualificationResult,
  rank: number | undefined,
  status: ContentOpportunityDecisionStatus,
  reason: string,
): ContentOpportunityDecision => {
  const factorReasons = qualificationResult.scoringResult.factors
    .map((factor) => `${factor.label}: ${factor.explanation}`)
    .join(" ");
  const explainableReason = factorReasons.length === 0
    ? reason
    : `${reason} Factors: ${factorReasons}`;

  return Object.freeze({
    status,
    qualificationStatus: qualificationResult.status,
    uncertaintyStatus: qualificationResult.uncertaintyStatus,
    scoreStatus: qualificationResult.scoreStatus,
    opportunityId: qualificationResult.opportunityId,
    topic: qualificationResult.topic,
    score: qualificationResult.score,
    ...(rank === undefined ? {} : { rank }),
    threshold: qualificationResult.threshold,
    scoreReference: `score=${qualificationResult.score.toFixed(4)}`,
    ...(rank === undefined ? {} : { rankReference: `rank=${rank}` }),
    uncertaintyReasons: Object.freeze([...qualificationResult.uncertaintyReasons]),
    reason: explainableReason,
    qualificationResult,
  });
};

export class ContentOpportunityDecisionPolicy {
  private readonly qualificationGate = new ContentOpportunityQualificationGate();

  decide(scoringResult: ContentOpportunityScore, rank?: number): ContentOpportunityDecision {
    const qualificationResult = this.qualificationGate.qualify(scoringResult);
    const rankText = rank === undefined ? "without a rank" : `at rank ${rank}`;

    if (qualificationResult.status === ContentOpportunityQualificationStatus.Qualified) {
      return decision(
        qualificationResult,
        rank,
        ContentOpportunityDecisionStatus.Proceed,
        `Proceed: qualified opportunity ${rankText}; ${qualificationResult.reason}`,
      );
    }

    if (qualificationResult.status === ContentOpportunityQualificationStatus.ResearchRequired) {
      return decision(
        qualificationResult,
        rank,
        ContentOpportunityDecisionStatus.ResearchRequired,
        `ResearchRequired: opportunity ${rankText} needs more evidence before proceeding; ${qualificationResult.reason}`,
      );
    }

    if (qualificationResult.status === ContentOpportunityQualificationStatus.NotQualified) {
      return decision(
        qualificationResult,
        rank,
        ContentOpportunityDecisionStatus.Hold,
        `Hold: opportunity ${rankText} is below the qualification threshold; ${qualificationResult.reason}`,
      );
    }

    return decision(
      qualificationResult,
      rank,
      ContentOpportunityDecisionStatus.Hold,
      `Hold: opportunity ${rankText} has an invalid scoring result; ${qualificationResult.reason}`,
    );
  }

  decideRanked(rankedScore: ContentOpportunityRankedScore): ContentOpportunityDecision {
    return this.decide(rankedScore.score, rankedScore.rank);
  }

  decideMany(rankedScores: readonly ContentOpportunityRankedScore[]): readonly ContentOpportunityDecision[] {
    return Object.freeze(rankedScores.map((rankedScore) => this.decideRanked(rankedScore)));
  }
}