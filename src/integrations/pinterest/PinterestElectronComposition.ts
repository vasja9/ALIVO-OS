import { InMemoryMarketIntelligenceService } from "../../intelligence/market/MarketIntelligenceService.ts";
import { MarketDataQualityService } from "../../intelligence/market/quality/MarketDataQualityService.ts";
import { DuplicateHandlingPolicy, MarketDataQualityPolicy, MarketDataQualitySeverity, MarketDataValidity } from "../../intelligence/market/quality/MarketDataQualityDomain.ts";
import { BusinessPackageId } from "../../intelligence/market/MarketIntelligenceDomain.ts";
import { MarketSourceAdapterId, MarketSourceCapability } from "../../intelligence/market/integration/MarketSourceIntegrationDomain.ts";
import { MarketSourceIntegrationService } from "../../intelligence/market/integration/MarketSourceIntegrationService.ts";
import { AuthenticationType, CredentialId, CredentialStatus } from "../../security/credentials/CredentialVault.ts";
import { PinterestConnectionVerificationId, PinterestConnectionVerificationRequest } from "./PinterestConnectionVerificationDomain.ts";
import { PinterestConnectionVerificationRepository } from "./PinterestConnectionVerificationRepository.ts";
import { PinterestConnectionVerifier } from "./PinterestConnectionVerifier.ts";
import { PinterestEnvironment, PinterestAccessTier } from "./PinterestMarketSourceAdapter.ts";
import { PinterestObservationCollectionScope, PinterestObservationWorkflowId, PinterestObservationWorkflowRequest, PinterestObservationWorkflowResult } from "./PinterestObservationWorkflowDomain.ts";
import { PinterestObservationWorkflowRepository } from "./PinterestObservationWorkflowRepository.ts";
import { PinterestObservationWorkflow } from "./PinterestObservationWorkflow.ts";
import { registerPinterestProductionProvider } from "./PinterestProductionProviderRegistration.ts";
import type { PinterestProductionProviderRegistration } from "./PinterestProductionProviderRegistration.ts";

const ADAPTER_ID = new MarketSourceAdapterId("PinterestMarketSourceAdapter");
const APPROVED_CAPABILITIES = Object.freeze(["AnalyticsObservation", "MarketObservation", "OwnBoards", "OwnPins", "PerformanceObservation", "TrendObservation"].map((value) => new MarketSourceCapability(value)));
const SCOPE_FOR_CAPABILITY:Readonly<Record<string, PinterestObservationCollectionScope>> = Object.freeze({
  AnalyticsObservation: PinterestObservationCollectionScope.OwnedAnalytics,
  MarketObservation: PinterestObservationCollectionScope.OwnedPins,
  OwnBoards: PinterestObservationCollectionScope.OwnedBoards,
  OwnPins: PinterestObservationCollectionScope.OwnedPins,
  PerformanceObservation: PinterestObservationCollectionScope.OwnedAnalytics,
  TrendObservation: PinterestObservationCollectionScope.Trends,
});

const safeText = (value:unknown, fallback:string, maximum=160):string => typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, maximum) : fallback;

export interface PinterestElectronCompositionRequest {
  readonly registration:PinterestProductionProviderRegistration;
  readonly credentialId:string;
  readonly businessPackageId:string;
  readonly apiBaseUrl:string;
  readonly clock?:() => Date;
}

