import { InMemoryMarketIntelligenceService } from "../../intelligence/market/MarketIntelligenceService.ts";
import { MarketDataQualityService } from "../../intelligence/market/quality/MarketDataQualityService.ts";
import { DuplicateHandlingPolicy, MarketDataQualityPolicy, MarketDataQualitySeverity, MarketDataValidity } from "../../intelligence/market/quality/MarketDataQualityDomain.ts";
import { BusinessPackageId } from "../../intelligence/market/MarketIntelligenceDomain.ts";
import { MarketSourceAdapterId, MarketSourceCapability } from "../../intelligence/market/integration/MarketSourceIntegrationDomain.ts";
import { MarketSourceIntegrationService } from "../../intelligence/market/integration/MarketSourceIntegrationService.ts";
import { AuthenticationType, CredentialId, CredentialStatus } from "../../security/credentials/CredentialVault.ts";
import { ExternalAuthenticationId, ExternalAuthenticationMethod, ExternalAuthenticationRequest, InterruptedOperationReference } from "../../security/authentication/ExternalAuthenticationDomain.ts";
import { PinterestConnectionVerificationId, PinterestConnectionVerificationRequest } from "./PinterestConnectionVerificationDomain.ts";
import { PinterestConnectionVerificationRepository } from "./PinterestConnectionVerificationRepository.ts";
import { PinterestConnectionVerifier } from "./PinterestConnectionVerifier.ts";
import { PinterestEnvironment, PinterestAccessTier } from "./PinterestMarketSourceAdapter.ts";
import { PinterestObservationCollectionScope, PinterestObservationWorkflowId, PinterestObservationWorkflowRequest, PinterestObservationWorkflowResult } from "./PinterestObservationWorkflowDomain.ts";
import { PinterestObservationWorkflowRepository } from "./PinterestObservationWorkflowRepository.ts";
import { PinterestObservationWorkflow } from "./PinterestObservationWorkflow.ts";
import { registerPinterestProductionProvider } from "./PinterestProductionProviderRegistration.ts";
import type { PinterestProductionProviderRegistration } from "./PinterestProductionProviderRegistration.ts";
import { PINTEREST_THUMBNAIL_TOTAL_MAX_BYTES, fetchPinterestThumbnail, fetchPinterestThumbnails, safeThumbnailDto, selectPinterestThumbnail } from "./PinterestThumbnailSecurity.ts";
import type { PinterestSafeThumbnail, PinterestThumbnailSource } from "./PinterestThumbnailSecurity.ts";

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
const optionalText = (value:unknown, maximum:number):string|undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized.slice(0, maximum) : undefined;
};
const destinationDomain = (value:unknown):string|undefined => {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && parsed.hostname.length <= 253 ? parsed.hostname.toLowerCase() : undefined;
  } catch { return undefined; }
};

export interface PinterestRendererSafePin {
  readonly pinId:string;
  readonly title?:string;
  readonly description?:string;
  readonly createdAt?:string;
  readonly boardName:string;
  readonly destinationDomain?:string;
  readonly thumbnail:PinterestSafeThumbnail|null;
}

const canonicalPayload=(observation:{payloadReference:string}):Record<string,unknown>|undefined=>{try{const parsed=JSON.parse(observation.payloadReference);return parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed:undefined;}catch{return undefined;}};
const boardIds=(observations:readonly {type:string;payloadReference:string}[]):readonly string[]=>Object.freeze([...new Set(observations.flatMap(observation=>{const canonical=observation.type==="pin"?canonicalPayload(observation):undefined;const id=optionalText(canonical?.boardReference,128);return id?[id]:[];}))].sort());

export function rendererSafePins(observations:readonly {type:string;observedAt:Date;payloadReference:string}[],boards:ReadonlyMap<string,string>=new Map()):readonly PinterestRendererSafePin[] {
  const pins:PinterestRendererSafePin[]=[];
  for(const observation of observations){
    if(observation.type!=="pin")continue;
    const canonical=canonicalPayload(observation);if(!canonical)continue;
    if(canonical.resourceType!=="pin")continue;
    const pinId=optionalText(canonical.resourceId,128);if(!pinId)continue;
    const observedAt=observation.observedAt instanceof Date&&Number.isFinite(observation.observedAt.getTime())?observation.observedAt.toISOString():undefined;
    const title=optionalText(canonical.title,160),description=optionalText(canonical.description,500),boardId=optionalText(canonical.boardReference,128),domain=destinationDomain(canonical.link);
    pins.push(Object.freeze({pinId,...(title&&{title}),...(description&&{description}),...(observedAt&&{createdAt:observedAt}),boardName:boardId&&boards.get(boardId)||"Unknown board",...(domain&&{destinationDomain:domain}),thumbnail:null}));
  }
  return Object.freeze(pins.sort((left,right)=>(right.createdAt??"").localeCompare(left.createdAt??"")||left.pinId.localeCompare(right.pinId)).slice(0,25));
}

