import assert from "node:assert/strict";
import { test } from "node:test";
import { BusinessPackageId } from "../../src/intelligence/market/MarketIntelligenceDomain.ts";
import {
  ContentOpportunityEvidenceAggregator,
  ContentOpportunityEvidenceIdentity,
  ContentOpportunityScopedEvidence,
} from "../../src/business/content/opportunities/ContentOpportunityEvidenceAggregator.ts";
import {
  ContentOpportunityDecisionPolicy,
  ContentOpportunityDecisionStatus,
} from "../../src/business/content/opportunities/ContentOpportunityDecisionPolicy.ts";
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
  explanation: `Decision policy evidence ${id}`,
  observedAt,
});

const scoreFor = (
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
    "Decision policy topic",
  );
  const scopedEvidence = roles.map((role, index) => new ContentOpportunityScopedEvidence(
    identity,
    reference(sources[index % sources.length]!, `${opportunityValue}-${index}`, role),
  ));
  const aggregate = new ContentOpportunityEvidenceAggregator().aggregate(target, identity, scopedEvidence);
  return new ContentOpportunityScoringService().score(aggregate);
};

const supporting = ContentOpportunityEvidenceRole.Supporting;
const contradicting = ContentOpportunityEvidenceRole.Contradicting;

test("maps a qualified scoring result to Proceed with score and rank references", () => {
  const score = scoreFor("proceed", [supporting, supporting, supporting, supporting]);
  const result = new ContentOpportunityDecisionPolicy().decide(score, 1);

  assert.equal(score.status, ContentOpportunityScoreStatus.Scored);
  assert.ok(score.totalScore >= QUALIFIED_SCORE_THRESHOLD);
  assert.equal(result.status, ContentOpportunityDecisionStatus.Proceed);
  assert.equal(result.score, score.totalScore);
  assert.equal(result.rank, 1);
  assert.equal(result.threshold, QUALIFIED_SCORE_THRESHOLD);
  assert.equal(result.opportunityId?.value, "proceed");
  assert.equal(result.scoreReference, `score=${score.totalScore.toFixed(4)}`);
  assert.equal(result.rankReference, "rank=1");
  assert.match(result.reason, /Proceed/);
  assert.match(result.reason, /rank 1/);
});

test("maps a certain score below the qualification threshold to Hold", () => {
  const score = scoreFor("below-threshold", [
    contradicting,
    contradicting,
    contradicting,
    contradicting,
  ]);
  const result = new ContentOpportunityDecisionPolicy().decide(score, 4);

  assert.equal(result.status, ContentOpportunityDecisionStatus.Hold);
  assert.equal(result.qualificationStatus, "NotQualified");
  assert.ok(result.score < QUALIFIED_SCORE_THRESHOLD);
  assert.match(result.reason, /below the qualification threshold/);
});

test("maps partial or uncertain evidence to ResearchRequired and never Proceed", () => {
  const score = scoreFor(
    "research-required",
    [supporting, supporting],
    [
      ContentOpportunityEvidenceSource.KnowledgeVault,
      ContentOpportunityEvidenceSource.PinterestPerformance,
    ],
  );
  const result = new ContentOpportunityDecisionPolicy().decide(score, 2);

  assert.equal(score.status, ContentOpportunityScoreStatus.Uncertain);
  assert.equal(result.status, ContentOpportunityDecisionStatus.ResearchRequired);
  assert.equal(result.uncertaintyStatus, "Uncertain");
  assert.ok(result.score < QUALIFIED_SCORE_THRESHOLD);
  assert.doesNotMatch(result.reason, /Proceed:/);
  assert.match(result.reason, /needs more evidence/);
  assert.ok(result.uncertaintyReasons.length > 0);
});

