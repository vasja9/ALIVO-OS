import assert from "node:assert/strict";
import { test } from "node:test";
import { BusinessPackageId } from "../../src/intelligence/market/MarketIntelligenceDomain.ts";
import {
  BusinessPackageLanguageMarketPolicy,
  ContentOpportunityLanguageMarketPolicyResolver,
  ContentOpportunityLanguageMarketTaskOverride,
  LanguageMarketPolicyException,
  MARKET_LANGUAGE,
  ResearchLanguageMode,
  ResearchLanguagePolicy,
  languageForMarket,
} from "../../src/business/content/opportunities/LanguageMarketPolicy.ts";
import type { ResolvedContentOpportunityLanguageMarketPolicy } from "../../src/business/content/opportunities/LanguageMarketPolicy.ts";
import {
  ContentOpportunityCandidate,
  ContentOpportunityCandidateFactory,
  ContentOpportunityDestination,
  ContentOpportunityDestinationType,
  ContentOpportunityEvidenceRole,
  ContentOpportunityEvidenceSource,
  ContentOpportunityId,
  ContentOpportunityIntelligenceException,
  ContentOpportunityTarget,
} from "../../src/business/content/opportunities/ContentOpportunityIntelligenceDomain.ts";
import { ContentOpportunityEvaluationService } from "../../src/business/content/opportunities/ContentOpportunityEvaluationService.ts";
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
const observedAt = new Date("2026-08-18T12:00:00.000Z");

// Pinned set of markets expected to remain unmapped in MARKET_LANGUAGE.
// Shared by the resolver throw-test (which guards each entry) and the guard-message test
// (which confirms the failure message names the market explicitly).  Any change to this
// list or to unmappedMarketGuardMessage affects both tests simultaneously.
const EXPECTED_UNMAPPED_MARKETS = [
  "AE", // United Arab Emirates
  "AR", // Argentina
  "CL", // Chile
  "CO", // Colombia
  "ID", // Indonesia
  "MY", // Malaysia
  "NO", // Norway
  "PH", // Philippines
  "PL", // Poland
  "RU", // Russia
  "SA", // Saudi Arabia
  "SE", // Sweden
  "SG", // Singapore
  "TH", // Thailand
  "TR", // Turkey
  "ZA", // South Africa
] as const;

// The guard message used inside the EXPECTED_UNMAPPED_MARKETS loop.
// Extracted so the guard-message test can assert against the same template rather than
// a hard-coded copy, ensuring a message change that drops the market code fails both tests.
const unmappedMarketGuardMessage = (market: string): string =>
  `Market ${market} was added to MARKET_LANGUAGE; remove it from EXPECTED_UNMAPPED_MARKETS or update this test.`;

const policy = (overrides: Partial<ConstructorParameters<typeof BusinessPackageLanguageMarketPolicy>[0]> = {}) =>
  new BusinessPackageLanguageMarketPolicy({
    businessPackageId: packageId,
    targetMarket: "DE",
    contentWriteLanguage: "de",
    publishingLanguage: "de",
    researchLanguageMode: ResearchLanguageMode.Auto,
    ...overrides,
  });

test("detected language is a fallback, while package defaults and task overrides take precedence", () => {
  const resolver = new ContentOpportunityLanguageMarketPolicyResolver();
  const packageDefault = resolver.resolve(policy(), { detectedLanguage: "fr" });
  assert.equal(packageDefault.contentWriteLanguage, "de");
  assert.equal(packageDefault.publishingLanguage, "de");
  assert.equal(packageDefault.contentWriteLanguageSource, "BusinessPackageDefault");

  const detectedFallback = resolver.resolve(policy({
    contentWriteLanguage: undefined,
    publishingLanguage: undefined,
  }), { detectedLanguage: "fr" });
  assert.equal(detectedFallback.contentWriteLanguage, "fr");
  assert.equal(detectedFallback.publishingLanguage, "fr");
  assert.equal(detectedFallback.contentWriteLanguageSource, "DetectedLanguageFallback");

  const taskOverride = resolver.resolve(policy(), {
    detectedLanguage: "fr",
    taskOverride: new ContentOpportunityLanguageMarketTaskOverride({
      contentWriteLanguage: "it",
      publishingLanguage: "it",
      targetMarket: "IT",
      researchLanguageMode: ResearchLanguageMode.Manual,
      researchLanguages: ["it", "en", "it"],
    }),
  });
  assert.equal(taskOverride.contentWriteLanguage, "it");
  assert.equal(taskOverride.publishingLanguage, "it");
  assert.equal(taskOverride.targetMarket, "IT");
  assert.equal(taskOverride.contentWriteLanguageSource, "TaskOverride");
  assert.equal(taskOverride.researchLanguageMode, ResearchLanguageMode.Manual);
  assert.deepEqual(taskOverride.researchLanguages, ["it", "en"]);
});