export async function mergePinThumbnails(pins:readonly PinterestRendererSafePin[],mediaByPin:ReadonlyMap<string,unknown>,previous:readonly PinterestRendererSafePin[],fetcher:(source:PinterestThumbnailSource)=>Promise<PinterestSafeThumbnail|null>=fetchPinterestThumbnail):Promise<readonly PinterestRendererSafePin[]> {
  const prior=new Map(previous.map(pin=>[pin.pinId,safeThumbnailDto(pin.thumbnail)]));
  const fetched=await fetchPinterestThumbnails(pins,pin=>prior.get(pin.pinId)?undefined:selectPinterestThumbnail(mediaByPin.get(pin.pinId)),fetcher);
  let total=0;
  return Object.freeze(pins.map((pin,index)=>{
    const thumbnail=safeThumbnailDto(prior.get(pin.pinId)??fetched[index]);
    const bytes=thumbnail?Buffer.from(thumbnail.base64,"base64").length:0;
    const accepted=thumbnail&&total+bytes<=PINTEREST_THUMBNAIL_TOTAL_MAX_BYTES?thumbnail:null;
    total+=accepted?bytes:0;
    return Object.freeze({...pin,thumbnail:accepted});
  }));
}

export interface PinterestElectronCompositionRequest {
  readonly registration:PinterestProductionProviderRegistration;
  readonly credentialId:string;
  readonly businessPackageId:string;
  readonly apiBaseUrl:string;
  readonly clock?:() => Date;
  readonly thumbnailFetcher?:(source:PinterestThumbnailSource)=>Promise<PinterestSafeThumbnail|null>;
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
  let pinSnapshot:readonly PinterestRendererSafePin[]=Object.freeze([]);
  const boardLookup=new Map<string,string>();
  const resolveBoardNames=async(ids:readonly string[],correlationIdentifier:string)=>{
    const unresolved=new Set(ids.filter(id=>!boardLookup.has(id)));if(!unresolved.size)return;
    try{
    const requestedAt=clock();
    const interrupted=new InterruptedOperationReference({tcoTaskReference:"ElectronUI",sourceAdapterReference:ADAPTER_ID,businessPackageId,correlationIdentifier});
    const authentication=await request.registration.authentication.authenticate(new ExternalAuthenticationRequest({id:new ExternalAuthenticationId(`electron-pinterest-boards:${++sequence}`),credentialId,method:ExternalAuthenticationMethod.OAuth,businessPackageId,sourceAdapterReference:ADAPTER_ID,requestedCapability:"OwnBoards",tcoTaskReference:"ElectronUI",sourceRequestReference:`electron-pinterest-boards:${sequence}`,correlationIdentifier,requestingAuthorityReference:"ElectronUI",requestedAt,interruptedOperation:interrupted}));
    if(!authentication.successful)return;
    let bookmark:string|undefined;const seen=new Set<string>();
    for(let page=0;page<10&&unresolved.size;page++){
      const response=await request.registration.transport.execute({baseUrl:request.apiBaseUrl,environment:PinterestEnvironment.Production,path:"/v5/boards",query:{page_size:"25",...(bookmark?{bookmark}:{})},timeoutMs:30_000,session:authentication.session});
      if(response.status<200||response.status>=300)return;
      const root=response.body&&typeof response.body==="object"&&!Array.isArray(response.body)?response.body as Record<string,unknown>:undefined;
      if(!root||!Array.isArray(root.items)||(root.bookmark!==undefined&&root.bookmark!==null&&typeof root.bookmark!=="string"))return;
      for(const item of root.items){if(!item||typeof item!=="object"||Array.isArray(item))continue;const board=item as Record<string,unknown>,id=optionalText(board.id,128),name=optionalText(board.name,160);if(id&&name&&unresolved.has(id)){boardLookup.set(id,name);unresolved.delete(id);}}
      if(typeof root.bookmark!=="string"||!root.bookmark)break;if(seen.has(root.bookmark))return;seen.add(root.bookmark);bookmark=root.bookmark;
    }
    }catch{return;}
  };
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
      if (!(result instanceof PinterestObservationWorkflowResult)) return { state: result, summary: undefined, warnings: [], failures: [], provenance: undefined, pins: pinSnapshot };
      const ids=boardIds(result.acceptedObservations);if(ids.length)await resolveBoardNames(ids,context.correlationIdentifier);
      const normalizedPins=rendererSafePins(result.acceptedObservations,boardLookup);
      if(normalizedPins.length>0){
        const mediaByPin=new Map<string,unknown>();for(const observation of result.acceptedObservations){const canonical=canonicalPayload(observation),id=optionalText(canonical?.resourceId,128);if(id)mediaByPin.set(id,canonical?.media);}
        pinSnapshot=await mergePinThumbnails(normalizedPins,mediaByPin,pinSnapshot,request.thumbnailFetcher??fetchPinterestThumbnail);
      }else if(result.finalState==="NoData"&&result.summary.properties.rawRecordsCollected===0)pinSnapshot=normalizedPins;
      return {
        state: result.finalState,
        summary: result.summary.properties,
        warnings: result.warnings,
        failures: result.failures,
        provenance: result.properties.provenance,
        pins: pinSnapshot,
      };
    },
    verificationRepository,
    observationWorkflow,
    integration,
  });
}
