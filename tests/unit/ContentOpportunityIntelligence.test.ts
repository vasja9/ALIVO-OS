import assert from "node:assert/strict";
import { test } from "node:test";
import { BusinessPackageId } from "../../src/intelligence/market/MarketIntelligenceDomain.ts";
import {
  CONTENT_OPPORTUNITY_BATCH_VIOLATIONS_CODE,
  CONTENT_OPPORTUNITY_INVALID_CODE,
  ContentOpportunityBatchEvaluationResult,
  ContentOpportunityCandidate,
  ContentOpportunityCrossPackageViolation,
  ContentOpportunityCrossScopeViolation,
  ContentOpportunityDestination,
  ContentOpportunityDestinationType,
  ContentOpportunityEvidenceReference,
  ContentOpportunityEvidenceRole,
  ContentOpportunityEvidenceSource,
  ContentOpportunityId,
  ContentOpportunityIntelligenceException,
  ContentOpportunityStatus,
  ContentOpportunityTarget,
} from "../../src/business/content/opportunities/ContentOpportunityIntelligenceDomain.ts";
import {
  BusinessPackageLanguageMarketPolicy,
  ResearchLanguageMode,
} from "../../src/business/content/opportunities/LanguageMarketPolicy.ts";
import {
  ContentOpportunityEvaluationService,
  QUALIFIED_SCORE_THRESHOLD,
} from "../../src/business/content/opportunities/ContentOpportunityEvaluationService.ts";
import {
  KnowledgeVaultContentOpportunityEvidenceAdapter,
  KnowledgeVaultEvidenceNormalizationStatus,
} from "../../src/business/content/opportunities/KnowledgeVaultContentOpportunityEvidenceAdapter.ts";
import {
  ExistingBlogContentOpportunityEvidenceAdapter,
  ExistingBlogEvidenceNormalizationStatus,
  ExistingBlogEvidenceStatus,
  ExistingBlogEvidenceValidity,
} from "../../src/business/content/opportunities/ExistingBlogContentOpportunityEvidenceAdapter.ts";
import {
  WebResearchContentOpportunityEvidenceAdapter,
  WebResearchEvidenceConfidence,
  WebResearchEvidenceNormalizationStatus,
  WebResearchEvidenceStatus,
  WebResearchEvidenceValidity,
  WebResearchSourceQuality,
} from "../../src/business/content/opportunities/WebResearchContentOpportunityEvidenceAdapter.ts";
import { KnowledgeItem } from "../../src/business/knowledge/KnowledgeItem.ts";
import { KnowledgeItemId } from "../../src/business/knowledge/KnowledgeItemId.ts";
import { KnowledgeItemType } from "../../src/business/knowledge/KnowledgeItemType.ts";
import { KnowledgeSource } from "../../src/business/knowledge/KnowledgeSource.ts";
import { KnowledgeStatus } from "../../src/business/knowledge/KnowledgeStatus.ts";

const packageId = new BusinessPackageId("ALIVO");
const createdAt = new Date("2026-08-18T10:00:00.000Z");
const evaluatedAt = new Date("2026-08-18T12:00:00.000Z");
const dePolicy = new BusinessPackageLanguageMarketPolicy({
  businessPackageId: packageId,
  targetMarket: "DE",
  contentWriteLanguage: "de",
  publishingLanguage: "de",
  researchLanguageMode: ResearchLanguageMode.Auto,
});

function evidence(
  id: string,
  source: ContentOpportunityEvidenceSource,
  role = ContentOpportunityEvidenceRole.Supporting,
  evidencePackageId = packageId,
): ContentOpportunityEvidenceReference {
  return new ContentOpportunityEvidenceReference({
    businessPackageId: evidencePackageId,
    source,
    sourceReference: `${source.toLowerCase()}:source-${id}`,
    evidenceReference: `${source.toLowerCase()}:evidence-${id}`,
    language: "de",
    market: "DE",
    role,
    explanation: `${source} evidence for ${id}`,
    observedAt: createdAt,
  });
}

function candidate(
  id = "opportunity-1",
  evidenceReferences: readonly ContentOpportunityEvidenceReference[] = [
    evidence("one", ContentOpportunityEvidenceSource.KnowledgeVault),
    evidence("two", ContentOpportunityEvidenceSource.ExistingBlog),
  ],
  status = ContentOpportunityStatus.Candidate,
): ContentOpportunityCandidate {
  return ContentOpportunityCandidate.fromPolicy(dePolicy, {
    id: new ContentOpportunityId(id),
    target: ContentOpportunityTarget.Blog,
    topic: "meal-related fatigue",
    destination: new ContentOpportunityDestination(ContentOpportunityDestinationType.Book, "book:alivo-health"),
    contentReference: "knowledge:question-cluster:meal-fatigue",
    evidenceReferences,
    status,
    createdAt,
  });
}

test("candidate models future Blog or Pin work with destination and source/evidence lineage", () => {
  const blog = candidate();
  const pin = ContentOpportunityCandidate.fromPolicy(dePolicy, {
    id: new ContentOpportunityId("pin-opportunity"),
    target: ContentOpportunityTarget.Pin,
    topic: blog.topic,
    destination: new ContentOpportunityDestination(ContentOpportunityDestinationType.ContentReference, "blog:article-42"),
    contentReference: blog.contentReference,
    evidenceReferences: blog.evidenceReferences,
    createdAt: blog.createdAt,
  });

  assert.equal(blog.target, ContentOpportunityTarget.Blog);
  assert.equal(pin.target, ContentOpportunityTarget.Pin);
  assert.equal(blog.language, "de");
  assert.equal(blog.market, "DE");
  assert.equal(blog.destination.reference, "book:alivo-health");
  assert.equal(blog.contentReference, "knowledge:question-cluster:meal-fatigue");
  assert.equal(blog.evidenceReferences[0]?.source, ContentOpportunityEvidenceSource.KnowledgeVault);
  assert.equal(blog.evidenceReferences[0]?.evidenceReference, "knowledgevault:evidence-one");
  assert.equal(Object.isFrozen(blog), true);
  assert.equal(Object.isFrozen(blog.evidenceReferences), true);
  assert.equal("timing" in blog.properties, false);
  assert.equal("seasonal" in blog.properties, false);
  assert.equal("trend" in blog.properties, false);
});

test("candidate and evidence references validate required scope and remain immutable", () => {
  assert.throws(() => new ContentOpportunityId(""), /must not be empty/);
  assert.throws(() => new ContentOpportunityDestination(ContentOpportunityDestinationType.Url, ""), /must not be empty/);
  assert.throws(() => new ContentOpportunityEvidenceReference({
    businessPackageId: packageId,
    source: ContentOpportunityEvidenceSource.Web,
    sourceReference: "web:source",
    evidenceReference: " ",
    language: "de",
    market: "DE",
  }), /must not be empty/);
  const reference = evidence("immutable", ContentOpportunityEvidenceSource.KnowledgeVault);
  assert.equal(Object.isFrozen(reference.properties), true);
  assert.throws(() => reference.properties.sourceReference = "mutated", TypeError);
  assert.throws(() => candidate("missing-topic", []).properties.topic = "", TypeError);

  const exposedDate = candidate().createdAt;
  exposedDate.setUTCFullYear(1999);
  assert.equal(candidate().createdAt.toISOString(), createdAt.toISOString());
});

test("read-only evaluation produces deterministic, explainable factors without execution authority", () => {
  const service = new ContentOpportunityEvaluationService();
  const evaluation = service.evaluate(candidate(), evaluatedAt);

  assert.equal(evaluation.status, ContentOpportunityStatus.Qualified);
  assert.equal(evaluation.score, 1);
  assert.equal(evaluation.confidence.value, evaluation.score);
  assert.equal(evaluation.factors.length, 5);
  assert.ok(evaluation.factors.every((factor) => factor.properties.explanation.length > 0));
  assert.equal(evaluation.supportingEvidenceCount, 2);
  assert.equal(evaluation.contradictingEvidenceCount, 0);
  assert.match(evaluation.explanation, /qualified/i);
  assert.deepEqual(
    Object.getOwnPropertyNames(Object.getPrototypeOf(service)).filter((name) => /schedule|publish|generate|write|crawl/i.test(name)),
    [],
  );
});

test("missing and contradicting evidence remain explicit rather than becoming automatic creation", () => {
  const service = new ContentOpportunityEvaluationService();
  const research = service.evaluate(candidate("research", [], ContentOpportunityStatus.Candidate), evaluatedAt);
  const rejected = service.evaluate(candidate("rejected", [
    evidence("support", ContentOpportunityEvidenceSource.KnowledgeVault),
    evidence("against", ContentOpportunityEvidenceSource.Web, ContentOpportunityEvidenceRole.Contradicting),
  ]), evaluatedAt);

  assert.equal(research.status, ContentOpportunityStatus.ResearchRequired);
  assert.equal(research.supportingEvidenceCount, 0);
  assert.equal(rejected.status, ContentOpportunityStatus.Rejected);
  assert.match(rejected.explanation, /Contradicting evidence/i);
});

test("evaluation supports future evidence adapters and preserves deferred state", () => {
  const service = new ContentOpportunityEvaluationService();
  const futureSources = [
    evidence("vault", ContentOpportunityEvidenceSource.KnowledgeVault),
    evidence("blog", ContentOpportunityEvidenceSource.ExistingBlog),
    evidence("pinterest", ContentOpportunityEvidenceSource.PinterestPerformance),
    evidence("web", ContentOpportunityEvidenceSource.Web),
  ];
  const result = service.evaluateMany([
    candidate("future-sources", futureSources),
    candidate("deferred", futureSources, ContentOpportunityStatus.Deferred),
  ], evaluatedAt);

  assert.ok(result instanceof ContentOpportunityBatchEvaluationResult);
  assert.equal(result.evaluations.length, 2);
  assert.equal(result.violations.length, 0);
  assert.equal(result.hasViolations, false);
  assert.equal(result.evaluations[0]?.status, ContentOpportunityStatus.Qualified);
  assert.equal(result.evaluations[1]?.status, ContentOpportunityStatus.Deferred);
  assert.equal(Object.isFrozen(result.evaluations), true);
  assert.equal(Object.isFrozen(result.violations), true);
});

test("evaluation time cannot precede candidate creation", () => {
  assert.throws(
    () => new ContentOpportunityEvaluationService().evaluate(candidate(), new Date("2026-08-18T09:59:59.000Z")),
    (error) => error instanceof ContentOpportunityIntelligenceException
      && /precede candidate creation/.test(error.message),
  );
});

test("evaluation rejects a candidate whose evidence references belong to a different Business Package", () => {
  const foreignPackageId = new BusinessPackageId("FOREIGN");
  const crossPackageEvidence = evidence("cross", ContentOpportunityEvidenceSource.KnowledgeVault, ContentOpportunityEvidenceRole.Supporting, foreignPackageId);
  const misScoped = candidate("mis-scoped", [crossPackageEvidence]);

  assert.throws(
    () => new ContentOpportunityEvaluationService().evaluate(misScoped, evaluatedAt),
    (error) => error instanceof ContentOpportunityIntelligenceException
      && /Business Package/.test(error.message),
  );
});

test("evaluate names both the evidence scope and the candidate scope in the cross-scope exception message", () => {
  const crossScopeEvidence = new ContentOpportunityEvidenceReference({
    businessPackageId: packageId,
    source: ContentOpportunityEvidenceSource.Web,
    sourceReference: "web:source-fr",
    evidenceReference: "web:evidence-fr",
    language: "fr",
    market: "FR",
    role: ContentOpportunityEvidenceRole.Supporting,
  });

  const crossScopeCandidate = candidate("cross-scope-evaluate", [crossScopeEvidence]);

  assert.throws(
    () => new ContentOpportunityEvaluationService().evaluate(crossScopeCandidate, evaluatedAt),
    (error) =>
      error instanceof ContentOpportunityIntelligenceException
      && /fr\/FR/.test(error.message)
      && /de\/DE/.test(error.message)
      && error.message.includes(crossScopeEvidence.sourceReference),
  );
});

test("evaluate names the offending sourceReference in the cross-scope exception message", () => {
  const distinctSourceRef = "web:distinctive-source-ref-42";
  const crossScopeEvidence = new ContentOpportunityEvidenceReference({
    businessPackageId: packageId,
    source: ContentOpportunityEvidenceSource.Web,
    sourceReference: distinctSourceRef,
    evidenceReference: "web:evidence-fr",
    language: "fr",
    market: "FR",
    role: ContentOpportunityEvidenceRole.Supporting,
  });

  const crossScopeCandidate = candidate("cross-scope-source-ref", [crossScopeEvidence]);

  assert.throws(
    () => new ContentOpportunityEvaluationService().evaluate(crossScopeCandidate, evaluatedAt),
    (error) =>
      error instanceof ContentOpportunityIntelligenceException
      && error.message.includes(distinctSourceRef),
  );
});

test("evaluate cross-scope exception message matches exact format with sourceReference, evidence scope, and candidate scope in that order", () => {
  const crossScopeEvidence = new ContentOpportunityEvidenceReference({
    businessPackageId: packageId,
    source: ContentOpportunityEvidenceSource.Web,
    sourceReference: "web:source-fr",
    evidenceReference: "web:evidence-fr",
    language: "fr",
    market: "FR",
    role: ContentOpportunityEvidenceRole.Supporting,
  });

  const crossScopeCandidate = candidate("cross-scope-format", [crossScopeEvidence]);

  assert.throws(
    () => new ContentOpportunityEvaluationService().evaluate(crossScopeCandidate, evaluatedAt),
    (error) => {
      assert.ok(error instanceof ContentOpportunityIntelligenceException);
      assert.equal(
        error.message,
        `Evidence reference "web:source-fr" belongs to language/market "fr/FR" but candidate is scoped to "de/DE"`,
      );
      return true;
    },
  );
});

test("evaluate cross-package exception message matches exact format with sourceReference, evidence package, and candidate package in that order", () => {
  const foreignPackageId = new BusinessPackageId("FOREIGN");
  const crossPackageEvidence = evidence(
    "cross-package-format",
    ContentOpportunityEvidenceSource.Web,
    ContentOpportunityEvidenceRole.Supporting,
    foreignPackageId,
  );
  const crossPackageCandidate = candidate("cross-package-format", [crossPackageEvidence]);

  assert.throws(
    () => new ContentOpportunityEvaluationService().evaluate(crossPackageCandidate, evaluatedAt),
    (error) => {
      assert.ok(error instanceof ContentOpportunityIntelligenceException);
      assert.equal(
        error.message,
        `Evidence reference "web:source-cross-package-format" belongs to Business Package "FOREIGN" but candidate belongs to "ALIVO"`,
      );
      return true;
    },
  );
});

test("evaluateMany separates a mis-scoped candidate into violations without discarding well-scoped candidates", () => {
  const service = new ContentOpportunityEvaluationService();
  const foreignPackageId = new BusinessPackageId("FOREIGN");
  const wellScoped = candidate("well-scoped");
  const crossEvidence = evidence("cross", ContentOpportunityEvidenceSource.KnowledgeVault, ContentOpportunityEvidenceRole.Supporting, foreignPackageId);
  const misScoped = candidate("mis-scoped", [crossEvidence]);

  const result = service.evaluateMany([wellScoped, misScoped], evaluatedAt);

  assert.ok(result instanceof ContentOpportunityBatchEvaluationResult);
  assert.equal(result.evaluations.length, 1);
  assert.equal(result.evaluations[0]?.candidateId.value, "well-scoped");
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0]?.candidateId.value, "mis-scoped");
  assert.equal(result.violations[0]?.sourceReference, crossEvidence.sourceReference);
  assert.equal(result.violations[0]?.evidencePackageId.value, "FOREIGN");
  assert.equal(result.violations[0]?.candidatePackageId.value, packageId.value);
  assert.ok(result.violations[0]?.detail.includes("mis-scoped"));
  assert.ok(result.violations[0]?.detail.includes("FOREIGN"));
  assert.equal(result.hasViolations, true);
});

test("evaluateMany quarantines the whole candidate when it carries both valid-package and cross-package evidence rather than scoring on the valid subset", () => {
  const service = new ContentOpportunityEvaluationService();
  const foreignPackageId = new BusinessPackageId("FOREIGN");

  // One correctly-stamped reference from the candidate's own package
  const validEvidence = evidence("valid", ContentOpportunityEvidenceSource.KnowledgeVault);
  // One reference stamped with a different Business Package
  const crossPackageEvidence = evidence("cross", ContentOpportunityEvidenceSource.ExistingBlog, ContentOpportunityEvidenceRole.Supporting, foreignPackageId);

  const mixedCandidate = candidate("mixed-package", [validEvidence, crossPackageEvidence]);

  const result = service.evaluateMany([mixedCandidate], evaluatedAt);

  // The whole candidate must be quarantined — not partially scored
  assert.equal(result.evaluations.length, 0, "candidate with cross-package evidence must not appear in evaluations");
  assert.equal(result.violations.length, 1, "candidate must produce exactly one violation");
  assert.equal(result.hasViolations, true);

  const violation = result.violations[0];
  assert.equal(violation?.kind, "cross-package", "violation must be a cross-package violation");
  assert.equal(violation?.candidateId.value, "mixed-package");

  // The violation must name the offending reference, not the valid one
  assert.equal(violation.sourceReference, crossPackageEvidence.sourceReference,
    "violation must name the cross-package reference, not the valid-package reference");
  assert.notEqual(violation.sourceReference, validEvidence.sourceReference,
    "violation must not name the valid-package reference");
  assert.equal(violation.evidencePackageId.value, "FOREIGN");
  assert.equal(violation.candidatePackageId.value, packageId.value);
});

test("evaluateMany emits one cross-package violation per offending reference on a candidate, not just the first", () => {
  const service = new ContentOpportunityEvaluationService();
  const foreignPackageIdA = new BusinessPackageId("FOREIGN-A");
  const foreignPackageIdB = new BusinessPackageId("FOREIGN-B");

  // Two evidence references on the same candidate, each stamped with a different wrong Business Package
  const crossPackageEvidenceA = evidence(
    "cross-pkg-a",
    ContentOpportunityEvidenceSource.KnowledgeVault,
    ContentOpportunityEvidenceRole.Supporting,
    foreignPackageIdA,
  );
  const crossPackageEvidenceB = evidence(
    "cross-pkg-b",
    ContentOpportunityEvidenceSource.ExistingBlog,
    ContentOpportunityEvidenceRole.Supporting,
    foreignPackageIdB,
  );

  const multiCrossPackage = candidate("multi-cross-package", [crossPackageEvidenceA, crossPackageEvidenceB]);
  const wellScoped = candidate("well-scoped");

  const result = service.evaluateMany([wellScoped, multiCrossPackage], evaluatedAt);

  // The well-scoped candidate must still be evaluated
  assert.equal(result.evaluations.length, 1, "well-scoped candidate must still be evaluated");
  assert.equal(result.evaluations[0]?.candidateId.value, "well-scoped");

  // The multi-cross-package candidate must be quarantined entirely
  assert.equal(result.violations.length, 2, "each offending cross-package reference must produce a separate violation");
  assert.equal(result.hasViolations, true);

  const pkgViolations = result.violations.filter(
    (v) => v.kind === "cross-package",
  ) as ContentOpportunityCrossPackageViolation[];
  assert.equal(pkgViolations.length, 2, "both cross-package references must surface as cross-package violations");

  const violationA = pkgViolations.find((v) => v.sourceReference === crossPackageEvidenceA.sourceReference);
  const violationB = pkgViolations.find((v) => v.sourceReference === crossPackageEvidenceB.sourceReference);

  assert.ok(violationA !== undefined, "first offending reference must produce its own violation");
  assert.equal(violationA.candidateId.value, "multi-cross-package");
  assert.equal(violationA.evidencePackageId.value, "FOREIGN-A");
  assert.equal(violationA.candidatePackageId.value, packageId.value);

  assert.ok(violationB !== undefined, "second offending reference must produce its own violation, not be silently discarded");
  assert.equal(violationB.candidateId.value, "multi-cross-package");
  assert.equal(violationB.evidencePackageId.value, "FOREIGN-B");
  assert.equal(violationB.candidatePackageId.value, packageId.value);
});

