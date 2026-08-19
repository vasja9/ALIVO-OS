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
  KnowledgeVaultContentOpportunityEvidenceAdapter,
  KnowledgeVaultEvidenceNormalizationStatus,
} from "../../src/business/content/opportunities/KnowledgeVaultContentOpportunityEvidenceAdapter.ts";
import { ContentOpportunityEvaluationService } from "../../src/business/content/opportunities/ContentOpportunityEvaluationService.ts";
import { KnowledgeItem } from "../../src/business/knowledge/KnowledgeItem.ts";
import { KnowledgeItemId } from "../../src/business/knowledge/KnowledgeItemId.ts";
import { KnowledgeItemType } from "../../src/business/knowledge/KnowledgeItemType.ts";
import { KnowledgeSource } from "../../src/business/knowledge/KnowledgeSource.ts";
import { KnowledgeStatus } from "../../src/business/knowledge/KnowledgeStatus.ts";

const packageId = new BusinessPackageId("ALIVO");
const otherPackageId = new BusinessPackageId("OTHER");
const approvedAt = new Date("2026-08-18T10:00:00.000Z");
const dePolicy = new BusinessPackageLanguageMarketPolicy({
  businessPackageId: packageId,
  targetMarket: "DE",
  contentWriteLanguage: "de",
  publishingLanguage: "de",
  researchLanguageMode: ResearchLanguageMode.Auto,
});

const knowledgeItem = (
  id: string,
  status = KnowledgeStatus.Approved,
): KnowledgeItem => new KnowledgeItem({
  id: new KnowledgeItemId(id),
  type: KnowledgeItemType.ApprovedNote,
  title: `Knowledge ${id}`,
  content: `knowledge-content:${id}`,
  status,
  source: KnowledgeSource.ApprovedResearch,
  confidence: 0.9,
  createdAt: new Date("2026-08-18T09:00:00.000Z"),
  validatedAt: approvedAt,
  approvedAt: status === KnowledgeStatus.Approved ? approvedAt : undefined,
  language: "de",
  topicLabels: ["content-opportunity"],
});

const input = (item: KnowledgeItem = knowledgeItem("one"), role?: ContentOpportunityEvidenceRole) => ({
  businessPackageId: packageId,
  item,
  market: "DE",
  role,
});

test("normalizes supporting, contradicting, and neutral Knowledge Vault evidence", () => {
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const roles = [
    ContentOpportunityEvidenceRole.Supporting,
    ContentOpportunityEvidenceRole.Contradicting,
    ContentOpportunityEvidenceRole.Neutral,
  ];

  for (const role of roles) {
    const normalized = adapter.normalize(input(knowledgeItem(role), role), packageId);
    assert.equal(normalized.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized);
    assert.equal(normalized.evidence?.source, ContentOpportunityEvidenceSource.KnowledgeVault);
    assert.equal(normalized.evidence?.role, role);
    assert.equal(normalized.evidence?.sourceReference, `knowledge-vault:ALIVO:source:${KnowledgeSource.ApprovedResearch}:scope:de:DE`);
    assert.equal(normalized.evidence?.evidenceReference, `knowledge-vault:ALIVO:item:${role}:scope:de:DE`);
    assert.match(normalized.evidence?.explanation ?? "", /Knowledge Vault item/);
    assert.equal(normalized.evidence?.observedAt?.toISOString(), approvedAt.toISOString());
  }
});