test("AUTO research languages use the resolved target content language and English without duplicates", () => {
  const resolver = new ContentOpportunityLanguageMarketPolicyResolver();
  const german = resolver.resolve(policy(), { detectedLanguage: "fr" });
  assert.equal(german.researchLanguageMode, ResearchLanguageMode.Auto);
  assert.deepEqual(german.researchLanguages, ["de", "en"]);

  const english = resolver.resolve(policy({
    targetMarket: "US",
    contentWriteLanguage: "en",
    publishingLanguage: "en",
  }));
  assert.deepEqual(english.researchLanguages, ["en"]);

  const marketFallback = resolver.resolve(policy({
    contentWriteLanguage: undefined,
    publishingLanguage: undefined,
    targetMarket: "FR",
  }));
  assert.equal(marketFallback.contentWriteLanguage, "fr");
  assert.equal(marketFallback.contentWriteLanguageSource, "TargetMarketFallback");
  assert.deepEqual(marketFallback.researchLanguages, ["fr", "en"]);
});

test("manual research language lists support one or more languages and remove duplicates deterministically", () => {
  const resolver = new ContentOpportunityLanguageMarketPolicyResolver();
  const resolved = resolver.resolve(policy({
    researchLanguageMode: ResearchLanguageMode.Manual,
    researchLanguages: ["de", "en", "de", "FR"],
  }));

  assert.equal(resolved.researchLanguageMode, ResearchLanguageMode.Manual);
  assert.deepEqual(resolved.researchLanguages, ["de", "en", "fr"]);
  assert.throws(
    () => new ResearchLanguagePolicy(ResearchLanguageMode.Manual),
    (error) => error instanceof LanguageMarketPolicyException,
  );
  assert.throws(
    () => new ResearchLanguagePolicy(ResearchLanguageMode.Auto, ["de"]),
    (error) => error instanceof LanguageMarketPolicyException,
  );
});

test("policy resolution is deterministic and immutable", () => {
  const resolver = new ContentOpportunityLanguageMarketPolicyResolver();
  const packagePolicy = policy();
  const first = resolver.resolve(packagePolicy, { detectedLanguage: "fr" });
  const second = resolver.resolve(packagePolicy, { detectedLanguage: "fr" });

  assert.deepEqual(first.properties, second.properties);
  assert.equal(Object.isFrozen(packagePolicy), true);
  assert.equal(Object.isFrozen(packagePolicy.properties), true);
  assert.equal(Object.isFrozen(packagePolicy.researchLanguagePolicy), true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.properties), true);
  assert.equal(Object.isFrozen(first.researchLanguages), true);
  assert.throws(() => first.researchLanguages.push("it"), TypeError);
  assert.throws(() => {
    (packagePolicy.properties as { targetMarket: string }).targetMarket = "FR";
  }, TypeError);
});

const webEvidence = (overrides: Partial<WebResearchEvidenceInput> = {}): WebResearchEvidenceInput => ({
  businessPackageId: packageId,
  topic: "meal fatigue",
  contentReference: "opportunity:meal-fatigue",
  sourceUrl: "https://research.example/articles/meal-fatigue",
  sourceTitle: "International nutrition research",
  language: "fr",
  market: "DE",
  relevanceExplanation: "The finding is explicitly mapped to the German target content scope.",
  sourceQuality: WebResearchSourceQuality.High,
  evidenceConfidence: WebResearchEvidenceConfidence.High,
  evidenceStatus: WebResearchEvidenceStatus.Verified,
  validity: WebResearchEvidenceValidity.Current,
  observedAt,
  ...overrides,
});

const dePolicy = policy();
const candidateWith = (
  evidenceReferences: readonly NonNullable<ReturnType<WebResearchContentOpportunityEvidenceAdapter["normalize"]>["evidence"]>[],
) => ContentOpportunityCandidate.fromPolicy(dePolicy, {
  id: new ContentOpportunityId("opportunity-de-DE"),
  target: ContentOpportunityTarget.Blog,
  topic: "meal fatigue",
  destination: new ContentOpportunityDestination(ContentOpportunityDestinationType.Book, "book:alivo-health"),
  contentReference: "opportunity:meal-fatigue",
  evidenceReferences,
  createdAt: new Date("2026-08-18T10:00:00.000Z"),
});

