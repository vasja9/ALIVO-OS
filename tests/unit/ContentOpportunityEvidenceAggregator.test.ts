import assert from "node:assert/strict";
import { test } from "node:test";
import { BusinessPackageId } from "../../src/intelligence/market/MarketIntelligenceDomain.ts";
import {
  ContentOpportunityEvidenceAggregator,
  ContentOpportunityEvidenceAggregationStatus,
  ContentOpportunityEvidenceIdentity,
  ContentOpportunityScopedEvidence,
} from "../../src/business/content/opportunities/ContentOpportunityEvidenceAggregator.ts";
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
const otherPackageId = new BusinessPackageId("OTHER");
const observedAt = new Date("2026-08-18T12:00:00.000Z");
const opportunityId = new ContentOpportunityId("opportunity-meal-fatigue");
const identity = new ContentOpportunityEvidenceIdentity(opportunityId, "Meal Fatigue");
const target = new ContentOpportunityLanguageMarketPolicyResolver().resolve(
  new BusinessPackageLanguageMarketPolicy({
    businessPackageId: packageId,
    contentWriteLanguage: "de",
    publishingLanguage: "de",
    researchLanguageMode: ResearchLanguageMode.Auto,
    targetMarket: "DE",
  }),
);

const evidence = (
  source: ContentOpportunityEvidenceSource,
  id: string,
  overrides: Partial<ConstructorParameters<typeof ContentOpportunityEvidenceReference>[0]> = {},
): ContentOpportunityEvidenceReference => new ContentOpportunityEvidenceReference({
  businessPackageId: packageId,
  source,
  sourceReference: `${source.toLowerCase()}:source:${id}`,
  evidenceReference: `${source.toLowerCase()}:evidence:${id}`,
  language: "de",
  market: "DE",
  role: ContentOpportunityEvidenceRole.Supporting,
  explanation: `${source} provenance for ${id}`,
  observedAt,
  ...overrides,
});

const allSources = [
  evidence(ContentOpportunityEvidenceSource.KnowledgeVault, "vault"),
  evidence(ContentOpportunityEvidenceSource.ExistingBlog, "blog"),
  evidence(ContentOpportunityEvidenceSource.PinterestPerformance, "pin"),
  evidence(ContentOpportunityEvidenceSource.Web, "web", {
    sourceQuality: "High",
    evidenceConfidence: "Moderate",
  }),
] as const;

const scoped = (
  reference: ContentOpportunityEvidenceReference,
  evidenceIdentity: ContentOpportunityEvidenceIdentity = identity,
): ContentOpportunityScopedEvidence => new ContentOpportunityScopedEvidence(evidenceIdentity, reference);

const allScopedSources = allSources.map((reference) => scoped(reference));

test("aggregates all four normalized sources for one Business Package and target scope", () => {
  const result = new ContentOpportunityEvidenceAggregator().aggregate(target, identity, allScopedSources);

  assert.equal(result.status, ContentOpportunityEvidenceAggregationStatus.Aggregated);
  assert.equal(result.opportunityId, opportunityId);
  assert.equal(result.topic, "meal fatigue");
  assert.equal(result.businessPackageId, packageId);
  assert.equal(result.language, "de");
  assert.equal(result.market, "DE");
  assert.equal(result.evidenceReferences.length, 4);
  assert.equal(result.provenance.length, 4);
  assert.equal(result.sourceDiversity, 4);
  assert.equal(result.supportingEvidenceCount, 4);
  assert.equal(result.contradictingEvidenceCount, 0);
  assert.equal(result.neutralEvidenceCount, 0);
  assert.deepEqual(result.missingSources, []);
  assert.match(result.reason, /no required evidence source is missing/);
});

test("returns a partial explainable aggregate when one or more required sources are missing", () => {
  const result = new ContentOpportunityEvidenceAggregator().aggregate(target, identity, [
    scoped(allSources[0]),
    scoped(allSources[2]),
  ]);

  assert.equal(result.status, ContentOpportunityEvidenceAggregationStatus.Partial);
  assert.equal(result.sourceDiversity, 2);
  assert.deepEqual(result.missingSources, [
    ContentOpportunityEvidenceSource.ExistingBlog,
    ContentOpportunityEvidenceSource.Web,
  ]);
  assert.equal(result.supportingEvidenceCount, 2);
  assert.match(result.reason, /missing sources: ExistingBlog, Web/);
});

test("preserves supporting, contradicting, and neutral role counts", () => {
  const result = new ContentOpportunityEvidenceAggregator().aggregate(target, identity, [
    scoped(evidence(ContentOpportunityEvidenceSource.KnowledgeVault, "support")),
    scoped(evidence(ContentOpportunityEvidenceSource.ExistingBlog, "against", {
      role: ContentOpportunityEvidenceRole.Contradicting,
    })),
    scoped(evidence(ContentOpportunityEvidenceSource.Web, "neutral", {
      role: ContentOpportunityEvidenceRole.Neutral,
    })),
  ]);

  assert.equal(result.supportingEvidenceCount, 1);
  assert.equal(result.contradictingEvidenceCount, 1);
  assert.equal(result.neutralEvidenceCount, 1);
  assert.match(result.reason, /supporting=1, contradicting=1, neutral=1/);
});