test("preserves explicit explanation and optional observation timestamp", () => {
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const observedAt = new Date("2026-08-19T10:00:00.000Z");
  const normalized = adapter.normalize({
    ...input(),
    explanation: "Explicitly mapped from the approved Knowledge Vault record.",
    observedAt,
  }, packageId);

  assert.equal(normalized.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  assert.equal(normalized.evidence?.explanation, "Explicitly mapped from the approved Knowledge Vault record.");
  assert.equal(normalized.evidence?.observedAt?.toISOString(), observedAt.toISOString());
});

test("handles missing, unapproved, and cross-package evidence deterministically", () => {
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const missing = adapter.normalize({ businessPackageId: packageId, market: "DE" }, packageId);
  const unapproved = adapter.normalize(input(knowledgeItem("draft", KnowledgeStatus.Draft)), packageId);
  const crossPackage = adapter.normalize({ ...input(), businessPackageId: otherPackageId }, packageId);

  assert.equal(missing.status, KnowledgeVaultEvidenceNormalizationStatus.Missing);
  assert.equal(missing.evidence, undefined);
  assert.equal(missing.reason, "Knowledge Vault evidence item is missing.");
  assert.equal(unapproved.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.equal(unapproved.evidence, undefined);
  assert.equal(crossPackage.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.match(crossPackage.reason, /Business Package boundary/);
});

test("invalid input and invalid timestamp do not throw or create side effects", () => {
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const invalidInput = adapter.normalize({ businessPackageId: packageId, item: {} as KnowledgeItem, market: "DE" }, packageId);
  const invalidTimestamp = adapter.normalize({ ...input(), observedAt: new Date("invalid") }, packageId);
  const first = adapter.normalize(input(), packageId);
  const second = adapter.normalize(input(), packageId);
  const many = adapter.normalizeMany([input(), { businessPackageId: packageId, market: "DE" }], packageId);

  assert.equal(invalidInput.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.equal(invalidTimestamp.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.deepEqual(
    [first.status, first.evidence?.sourceReference, first.evidence?.evidenceReference],
    [second.status, second.evidence?.sourceReference, second.evidence?.evidenceReference],
  );
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(many), true);
  assert.deepEqual(
    Object.getOwnPropertyNames(Object.getPrototypeOf(adapter)).filter((name) => /fetch|crawl|write|publish|generate|schedule/i.test(name)),
    [],
  );
});

test("composes Knowledge Vault evidence through adapter, candidate, and read-only evaluation", () => {
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const evaluator = new ContentOpportunityEvaluationService();
  const createdAt = new Date("2026-08-18T10:00:00.000Z");
  const evaluatedAt = new Date("2026-08-18T12:00:00.000Z");
  const makeCandidate = (
    id: string,
    evidenceReferences: readonly NonNullable<ReturnType<typeof adapter.normalize>["evidence"]>[],
  ) => ContentOpportunityCandidate.fromPolicy(dePolicy, {
    id: new ContentOpportunityId(id),
    target: ContentOpportunityTarget.Blog,
    topic: "meal-related fatigue",
    destination: new ContentOpportunityDestination(ContentOpportunityDestinationType.Book, "book:alivo-health"),
    contentReference: `knowledge-vault:composition:${id}`,
    evidenceReferences,
    createdAt,
  });

  const supporting = adapter.normalize(input(knowledgeItem("composition-support")), packageId);
  assert.equal(supporting.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  assert.ok(supporting.evidence);
  const supportedCandidate = makeCandidate("supported", [supporting.evidence]);
  const supportedEvaluation = evaluator.evaluate(supportedCandidate, evaluatedAt);
  assert.equal(supportedEvaluation.status, ContentOpportunityStatus.Evaluated);
  assert.equal(supportedEvaluation.supportingEvidenceCount, 1);
  assert.equal(supportedEvaluation.contradictingEvidenceCount, 0);

  const missing = adapter.normalize({ businessPackageId: packageId, market: "DE" }, packageId);
  assert.equal(missing.status, KnowledgeVaultEvidenceNormalizationStatus.Missing);
  const missingCandidate = makeCandidate("missing", []);
  const missingEvaluation = evaluator.evaluate(missingCandidate, evaluatedAt);
  assert.equal(missingEvaluation.status, ContentOpportunityStatus.ResearchRequired);
  assert.equal(missingEvaluation.supportingEvidenceCount, 0);

  const contradicting = adapter.normalize(
    input(knowledgeItem("composition-contradiction"), ContentOpportunityEvidenceRole.Contradicting),
    packageId,
  );
  assert.equal(contradicting.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized);
  assert.ok(contradicting.evidence);
  const contradictedCandidate = makeCandidate("contradicted", [supporting.evidence, contradicting.evidence]);
  const contradictedEvaluation = evaluator.evaluate(contradictedCandidate, evaluatedAt);
  assert.equal(contradictedEvaluation.status, ContentOpportunityStatus.Rejected);
  assert.equal(contradictedEvaluation.supportingEvidenceCount, 1);
  assert.equal(contradictedEvaluation.contradictingEvidenceCount, 1);

  assert.equal(Object.isFrozen(supportedCandidate), true);
  assert.equal(Object.isFrozen(supportedEvaluation), true);
  assert.equal(Object.isFrozen(missingCandidate), true);
  assert.equal(Object.isFrozen(missingEvaluation), true);
  assert.equal(Object.isFrozen(contradictedCandidate), true);
  assert.equal(Object.isFrozen(contradictedEvaluation), true);
});

test("stamps normalized evidence with expectedBusinessPackageId, not the value from raw input", () => {
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();

  // Use a distinct object with the same value to prove the stamp is taken from expectedBusinessPackageId
  // and not copied from the raw input's businessPackageId reference.
  const rawPackageId = new BusinessPackageId(packageId.value);
  const normalized = adapter.normalize({ ...input(), businessPackageId: rawPackageId }, packageId);
  assert.equal(normalized.status, KnowledgeVaultEvidenceNormalizationStatus.Normalized);
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
    assert.equal(missing.status, KnowledgeVaultEvidenceNormalizationStatus.Missing);
    assert.equal(missing.evidence, undefined);
    assert.ok(missing.reason.length > 0, "reason must be present");
  });

  // Valid fixture with businessPackageId: undefined must return Invalid (unstamped input caught before evaluation)
  const unstamped = adapter.normalize(
    { ...input(), businessPackageId: undefined as unknown as BusinessPackageId },
    packageId,
  );
  assert.equal(unstamped.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.equal(unstamped.evidence, undefined);
  assert.match(unstamped.reason, /Business Package/);

  // Mismatched input id must be rejected before any stamp is written
  const mismatched = adapter.normalize({ ...input(), businessPackageId: otherPackageId }, packageId);
  assert.equal(mismatched.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.equal(mismatched.evidence, undefined);
  assert.match(mismatched.reason, /Business Package boundary/);
});

test("rejects cross-package Knowledge Vault evidence before candidate and evaluation", () => {
  const adapter = new KnowledgeVaultContentOpportunityEvidenceAdapter();
  const evaluator = new ContentOpportunityEvaluationService();
  const rejected = adapter.normalize({ ...input(knowledgeItem("cross-package")), businessPackageId: otherPackageId }, packageId);

  assert.equal(rejected.status, KnowledgeVaultEvidenceNormalizationStatus.Invalid);
  assert.equal(rejected.evidence, undefined);
  assert.equal(rejected.reason, "Knowledge Vault evidence crosses a Business Package boundary.");

  const candidate = ContentOpportunityCandidate.fromPolicy(dePolicy, {
    id: new ContentOpportunityId("cross-package-rejected"),
    target: ContentOpportunityTarget.Blog,
    topic: "meal-related fatigue",
    destination: new ContentOpportunityDestination(ContentOpportunityDestinationType.Book, "book:alivo-health"),
    contentReference: "knowledge-vault:cross-package-rejected",
    evidenceReferences: [],
    createdAt: new Date("2026-08-18T10:00:00.000Z"),
  });
  const evaluation = evaluator.evaluate(candidate, new Date("2026-08-18T12:00:00.000Z"));

  assert.equal(candidate.evidenceReferences.length, 0);
  assert.equal(evaluation.supportingEvidenceCount, 0);
  assert.equal(evaluation.contradictingEvidenceCount, 0);
  assert.equal(evaluation.status, ContentOpportunityStatus.ResearchRequired);
});
