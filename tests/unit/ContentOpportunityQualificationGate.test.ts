import assert from "node:assert/strict";
import { test } from "node:test";
import { BusinessPackageId } from "../../src/intelligence/market/MarketIntelligenceDomain.ts";
import {
  ContentOpportunityEvidenceAggregator,
  ContentOpportunityEvidenceIdentity,
  ContentOpportunityScopedEvidence,
} from "../../src/business/content/opportunities/ContentOpportunityEvidenceAggregator.ts";
import {
  ContentOpportunityQualificationGate,
  ContentOpportunityQualificationReasonCode,
  ContentOpportunityQualificationStatus,
  ContentOpportunityQualificationUncertaintyStatus,
} from "../../src/business/content/opportunities/ContentOpportunityQualificationGate.ts";
import {
  ContentOpportunityEvidenceReference,
  ContentOpportunityEvidenceRole,
  ContentOpportunityEvidenceSource,
  ContentOpportunityId,
} from "../../src/business/content/opportunities/ContentOpportunityIntelligenceDomain.ts";
import {
  BusinessPackageLanguageMarketPolicy,
  ContentOpportunityLanguageMarketPolicyResolver,
  ResearchLanguageMode,
} from "../../src/business/content/opportunities/LanguageMarketPolicy.ts";
import {
  ContentOpportunityScoreStatus,
  ContentOpportunityScoringService,
} from "../../src/business/content/opportunities/ContentOpportunityScoring.ts";
import { QUALIFIED_SCORE_THRESHOLD } from "../../src/business/content/opportunities/ContentOpportunityEvaluationService.ts";

const packageId = new BusinessPackageId("ALIVO");
const observedAt = new Date("2026-08-18T12:00:00.000Z");
const target = new ContentOpportunityLanguageMarketPolicyResolver().resolve(
  new BusinessPackageLanguageMarketPolicy({
    businessPackageId: packageId,
    contentWriteLanguage: "de",
    publishingLanguage: "de",
    researchLanguageMode: ResearchLanguageMode.Auto,
    targetMarket: "DE",
  }),
);

const reference = (
  source: ContentOpportunityEvidenceSource,
  id: string,
  role: ContentOpportunityEvidenceRole,
): ContentOpportunityEvidenceReference => new ContentOpportunityEvidenceReference({
  businessPackageId: packageId,
  source,
  sourceReference: `${source}:source:${id}`,
  evidenceReference: `${source}:evidence:${id}`,
  language: "de",
  market: "DE",
  role,
  explanation: `Qualification gate evidence ${id}`,
  observedAt,
});

const aggregate = (
  opportunityValue: string,
  roles: readonly ContentOpportunityEvidenceRole[],
  sources: readonly ContentOpportunityEvidenceSource[] = [
    ContentOpportunityEvidenceSource.KnowledgeVault,
    ContentOpportunityEvidenceSource.ExistingBlog,
    ContentOpportunityEvidenceSource.PinterestPerformance,
    ContentOpportunityEvidenceSource.Web,
  ],
) => {
  const identity = new ContentOpportunityEvidenceIdentity(
    new ContentOpportunityId(opportunityValue),
    "Qualification gate topic",
  );
  const evidence = roles.map((role, index) => new ContentOpportunityScopedEvidence(
    identity,
    reference(sources[index % sources.length]!, `${opportunityValue}-${index}`, role),
  ));
  return new ContentOpportunityEvidenceAggregator().aggregate(target, identity, evidence);
};

const scoreFor = (
  opportunityValue: string,
  roles: readonly ContentOpportunityEvidenceRole[],
  sources?: readonly ContentOpportunityEvidenceSource[],
) => new ContentOpportunityScoringService().score(aggregate(opportunityValue, roles, sources));

const supporting = ContentOpportunityEvidenceRole.Supporting;
const contradicting = ContentOpportunityEvidenceRole.Contradicting;

