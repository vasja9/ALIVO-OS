import assert from "node:assert/strict";
import { test } from "node:test";
import { BusinessPackageId } from "../../src/intelligence/market/MarketIntelligenceDomain.ts";
import {
  ContentOpportunityCandidate,
  ContentOpportunityDestination,
  ContentOpportunityDestinationType,
  ContentOpportunityEvidenceRole,
  ContentOpportunityEvidenceSource,
  ContentOpportunityId,
  ContentOpportunityStatus,
  ContentOpportunityTarget,
} from "../../src/business/content/opportunities/ContentOpportunityIntelligenceDomain.ts";
import {
  BusinessPackageLanguageMarketPolicy,
  ResearchLanguageMode,
} from "../../src/business/content/opportunities/LanguageMarketPolicy.ts";
import {
  WebContentOpportunityEvidenceAdapter,
  WebEvidenceNormalizationStatus,
  type WebEvidenceInput,
} from "../../src/business/content/opportunities/WebContentOpportunityEvidenceAdapter.ts";
import { ContentOpportunityEvaluationService } from "../../src/business/content/opportunities/ContentOpportunityEvaluationService.ts";

const packageId = new BusinessPackageId("ALIVO");
const otherPackageId = new BusinessPackageId("OTHER");
const observedAt = new Date("2026-08-18T12:00:00.000Z");
const usPolicy = new BusinessPackageLanguageMarketPolicy({
  businessPackageId: packageId,
  targetMarket: "US",
  contentWriteLanguage: "en",
  publishingLanguage: "en",
  researchLanguageMode: ResearchLanguageMode.Auto,
});

const validInput = (overrides: Partial<WebEvidenceInput> = {}): WebEvidenceInput => ({
  businessPackageId: packageId,
  url: "https://example.com/meal-fatigue",
  language: "en",
  market: "US",
  ...overrides,
});

test("normalize with undefined input returns Missing", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  const missing = adapter.normalize(undefined, packageId);

  assert.equal(missing.status, WebEvidenceNormalizationStatus.Missing);
  assert.equal(missing.evidence, undefined);
  assert.ok(missing.reason.length > 0, "reason must be present");
  assert.match(missing.reason, /missing/i);
});

test("normalize with mismatched businessPackageId returns Invalid", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  const crossPackage = adapter.normalize(validInput({ businessPackageId: otherPackageId }), packageId);

  assert.equal(crossPackage.status, WebEvidenceNormalizationStatus.Invalid);
  assert.equal(crossPackage.evidence, undefined);
  assert.equal(crossPackage.reason, "Web evidence crosses a Business Package boundary.");
});

test("normalize with valid input returns Normalized and stamps expectedBusinessPackageId on the reference", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  const rawPackageId = new BusinessPackageId(packageId.value);
  const normalized = adapter.normalize(validInput({ businessPackageId: rawPackageId }), packageId);

  assert.equal(normalized.status, WebEvidenceNormalizationStatus.Normalized);
  assert.ok(normalized.evidence, "evidence must be present on success");
  assert.equal(normalized.evidence.source, ContentOpportunityEvidenceSource.Web);
  assert.equal(
    normalized.evidence.sourceReference,
    "web:ALIVO:url:https://example.com/meal-fatigue:scope:en:US",
  );
  assert.equal(
    normalized.evidence.evidenceReference,
    "web:ALIVO:url:https://example.com/meal-fatigue:scope:en:US",
  );
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
});

test("normalize preserves supporting, contradicting, and neutral roles", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  for (const role of [
    ContentOpportunityEvidenceRole.Supporting,
    ContentOpportunityEvidenceRole.Contradicting,
    ContentOpportunityEvidenceRole.Neutral,
  ]) {
    const normalized = adapter.normalize(validInput({ role }), packageId);
    assert.equal(normalized.status, WebEvidenceNormalizationStatus.Normalized);
    assert.equal(normalized.evidence?.role, role);
  }
});