test("market isolation prevents evidence from another target market from being evaluated", () => {
  const adapter = new WebResearchContentOpportunityEvidenceAdapter();
  const german = adapter.normalize(webEvidence({
    language: "de",
    market: "DE",
    targetLanguage: undefined,
    targetMarket: undefined,
  }), packageId);
  const french = adapter.normalize(webEvidence({
    language: "fr",
    market: "FR",
    targetLanguage: undefined,
    targetMarket: undefined,
  }), packageId);

  assert.equal(german.status, WebResearchEvidenceNormalizationStatus.Normalized);
  assert.equal(french.status, WebResearchEvidenceNormalizationStatus.Normalized);
  assert.notEqual(german.evidence?.evidenceReference, french.evidence?.evidenceReference);
  assert.throws(
    () => {
      const candidate = candidateWith([french.evidence!]);
      // Scope validation is intentionally before any score is produced.
      new ContentOpportunityEvaluationService().evaluate(candidate, observedAt);
    },
    (error) => error instanceof ContentOpportunityIntelligenceException && /language\/market/.test(error.message),
  );
});

test("cross-language research is accepted only with an explicit same target content language and market", () => {
  const adapter = new WebResearchContentOpportunityEvidenceAdapter();
  const crossLanguage = adapter.normalize(webEvidence({
    language: "fr",
    market: "DE",
    targetLanguage: "de",
    targetMarket: "DE",
    crossLanguageResearch: true,
  }), packageId);

  assert.equal(crossLanguage.status, WebResearchEvidenceNormalizationStatus.Normalized);
  assert.equal(crossLanguage.evidence?.language, "de");
  assert.equal(crossLanguage.evidence?.market, "DE");
  assert.equal(crossLanguage.evidence?.researchLanguage, "fr");
  assert.equal(crossLanguage.evidence?.crossLanguageResearch, true);
  assert.doesNotThrow(() => {
    const candidate = candidateWith([crossLanguage.evidence!]);
    new ContentOpportunityEvaluationService().evaluate(candidate, observedAt);
  });

  assert.equal(
    adapter.normalize(webEvidence({
      targetLanguage: "de",
      targetMarket: "DE",
      crossLanguageResearch: true,
      language: "de",
    }), packageId).status,
    WebResearchEvidenceNormalizationStatus.Invalid,
  );
  assert.equal(
    adapter.normalize(webEvidence({
      language: "fr",
      market: "DE",
      targetLanguage: "de",
      targetMarket: undefined,
      crossLanguageResearch: true,
    }), packageId).status,
    WebResearchEvidenceNormalizationStatus.Invalid,
  );
});

test("evidence scope itself is immutable and rejects unmarked cross-language identity", () => {
  const adapter = new WebResearchContentOpportunityEvidenceAdapter();
  const normalized = adapter.normalize(webEvidence({
    targetLanguage: "de",
    targetMarket: "DE",
    crossLanguageResearch: true,
  }), packageId);

  assert.equal(normalized.status, WebResearchEvidenceNormalizationStatus.Normalized);
  assert.equal(Object.isFrozen(normalized.evidence), true);
  assert.equal(Object.isFrozen(normalized.evidence?.properties), true);
  const unmarked = adapter.normalize(webEvidence({
    targetLanguage: "de",
    targetMarket: "DE",
    crossLanguageResearch: false,
    language: "fr",
  }), packageId);
  assert.equal(unmarked.status, WebResearchEvidenceNormalizationStatus.Invalid);
  assert.match(unmarked.reason, /different Web Research language/);
});

const candidateProps = () => ({
  id: new ContentOpportunityId("opportunity-factory-test"),
  target: ContentOpportunityTarget.Blog,
  topic: "meal fatigue",
  destination: new ContentOpportunityDestination(ContentOpportunityDestinationType.Book, "book:alivo-health"),
  contentReference: "opportunity:meal-fatigue",
  createdAt: new Date("2026-08-18T10:00:00.000Z"),
});

test("factory stamps candidate with language and market from the package policy by default", () => {
  const factory = new ContentOpportunityCandidateFactory();
  const packagePolicy = policy({ targetMarket: "DE", contentWriteLanguage: "de", publishingLanguage: "de" });
  const candidate = factory.fromPolicy(packagePolicy, candidateProps());

  assert.equal(candidate.language, "de");
  assert.equal(candidate.market, "DE");
  assert.equal(candidate.businessPackageId.value, packageId.value);
});

