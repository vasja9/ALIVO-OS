import assert from "node:assert/strict";
import { test } from "node:test";
import { BusinessPackageId } from "../../src/intelligence/market/MarketIntelligenceDomain.ts";
import { MetricAvailability } from "../../src/business/market/performance/PerformanceIntelligenceDomain.ts";
import {
  ContentOpportunityEvidenceRole,
  ContentOpportunityEvidenceSource,
} from "../../src/business/content/opportunities/ContentOpportunityIntelligenceDomain.ts";
import {
  PinterestPerformanceContentOpportunityEvidenceAdapter,
  PinterestPerformanceEvidenceNormalizationStatus,
  PinterestPerformancePublicationStatus,
  type PinterestPerformanceEvidenceInput,
} from "../../src/business/content/opportunities/PinterestPerformanceContentOpportunityEvidenceAdapter.ts";

const packageId = new BusinessPackageId("ALIVO");
const otherPackageId = new BusinessPackageId("OTHER");
const observedAt = new Date("2026-08-18T12:00:00.000Z");

const pin = (overrides: Partial<PinterestPerformanceEvidenceInput> = {}): PinterestPerformanceEvidenceInput => ({
  businessPackageId: packageId,
  pinReference: "pin-123",
  publicationReference: "publication-123",
  publicationStatus: PinterestPerformancePublicationStatus.Published,
  contentReference: "blog:meal-fatigue",
  topic: "meal fatigue",
  destinationReference: "https://alivo.example/blog/meal-fatigue",
  language: "de",
  market: "DE",
  signals: [
    { name: "Impressions", value: 1200, availability: MetricAvailability.Available },
    { name: "OutboundClicks", value: 48, availability: MetricAvailability.Available },
    { name: "Saves", value: 17, availability: MetricAvailability.Available },
    { name: "CTR", value: 0.04, availability: MetricAvailability.Available },
  ],
  observedAt,
  ...overrides,
});

test("normalizes valid published Pin performance into the existing evidence contract", () => {
  const normalized = new PinterestPerformanceContentOpportunityEvidenceAdapter().normalize(pin(), packageId);

  assert.equal(normalized.status, PinterestPerformanceEvidenceNormalizationStatus.Normalized);
  assert.equal(normalized.evidence?.source, ContentOpportunityEvidenceSource.PinterestPerformance);
  assert.equal(normalized.evidence?.role, ContentOpportunityEvidenceRole.Supporting);
  assert.equal(
    normalized.evidence?.sourceReference,
    "pinterest-performance:ALIVO:publication:publication-123:pin:pin-123:scope:de:DE",
  );
  assert.equal(
    normalized.evidence?.evidenceReference,
    "pinterest-performance-observation:ALIVO:publication-123:pin-123:2026-08-18T12:00:00.000Z:scope:de:DE",
  );
  assert.match(normalized.evidence?.explanation ?? "", /Impressions=1200 count/);
  assert.match(normalized.evidence?.explanation ?? "", /OutboundClicks=48 count/);
  assert.match(normalized.evidence?.explanation ?? "", /topic=meal fatigue/);
  assert.match(normalized.evidence?.explanation ?? "", /destination=https:\/\/alivo\.example\/blog\/meal-fatigue/);
  assert.equal(normalized.evidence?.observedAt?.toISOString(), observedAt.toISOString());
});

test("preserves performance evidence roles and supports neutral unavailable signals", () => {
  const adapter = new PinterestPerformanceContentOpportunityEvidenceAdapter();
  for (const role of [
    ContentOpportunityEvidenceRole.Supporting,
    ContentOpportunityEvidenceRole.Contradicting,
    ContentOpportunityEvidenceRole.Neutral,
  ]) {
    const normalized = adapter.normalize(pin({
      role,
      signals: [
        { name: "Impressions", value: 0, availability: MetricAvailability.Available },
        { name: "Clicks", availability: MetricAvailability.Unavailable },
      ],
    }), packageId);
    assert.equal(normalized.status, PinterestPerformanceEvidenceNormalizationStatus.Normalized);
    assert.equal(normalized.evidence?.role, role);
  }
});

test("returns missing or insufficient for absent and non-measured performance evidence", () => {
  const adapter = new PinterestPerformanceContentOpportunityEvidenceAdapter();
  const missing = adapter.normalize(undefined, packageId);
  const noSignals = adapter.normalize(pin({ signals: [] }), packageId);
  const unavailable = adapter.normalize(pin({
    signals: [{ name: "CTR", availability: MetricAvailability.Unavailable }],
  }), packageId);

  assert.equal(missing.status, PinterestPerformanceEvidenceNormalizationStatus.Missing);
  assert.equal(missing.evidence, undefined);
  assert.equal(noSignals.status, PinterestPerformanceEvidenceNormalizationStatus.Insufficient);
  assert.equal(unavailable.status, PinterestPerformanceEvidenceNormalizationStatus.Insufficient);
  assert.equal(unavailable.evidence, undefined);
});

