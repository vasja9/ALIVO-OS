import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MAX_PIN_FAMILY_MEMBERS,
  PinterestLifecycleVariantBriefError,
  createPinterestLifecycleVariantBrief,
  pinterestLifecycleVariantCohort,
} from "../../src/integrations/pinterest/PinterestLifecycleVariantBrief.ts";

const summary = (changes: Record<string, unknown> = {}) => ({
  createdAt: "2026-06-24T00:00:00.000Z",
  completedAgeDays: 60,
  observedWindowCount: 2,
  firstObservedDate: "2026-06-24",
  lastObservedDate: "2026-08-22",
  totalOutboundClicks: 0,
  continuity: "CompleteSincePublication",
  variantEligibility: "EligibleForBrief",
  ...changes,
});

const request = (changes: Record<string, unknown> = {}) => ({
  businessPackageId: "ALIVO",
  evidenceReference: "lifecycle-evidence:2026-08-22",
  evidence: summary(),
  family: { familyReference: "pin-family-thyroid-1", memberCount: 1, usedCohorts: [] },
  sourceCreative: {
    topic: "Thyroid nodules",
    destinationType: "ExistingArticle",
    destinationUrl: "https://alivo.eu/thyroid-nodules/",
    language: "en",
    market: "US",
    backgroundStyle: "Natural",
    visibleText: "What do thyroid nodules mean?",
    fontFamily: "Merriweather",
    productAssetReference: "asset:thyroid-cover-v1",
  },
  ...changes,
}) as never;

test("eligible 60-day zero-click evidence creates one immutable recommendation-review brief", () => {
  const input = request();
  const sourceBefore = structuredClone(input.sourceCreative);
  const brief = createPinterestLifecycleVariantBrief(input);
  assert.deepEqual(brief, {
    id: "lifecycle-variant:pin-family-thyroid-1:Days60To90",
    kind: "PinterestLifecycleVariantBrief",
    state: "ReadyForRecommendationReview",
    businessPackageId: "ALIVO",
    evidenceReference: "lifecycle-evidence:2026-08-22",
    family: { reference: "pin-family-thyroid-1", memberCountBefore: 1, proposedVariantOrdinal: 1, cohort: "Days60To90" },
    evidence: { asOfDate: "2026-08-22", completedAgeDays: 60, observedWindowCount: 2, totalOutboundClicks: 0, interpretation: "NoOutboundClickYet" },
    preserve: { topic: "Thyroid nodules", destinationType: "ExistingArticle", destinationUrl: "https://alivo.eu/thyroid-nodules/", language: "en", market: "US", productAssetReference: "asset:thyroid-cover-v1" },
    sourceCreative: { backgroundStyle: "Natural", visibleText: "What do thyroid nodules mean?", fontFamily: "Merriweather" },
    requiredChanges: ["BackgroundStyle", "VisibleText", "Typography"],
    originalPinDirective: "LeaveUnchanged",
    nextAuthority: "RecommendationReview",
  });
  assert.deepEqual(input.sourceCreative, sourceBefore);
  assert.equal(Object.isFrozen(brief), true);
  assert.equal(Object.isFrozen(brief.family), true);
  assert.equal(Object.isFrozen(brief.requiredChanges), true);
});

test("only the three bounded lifecycle cohorts can prepare briefs", () => {
  assert.equal(pinterestLifecycleVariantCohort(59), null);
  assert.equal(pinterestLifecycleVariantCohort(60), "Days60To90");
  assert.equal(pinterestLifecycleVariantCohort(90), "Days60To90");
  assert.equal(pinterestLifecycleVariantCohort(91), "Days91To180");
  assert.equal(pinterestLifecycleVariantCohort(180), "Days91To180");
  assert.equal(pinterestLifecycleVariantCohort(181), "Days181To600");
  assert.equal(pinterestLifecycleVariantCohort(600), "Days181To600");
  assert.equal(pinterestLifecycleVariantCohort(601), null);
});