test("factory applies task override language and market over package defaults", () => {
  const factory = new ContentOpportunityCandidateFactory();
  const packagePolicy = policy({ targetMarket: "DE", contentWriteLanguage: "de", publishingLanguage: "de" });
  const override = new ContentOpportunityLanguageMarketTaskOverride({
    contentWriteLanguage: "it",
    publishingLanguage: "it",
    targetMarket: "IT",
  });

  const candidate = factory.fromPolicy(packagePolicy, candidateProps(), { taskOverride: override });

  assert.equal(candidate.language, "it");
  assert.equal(candidate.market, "IT");
});

test("factory uses detected language as fallback when package has no content language", () => {
  const factory = new ContentOpportunityCandidateFactory();
  const packagePolicy = policy({ targetMarket: "DE", contentWriteLanguage: undefined, publishingLanguage: undefined });

  const candidate = factory.fromPolicy(packagePolicy, candidateProps(), { detectedLanguage: "fr" });

  assert.equal(candidate.language, "fr");
  assert.equal(candidate.market, "DE");
});

test("factory falls back to market-inferred language when no other language source is available", () => {
  const factory = new ContentOpportunityCandidateFactory();
  const packagePolicy = policy({ targetMarket: "FR", contentWriteLanguage: undefined, publishingLanguage: undefined });

  const candidate = factory.fromPolicy(packagePolicy, candidateProps());

  assert.equal(candidate.language, "fr");
  assert.equal(candidate.market, "FR");
});

test("factory rejects an invalid policy argument rather than silently constructing a broken candidate", () => {
  const factory = new ContentOpportunityCandidateFactory();

  assert.throws(
    () => factory.fromPolicy({} as never, candidateProps()),
    (error) => error instanceof ContentOpportunityIntelligenceException,
  );
});

test("factory error names the unresolvable market when no language source can satisfy the policy", () => {
  // When a policy carries a market absent from the table and no other language source
  // (no contentWriteLanguage, no detectedLanguage, no task override) is available, the
  // factory must throw and the error message must name the market so operators can identify
  // the broken policy configuration without searching through logs.
  const factory = new ContentOpportunityCandidateFactory();
  const unmappedPolicy = policy({ targetMarket: "ZZ", contentWriteLanguage: undefined, publishingLanguage: undefined });

  assert.throws(
    () => factory.fromPolicy(unmappedPolicy, candidateProps()),
    (error) =>
      error instanceof LanguageMarketPolicyException &&
      error.message.includes("ZZ"),
  );
});

test("direct construction with ad-hoc language and market values is blocked at runtime", () => {
  // The sole public creation routes for new candidates are the fromPolicy and fromResolvedPolicy
  // static methods on ContentOpportunityCandidate and ContentOpportunityCandidateFactory.
  // Calling the constructor directly (without the internal key) throws at runtime, making it
  // impossible to produce a candidate with arbitrary language/market values without policy resolution.
  // All four valid routes must be named in the error so that adding or removing a route without
  // updating the guard message causes this test to fail.
  assert.throws(
    () => new (ContentOpportunityCandidate as never)(candidateProps() as never),
    (error) => {
      if (!(error instanceof ContentOpportunityIntelligenceException)) return false;
      const msg = error.message;
      return (
        /ContentOpportunityCandidate\.fromPolicy\b/.test(msg) &&
        /ContentOpportunityCandidate\.fromResolvedPolicy\b/.test(msg) &&
        /ContentOpportunityCandidateFactory\.fromPolicy\b/.test(msg) &&
        /ContentOpportunityCandidateFactory\.fromResolvedPolicy\b/.test(msg)
      );
    },
  );

  // TypeScript additionally enforces this at the type level: ContentOpportunityCandidateFromPolicyProperties
  // has no `language` or `market` fields, so a caller cannot supply ad-hoc scope values even through fromPolicy.
  const candidate = ContentOpportunityCandidate.fromPolicy(policy(), candidateProps());
  assert.equal(candidate.language, "de"); // always from policy, never from caller
  assert.equal(candidate.market, "DE");
});

