import { QUALIFIED_SCORE_THRESHOLD } from "./ContentOpportunityEvaluationService.ts";
import {
  ContentOpportunityScoreStatus,
  type ContentOpportunityScore,
} from "./ContentOpportunityScoring.ts";

export enum ContentOpportunityQualificationStatus {
  Qualified = "Qualified",
  ResearchRequired = "ResearchRequired",
  NotQualified = "NotQualified",
  Rejected = "Rejected",
}

export enum ContentOpportunityQualificationUncertaintyStatus {
  Certain = "Certain",
  Uncertain = "Uncertain",
  Invalid = "Invalid",
}

export enum ContentOpportunityQualificationReasonCode {
  QualifiedCertainScoreAtOrAboveThreshold = "QUALIFIED_CERTAIN_SCORE_AT_OR_ABOVE_THRESHOLD",
  NotQualifiedBelowThreshold = "NOT_QUALIFIED_BELOW_THRESHOLD",
  ResearchRequiredUncertainEvidence = "RESEARCH_REQUIRED_UNCERTAIN_EVIDENCE",
  RejectedInvalidScoringResult = "REJECTED_INVALID_SCORING_RESULT",
}

export interface ContentOpportunityQualificationResult {
  readonly status: ContentOpportunityQualificationStatus;
  readonly uncertaintyStatus: ContentOpportunityQualificationUncertaintyStatus;
  readonly scoreStatus: ContentOpportunityScoreStatus;
  readonly opportunityId?: ContentOpportunityScore["opportunityId"];
  readonly topic?: ContentOpportunityScore["topic"];
  readonly score: number;
  readonly threshold: number;
  readonly uncertaintyReasons: readonly string[];
  readonly reasonCodes: readonly ContentOpportunityQualificationReasonCode[];
  readonly reason: string;
  readonly scoringResult: ContentOpportunityScore;
}

const uncertaintyStatusOf = (
  scoreStatus: ContentOpportunityScoreStatus,
): ContentOpportunityQualificationUncertaintyStatus => {
  if (scoreStatus === ContentOpportunityScoreStatus.Invalid) {
    return ContentOpportunityQualificationUncertaintyStatus.Invalid;
  }
  if (scoreStatus === ContentOpportunityScoreStatus.Uncertain) {
    return ContentOpportunityQualificationUncertaintyStatus.Uncertain;
  }
  if (scoreStatus === ContentOpportunityScoreStatus.Scored) {
    return ContentOpportunityQualificationUncertaintyStatus.Certain;
  }
  return ContentOpportunityQualificationUncertaintyStatus.Invalid;
};

const result = (
  scoringResult: ContentOpportunityScore,
  status: ContentOpportunityQualificationStatus,
  reasonCodes: readonly ContentOpportunityQualificationReasonCode[],
  reason: string,
): ContentOpportunityQualificationResult => {
  const factorReasons = scoringResult.factors
    .map((factor) => `${factor.label}: ${factor.explanation}`)
    .join(" ");
  const explainableReason = factorReasons.length === 0
    ? reason
    : `${reason} Factors: ${factorReasons}`;

  return Object.freeze({
    status,
    uncertaintyStatus: uncertaintyStatusOf(scoringResult.status),
    scoreStatus: scoringResult.status,
    opportunityId: scoringResult.opportunityId,
    topic: scoringResult.topic,
    score: scoringResult.totalScore,
    threshold: QUALIFIED_SCORE_THRESHOLD,
    uncertaintyReasons: Object.freeze([...scoringResult.uncertaintyReasons]),
    reasonCodes: Object.freeze([...reasonCodes]),
    reason: explainableReason,
    scoringResult,
  });
};

const hasExplainableIdentity = (scoringResult: ContentOpportunityScore): boolean =>
  scoringResult.opportunityId !== undefined
  && typeof scoringResult.topic === "string"
  && scoringResult.topic.trim().length > 0;

const hasExplainableFactors = (scoringResult: ContentOpportunityScore): boolean =>
  Array.isArray(scoringResult.factors)
  && scoringResult.factors.length > 0
  && scoringResult.factors.every((factor) =>
    typeof factor.id === "string"
    && typeof factor.label === "string"
    && Number.isFinite(factor.score)
    && Number.isFinite(factor.weight)
    && Number.isFinite(factor.contribution)
    && typeof factor.explanation === "string"
    && factor.explanation.trim().length > 0);

export class ContentOpportunityQualificationGate {
  qualify(scoringResult: ContentOpportunityScore): ContentOpportunityQualificationResult {
    if (
      scoringResult.status === ContentOpportunityScoreStatus.Invalid
      || !hasExplainableIdentity(scoringResult)
      || !hasExplainableFactors(scoringResult)
      || !Number.isFinite(scoringResult.totalScore)
      || scoringResult.totalScore < 0
      || scoringResult.totalScore > 1
    ) {
      return result(
        scoringResult,
        ContentOpportunityQualificationStatus.Rejected,
        [ContentOpportunityQualificationReasonCode.RejectedInvalidScoringResult],
        `Rejected: the scoring result is invalid and cannot be qualified. ${scoringResult.explanation}`,
      );
    }

    if (scoringResult.status === ContentOpportunityScoreStatus.Uncertain) {
      return result(
        scoringResult,
        ContentOpportunityQualificationStatus.ResearchRequired,
        [ContentOpportunityQualificationReasonCode.ResearchRequiredUncertainEvidence],
        `ResearchRequired: scoring evidence is uncertain and must be completed before qualification; `
        + `score ${scoringResult.totalScore.toFixed(4)} is compared with threshold ${QUALIFIED_SCORE_THRESHOLD.toFixed(2)}. `
        + scoringResult.explanation,
      );
    }

    if (scoringResult.totalScore >= QUALIFIED_SCORE_THRESHOLD) {
      return result(
        scoringResult,
        ContentOpportunityQualificationStatus.Qualified,
        [ContentOpportunityQualificationReasonCode.QualifiedCertainScoreAtOrAboveThreshold],
        `Qualified: score ${scoringResult.totalScore.toFixed(4)} meets threshold ${QUALIFIED_SCORE_THRESHOLD.toFixed(2)}. `
        + scoringResult.explanation,
      );
    }

    return result(
      scoringResult,
      ContentOpportunityQualificationStatus.NotQualified,
      [ContentOpportunityQualificationReasonCode.NotQualifiedBelowThreshold],
      `NotQualified: score ${scoringResult.totalScore.toFixed(4)} is below threshold ${QUALIFIED_SCORE_THRESHOLD.toFixed(2)}. `
      + scoringResult.explanation,
    );
  }
}