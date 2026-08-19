import {
  ContentOpportunityEvidenceAggregationStatus,
  type ContentOpportunityEvidenceAggregation,
} from "./ContentOpportunityEvidenceAggregator.ts";
import {
  ContentOpportunityEvidenceSource,
  ContentOpportunityId,
} from "./ContentOpportunityIntelligenceDomain.ts";

export enum ContentOpportunityScoreStatus {
  Scored = "Scored",
  Uncertain = "Uncertain",
  Invalid = "Invalid",
}

export enum ContentOpportunityScoreFactorId {
  EvidenceStrength = "evidence-strength",
  SourceDiversityCoverage = "source-diversity-coverage",
  EvidenceQualityConfidence = "evidence-quality-confidence",
  PinterestPerformanceSignal = "pinterest-performance-signal",
  ContentCoverageGap = "content-coverage-gap",
  EvidenceCompleteness = "evidence-completeness",
}

export interface ContentOpportunityScoreFactor {
  readonly id: ContentOpportunityScoreFactorId;
  readonly label: string;
  readonly score: number;
  readonly weight: number;
  readonly contribution: number;
  readonly explanation: string;
}

export interface ContentOpportunityScore {
  readonly status: ContentOpportunityScoreStatus;
  readonly opportunityId?: ContentOpportunityId;
  readonly topic?: string;
  readonly businessPackageId?: ContentOpportunityEvidenceAggregation["businessPackageId"];
  readonly language?: string;
  readonly market?: string;
  readonly totalScore: number;
  readonly rawScore: number;
  readonly uncertaintyPenalty: number;
  readonly uncertaintyReasons: readonly string[];
  readonly factors: readonly ContentOpportunityScoreFactor[];
  readonly explanation: string;
}

export interface ContentOpportunityRankedScore {
  readonly rank: number;
  readonly score: ContentOpportunityScore;
}

const REQUIRED_SOURCE_COUNT = 4;
const PARTIAL_SCORE_CEILING = 0.74;

const FACTOR_WEIGHTS: Readonly<Record<ContentOpportunityScoreFactorId, number>> = Object.freeze({
  [ContentOpportunityScoreFactorId.EvidenceStrength]: 0.30,
  [ContentOpportunityScoreFactorId.SourceDiversityCoverage]: 0.20,
  [ContentOpportunityScoreFactorId.EvidenceQualityConfidence]: 0.15,
  [ContentOpportunityScoreFactorId.PinterestPerformanceSignal]: 0.15,
  [ContentOpportunityScoreFactorId.ContentCoverageGap]: 0.05,
  [ContentOpportunityScoreFactorId.EvidenceCompleteness]: 0.15,
});

const QUALITY_LEVELS: Readonly<Record<string, number>> = Object.freeze({
  High: 1,
  Moderate: 0.75,
  Medium: 0.75,
  Low: 0.4,
  Unknown: 0.5,
});

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

const levelOf = (value: string | undefined): number | undefined =>
  value === undefined ? undefined : QUALITY_LEVELS[value] ?? 0.5;

const factor = (
  id: ContentOpportunityScoreFactorId,
  label: string,
  score: number,
  explanation: string,
): ContentOpportunityScoreFactor => Object.freeze({
  id,
  label,
  score: clamp(score),
  weight: FACTOR_WEIGHTS[id],
  contribution: clamp(score) * FACTOR_WEIGHTS[id],
  explanation,
});

const invalidScore = (reason: string): ContentOpportunityScore => Object.freeze({
  status: ContentOpportunityScoreStatus.Invalid,
  totalScore: 0,
  rawScore: 0,
  uncertaintyPenalty: 0,
  uncertaintyReasons: Object.freeze([reason]),
  factors: Object.freeze([]),
  explanation: `Invalid opportunity score: ${reason}`,
});

const validAggregate = (
  aggregate: ContentOpportunityEvidenceAggregation,
): boolean =>
  (aggregate.status === ContentOpportunityEvidenceAggregationStatus.Aggregated
    || aggregate.status === ContentOpportunityEvidenceAggregationStatus.Partial)
  && aggregate.opportunityId !== undefined
  && aggregate.topic !== undefined
  && aggregate.businessPackageId !== undefined
  && typeof aggregate.language === "string"
  && typeof aggregate.market === "string"
  && Array.isArray(aggregate.evidenceReferences)
  && Array.isArray(aggregate.provenance)
  && Array.isArray(aggregate.missingSources);

