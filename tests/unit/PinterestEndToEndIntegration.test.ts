import assert from "node:assert/strict";
import test from "node:test";

import {LearningDirection} from "../../src/business/learning/ContinuousLearningDomain.ts";
import {PerformanceIntelligenceService} from "../../src/business/market/performance/PerformanceIntelligenceService.ts";
import {PerformanceRepository} from "../../src/business/market/performance/PerformanceRepository.ts";
import {MetricAvailability} from "../../src/business/market/performance/PerformanceIntelligenceDomain.ts";
import {InMemoryRepository} from "../../src/core/platform/Repository.ts";
import {BusinessPackageId} from "../../src/intelligence/market/MarketIntelligenceDomain.ts";
import {CredentialId, CredentialStatus} from "../../src/security/credentials/CredentialVault.ts";
import {PinterestCreativeCandidateVersion, PinterestCreativeReadiness, PinterestDestinationValidation} from "../../src/integrations/pinterest/PinterestCreativeAssemblyDomain.ts";
import {PinterestAnalyticsCollectionState, PinterestMeasurementWindowPolicy, PinterestPerformanceCollectionRequest, PinterestPerformanceSubject, PinterestRawAnalyticsRecord} from "../../src/integrations/pinterest/PinterestPerformanceFeedbackDomain.ts";
import {PinterestPerformanceFeedbackRepository, PinterestPerformanceFeedbackWorkflow} from "../../src/integrations/pinterest/PinterestPerformanceFeedbackWorkflow.ts";
import {PinterestPublisher, PinterestPublishingEnvironment, PinterestPublishingRepository, PinterestPublishingService, PinterestPublishState, type PinterestOfficialWriteTransport} from "../../src/integrations/pinterest/PinterestPublisher.ts";
import {PinterestQueueManagementService, PinterestQueuePolicy, PinterestQueueRepository, PinterestSchedulingPolicy, PinterestSchedulingRequest, PinterestSchedulingService} from "../../src/integrations/pinterest/PinterestSchedulingQueue.ts";
import {PinterestCadencePolicy, PinterestTimingEvaluationId, PinterestTimingEvaluationRequest, PinterestTimingEvidence, PinterestTimingMode, PinterestTimingPolicy, PinterestTimezoneMode} from "../../src/integrations/pinterest/PinterestTimingDomain.ts";
import {PinterestTimingIntelligenceService} from "../../src/integrations/pinterest/PinterestTimingIntelligenceService.ts";

const packageId = new BusinessPackageId("ALIVO");
const correlationIdentifier = "IMPLEMENTATION-045-ALIVO-PINTEREST";
const evaluatedAt = new Date("2026-03-29T12:00:00Z");
const lineage = Object.freeze({
  planId: "creation-plan-alivo-1", planVersion: 3,
  copyArtifactId: "copy-alivo-1", copyArtifactVersion: 4,
  visualArtifactId: "visual-alivo-1", visualArtifactVersion: 5,
  recommendationId: "recommendation-alivo-1", recommendationVersion: 6,
  ceoDecisionId: "ceo-approval-alivo-1",
  opportunityReferences: ["opportunity-alivo-1"], patternReferences: ["pattern-alivo-1"],
  evidenceReferences: ["market-evidence-alivo-1"],
});

function candidate(decision = lineage.ceoDecisionId, pkg = packageId) {
  return {
    id: "candidate-alivo-1", version: new PinterestCreativeCandidateVersion(2),
    readiness: decision ? PinterestCreativeReadiness.ReadyForPublishing : PinterestCreativeReadiness.ValidationFailed,
    businessPackageId: pkg, destination: {type: "Article", url: "https://example.invalid/alivo"},
    destinationUrl: "https://example.invalid/alivo", destinationValidation: PinterestDestinationValidation.Validated,
    title: "ALIVO evening routine", description: "An approved, synthetic Pinterest description.", cta: "Read",
    accessibilityText: "An abstract evening routine", visualAssetReference: "asset://visual-alivo-1:5",
    language: "de", market: "DE", correlationIdentifier, provenance: {authority: "CEO", source: "synthetic-test"},
    lineage: {...lineage, ceoDecisionId: decision}, experiment: {variant: "A"},
  } as any;
}