test("normalize defaults role to Supporting when omitted", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  const normalized = adapter.normalize(validInput(), packageId);

  assert.equal(normalized.status, WebEvidenceNormalizationStatus.Normalized);
  assert.equal(normalized.evidence?.role, ContentOpportunityEvidenceRole.Supporting);
});

test("normalize preserves explicit explanation and optional observation timestamp", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  const normalized = adapter.normalize(
    validInput({ explanation: "Directly supports the target question.", observedAt }),
    packageId,
  );

  assert.equal(normalized.status, WebEvidenceNormalizationStatus.Normalized);
  assert.equal(normalized.evidence?.explanation, "Directly supports the target question.");
  assert.equal(normalized.evidence?.observedAt?.toISOString(), observedAt.toISOString());
});

test("normalize generates default explanation referencing the URL when no explanation is supplied", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  const normalized = adapter.normalize(validInput(), packageId);

  assert.equal(normalized.status, WebEvidenceNormalizationStatus.Normalized);
  assert.match(normalized.evidence?.explanation ?? "", /https:\/\/example\.com\/meal-fatigue/);
});

test("normalizeMany preserves order and isolates failures", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  const inputs: readonly (WebEvidenceInput | undefined)[] = [
    validInput(),
    undefined,
    validInput({ businessPackageId: otherPackageId }),
    validInput({ url: "https://example.com/second" }),
  ];
  const results = adapter.normalizeMany(inputs, packageId);

  assert.equal(results.length, 4);
  assert.equal(results[0].status, WebEvidenceNormalizationStatus.Normalized);
  assert.equal(results[1].status, WebEvidenceNormalizationStatus.Missing);
  assert.equal(results[2].status, WebEvidenceNormalizationStatus.Invalid);
  assert.equal(results[3].status, WebEvidenceNormalizationStatus.Normalized);

  assert.ok(results[0].evidence, "first item must produce evidence");
  assert.equal(results[1].evidence, undefined);
  assert.equal(results[2].evidence, undefined);
  assert.ok(results[3].evidence, "fourth item must produce evidence");

  assert.equal(Object.isFrozen(results), true);
});

test("normalizeMany stamps every successful result with expectedBusinessPackageId", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  const inputs: readonly WebEvidenceInput[] = [
    validInput(),
    validInput({ url: "https://example.com/another" }),
  ];
  const results = adapter.normalizeMany(inputs, packageId);

  for (const r of results) {
    assert.equal(r.status, WebEvidenceNormalizationStatus.Normalized);
    assert.strictEqual(r.evidence?.businessPackageId, packageId);
  }
});

test("normalize returns Invalid for missing required fields without throwing", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  const noUrl = adapter.normalize(validInput({ url: "" }), packageId);
  const noLanguage = adapter.normalize(validInput({ language: "" }), packageId);
  const noMarket = adapter.normalize(validInput({ market: "" }), packageId);

  assert.equal(noUrl.status, WebEvidenceNormalizationStatus.Invalid);
  assert.equal(noLanguage.status, WebEvidenceNormalizationStatus.Invalid);
  assert.equal(noMarket.status, WebEvidenceNormalizationStatus.Invalid);
  assert.equal(noUrl.evidence, undefined);
  assert.equal(noLanguage.evidence, undefined);
  assert.equal(noMarket.evidence, undefined);
});

test("normalize returns Invalid when language code is unrecognized", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();

  const fullWord = adapter.normalize(validInput({ language: "english" }), packageId);
  assert.equal(fullWord.status, WebEvidenceNormalizationStatus.Invalid);
  assert.equal(fullWord.evidence, undefined);
  assert.ok(fullWord.reason.length > 0, "reason must be present");

  const numeric = adapter.normalize(validInput({ language: "123" }), packageId);
  assert.equal(numeric.status, WebEvidenceNormalizationStatus.Invalid);
  assert.equal(numeric.evidence, undefined);
  assert.ok(numeric.reason.length > 0, "reason must be present");
});