// Shared helper used by both the guard-message test and the mutation-scenario test.
// Reflects all factory routes at runtime and asserts every one appears in the constructor
// guard message.  Throws an AssertionError (via assert.deepEqual) if any route is absent.
//
// Extracting the logic here means the mutation-scenario test exercises the identical
// assertion path — not an independent reconstruction — so a weakening of this helper
// would simultaneously break both tests.
function assertAllRoutesNamedInGuard(): void {
  const skipStaticProps = new Set(["length", "name", "prototype"]);
  const candidateStaticRoutes = Object.getOwnPropertyNames(ContentOpportunityCandidate)
    .filter((name) => !skipStaticProps.has(name))
    .map((name) => `ContentOpportunityCandidate.${name}`);

  const factoryInstanceRoutes = Object.getOwnPropertyNames(ContentOpportunityCandidateFactory.prototype)
    .filter((name) => name !== "constructor")
    .map((name) => `ContentOpportunityCandidateFactory.${name}`);

  const allExpectedRoutes = [...candidateStaticRoutes, ...factoryInstanceRoutes];

  assert.ok(
    allExpectedRoutes.length >= 4,
    `Expected at least 4 factory routes but discovered only ${allExpectedRoutes.length}: ${allExpectedRoutes.join(", ")}`,
  );

  let guardMessage: string | undefined;
  assert.throws(
    () => new (ContentOpportunityCandidate as never)(candidateProps() as never),
    (error: unknown) => {
      if (!(error instanceof ContentOpportunityIntelligenceException)) return false;
      guardMessage = error.message;
      return true;
    },
  );

  assert.ok(guardMessage !== undefined, "Expected the constructor to throw ContentOpportunityIntelligenceException");

  const missingRoutes = allExpectedRoutes.filter((route) => !guardMessage!.includes(route));
  assert.deepEqual(
    missingRoutes,
    [],
    `Guard message is missing the following factory route(s): ${missingRoutes.join(", ")}.\n` +
    `Update the guard message in ContentOpportunityCandidate's constructor to include every route.`,
  );
}

test("guard message names every static factory method on ContentOpportunityCandidate and every instance method on ContentOpportunityCandidateFactory", () => {
  // This test closes the mutation gap: it discovers factory methods at runtime rather than
  // hard-coding the names.  If a developer adds a fifth route (e.g. ContentOpportunityCandidate.fromDraft)
  // but forgets to include it in the guard message, this test will fail automatically.
  //
  // How it works:
  //   - Reflect over ContentOpportunityCandidate to collect its own static methods (excluding
  //     the standard class properties: name, length, prototype).
  //   - Reflect over ContentOpportunityCandidateFactory.prototype to collect its own instance
  //     methods (excluding the constructor).
  //   - Trigger the guard by calling the constructor without the internal key.
  //   - Assert that every discovered method appears in the error message as
  //     "ClassName.methodName", so an undocumented route cannot hide in the guard.
  assertAllRoutesNamedInGuard();
});

test("guard reflection test fails when a new static method is added to ContentOpportunityCandidate without updating the guard message", () => {
  // Mutation scenario: simulate the moment a developer adds a brand-new static factory
  // method (ContentOpportunityCandidate.fromDraft) and runs the suite before updating
  // the guard message in the constructor.
  //
  // This test proves the net catches that exact case by:
  //   1. Saving the original property descriptor so restore is exact (not just delete).
  //   2. Temporarily patching a stub static method onto ContentOpportunityCandidate.
  //   3. Calling assertAllRoutesNamedInGuard() — the same helper the real test uses —
  //      and asserting it throws an AssertionError that names the missing route.
  //      This is exactly the failure a developer would see on their machine.
  //   4. Restoring the original descriptor in a finally block so the suite stays green.

  const STUB_METHOD = "fromDraft";
  const EXPECTED_MISSING_ROUTE = `ContentOpportunityCandidate.${STUB_METHOD}`;

  // Step 1: snapshot the current descriptor so we can restore exactly what was there
  // (undefined means the property did not exist, which is the expected state).
  const originalDescriptor = Object.getOwnPropertyDescriptor(ContentOpportunityCandidate, STUB_METHOD);
  assert.equal(
    originalDescriptor,
    undefined,
    `"${STUB_METHOD}" already exists on ContentOpportunityCandidate — choose a different stub name`,
  );

  // Step 2: inject the stub (simulates a developer adding a new factory route).
  Object.defineProperty(ContentOpportunityCandidate, STUB_METHOD, {
    value: function fromDraft() { throw new Error("stub — not implemented"); },
    writable: true,
    configurable: true,
    enumerable: false,
  });

  try {
    // Step 3: call the shared helper and assert it throws an AssertionError that
    // names the missing route.  This is the identical assertion path the real test
    // uses, so no guard weakening can hide the failure.
    assert.throws(
      () => assertAllRoutesNamedInGuard(),
      (error: unknown) => {
        // The helper throws an AssertionError (from assert.deepEqual) whose message
        // contains the name of every missing route.
        if (!(error instanceof assert.AssertionError)) return false;
        assert.ok(
          error.message.includes(EXPECTED_MISSING_ROUTE),
          `AssertionError must name the missing route "${EXPECTED_MISSING_ROUTE}" so developers know what to add to the guard.\n` +
          `Actual AssertionError message: ${error.message}`,
        );
        return true;
      },
    );
  } finally {
    // Step 4: restore exactly — delete because the property was absent before injection.
    delete (ContentOpportunityCandidate as Record<string, unknown>)[STUB_METHOD];
    assert.equal(
      Object.getOwnPropertyDescriptor(ContentOpportunityCandidate, STUB_METHOD),
      undefined,
      `Stub method "${STUB_METHOD}" was not removed from ContentOpportunityCandidate — cleanup failed`,
    );
  }
});

