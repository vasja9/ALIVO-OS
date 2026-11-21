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
  primaryNeed: "clarity",
  needBenefit: "A practical explanation of possible causes",
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
  assert.deepEqual(ALIVO_MARKETING_POLICY.needPriority, ["clarity", "certainty", "time", "connection", "status"]);
  assert.equal(ALIVO_MARKETING_POLICY.defaultPrimaryNeed, "clarity");
  assert.equal(ALIVO_MARKETING_POLICY.communicationPromise, "SOLUTION → CLARITY → TRUST");
  assert.equal(ALIVO_MARKETING_POLICY.reference, "alivo:marketing:solution-convenience-experience:v2");
  assert.ok(Object.isFrozen(ALIVO_MARKETING_POLICY.needPriority));
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

test("all five needs are valid as one declared dominant motivation", () => {
  for (const primaryNeed of ALIVO_MARKETING_POLICY.needPriority) {
    const evidence: MarketingAlignmentEvidence = {
      ...aligned,
      primaryNeed,
      reliabilityBasis: primaryNeed === "certainty" ? "Approved educational sources and stated limitations" : undefined,
    };
    assert.deepEqual(review("A clear, practical health guide.",{evidence: evidence}), [], primaryNeed);
  }
});
test("a selected need must have a concrete benefit and a credible basis for certainty", () => {
  assert.ok(review("Useful information.",{evidence:{...aligned,primaryNeed:"" as never}})
    .some(x=>x.code==="PrimaryNeedMissing"));
  assert.ok(review("Useful information.",{evidence:{...aligned,needBenefit:" "}})
    .some(x=>x.code==="NeedBenefitMissing"));
  assert.ok(review("Useful information.",{evidence:{...aligned,primaryNeed:"certainty"}})
    .some(x=>x.code==="ReliabilityBasisMissing"));
  assert.deepEqual(review("A sourced explanation of healthy habits.",{evidence:{
    ...aligned,primaryNeed:"certainty",reliabilityBasis:"Approved scientific references",
  }}),[]);
});