test("evaluateMany collects all cross-package violations in a batch without stopping at the first", () => {
  const service = new ContentOpportunityEvaluationService();
  const foreignPackageId = new BusinessPackageId("FOREIGN");

  const wellScoped = candidate("well-scoped");
  const misScoped1 = candidate("mis-scoped-1", [
    evidence("cross-a", ContentOpportunityEvidenceSource.KnowledgeVault, ContentOpportunityEvidenceRole.Supporting, foreignPackageId),
  ]);
  const misScoped2 = candidate("mis-scoped-2", [
    evidence("cross-b", ContentOpportunityEvidenceSource.ExistingBlog, ContentOpportunityEvidenceRole.Supporting, foreignPackageId),
  ]);

  const result = service.evaluateMany([wellScoped, misScoped1, misScoped2], evaluatedAt);

  assert.ok(result instanceof ContentOpportunityBatchEvaluationResult);
  assert.equal(result.evaluations.length, 1);
  assert.equal(result.evaluations[0]?.candidateId.value, "well-scoped");
  assert.equal(result.violations.length, 2);
  assert.ok(result.violations.some((v) => v.candidateId.value === "mis-scoped-1"));
  assert.ok(result.violations.some((v) => v.candidateId.value === "mis-scoped-2"));
  assert.equal(result.hasViolations, true);
  assert.equal(Object.isFrozen(result.evaluations), true);
  assert.equal(Object.isFrozen(result.violations), true);
});

test("evaluateMany mixed batch routes valid candidates to evaluations and mis-scoped candidates to violations", () => {
  const service = new ContentOpportunityEvaluationService();
  const foreignPackageId = new BusinessPackageId("FOREIGN");

  const candidates = [
    candidate("valid-1"),
    candidate("valid-2", [evidence("e2", ContentOpportunityEvidenceSource.ExistingBlog)]),
    candidate("mis-scoped-a", [evidence("ea", ContentOpportunityEvidenceSource.KnowledgeVault, ContentOpportunityEvidenceRole.Supporting, foreignPackageId)]),
    candidate("valid-3", [evidence("e3", ContentOpportunityEvidenceSource.Web)]),
    candidate("mis-scoped-b", [evidence("eb", ContentOpportunityEvidenceSource.PinterestPerformance, ContentOpportunityEvidenceRole.Supporting, foreignPackageId)]),
  ];

  const result = service.evaluateMany(candidates, evaluatedAt);

  assert.equal(result.evaluations.length, 3);
  assert.equal(result.violations.length, 2);
  assert.ok(result.evaluations.every((e) => ["valid-1", "valid-2", "valid-3"].includes(e.candidateId.value)));
  assert.ok(result.violations.every((v) => ["mis-scoped-a", "mis-scoped-b"].includes(v.candidateId.value)));
  assert.ok(result.violations.every((v) => (v as { evidencePackageId: BusinessPackageId }).evidencePackageId.value === "FOREIGN"));
});

test("evaluateMany routes a candidate with wrong-language evidence to violations rather than throwing", () => {
  const service = new ContentOpportunityEvaluationService();

  // Candidate is scoped to de/DE; this evidence reference carries fr/FR
  const wrongLanguageEvidence = new ContentOpportunityEvidenceReference({
    businessPackageId: packageId,
    source: ContentOpportunityEvidenceSource.Web,
    sourceReference: "web:source-fr",
    evidenceReference: "web:evidence-fr",
    language: "fr",
    market: "FR",
    role: ContentOpportunityEvidenceRole.Supporting,
  });

  const wellScoped = candidate("well-scoped");
  const crossScope = candidate("cross-scope-lang", [wrongLanguageEvidence]);

  const result = service.evaluateMany([wellScoped, crossScope], evaluatedAt);

  assert.ok(result instanceof ContentOpportunityBatchEvaluationResult);
  assert.equal(result.evaluations.length, 1);
  assert.equal(result.evaluations[0]?.candidateId.value, "well-scoped");
  assert.equal(result.violations.length, 1);
  const violation = result.violations[0];
  assert.equal(violation?.kind, "cross-scope");
  assert.equal(violation?.candidateId.value, "cross-scope-lang");
  assert.equal(violation.sourceReference, wrongLanguageEvidence.sourceReference);
  assert.equal(violation.evidenceLanguage, "fr");
  assert.equal(violation.evidenceMarket, "FR");
  assert.equal(violation.candidateLanguage, "de");
  assert.equal(violation.candidateMarket, "DE");
  assert.ok(violation.detail.includes("cross-scope-lang"));
  assert.ok(violation.detail.includes("fr/FR"));
  assert.ok(violation.detail.includes("de/DE"));
  assert.equal(result.hasViolations, true);
});

test("evaluateMany routes a candidate with wrong-market evidence to violations rather than throwing", () => {
  const service = new ContentOpportunityEvaluationService();

  // Candidate is scoped to de/DE; this evidence reference shares language but wrong market
  const wrongMarketEvidence = new ContentOpportunityEvidenceReference({
    businessPackageId: packageId,
    source: ContentOpportunityEvidenceSource.ExistingBlog,
    sourceReference: "blog:source-at",
    evidenceReference: "blog:evidence-at",
    language: "de",
    market: "AT",
    role: ContentOpportunityEvidenceRole.Supporting,
  });

  const crossScope = candidate("cross-scope-market", [wrongMarketEvidence]);

  const result = service.evaluateMany([crossScope], evaluatedAt);

  assert.equal(result.evaluations.length, 0);
  assert.equal(result.violations.length, 1);
  const violation = result.violations[0];
  assert.equal(violation?.kind, "cross-scope");
  assert.equal(violation?.candidateId.value, "cross-scope-market");
  assert.equal(violation.evidenceMarket, "AT");
  assert.equal(violation.candidateMarket, "DE");
  assert.ok(violation.detail.includes("de/AT"));
  assert.ok(violation.detail.includes("de/DE"));
  assert.equal(result.hasViolations, true);
});

test("evaluateMany emits one cross-scope violation per offending reference on a candidate, not just the first", () => {
  const service = new ContentOpportunityEvaluationService();

  // Two evidence references on the same candidate, each with a different wrong scope
  const frEvidence = new ContentOpportunityEvidenceReference({
    businessPackageId: packageId,
    source: ContentOpportunityEvidenceSource.Web,
    sourceReference: "web:source-fr",
    evidenceReference: "web:evidence-fr",
    language: "fr",
    market: "FR",
    role: ContentOpportunityEvidenceRole.Supporting,
  });
  const enEvidence = new ContentOpportunityEvidenceReference({
    businessPackageId: packageId,
    source: ContentOpportunityEvidenceSource.ExistingBlog,
    sourceReference: "blog:source-en",
    evidenceReference: "blog:evidence-en",
    language: "en",
    market: "GB",
    role: ContentOpportunityEvidenceRole.Supporting,
  });

  // Candidate is scoped to de/DE but carries both fr/FR and en/GB evidence
  const multiCrossScope = candidate("multi-cross-scope", [frEvidence, enEvidence]);
  const wellScoped = candidate("well-scoped");

  const result = service.evaluateMany([wellScoped, multiCrossScope], evaluatedAt);

  // The well-scoped candidate must still be evaluated
  assert.equal(result.evaluations.length, 1);
  assert.equal(result.evaluations[0]?.candidateId.value, "well-scoped");

  // Both cross-scope references must produce their own violation — not just the first
  assert.equal(result.violations.length, 2, "each offending evidence reference must produce a separate violation");
  const scopeViolations = result.violations.filter((v) => v.kind === "cross-scope") as ContentOpportunityCrossScopeViolation[];
  assert.equal(scopeViolations.length, 2);

  const frViolation = scopeViolations.find((v) => v.sourceReference === frEvidence.sourceReference);
  const enViolation = scopeViolations.find((v) => v.sourceReference === enEvidence.sourceReference);

  assert.ok(frViolation !== undefined, "fr/FR evidence must produce its own violation");
  assert.equal(frViolation.candidateId.value, "multi-cross-scope");
  assert.equal(frViolation.evidenceLanguage, "fr");
  assert.equal(frViolation.evidenceMarket, "FR");
  assert.equal(frViolation.candidateLanguage, "de");
  assert.equal(frViolation.candidateMarket, "DE");

  assert.ok(enViolation !== undefined, "en/GB evidence must produce its own violation");
  assert.equal(enViolation.candidateId.value, "multi-cross-scope");
  assert.equal(enViolation.evidenceLanguage, "en");
  assert.equal(enViolation.evidenceMarket, "GB");

  assert.equal(result.hasViolations, true);
});

test("evaluateMany mixed batch with both cross-package and cross-scope candidates separates all violations correctly alongside well-scoped evaluations", () => {
  const service = new ContentOpportunityEvaluationService();
  const foreignPackageId = new BusinessPackageId("FOREIGN");

  const wrongLanguageEvidence = new ContentOpportunityEvidenceReference({
    businessPackageId: packageId,
    source: ContentOpportunityEvidenceSource.Web,
    sourceReference: "web:source-en",
    evidenceReference: "web:evidence-en",
    language: "en",
    market: "GB",
    role: ContentOpportunityEvidenceRole.Supporting,
  });

  const crossPackageEvidence = new ContentOpportunityEvidenceReference({
    businessPackageId: foreignPackageId,
    source: ContentOpportunityEvidenceSource.KnowledgeVault,
    sourceReference: "knowledgevault:source-foreign",
    evidenceReference: "knowledgevault:evidence-foreign",
    language: "de",
    market: "DE",
    role: ContentOpportunityEvidenceRole.Supporting,
  });

  const wellScoped1 = candidate("valid-1");
  const wellScoped2 = candidate("valid-2", [evidence("e2", ContentOpportunityEvidenceSource.ExistingBlog)]);
  const crossPackageCandidate = candidate("cross-package", [crossPackageEvidence]);
  const crossScopeCandidate = candidate("cross-scope", [wrongLanguageEvidence]);

  const result = service.evaluateMany(
    [wellScoped1, crossPackageCandidate, wellScoped2, crossScopeCandidate],
    evaluatedAt,
  );

  assert.ok(result instanceof ContentOpportunityBatchEvaluationResult);
  assert.equal(result.evaluations.length, 2);
  assert.equal(result.violations.length, 2);
  assert.ok(result.evaluations.every((e) => ["valid-1", "valid-2"].includes(e.candidateId.value)));

  const pkgViolation = result.violations.find((v) => v.candidateId.value === "cross-package");
  const scopeViolation = result.violations.find((v) => v.candidateId.value === "cross-scope");

  assert.equal(pkgViolation?.kind, "cross-package", "cross-package candidate must produce a cross-package violation");
  assert.equal(scopeViolation?.kind, "cross-scope", "cross-scope candidate must produce a cross-scope violation");
  assert.equal((pkgViolation as ContentOpportunityCrossPackageViolation).evidencePackageId.value, "FOREIGN");
  assert.equal((scopeViolation as ContentOpportunityCrossScopeViolation).evidenceLanguage, "en");
  assert.equal(result.hasViolations, true);
  assert.equal(Object.isFrozen(result.evaluations), true);
  assert.equal(Object.isFrozen(result.violations), true);
});

test("evaluateMany surfaces both cross-package and cross-scope violations for a single candidate that carries both offender kinds", () => {
  const service = new ContentOpportunityEvaluationService();
  const foreignPackageId = new BusinessPackageId("FOREIGN");

  // One evidence reference from a wrong Business Package (cross-package offender)
  const crossPackageEvidence = new ContentOpportunityEvidenceReference({
    businessPackageId: foreignPackageId,
    source: ContentOpportunityEvidenceSource.KnowledgeVault,
    sourceReference: "knowledgevault:source-foreign-pkg",
    evidenceReference: "knowledgevault:evidence-foreign-pkg",
    language: "de",
    market: "DE",
    role: ContentOpportunityEvidenceRole.Supporting,
  });

  // One evidence reference from the correct package but the wrong language/market (cross-scope offender)
  const crossScopeEvidence = new ContentOpportunityEvidenceReference({
    businessPackageId: packageId,
    source: ContentOpportunityEvidenceSource.Web,
    sourceReference: "web:source-wrong-scope",
    evidenceReference: "web:evidence-wrong-scope",
    language: "en",
    market: "GB",
    role: ContentOpportunityEvidenceRole.Supporting,
  });

  // A single candidate that carries both offender kinds
  const mixedOffenderCandidate = candidate("mixed-offender", [crossPackageEvidence, crossScopeEvidence]);

  const result = service.evaluateMany([mixedOffenderCandidate], evaluatedAt);

  // Candidate must be fully quarantined — no evaluations produced
  assert.equal(result.evaluations.length, 0, "candidate with both violation kinds must not appear in evaluations");

  // Both violation kinds must surface
  assert.equal(result.violations.length, 2, "one violation per offending reference must be emitted");
  assert.equal(result.hasViolations, true);

  const pkgViolation = result.violations.find((v) => v.kind === "cross-package") as ContentOpportunityCrossPackageViolation | undefined;
  const scopeViolation = result.violations.find((v) => v.kind === "cross-scope") as ContentOpportunityCrossScopeViolation | undefined;

  assert.ok(pkgViolation !== undefined, "a cross-package violation must be present");
  assert.equal(pkgViolation.candidateId.value, "mixed-offender");
  assert.equal(pkgViolation.sourceReference, crossPackageEvidence.sourceReference, "cross-package violation must name the offending cross-package reference");
  assert.equal(pkgViolation.evidencePackageId.value, "FOREIGN");
  assert.equal(pkgViolation.candidatePackageId.value, packageId.value);

  assert.ok(scopeViolation !== undefined, "a cross-scope violation must be present");
  assert.equal(scopeViolation.candidateId.value, "mixed-offender");
  assert.equal(scopeViolation.sourceReference, crossScopeEvidence.sourceReference, "cross-scope violation must name the offending cross-scope reference");
  assert.equal(scopeViolation.evidenceLanguage, "en");
  assert.equal(scopeViolation.evidenceMarket, "GB");
  assert.equal(scopeViolation.candidateLanguage, "de");
  assert.equal(scopeViolation.candidateMarket, "DE");
});

