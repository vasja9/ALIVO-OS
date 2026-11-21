import assert from "node:assert/strict";
import test from "node:test";
import {
  ALIVO_MARKETING_POLICY,
  marketingPolicyForBusinessPackage,
  reviewMarketingMessage,
  type MarketingAlignmentEvidence,
} from "../../src/business/marketing/ALIVOMarketingPolicy.ts";

const aligned: MarketingAlignmentEvidence = {
  primaryValue: "solution",
  readerProblem: "Why am I tired after meals?",
  usefulNextStep: "Explain possible causes and practical questions to explore",
  convenienceSupport: "A clear, organized guide",
  experienceSupport: "Feel informed rather than overwhelmed",
};
const review = (text: string, changes: Partial<Parameters<typeof reviewMarketingMessage>[0]> = {}) =>
  reviewMarketingMessage({businessPackageId: "ALIVO", channel: "blog", text, evidence: aligned, ...changes});

test("approved and immutable hierarchy is solution > convenience > experience", () => {
  assert.equal(ALIVO_MARKETING_POLICY.status, "LOCKED");
  assert.equal(ALIVO_MARKETING_POLICY.primaryValue, "solution");
  assert.deepEqual(ALIVO_MARKETING_POLICY.valueOrder, ["solution", "convenience", "experience"]);
  assert.ok(Object.isFrozen(ALIVO_MARKETING_POLICY.valueOrder));
  assert.equal(marketingPolicyForBusinessPackage("ALIVO"), ALIVO_MARKETING_POLICY);
  assert.equal(marketingPolicyForBusinessPackage("BEST-FINDS"), undefined);
  assert.deepEqual(review("Discover why meal-related tiredness can occur."), []);
});
test("ALIVO copy cannot pass without alignment evidence and a solution-first framing", () => {
  assert.deepEqual(review("A helpful guide", {evidence: undefined}).map(x=>x.code), ["MarketingEvidenceMissing"]);
  assert.ok(review("A helpful guide", {evidence: {...aligned, primaryValue: "experience"}})
    .some(x=>x.code === "SolutionNotPrimary"));
  assert.ok(review("A helpful guide", {evidence: {...aligned, readerProblem:"   "}})
    .some(x=>x.code === "ReaderProblemMissing"));
  assert.ok(review("A helpful guide", {evidence: {...aligned, usefulNextStep:""}})
    .some(x=>x.code === "UsefulNextStepMissing"));
});
test("misleading health guarantees and aggressive urgency are rejected in English and German", () => {
  for (const copy of [
    "Guaranteed to cure diabetes in seven days!",
    "This miracle book will heal your migraines instantly.",
    "Garantiert heilt diese Methode Ihre Migräne!",
    "Jetzt kaufen — nur heute!",
    "Buy now, last chance!",
  ]) assert.ok(review(copy).length > 0, copy);
});
test("Facebook external links only belong in a comment; internal Facebook links remain valid", () => {
  assert.deepEqual(review("Helpful tip https://alivo.eu/books/",{channel:"facebook"}).map(x=>x.code),["FacebookExternalLinkInPost"]);
  assert.deepEqual(review("Helpful tip https://www.facebook.com/alivo/posts/1",{channel:"facebook"}),[]);
  assert.deepEqual(review("Read https://alivo.eu/books/",{channel:"blog"}),[]);
});
test("other business packages are not accidentally controlled by ALIVO marketing rules", () => {
  assert.deepEqual(reviewMarketingMessage({businessPackageId:"BEST-FINDS",channel:"facebook",text:"Buy now https://example.com"}),[]);
});