test("maps an invalid scoring result to Hold without requesting execution", () => {
  const identity = new ContentOpportunityEvidenceIdentity(
    new ContentOpportunityId("invalid-decision"),
    "Decision policy topic",
  );
  const foreignEvidence = new ContentOpportunityEvidenceReference({
    businessPackageId: new BusinessPackageId("FOREIGN"),
    source: ContentOpportunityEvidenceSource.Web,
    sourceReference: "web:source:invalid-decision",
    evidenceReference: "web:evidence:invalid-decision",
    language: "de",
    market: "DE",
    role: supporting,
    observedAt,
  });
  const invalidAggregate = new ContentOpportunityEvidenceAggregator().aggregate(
    target,
    identity,
    [new ContentOpportunityScopedEvidence(identity, foreignEvidence)],
  );
  const score = new ContentOpportunityScoringService().score(invalidAggregate);
  const result = new ContentOpportunityDecisionPolicy().decide(score);

  assert.equal(score.status, ContentOpportunityScoreStatus.Invalid);
  assert.equal(result.status, ContentOpportunityDecisionStatus.Hold);
  assert.equal(result.uncertaintyStatus, "Invalid");
  assert.equal(result.score, 0);
  assert.match(result.reason, /invalid scoring result/i);
});

test("keeps the inclusive threshold boundary deterministic", () => {
  const score = scoreFor("threshold", [
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
  const policy = new ContentOpportunityDecisionPolicy();
  const first = policy.decide(score, 3);
  const second = policy.decide(score, 3);

  assert.equal(score.totalScore, QUALIFIED_SCORE_THRESHOLD);
  assert.equal(first.status, ContentOpportunityDecisionStatus.Proceed);
  assert.deepEqual(first, second);
  assert.match(first.reason, /threshold/);
});

test("preserves contradiction explanation and holds when contradiction lowers the score", () => {
  const score = scoreFor("contradicted", [
    supporting,
    contradicting,
    contradicting,
    contradicting,
  ]);
  const result = new ContentOpportunityDecisionPolicy().decide(score, 5);

  assert.equal(result.status, ContentOpportunityDecisionStatus.Hold);
  assert.ok(score.factors.some((factor) => /contradicting/i.test(factor.explanation)));
  assert.match(result.reason, /contradicting/i);
  assert.equal(result.qualificationResult.scoringResult, score);
});

test("decision is explainable and immutable", () => {
  const score = scoreFor("immutable-decision", [supporting, supporting, supporting, supporting]);
  const result = new ContentOpportunityDecisionPolicy().decideRanked({
    rank: 1,
    score,
  });

  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.uncertaintyReasons), true);
  assert.equal(Object.isFrozen(result.qualificationResult), true);
  assert.ok(result.reason.length > 0);
  assert.ok(result.scoreReference.includes(score.totalScore.toFixed(4)));
  assert.ok(result.reason.includes(score.explanation));
  assert.throws(() => result.uncertaintyReasons.push("mutation"), TypeError);
});

test("decideMany preserves each ranked score identity regardless of input order", () => {
  const policy = new ContentOpportunityDecisionPolicy();
  const ranked = [
    { rank: 1, score: scoreFor("ranked-a", [supporting, supporting, supporting, supporting]) },
    { rank: 2, score: scoreFor("ranked-b", [contradicting, contradicting, contradicting, contradicting]) },
    {
      rank: 3,
      score: scoreFor("ranked-c", [supporting, supporting], [
        ContentOpportunityEvidenceSource.KnowledgeVault,
        ContentOpportunityEvidenceSource.PinterestPerformance,
      ]),
    },
  ] as const;
  const first = policy.decideMany(ranked);
  const second = policy.decideMany([...ranked].reverse());
  const firstById = new Map(first.map((decision) => [decision.opportunityId?.value, decision.status]));
  const secondById = new Map(second.map((decision) => [decision.opportunityId?.value, decision.status]));

  assert.deepEqual([...firstById.entries()].sort(), [...secondById.entries()].sort());
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first[0]?.rank, 1);
  assert.equal(second[0]?.rank, 3);
});