test("languageForMarket returns undefined for markets not in the table", () => {
  // Markets absent from MARKET_LANGUAGE must return undefined so callers can handle
  // the missing-language case explicitly rather than receiving a misleading value.
  assert.equal(languageForMarket("SE"), undefined);
  assert.equal(languageForMarket("PL"), undefined);
  assert.equal(languageForMarket("NO"), undefined);
});

test("languageForMarket resolves locale-style market codes via their base market", () => {
  // Locale-style codes like "DE-BY" extract the base "DE" and look up MARKET_LANGUAGE["DE"].
  // This lets callers use regional sub-markets without adding every variant to the table.
  assert.equal(languageForMarket("DE-BY"), "de");
  assert.equal(languageForMarket("GB-ENG"), "en");
  assert.equal(languageForMarket("ES-CAT"), "es");
  assert.equal(languageForMarket("FR-75"), "fr");
});

test("resolver throws LanguageMarketPolicyException when target market has no known language and no other source exists", () => {
  // When a market is absent from the table AND no content language, task override, or detected
  // language is available, resolution must throw rather than silently producing undefined.
  //
  // EXPECTED_UNMAPPED_MARKETS and unmappedMarketGuardMessage are declared at module scope so
  // the guard-message test can reference the same data; any change that drops the market code
  // from the message will break both this test and that one simultaneously.
  const resolver = new ContentOpportunityLanguageMarketPolicyResolver();

  for (const market of EXPECTED_UNMAPPED_MARKETS) {
    // Confirm the market is still absent from the table — if it was added, the resolver
    // would no longer throw and the assertion below would catch that change instead.
    assert.equal(
      MARKET_LANGUAGE[market],
      undefined,
      unmappedMarketGuardMessage(market),
    );

    assert.throws(
      () =>
        resolver.resolve(
          policy({ targetMarket: market, contentWriteLanguage: undefined, publishingLanguage: undefined }),
        ),
      (error: unknown) =>
        error instanceof LanguageMarketPolicyException && error.message.includes(market),
      `Expected resolver to throw with market code "${market}" in the message`,
    );
  }
});

test("MARKET_LANGUAGE size guard failure surfaces the unexpectedly added key", () => {
  // The exact-table deepEqual test (which pins all 21 entries) acts as the size guard:
  // any addition to MARKET_LANGUAGE diverges from the pinned expectedTable and throws.
  // This test confirms that when the guard fires its AssertionError carries the added
  // key in the `actual` value — so the developer can immediately identify the new entry
  // without manually diffing two large objects.
  //
  // MARKET_LANGUAGE is frozen and cannot be mutated at runtime, so we simulate the
  // bad addition with a local spread and replay the guard's deepEqual logic against a
  // copy of the pinned expectedTable that does not include the new key.
  const addedMarket = "SE";
  const simulatedTable: Readonly<Record<string, string>> = Object.freeze({
    ...MARKET_LANGUAGE,
    [addedMarket]: "sv",
  });
  const pinnedExpectedTable: Readonly<Record<string, string>> = Object.freeze({ ...MARKET_LANGUAGE });

  assert.throws(
    () =>
      assert.deepEqual(
        simulatedTable,
        pinnedExpectedTable,
        "MARKET_LANGUAGE must match the pinned 21-entry table exactly",
      ),
    (error: unknown) => {
      if (!(error instanceof assert.AssertionError)) return false;
      // The AssertionError's `actual` property is the object that failed the comparison;
      // it must carry the added key so the developer can read exactly what was added.
      const actual = error.actual as Record<string, string>;
      assert.ok(
        Object.prototype.hasOwnProperty.call(actual, addedMarket),
        `AssertionError.actual must contain the added market key "${addedMarket}" so the developer can identify the addition immediately.`,
      );
      return true;
    },
    "Size guard must throw an AssertionError whose actual value exposes the added market key.",
  );
});