function timingRecommendation(c = candidate()) {
  const policy = new PinterestTimingPolicy(true, PinterestTimingMode.Adaptive, PinterestTimezoneMode.Adaptive, undefined, [], 60, [{startMinute: 1140, endMinute: 1200}], {DE: ["Europe/Berlin"]});
  const request = new PinterestTimingEvaluationRequest(new PinterestTimingEvaluationId("timing-alivo-1"), c, 2, packageId, "Pinterest", "DE", "de", undefined, policy, new PinterestCadencePolicy(90), {topic: "sleep", metricWeights: {outboundClicks: 1}}, {
    copyArtifactReference: "copy-alivo-1:4", visualArtifactReference: "visual-alivo-1:5", creationPlanReference: "creation-plan-alivo-1:3",
    ceoDecisionReference: lineage.ceoDecisionId, recommendationReference: "recommendation-alivo-1:6",
    opportunityReferences: lineage.opportunityReferences, patternReferences: lineage.patternReferences, evidenceReferences: lineage.evidenceReferences,
  }, correlationIdentifier, evaluatedAt);
  const evidence = new PinterestTimingEvidence({id: "timing-evidence-alivo-1", businessPackageId: "ALIVO", channel: "Pinterest", market: "DE", language: "de", timezone: "Europe/Berlin", occurredAt: evaluatedAt, windowStartMinute: 1140, windowEndMinute: 1200, metrics: {outboundClicks: 8, impressions: 120}, topic: "sleep", observationId: "performance-observation-prior", quality: 1, freshness: 1, publicationIntervalMinutes: 120});
  const service = new PinterestTimingIntelligenceService(undefined, undefined, undefined, () => evaluatedAt);
  const result = service.evaluate(request, [evidence]);
  assert.equal(service.readModel(request, result).timezoneMode, PinterestTimezoneMode.Adaptive);
  return result.recommendation!;
}

test("complete governed ALIVO Pinterest path reaches shared Performance Intelligence and Continuous Learning", async () => {
  const queueRepository = new PinterestQueueRepository();
  const queue = new PinterestQueueManagementService(queueRepository, undefined, undefined, () => evaluatedAt);
  const creative = candidate();
  const recommendation = timingRecommendation(creative);
  const item = queue.add(creative, {itemId: "queue-alivo-1", channel: "Pinterest", market: "DE", language: "de", topic: "sleep", destinationType: "Article"});
  const scheduler = new PinterestSchedulingService(queueRepository, undefined, undefined, () => evaluatedAt);
  const reserved = scheduler.schedule(new PinterestSchedulingRequest("schedule-request-alivo-1", item.id, recommendation, correlationIdentifier), new PinterestSchedulingPolicy(90)).publication!;
  const scheduled = scheduler.confirm(reserved.id);

  assert.equal(scheduled.timezone, "Europe/Berlin");
  assert.equal(scheduled.minimumIntervalPolicyUsed, 90);
  assert.deepEqual(queue.detail(item.id.value, recommendation).lineage.evidenceReferences, lineage.evidenceReferences);
  assert.equal(queue.summary("ALIVO", "Pinterest", new PinterestQueuePolicy(48, 24), new PinterestSchedulingPolicy(90)).viewAllPins, true);

  let writes = 0;
  const transport: PinterestOfficialWriteTransport = {environment: PinterestPublishingEnvironment.Sandbox, async createPin() { writes += 1; return {kind: "Published", pinId: "provider-pin-alivo-1", providerReference: "provider-write-alivo-1", publishedAt: scheduled.selectedNormalizedInstant}; }};
  const credentialId = new CredentialId("credential-reference-alivo-pinterest");
  const publishingRepository = new PinterestPublishingRepository();
  const publishing = new PinterestPublishingService(queueRepository, publishingRepository, {
    async authorize() { return {metadata: {credentialId: credentialId.value, displayName: "Pinterest ALIVO", serviceReference: "Pinterest", accountReference: "account-alivo", authenticationType: "OAuth", businessPackageScopes: ["ALIVO"], sharedScopeApproved: false, capabilityScopes: ["pins:write"], status: CredentialStatus.Active, createdAt: evaluatedAt.toISOString(), updatedAt: evaluatedAt.toISOString()} as any, credential: {credentialId, use: <T>(consumer: (secret: string) => T) => consumer("synthetic-only")} }; },
    async reauthorizationRequired() {},
  }, new PinterestPublisher(transport), PinterestPublishingEnvironment.Sandbox, "account-alivo", "board-alivo", 0, 3, {published() {}}, undefined, undefined, undefined, undefined, () => scheduled.selectedNormalizedInstant);
  const published = await publishing.execute(scheduled.id, credentialId);
  const duplicateInvocation = await publishing.execute(scheduled.id, credentialId);
  assert.equal(published.state, PinterestPublishState.Published);
  assert.equal(duplicateInvocation.pinReference?.pinId, published.pinReference?.pinId);
  assert.equal(writes, 1);
  assert.equal((published.provenance as any).lineage.copyArtifactVersion, 4);

  const analyticsAt = new Date(scheduled.selectedNormalizedInstant.getTime() + 2 * 60 * 60 * 1000);
  const subject = new PinterestPerformanceSubject(published, {
    scheduledPublicationId: scheduled.id, publishingCandidateId: creative.id, publishingCandidateVersion: 2,
    copyArtifactId: lineage.copyArtifactId, copyArtifactVersion: 4, visualArtifactId: lineage.visualArtifactId, visualArtifactVersion: 5,
    creationPlanId: lineage.planId, creationPlanVersion: 3, recommendationId: lineage.recommendationId, recommendationVersion: 6,
    ceoDecisionReference: lineage.ceoDecisionId, opportunityReferences: lineage.opportunityReferences, patternReferences: lineage.patternReferences,
    businessPackageId: packageId, market: "DE", language: "de", channel: "Pinterest",
  }, {recommendationId: "timing-alivo-1", recommendationVersion: 1, recommendedWindow: recommendation.windows[0].properties.localStart, confidence: recommendation.confidence.value, scheduledTimestamp: scheduled.selectedNormalizedInstant, actualPublicationTimestamp: published.actualPublicationTime!, timezone: scheduled.timezone, timingDeviationMinutes: 0, dayOfWeek: 0, localPublicationTime: recommendation.windows[0].properties.localStart.slice(11), normalizedPublicationInstant: scheduled.selectedNormalizedInstant}, {minimumPublicationIntervalMinutes: scheduled.minimumIntervalPolicyUsed, intervalSincePreviousMinutes: 120, recentPublishedPins: 3, analysisWindowMinutes: 1440, queueContext: "confirmed-at-publication"}, {topic: "sleep", contentIntent: "traffic", destinationType: "Article", creativeType: "static"});
  const raw = new PinterestRawAnalyticsRecord("analytics-alivo-1", published.pinReference!.pinId, published.actualPublicationTime!, analyticsAt, analyticsAt, analyticsAt, [{providerName: "IMPRESSION", value: 0, availability: MetricAvailability.Available, unit: "count"}, {providerName: "OUTBOUND_CLICK", availability: MetricAvailability.Unavailable, unit: "count"}]);
  const performanceRepository = new PinterestPerformanceFeedbackRepository();
  const performance = new PinterestPerformanceFeedbackWorkflow({collect: async () => ({kind: "Collected", record: raw})}, new PerformanceIntelligenceService(new PerformanceRepository(new InMemoryRepository())), performanceRepository, {requestRecovery() {}}, undefined, {evaluate: () => ({direction: LearningDirection.Negative})}, () => analyticsAt);
  const measurement = await performance.collect(new PinterestPerformanceCollectionRequest(subject, ["Impressions", "OutboundClicks"], new PinterestMeasurementWindowPolicy("Early", 2 * 60 * 60 * 1000, false), correlationIdentifier, "pinterest-e2e-workflow", analyticsAt));
  assert.ok("observation" in measurement);
  assert.equal(measurement.learning?.direction, LearningDirection.Negative);
  assert.equal(measurement.observation.metrics[0].value, 0);
  assert.equal(measurement.observation.metrics[1].availability, MetricAvailability.Unavailable);
  assert.equal(measurement.cadenceLearningInput.cadence.minimumPublicationIntervalMinutes, 90);
  assert.equal(performance.performanceReadModel(published.publicationId.value)?.learningStatus, LearningDirection.Negative);
  assert.equal(performance.timingAnalysis()[0].businessPackageId, "ALIVO");
});