test("rejects invalid and cross-package performance evidence", () => {
  const adapter = new PinterestPerformanceContentOpportunityEvidenceAdapter();
  const unpublished = adapter.normalize(pin({ publicationStatus: PinterestPerformancePublicationStatus.Draft }), packageId);
  const malformedSignal = adapter.normalize(pin({
    signals: [{ name: "Clicks", value: -1, availability: MetricAvailability.Available }],
  }), packageId);
  const invalidTimestamp = adapter.normalize(pin({ observedAt: new Date("invalid") }), packageId);
  const crossPackage = adapter.normalize(pin({ businessPackageId: otherPackageId }), packageId);

  assert.equal(unpublished.status, PinterestPerformanceEvidenceNormalizationStatus.Invalid);
  assert.equal(malformedSignal.status, PinterestPerformanceEvidenceNormalizationStatus.Invalid);
  assert.equal(invalidTimestamp.status, PinterestPerformanceEvidenceNormalizationStatus.Invalid);
  assert.equal(crossPackage.status, PinterestPerformanceEvidenceNormalizationStatus.Invalid);
  assert.equal(crossPackage.reason, "Pinterest Performance evidence crosses a Business Package boundary.");
  assert.equal(crossPackage.evidence, undefined);
});

test("stamps normalized evidence with expectedBusinessPackageId, not the value from raw input", () => {
  const adapter = new PinterestPerformanceContentOpportunityEvidenceAdapter();

  // Use a distinct object with the same value to prove the stamp is taken from expectedBusinessPackageId
  // and not copied from the raw input's businessPackageId reference.
  const rawPackageId = new BusinessPackageId(packageId.value);
  const normalized = adapter.normalize(pin({ businessPackageId: rawPackageId }), packageId);
  assert.equal(normalized.status, PinterestPerformanceEvidenceNormalizationStatus.Normalized);
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
    assert.equal(missing.status, PinterestPerformanceEvidenceNormalizationStatus.Missing);
    assert.equal(missing.evidence, undefined);
    assert.ok(missing.reason.length > 0, "reason must be present");
  });

  // Valid fixture with businessPackageId: undefined must return Invalid (unstamped input caught before evaluation)
  const unstamped = adapter.normalize(
    pin({ businessPackageId: undefined as unknown as BusinessPackageId }),
    packageId,
  );
  assert.equal(unstamped.status, PinterestPerformanceEvidenceNormalizationStatus.Invalid);
  assert.equal(unstamped.evidence, undefined);
  assert.match(unstamped.reason, /Business Package/);

  // Mismatched input id must be rejected before any stamp is written
  const mismatched = adapter.normalize(pin({ businessPackageId: otherPackageId }), packageId);
  assert.equal(mismatched.status, PinterestPerformanceEvidenceNormalizationStatus.Invalid);
  assert.equal(mismatched.evidence, undefined);
  assert.match(mismatched.reason, /Business Package boundary/);
});

test("is deterministic and immutable and excludes timing recommendations from the evidence decision", () => {
  const adapter = new PinterestPerformanceContentOpportunityEvidenceAdapter();
  const first = adapter.normalize(pin(), packageId);
  const second = adapter.normalize(pin(), packageId);
  const withTiming = {
    ...pin(),
    recommendedWindow: "19:00-20:00",
    timingRecommendation: { confidence: 0.9 },
    cadenceRecommendationReference: "cadence-1",
  } as PinterestPerformanceEvidenceInput & Record<string, unknown>;
  const timingIgnored = adapter.normalize(withTiming, packageId);
  const many = adapter.normalizeMany([pin(), undefined], packageId);

  assert.deepEqual(
    [first.status, first.evidence?.sourceReference, first.evidence?.evidenceReference, first.evidence?.explanation],
    [second.status, second.evidence?.sourceReference, second.evidence?.evidenceReference, second.evidence?.explanation],
  );
  assert.equal(timingIgnored.status, PinterestPerformanceEvidenceNormalizationStatus.Normalized);
  assert.equal(timingIgnored.evidence?.explanation, first.evidence?.explanation);
  assert.doesNotMatch(timingIgnored.evidence?.explanation ?? "", /recommended|cadence|timing/i);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.evidence), true);
  assert.equal(Object.isFrozen(many), true);
});