test("deduplicates repeated evidence without double-counting or losing provenance", () => {
  const duplicate = evidence(ContentOpportunityEvidenceSource.Web, "same", {
    sourceQuality: "High",
    evidenceConfidence: "High",
  });
  const result = new ContentOpportunityEvidenceAggregator().aggregate(target, identity, [
    scoped(duplicate),
    scoped(evidence(ContentOpportunityEvidenceSource.KnowledgeVault, "unique")),
    scoped(duplicate),
  ]);

  assert.equal(result.status, ContentOpportunityEvidenceAggregationStatus.Partial);
  assert.equal(result.evidenceReferences.length, 2);
  assert.equal(result.provenance.length, 2);
  assert.equal(result.duplicateEvidenceCount, 1);
  assert.deepEqual(result.duplicateEvidenceReferences, ["Web:web:evidence:same"]);
  assert.equal(result.provenance.find((item) => item.source === ContentOpportunityEvidenceSource.Web)?.sourceQuality, "High");
  assert.equal(result.provenance.find((item) => item.source === ContentOpportunityEvidenceSource.Web)?.evidenceConfidence, "High");
});

test("rejects cross-package evidence before producing an aggregate", () => {
  const foreign = evidence(ContentOpportunityEvidenceSource.Web, "foreign", {
    businessPackageId: otherPackageId,
  });
  const result = new ContentOpportunityEvidenceAggregator().aggregate(target, identity, [scoped(foreign)]);

  assert.equal(result.status, ContentOpportunityEvidenceAggregationStatus.Invalid);
  assert.equal(result.evidenceReferences.length, 0);
  assert.match(result.reason, /Business Package boundary/);
});

test("requires explicit opportunity identity and rejects a different opportunity or topic", () => {
  const aggregator = new ContentOpportunityEvidenceAggregator();
  const differentOpportunity = new ContentOpportunityEvidenceIdentity(
    new ContentOpportunityId("opportunity-other"),
    "Meal Fatigue",
  );
  const differentTopic = new ContentOpportunityEvidenceIdentity(opportunityId, "Sleep Routine");

  const missingIdentity = aggregator.aggregate(
    target,
    undefined as unknown as ContentOpportunityEvidenceIdentity,
    allScopedSources,
  );
  const opportunityMismatch = aggregator.aggregate(
    target,
    identity,
    [scoped(allSources[0], differentOpportunity)],
  );
  const topicMismatch = aggregator.aggregate(
    target,
    identity,
    [scoped(allSources[0], differentTopic)],
  );

  assert.equal(missingIdentity.status, ContentOpportunityEvidenceAggregationStatus.Invalid);
  assert.match(missingIdentity.reason, /Explicit opportunity identity is required/);
  assert.equal(opportunityMismatch.status, ContentOpportunityEvidenceAggregationStatus.Invalid);
  assert.match(opportunityMismatch.reason, /belongs to opportunity/);
  assert.equal(topicMismatch.status, ContentOpportunityEvidenceAggregationStatus.Invalid);
  assert.match(topicMismatch.reason, /belongs to topic/);
});

test("rejects evidence from a different target language or market", () => {
  const wrongLanguage = evidence(ContentOpportunityEvidenceSource.ExistingBlog, "wrong-language", {
    language: "fr",
  });
  const wrongMarket = evidence(ContentOpportunityEvidenceSource.PinterestPerformance, "wrong-market", {
    market: "FR",
  });
  const aggregator = new ContentOpportunityEvidenceAggregator();

  assert.equal(aggregator.aggregate(target, identity, [scoped(wrongLanguage)]).status, ContentOpportunityEvidenceAggregationStatus.Invalid);
  assert.equal(aggregator.aggregate(target, identity, [scoped(wrongMarket)]).status, ContentOpportunityEvidenceAggregationStatus.Invalid);
});

test("allows explicitly marked cross-language Web research for the same target scope", () => {
  const crossLanguage = evidence(ContentOpportunityEvidenceSource.Web, "cross-language", {
    researchLanguage: "fr",
    crossLanguageResearch: true,
    sourceQuality: "High",
    evidenceConfidence: "Moderate",
  });
  const result = new ContentOpportunityEvidenceAggregator().aggregate(target, identity, [scoped(crossLanguage)]);

  assert.equal(result.status, ContentOpportunityEvidenceAggregationStatus.Partial);
  assert.equal(result.evidenceReferences[0]?.language, "de");
  assert.equal(result.evidenceReferences[0]?.market, "DE");
  assert.equal(result.provenance[0]?.researchLanguage, "fr");
  assert.equal(result.provenance[0]?.crossLanguageResearch, true);
});

test("is deterministic, immutable, and preserves sorted provenance order", () => {
  const aggregator = new ContentOpportunityEvidenceAggregator();
  const first = aggregator.aggregate(target, identity, [...allScopedSources].reverse());
  const second = aggregator.aggregate(target, identity, allScopedSources);

  assert.deepEqual(
    [
      first.status,
      first.evidenceReferences.map((item) => item.evidenceReference),
      first.provenance,
      first.reason,
    ],
    [
      second.status,
      second.evidenceReferences.map((item) => item.evidenceReference),
      second.provenance,
      second.reason,
    ],
  );
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.evidenceReferences), true);
  assert.equal(Object.isFrozen(first.provenance), true);
  assert.equal(Object.isFrozen(first.provenance[0]), true);
  assert.throws(() => first.missingSources.push(ContentOpportunityEvidenceSource.Web), TypeError);
  assert.throws(() => first.duplicateEvidenceReferences.push("mutation"), TypeError);
});

test("exposes only a read-only aggregation boundary", () => {
  assert.deepEqual(
    Object.getOwnPropertyNames(Object.getPrototypeOf(new ContentOpportunityEvidenceAggregator())),
    ["constructor", "aggregate"],
  );
});