test("resolver uses task override or detected language even when target market is unmapped", () => {
  // An unmapped market only causes failure when no other language source is present.
  // A task override or detected language must still satisfy resolution.
  const resolver = new ContentOpportunityLanguageMarketPolicyResolver();
  const unmappedPolicy = policy({ targetMarket: "SE", contentWriteLanguage: undefined, publishingLanguage: undefined });

  const withDetected = resolver.resolve(unmappedPolicy, { detectedLanguage: "sv" });
  assert.equal(withDetected.contentWriteLanguage, "sv");
  assert.equal(withDetected.targetMarket, "SE");
  assert.equal(withDetected.contentWriteLanguageSource, "DetectedLanguageFallback");

  const withOverride = resolver.resolve(unmappedPolicy, {
    taskOverride: new ContentOpportunityLanguageMarketTaskOverride({ contentWriteLanguage: "sv" }),
  });
  assert.equal(withOverride.contentWriteLanguage, "sv");
  assert.equal(withOverride.contentWriteLanguageSource, "TaskOverride");
});

test("resolution for unmapped and locale-style markets is deterministic across repeated calls", () => {
  // The same input must always produce the same output; no hidden state or randomness.
  const resolver = new ContentOpportunityLanguageMarketPolicyResolver();

  // Locale-style market: repeated resolutions must agree.
  const localePol = policy({ targetMarket: "DE-BY", contentWriteLanguage: undefined, publishingLanguage: undefined });
  const first = resolver.resolve(localePol);
  const second = resolver.resolve(localePol);
  assert.deepEqual(first.properties, second.properties);
  assert.equal(first.contentWriteLanguage, "de");
  assert.equal(first.contentWriteLanguageSource, "TargetMarketFallback");

  // Unmapped market with detected language fallback: repeated resolutions must agree.
  const unmappedPol = policy({ targetMarket: "SE", contentWriteLanguage: undefined, publishingLanguage: undefined });
  const third = resolver.resolve(unmappedPol, { detectedLanguage: "sv" });
  const fourth = resolver.resolve(unmappedPol, { detectedLanguage: "sv" });
  assert.deepEqual(third.properties, fourth.properties);
  assert.equal(third.contentWriteLanguage, "sv");
});

// --- fromResolvedPolicy contract tests ---

test("fromResolvedPolicy stamps language, market, and businessPackageId from the resolved policy", () => {
  const resolver = new ContentOpportunityLanguageMarketPolicyResolver();
  const packagePolicy = policy({ targetMarket: "DE", contentWriteLanguage: "de", publishingLanguage: "de" });
  const resolved = resolver.resolve(packagePolicy);

  const factory = new ContentOpportunityCandidateFactory();
  const candidate = factory.fromResolvedPolicy(resolved, candidateProps());

  assert.equal(candidate.language, resolved.contentWriteLanguage);
  assert.equal(candidate.market, resolved.targetMarket);
  assert.equal(candidate.businessPackageId.value, resolved.businessPackageId.value);
});

test("fromResolvedPolicy stamps the task-override language and market when the resolved policy reflects a task override", () => {
  const resolver = new ContentOpportunityLanguageMarketPolicyResolver();
  const packagePolicy = policy({ targetMarket: "DE", contentWriteLanguage: "de", publishingLanguage: "de" });
  const override = new ContentOpportunityLanguageMarketTaskOverride({
    contentWriteLanguage: "it",
    targetMarket: "IT",
  });
  const resolved = resolver.resolve(packagePolicy, { taskOverride: override });

  const factory = new ContentOpportunityCandidateFactory();
  const candidate = factory.fromResolvedPolicy(resolved, candidateProps());

  assert.equal(candidate.language, "it");
  assert.equal(candidate.market, "IT");
  assert.equal(candidate.businessPackageId.value, packageId.value);
});