export function createPinterestElectronComposition(request:PinterestElectronCompositionRequest) {
  const clock = request.clock ?? (() => new Date());
  const businessPackageId = new BusinessPackageId(request.businessPackageId);
  const credentialId = new CredentialId(request.credentialId);
  const integration = new MarketSourceIntegrationService(undefined, undefined, undefined, clock);
  const quality = new MarketDataQualityService(undefined, undefined, undefined, clock);
  const qualityPolicy = new MarketDataQualityPolicy({
    id: `pinterest-production:${businessPackageId.value}`,
    businessPackageId,
    requiredFields: ["subject", "payloadReference"],
    requireFullProvenance: true,
    freshness: { freshMs: 86_400_000, acceptableMs: 7 * 86_400_000, ageingMs: 30 * 86_400_000, staleMs: 90 * 86_400_000 },
    duplicateHandling: DuplicateHandlingPolicy.AcceptWithMetadata,
    rejectValidity: [MarketDataValidity.Invalid, MarketDataValidity.Unsupported],
    quarantineSeverities: [MarketDataQualitySeverity.Error, MarketDataQualitySeverity.Critical],
  });
  const intelligence = new InMemoryMarketIntelligenceService();
  const registered = registerPinterestProductionProvider({
    registration: request.registration,
    integration,
    credentialId: credentialId.value,
    businessPackageId: businessPackageId.value,
    configuration: {
      environment: PinterestEnvironment.Production,
      apiBaseUrl: request.apiBaseUrl,
      accessTier: PinterestAccessTier.Unknown,
      approvedCapabilities: APPROVED_CAPABILITIES,
      requestedScopes: ["boards:read", "pins:read", "user_accounts:read"],
      pageSize: 25,
      maximumPages: 10,
      timeoutMs: 30_000,
      adapterVersion: "electron-production-runtime",
    },
    quality: {
      validate() { return { accepted: true }; },
    },
    actor: "ElectronPinterestComposition",
    enable: true,
    clock,
  });
  intelligence.registerSource(registered.descriptor.source);
  const credentialMetadata = {
    credentialId: credentialId.value,
    displayName: "Pinterest OAuth",
    serviceReference: "Pinterest",
    accountReference: businessPackageId.value,
    authenticationType: AuthenticationType.OAuthCredentialReference,
    businessPackageScopes: [businessPackageId.value],
    sharedScopeApproved: false,
    capabilityScopes: APPROVED_CAPABILITIES.map((capability) => capability.value),
    status: CredentialStatus.Active,
    createdAt: clock().toISOString(),
    updatedAt: clock().toISOString(),
  } as const;
  const verificationRepository = new PinterestConnectionVerificationRepository();
  const verifier = new PinterestConnectionVerifier(
    integration.registry,
    { metadata: (id) => id === credentialMetadata.credentialId ? credentialMetadata : undefined },
    verificationRepository,
    undefined,
    undefined,
    clock,
  );
  const observationWorkflow = new PinterestObservationWorkflow(
    integration.registry,
    verifier,
    quality,
    () => qualityPolicy,
    intelligence,
    new PinterestObservationWorkflowRepository(),
    undefined,
    undefined,
    clock,
  );
  let sequence = 0;
  const capability = (value:unknown) => new MarketSourceCapability(safeText(value, "OwnPins"));
  const common = (input:Record<string, unknown>) => ({
    credentialId: credentialId.value,
    businessPackageId: businessPackageId.value,
    correlationIdentifier: safeText(input.correlationIdentifier, `electron-pinterest-${++sequence}`),
  });
  return Object.freeze({
    async verifyConnection(input:Record<string, unknown> = {}) {
      const context = common(input);
      const requested = Array.isArray(input.requestedCapabilities) && input.requestedCapabilities.length ? input.requestedCapabilities : ["OwnPins"];
      const requestObject = new PinterestConnectionVerificationRequest({
        id: new PinterestConnectionVerificationId(`electron-pinterest-verification:${++sequence}`),
        adapterId: ADAPTER_ID,
        credentialId,
        businessPackageId,
        requestedCapabilities: requested.map(capability),
        requestingAuthorityReference: "ElectronUI",
        correlationIdentifier: context.correlationIdentifier,
        requestedAt: clock(),
      });
      const result = await verifier.verify(requestObject);
      return {
        state: result.state,
        authenticationState: result.properties.authenticationState,
        capabilities: result.capabilities.map((item) => ({ capability: item.capability.value, state: item.state, reason: item.reason, safeMessage: item.safeReason, provenance: item.provenance })),
        verifiedAt: result.verifiedAt.toISOString(),
        warnings: result.warnings,
        failures: result.failures,
      };
    },
    async readObservation(input:Record<string, unknown> = {}) {
      const context = common(input);
      const requestedCapability = capability(input.capability);
      const observationRequest = new PinterestObservationWorkflowRequest({
        id: new PinterestObservationWorkflowId(`electron-pinterest-observation:${++sequence}`),
        businessPackageId,
        adapterId: ADAPTER_ID,
        credentialId,
        capability: requestedCapability,
        scope: SCOPE_FOR_CAPABILITY[requestedCapability.value] ?? PinterestObservationCollectionScope.OtherReadOnly,
        queryOrSubjectReference: typeof input.subjectReference === "string" ? input.subjectReference : undefined,
        marketContext: safeText(input.marketContext, "global", 80),
        languageContext: typeof input.languageContext === "string" ? input.languageContext : undefined,
        maximumPages: 1,
        maximumRecords: Math.min(25, Math.max(1, Number(input.pageSize) || 25)),
        correlationIdentifier: context.correlationIdentifier,
        requestingAuthorityReference: "ElectronUI",
        requestedAt: clock(),
      });
      const result = await observationWorkflow.run(observationRequest);
      if (!(result instanceof PinterestObservationWorkflowResult)) return { state: result, summary: undefined, warnings: [], failures: [], provenance: undefined };
      return {
        state: result.finalState,
        summary: result.summary.properties,
        warnings: result.warnings,
        failures: result.failures,
        provenance: result.properties.provenance,
      };
    },
    verificationRepository,
    observationWorkflow,
    integration,
  });
}