test("qualifies a certain score above the 0.75 threshold", () => {
  const scoringResult = scoreFor("above-threshold", [supporting, supporting, supporting, supporting]);
  const result = new ContentOpportunityQualificationGate().qualify(scoringResult);

  assert.equal(scoringResult.status, ContentOpportunityScoreStatus.Scored);
  assert.ok(scoringResult.totalScore > QUALIFIED_SCORE_THRESHOLD);
  assert.equal(result.status, ContentOpportunityQualificationStatus.Qualified);
  assert.equal(result.uncertaintyStatus, ContentOpportunityQualificationUncertaintyStatus.Certain);
  assert.equal(result.score, scoringResult.totalScore);
  assert.equal(result.threshold, QUALIFIED_SCORE_THRESHOLD);
  assert.equal(result.opportunityId?.value, "above-threshold");
  assert.deepEqual(result.reasonCodes, [
    ContentOpportunityQualificationReasonCode.QualifiedCertainScoreAtOrAboveThreshold,
  ]);
  assert.match(result.reason, /meets threshold 0\.75/);
});

test("does not qualify a certain score below the threshold", () => {
  const scoringResult = scoreFor("below-threshold", [
    contradicting,
    contradicting,
    contradicting,
    contradicting,
  ]);
  const result = new ContentOpportunityQualificationGate().qualify(scoringResult);

  assert.equal(scoringResult.status, ContentOpportunityScoreStatus.Scored);
  assert.ok(scoringResult.totalScore < QUALIFIED_SCORE_THRESHOLD);
  assert.equal(result.status, ContentOpportunityQualificationStatus.NotQualified);
  assert.equal(result.uncertaintyStatus, ContentOpportunityQualificationUncertaintyStatus.Certain);
  assert.deepEqual(result.reasonCodes, [
    ContentOpportunityQualificationReasonCode.NotQualifiedBelowThreshold,
  ]);
  assert.match(result.reason, /contradicting evidence reference/);
  assert.match(result.reason, /below threshold 0\.75/);
});

test("qualifies a certain score exactly at the inclusive 0.75 threshold", () => {
  const scoringResult = scoreFor("exact-threshold", [
    supporting,
    supporting,
    supporting,
    supporting,
    supporting,
    supporting,
    supporting,
    contradicting,
    contradicting,
    contradicting,
    contradicting,
    contradicting,
  ]);
  const result = new ContentOpportunityQualificationGate().qualify(scoringResult);

  assert.equal(scoringResult.status, ContentOpportunityScoreStatus.Scored);
  assert.equal(scoringResult.totalScore, QUALIFIED_SCORE_THRESHOLD);
  assert.equal(result.status, ContentOpportunityQualificationStatus.Qualified);
  assert.deepEqual(result.reasonCodes, [
    ContentOpportunityQualificationReasonCode.QualifiedCertainScoreAtOrAboveThreshold,
  ]);
  assert.match(result.reason, /score 0\.7500 meets threshold 0\.75/);
});

test("routes partial or uncertain evidence to ResearchRequired even if its score reaches the threshold", () => {
  const scoringResult = scoreFor(
    "partial-evidence",
    [supporting, supporting],
    [
      ContentOpportunityEvidenceSource.KnowledgeVault,
      ContentOpportunityEvidenceSource.PinterestPerformance,
    ],
  );
  const result = new ContentOpportunityQualificationGate().qualify(scoringResult);

  assert.equal(scoringResult.status, ContentOpportunityScoreStatus.Uncertain);
  assert.equal(result.status, ContentOpportunityQualificationStatus.ResearchRequired);
  assert.equal(result.uncertaintyStatus, ContentOpportunityQualificationUncertaintyStatus.Uncertain);
  assert.deepEqual(result.reasonCodes, [
    ContentOpportunityQualificationReasonCode.ResearchRequiredUncertainEvidence,
  ]);
  assert.ok(result.uncertaintyReasons.length > 0);
  assert.match(result.reason, /evidence is uncertain/);
  assert.doesNotMatch(result.reason, /Qualified:/);
});