test("normalize returns Invalid when market code is unrecognized", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();

  const fullName = adapter.normalize(validInput({ market: "United States" }), packageId);
  assert.equal(fullName.status, WebEvidenceNormalizationStatus.Invalid);
  assert.equal(fullName.evidence, undefined);
  assert.ok(fullName.reason.length > 0, "reason must be present");

  const longCode = adapter.normalize(validInput({ market: "united-states" }), packageId);
  assert.equal(longCode.status, WebEvidenceNormalizationStatus.Invalid);
  assert.equal(longCode.evidence, undefined);
  assert.ok(longCode.reason.length > 0, "reason must be present");
});

test("normalize accepts non-canonical language and market codes and reflects canonical form in reference", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  const normalized = adapter.normalize(validInput({ language: "EN", market: "us" }), packageId);

  assert.equal(normalized.status, WebEvidenceNormalizationStatus.Normalized);
  assert.ok(normalized.evidence, "evidence must be present");
  assert.equal(normalized.evidence.language, "en");
  assert.equal(normalized.evidence.market, "US");
  assert.match(normalized.evidence.sourceReference, /scope:en:US/);
  assert.match(normalized.evidence.evidenceReference, /scope:en:US/);
});

test("normalize returns Invalid for invalid expected Business Package without throwing", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  const badExpected = adapter.normalize(
    validInput(),
    undefined as unknown as BusinessPackageId,
  );

  assert.equal(badExpected.status, WebEvidenceNormalizationStatus.Invalid);
  assert.equal(badExpected.evidence, undefined);
  assert.match(badExpected.reason, /Business Package/);
});

test("normalize preserves researchLanguage when provided", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  // researchLanguage matches the target language, so crossLanguageResearch stays false
  const normalized = adapter.normalize(
    validInput({ researchLanguage: "en" }),
    packageId,
  );

  assert.equal(normalized.status, WebEvidenceNormalizationStatus.Normalized);
  assert.ok(normalized.evidence, "evidence must be present");
  assert.equal(normalized.evidence.researchLanguage, "en");
});

test("normalize preserves crossLanguageResearch: true when provided", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  // researchLanguage must differ from the target language when crossLanguageResearch is true
  const normalized = adapter.normalize(
    validInput({ researchLanguage: "es", crossLanguageResearch: true }),
    packageId,
  );

  assert.equal(normalized.status, WebEvidenceNormalizationStatus.Normalized);
  assert.ok(normalized.evidence, "evidence must be present");
  assert.equal(normalized.evidence.researchLanguage, "es");
  assert.equal(normalized.evidence.crossLanguageResearch, true);
  assert.equal(
    normalized.evidence.evidenceReference,
    "web:ALIVO:url:https://example.com/meal-fatigue:scope:en:US:research-language:es",
  );
  assert.equal(
    normalized.evidence.sourceReference,
    "web:ALIVO:url:https://example.com/meal-fatigue:scope:en:US:research-language:es",
  );
});

test("normalize leaves researchLanguage undefined and crossLanguageResearch false when neither is supplied", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  const normalized = adapter.normalize(validInput(), packageId);

  assert.equal(normalized.status, WebEvidenceNormalizationStatus.Normalized);
  assert.ok(normalized.evidence, "evidence must be present");
  assert.equal(normalized.evidence.researchLanguage, undefined);
  // domain defaults crossLanguageResearch to false when the field is omitted
  assert.equal(normalized.evidence.crossLanguageResearch, false);
});

test("normalize returns Invalid when crossLanguageResearch is true but no researchLanguage is provided", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  const result = adapter.normalize(
    validInput({ crossLanguageResearch: true }),
    packageId,
  );

  assert.equal(result.status, WebEvidenceNormalizationStatus.Invalid);
  assert.equal(result.evidence, undefined);
  assert.ok(result.reason.length > 0, "reason must be present");
  assert.equal(result.reason, "Cross-language research evidence requires a research language");
});