test("approved Knowledge Vault item flows through adapter into candidate and is successfully evaluated without side effects", () => {
  const packageId = new BusinessPackageId("ALIVO");
  const otherPackageId = new BusinessPackageId("OTHER");
  const approvedAt = new Date("2026-08-18T09:00:00.000Z");
  const candidateCreatedAt = new Date("2026-08-18T10:00:00.000Z");
  const evaluatedAt = new Date("2026-08-18T12:00:00.000Z");

  // Step 1: construct an approved Knowledge Vault item
  const item = new KnowledgeItem({
    id: new KnowledgeItemId("kv-item-meal-fatigue"),
    type: KnowledgeItemType.ApprovedNote,
    title: "Meal-related fatigue in endurance athletes",
    content: "Approved research note on meal-related fatigue patterns.",
    status: KnowledgeStatus.Approved,
    source: KnowledgeSource.ApprovedResearch,
    confidence: 0.9,
    createdAt: new Date("2026-08-18T08:00:00.000Z"),
    validatedAt: approvedAt,
    approvedAt,
    language: "de",
    topicLabels: ["content-opportunity", "nutrition"],
  });

  // Step 2: normalize via the adapter
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const normalization = adapter.normalize({ businessPackageId: packageId, item, market: "DE" }, packageId);

  assert.equal(normalization.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  assert.ok(normalization.evidence instanceof ContentOpportunityEvidenceReference);
  assert.equal(normalization.evidence.source, ContentOpportunityEvidenceSource.KnowledgeVault);
  assert.equal(normalization.evidence.role, ContentOpportunityEvidenceRole.Supporting);

  const neutralNormalization = adapter.normalize(
    { businessPackageId: packageId, item, market: "DE", role: ContentOpportunityEvidenceRole.Neutral },
    packageId,
  );
  assert.equal(neutralNormalization.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  assert.ok(neutralNormalization.evidence instanceof ContentOpportunityEvidenceReference);
  assert.equal(neutralNormalization.evidence.role, ContentOpportunityEvidenceRole.Neutral);

  // Step 3: insert normalized evidence into a ContentOpportunityCandidate
  const candidateInstance = ContentOpportunityCandidate.fromPolicy(dePolicy, {
    id: new ContentOpportunityId("opp-meal-fatigue-blog"),
    target: ContentOpportunityTarget.Blog,
    topic: "meal-related fatigue",
    destination: new ContentOpportunityDestination(ContentOpportunityDestinationType.Book, "book:alivo-health"),
    contentReference: "knowledge:question-cluster:meal-fatigue",
    evidenceReferences: [normalization.evidence],
    createdAt: candidateCreatedAt,
  });

  assert.equal(candidateInstance.evidenceReferences.length, 1);
  assert.equal(candidateInstance.evidenceReferences[0], normalization.evidence);
  assert.equal(Object.isFrozen(candidateInstance), true);
  assert.equal(Object.isFrozen(candidateInstance.evidenceReferences), true);

  // Step 4: evaluate with ContentOpportunityEvaluationService
  const service = new ContentOpportunityEvaluationService();
  const evaluation = service.evaluate(candidateInstance, evaluatedAt);

  assert.equal(evaluation.candidateId.value, "opp-meal-fatigue-blog");
  assert.equal(evaluation.businessPackageId.value, "ALIVO");
  assert.equal(evaluation.supportingEvidenceCount, 1);
  assert.equal(evaluation.contradictingEvidenceCount, 0);
  // With 1 supporting reference: evidenceCoverage = 0.5, sourceDiversity = 1 → diversityScore = 0.5
  // score = 0.5*0.35 + 0.5*0.25 + 1*0.2 + 1*0.1 + 1*0.1 = 0.175 + 0.125 + 0.2 + 0.1 + 0.1 = 0.700
  assert.equal(evaluation.score, 0.7);
  assert.equal(evaluation.status, ContentOpportunityStatus.Evaluated);
  assert.ok(evaluation.factors.length === 5);
  assert.ok(evaluation.explanation.length > 0);

  // Step 5: confirm Business Package isolation — cross-package evidence is rejected by the adapter
  const crossPackageNorm = adapter.normalize({ businessPackageId: otherPackageId, item, market: "DE" }, packageId);
  assert.equal(crossPackageNorm.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.match(crossPackageNorm.reason, /Business Package boundary/);
  assert.equal(crossPackageNorm.evidence, undefined);

  // Step 6: confirm no persistence, scheduling, or publishing side effects on either collaborator
  const forbiddenPattern = /fetch|crawl|write|publish|generate|schedule|save|persist|dispatch|emit/i;
  assert.deepEqual(
    Object.getOwnPropertyNames(Object.getPrototypeOf(adapter)).filter((name) => forbiddenPattern.test(name)),
    [],
  );
  assert.deepEqual(
    Object.getOwnPropertyNames(Object.getPrototypeOf(service)).filter((name) => forbiddenPattern.test(name)),
    [],
  );
});

test("normalizeMany preserves every input slot — mixed valid, missing-item, and cross-package inputs produce one result per input with no silent drops", () => {
  const batchPackageId = new BusinessPackageId("ALIVO");
  const foreignPackageId = new BusinessPackageId("FOREIGN");
  const approvedAt = new Date("2026-08-18T09:00:00.000Z");

  const approvedItem = new KnowledgeItem({
    id: new KnowledgeItemId("kv-batch-item-one"),
    type: KnowledgeItemType.ApprovedNote,
    title: "Valid batch item",
    content: "Approved research note.",
    status: KnowledgeStatus.Approved,
    source: KnowledgeSource.ApprovedResearch,
    confidence: 0.9,
    createdAt: new Date("2026-08-18T07:00:00.000Z"),
    validatedAt: approvedAt,
    approvedAt,
    language: "de",
    topicLabels: ["content-opportunity"],
  });

  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();

  const inputs: (KnowledgeVaultEvidenceInput | undefined)[] = [
    // valid → Normalized
    { businessPackageId: batchPackageId, item: approvedItem, market: "DE" },
    // missing item field → Missing
    { businessPackageId: batchPackageId, item: undefined, market: "DE" },
    // undefined input → Missing
    undefined,
    // cross-package businessPackageId → Invalid
    { businessPackageId: foreignPackageId, item: approvedItem, market: "DE" },
  ];

  const results = adapter.normalizeMany(inputs, batchPackageId);

  // No items dropped — one result per input
  assert.equal(results.length, inputs.length);

  // Slot 0: valid item → Normalized with evidence
  assert.equal(results[0]?.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  assert.ok(results[0]?.evidence instanceof ContentOpportunityEvidenceReference);

  // Slot 1: missing item → Missing without evidence
  assert.equal(results[1]?.status, KnowledgeVaultEvidenceNormalizationStatus.Missing);
  assert.equal(results[1]?.evidence, undefined);

  // Slot 2: undefined input → Missing without evidence
  assert.equal(results[2]?.status, KnowledgeVaultEvidenceNormalizationStatus.Missing);
  assert.equal(results[2]?.evidence, undefined);

  // Slot 3: cross-package → Invalid without evidence
  assert.equal(results[3]?.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.equal(results[3]?.evidence, undefined);

  // Only Normalized slots carry an evidence reference
  const normalized = results.filter((r) => r.status === KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  const nonNormalized = results.filter((r) => r.status !== KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  assert.ok(normalized.every((r) => r.evidence !== undefined));
  assert.ok(nonNormalized.every((r) => r.evidence === undefined));

  // Result array is frozen (immutable)
  assert.equal(Object.isFrozen(results), true);
});

test("once-approved Deprecated or Archived Knowledge Vault items are rejected by the adapter — status is the sole gate, not timestamps", () => {
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const batchPackageId = new BusinessPackageId("ALIVO");

  // Both items genuinely passed approval: they carry validatedAt and approvedAt.
  // They were subsequently demoted to Deprecated / Archived.
  const sharedTimestamps = {
    createdAt: new Date("2026-01-10T08:00:00.000Z"),
    validatedAt: new Date("2026-02-01T09:00:00.000Z"),
    approvedAt: new Date("2026-02-15T10:00:00.000Z"),
  };

  const deprecatedItem = new KnowledgeItem({
    id: new KnowledgeItemId("kv-deprecated-item"),
    type: KnowledgeItemType.ApprovedNote,
    title: "Deprecated research note",
    content: "Once-approved content that has since been deprecated.",
    status: KnowledgeStatus.Deprecated,
    source: KnowledgeSource.ApprovedResearch,
    confidence: 0.9,
    language: "de",
    topicLabels: ["content-opportunity"],
    ...sharedTimestamps,
  });

  const archivedItem = new KnowledgeItem({
    id: new KnowledgeItemId("kv-archived-item"),
    type: KnowledgeItemType.ApprovedNote,
    title: "Archived research note",
    content: "Once-approved content that has since been archived.",
    status: KnowledgeStatus.Archived,
    source: KnowledgeSource.ApprovedResearch,
    confidence: 0.85,
    language: "de",
    topicLabels: ["content-opportunity"],
    ...sharedTimestamps,
  });

  // Confirm both timestamps are present — the items really did pass approval.
  assert.ok(deprecatedItem.approvedAt instanceof Date, "deprecated item must carry approvedAt");
  assert.ok(deprecatedItem.validatedAt instanceof Date, "deprecated item must carry validatedAt");
  assert.ok(archivedItem.approvedAt instanceof Date, "archived item must carry approvedAt");
  assert.ok(archivedItem.validatedAt instanceof Date, "archived item must carry validatedAt");

  // Despite the timestamps, the adapter must reject both because status !== Approved.
  const deprecatedResult = adapter.normalize({ businessPackageId: batchPackageId, item: deprecatedItem, market: "DE" }, batchPackageId);
  assert.equal(deprecatedResult.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.match(deprecatedResult.reason, /Deprecated/);
  assert.equal(deprecatedResult.evidence, undefined);

  const archivedResult = adapter.normalize({ businessPackageId: batchPackageId, item: archivedItem, market: "DE" }, batchPackageId);
  assert.equal(archivedResult.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.match(archivedResult.reason, /Archived/);
  assert.equal(archivedResult.evidence, undefined);
});

test("qualification threshold is pinned at 0.75 so any accidental change to the policy constant is caught immediately", () => {
  // The constant itself must equal exactly 0.75; any edit to the source value fails here first.
  assert.equal(QUALIFIED_SCORE_THRESHOLD, 0.75);

  const service = new ContentOpportunityEvaluationService();

  // Score 0.700 (1 supporting, 1 source) → below threshold → Evaluated, not Qualified.
  // If the threshold were lowered to ≤ 0.700 this assertion would fail.
  const below = service.evaluate(
    candidate("below-threshold", [evidence("only", ContentOpportunityEvidenceSource.KnowledgeVault)]),
    evaluatedAt,
  );
  assert.equal(below.score, 0.7);
  assert.ok(below.score < QUALIFIED_SCORE_THRESHOLD, `score ${below.score} must be below ${QUALIFIED_SCORE_THRESHOLD}`);
  assert.equal(below.status, ContentOpportunityStatus.Evaluated);

  // Score 0.875 (2 supporting, 1 source) → above threshold → Qualified.
  // If the threshold were raised above 0.875 this assertion would fail.
  const above = service.evaluate(
    candidate("above-threshold", [
      evidence("a", ContentOpportunityEvidenceSource.KnowledgeVault),
      evidence("b", ContentOpportunityEvidenceSource.KnowledgeVault),
    ]),
    evaluatedAt,
  );
  assert.equal(above.score, 0.875);
  assert.ok(above.score >= QUALIFIED_SCORE_THRESHOLD, `score ${above.score} must be at or above ${QUALIFIED_SCORE_THRESHOLD}`);
  assert.equal(above.status, ContentOpportunityStatus.Qualified);

  // Score 1.000 (2 supporting, 2 distinct sources) → well above threshold → Qualified.
  const full = service.evaluate(candidate("full-threshold"), evaluatedAt);
  assert.equal(full.score, 1);
  assert.equal(full.status, ContentOpportunityStatus.Qualified);
});

test("each factor's score, weight, and contribution are individually pinned so weight or threshold drift is caught immediately", () => {
  const service = new ContentOpportunityEvaluationService();

  // Partial evidence: 1 supporting reference from one source type.
  // evidenceCoverage = clamp(1/2) = 0.5  → contribution = 0.5 × 0.35 = 0.175
  // sourceDiversity  = clamp(1/2) = 0.5  → contribution = 0.5 × 0.25 = 0.125
  // destination-readiness               → score=1, weight=0.2, contribution=0.2
  // content-scope                        → score=1, weight=0.1, contribution=0.1
  // contradiction-check (no contradictions) → score=1, weight=0.1, contribution=0.1
  // aggregate = 0.700 → Evaluated (below 0.75 threshold)
  const partial = candidate("partial", [
    evidence("only", ContentOpportunityEvidenceSource.KnowledgeVault),
  ]);
  const partialEval = service.evaluate(partial, evaluatedAt);

  const partialByid = Object.fromEntries(partialEval.factors.map((f) => [f.properties.id, f]));

  assert.equal(partialByid["evidence-coverage"]?.score, 0.5);
  assert.equal(partialByid["evidence-coverage"]?.weight, 0.35);
  assert.equal(partialByid["evidence-coverage"]?.contribution, 0.175);

  assert.equal(partialByid["source-diversity"]?.score, 0.5);
  assert.equal(partialByid["source-diversity"]?.weight, 0.25);
  assert.equal(partialByid["source-diversity"]?.contribution, 0.125);

  assert.equal(partialByid["destination-readiness"]?.score, 1);
  assert.equal(partialByid["destination-readiness"]?.weight, 0.2);
  assert.equal(partialByid["destination-readiness"]?.contribution, 0.2);

  assert.equal(partialByid["content-scope"]?.score, 1);
  assert.equal(partialByid["content-scope"]?.weight, 0.1);
  assert.equal(partialByid["content-scope"]?.contribution, 0.1);

  assert.equal(partialByid["contradiction-check"]?.score, 1);
  assert.equal(partialByid["contradiction-check"]?.weight, 0.1);
  assert.equal(partialByid["contradiction-check"]?.contribution, 0.1);

  assert.equal(partialEval.score, 0.7);
  assert.equal(partialEval.status, ContentOpportunityStatus.Evaluated);

  // Full evidence: 2 supporting references from 2 different source types, no contradictions.
  // evidenceCoverage = clamp(2/2) = 1.0  → contribution = 1.0 × 0.35 = 0.35
  // sourceDiversity  = clamp(2/2) = 1.0  → contribution = 1.0 × 0.25 = 0.25
  // All other factors remain at score=1 (same as partial case above).
  // aggregate = 1.000 → Qualified (>= 0.75 threshold)
  const full = candidate("full", [
    evidence("a", ContentOpportunityEvidenceSource.KnowledgeVault),
    evidence("b", ContentOpportunityEvidenceSource.ExistingBlog),
  ]);
  const fullEval = service.evaluate(full, evaluatedAt);

  const fullById = Object.fromEntries(fullEval.factors.map((f) => [f.properties.id, f]));

  assert.equal(fullById["evidence-coverage"]?.score, 1);
  assert.equal(fullById["evidence-coverage"]?.weight, 0.35);
  assert.equal(fullById["evidence-coverage"]?.contribution, 0.35);

  assert.equal(fullById["source-diversity"]?.score, 1);
  assert.equal(fullById["source-diversity"]?.weight, 0.25);
  assert.equal(fullById["source-diversity"]?.contribution, 0.25);

  assert.equal(fullById["destination-readiness"]?.score, 1);
  assert.equal(fullById["destination-readiness"]?.weight, 0.2);
  assert.equal(fullById["destination-readiness"]?.contribution, 0.2);

  assert.equal(fullById["content-scope"]?.score, 1);
  assert.equal(fullById["content-scope"]?.weight, 0.1);
  assert.equal(fullById["content-scope"]?.contribution, 0.1);

  assert.equal(fullById["contradiction-check"]?.score, 1);
  assert.equal(fullById["contradiction-check"]?.weight, 0.1);
  assert.equal(fullById["contradiction-check"]?.contribution, 0.1);

  assert.equal(fullEval.score, 1);
  assert.equal(fullEval.status, ContentOpportunityStatus.Qualified);
});

test("single KnowledgeVault item produces score 0.700 and Evaluated status, two items cross the Qualified threshold", () => {
  const kvPackageId = new BusinessPackageId("ALIVO");
  const approvedAt = new Date("2026-08-18T09:00:00.000Z");
  const candidateCreatedAt = new Date("2026-08-18T10:00:00.000Z");
  const kvEvaluatedAt = new Date("2026-08-18T12:00:00.000Z");

  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const service = new ContentOpportunityEvaluationService();

  const makeItem = (id: string, title: string): KnowledgeItem =>
    new KnowledgeItem({
      id: new KnowledgeItemId(id),
      type: KnowledgeItemType.ApprovedNote,
      title,
      content: `Approved research note: ${title}`,
      status: KnowledgeStatus.Approved,
      source: KnowledgeSource.ApprovedResearch,
      confidence: 0.9,
      createdAt: new Date("2026-08-18T07:00:00.000Z"),
      validatedAt: approvedAt,
      approvedAt,
      language: "de",
      topicLabels: ["content-opportunity"],
    });

  const itemOne = makeItem("kv-item-one", "Meal fatigue in endurance athletes");
  const itemTwo = makeItem("kv-item-two", "Nutritional recovery patterns");

  const normOne = adapter.normalize({ businessPackageId: kvPackageId, item: itemOne, market: "DE" }, kvPackageId);
  const normTwo = adapter.normalize({ businessPackageId: kvPackageId, item: itemTwo, market: "DE" }, kvPackageId);

  assert.equal(normOne.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  assert.equal(normTwo.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized);

  // Boundary: single KnowledgeVault item → evidenceCoverage=0.5, sourceDiversityScore=0.5
  // score = 0.5×0.35 + 0.5×0.25 + 1×0.2 + 1×0.1 + 1×0.1 = 0.700 → Evaluated, not Qualified
  const kvPolicy = new BusinessPackageLanguageMarketPolicy({
    businessPackageId: kvPackageId,
    targetMarket: "DE",
    contentWriteLanguage: "de",
    publishingLanguage: "de",
    researchLanguageMode: ResearchLanguageMode.Auto,
  });
  const singleEvidenceCandidate = ContentOpportunityCandidate.fromPolicy(kvPolicy, {
    id: new ContentOpportunityId("opp-single-kv"),
    target: ContentOpportunityTarget.Blog,
    topic: "meal-related fatigue",
    destination: new ContentOpportunityDestination(ContentOpportunityDestinationType.Book, "book:alivo-health"),
    contentReference: "knowledge:question-cluster:meal-fatigue",
    evidenceReferences: [normOne.evidence!],
    createdAt: candidateCreatedAt,
  });

  const singleEvaluation = service.evaluate(singleEvidenceCandidate, kvEvaluatedAt);
  assert.equal(singleEvaluation.score, 0.7);
  assert.equal(singleEvaluation.status, ContentOpportunityStatus.Evaluated);
  assert.equal(singleEvaluation.supportingEvidenceCount, 1);

  // Threshold: two KnowledgeVault items → evidenceCoverage=1.0, sourceDiversityScore=0.5
  // score = 1.0×0.35 + 0.5×0.25 + 1×0.2 + 1×0.1 + 1×0.1 = 0.875 → Qualified
  const twoEvidenceCandidate = ContentOpportunityCandidate.fromPolicy(kvPolicy, {
    id: new ContentOpportunityId("opp-two-kv"),
    target: ContentOpportunityTarget.Blog,
    topic: "meal-related fatigue",
    destination: new ContentOpportunityDestination(ContentOpportunityDestinationType.Book, "book:alivo-health"),
    contentReference: "knowledge:question-cluster:meal-fatigue",
    evidenceReferences: [normOne.evidence!, normTwo.evidence!],
    createdAt: candidateCreatedAt,
  });

  const twoEvaluation = service.evaluate(twoEvidenceCandidate, kvEvaluatedAt);
  assert.equal(twoEvaluation.score, 0.875);
  assert.equal(twoEvaluation.status, ContentOpportunityStatus.Qualified);
  assert.equal(twoEvaluation.supportingEvidenceCount, 2);
  assert.match(twoEvaluation.explanation, /qualified/i);
});

test("normalizeMany returns an empty frozen array when called with an empty batch", () => {
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const results = adapter.normalizeMany([], packageId);

  assert.equal(results.length, 0);
  assert.equal(Object.isFrozen(results), true);
});

test("normalizeMany returns Invalid for a slot whose approved item causes the evidence constructor to throw without propagating the exception", () => {
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const approvedAt = new Date("2026-08-18T09:00:00.000Z");

  // Construct a fully-approved KnowledgeItem so all pre-checks inside normalize pass
  const item = new KnowledgeItem({
    id: new KnowledgeItemId("kv-throw-item"),
    type: KnowledgeItemType.ApprovedNote,
    title: "Item that triggers constructor throw",
    content: "Approved content.",
    status: KnowledgeStatus.Approved,
    source: KnowledgeSource.ApprovedResearch,
    confidence: 0.9,
    createdAt: new Date("2026-08-18T08:00:00.000Z"),
    validatedAt: approvedAt,
    approvedAt,
    language: "de",
    topicLabels: ["content-opportunity"],
  });

  // An invalid Date for observedAt passes all adapter pre-checks but causes
  // ContentOpportunityEvidenceReference's validDate guard to throw inside the try/catch.
  const results = adapter.normalizeMany(
    [{ businessPackageId: packageId, item, market: "DE", observedAt: new Date("not-a-date") }],
    packageId,
  );

  assert.equal(results.length, 1);
  assert.equal(results[0]?.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.equal(results[0]?.evidence, undefined);
  assert.ok(typeof results[0]?.reason === "string" && results[0].reason.length > 0);
  assert.equal(Object.isFrozen(results), true);
});

test("normalizeMany with interleaved Approved and non-Approved items produces one result per slot and non-Approved slots never block adjacent Approved slots", () => {
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const batchPackageId = new BusinessPackageId("ALIVO");
  const baseDate = new Date("2026-08-18T08:00:00.000Z");
  const validatedDate = new Date("2026-08-18T09:00:00.000Z");
  const approvedDate = new Date("2026-08-18T10:00:00.000Z");

  const makeItem = (id: string, status: KnowledgeStatus): KnowledgeItem =>
    new KnowledgeItem({
      id: new KnowledgeItemId(id),
      type: KnowledgeItemType.ApprovedNote,
      title: `Item with status ${status}`,
      content: `Content for ${status} item.`,
      status,
      source: KnowledgeSource.ApprovedResearch,
      confidence: 0.9,
      createdAt: baseDate,
      language: "de",
      topicLabels: [],
      ...(status === KnowledgeStatus.Validated || status === KnowledgeStatus.Deprecated || status === KnowledgeStatus.Archived
        ? { validatedAt: validatedDate }
        : {}),
      ...(status === KnowledgeStatus.Approved
        ? { validatedAt: validatedDate, approvedAt: approvedDate }
        : {}),
    });

  // Interleaved batch: non-Approved, Approved, non-Approved, Approved, non-Approved, non-Approved
  const inputs = [
    { businessPackageId: batchPackageId, item: makeItem("kv-draft", KnowledgeStatus.Draft), market: "DE" },
    { businessPackageId: batchPackageId, item: makeItem("kv-approved-1", KnowledgeStatus.Approved), market: "DE" },
    { businessPackageId: batchPackageId, item: makeItem("kv-validated", KnowledgeStatus.Validated), market: "DE" },
    { businessPackageId: batchPackageId, item: makeItem("kv-approved-2", KnowledgeStatus.Approved), market: "DE" },
    { businessPackageId: batchPackageId, item: makeItem("kv-deprecated", KnowledgeStatus.Deprecated), market: "DE" },
    { businessPackageId: batchPackageId, item: makeItem("kv-archived", KnowledgeStatus.Archived), market: "DE" },
  ];

  const results = adapter.normalizeMany(inputs, batchPackageId);

  // One result per input — no slots dropped or merged
  assert.equal(results.length, inputs.length);

  // Slot 0: Draft → Invalid, no evidence
  assert.equal(results[0]?.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.equal(results[0]?.evidence, undefined);

  // Slot 1: Approved → Normalized with evidence (not blocked by adjacent Draft)
  assert.equal(results[1]?.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  assert.ok(results[1]?.evidence instanceof ContentOpportunityEvidenceReference);

  // Slot 2: Validated → Invalid, no evidence
  assert.equal(results[2]?.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.equal(results[2]?.evidence, undefined);

  // Slot 3: Approved → Normalized with evidence (not blocked by adjacent Validated)
  assert.equal(results[3]?.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  assert.ok(results[3]?.evidence instanceof ContentOpportunityEvidenceReference);

  // Slot 4: Deprecated → Invalid, no evidence
  assert.equal(results[4]?.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.equal(results[4]?.evidence, undefined);

  // Slot 5: Archived → Invalid, no evidence
  assert.equal(results[5]?.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.equal(results[5]?.evidence, undefined);

  // Only Normalized slots carry evidence; all non-Normalized slots carry none
  const normalized = results.filter((r) => r.status === KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  const nonNormalized = results.filter((r) => r.status !== KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  assert.equal(normalized.length, 2);
  assert.ok(normalized.every((r) => r.evidence !== undefined));
  assert.ok(nonNormalized.every((r) => r.evidence === undefined));

  // Result array is frozen
  assert.equal(Object.isFrozen(results), true);
});

test("adapter rejects every non-Approved KnowledgeStatus as Invalid with an explanatory reason and no evidence", () => {
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const adapterPackageId = new BusinessPackageId("ALIVO");
  const baseDate = new Date("2026-08-18T08:00:00.000Z");
  const validatedDate = new Date("2026-08-18T09:00:00.000Z");

  // Each entry: [status, extra timestamps needed to satisfy KnowledgeItem lifecycle rules]
  const cases: Array<[KnowledgeStatus, { validatedAt?: Date }]> = [
    [KnowledgeStatus.Draft, {}],
    [KnowledgeStatus.Validated, { validatedAt: validatedDate }],
    [KnowledgeStatus.Deprecated, { validatedAt: validatedDate }],
    [KnowledgeStatus.Archived, { validatedAt: validatedDate }],
  ];

  for (const [status, extra] of cases) {
    const item = new KnowledgeItem({
      id: new KnowledgeItemId(`kv-item-${status.toLowerCase()}`),
      type: KnowledgeItemType.ApprovedNote,
      title: `Item with status ${status}`,
      content: `Content for ${status} item.`,
      status,
      source: KnowledgeSource.ApprovedResearch,
      confidence: 0.9,
      createdAt: baseDate,
      language: "de",
      topicLabels: [],
      ...extra,
    });

    const normalization = adapter.normalize(
      { businessPackageId: adapterPackageId, item, market: "DE" },
      adapterPackageId,
    );

    assert.equal(
      normalization.status,
      KnowledgeVaultEvidenceNormalizationStatus.Invalid,
      `Expected Invalid for status "${status}" but got "${normalization.status}"`,
    );
    assert.ok(
      normalization.reason.length > 0,
      `Expected a non-empty reason for status "${status}"`,
    );
    assert.equal(
      normalization.evidence,
      undefined,
      `Expected no evidence for status "${status}"`,
    );
  }
});

test("adapter rejection reason names the blocked Knowledge Vault status so batch operators can diagnose failures without re-fetching each slot", () => {
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const adapterPackageId = new BusinessPackageId("ALIVO");
  const baseDate = new Date("2026-08-18T08:00:00.000Z");
  const validatedDate = new Date("2026-08-18T09:00:00.000Z");

  const cases: Array<[KnowledgeStatus, { validatedAt?: Date }]> = [
    [KnowledgeStatus.Draft, {}],
    [KnowledgeStatus.Validated, { validatedAt: validatedDate }],
    [KnowledgeStatus.Deprecated, { validatedAt: validatedDate }],
    [KnowledgeStatus.Archived, { validatedAt: validatedDate }],
  ];

  for (const [status, extra] of cases) {
    const item = new KnowledgeItem({
      id: new KnowledgeItemId(`kv-status-reason-${status.toLowerCase()}`),
      type: KnowledgeItemType.ApprovedNote,
      title: `Item with status ${status}`,
      content: `Content for ${status} item.`,
      status,
      source: KnowledgeSource.ApprovedResearch,
      confidence: 0.9,
      createdAt: baseDate,
      language: "de",
      topicLabels: [],
      ...extra,
    });

    const normalization = adapter.normalize(
      { businessPackageId: adapterPackageId, item, market: "DE" },
      adapterPackageId,
    );

    assert.equal(
      normalization.status,
      KnowledgeVaultEvidenceNormalizationStatus.Invalid,
      `Expected Invalid for status "${status}"`,
    );
    assert.ok(
      normalization.reason.includes(status),
      `Expected reason to contain the status value "${status}" but got: "${normalization.reason}"`,
    );
    assert.equal(normalization.evidence, undefined);
  }
});

test("adapter rejection reason names the blocked status in a normalizeMany batch so operators can read every slot result directly", () => {
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const adapterPackageId = new BusinessPackageId("ALIVO");
  const baseDate = new Date("2026-08-18T08:00:00.000Z");
  const validatedDate = new Date("2026-08-18T09:00:00.000Z");

  const makeItem = (id: string, status: KnowledgeStatus, extra: { validatedAt?: Date } = {}): KnowledgeItem =>
    new KnowledgeItem({
      id: new KnowledgeItemId(id),
      type: KnowledgeItemType.ApprovedNote,
      title: `Item with status ${status}`,
      content: `Content for ${status} item.`,
      status,
      source: KnowledgeSource.ApprovedResearch,
      confidence: 0.9,
      createdAt: baseDate,
      language: "de",
      topicLabels: [],
      ...extra,
    });

  const inputs = [
    { businessPackageId: adapterPackageId, item: makeItem("kv-reason-draft", KnowledgeStatus.Draft), market: "DE" },
    { businessPackageId: adapterPackageId, item: makeItem("kv-reason-validated", KnowledgeStatus.Validated, { validatedAt: validatedDate }), market: "DE" },
    { businessPackageId: adapterPackageId, item: makeItem("kv-reason-deprecated", KnowledgeStatus.Deprecated, { validatedAt: validatedDate }), market: "DE" },
    { businessPackageId: adapterPackageId, item: makeItem("kv-reason-archived", KnowledgeStatus.Archived, { validatedAt: validatedDate }), market: "DE" },
  ];

  const results = adapter.normalizeMany(inputs, adapterPackageId);

  assert.equal(results.length, 4);
  assert.ok(results[0]?.reason.includes(KnowledgeStatus.Draft), `Draft reason must name "Draft" but got: "${results[0]?.reason}"`);
  assert.ok(results[1]?.reason.includes(KnowledgeStatus.Validated), `Validated reason must name "Validated" but got: "${results[1]?.reason}"`);
  assert.ok(results[2]?.reason.includes(KnowledgeStatus.Deprecated), `Deprecated reason must name "Deprecated" but got: "${results[2]?.reason}"`);
  assert.ok(results[3]?.reason.includes(KnowledgeStatus.Archived), `Archived reason must name "Archived" but got: "${results[3]?.reason}"`);
  assert.ok(results.every((r) => r.status === KnowledgeVaultEvidenceNormalizationStatus.Invalid));
  assert.ok(results.every((r) => r.evidence === undefined));
  assert.equal(Object.isFrozen(results), true);
});

test("adapter returns Invalid when an approved item carries an unrecognized language code", () => {
  // "zz-toolong" passes the non-empty check inside normalize but fails canonicalLanguage's
  // pattern (/^[a-z]{2,3}(?:-[a-z]{2}|-[0-9]{3})?$/i) because the region part exceeds two
  // characters. The thrown LanguageMarketPolicyException must be caught and surfaced as Invalid
  // rather than propagating to the caller.
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const adapterPackageId = new BusinessPackageId("ALIVO");
  const approvedAt = new Date("2026-08-18T09:00:00.000Z");

  const item = new KnowledgeItem({
    id: new KnowledgeItemId("kv-bad-language-item"),
    type: KnowledgeItemType.ApprovedNote,
    title: "Item with unrecognized language code",
    content: "Approved content with a language tag that canonicalLanguage rejects.",
    status: KnowledgeStatus.Approved,
    source: KnowledgeSource.ApprovedResearch,
    confidence: 0.9,
    createdAt: new Date("2026-08-18T08:00:00.000Z"),
    validatedAt: approvedAt,
    approvedAt,
    language: "zz-toolong",
    topicLabels: ["content-opportunity"],
  });

  const normalization = adapter.normalize({ businessPackageId: adapterPackageId, item, market: "DE" }, adapterPackageId);

  assert.equal(normalization.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.ok(normalization.reason.length > 0, "reason must be non-empty");
  assert.equal(normalization.evidence, undefined);
});

test("adapter returns Invalid when an approved item is paired with an unrecognized market code", () => {
  // "BADMARKET" is a non-empty string so it passes the adapter's early non-empty guard, but its
  // 9-character base exceeds the /^[A-Z]{2,3}/ limit in canonicalMarket. The thrown
  // LanguageMarketPolicyException must be caught and surfaced as Invalid rather than propagating.
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const adapterPackageId = new BusinessPackageId("ALIVO");
  const approvedAt = new Date("2026-08-18T09:00:00.000Z");

  const item = new KnowledgeItem({
    id: new KnowledgeItemId("kv-bad-market-item"),
    type: KnowledgeItemType.ApprovedNote,
    title: "Item with unrecognized market code",
    content: "Approved content supplied with a market string that canonicalMarket rejects.",
    status: KnowledgeStatus.Approved,
    source: KnowledgeSource.ApprovedResearch,
    confidence: 0.9,
    createdAt: new Date("2026-08-18T08:00:00.000Z"),
    validatedAt: approvedAt,
    approvedAt,
    language: "de",
    topicLabels: ["content-opportunity"],
  });

  const normalization = adapter.normalize({ businessPackageId: adapterPackageId, item, market: "BADMARKET" }, adapterPackageId);

  assert.equal(normalization.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.ok(normalization.reason.length > 0, "reason must be non-empty");
  assert.equal(normalization.evidence, undefined);
});

test("adapter rejection reason names the language field when an approved item carries an unrecognized language code", () => {
  // Calls through the real adapter and real canonicalLanguage so any change to
  // LanguageMarketPolicy's error message that drops the field name is caught here.
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const adapterPackageId = new BusinessPackageId("ALIVO");
  const approvedAt = new Date("2026-08-18T09:00:00.000Z");

  const item = new KnowledgeItem({
    id: new KnowledgeItemId("kv-lang-reason-item"),
    type: KnowledgeItemType.ApprovedNote,
    title: "Item with unrecognized language code",
    content: "Approved content whose language tag canonicalLanguage rejects.",
    status: KnowledgeStatus.Approved,
    source: KnowledgeSource.ApprovedResearch,
    confidence: 0.9,
    createdAt: new Date("2026-08-18T08:00:00.000Z"),
    validatedAt: approvedAt,
    approvedAt,
    language: "zz-toolong",
    topicLabels: ["content-opportunity"],
  });

  const normalization = adapter.normalize(
    { businessPackageId: adapterPackageId, item, market: "DE" },
    adapterPackageId,
  );

  assert.equal(normalization.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.equal(normalization.evidence, undefined);
  // Reason must name the offending field and the rejected value so operators can
  // identify and correct the bad input without re-fetching the original record.
  assert.ok(
    /language/i.test(normalization.reason),
    `Expected reason to mention "language" but got: "${normalization.reason}"`,
  );
  assert.ok(
    normalization.reason.includes("zz-toolong"),
    `Expected reason to contain the rejected code "zz-toolong" but got: "${normalization.reason}"`,
  );
});

test("adapter rejection reason names the market field when an approved item is paired with an unrecognized market code", () => {
  // Calls through the real adapter and real canonicalMarket so any change to
  // LanguageMarketPolicy's error message that drops the field name is caught here.
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const adapterPackageId = new BusinessPackageId("ALIVO");
  const approvedAt = new Date("2026-08-18T09:00:00.000Z");

  const item = new KnowledgeItem({
    id: new KnowledgeItemId("kv-market-reason-item"),
    type: KnowledgeItemType.ApprovedNote,
    title: "Item with unrecognized market code",
    content: "Approved content supplied with a market string that canonicalMarket rejects.",
    status: KnowledgeStatus.Approved,
    source: KnowledgeSource.ApprovedResearch,
    confidence: 0.9,
    createdAt: new Date("2026-08-18T08:00:00.000Z"),
    validatedAt: approvedAt,
    approvedAt,
    language: "de",
    topicLabels: ["content-opportunity"],
  });

  const normalization = adapter.normalize(
    { businessPackageId: adapterPackageId, item, market: "BADMARKET" },
    adapterPackageId,
  );

  assert.equal(normalization.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.equal(normalization.evidence, undefined);
  // Reason must name the offending field and the rejected value so operators can
  // identify and correct the bad input without re-fetching the original record.
  assert.ok(
    /market/i.test(normalization.reason),
    `Expected reason to mention "market" but got: "${normalization.reason}"`,
  );
  assert.ok(
    normalization.reason.includes("BADMARKET"),
    `Expected reason to contain the rejected code "BADMARKET" but got: "${normalization.reason}"`,
  );
});

test("normalize produces evidenceReference and sourceReference URIs with the exact scope segment format so a refactor cannot silently break downstream lineage consumers", () => {
  // Pins the exact string shape of both URIs emitted by the KnowledgeVault adapter.
  // The scope segment `:scope:<language>:<market>` must appear at the end of each URI,
  // separated by colons, in language-then-market order. A rename of "scope", a reordering
  // of the segments, or a delimiter change would break downstream lineage systems that
  // parse these URIs — this test catches that before it reaches production.
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const adapterPackageId = new BusinessPackageId("ALIVO");
  const approvedAt = new Date("2026-08-18T09:00:00.000Z");

  const item = new KnowledgeItem({
    id: new KnowledgeItemId("kv-uri-pin-item"),
    type: KnowledgeItemType.ApprovedNote,
    title: "URI pin test item",
    content: "Approved content for URI format pinning.",
    status: KnowledgeStatus.Approved,
    source: KnowledgeSource.ApprovedResearch,
    confidence: 0.9,
    createdAt: new Date("2026-08-18T08:00:00.000Z"),
    validatedAt: approvedAt,
    approvedAt,
    language: "de",
    topicLabels: ["content-opportunity"],
  });

  const normalization = adapter.normalize(
    { businessPackageId: adapterPackageId, item, market: "DE" },
    adapterPackageId,
  );

  assert.equal(normalization.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  assert.ok(normalization.evidence !== undefined, "Normalized result must carry evidence");

  // Pin the exact evidenceReference format:
  //   knowledge-vault:<pkg>:item:<item-id>:scope:<language>:<market>
  assert.equal(
    normalization.evidence.evidenceReference,
    "knowledge-vault:ALIVO:item:kv-uri-pin-item:scope:de:DE",
    "evidenceReference must match the exact URI format with :scope:<language>:<market> at the end",
  );

  // Pin the exact sourceReference format:
  //   knowledge-vault:<pkg>:source:<item.source>:scope:<language>:<market>
  assert.equal(
    normalization.evidence.sourceReference,
    "knowledge-vault:ALIVO:source:ApprovedResearch:scope:de:DE",
    "sourceReference must match the exact URI format with :scope:<language>:<market> at the end",
  );

  // Confirm the scope fields on the reference also match
  assert.equal(normalization.evidence.language, "de");
  assert.equal(normalization.evidence.market, "DE");
});

test("normalizeMany surfaces Invalid for every slot with a bad language code without stopping at the first failure", () => {
  // Exercises the batch path exclusively: multiple slots each carrying a different invalid
  // language code must all produce Invalid — none must be silently dropped or cause an
  // early exit that leaves later slots unprocessed.
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const adapterPackageId = new BusinessPackageId("ALIVO");
  const approvedAt = new Date("2026-08-18T09:00:00.000Z");

  const makeApprovedItem = (id: string, language: string): KnowledgeItem =>
    new KnowledgeItem({
      id: new KnowledgeItemId(id),
      type: KnowledgeItemType.ApprovedNote,
      title: `Item with language ${language}`,
      content: `Approved content whose language tag "${language}" canonicalLanguage rejects.`,
      status: KnowledgeStatus.Approved,
      source: KnowledgeSource.ApprovedResearch,
      confidence: 0.9,
      createdAt: new Date("2026-08-18T08:00:00.000Z"),
      validatedAt: approvedAt,
      approvedAt,
      language,
      topicLabels: ["content-opportunity"],
    });

  // Three distinct invalid language codes — each rejected for a different structural reason:
  //   "zz-toolong"  — region tag exceeds two characters
  //   "123"         — numeric code; no letter-only prefix
  //   "x-waytoolongcode" — overshoots the 2-3 char primary subtag limit
  const inputs = [
    { businessPackageId: adapterPackageId, item: makeApprovedItem("kv-bad-lang-1", "zz-toolong"), market: "DE" },
    { businessPackageId: adapterPackageId, item: makeApprovedItem("kv-bad-lang-2", "123"), market: "DE" },
    { businessPackageId: adapterPackageId, item: makeApprovedItem("kv-bad-lang-3", "x-waytoolongcode"), market: "DE" },
  ];

  const results = adapter.normalizeMany(inputs, adapterPackageId);

  // No slots dropped — one result per input
  assert.equal(results.length, inputs.length, "result length must equal input length");

  // Every slot must be Invalid with a non-empty reason and no evidence
  assert.ok(results.every((r) => r.status === KnowledgeVaultEvidenceNormalizationStatus.Invalid),
    "all slots must be Invalid");
  assert.ok(results.every((r) => r.reason.length > 0),
    "every Invalid slot must carry a non-empty reason");
  assert.ok(results.every((r) => r.evidence === undefined),
    "no Invalid slot may carry evidence");

  // Result array is frozen
  assert.equal(Object.isFrozen(results), true);
});

test("normalizeMany surfaces Invalid for every slot with a bad market code without stopping at the first failure", () => {
  // Parallel batch test for market codes: multiple slots each carrying a different invalid
  // market code must all produce Invalid — none must be silently dropped or cause an
  // early exit that leaves later slots unprocessed.
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const adapterPackageId = new BusinessPackageId("ALIVO");
  const approvedAt = new Date("2026-08-18T09:00:00.000Z");

  const approvedItemBase = {
    type: KnowledgeItemType.ApprovedNote,
    content: "Approved content supplied with a market string that canonicalMarket rejects.",
    status: KnowledgeStatus.Approved,
    source: KnowledgeSource.ApprovedResearch,
    confidence: 0.9,
    createdAt: new Date("2026-08-18T08:00:00.000Z"),
    validatedAt: approvedAt,
    approvedAt,
    language: "de",
    topicLabels: ["content-opportunity"],
  };

  const makeApprovedItem = (id: string, title: string): KnowledgeItem =>
    new KnowledgeItem({ id: new KnowledgeItemId(id), title, ...approvedItemBase });

  // Three distinct invalid market codes — each rejected because it fails the /^[A-Z]{2,3}/ limit
  // after canonicalization (trim + toUpperCase). Note: single lowercase codes like "de" become "DE"
  // after toUpperCase and are therefore valid; all three codes below remain invalid after that step.
  //   "BADMARKET"   — 9-character base exceeds the 2-3 char limit
  //   "TOOLONGMKT"  — 10-character base also exceeds the limit
  //   "1234"        — numeric only; no letter-only prefix
  const inputs = [
    { businessPackageId: adapterPackageId, item: makeApprovedItem("kv-bad-market-1", "Item with market BADMARKET"), market: "BADMARKET" },
    { businessPackageId: adapterPackageId, item: makeApprovedItem("kv-bad-market-2", "Item with market TOOLONGMKT"), market: "TOOLONGMKT" },
    { businessPackageId: adapterPackageId, item: makeApprovedItem("kv-bad-market-3", "Item with market 1234"), market: "1234" },
  ];

  const results = adapter.normalizeMany(inputs, adapterPackageId);

  // No slots dropped — one result per input
  assert.equal(results.length, inputs.length, "result length must equal input length");

  // Every slot must be Invalid with a non-empty reason and no evidence
  assert.ok(results.every((r) => r.status === KnowledgeVaultEvidenceNormalizationStatus.Invalid),
    "all slots must be Invalid");
  assert.ok(results.every((r) => r.reason.length > 0),
    "every Invalid slot must carry a non-empty reason");
  assert.ok(results.every((r) => r.evidence === undefined),
    "no Invalid slot may carry evidence");

  // Result array is frozen
  assert.equal(Object.isFrozen(results), true);
});

test("normalizeMany names each rejected language code in that slot's reason so operators can identify the bad input without re-fetching", () => {
  // The existing batch tests verify status === Invalid and reason.length > 0 for bad-language
  // slots.  This test pins the diagnostic content: each slot's reason must contain the specific
  // language code that was rejected, so an operator reading batch output knows which value to
  // fix without re-examining the source data.
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const adapterPackageId = new BusinessPackageId("ALIVO");
  const approvedAt = new Date("2026-08-18T09:00:00.000Z");

  const makeApprovedItem = (id: string, language: string): KnowledgeItem =>
    new KnowledgeItem({
      id: new KnowledgeItemId(id),
      type: KnowledgeItemType.ApprovedNote,
      title: `Item with language ${language}`,
      content: `Approved content whose language tag "${language}" canonicalLanguage rejects.`,
      status: KnowledgeStatus.Approved,
      source: KnowledgeSource.ApprovedResearch,
      confidence: 0.9,
      createdAt: new Date("2026-08-18T08:00:00.000Z"),
      validatedAt: approvedAt,
      approvedAt,
      language,
      topicLabels: ["content-opportunity"],
    });

  const badLanguageCodes = ["zz-toolong", "123", "x-waytoolongcode"];
  const inputs = badLanguageCodes.map((lang, i) => ({
    businessPackageId: adapterPackageId,
    item: makeApprovedItem(`kv-lang-pin-${i}`, lang),
    market: "DE",
  }));

  const results = adapter.normalizeMany(inputs, adapterPackageId);

  assert.equal(results.length, inputs.length, "result length must equal input length");
  assert.ok(results.every((r) => r.status === KnowledgeVaultEvidenceNormalizationStatus.Invalid),
    "all slots must be Invalid");

  // Pin: each slot's reason must contain the specific rejected language code so operators can
  // identify the bad value without re-fetching the source data.
  badLanguageCodes.forEach((code, i) => {
    assert.ok(
      results[i]?.reason.includes(code),
      `slot ${i} reason must contain the rejected language code "${code}" but got: "${results[i]?.reason}"`,
    );
  });
});

test("normalizeMany names each rejected market code in that slot's reason so operators can identify the bad input without re-fetching", () => {
  // Parallel pin for market codes: each slot's reason must contain the specific market code
  // that was rejected, so an operator reading batch output knows which value to fix without
  // re-examining the source data.
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const adapterPackageId = new BusinessPackageId("ALIVO");
  const approvedAt = new Date("2026-08-18T09:00:00.000Z");

  const approvedItemBase = {
    type: KnowledgeItemType.ApprovedNote,
    content: "Approved content supplied with a market string that canonicalMarket rejects.",
    status: KnowledgeStatus.Approved,
    source: KnowledgeSource.ApprovedResearch,
    confidence: 0.9,
    createdAt: new Date("2026-08-18T08:00:00.000Z"),
    validatedAt: approvedAt,
    approvedAt,
    language: "de",
    topicLabels: ["content-opportunity"],
  };

  const makeApprovedItem = (id: string, title: string): KnowledgeItem =>
    new KnowledgeItem({ id: new KnowledgeItemId(id), title, ...approvedItemBase });

  // canonicalMarket uppercases the input before testing, so the code that appears in the
  // error message is the uppercased form.  All three codes remain invalid after uppercasing.
  const badMarketCodes = ["BADMARKET", "TOOLONGMKT", "1234"];
  const inputs = badMarketCodes.map((market, i) => ({
    businessPackageId: adapterPackageId,
    item: makeApprovedItem(`kv-market-pin-${i}`, `Item with market ${market}`),
    market,
  }));

  const results = adapter.normalizeMany(inputs, adapterPackageId);

  assert.equal(results.length, inputs.length, "result length must equal input length");
  assert.ok(results.every((r) => r.status === KnowledgeVaultEvidenceNormalizationStatus.Invalid),
    "all slots must be Invalid");

  // Pin: each slot's reason must contain the specific rejected market code so operators can
  // identify the bad value without re-fetching the source data.
  badMarketCodes.forEach((code, i) => {
    assert.ok(
      results[i]?.reason.includes(code),
      `slot ${i} reason must contain the rejected market code "${code}" but got: "${results[i]?.reason}"`,
    );
  });
});

test("normalizeMany bad-language batch reason matches the full canonicalLanguage error message format so a wording change cannot silently drop the language code", () => {
  // The prior slot-level tests confirm status === Invalid and that the reason contains
  // the rejected code. This test pins the surrounding message structure: each slot's
  // reason must match the regex /language code/ so that a future template change that
  // drops the key phrase is caught immediately at the format level, not just when an
  // operator notices missing codes in production output.
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const adapterPackageId = new BusinessPackageId("ALIVO");
  const approvedAt = new Date("2026-08-18T09:00:00.000Z");

  const makeApprovedItem = (id: string, language: string): KnowledgeItem =>
    new KnowledgeItem({
      id: new KnowledgeItemId(id),
      type: KnowledgeItemType.ApprovedNote,
      title: `Item with language ${language}`,
      content: `Approved content whose language tag "${language}" canonicalLanguage rejects.`,
      status: KnowledgeStatus.Approved,
      source: KnowledgeSource.ApprovedResearch,
      confidence: 0.9,
      createdAt: new Date("2026-08-18T08:00:00.000Z"),
      validatedAt: approvedAt,
      approvedAt,
      language,
      topicLabels: ["content-opportunity"],
    });

  const badLanguageCodes = ["zz-toolong", "123", "x-waytoolongcode"];
  const inputs = badLanguageCodes.map((lang, i) => ({
    businessPackageId: adapterPackageId,
    item: makeApprovedItem(`kv-lang-fmt-${i}`, lang),
    market: "DE",
  }));

  const results = adapter.normalizeMany(inputs, adapterPackageId);

  assert.equal(results.length, inputs.length, "result length must equal input length");
  assert.ok(results.every((r) => r.status === KnowledgeVaultEvidenceNormalizationStatus.Invalid),
    "all slots must be Invalid");

  // Pin: each slot's reason must match the full message format emitted by canonicalLanguage.
  // The regex /language code/ guards both the word "language" and "code", so a template
  // that drops either word — or removes the value entirely — fails this assertion before
  // reaching production.
  badLanguageCodes.forEach((code, i) => {
    const reason = results[i]?.reason ?? "";
    assert.match(
      reason,
      /language code/i,
      `slot ${i} (code "${code}") reason must match /language code/ but got: "${reason}"`,
    );
    assert.ok(
      reason.includes(code),
      `slot ${i} reason must still contain the rejected code "${code}" but got: "${reason}"`,
    );
  });
});

test("normalizeMany interleaved bad-language and bad-market slots do not bleed their reason into the sandwiched valid slot", () => {
  // Confirms that per-slot isolation is maintained: a bad-language slot at position 0 and a
  // bad-market slot at position 2 must not contaminate the Normalized slot at position 1.
  // The valid neighbor must carry its own correct evidence reference; its language/market
  // fields must reflect the valid input, not any rejected code from the surrounding slots.
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const adapterPackageId = new BusinessPackageId("ALIVO");
  const approvedAt = new Date("2026-08-18T09:00:00.000Z");

  const makeApprovedItem = (id: string, language: string, title: string): KnowledgeItem =>
    new KnowledgeItem({
      id: new KnowledgeItemId(id),
      type: KnowledgeItemType.ApprovedNote,
      title,
      content: `Approved content for ${id}.`,
      status: KnowledgeStatus.Approved,
      source: KnowledgeSource.ApprovedResearch,
      confidence: 0.9,
      createdAt: new Date("2026-08-18T08:00:00.000Z"),
      validatedAt: approvedAt,
      approvedAt,
      language,
      topicLabels: ["content-opportunity"],
    });

  const inputs = [
    // slot 0: bad language — canonicalLanguage rejects "zz-toolong"
    {
      businessPackageId: adapterPackageId,
      item: makeApprovedItem("kv-bleed-bad-lang", "zz-toolong", "Item with bad language zz-toolong"),
      market: "DE",
    },
    // slot 1: valid — language "de", market "DE"
    {
      businessPackageId: adapterPackageId,
      item: makeApprovedItem("kv-bleed-valid", "de", "Item with valid language de"),
      market: "DE",
    },
    // slot 2: bad market — canonicalMarket rejects "BADMARKET"
    {
      businessPackageId: adapterPackageId,
      item: makeApprovedItem("kv-bleed-bad-mkt", "de", "Item with bad market BADMARKET"),
      market: "BADMARKET",
    },
  ];

  const results = adapter.normalizeMany(inputs, adapterPackageId);

  assert.equal(results.length, 3, "result length must equal input length");

  // slot 0: bad-language slot must be Invalid
  assert.equal(results[0]?.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid,
    "slot 0 (bad language) must be Invalid");
  assert.equal(results[0]?.evidence, undefined,
    "slot 0 must not carry evidence");
  assert.match(results[0]?.reason ?? "", /language code/i,
    "slot 0 reason must mention 'language code'");

  // slot 1: valid slot must be Normalized with correct language/market — not contaminated by neighbors
  assert.equal(results[1]?.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized,
    "slot 1 (valid) must be Normalized");
  assert.ok(results[1]?.evidence !== undefined,
    "slot 1 must carry evidence");
  assert.equal(results[1]?.evidence?.language, "de",
    "slot 1 evidence language must be 'de', not any rejected code from neighboring slots");
  assert.equal(results[1]?.evidence?.market, "DE",
    "slot 1 evidence market must be 'DE', not any rejected code from neighboring slots");
  assert.ok(
    results[1]?.evidence?.evidenceReference.includes("kv-bleed-valid"),
    "slot 1 evidence reference must identify the valid item, not a neighboring item",
  );
  // Confirm the valid slot's reason does not contain any rejected code from neighbors
  assert.doesNotMatch(results[1]?.reason ?? "", /zz-toolong/i,
    "slot 1 reason must not contain the bad-language code from slot 0");
  assert.doesNotMatch(results[1]?.reason ?? "", /BADMARKET/i,
    "slot 1 reason must not contain the bad-market code from slot 2");

  // slot 2: bad-market slot must be Invalid
  assert.equal(results[2]?.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid,
    "slot 2 (bad market) must be Invalid");
  assert.equal(results[2]?.evidence, undefined,
    "slot 2 must not carry evidence");
  assert.match(results[2]?.reason ?? "", /market code/i,
    "slot 2 reason must mention 'market code'");
});

test("throwIfViolations is a no-op when the batch result has no violations", () => {
  const service = new ContentOpportunityEvaluationService();
  const c = candidate();
  const evaluation = service.evaluate(c, evaluatedAt);
  const result = new ContentOpportunityBatchEvaluationResult([evaluation], []);

  assert.equal(result.hasViolations, false);
  // Must not throw
  assert.doesNotThrow(() => result.throwIfViolations());
});

test("throwIfViolations throws a ContentOpportunityIntelligenceException whose message lists every violation detail", () => {
  const otherPackageId = new BusinessPackageId("OTHER");

  const crossPackageViolation = new ContentOpportunityCrossPackageViolation({
    candidateId: new ContentOpportunityId("opp-cross-pkg"),
    sourceReference: "knowledgevault:source-cross",
    evidencePackageId: otherPackageId,
    candidatePackageId: packageId,
  });

  const crossScopeViolation = new ContentOpportunityCrossScopeViolation({
    candidateId: new ContentOpportunityId("opp-cross-scope"),
    sourceReference: "existingblog:source-scope",
    evidenceLanguage: "fr",
    evidenceMarket: "FR",
    candidateLanguage: "de",
    candidateMarket: "DE",
  });

  const result = new ContentOpportunityBatchEvaluationResult([], [crossPackageViolation, crossScopeViolation]);

  assert.equal(result.hasViolations, true);

  let thrown: unknown;
  try {
    result.throwIfViolations();
  } catch (err) {
    thrown = err;
  }

  assert.ok(thrown instanceof ContentOpportunityIntelligenceException, "must throw ContentOpportunityIntelligenceException");
  const message = (thrown as ContentOpportunityIntelligenceException).message;

  // Summary mentions both violation counts
  assert.match(message, /2 violations/i);

  // Both violation details appear in the message
  assert.ok(message.includes(crossPackageViolation.detail), "message must contain cross-package violation detail");
  assert.ok(message.includes(crossScopeViolation.detail), "message must contain cross-scope violation detail");
});

test("throwIfViolations throws with a singular label when exactly one violation is present", () => {
  const crossPackageViolation = new ContentOpportunityCrossPackageViolation({
    candidateId: new ContentOpportunityId("opp-single-violation"),
    sourceReference: "knowledgevault:source-single",
    evidencePackageId: new BusinessPackageId("OTHER"),
    candidatePackageId: packageId,
  });

  const result = new ContentOpportunityBatchEvaluationResult([], [crossPackageViolation]);

  assert.equal(result.hasViolations, true);

  assert.throws(
    () => result.throwIfViolations(),
    (err: unknown) => {
      assert.ok(err instanceof ContentOpportunityIntelligenceException);
      assert.match(err.message, /1 violation[^s]/);
      assert.ok(err.message.includes(crossPackageViolation.detail));
      return true;
    },
  );
});

test("Draft and Validated items carrying a future approvedAt are still rejected by the status gate", () => {
  // A speculative or accidental approvedAt on a non-Approved item must not bypass the status check.
  // This guards against a future regression that uses approvedAt presence as an approval proxy.
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const adapterPackageId = new BusinessPackageId("ALIVO");

  const futureApprovedAt = new Date("2099-01-01T00:00:00.000Z");
  const validatedAt = new Date("2026-08-18T09:00:00.000Z");
  const baseDate = new Date("2026-08-18T08:00:00.000Z");

  // Draft item: no lifecycle timestamps are required by the constructor, but we attach a
  // speculative future approvedAt to simulate an accidental bypass attempt.
  const draftItem = new KnowledgeItem({
    id: new KnowledgeItemId("kv-draft-with-future-approved"),
    type: KnowledgeItemType.ApprovedNote,
    title: "Draft item with speculative future approvedAt",
    content: "Draft content that must not become evidence regardless of approvedAt.",
    status: KnowledgeStatus.Draft,
    source: KnowledgeSource.ApprovedResearch,
    confidence: 0.8,
    createdAt: baseDate,
    approvedAt: futureApprovedAt,
    language: "de",
    topicLabels: [],
  });

  // Validated item: validatedAt is required by the constructor; we also attach a speculative
  // future approvedAt to verify the timestamp does not override the status gate.
  const validatedItem = new KnowledgeItem({
    id: new KnowledgeItemId("kv-validated-with-future-approved"),
    type: KnowledgeItemType.ApprovedNote,
    title: "Validated item with speculative future approvedAt",
    content: "Validated content that must not become evidence regardless of approvedAt.",
    status: KnowledgeStatus.Validated,
    source: KnowledgeSource.ApprovedResearch,
    confidence: 0.85,
    createdAt: baseDate,
    validatedAt,
    approvedAt: futureApprovedAt,
    language: "de",
    topicLabels: [],
  });

  // Confirm the timestamps are actually present so the test genuinely exercises the bypass path.
  assert.ok(draftItem.approvedAt instanceof Date, "draft item must carry a non-nil approvedAt");
  assert.ok(validatedItem.approvedAt instanceof Date, "validated item must carry a non-nil approvedAt");

  const draftResult = adapter.normalize(
    { businessPackageId: adapterPackageId, item: draftItem, market: "DE" },
    adapterPackageId,
  );
  assert.equal(draftResult.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.match(draftResult.reason, /Draft/);
  assert.equal(draftResult.evidence, undefined);

  const validatedResult = adapter.normalize(
    { businessPackageId: adapterPackageId, item: validatedItem, market: "DE" },
    adapterPackageId,
  );
  assert.equal(validatedResult.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.match(validatedResult.reason, /Validated/);
  assert.equal(validatedResult.evidence, undefined);
});

test("throwIfViolations attaches the violations array to the thrown exception so callers can inspect individual violations without parsing the message string", () => {
  const service = new ContentOpportunityEvaluationService();
  const foreignPackageId = new BusinessPackageId("FOREIGN");

  const crossEvidence = evidence("cross", ContentOpportunityEvidenceSource.KnowledgeVault, ContentOpportunityEvidenceRole.Supporting, foreignPackageId);
  const misScoped = candidate("mis-scoped-throw", [crossEvidence]);
  const wellScoped = candidate("well-scoped-throw");

  const result = service.evaluateMany([wellScoped, misScoped], evaluatedAt);

  assert.equal(result.hasViolations, true);

  let caught: unknown;
  try {
    result.throwIfViolations();
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof ContentOpportunityIntelligenceException, "thrown error must be a ContentOpportunityIntelligenceException");
  // The violations array on the exception must be the same violations as on the result
  assert.equal(caught.violations.length, result.violations.length);
  assert.equal(caught.violations.length, 1);
  assert.ok(caught.violations[0] === result.violations[0], "exception violations must reference the same violation objects as the batch result");
  assert.equal(caught.violations[0]?.candidateId.value, "mis-scoped-throw");
  // The human-readable message must still list the violation detail
  assert.match(caught.message, /mis-scoped-throw/);
  assert.match(caught.message, /FOREIGN/);
  // The violations array on the exception must be frozen (read-only)
  assert.equal(Object.isFrozen(caught.violations), true);
});

test("throwIfViolations attaches all violations when a batch has multiple offenders so callers can route or count without parsing", () => {
  const service = new ContentOpportunityEvaluationService();
  const foreignPackageId = new BusinessPackageId("FOREIGN");

  const wrongLanguageEvidence = new ContentOpportunityEvidenceReference({
    businessPackageId: packageId,
    source: ContentOpportunityEvidenceSource.Web,
    sourceReference: "web:source-en-throw",
    evidenceReference: "web:evidence-en-throw",
    language: "en",
    market: "GB",
    role: ContentOpportunityEvidenceRole.Supporting,
  });

  const crossPackageEvidence = evidence("cross-throw", ContentOpportunityEvidenceSource.KnowledgeVault, ContentOpportunityEvidenceRole.Supporting, foreignPackageId);

  const crossScopeCandidate = candidate("cross-scope-throw", [wrongLanguageEvidence]);
  const crossPackageCandidate = candidate("cross-package-throw", [crossPackageEvidence]);
  const wellScoped = candidate("well-scoped-multi-throw");

  const result = service.evaluateMany([wellScoped, crossScopeCandidate, crossPackageCandidate], evaluatedAt);

  assert.equal(result.violations.length, 2);

  let caught: unknown;
  try {
    result.throwIfViolations();
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof ContentOpportunityIntelligenceException);
  // All violations must be attached — not just the first
  assert.equal(caught.violations.length, 2);
  assert.ok(caught.violations.every((v, i) => v === result.violations[i]), "exception violations must match result violations exactly, in order");
  // Callers can filter by kind without any string parsing
  const scopeViolations = caught.violations.filter((v) => v.kind === "cross-scope");
  const packageViolations = caught.violations.filter((v) => v.kind === "cross-package");
  assert.equal(scopeViolations.length, 1);
  assert.equal(packageViolations.length, 1);
  assert.equal(scopeViolations[0]?.candidateId.value, "cross-scope-throw");
  assert.equal(packageViolations[0]?.candidateId.value, "cross-package-throw");
  // The formatted message still enumerates both violations for human readers
  assert.match(caught.message, /2 violations/);
  assert.equal(Object.isFrozen(caught.violations), true);
});

test("ContentOpportunityIntelligenceException carries an empty frozen violations array when constructed without violations", () => {
  const error = new ContentOpportunityIntelligenceException("standalone error");
  assert.equal(error.violations.length, 0);
  assert.equal(Object.isFrozen(error.violations), true);
  assert.equal(error.code, "CONTENT_OPPORTUNITY_INVALID");
  assert.equal(error.name, "ContentOpportunityIntelligenceException");
});

test("throwIfViolations throws with code CONTENT_OPPORTUNITY_BATCH_VIOLATIONS so catch handlers can distinguish a batch policy failure from a construction error", () => {
  const crossPackageViolation = new ContentOpportunityCrossPackageViolation({
    candidateId: new ContentOpportunityId("opp-code-check"),
    sourceReference: "knowledgevault:source-code-check",
    evidencePackageId: new BusinessPackageId("OTHER"),
    candidatePackageId: packageId,
  });

  const result = new ContentOpportunityBatchEvaluationResult([], [crossPackageViolation]);

  let caught: unknown;
  try {
    result.throwIfViolations();
  } catch (err) {
    caught = err;
  }

  assert.ok(caught instanceof ContentOpportunityIntelligenceException, "must throw ContentOpportunityIntelligenceException");
  assert.equal(
    (caught as ContentOpportunityIntelligenceException).code,
    "CONTENT_OPPORTUNITY_BATCH_VIOLATIONS",
    "batch violation throw must use the dedicated batch code, not the generic construction-error code",
  );
});

test("throwIfViolations pins the batch code and preserves the result violations while remaining a no-op for an empty batch", () => {
  const crossPackageViolation = new ContentOpportunityCrossPackageViolation({
    candidateId: new ContentOpportunityId("opp-code-and-violations"),
    sourceReference: "knowledgevault:source-code-and-violations",
    evidencePackageId: new BusinessPackageId("OTHER"),
    candidatePackageId: packageId,
  });
  const result = new ContentOpportunityBatchEvaluationResult([], [crossPackageViolation]);

  assert.throws(
    () => result.throwIfViolations(),
    (error: unknown) => {
      assert.ok(error instanceof ContentOpportunityIntelligenceException);
      assert.equal(error.code, CONTENT_OPPORTUNITY_BATCH_VIOLATIONS_CODE);
      assert.deepEqual(error.violations, result.violations);
      return true;
    },
  );

  const emptyResult = new ContentOpportunityBatchEvaluationResult([], []);
  assert.doesNotThrow(() => emptyResult.throwIfViolations());
});

test("throwIfViolations batch code differs from the construction-error code so catch handlers can route the two failure kinds by code alone", () => {
  // Construction error (missing required field) must keep the original code.
  let constructionError: ContentOpportunityIntelligenceException | undefined;
  try {
    new ContentOpportunityId("");
  } catch (err) {
    if (err instanceof ContentOpportunityIntelligenceException) constructionError = err;
  }
  assert.ok(constructionError !== undefined, "construction must throw ContentOpportunityIntelligenceException");
  assert.equal(constructionError.code, "CONTENT_OPPORTUNITY_INVALID", "construction error must carry CONTENT_OPPORTUNITY_INVALID");

  // Batch violation throw must carry the dedicated code.
  const crossScopeViolation = new ContentOpportunityCrossScopeViolation({
    candidateId: new ContentOpportunityId("opp-code-diff"),
    sourceReference: "web:source-code-diff",
    evidenceLanguage: "fr",
    evidenceMarket: "FR",
    candidateLanguage: "de",
    candidateMarket: "DE",
  });

  const result = new ContentOpportunityBatchEvaluationResult([], [crossScopeViolation]);

  let batchError: ContentOpportunityIntelligenceException | undefined;
  try {
    result.throwIfViolations();
  } catch (err) {
    if (err instanceof ContentOpportunityIntelligenceException) batchError = err;
  }
  assert.ok(batchError !== undefined, "throwIfViolations must throw ContentOpportunityIntelligenceException");
  assert.equal(batchError.code, "CONTENT_OPPORTUNITY_BATCH_VIOLATIONS", "batch throw must carry CONTENT_OPPORTUNITY_BATCH_VIOLATIONS");

  // The two codes must be distinct — a catch handler that compares err.code can route them without message parsing.
  assert.notEqual(
    batchError.code,
    constructionError.code,
    "batch violation code must differ from construction-error code",
  );
});

test("throwIfViolations message count matches violations array length for a single violation", () => {
  const service = new ContentOpportunityEvaluationService();
  const foreignPackageId = new BusinessPackageId("FOREIGN-COUNT1");

  const crossEvidence = evidence("cross-count1", ContentOpportunityEvidenceSource.KnowledgeVault, ContentOpportunityEvidenceRole.Supporting, foreignPackageId);
  const misScoped = candidate("mis-scoped-count1", [crossEvidence]);

  const result = service.evaluateMany([misScoped], evaluatedAt);

  assert.equal(result.violations.length, 1);

  let caught: unknown;
  try {
    result.throwIfViolations();
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof ContentOpportunityIntelligenceException, "must throw ContentOpportunityIntelligenceException");

  // Extract the integer from the message prefix "Batch evaluation produced N violation(s)"
  const match = caught.message.match(/Batch evaluation produced (\d+) violation/);
  assert.ok(match !== null, "message must contain the violation count prefix");
  const countInMessage = Number(match![1]);

  // The count embedded in the message must equal the violations array length
  assert.equal(countInMessage, caught.violations.length,
    "integer in message must match violations array length so human and programmatic consumers stay in sync");
  assert.equal(countInMessage, 1);
});

test("throwIfViolations message count matches violations array length for two or more violations", () => {
  const service = new ContentOpportunityEvaluationService();
  const foreignPackageId = new BusinessPackageId("FOREIGN-COUNT2");

  const wrongLanguageEvidence = new ContentOpportunityEvidenceReference({
    businessPackageId: packageId,
    source: ContentOpportunityEvidenceSource.Web,
    sourceReference: "web:source-count2",
    evidenceReference: "web:evidence-count2",
    language: "en",
    market: "GB",
    role: ContentOpportunityEvidenceRole.Supporting,
  });

  const crossPackageEvidence = evidence("cross-count2", ContentOpportunityEvidenceSource.KnowledgeVault, ContentOpportunityEvidenceRole.Supporting, foreignPackageId);

  const crossScopeCandidate = candidate("cross-scope-count2", [wrongLanguageEvidence]);
  const crossPackageCandidate = candidate("cross-package-count2", [crossPackageEvidence]);

  const result = service.evaluateMany([crossScopeCandidate, crossPackageCandidate], evaluatedAt);

  assert.equal(result.violations.length, 2);

  let caught: unknown;
  try {
    result.throwIfViolations();
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof ContentOpportunityIntelligenceException, "must throw ContentOpportunityIntelligenceException");

  // Extract the integer from the message prefix "Batch evaluation produced N violation(s)"
  const match = caught.message.match(/Batch evaluation produced (\d+) violation/);
  assert.ok(match !== null, "message must contain the violation count prefix");
  const countInMessage = Number(match![1]);

  // The count embedded in the message must equal the violations array length
  assert.equal(countInMessage, caught.violations.length,
    "integer in message must match violations array length so human and programmatic consumers stay in sync");
  assert.equal(countInMessage, 2);
});

test("throwIfViolations message starts with the exact prefix 'Batch evaluation produced 1 violation:' for a single-violation batch", () => {
  const crossPackageViolation = new ContentOpportunityCrossPackageViolation({
    candidateId: new ContentOpportunityId("opp-prefix-single"),
    sourceReference: "knowledgevault:source-prefix-single",
    evidencePackageId: new BusinessPackageId("OTHER-PREFIX"),
    candidatePackageId: packageId,
  });

  const result = new ContentOpportunityBatchEvaluationResult([], [crossPackageViolation]);

  let caught: unknown;
  try {
    result.throwIfViolations();
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof ContentOpportunityIntelligenceException, "must throw ContentOpportunityIntelligenceException");
  assert.ok(
    caught.message.startsWith("Batch evaluation produced 1 violation:"),
    `message must start with exact prefix "Batch evaluation produced 1 violation:" but got: ${caught.message.slice(0, 80)}`,
  );
});

test("throwIfViolations message starts with the exact prefix 'Batch evaluation produced 2 violations:' for a two-violation batch", () => {
  const crossPackageViolation = new ContentOpportunityCrossPackageViolation({
    candidateId: new ContentOpportunityId("opp-prefix-two-pkg"),
    sourceReference: "knowledgevault:source-prefix-two",
    evidencePackageId: new BusinessPackageId("OTHER-PREFIX-TWO"),
    candidatePackageId: packageId,
  });

  const crossScopeViolation = new ContentOpportunityCrossScopeViolation({
    candidateId: new ContentOpportunityId("opp-prefix-two-scope"),
    sourceReference: "web:source-prefix-two",
    evidenceLanguage: "fr",
    evidenceMarket: "FR",
    candidateLanguage: "de",
    candidateMarket: "DE",
  });

  const result = new ContentOpportunityBatchEvaluationResult([], [crossPackageViolation, crossScopeViolation]);

  let caught: unknown;
  try {
    result.throwIfViolations();
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof ContentOpportunityIntelligenceException, "must throw ContentOpportunityIntelligenceException");
  assert.ok(
    caught.message.startsWith("Batch evaluation produced 2 violations:"),
    `message must start with exact prefix "Batch evaluation produced 2 violations:" but got: ${caught.message.slice(0, 80)}`,
  );
});

test("adapter rejection reason format is pinned so a template change cannot silently drop the status name", () => {
  // The exact message shape produced by the adapter is:
  //   Knowledge Vault item status "<Status>" is not Approved; only Approved items may be used as evidence.
  // This test asserts the full format for every non-Approved status so a refactor that restructures
  // the interpolation string (e.g. drops the quoted status value, changes "is not Approved", or moves
  // the status to a different position) is caught immediately rather than silently degrading to a
  // message that still passes a bare includes(status) check.
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const adapterPackageId = new BusinessPackageId("ALIVO-PIN");
  const baseDate = new Date("2026-08-18T08:00:00.000Z");
  const validatedDate = new Date("2026-08-18T09:00:00.000Z");

  const cases: Array<[KnowledgeStatus, { validatedAt?: Date }]> = [
    [KnowledgeStatus.Draft, {}],
    [KnowledgeStatus.Validated, { validatedAt: validatedDate }],
    [KnowledgeStatus.Deprecated, { validatedAt: validatedDate }],
    [KnowledgeStatus.Archived, { validatedAt: validatedDate }],
  ];

  for (const [status, extra] of cases) {
    const item = new KnowledgeItem({
      id: new KnowledgeItemId(`kv-pin-${status.toLowerCase()}`),
      type: KnowledgeItemType.ApprovedNote,
      title: `Pinned format check for ${status}`,
      content: `Content for pinned format test with status ${status}.`,
      status,
      source: KnowledgeSource.ApprovedResearch,
      confidence: 0.9,
      createdAt: baseDate,
      language: "de",
      topicLabels: [],
      ...extra,
    });

    const normalization = adapter.normalize(
      { businessPackageId: adapterPackageId, item, market: "DE" },
      adapterPackageId,
    );

    assert.equal(
      normalization.status,
      KnowledgeVaultEvidenceNormalizationStatus.Invalid,
      `Expected Invalid for status "${status}"`,
    );
    // Pin the complete message string verbatim — any change to the template
    // (punctuation, reordering, dropped interpolation, changed phrase) is caught immediately.
    assert.equal(
      normalization.reason,
      `Knowledge Vault item status "${status}" is not Approved; only Approved items may be used as evidence.`,
      `Rejection reason for "${status}" must exactly match the pinned format`,
    );
    assert.equal(normalization.evidence, undefined);
  }
});

test("observedAt fallback chain: input.observedAt wins, then item.approvedAt, then item.validatedAt, then item.createdAt", () => {
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const batchPackageId = new BusinessPackageId("ALIVO");

  const tsInput = new Date("2026-08-18T01:00:00.000Z");
  const tsApproved = new Date("2026-08-18T02:00:00.000Z");
  const tsValidated = new Date("2026-08-18T03:00:00.000Z");
  const tsCreated = new Date("2026-08-18T04:00:00.000Z");

  // Base approved item carrying all three item-level timestamps.
  // KnowledgeItem constructor enforces validatedAt and approvedAt for Approved status.
  const fullItem = new KnowledgeItem({
    id: new KnowledgeItemId("kv-fallback-full"),
    type: KnowledgeItemType.ApprovedNote,
    title: "Fallback chain test item — all timestamps",
    content: "Approved research note.",
    status: KnowledgeStatus.Approved,
    source: KnowledgeSource.ApprovedResearch,
    confidence: 0.9,
    createdAt: tsCreated,
    validatedAt: tsValidated,
    approvedAt: tsApproved,
    language: "de",
    topicLabels: [],
  });

  // Case 1: input.observedAt is set — it must win over all item timestamps.
  const case1 = adapter.normalize(
    { businessPackageId: batchPackageId, item: fullItem, market: "DE", observedAt: tsInput },
    batchPackageId,
  );
  assert.equal(case1.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  assert.equal(
    case1.evidence?.observedAt?.toISOString(),
    tsInput.toISOString(),
    "input.observedAt must take priority over all item timestamps",
  );

  // Case 2: input.observedAt absent — item.approvedAt must be used next.
  const case2 = adapter.normalize(
    { businessPackageId: batchPackageId, item: fullItem, market: "DE" },
    batchPackageId,
  );
  assert.equal(case2.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  assert.equal(
    case2.evidence?.observedAt?.toISOString(),
    tsApproved.toISOString(),
    "item.approvedAt must be used when input.observedAt is absent",
  );

  // Case 3: input.observedAt absent and item.approvedAt absent — item.validatedAt must be used.
  // KnowledgeItem is frozen and uses private fields in getters, so we use a Proxy that intercepts
  // specific properties while routing all other gets to the target (not the proxy receiver) so
  // private field access inside class getters resolves against the original instance.
  const noApprovedItem = new Proxy(fullItem, {
    get(target, prop) {
      if (prop === "approvedAt") return undefined;
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  const case3 = adapter.normalize(
    { businessPackageId: batchPackageId, item: noApprovedItem as KnowledgeItem, market: "DE" },
    batchPackageId,
  );
  assert.equal(case3.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  assert.equal(
    case3.evidence?.observedAt?.toISOString(),
    tsValidated.toISOString(),
    "item.validatedAt must be used when both input.observedAt and item.approvedAt are absent",
  );

  // Case 4: only item.createdAt is present — it must be the final fallback.
  // Proxy out both approvedAt and validatedAt to exercise the createdAt branch.
  const createdOnlyItem = new Proxy(fullItem, {
    get(target, prop) {
      if (prop === "approvedAt" || prop === "validatedAt") return undefined;
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  const case4 = adapter.normalize(
    { businessPackageId: batchPackageId, item: createdOnlyItem as KnowledgeItem, market: "DE" },
    batchPackageId,
  );
  assert.equal(case4.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  assert.equal(
    case4.evidence?.observedAt?.toISOString(),
    tsCreated.toISOString(),
    "item.createdAt must be the final fallback when all other timestamps are absent",
  );
});

test("normalizeMany mixed batch: valid language slot is Normalized while bad-language slot is Invalid — valid slots are not blocked by invalid neighbors", () => {
  // Guards against an eager-rethrow or short-circuit regression: if normalizeMany stopped
  // at the first failure, the all-invalid batch tests would still pass while this mixed
  // batch would silently lose the Normalized result.
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const adapterPackageId = new BusinessPackageId("ALIVO");
  const approvedAt = new Date("2026-08-18T09:00:00.000Z");

  const makeApprovedItem = (id: string, language: string): KnowledgeItem =>
    new KnowledgeItem({
      id: new KnowledgeItemId(id),
      type: KnowledgeItemType.ApprovedNote,
      title: `Item with language ${language}`,
      content: `Approved content with language "${language}".`,
      status: KnowledgeStatus.Approved,
      source: KnowledgeSource.ApprovedResearch,
      confidence: 0.9,
      createdAt: new Date("2026-08-18T08:00:00.000Z"),
      validatedAt: approvedAt,
      approvedAt,
      language,
      topicLabels: ["content-opportunity"],
    });

  // Slot 0: bad language code → Invalid
  // Slot 1: valid approved item with good language code → Normalized
  // Slot 2: another bad language code → Invalid
  // Slot 3: another valid approved item → Normalized
  const inputs = [
    { businessPackageId: adapterPackageId, item: makeApprovedItem("kv-mixed-lang-bad-1", "zz-toolong"), market: "DE" },
    { businessPackageId: adapterPackageId, item: makeApprovedItem("kv-mixed-lang-good-1", "de"), market: "DE" },
    { businessPackageId: adapterPackageId, item: makeApprovedItem("kv-mixed-lang-bad-2", "123"), market: "DE" },
    { businessPackageId: adapterPackageId, item: makeApprovedItem("kv-mixed-lang-good-2", "de"), market: "DE" },
  ];

  const results = adapter.normalizeMany(inputs, adapterPackageId);

  // Result length must match input length — no silent drops
  assert.equal(results.length, inputs.length, "result length must equal input length");

  // Slot 0: bad language → Invalid, no evidence
  assert.equal(results[0]?.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid,
    "bad-language slot must be Invalid");
  assert.equal(results[0]?.evidence, undefined,
    "Invalid slot must carry no evidence");

  // Slot 1: valid language → Normalized with evidence (not blocked by slot 0)
  assert.equal(results[1]?.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized,
    "valid-language slot must be Normalized even when preceded by an Invalid slot");
  assert.ok(results[1]?.evidence instanceof ContentOpportunityEvidenceReference,
    "Normalized slot must carry a ContentOpportunityEvidenceReference");

  // Slot 2: bad language → Invalid, no evidence
  assert.equal(results[2]?.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid,
    "second bad-language slot must be Invalid");
  assert.equal(results[2]?.evidence, undefined,
    "Invalid slot must carry no evidence");

  // Slot 3: valid language → Normalized with evidence (not blocked by slot 2)
  assert.equal(results[3]?.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized,
    "second valid-language slot must be Normalized even when preceded by an Invalid slot");
  assert.ok(results[3]?.evidence instanceof ContentOpportunityEvidenceReference,
    "Normalized slot must carry a ContentOpportunityEvidenceReference");

  // Aggregate invariants: Normalized slots carry evidence; Invalid slots do not
  const normalized = results.filter((r) => r.status === KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  const invalid = results.filter((r) => r.status === KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.equal(normalized.length, 2, "exactly two slots must be Normalized");
  assert.equal(invalid.length, 2, "exactly two slots must be Invalid");
  assert.ok(normalized.every((r) => r.evidence !== undefined), "every Normalized slot must carry evidence");
  assert.ok(invalid.every((r) => r.evidence === undefined), "no Invalid slot may carry evidence");

  // Result array is frozen
  assert.equal(Object.isFrozen(results), true);
});

test("normalizeMany mixed batch: valid market slot is Normalized while bad-market slot is Invalid — valid slots are not blocked by invalid neighbors", () => {
  // Parallel guard to the language-code test above, but exercising the market canonicalization
  // path. Ensures an eager-rethrow or short-circuit on bad market codes does not swallow
  // adjacent valid normalizations.
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const adapterPackageId = new BusinessPackageId("ALIVO");
  const approvedAt = new Date("2026-08-18T09:00:00.000Z");

  const approvedItemBase = {
    type: KnowledgeItemType.ApprovedNote,
    content: "Approved content for mixed-market batch test.",
    status: KnowledgeStatus.Approved,
    source: KnowledgeSource.ApprovedResearch,
    confidence: 0.9,
    createdAt: new Date("2026-08-18T08:00:00.000Z"),
    validatedAt: approvedAt,
    approvedAt,
    language: "de",
    topicLabels: ["content-opportunity"],
  };

  const makeApprovedItem = (id: string): KnowledgeItem =>
    new KnowledgeItem({ id: new KnowledgeItemId(id), title: `Item ${id}`, ...approvedItemBase });

  // Slot 0: bad market code → Invalid
  // Slot 1: valid approved item with good market code → Normalized
  // Slot 2: another bad market code → Invalid
  // Slot 3: another valid approved item → Normalized
  const inputs = [
    { businessPackageId: adapterPackageId, item: makeApprovedItem("kv-mixed-mkt-bad-1"), market: "BADMARKET" },
    { businessPackageId: adapterPackageId, item: makeApprovedItem("kv-mixed-mkt-good-1"), market: "DE" },
    { businessPackageId: adapterPackageId, item: makeApprovedItem("kv-mixed-mkt-bad-2"), market: "TOOLONGMKT" },
    { businessPackageId: adapterPackageId, item: makeApprovedItem("kv-mixed-mkt-good-2"), market: "DE" },
  ];

  const results = adapter.normalizeMany(inputs, adapterPackageId);

  // Result length must match input length — no silent drops
  assert.equal(results.length, inputs.length, "result length must equal input length");

  // Slot 0: bad market → Invalid, no evidence
  assert.equal(results[0]?.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid,
    "bad-market slot must be Invalid");
  assert.equal(results[0]?.evidence, undefined,
    "Invalid slot must carry no evidence");

  // Slot 1: valid market → Normalized with evidence (not blocked by slot 0)
  assert.equal(results[1]?.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized,
    "valid-market slot must be Normalized even when preceded by an Invalid slot");
  assert.ok(results[1]?.evidence instanceof ContentOpportunityEvidenceReference,
    "Normalized slot must carry a ContentOpportunityEvidenceReference");

  // Slot 2: bad market → Invalid, no evidence
  assert.equal(results[2]?.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid,
    "second bad-market slot must be Invalid");
  assert.equal(results[2]?.evidence, undefined,
    "Invalid slot must carry no evidence");

  // Slot 3: valid market → Normalized with evidence (not blocked by slot 2)
  assert.equal(results[3]?.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized,
    "second valid-market slot must be Normalized even when preceded by an Invalid slot");
  assert.ok(results[3]?.evidence instanceof ContentOpportunityEvidenceReference,
    "Normalized slot must carry a ContentOpportunityEvidenceReference");

  // Aggregate invariants: Normalized slots carry evidence; Invalid slots do not
  const normalized = results.filter((r) => r.status === KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  const invalid = results.filter((r) => r.status === KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.equal(normalized.length, 2, "exactly two slots must be Normalized");
  assert.equal(invalid.length, 2, "exactly two slots must be Invalid");
  assert.ok(normalized.every((r) => r.evidence !== undefined), "every Normalized slot must carry evidence");
  assert.ok(invalid.every((r) => r.evidence === undefined), "no Invalid slot may carry evidence");

  // Result array is frozen
  assert.equal(Object.isFrozen(results), true);
});
test("normalizeMany mixed batch with both bad-language and bad-market slots surfaces all failures independently — each slot reason names its own rejected code", () => {
  // Guards against a failure mode where one rejection kind shadows the other.
  // A batch interleaving bad-language and bad-market slots must produce one Invalid result
  // per slot, each reason naming its own specific rejected code, with no slot's failure
  // affecting adjacent slots of either kind.
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const adapterPackageId = new BusinessPackageId("ALIVO");
  const approvedAt = new Date("2026-08-18T09:00:00.000Z");

  const makeApprovedItem = (id: string, language: string): KnowledgeItem =>
    new KnowledgeItem({
      id: new KnowledgeItemId(id),
      type: KnowledgeItemType.ApprovedNote,
      title: `Item ${id}`,
      content: `Approved content with language "${language}".`,
      status: KnowledgeStatus.Approved,
      source: KnowledgeSource.ApprovedResearch,
      confidence: 0.9,
      createdAt: new Date("2026-08-18T08:00:00.000Z"),
      validatedAt: approvedAt,
      approvedAt,
      language,
      topicLabels: ["content-opportunity"],
    });

  // Slot 0: bad language code ("zz-toolong") with a good market → Invalid, reason names "zz-toolong"
  // Slot 1: bad market code ("BADMARKET") with a good language → Invalid, reason names "BADMARKET"
  // Slot 2: bad language code ("123") with a good market → Invalid, reason names "123"
  // Slot 3: bad market code ("TOOLONGMKT") with a good language → Invalid, reason names "TOOLONGMKT"
  const inputs = [
    { businessPackageId: adapterPackageId, item: makeApprovedItem("kv-mixed-bl-0", "zz-toolong"), market: "DE" },
    { businessPackageId: adapterPackageId, item: makeApprovedItem("kv-mixed-bm-1", "de"), market: "BADMARKET" },
    { businessPackageId: adapterPackageId, item: makeApprovedItem("kv-mixed-bl-2", "123"), market: "DE" },
    { businessPackageId: adapterPackageId, item: makeApprovedItem("kv-mixed-bm-3", "de"), market: "TOOLONGMKT" },
  ];

  const results = adapter.normalizeMany(inputs, adapterPackageId);

  // Result length must match input length — no silent drops
  assert.equal(results.length, inputs.length, "result length must equal input length");

  // Every slot must be Invalid — no failure kind blocks its neighbors
  assert.ok(
    results.every((r) => r.status === KnowledgeVaultEvidenceNormalizationStatus.Invalid),
    "every slot must be Invalid",
  );
  assert.ok(
    results.every((r) => r.evidence === undefined),
    "no Invalid slot may carry evidence",
  );

  // Slot 0: bad-language — reason must name the rejected language code, not a market code
  assert.ok(
    results[0]?.reason.includes("zz-toolong"),
    `slot 0 reason must contain rejected language code "zz-toolong" but got: "${results[0]?.reason}"`,
  );

  // Slot 1: bad-market — reason must name the rejected market code, not a language code
  assert.ok(
    results[1]?.reason.includes("BADMARKET"),
    `slot 1 reason must contain rejected market code "BADMARKET" but got: "${results[1]?.reason}"`,
  );

  // Slot 2: bad-language — reason must name its own rejected code, not slot 1's market code
  assert.ok(
    results[2]?.reason.includes("123"),
    `slot 2 reason must contain rejected language code "123" but got: "${results[2]?.reason}"`,
  );

  // Slot 3: bad-market — reason must name its own rejected code, not slot 2's language code
  assert.ok(
    results[3]?.reason.includes("TOOLONGMKT"),
    `slot 3 reason must contain rejected market code "TOOLONGMKT" but got: "${results[3]?.reason}"`,
  );

  // Cross-check: no reason bleeds into a neighboring slot's code
  assert.ok(
    !results[0]?.reason.includes("BADMARKET"),
    "slot 0 (bad-language) reason must not contain the adjacent bad-market code",
  );
  assert.ok(
    !results[1]?.reason.includes("zz-toolong"),
    "slot 1 (bad-market) reason must not contain the adjacent bad-language code",
  );

  // Result array is frozen
  assert.equal(Object.isFrozen(results), true, "result array must be frozen");
});

test("evaluateMany surfaces both cross-package and cross-scope violations for a single candidate rather than stopping at the first violation kind found", () => {
  const service = new ContentOpportunityEvaluationService();
  const foreignPackageId = new BusinessPackageId("FOREIGN");

  // One evidence reference stamped with a foreign Business Package (cross-package offender)
  const crossPackageEvidence = new ContentOpportunityEvidenceReference({
    businessPackageId: foreignPackageId,
    source: ContentOpportunityEvidenceSource.KnowledgeVault,
    sourceReference: "knowledgevault:source-foreign",
    evidenceReference: "knowledgevault:evidence-foreign",
    language: "de",
    market: "DE",
    role: ContentOpportunityEvidenceRole.Supporting,
  });

  // One evidence reference in the correct package but with the wrong language/market (cross-scope offender)
  const crossScopeEvidence = new ContentOpportunityEvidenceReference({
    businessPackageId: packageId,
    source: ContentOpportunityEvidenceSource.Web,
    sourceReference: "web:source-fr",
    evidenceReference: "web:evidence-fr",
    language: "fr",
    market: "FR",
    role: ContentOpportunityEvidenceRole.Supporting,
  });

  // Single candidate carrying both kinds of offending evidence
  const dualOffender = candidate("dual-offender", [crossPackageEvidence, crossScopeEvidence]);
  const wellScoped = candidate("well-scoped");

  const result = service.evaluateMany([wellScoped, dualOffender], evaluatedAt);

  // The well-scoped candidate must still be evaluated normally
  assert.equal(result.evaluations.length, 1, "well-scoped candidate must still be evaluated");
  assert.equal(result.evaluations[0]?.candidateId.value, "well-scoped");

  // The dual-offender candidate must be quarantined entirely — not partially scored
  assert.equal(result.violations.length, 2, "both violation kinds must surface in one pass");
  assert.equal(result.hasViolations, true);

  const pkgViolations = result.violations.filter((v) => v.kind === "cross-package") as ContentOpportunityCrossPackageViolation[];
  const scopeViolations = result.violations.filter((v) => v.kind === "cross-scope") as ContentOpportunityCrossScopeViolation[];

  // Cross-package violation must name the foreign-package reference
  assert.equal(pkgViolations.length, 1, "cross-package offender must produce a cross-package violation");
  assert.equal(pkgViolations[0]?.candidateId.value, "dual-offender");
  assert.equal(pkgViolations[0]?.sourceReference, crossPackageEvidence.sourceReference);
  assert.equal(pkgViolations[0]?.evidencePackageId.value, "FOREIGN");
  assert.equal(pkgViolations[0]?.candidatePackageId.value, packageId.value);

  // Cross-scope violation must name the wrong-language reference — not silently suppressed by the cross-package check
  assert.equal(scopeViolations.length, 1, "cross-scope offender must also produce a cross-scope violation, not be suppressed by the cross-package check");
  assert.equal(scopeViolations[0]?.candidateId.value, "dual-offender");
  assert.equal(scopeViolations[0]?.sourceReference, crossScopeEvidence.sourceReference);
  assert.equal(scopeViolations[0]?.evidenceLanguage, "fr");
  assert.equal(scopeViolations[0]?.evidenceMarket, "FR");
  assert.equal(scopeViolations[0]?.candidateLanguage, "de");
  assert.equal(scopeViolations[0]?.candidateMarket, "DE");
});

test("a field-validation guard exception carries an empty violations array so handlers can call .violations.length without a null check", () => {
  // Exercise two independent field-validation guards that throw directly,
  // without going through throwIfViolations — neither passes a violations array.
  let emptyTopicError: unknown;
  try {
    ContentOpportunityCandidate.fromPolicy(dePolicy, {
      id: new ContentOpportunityId("empty-topic-candidate"),
      target: ContentOpportunityTarget.Blog,
      topic: "",
      destination: new ContentOpportunityDestination(ContentOpportunityDestinationType.Book, "book:alivo-health"),
      contentReference: "knowledge:question-cluster:meal-fatigue",
      createdAt,
    });
  } catch (err) {
    emptyTopicError = err;
  }
  assert.ok(emptyTopicError instanceof ContentOpportunityIntelligenceException, "guard must throw ContentOpportunityIntelligenceException");
  assert.equal(emptyTopicError.code, "CONTENT_OPPORTUNITY_INVALID", "field-validation guard must use the default invalid code");
  assert.equal(emptyTopicError.violations.length, 0, "non-batch guard exception must carry an empty violations array");

  let emptyIdError: unknown;
  try {
    new ContentOpportunityId("");
  } catch (err) {
    emptyIdError = err;
  }
  assert.ok(emptyIdError instanceof ContentOpportunityIntelligenceException, "id guard must throw ContentOpportunityIntelligenceException");
  assert.equal(emptyIdError.code, "CONTENT_OPPORTUNITY_INVALID", "field-validation guard must use the default invalid code");
  assert.equal(emptyIdError.violations.length, 0, "non-batch id guard exception must carry an empty violations array");
});

test("a field-validation guard exception has a frozen violations array so the catch-site cannot accidentally mutate it", () => {
  let caughtError: unknown;
  try {
    ContentOpportunityCandidate.fromPolicy(dePolicy, {
      id: new ContentOpportunityId("frozen-violations-candidate"),
      target: ContentOpportunityTarget.Blog,
      topic: "  ",
      destination: new ContentOpportunityDestination(ContentOpportunityDestinationType.Book, "book:alivo-health"),
      contentReference: "knowledge:question-cluster:meal-fatigue",
      createdAt,
    });
  } catch (err) {
    caughtError = err;
  }
  assert.ok(caughtError instanceof ContentOpportunityIntelligenceException, "guard must throw ContentOpportunityIntelligenceException");
  assert.equal(Object.isFrozen(caughtError.violations), true, "violations array must be frozen on a non-batch guard exception");
});

test("exported error code constants are pinned so any rename is a deliberate, visible change", () => {
  // These constants are the compile-time-safe references used by exception constructors and catch
  // handlers. Pinning them here means a string rename immediately fails this test, preventing a
  // silent mismatch between throw sites and catch sites.
  assert.equal(CONTENT_OPPORTUNITY_INVALID_CODE, "CONTENT_OPPORTUNITY_INVALID");
  assert.equal(CONTENT_OPPORTUNITY_BATCH_VIOLATIONS_CODE, "CONTENT_OPPORTUNITY_BATCH_VIOLATIONS");

  // The default code on a field-validation exception matches the constant.
  const fieldError = new ContentOpportunityIntelligenceException("some field error");
  assert.equal(fieldError.code, CONTENT_OPPORTUNITY_INVALID_CODE);

  // throwIfViolations uses the batch-violations constant, not a bare string.
  const service = new ContentOpportunityEvaluationService();
  const foreignPackageId = new BusinessPackageId("FOREIGN");
  const misScoped = candidate("mis-scoped-code-pin", [
    evidence("cross", ContentOpportunityEvidenceSource.KnowledgeVault, ContentOpportunityEvidenceRole.Supporting, foreignPackageId),
  ]);
  const result = service.evaluateMany([misScoped], evaluatedAt);
  assert.equal(result.hasViolations, true);
  let caughtCode: string | undefined;
  try {
    result.throwIfViolations();
  } catch (err) {
    if (err instanceof ContentOpportunityIntelligenceException) caughtCode = err.code;
  }
  assert.equal(caughtCode, CONTENT_OPPORTUNITY_BATCH_VIOLATIONS_CODE);
});

test("violation kind survives JSON round-trip so log consumers can filter without re-importing TypeScript classes", () => {
  const crossPackageViolation = new ContentOpportunityCrossPackageViolation({
    candidateId: new ContentOpportunityId("candidate-pkg"),
    sourceReference: "knowledgevault:source-foreign",
    evidencePackageId: new BusinessPackageId("FOREIGN"),
    candidatePackageId: packageId,
  });

  const crossScopeViolation = new ContentOpportunityCrossScopeViolation({
    candidateId: new ContentOpportunityId("candidate-scope"),
    sourceReference: "web:source-fr",
    evidenceLanguage: "fr",
    evidenceMarket: "FR",
    candidateLanguage: "de",
    candidateMarket: "DE",
  });

  const parsedPackage = JSON.parse(JSON.stringify(crossPackageViolation));
  const parsedScope = JSON.parse(JSON.stringify(crossScopeViolation));

  assert.equal(parsedPackage.kind, "cross-package",
    "cross-package violation kind must survive JSON.stringify / JSON.parse so log consumers can filter by kind");
  assert.equal(parsedScope.kind, "cross-scope",
    "cross-scope violation kind must survive JSON.stringify / JSON.parse so log consumers can filter by kind");
});

test("KnowledgeVault adapter produces exact sourceReference and evidenceReference URI formats so a refactor cannot silently break downstream lineage consumers", () => {
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const itemId = new KnowledgeItemId("item-uri-pin-42");
  const validatedAt = new Date("2026-08-01T08:00:00.000Z");
  const approvedAt = new Date("2026-08-02T08:00:00.000Z");
  const item = new KnowledgeItem({
    id: itemId,
    type: KnowledgeItemType.Research,
    title: "URI format pin test item",
    content: "Content for URI format pin test",
    status: KnowledgeStatus.Approved,
    source: KnowledgeSource.ApprovedResearch,
    confidence: 0.9,
    language: "de",
    createdAt: new Date("2026-07-01T08:00:00.000Z"),
    validatedAt,
    approvedAt,
  });

  const normalization = adapter.normalize(
    { businessPackageId: packageId, item, market: "DE" },
    packageId,
  );

  assert.equal(normalization.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  assert.ok(normalization.evidence !== undefined);
  assert.equal(
    normalization.evidence.sourceReference,
    `knowledge-vault:ALIVO:source:ApprovedResearch:scope:de:DE`,
    "sourceReference must follow knowledge-vault:<packageId>:source:<item.source>:scope:<language>:<market>",
  );
  assert.equal(
    normalization.evidence.evidenceReference,
    `knowledge-vault:ALIVO:item:item-uri-pin-42:scope:de:DE`,
    "evidenceReference must follow knowledge-vault:<packageId>:item:<item.id.value>:scope:<language>:<market>",
  );
});

test("ExistingBlog adapter produces exact sourceReference and evidenceReference URI formats so a refactor cannot silently break downstream lineage consumers", () => {
  const adapter = new ExistingBlogContentOpportunityEvidenceAdapter();
  const normalization = adapter.normalize(
    {
      businessPackageId: packageId,
      blogReference: "blog-42",
      canonicalUrl: "https://alivo.example/blog/meal-fatigue",
      title: "Meal-related fatigue",
      language: "de",
      market: "DE",
      status: ExistingBlogEvidenceStatus.Approved,
      validity: ExistingBlogEvidenceValidity.Current,
    },
    packageId,
  );

  assert.equal(normalization.status, ExistingBlogEvidenceNormalizationStatus.Normalized);
  assert.ok(normalization.evidence !== undefined);
  assert.equal(
    normalization.evidence.sourceReference,
    "existing-blog:ALIVO:blog:blog-42:scope:de:DE",
    "sourceReference must follow existing-blog:<packageId>:blog:<blogReference>:scope:<language>:<market>",
  );
  assert.equal(
    normalization.evidence.evidenceReference,
    "https://alivo.example/blog/meal-fatigue:scope:de:DE",
    "evidenceReference must follow <canonicalUrl>:scope:<language>:<market>",
  );
});

test("Web Research adapter produces exact sourceReference and evidenceReference URI formats so a refactor cannot silently break downstream lineage consumers", () => {
  const adapter = new WebResearchContentOpportunityEvidenceAdapter();
  const sourceUrl = "https://research.example/articles/meal-fatigue?ref=web";
  const observedAt = new Date("2026-08-18T11:00:00.000Z");
  const normalization = adapter.normalize(
    {
      businessPackageId: packageId,
      contentReference: "content:meal-fatigue",
      sourceUrl,
      sourceTitle: "Meal-related fatigue research",
      publishedAt: new Date("2026-08-17T11:00:00.000Z"),
      observedAt,
      language: "de",
      market: "DE",
      relevanceExplanation: "The article addresses the target topic.",
      sourceQuality: WebResearchSourceQuality.High,
      evidenceConfidence: WebResearchEvidenceConfidence.High,
      evidenceStatus: WebResearchEvidenceStatus.Verified,
      validity: WebResearchEvidenceValidity.Current,
    },
    packageId,
  );

  assert.equal(normalization.status, WebResearchEvidenceNormalizationStatus.Normalized);
  assert.ok(normalization.evidence !== undefined);
  assert.equal(
    normalization.evidence.sourceReference,
    "web-research:ALIVO:source:https%3A%2F%2Fresearch.example%2Farticles%2Fmeal-fatigue%3Fref%3Dweb:scope:de:DE",
    "sourceReference must follow web-research:<packageId>:source:<encoded sourceUrl>:scope:<language>:<market>",
  );
  assert.equal(
    normalization.evidence.evidenceReference,
    "web-research-observation:ALIVO:content%3Ameal-fatigue:2026-08-18T11:00:00.000Z:scope:de:DE",
    "evidenceReference must follow web-research-observation:<packageId>:<encoded subject>:<observedAt>:scope:<language>:<market>",
  );
});

test("KnowledgeVault adapter defaults evidence role to Supporting when input.role is absent so a change to the default cannot silently shift scoring results", () => {
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const approvedAt = new Date("2026-08-18T09:00:00.000Z");
  const item = new KnowledgeItem({
    id: new KnowledgeItemId("kv-role-default-item"),
    type: KnowledgeItemType.ApprovedNote,
    title: "Role default pin item",
    content: "Approved content for role default pin test.",
    status: KnowledgeStatus.Approved,
    source: KnowledgeSource.ApprovedResearch,
    confidence: 0.9,
    createdAt: new Date("2026-08-18T08:00:00.000Z"),
    validatedAt: approvedAt,
    approvedAt,
    language: "de",
    topicLabels: ["content-opportunity"],
  });

  // No role provided — adapter must default to Supporting
  const withoutRole = adapter.normalize(
    { businessPackageId: packageId, item, market: "DE" },
    packageId,
  );
  assert.equal(withoutRole.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  assert.ok(withoutRole.evidence !== undefined);
  assert.equal(
    withoutRole.evidence.role,
    ContentOpportunityEvidenceRole.Supporting,
    "evidence role must default to Supporting when input.role is absent",
  );

  // Explicit role provided — adapter must preserve it unchanged
  const withContradictingRole = adapter.normalize(
    { businessPackageId: packageId, item, market: "DE", role: ContentOpportunityEvidenceRole.Contradicting },
    packageId,
  );
  assert.equal(withContradictingRole.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  assert.ok(withContradictingRole.evidence !== undefined);
  assert.equal(
    withContradictingRole.evidence.role,
    ContentOpportunityEvidenceRole.Contradicting,
    "explicit Contradicting role must be preserved and not overridden by the default",
  );
});

test("normalizeMany mixed batch: each Normalized slot carries its own language and market, not a neighbor's — guards against closure-sharing regression", () => {
  // Guards against a regression where the normalization loop shares or overwrites context
  // across slots (e.g. a mutable closure or wrong loop variable). If such a bug existed,
  // a Normalized result could silently carry the wrong language or market while its
  // status field still read "Normalized", passing coarser tests that only check status.
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const adapterPackageId = new BusinessPackageId("ALIVO");
  const approvedAt = new Date("2026-08-18T09:00:00.000Z");

  const makeApprovedItem = (id: string, language: string): KnowledgeItem =>
    new KnowledgeItem({
      id: new KnowledgeItemId(id),
      type: KnowledgeItemType.ApprovedNote,
      title: `Item ${id} (${language})`,
      content: `Approved content for ${id}.`,
      status: KnowledgeStatus.Approved,
      source: KnowledgeSource.ApprovedResearch,
      confidence: 0.9,
      createdAt: new Date("2026-08-18T08:00:00.000Z"),
      validatedAt: approvedAt,
      approvedAt,
      language,
      topicLabels: ["content-opportunity"],
    });

  // Slot 0: de/DE — valid, must normalize to de/DE
  // Slot 1: undefined — Invalid, must not affect neighbors
  // Slot 2: fr/FR — valid, must normalize to fr/FR (not de/DE from slot 0)
  const deItem = makeApprovedItem("kv-closure-de", "de");
  const frItem = makeApprovedItem("kv-closure-fr", "fr");

  const inputs: (KnowledgeVaultEvidenceInput | undefined)[] = [
    { businessPackageId: adapterPackageId, item: deItem, market: "DE" },
    undefined,
    { businessPackageId: adapterPackageId, item: frItem, market: "FR" },
  ];

  const results = adapter.normalizeMany(inputs, adapterPackageId);

  // One result per input — no silent drops
  assert.equal(results.length, inputs.length, "result length must equal input length");

  // Slot 0: de/DE → Normalized with de/DE content
  assert.equal(
    results[0]?.status,
    KnowledgeVaultEvidenceNormalizationStatus.Normalized,
    "de/DE slot must be Normalized",
  );
  assert.ok(
    results[0]?.evidence instanceof ContentOpportunityEvidenceReference,
    "de/DE slot must carry a ContentOpportunityEvidenceReference",
  );
  assert.equal(
    results[0]?.evidence?.language,
    "de",
    "de/DE slot evidence.language must be \"de\"",
  );
  assert.equal(
    results[0]?.evidence?.market,
    "DE",
    "de/DE slot evidence.market must be \"DE\"",
  );
  assert.ok(
    results[0]?.evidence?.evidenceReference.includes(":scope:de:DE"),
    `de/DE slot evidenceReference must contain ":scope:de:DE" but got: "${results[0]?.evidence?.evidenceReference}"`,
  );

  // Slot 1: undefined → Missing, no evidence
  assert.equal(
    results[1]?.status,
    KnowledgeVaultEvidenceNormalizationStatus.Missing,
    "undefined slot must be Missing",
  );
  assert.equal(results[1]?.evidence, undefined, "Missing slot must carry no evidence");

  // Slot 2: fr/FR → Normalized with fr/FR content — must not inherit de/DE from slot 0
  assert.equal(
    results[2]?.status,
    KnowledgeVaultEvidenceNormalizationStatus.Normalized,
    "fr/FR slot must be Normalized",
  );
  assert.ok(
    results[2]?.evidence instanceof ContentOpportunityEvidenceReference,
    "fr/FR slot must carry a ContentOpportunityEvidenceReference",
  );
  assert.equal(
    results[2]?.evidence?.language,
    "fr",
    "fr/FR slot evidence.language must be \"fr\", not the de/DE neighbor's language",
  );
  assert.equal(
    results[2]?.evidence?.market,
    "FR",
    "fr/FR slot evidence.market must be \"FR\", not the de/DE neighbor's market",
  );
  assert.ok(
    results[2]?.evidence?.evidenceReference.includes(":scope:fr:FR"),
    `fr/FR slot evidenceReference must contain ":scope:fr:FR" but got: "${results[2]?.evidence?.evidenceReference}"`,
  );

  // Cross-check: neither Normalized slot may carry the other's language or market
  assert.ok(
    !results[0]?.evidence?.evidenceReference.includes(":scope:fr:FR"),
    "de/DE slot evidenceReference must not contain the fr/FR neighbor's scope",
  );
  assert.ok(
    !results[2]?.evidence?.evidenceReference.includes(":scope:de:DE"),
    "fr/FR slot evidenceReference must not contain the de/DE neighbor's scope",
  );
  assert.notEqual(
    results[0]?.evidence?.language,
    results[2]?.evidence?.language,
    "the two Normalized slots must carry different languages",
  );
  assert.notEqual(
    results[0]?.evidence?.market,
    results[2]?.evidence?.market,
    "the two Normalized slots must carry different markets",
  );

  // Result array is frozen
  assert.equal(Object.isFrozen(results), true, "result array must be frozen");
});

test("serialized cross-package violation exposes candidateId and sourceReference as plain strings so log aggregators can filter without reconstructing class instances", () => {
  const foreignPackageId = new BusinessPackageId("FOREIGN");
  const crossPackageEvidence = new ContentOpportunityEvidenceReference({
    businessPackageId: foreignPackageId,
    source: ContentOpportunityEvidenceSource.KnowledgeVault,
    sourceReference: "knowledgevault:source-serial-test",
    evidenceReference: "knowledgevault:evidence-serial-test",
    language: "de",
    market: "DE",
    role: ContentOpportunityEvidenceRole.Supporting,
  });

  const service = new ContentOpportunityEvaluationService();
  const result = service.evaluateMany([candidate("serial-pkg-candidate", [crossPackageEvidence])], evaluatedAt);

  assert.equal(result.violations.length, 1);
  const violation = result.violations[0] as ContentOpportunityCrossPackageViolation;
  assert.equal(violation.kind, "cross-package");

  // Round-trip through JSON serialization.
  // toJSON() produces a flat object so all fields — including the `detail` getter — are
  // available at the top level of the parsed payload without reconstructing any class.
  const serialized = JSON.stringify(violation);
  const parsed = JSON.parse(serialized) as Record<string, unknown>;

  // kind is a top-level discriminator
  assert.equal(parsed["kind"], "cross-package");

  // candidateId is a plain string at the top level (not nested under properties)
  assert.equal(
    typeof parsed["candidateId"],
    "string",
    "candidateId must serialize as a plain string",
  );
  assert.equal(
    parsed["candidateId"],
    "serial-pkg-candidate",
    "candidateId string value must match the original",
  );

  // sourceReference is already a plain string and must survive unchanged
  assert.equal(
    typeof parsed["sourceReference"],
    "string",
    "sourceReference must survive JSON round-trip as a plain string",
  );
  assert.equal(parsed["sourceReference"], crossPackageEvidence.sourceReference);
});

test("serialized cross-scope violation exposes candidateId and sourceReference as plain strings so log aggregators can filter without reconstructing class instances", () => {
  const wrongScopeEvidence = new ContentOpportunityEvidenceReference({
    businessPackageId: packageId,
    source: ContentOpportunityEvidenceSource.Web,
    sourceReference: "web:source-serial-scope-test",
    evidenceReference: "web:evidence-serial-scope-test",
    language: "fr",
    market: "FR",
    role: ContentOpportunityEvidenceRole.Supporting,
  });

  const service = new ContentOpportunityEvaluationService();
  const result = service.evaluateMany([candidate("serial-scope-candidate", [wrongScopeEvidence])], evaluatedAt);

  assert.equal(result.violations.length, 1);
  const violation = result.violations[0] as ContentOpportunityCrossScopeViolation;
  assert.equal(violation.kind, "cross-scope");

  // Round-trip through JSON serialization.
  // toJSON() produces a flat object so all fields — including the `detail` getter — are
  // available at the top level of the parsed payload without reconstructing any class.
  const serialized = JSON.stringify(violation);
  const parsed = JSON.parse(serialized) as Record<string, unknown>;

  // kind is a top-level discriminator
  assert.equal(parsed["kind"], "cross-scope");

  // candidateId is a plain string at the top level (not nested under properties)
  assert.equal(
    typeof parsed["candidateId"],
    "string",
    "candidateId must serialize as a plain string",
  );
  assert.equal(
    parsed["candidateId"],
    "serial-scope-candidate",
    "candidateId string value must match the original",
  );

  // sourceReference is already a plain string and must survive unchanged
  assert.equal(
    typeof parsed["sourceReference"],
    "string",
    "sourceReference must survive JSON round-trip as a plain string",
  );
  assert.equal(parsed["sourceReference"], wrongScopeEvidence.sourceReference);

  // scope fields are plain strings at the top level and survive without reconstruction
  assert.equal(parsed["evidenceLanguage"], "fr");
  assert.equal(parsed["evidenceMarket"], "FR");
  assert.equal(parsed["candidateLanguage"], "de");
  assert.equal(parsed["candidateMarket"], "DE");
});

test("serialized cross-package violation includes detail as a plain string so log dashboards can display it without re-running a TypeScript getter", () => {
  const foreignPackageId = new BusinessPackageId("FOREIGN");
  const crossPackageEvidence = new ContentOpportunityEvidenceReference({
    businessPackageId: foreignPackageId,
    source: ContentOpportunityEvidenceSource.KnowledgeVault,
    sourceReference: "knowledgevault:source-detail-test",
    evidenceReference: "knowledgevault:evidence-detail-test",
    language: "de",
    market: "DE",
    role: ContentOpportunityEvidenceRole.Supporting,
  });

  const service = new ContentOpportunityEvaluationService();
  const result = service.evaluateMany([candidate("detail-pkg-candidate", [crossPackageEvidence])], evaluatedAt);

  assert.equal(result.violations.length, 1);
  const violation = result.violations[0] as ContentOpportunityCrossPackageViolation;

  // Capture the detail string before serialization — this is the canonical human-readable description.
  const runtimeDetail = violation.detail;
  assert.ok(runtimeDetail.includes("detail-pkg-candidate"), "runtime detail must name the candidate");
  assert.ok(runtimeDetail.includes("FOREIGN"), "runtime detail must name the evidence package");

  // Round-trip: toJSON() explicitly bakes detail into the payload so log dashboards can
  // read it from the serialized form without re-instantiating the class or calling the getter.
  const serialized = JSON.stringify(violation);
  const parsed = JSON.parse(serialized) as Record<string, unknown>;

  assert.equal(
    typeof parsed["detail"],
    "string",
    "detail must be present in the serialized payload as a plain string",
  );
  assert.equal(
    parsed["detail"],
    runtimeDetail,
    "serialized detail must match the value produced by the runtime getter",
  );
});

test("serialized cross-scope violation includes detail as a plain string so log dashboards can display it without re-running a TypeScript getter", () => {
  const wrongScopeEvidence = new ContentOpportunityEvidenceReference({
    businessPackageId: packageId,
    source: ContentOpportunityEvidenceSource.Web,
    sourceReference: "web:source-detail-scope-test",
    evidenceReference: "web:evidence-detail-scope-test",
    language: "fr",
    market: "FR",
    role: ContentOpportunityEvidenceRole.Supporting,
  });

  const service = new ContentOpportunityEvaluationService();
  const result = service.evaluateMany([candidate("detail-scope-candidate", [wrongScopeEvidence])], evaluatedAt);

  assert.equal(result.violations.length, 1);
  const violation = result.violations[0] as ContentOpportunityCrossScopeViolation;

  // Capture the detail string before serialization — this is the canonical human-readable description.
  const runtimeDetail = violation.detail;
  assert.ok(runtimeDetail.includes("detail-scope-candidate"), "runtime detail must name the candidate");
  assert.ok(runtimeDetail.includes("fr/FR"), "runtime detail must name the evidence scope");
  assert.ok(runtimeDetail.includes("de/DE"), "runtime detail must name the candidate scope");

  // Round-trip: toJSON() explicitly bakes detail into the payload so log dashboards can
  // read it from the serialized form without re-instantiating the class or calling the getter.
  const serialized = JSON.stringify(violation);
  const parsed = JSON.parse(serialized) as Record<string, unknown>;

  assert.equal(
    typeof parsed["detail"],
    "string",
    "detail must be present in the serialized payload as a plain string",
  );
  assert.equal(
    parsed["detail"],
    runtimeDetail,
    "serialized detail must match the value produced by the runtime getter",
  );
});

test("a single evidence reference that is simultaneously cross-package and cross-scope produces two independent violations — one per check", () => {
  // Design intent pinned here: evaluateMany() runs the cross-package filter and the cross-scope
  // filter independently and emits one violation per offending reference per check. A single
  // reference that fails both checks therefore produces two violations — a cross-package violation
  // AND a cross-scope violation — both naming the same sourceReference. This is deliberate: each
  // violation kind carries different diagnostic fields (evidencePackageId vs evidenceLanguage/
  // evidenceMarket) that operators need to correct each problem separately. If the filters are
  // ever merged, deduplicated, or short-circuited, this test will catch that regression.
  const service = new ContentOpportunityEvaluationService();
  const foreignPackageId = new BusinessPackageId("FOREIGN-DUAL");

  // One reference that simultaneously violates both checks:
  //   • wrong businessPackageId  (cross-package)
  //   • wrong language and market (cross-scope)
  const doublyOffendingEvidence = new ContentOpportunityEvidenceReference({
    businessPackageId: foreignPackageId,   // foreign package  → cross-package violation
    source: ContentOpportunityEvidenceSource.Web,
    sourceReference: "web:source-dual-offender",
    evidenceReference: "web:evidence-dual-offender",
    language: "fr",                        // wrong language  → cross-scope violation
    market: "FR",                          // wrong market    → cross-scope violation
    role: ContentOpportunityEvidenceRole.Supporting,
  });

  const dualOffender = candidate("dual-property-offender", [doublyOffendingEvidence]);

  const result = service.evaluateMany([dualOffender], evaluatedAt);

  // Candidate must be fully quarantined — no evaluations produced.
  assert.equal(result.evaluations.length, 0,
    "candidate whose sole reference fails both checks must not appear in evaluations");

  // Both checks fire independently on the same reference → exactly two violations.
  assert.equal(result.violations.length, 2,
    "one cross-package violation and one cross-scope violation must be emitted for the single doubly-offending reference");
  assert.equal(result.hasViolations, true);
  // Collection order is part of the batch contract: cross-package checks run before cross-scope
  // checks for each candidate. Keep these exact positions pinned so a reorder cannot silently
  // hand downstream consumers the wrong violation kind at a positional index.
  assert.equal(result.violations[0]?.kind, "cross-package",
    "the first violation must be cross-package");
  assert.equal(result.violations[1]?.kind, "cross-scope",
    "the second violation must be cross-scope");

  const pkgViolation = result.violations.find((v) => v.kind === "cross-package") as ContentOpportunityCrossPackageViolation | undefined;
  const scopeViolation = result.violations.find((v) => v.kind === "cross-scope") as ContentOpportunityCrossScopeViolation | undefined;

  // Cross-package violation must name the foreign package and the shared sourceReference.
  assert.ok(pkgViolation !== undefined, "a cross-package violation must be present");
  assert.equal(pkgViolation.candidateId.value, "dual-property-offender");
  assert.equal(pkgViolation.sourceReference, doublyOffendingEvidence.sourceReference,
    "cross-package violation must name the doubly-offending reference");
  assert.equal(pkgViolation.evidencePackageId.value, "FOREIGN-DUAL");
  assert.equal(pkgViolation.candidatePackageId.value, packageId.value);

  // Cross-scope violation must also name the same sourceReference with scope detail.
  assert.ok(scopeViolation !== undefined, "a cross-scope violation must be present");
  assert.equal(scopeViolation.candidateId.value, "dual-property-offender");
  assert.equal(scopeViolation.sourceReference, doublyOffendingEvidence.sourceReference,
    "cross-scope violation must name the same doubly-offending reference as the cross-package violation");
  assert.equal(scopeViolation.evidenceLanguage, "fr");
  assert.equal(scopeViolation.evidenceMarket, "FR");
  assert.equal(scopeViolation.candidateLanguage, "de");
  assert.equal(scopeViolation.candidateMarket, "DE");

  // Both violations name the same sourceReference, confirming they refer to the same reference.
  assert.equal(pkgViolation.sourceReference, scopeViolation.sourceReference,
    "both violations must name the same sourceReference — the single doubly-offending reference");
});