test("rejects an invalid scoring result safely without qualifying it", () => {
  const identity = new ContentOpportunityEvidenceIdentity(
    new ContentOpportunityId("invalid-scoring-result"),
    "Qualification gate topic",
  );
  const foreignReference = new ContentOpportunityEvidenceReference({
    businessPackageId: new BusinessPackageId("FOREIGN"),
    source: ContentOpportunityEvidenceSource.Web,
    sourceReference: "web:source:invalid-package",
    evidenceReference: "web:evidence:invalid-package",
    language: "de",
    market: "DE",
    role: supporting,
    explanation: "Foreign-package evidence must invalidate the aggregate.",
    observedAt,
  });
  const invalidAggregate = new ContentOpportunityEvidenceAggregator().aggregate(
    target,
    identity,
    [new ContentOpportunityScopedEvidence(identity, foreignReference)],
  );
  const scoringResult = new ContentOpportunityScoringService().score(invalidAggregate);
  const result = new ContentOpportunityQualificationGate().qualify(scoringResult);

  assert.equal(scoringResult.status, ContentOpportunityScoreStatus.Invalid);
  assert.equal(result.status, ContentOpportunityQualificationStatus.Rejected);
  assert.equal(result.uncertaintyStatus, ContentOpportunityQualificationUncertaintyStatus.Invalid);
  assert.deepEqual(result.reasonCodes, [
    ContentOpportunityQualificationReasonCode.RejectedInvalidScoringResult,
  ]);
  assert.equal(result.score, 0);
  assert.match(result.reason, /scoring result is invalid/i);
});

test("preserves scoring identity, explanation, factor breakdown, and immutable result state", () => {
  const scoringResult = scoreFor("immutable-gate-result", [supporting, supporting, supporting, supporting]);
  const result = new ContentOpportunityQualificationGate().qualify(scoringResult);

  assert.equal(result.scoringResult, scoringResult);
  assert.equal(result.topic, scoringResult.topic);
  assert.deepEqual(result.scoringResult.factors, scoringResult.factors);
  assert.equal(Object.isFrozen(result.reasonCodes), true);
  assert.ok(result.reason.includes(scoringResult.explanation));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.uncertaintyReasons), true);
  assert.throws(() => result.uncertaintyReasons.push("mutated"), TypeError);
});

test("does not qualify on totalScore alone when the scoring result lacks explainable factors", () => {
  const scoringResult = scoreFor("score-only", [supporting, supporting, supporting, supporting]);
  const scoreOnlyResult = Object.freeze({
    ...scoringResult,
    totalScore: 1,
    factors: Object.freeze([]),
  });
  const result = new ContentOpportunityQualificationGate().qualify(scoreOnlyResult);

  assert.equal(result.status, ContentOpportunityQualificationStatus.Rejected);
  assert.equal(result.reasonCodes[0], ContentOpportunityQualificationReasonCode.RejectedInvalidScoringResult);
  assert.match(result.reason, /invalid and cannot be qualified/i);
});

test("qualification is deterministic and independent of repeated evaluation order", () => {
  const gate = new ContentOpportunityQualificationGate();
  const first = gate.qualify(scoreFor("deterministic", [supporting, supporting, supporting, supporting]));
  const second = gate.qualify(scoreFor("deterministic", [supporting, supporting, supporting, supporting]));

  assert.deepEqual(
    {
      status: first.status,
      uncertaintyStatus: first.uncertaintyStatus,
      score: first.score,
      threshold: first.threshold,
      opportunityId: first.opportunityId?.value,
      reason: first.reason,
    },
    {
      status: second.status,
      uncertaintyStatus: second.uncertaintyStatus,
      score: second.score,
      threshold: second.threshold,
      opportunityId: second.opportunityId?.value,
      reason: second.reason,
    },
  );
});

test("qualification of each score is input-order invariant when scores are supplied in different order", () => {
  const gate = new ContentOpportunityQualificationGate();
  const scores = [
    scoreFor("order-a", [supporting, supporting, supporting, supporting]),
    scoreFor("order-b", [contradicting, contradicting, contradicting, contradicting]),
    scoreFor("order-c", [supporting, supporting], [
      ContentOpportunityEvidenceSource.KnowledgeVault,
      ContentOpportunityEvidenceSource.PinterestPerformance,
    ]),
  ];
  const first = new Map(scores.map((score) => [score.opportunityId?.value, gate.qualify(score).status]));
  const second = new Map([...scores].reverse().map((score) => [score.opportunityId?.value, gate.qualify(score).status]));

  assert.deepEqual([...first.entries()].sort(), [...second.entries()].sort());
});