import assert from "node:assert/strict";
import { test } from "node:test";
import { BusinessPackageId } from "../../src/intelligence/market/MarketIntelligenceDomain.ts";
import {
  ContentOpportunityEvidenceAggregator,
  ContentOpportunityEvidenceIdentity,
  ContentOpportunityScopedEvidence,
} from "../../src/business/content/opportunities/ContentOpportunityEvidenceAggregator.ts";
import {
  ContentOpportunityScoreFactorId,
  ContentOpportunityScoreStatus,
  ContentOpportunityScoringService,
} from "../../src/business/content/opportunities/ContentOpportunityScoring.ts";
import {
  ContentOpportunityId,
  ContentOpportunityEvidenceReference,
  ContentOpportunityEvidenceRole,
  ContentOpportunityEvidenceSource,
} from "../../src/business/content/opportunities/ContentOpportunityIntelligenceDomain.ts";
import {
  BusinessPackageLanguageMarketPolicy,
  ContentOpportunityLanguageMarketPolicyResolver,
  ResearchLanguageMode,
} from "../../src/business/content/opportunities/LanguageMarketPolicy.ts";

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
  overrides: Partial<ConstructorParameters<typeof ContentOpportunityEvidenceReference>[0]> = {},
): ContentOpportunityEvidenceReference => new ContentOpportunityEvidenceReference({
  businessPackageId: packageId,
  source,
  sourceReference: `${source}:source:${id}`,
  evidenceReference: `${source}:evidence:${id}`,
  language: "de",
  market: "DE",
  role: ContentOpportunityEvidenceRole.Supporting,
  explanation: `Evidence explanation for ${id}`,
  observedAt,
  ...overrides,
});

const aggregate = (
  opportunityValue = "opportunity-meal-fatigue",
  topic = "Meal Fatigue",
  references: readonly ContentOpportunityEvidenceReference[] = [
    reference(ContentOpportunityEvidenceSource.KnowledgeVault, "vault"),
    reference(ContentOpportunityEvidenceSource.ExistingBlog, "blog"),
    reference(ContentOpportunityEvidenceSource.PinterestPerformance, "pin"),
    reference(ContentOpportunityEvidenceSource.Web, "web", {
      sourceQuality: "High",
      evidenceConfidence: "Moderate",
    }),
  ],
) => {
  const identity = new ContentOpportunityEvidenceIdentity(
    new ContentOpportunityId(opportunityValue),
    topic,
  );
  const scoped = references.map((item) => new ContentOpportunityScopedEvidence(identity, item));
  return new ContentOpportunityEvidenceAggregator().aggregate(target, identity, scoped);
};

const scoreOf = (result: ReturnType<ContentOpportunityScoringService["score"]>, id: ContentOpportunityScoreFactorId) =>
  result.factors.find((factor) => factor.id === id);

test("scores a complete multi-source evidence profile with explicit factor breakdown", () => {
  const result = new ContentOpportunityScoringService().score(aggregate());

  assert.equal(result.status, ContentOpportunityScoreStatus.Scored);
  assert.equal(result.opportunityId?.value, "opportunity-meal-fatigue");
  assert.equal(result.topic, "meal fatigue");
  assert.ok(result.totalScore > 0);
  assert.equal(result.uncertaintyPenalty, 0);
  assert.equal(result.factors.length, 6);
  assert.equal(
    result.factors.reduce((sum, factor) => sum + factor.contribution, 0),
    result.rawScore,
  );
  assert.match(result.explanation, /opportunity "opportunity-meal-fatigue"/);
  assert.match(result.explanation, /score=/);
  assert.ok(result.factors.every((factor) => factor.explanation.length > 0));
});

test("contradicting evidence lowers the strength factor and total score", () => {
  const service = new ContentOpportunityScoringService();
  const supporting = service.score(aggregate("opportunity-supporting", "Topic", [
    reference(ContentOpportunityEvidenceSource.KnowledgeVault, "support"),
    reference(ContentOpportunityEvidenceSource.Web, "support-web"),
  ]));
  const contradicted = service.score(aggregate("opportunity-contradicted", "Topic", [
    reference(ContentOpportunityEvidenceSource.KnowledgeVault, "support"),
    reference(ContentOpportunityEvidenceSource.Web, "against", {
      role: ContentOpportunityEvidenceRole.Contradicting,
    }),
  ]));

  assert.ok((scoreOf(supporting, ContentOpportunityScoreFactorId.EvidenceStrength)?.score ?? 0)
    > (scoreOf(contradicted, ContentOpportunityScoreFactorId.EvidenceStrength)?.score ?? 0));
  assert.ok(supporting.totalScore > contradicted.totalScore);
  assert.match(scoreOf(contradicted, ContentOpportunityScoreFactorId.EvidenceStrength)?.explanation ?? "", /contradicting/);
});

test("partial evidence remains uncertain and cannot receive a high-priority score automatically", () => {
  const service = new ContentOpportunityScoringService();
  const result = service.score(aggregate("opportunity-partial", "Partial Topic", [
    reference(ContentOpportunityEvidenceSource.KnowledgeVault, "vault"),
    reference(ContentOpportunityEvidenceSource.Web, "web", {
      sourceQuality: "High",
      evidenceConfidence: "High",
    }),
  ]));

  assert.equal(result.status, ContentOpportunityScoreStatus.Uncertain);
  assert.ok(result.totalScore < 0.75);
  assert.ok(result.uncertaintyReasons.some((reason) => /Partial evidence/.test(reason)));
  assert.ok(result.uncertaintyReasons.some((reason) => /missing/.test(reason)));
  assert.ok(result.uncertaintyPenalty >= 0);
});