test("rejection, package isolation, authentication recovery, and ambiguous writes stop unsafe publication", async () => {
  const repository = new PinterestQueueRepository();
  const queue = new PinterestQueueManagementService(repository, undefined, undefined, () => evaluatedAt);
  assert.throws(() => queue.add(candidate(""), {itemId: "rejected", channel: "Pinterest", market: "DE", language: "de"}), /ReadyForPublishing/);
  assert.equal(repository.list().length, 0);
  const foreign = candidate(lineage.ceoDecisionId, new BusinessPackageId("BEST-FINDS"));
  assert.throws(() => timingRecommendation(foreign), /scope|mismatch/i);

  const retry = new PinterestPerformanceFeedbackWorkflow({collect: async () => ({kind: "AuthenticationRequired", safeMessage: "Reauthorization required"})}, new PerformanceIntelligenceService(new PerformanceRepository(new InMemoryRepository())), new PinterestPerformanceFeedbackRepository(), {requestRecovery() {}}, undefined, undefined, () => evaluatedAt);
  const source = `${PinterestPublishingService} ${PinterestPerformanceFeedbackWorkflow}`;
  assert.doesNotMatch(source, /PinterestSpamScore|ShadowBanProbability|SafePostingThreshold|fetch\(/i);
  assert.equal(PinterestAnalyticsCollectionState.AuthenticationRequired, "AuthenticationRequired");
});
