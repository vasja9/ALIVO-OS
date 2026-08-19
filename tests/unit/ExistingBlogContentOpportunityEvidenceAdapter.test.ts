import assert from "node:assert/strict";
import { test } from "node:test";
import { BusinessPackageId } from "../../src/intelligence/market/MarketIntelligenceDomain.ts";
import {
  ContentOpportunityEvidenceRole,
  ContentOpportunityEvidenceSource,
} from "../../src/business/content/opportunities/ContentOpportunityIntelligenceDomain.ts";
import {
  ExistingBlogContentOpportunityEvidenceAdapter,
  ExistingBlogEvidenceNormalizationStatus,
  ExistingBlogEvidenceStatus,
  ExistingBlogEvidenceValidity,
} from "../../src/business/content/opportunities/ExistingBlogContentOpportunityEvidenceAdapter.ts";
import type { ExistingBlogEvidenceInput } from "../../src/business/content/opportunities/ExistingBlogContentOpportunityEvidenceAdapter.ts";

const packageId = new BusinessPackageId("ALIVO");
const otherPackageId = new BusinessPackageId("OTHER");
const observedAt = new Date("2026-08-18T12:00:00.000Z");

const blog = (
  overrides: Partial<ExistingBlogEvidenceInput> = {},
): ExistingBlogEvidenceInput => ({
  businessPackageId: packageId,
  blogReference: "blog:meal-fatigue",
  canonicalUrl: "https://alivo.example/blog/meal-fatigue",
  title: "Meal-related fatigue",
  language: "de",
  market: "DE",
  status: ExistingBlogEvidenceStatus.Published,
  validity: ExistingBlogEvidenceValidity.Current,
  observedAt,
  ...overrides,
});

test("normalizes a valid Existing Blog evidence reference", () => {
  const normalized = new ExistingBlogContentOpportunityEvidenceAdapter().normalize(blog(), packageId);

  assert.equal(normalized.status, ExistingBlogEvidenceNormalizationStatus.Normalized);
  assert.equal(normalized.evidence?.source, ContentOpportunityEvidenceSource.ExistingBlog);
  assert.equal(normalized.evidence?.role, ContentOpportunityEvidenceRole.Supporting);
  assert.equal(normalized.evidence?.sourceReference, "existing-blog:ALIVO:blog:blog:meal-fatigue:scope:de:DE");
  assert.equal(normalized.evidence?.evidenceReference, "https://alivo.example/blog/meal-fatigue:scope:de:DE");
  assert.match(normalized.evidence?.explanation ?? "", /Meal-related fatigue/);
  assert.equal(normalized.evidence?.observedAt?.toISOString(), observedAt.toISOString());
});

test("preserves supporting, contradicting, and neutral roles with deterministic identity", () => {
  const adapter = new ExistingBlogContentOpportunityEvidenceAdapter();
  const roles = [
    ContentOpportunityEvidenceRole.Supporting,
    ContentOpportunityEvidenceRole.Contradicting,
    ContentOpportunityEvidenceRole.Neutral,
  ];

  for (const role of roles) {
    const normalized = adapter.normalize(blog({ role }), packageId);
    assert.equal(normalized.status, ExistingBlogEvidenceNormalizationStatus.Normalized);
    assert.equal(normalized.evidence?.role, role);
    assert.equal(normalized.evidence?.sourceReference, "existing-blog:ALIVO:blog:blog:meal-fatigue:scope:de:DE");
  }
});