test("source diversity and coverage are scored separately from evidence strength", () => {
  const service = new ContentOpportunityScoringService();
  const complete = service.score(aggregate("opportunity-complete", "Topic", [
    reference(ContentOpportunityEvidenceSource.KnowledgeVault, "vault"),
    reference(ContentOpportunityEvidenceSource.ExistingBlog, "blog"),
    reference(ContentOpportunityEvidenceSource.PinterestPerformance, "pin"),
    reference(ContentOpportunityEvidenceSource.Web, "web"),
  ]));
  const narrow = service.score(aggregate("opportunity-narrow", "Topic", [
    reference(ContentOpportunityEvidenceSource.KnowledgeVault, "vault"),
  ]));

  assert.ok((scoreOf(complete, ContentOpportunityScoreFactorId.SourceDiversityCoverage)?.score ?? 0)
    > (scoreOf(narrow, ContentOpportunityScoreFactorId.SourceDiversityCoverage)?.score ?? 0));
  assert.ok((scoreOf(complete, ContentOpportunityScoreFactorId.EvidenceCompleteness)?.score ?? 0)
    > (scoreOf(narrow, ContentOpportunityScoreFactorId.EvidenceCompleteness)?.score ?? 0));
});

test("Pinterest performance factor reports signal availability without inventing magnitude", () => {
  const service = new ContentOpportunityScoringService();
  const withPerformance = service.score(aggregate("opportunity-with-pin", "Topic"));
  const withoutPerformance = service.score(aggregate("opportunity-without-pin", "Topic", [
    reference(ContentOpportunityEvidenceSource.KnowledgeVault, "vault"),
    reference(ContentOpportunityEvidenceSource.ExistingBlog, "blog"),
    reference(ContentOpportunityEvidenceSource.Web, "web"),
  ]));

  assert.equal(scoreOf(withPerformance, ContentOpportunityScoreFactorId.PinterestPerformanceSignal)?.score, 1);
  assert.equal(scoreOf(withoutPerformance, ContentOpportunityScoreFactorId.PinterestPerformanceSignal)?.score, 0);
  assert.match(scoreOf(withPerformance, ContentOpportunityScoreFactorId.PinterestPerformanceSignal)?.explanation ?? "", /does not infer metric magnitude/);
});

test("absence of Existing Blog evidence is an explicit coverage gap, not proof of no blog", () => {
  const service = new ContentOpportunityScoringService();
  const result = service.score(aggregate("opportunity-gap", "Topic", [
    reference(ContentOpportunityEvidenceSource.KnowledgeVault, "vault"),
    reference(ContentOpportunityEvidenceSource.PinterestPerformance, "pin"),
    reference(ContentOpportunityEvidenceSource.Web, "web"),
  ]));

  assert.equal(scoreOf(result, ContentOpportunityScoreFactorId.ContentCoverageGap)?.score, 1);
  assert.match(scoreOf(result, ContentOpportunityScoreFactorId.ContentCoverageGap)?.explanation ?? "", /not proof that no blog exists/);
});

test("ranking is invariant to input order and uses opportunity ID as the explicit tie-break", () => {
  const service = new ContentOpportunityScoringService();
  const firstInput = [
    aggregate("opportunity-z", "Same Topic", []),
    aggregate("opportunity-a", "Same Topic", []),
  ];
  const secondInput = [...firstInput].reverse();
  const first = service.rank(firstInput);
  const second = service.rank(secondInput);

  assert.deepEqual(
    first.map((item) => [item.rank, item.score.opportunityId?.value]),
    [[1, "opportunity-a"], [2, "opportunity-z"]],
  );
  assert.deepEqual(
    second.map((item) => [item.rank, item.score.opportunityId?.value]),
    [[1, "opportunity-a"], [2, "opportunity-z"]],
  );
});

test("score and ranking results are immutable and invalid aggregates are not scored", () => {
  const service = new ContentOpportunityScoringService();
  const result = service.score(aggregate());
  const invalid = service.score(new ContentOpportunityEvidenceAggregator().aggregate(
    target,
    new ContentOpportunityEvidenceIdentity(new ContentOpportunityId("invalid"), "Invalid"),
    [],
  ));

  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.factors), true);
  assert.equal(Object.isFrozen(result.factors[0]), true);
  assert.equal(Object.isFrozen(result.uncertaintyReasons), true);
  assert.throws(() => result.factors.push(result.factors[0]), TypeError);
  assert.equal(invalid.status, ContentOpportunityScoreStatus.Uncertain);
  assert.equal(invalid.totalScore, 0.125);
});

test("scoring exposes no timing, seasonality, or publishing factors", () => {
  const result = new ContentOpportunityScoringService().score(aggregate());
  const ids = result.factors.map((factor) => factor.id).join(" ");

  assert.doesNotMatch(ids, /timing|season|publish|best-time|adaptive/i);
});