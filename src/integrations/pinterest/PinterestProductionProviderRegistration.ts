import { BusinessPackageId } from "../../intelligence/market/MarketIntelligenceDomain.ts";
import { MarketSourceDescriptor } from "../../intelligence/market/integration/MarketSourceIntegrationDomain.ts";
import { MarketSourceIntegrationService } from "../../intelligence/market/integration/MarketSourceIntegrationService.ts";
import { CredentialId } from "../../security/credentials/CredentialVault.ts";
import { PinterestMarketSourceAdapter } from "./PinterestMarketSourceAdapter.ts";
import type { PinterestAdapterConfiguration, PinterestAuthenticationBoundary, PinterestOperationalReporter, PinterestQualityGate, PinterestTransport } from "./PinterestMarketSourceAdapter.ts";

/** The Electron CJS runtime supplies these exact adapter boundaries; domain orchestration remains in TS. */
export interface PinterestProductionProviderRegistration {
  readonly authentication: PinterestAuthenticationBoundary;
  readonly transport: PinterestTransport;
}

export interface PinterestProductionProviderRegistrationRequest {
  readonly registration: PinterestProductionProviderRegistration;
  readonly integration: MarketSourceIntegrationService;
  readonly credentialId: string;
  readonly businessPackageId: string;
  readonly configuration: PinterestAdapterConfiguration;
  readonly quality: PinterestQualityGate;
  readonly actor: string;
  readonly reporter?: PinterestOperationalReporter;
  readonly enable?: boolean;
  readonly clock?: () => Date;
}

export interface PinterestProductionProviderRegistrationResult {
  readonly adapter: PinterestMarketSourceAdapter;
  readonly descriptor: MarketSourceDescriptor;
}

export function registerPinterestProductionProvider(request: PinterestProductionProviderRegistrationRequest): PinterestProductionProviderRegistrationResult {
  const adapter = new PinterestMarketSourceAdapter(
    new CredentialId(request.credentialId),
    new BusinessPackageId(request.businessPackageId),
    request.configuration,
    request.registration.authentication,
    request.registration.transport,
    request.quality,
    request.reporter,
    request.clock,
  );
  const descriptor = request.integration.register(adapter, request.actor);
  if (request.enable) request.integration.enable(adapter.id, request.actor);
  return { adapter, descriptor };
}