test("normalize returns Invalid when crossLanguageResearch is true but researchLanguage equals the target language", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  // target language is "en"; researchLanguage is also "en" — not a different language
  const result = adapter.normalize(
    validInput({ crossLanguageResearch: true, researchLanguage: "en" }),
    packageId,
  );

  assert.equal(result.status, WebEvidenceNormalizationStatus.Invalid);
  assert.equal(result.evidence, undefined);
  assert.ok(result.reason.length > 0, "reason must be present");
  assert.equal(result.reason, "Cross-language research evidence must use a different research language");
});

test("normalize returns Invalid when researchLanguage differs from target language but crossLanguageResearch is not set", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  // "es" differs from the target "en" but crossLanguageResearch is not flagged
  const result = adapter.normalize(
    validInput({ researchLanguage: "es" }),
    packageId,
  );

  assert.equal(result.status, WebEvidenceNormalizationStatus.Invalid);
  assert.equal(result.evidence, undefined);
  assert.ok(result.reason.length > 0, "reason must be present");
  assert.equal(result.reason, "A different research language must be explicitly marked as cross-language research");
});

test("normalizeMany returns [Invalid, Normalized] when a cross-language slot precedes a valid slot and valid neighbor is unaffected", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  // Slot 0: crossLanguageResearch flagged but researchLanguage omitted — must be Invalid
  // Slot 1: valid, monolingual evidence — must be Normalized
  const inputs: readonly (WebEvidenceInput | undefined)[] = [
    validInput({ crossLanguageResearch: true }),
    validInput({ url: "https://example.com/valid-neighbor" }),
  ];
  const results = adapter.normalizeMany(inputs, packageId);

  assert.equal(results.length, 2);
  assert.equal(results[0].status, WebEvidenceNormalizationStatus.Invalid, "cross-language slot must be Invalid");
  assert.equal(results[0].evidence, undefined);
  assert.equal(
    results[0].reason,
    "Cross-language research evidence requires a research language",
    "cross-language slot must retain its rejection reason",
  );
  assert.equal(results[1].status, WebEvidenceNormalizationStatus.Normalized, "valid neighbor must be Normalized");
  assert.ok(results[1].evidence, "valid neighbor must produce evidence");
  assert.strictEqual(
    results[1].evidence.businessPackageId,
    packageId,
    "valid neighbor evidence must be stamped with expectedBusinessPackageId",
  );
});

test("normalizeMany returns the same-language rejection reason without affecting a valid neighbor", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  // Slot 0: crossLanguageResearch is flagged but researchLanguage matches the target language — must be Invalid
  // Slot 1: valid, monolingual evidence — must be Normalized
  const inputs: readonly (WebEvidenceInput | undefined)[] = [
    validInput({ crossLanguageResearch: true, researchLanguage: "en" }),
    validInput({ url: "https://example.com/valid-neighbor-same-language" }),
  ];
  const results = adapter.normalizeMany(inputs, packageId);

  assert.equal(results.length, 2);
  assert.equal(results[0].status, WebEvidenceNormalizationStatus.Invalid, "cross-language slot must be Invalid");
  assert.equal(results[0].evidence, undefined);
  assert.equal(
    results[0].reason,
    "Cross-language research evidence must use a different research language",
    "cross-language slot must retain its rejection reason",
  );
  assert.equal(results[1].status, WebEvidenceNormalizationStatus.Normalized, "valid neighbor must be Normalized");
  assert.ok(results[1].evidence, "valid neighbor must produce evidence");
});

