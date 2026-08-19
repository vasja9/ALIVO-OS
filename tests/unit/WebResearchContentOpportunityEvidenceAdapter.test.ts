import assert from "node:assert/strict";
import { test } from "node:test";
import { BusinessPackageId } from "../../src/intelligence/market/MarketIntelligenceDomain.ts";
import {
  ContentOpportunityEvidenceRole,
  ContentOpportunityEvidenceSource,
} from "../../src/business/content/opportunities/ContentOpportunityIntelligenceDomain.ts";
import {
  WebResearchContentOpportunityEvidenceAdapter,
  WebResearchEvidenceConfidence,
  WebResearchEvidenceNormalizationStatus,
  WebResearchEvidenceStatus,
  WebResearchEvidenceValidity,
  WebResearchSourceQuality,
  type WebResearchEvidenceInput,
} from "../../src/business/content/opportunities/WebResearchContentOpportunityEvidenceAdapter.ts";

const packageId = new BusinessPackageId("ALIVO");
const otherPackageId = new BusinessPackageId("OTHER");
const publishedAt = new Date("2026-08-17T00:00:00.000Z");
const observedAt = new Date("2026-08-18T12:00:00.000Z");

const source = (overrides: Partial<WebResearchEvidenceInput> = {}): WebResearchEvidenceInput => ({
  businessPackageId: packageId,
  topic: "meal fatigue",
  contentReference: "opportunity:meal-fatigue",
  sourceUrl: "https://research.example/articles/meal-fatigue",
  sourceTitle: "Published nutrition research",
  publishedAt,
  observedAt,
  language: "de",
  market: "DE",
  relevanceExplanation: "The finding directly addresses the target question and market.",
  sourceQuality: WebResearchSourceQuality.High,
  evidenceConfidence: WebResearchEvidenceConfidence.High,
  evidenceStatus: WebResearchEvidenceStatus.Verified,
  validity: WebResearchEvidenceValidity.Current,
  ...overrides,
});

test("normalizes a valid, already acquired web finding into the Web evidence contract", () => {
  const normalized = new WebResearchContentOpportunityEvidenceAdapter().normalize(source(), packageId);

  assert.equal(normalized.status, WebResearchEvidenceNormalizationStatus.Normalized);
  assert.equal(normalized.evidence?.source, ContentOpportunityEvidenceSource.Web);
  assert.equal(normalized.evidence?.businessPackageId, packageId);
  assert.equal(
    normalized.evidence?.sourceReference,
    "web-research:ALIVO:source:https%3A%2F%2Fresearch.example%2Farticles%2Fmeal-fatigue:scope:de:DE",
  );
  assert.equal(
    normalized.evidence?.evidenceReference,
    "web-research-observation:ALIVO:opportunity%3Ameal-fatigue:2026-08-18T12:00:00.000Z:scope:de:DE",
  );
  assert.match(normalized.evidence?.explanation ?? "", /Published nutrition research/);
  assert.match(normalized.evidence?.explanation ?? "", /source quality=High/);
  assert.match(normalized.evidence?.explanation ?? "", /evidence confidence=High/);
  assert.equal(normalized.evidence?.observedAt?.toISOString(), observedAt.toISOString());
});

test("uses publication date as the observation timestamp when no observation timestamp is supplied", () => {
  const normalized = new WebResearchContentOpportunityEvidenceAdapter().normalize(
    source({ observedAt: undefined }),
    packageId,
  );

  assert.equal(normalized.status, WebResearchEvidenceNormalizationStatus.Normalized);
  assert.equal(normalized.evidence?.observedAt?.toISOString(), publishedAt.toISOString());
});

test("preserves supporting, contradicting, and neutral roles", () => {
  const adapter = new WebResearchContentOpportunityEvidenceAdapter();
  for (const role of [
    ContentOpportunityEvidenceRole.Supporting,
    ContentOpportunityEvidenceRole.Contradicting,
    ContentOpportunityEvidenceRole.Neutral,
  ]) {
    const normalized = adapter.normalize(source({ role }), packageId);
    assert.equal(normalized.status, WebResearchEvidenceNormalizationStatus.Normalized);
    assert.equal(normalized.evidence?.role, role);
  }
});

test("returns missing, insufficient, and stale results without producing evidence", () => {
  const adapter = new WebResearchContentOpportunityEvidenceAdapter();
  const missing = adapter.normalize(undefined, packageId);
  const unverified = adapter.normalize(source({ evidenceStatus: WebResearchEvidenceStatus.Unverified }), packageId);
  const lowQuality = adapter.normalize(source({ sourceQuality: WebResearchSourceQuality.Low }), packageId);
  const stale = adapter.normalize(source({ validity: WebResearchEvidenceValidity.Stale }), packageId);

  assert.equal(missing.status, WebResearchEvidenceNormalizationStatus.Missing);
  assert.equal(unverified.status, WebResearchEvidenceNormalizationStatus.Insufficient);
  assert.equal(lowQuality.status, WebResearchEvidenceNormalizationStatus.Insufficient);
  assert.equal(stale.status, WebResearchEvidenceNormalizationStatus.Stale);
  assert.equal(missing.evidence, undefined);
  assert.equal(unverified.evidence, undefined);
  assert.equal(lowQuality.evidence, undefined);
  assert.equal(stale.evidence, undefined);
});

test("rejects invalid, incomplete, and cross-package web evidence", () => {
  const adapter = new WebResearchContentOpportunityEvidenceAdapter();
  const badUrl = adapter.normalize(source({ sourceUrl: "file:///tmp/research.html" }), packageId);
  const noSubject = adapter.normalize(source({ topic: undefined, contentReference: undefined }), packageId);
  const noTime = adapter.normalize(source({ publishedAt: undefined, observedAt: undefined }), packageId);
  const invalidDate = adapter.normalize(source({ observedAt: new Date("invalid") }), packageId);
  const rejected = adapter.normalize(source({ evidenceStatus: WebResearchEvidenceStatus.Rejected }), packageId);
  const crossPackage = adapter.normalize(source({ businessPackageId: otherPackageId }), packageId);

  assert.equal(badUrl.status, WebResearchEvidenceNormalizationStatus.Invalid);
  assert.equal(noSubject.status, WebResearchEvidenceNormalizationStatus.Invalid);
  assert.equal(noTime.status, WebResearchEvidenceNormalizationStatus.Invalid);
  assert.equal(invalidDate.status, WebResearchEvidenceNormalizationStatus.Invalid);
  assert.equal(rejected.status, WebResearchEvidenceNormalizationStatus.Invalid);
  assert.equal(crossPackage.status, WebResearchEvidenceNormalizationStatus.Invalid);
  assert.equal(crossPackage.reason, "Web Research evidence crosses a Business Package boundary.");
  assert.equal(crossPackage.evidence, undefined);
});

test("is deterministic, immutable, and exposes only a read-only adapter boundary", () => {
  const adapter = new WebResearchContentOpportunityEvidenceAdapter();
  const first = adapter.normalize(source(), packageId);
  const second = adapter.normalize(source(), packageId);
  const many = adapter.normalizeMany([source(), undefined], packageId);

  assert.deepEqual(
    [first.status, first.evidence?.sourceReference, first.evidence?.evidenceReference, first.evidence?.explanation],
    [second.status, second.evidence?.sourceReference, second.evidence?.evidenceReference, second.evidence?.explanation],
  );
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.evidence), true);
  assert.equal(Object.isFrozen(many), true);
  assert.deepEqual(Object.getOwnPropertyNames(Object.getPrototypeOf(adapter)), ["constructor", "normalize", "normalizeMany"]);
});