export class ContentOpportunityScoringService {
  score(aggregate: ContentOpportunityEvidenceAggregation): ContentOpportunityScore {
    if (!validAggregate(aggregate)) {
      return invalidScore("Only a valid Aggregated or Partial Evidence Aggregation may be scored.");
    }

    const opportunityId = aggregate.opportunityId!;
    const topic = aggregate.topic!;
    const directionalEvidence = aggregate.supportingEvidenceCount + aggregate.contradictingEvidenceCount;
    const evidenceStrength = directionalEvidence === 0
      ? 0
      : aggregate.supportingEvidenceCount / directionalEvidence;
    const sourceCoverage = aggregate.sourceDiversity / REQUIRED_SOURCE_COUNT;
    const qualityConfidenceValues = aggregate.provenance.flatMap((provenance) => [
      levelOf(provenance.sourceQuality),
      levelOf(provenance.evidenceConfidence),
    ].filter((value): value is number => value !== undefined));
    const qualityConfidence = qualityConfidenceValues.length === 0
      ? 0.5
      : qualityConfidenceValues.reduce((sum, value) => sum + value, 0) / qualityConfidenceValues.length;
    const hasPinterestPerformance = aggregate.provenance.some(
      (provenance) => provenance.source === ContentOpportunityEvidenceSource.PinterestPerformance,
    );
    const contentCoverageGap = aggregate.missingSources.includes(ContentOpportunityEvidenceSource.ExistingBlog) ? 1 : 0;
    const completeness = sourceCoverage;

    const factors = Object.freeze([
      factor(
        ContentOpportunityScoreFactorId.EvidenceStrength,
        "Evidence strength versus contradiction",
        evidenceStrength,
        directionalEvidence === 0
          ? "No supporting or contradicting evidence is present; the strength signal is unavailable."
          : `${aggregate.supportingEvidenceCount} supporting versus ${aggregate.contradictingEvidenceCount} contradicting evidence reference(s).`,
      ),
      factor(
        ContentOpportunityScoreFactorId.SourceDiversityCoverage,
        "Source diversity and coverage",
        sourceCoverage,
        `${aggregate.sourceDiversity} of ${REQUIRED_SOURCE_COUNT} required evidence sources are represented.`,
      ),
      factor(
        ContentOpportunityScoreFactorId.EvidenceQualityConfidence,
        "Evidence quality and confidence",
        qualityConfidence,
        qualityConfidenceValues.length === 0
          ? "No quality or confidence metadata is available; a neutral value is used and uncertainty is reported."
          : `${qualityConfidenceValues.length} quality/confidence value(s) contributed to the deterministic average.`,
      ),
      factor(
        ContentOpportunityScoreFactorId.PinterestPerformanceSignal,
        "Pinterest performance signal availability",
        hasPinterestPerformance ? 1 : 0,
        hasPinterestPerformance
          ? "Normalized Pinterest Performance evidence is available; this factor does not infer metric magnitude."
          : "No normalized Pinterest Performance evidence is available.",
      ),
      factor(
        ContentOpportunityScoreFactorId.ContentCoverageGap,
        "Existing content coverage gap",
        contentCoverageGap,
        contentCoverageGap
          ? "Existing Blog evidence is absent; this is a coverage-gap signal, not proof that no blog exists."
          : "Existing Blog evidence is present, so no absence-based coverage gap is inferred.",
      ),
      factor(
        ContentOpportunityScoreFactorId.EvidenceCompleteness,
        "Evidence completeness",
        completeness,
        aggregate.status === ContentOpportunityEvidenceAggregationStatus.Aggregated
          ? "All required evidence sources are represented."
          : `Evidence is partial; ${aggregate.missingSources.length} required source(s) are missing.`,
      ),
    ]);

    const rawScore = factors.reduce((sum, current) => sum + current.contribution, 0);
    const totalScore = aggregate.status === ContentOpportunityEvidenceAggregationStatus.Partial
      ? Math.min(rawScore, PARTIAL_SCORE_CEILING)
      : rawScore;
    const uncertaintyReasons = [
      ...(aggregate.status === ContentOpportunityEvidenceAggregationStatus.Partial
        ? [`Partial evidence: missing ${aggregate.missingSources.join(", ") || "required sources"}. Score is capped below the qualification threshold.`]
        : []),
      ...(qualityConfidenceValues.length === 0
        ? ["Quality/confidence metadata is unavailable."]
        : []),
      ...(!hasPinterestPerformance
        ? ["Pinterest Performance signal is unavailable."]
        : []),
    ];
    const uncertaintyPenalty = rawScore - totalScore;
    const status = aggregate.status === ContentOpportunityEvidenceAggregationStatus.Partial
      ? ContentOpportunityScoreStatus.Uncertain
      : ContentOpportunityScoreStatus.Scored;
    const explanation = [
      `${status} opportunity "${opportunityId.value}" topic "${topic}"`,
      `score=${totalScore.toFixed(4)}`,
      `raw=${rawScore.toFixed(4)}`,
      `uncertainty penalty=${uncertaintyPenalty.toFixed(4)}`,
      ...uncertaintyReasons,
    ].join("; ");

    return Object.freeze({
      status,
      opportunityId,
      topic,
      businessPackageId: aggregate.businessPackageId,
      language: aggregate.language,
      market: aggregate.market,
      totalScore,
      rawScore,
      uncertaintyPenalty,
      uncertaintyReasons: Object.freeze(uncertaintyReasons),
      factors,
      explanation,
    });
  }

  rank(aggregates: readonly ContentOpportunityEvidenceAggregation[]): readonly ContentOpportunityRankedScore[] {
    if (!Array.isArray(aggregates)) {
      return Object.freeze([]);
    }
    const scored = aggregates.map((aggregate) => this.score(aggregate));
    return Object.freeze(scored
      .sort((left, right) => {
        if (left.status === ContentOpportunityScoreStatus.Invalid && right.status !== ContentOpportunityScoreStatus.Invalid) return 1;
        if (right.status === ContentOpportunityScoreStatus.Invalid && left.status !== ContentOpportunityScoreStatus.Invalid) return -1;
        return right.totalScore - left.totalScore
          || (left.opportunityId?.value ?? "").localeCompare(right.opportunityId?.value ?? "")
          || (left.topic ?? "").localeCompare(right.topic ?? "")
          || (left.market ?? "").localeCompare(right.market ?? "")
          || (left.language ?? "").localeCompare(right.language ?? "");
      })
      .map((score, index) => Object.freeze({ rank: index + 1, score })));
  }
}