test("normalizeMany preserves all cross-language rejection reasons in order alongside a valid slot", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  const inputs: readonly WebEvidenceInput[] = [
    // Slot 0: cross-language research is flagged without a source language.
    validInput({ crossLanguageResearch: true }),
    // Slot 1: cross-language research is flagged with the target language as its source.
    validInput({ crossLanguageResearch: true, researchLanguage: "en" }),
    // Slot 2: a different source language is provided without the cross-language flag.
    validInput({ researchLanguage: "es" }),
    // Slot 3: valid monolingual evidence must still normalize.
    validInput({ url: "https://example.com/valid-cross-language-batch-neighbor" }),
  ];
  const results = adapter.normalizeMany(inputs, packageId);

  assert.deepEqual(
    results.map((result) => result.status),
    [
      WebEvidenceNormalizationStatus.Invalid,
      WebEvidenceNormalizationStatus.Invalid,
      WebEvidenceNormalizationStatus.Invalid,
      WebEvidenceNormalizationStatus.Normalized,
    ],
  );
  assert.deepEqual(
    results.slice(0, 3).map((result) => result.reason),
    [
      "Cross-language research evidence requires a research language",
      "Cross-language research evidence must use a different research language",
      "A different research language must be explicitly marked as cross-language research",
    ],
  );
  assert.equal(new Set(results.slice(0, 3).map((result) => result.reason)).size, 3);
  assert.equal(results[0].evidence, undefined);
  assert.equal(results[1].evidence, undefined);
  assert.equal(results[2].evidence, undefined);
  assert.ok(results[3].evidence, "valid final slot must produce evidence");
});

test("results are immutable and adapter exposes no side-effecting methods", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  const first = adapter.normalize(validInput(), packageId);
  const second = adapter.normalize(validInput(), packageId);

  assert.deepEqual(
    [first.status, first.evidence?.sourceReference, first.evidence?.evidenceReference],
    [second.status, second.evidence?.sourceReference, second.evidence?.evidenceReference],
  );
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.evidence), true);
  assert.deepEqual(
    Object.getOwnPropertyNames(Object.getPrototypeOf(adapter)).filter(
      (name) => /fetch|crawl|write|publish|generate|schedule|search/i.test(name),
    ),
    [],
  );
});

test("composes Web evidence through adapter, candidate, and read-only evaluation", () => {
  const adapter = new WebContentOpportunityEvidenceAdapter();
  const evaluator = new ContentOpportunityEvaluationService();
  const createdAt = new Date("2026-08-18T10:00:00.000Z");
  const evaluatedAt = new Date("2026-08-18T12:00:00.000Z");

  const makeCandidate = (
    id: string,
    evidenceReferences: readonly NonNullable<ReturnType<typeof adapter.normalize>["evidence"]>[],
  ) => ContentOpportunityCandidate.fromPolicy(usPolicy, {
    id: new ContentOpportunityId(id),
    target: ContentOpportunityTarget.Blog,
    topic: "meal-related fatigue",
    destination: new ContentOpportunityDestination(ContentOpportunityDestinationType.Book, "book:alivo-health"),
    contentReference: `web:composition:${id}`,
    evidenceReferences,
    createdAt,
  });

  const supporting = adapter.normalize(
    validInput({ role: ContentOpportunityEvidenceRole.Supporting }),
    packageId,
  );
  assert.equal(supporting.status, WebEvidenceNormalizationStatus.Normalized);
  assert.ok(supporting.evidence);
  const supportedCandidate = makeCandidate("web-supported", [supporting.evidence]);
  const supportedEvaluation = evaluator.evaluate(supportedCandidate, evaluatedAt);
  assert.equal(supportedEvaluation.status, ContentOpportunityStatus.Evaluated);
  assert.equal(supportedEvaluation.supportingEvidenceCount, 1);
  assert.equal(supportedEvaluation.contradictingEvidenceCount, 0);

  const crossPackage = adapter.normalize(
    validInput({ businessPackageId: otherPackageId }),
    packageId,
  );
  assert.equal(crossPackage.status, WebEvidenceNormalizationStatus.Invalid);
  assert.equal(crossPackage.evidence, undefined);
  const emptyCandidate = makeCandidate("web-cross-package", []);
  const emptyEvaluation = evaluator.evaluate(emptyCandidate, evaluatedAt);
  assert.equal(emptyEvaluation.status, ContentOpportunityStatus.ResearchRequired);
  assert.equal(emptyEvaluation.supportingEvidenceCount, 0);

  assert.equal(Object.isFrozen(supportedCandidate), true);
  assert.equal(Object.isFrozen(supportedEvaluation), true);
  assert.equal(Object.isFrozen(emptyCandidate), true);
  assert.equal(Object.isFrozen(emptyEvaluation), true);
});