test("handles missing and invalid Existing Blog evidence deterministically", () => {
  const adapter = new ExistingBlogContentOpportunityEvidenceAdapter();
  const missing = adapter.normalize(undefined, packageId);
  const missingIdentity = adapter.normalize(blog({ blogReference: undefined, canonicalUrl: undefined }), packageId);
  const invalidStatus = adapter.normalize(blog({ status: ExistingBlogEvidenceStatus.Draft }), packageId);
  const invalidValidity = adapter.normalize(blog({ validity: ExistingBlogEvidenceValidity.Stale }), packageId);
  const invalidUrl = adapter.normalize(blog({ canonicalUrl: "not-a-url" }), packageId);

  assert.equal(missing.status, ExistingBlogEvidenceNormalizationStatus.Missing);
  assert.equal(missing.evidence, undefined);
  assert.equal(missing.reason, "Existing Blog evidence is missing.");
  assert.equal(missingIdentity.status, ExistingBlogEvidenceNormalizationStatus.Invalid);
  assert.equal(invalidStatus.status, ExistingBlogEvidenceNormalizationStatus.Invalid);
  assert.equal(invalidValidity.status, ExistingBlogEvidenceNormalizationStatus.Invalid);
  assert.equal(invalidUrl.status, ExistingBlogEvidenceNormalizationStatus.Invalid);
  assert.equal(invalidUrl.evidence, undefined);
});

test("stamps normalized evidence with expectedBusinessPackageId, not the value from raw input", () => {
  const adapter = new ExistingBlogContentOpportunityEvidenceAdapter();

  // Use a distinct object with the same value to prove the stamp is taken from expectedBusinessPackageId
  // and not copied from the raw input's businessPackageId reference.
  const rawPackageId = new BusinessPackageId(packageId.value);
  const normalized = adapter.normalize(blog({ businessPackageId: rawPackageId }), packageId);
  assert.equal(normalized.status, ExistingBlogEvidenceNormalizationStatus.Normalized);
  assert.ok(normalized.evidence, "evidence must be present on success");
  assert.strictEqual(
    normalized.evidence.businessPackageId,
    packageId,
    "stamp must be the expectedBusinessPackageId reference, not the one from raw input",
  );
  assert.notStrictEqual(
    normalized.evidence.businessPackageId,
    rawPackageId,
    "stamp must not be copied from the raw input's businessPackageId",
  );

  // undefined entire input must return Missing, never throw
  assert.doesNotThrow(() => {
    const missing = adapter.normalize(undefined, packageId);
    assert.equal(missing.status, ExistingBlogEvidenceNormalizationStatus.Missing);
    assert.equal(missing.evidence, undefined);
    assert.ok(missing.reason.length > 0, "reason must be present");
  });

  // Valid fixture with businessPackageId: undefined must return Invalid (unstamped input caught before evaluation)
  const unstamped = adapter.normalize(
    blog({ businessPackageId: undefined as unknown as BusinessPackageId }),
    packageId,
  );
  assert.equal(unstamped.status, ExistingBlogEvidenceNormalizationStatus.Invalid);
  assert.equal(unstamped.evidence, undefined);
  assert.match(unstamped.reason, /Business Package/);

  // Mismatched input id must be rejected before any stamp is written
  const mismatched = adapter.normalize(blog({ businessPackageId: otherPackageId }), packageId);
  assert.equal(mismatched.status, ExistingBlogEvidenceNormalizationStatus.Invalid);
  assert.equal(mismatched.evidence, undefined);
  assert.match(mismatched.reason, /Business Package boundary/);
});

test("rejects cross-package blogs and preserves immutable deterministic results", () => {
  const adapter = new ExistingBlogContentOpportunityEvidenceAdapter();
  const crossPackage = adapter.normalize(blog({ businessPackageId: otherPackageId }), packageId);
  const first = adapter.normalize(blog(), packageId);
  const second = adapter.normalize(blog(), packageId);
  const many = adapter.normalizeMany([blog(), undefined], packageId);

  assert.equal(crossPackage.status, ExistingBlogEvidenceNormalizationStatus.Invalid);
  assert.equal(crossPackage.reason, "Existing Blog evidence crosses a Business Package boundary.");
  assert.equal(crossPackage.evidence, undefined);
  assert.deepEqual(
    [first.status, first.evidence?.sourceReference, first.evidence?.evidenceReference],
    [second.status, second.evidence?.sourceReference, second.evidence?.evidenceReference],
  );
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.evidence), true);
  assert.equal(Object.isFrozen(many), true);
});