test("unknown, incomplete, positive-click, young, and legacy evidence fails closed", () => {
  for (const evidence of [
    summary({ variantEligibility: "Unknown" }),
    summary({ variantEligibility: "NotEligible", totalOutboundClicks: 1 }),
    summary({ continuity: "GapDetected" }),
    summary({ completedAgeDays: 59, observedWindowCount: 2 }),
    summary({ createdAt: "2024-01-01T00:00:00.000Z", firstObservedDate: "2024-01-01", lastObservedDate: "2025-08-23", completedAgeDays: 601, observedWindowCount: 20 }),
  ]) assert.throws(() => createPinterestLifecycleVariantBrief(request({ evidence })), (error: unknown) => error instanceof PinterestLifecycleVariantBriefError && error.code === "NOT_ELIGIBLE");
});

test("evidence dates, age, and complete 30-day window count must agree", () => {
  for (const evidence of [
    summary({ firstObservedDate: "2026-06-25" }),
    summary({ lastObservedDate: "2026-08-21" }),
    summary({ completedAgeDays: 61 }),
    summary({ observedWindowCount: 3 }),
    summary({ createdAt: "2026-06-24T12:00:00.000Z", completedAgeDays: 60 }),
  ]) assert.throws(() => createPinterestLifecycleVariantBrief(request({ evidence })), (error: unknown) => error instanceof PinterestLifecycleVariantBriefError && error.code === "EVIDENCE_INVALID");
});

test("a family receives at most one brief per cohort and at most three variants", () => {
  assert.throws(() => createPinterestLifecycleVariantBrief(request({ family: { familyReference: "family", memberCount: 2, usedCohorts: ["Days60To90"] } })), (error: unknown) => error instanceof PinterestLifecycleVariantBriefError && error.code === "COHORT_ALREADY_USED");
  const second = createPinterestLifecycleVariantBrief(request({
    evidence: summary({ createdAt: "2026-05-24T00:00:00.000Z", firstObservedDate: "2026-05-24", lastObservedDate: "2026-08-21", completedAgeDays: 90, observedWindowCount: 3 }),
    family: { familyReference: "family", memberCount: 1, usedCohorts: [] },
  }));
  assert.equal(second.family.cohort, "Days60To90");
  const third = createPinterestLifecycleVariantBrief(request({
    evidence: summary({ createdAt: "2026-02-24T00:00:00.000Z", firstObservedDate: "2026-02-24", lastObservedDate: "2026-08-22", completedAgeDays: 180, observedWindowCount: 6 }),
    family: { familyReference: "family", memberCount: 2, usedCohorts: ["Days60To90"] },
  }));
  assert.equal(third.family.cohort, "Days91To180");
  assert.throws(() => createPinterestLifecycleVariantBrief(request({
    evidence: summary({ createdAt: "2025-09-27T00:00:00.000Z", firstObservedDate: "2025-09-27", lastObservedDate: "2026-08-22", completedAgeDays: 330, observedWindowCount: 11 }),
    family: { familyReference: "family", memberCount: MAX_PIN_FAMILY_MEMBERS, usedCohorts: ["Days60To90", "Days91To180", "Days181To600"] },
  })), (error: unknown) => error instanceof PinterestLifecycleVariantBriefError && error.code === "FAMILY_LIMIT_REACHED");
});

test("brief preserves the topic, destination, locale, and product while requiring distinct creative dimensions", () => {
  const input = request({ pinReference: "private-pin-1", accessToken: "secret" });
  const brief = createPinterestLifecycleVariantBrief(input);
  assert.equal(brief.originalPinDirective, "LeaveUnchanged");
  assert.deepEqual(brief.requiredChanges, ["BackgroundStyle", "VisibleText", "Typography"]);
  assert.equal(brief.preserve.productAssetReference, "asset:thyroid-cover-v1");
  assert.equal(brief.preserve.destinationUrl, "https://alivo.eu/thyroid-nodules/");
  assert.equal(JSON.stringify(brief).includes("private-pin-1"), false);
  assert.equal(JSON.stringify(brief).includes("secret"), false);
});

test("variant brief is pure: it cannot generate, schedule, publish, edit, delete, persist, or call Pinterest", async () => {
  const source = await readFile("src/integrations/pinterest/PinterestLifecycleVariantBrief.ts", "utf8");
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|sendBeacon|pins:write|\.publish\(|\.schedule\(|\.edit\(|\.delete\(|writeFile|safeStorage|PinterestPublisher|PinterestScheduler/i);
  assert.match(source, /ReadyForRecommendationReview/);
  assert.match(source, /LeaveUnchanged/);
  assert.match(source, /BackgroundStyle/);
  assert.match(source, /VisibleText/);
  assert.match(source, /Typography/);
});