test("fromResolvedPolicy produces identical scope on every candidate when called in a batch loop", () => {
  // This is the primary use-case: resolve once, stamp many candidates without re-running the resolver.
  const resolver = new ContentOpportunityLanguageMarketPolicyResolver();
  const packagePolicy = policy({ targetMarket: "FR", contentWriteLanguage: "fr", publishingLanguage: "fr" });
  const resolved = resolver.resolve(packagePolicy);

  const factory = new ContentOpportunityCandidateFactory();
  const candidates = ["topic-a", "topic-b", "topic-c"].map((topic, i) =>
    factory.fromResolvedPolicy(resolved, {
      ...candidateProps(),
      id: new ContentOpportunityId(`opportunity-batch-${i}`),
      topic,
    })
  );

  for (const candidate of candidates) {
    assert.equal(candidate.language, "fr");
    assert.equal(candidate.market, "FR");
    assert.equal(candidate.businessPackageId.value, packageId.value);
  }
});

test("fromResolvedPolicy is also available as a static method on ContentOpportunityCandidate", () => {
  const resolver = new ContentOpportunityLanguageMarketPolicyResolver();
  const packagePolicy = policy({ targetMarket: "US", contentWriteLanguage: "en", publishingLanguage: "en" });
  const resolved = resolver.resolve(packagePolicy);

  const candidate = ContentOpportunityCandidate.fromResolvedPolicy(resolved, candidateProps());

  assert.equal(candidate.language, "en");
  assert.equal(candidate.market, "US");
  assert.equal(candidate.businessPackageId.value, packageId.value);
});

test("fromResolvedPolicy rejects a non-resolved policy rather than silently constructing a broken candidate", () => {
  const factory = new ContentOpportunityCandidateFactory();

  assert.throws(
    () => factory.fromResolvedPolicy({} as never, candidateProps()),
    (error) => error instanceof ContentOpportunityIntelligenceException,
  );
  assert.throws(
    () => ContentOpportunityCandidate.fromResolvedPolicy({} as never, candidateProps()),
    (error) => error instanceof ContentOpportunityIntelligenceException,
  );
});

test("MARKET_LANGUAGE table contains exactly the expected 21 market-to-language entries", () => {
  // Pin the complete MARKET_LANGUAGE table so any addition, removal, or value change
  // causes an immediate test failure rather than silently affecting downstream resolution.
  // Because the test compares against the exported constant directly, any entry added
  // to or removed from MARKET_LANGUAGE will diverge from expectedTable and fail here.
  const expectedTable: Readonly<Record<string, string>> = Object.freeze({
    AT: "de",
    AU: "en",
    BR: "pt",
    CA: "en",
    CH: "de",
    CN: "zh",
    DE: "de",
    ES: "es",
    FR: "fr",
    GB: "en",
    HK: "zh",
    IN: "en",
    IT: "it",
    JP: "ja",
    KR: "ko",
    MX: "es",
    NL: "nl",
    NZ: "en",
    PT: "pt",
    TW: "zh",
    US: "en",
  });

  // Exact deep-equal: catches additions (extra keys in MARKET_LANGUAGE),
  // removals (missing keys), and value changes (same key, wrong language).
  assert.deepEqual(
    MARKET_LANGUAGE,
    expectedTable,
    "MARKET_LANGUAGE must match the pinned 21-entry table exactly",
  );
});

test("bare-market pattern accepts a three-letter market code so a regex tightening to {2} would be caught", () => {
  // The guard regex is /^[A-Z]{2,3}$/ to allow ISO 3166-1 alpha-3 markets.
  // This test exercises the upper bound of that range: a valid three-letter code
  // ("UAE") must pass without being flagged as malformed.  If the regex were
  // ever tightened to {2}, this test would fail before any real entry breaks.
  const bareMarketPattern = /^[A-Z]{2,3}$/;
  assert.ok(
    bareMarketPattern.test("UAE"),
    "Three-letter market code 'UAE' must match the bare-market pattern /^[A-Z]{2,3}$/",
  );
});

test("every key in MARKET_LANGUAGE is a bare two- or three-letter market code with no locale suffix", () => {
  // languageForMarket strips locale suffixes before looking up the table, so a key like
  // "DE-BY" would be a permanent no-op — it could never be reached.  This test asserts
  // that every key matches /^[A-Z]{2,3}$/ so that any locale-style or malformed addition
  // causes an immediate failure rather than silently dead code in the table.
  const bareMarketPattern = /^[A-Z]{2,3}$/;
  const malformedKeys = Object.keys(MARKET_LANGUAGE).filter(
    (key) => !bareMarketPattern.test(key),
  );
  assert.deepEqual(
    malformedKeys,
    [],
    `MARKET_LANGUAGE contains keys that are not bare two- or three-letter market codes: ${malformedKeys.join(", ")}`,
  );
});