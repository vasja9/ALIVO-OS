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
import { auditPinterestContent, emptyPinterestContentAudit, PINTEREST_CONTENT_AUDIT_CODES, PINTEREST_CONTENT_AUDIT_RULES, withPinterestContentAuditState } from "./PinterestContentReadinessAudit.ts";
import type { PinterestContentAuditPin, PinterestContentAuditResult } from "./PinterestContentReadinessAudit.ts";
import { emptyPinterestAccountAnalytics, parsePinterestAccountAnalytics, PINTEREST_ACCOUNT_ORGANIC_METRICS, withPinterestAccountAnalyticsState } from "./PinterestAccountAnalytics.ts";
import { emptyPinterestOrganicAnalytics, parsePinterestOrganicAnalytics, pinterestCompletedUtcWindow, PINTEREST_ORGANIC_METRICS, withPinterestOrganicAnalyticsState } from "./PinterestOrganicAnalytics.ts";
import { emptyPinterestTopPins, parsePinterestTopPins, PINTEREST_TOP_PINS_METRICS, withPinterestTopPinsState } from "./PinterestTopPinsAnalytics.ts";
import type { PinterestTopPinsResult } from "./PinterestTopPinsAnalytics.ts";

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
const optionalCodePointText = (value:unknown, maximum:number):string|undefined => {
  if (typeof value !== "string") return undefined;
  const normalized=value.trim();
  return normalized&&!/[\u0000-\u001f\u007f]/.test(normalized)?Array.from(normalized).slice(0,maximum).join(""):undefined;
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

export interface PinterestTopPinContentReadiness {
  readonly status:"Ready"|"NeedsAttention";
  readonly issueCount:number;
  readonly requiredIssueCount:number;
  readonly reviewIssueCount:number;
}

export interface PinterestTopPinContentReadinessDetails {
  readonly required:readonly string[];
  readonly review:readonly string[];
}

export interface PinterestRendererSafeTopPin {
  readonly title:string;
  readonly boardName:string;
  readonly impressions:number|null;
  readonly saves:number|null;
  readonly pinClicks:number|null;
  readonly outboundClicks:number|null;
  readonly contentReadiness:PinterestTopPinContentReadiness|null;
  readonly contentReadinessDetails:PinterestTopPinContentReadinessDetails|null;
}

export interface PinterestRendererSafeTopPinsResult extends Omit<PinterestTopPinsResult,"pins"> {
  readonly pins:readonly PinterestRendererSafeTopPin[];
}

const sameAuditSnapshot=(snapshot:readonly PinterestRendererSafePin[],audit:PinterestContentAuditResult):boolean=>{
  if((audit.state!=="Available"&&audit.state!=="TemporarilyUnavailable")||audit.pins.length!==snapshot.length||audit.analyzedPins!==snapshot.length)return false;
  const unmatched=new Set(snapshot.map(pin=>pin.pinId));
  return unmatched.size===snapshot.length&&audit.pins.every(pin=>unmatched.delete(pin.pinId))&&unmatched.size===0;
};
const safeTopPinContentReadiness=(value:PinterestContentAuditPin|undefined):PinterestTopPinContentReadiness|null=>{
  if(!value||!Array.isArray(value.issues)||value.issues.length>12||!['Ready','NeedsAttention'].includes(value.status))return null;
  let requiredIssueCount=0,reviewIssueCount=0;
  for(const issue of value.issues){if(issue?.level==="Required")requiredIssueCount++;else if(issue?.level==="Review")reviewIssueCount++;else return null;}
  const issueCount=requiredIssueCount+reviewIssueCount;
  if((value.status==="Ready"&&issueCount!==0)||(value.status==="NeedsAttention"&&issueCount===0))return null;
  return Object.freeze({status:value.status,issueCount,requiredIssueCount,reviewIssueCount});
};
const safeTopPinContentReadinessDetails=(value:PinterestContentAuditPin|undefined,summary:PinterestTopPinContentReadiness|null):PinterestTopPinContentReadinessDetails|null=>{
  if(!value||!summary||!Array.isArray(value.issues)||value.issues.length>12)return null;
  const issuesByCode=new Map<string,Readonly<{level:"Required"|"Review";message:string}>>();
  for(const issue of value.issues){
    if(!issue||typeof issue!=="object"||Array.isArray(issue)||typeof issue.code!=="string"||issuesByCode.has(issue.code))return null;
    const rule=PINTEREST_CONTENT_AUDIT_RULES[issue.code as keyof typeof PINTEREST_CONTENT_AUDIT_RULES];
    if(!rule||issue.level!==rule.level||issue.message!==rule.message)return null;
    issuesByCode.set(issue.code,Object.freeze({level:rule.level,message:rule.message}));
  }
  const required:string[]=[],review:string[]=[];
  for(const code of PINTEREST_CONTENT_AUDIT_CODES){const issue=issuesByCode.get(code);if(issue)(issue.level==="Required"?required:review).push(issue.message);}
  if(required.length+review.length!==summary.issueCount||required.length!==summary.requiredIssueCount||review.length!==summary.reviewIssueCount)return null;
  if(summary.status==="Ready"&&(required.length||review.length)||summary.status==="NeedsAttention"&&!required.length&&!review.length)return null;
  return Object.freeze({required:Object.freeze(required.slice()),review:Object.freeze(review.slice())});
};

export function rendererSafeTopPins(result:PinterestTopPinsResult,snapshot:readonly PinterestRendererSafePin[],audit:PinterestContentAuditResult):PinterestRendererSafeTopPinsResult {
  const snapshotById=new Map(snapshot.slice(0,25).map(pin=>[pin.pinId,pin]));
  const auditById=sameAuditSnapshot(snapshot,audit)?new Map(audit.pins.map(pin=>[pin.pinId,pin])):new Map<string,PinterestContentAuditPin>();
  const pins=result.pins.slice(0,25).flatMap(metrics=>{
    const pin=snapshotById.get(metrics.pinId);if(!pin)return[];
    const auditedPin=auditById.get(metrics.pinId),contentReadiness=safeTopPinContentReadiness(auditedPin);
    return[Object.freeze({title:pin.title??"Untitled Pin",boardName:pin.boardName||"Unknown board",impressions:metrics.impressions,saves:metrics.saves,pinClicks:metrics.pinClicks,outboundClicks:metrics.outboundClicks,contentReadiness,contentReadinessDetails:safeTopPinContentReadinessDetails(auditedPin,contentReadiness)})];
  });
  return Object.freeze({...result,pins:Object.freeze(pins)});
}

const samePinSnapshotEntry=(left:PinterestRendererSafePin,right:PinterestRendererSafePin|undefined):boolean=>!!right&&left.pinId===right.pinId&&left.title===right.title&&left.description===right.description&&left.createdAt===right.createdAt&&left.boardName===right.boardName&&left.destinationDomain===right.destinationDomain;

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
    const title=optionalCodePointText(canonical.title,160),description=optionalCodePointText(canonical.description,1000),boardId=optionalText(canonical.boardReference,128),domain=destinationDomain(canonical.link);
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
  let contentAudit=emptyPinterestContentAudit();
  let organicAnalytics=emptyPinterestOrganicAnalytics();
  let accountAnalytics=emptyPinterestAccountAnalytics();
  let topPinsAnalytics=emptyPinterestTopPins();
  const boardLookup=new Map<string,string>();
  const safeTopPinsResult=()=>rendererSafeTopPins(topPinsAnalytics,pinSnapshot,contentAudit);
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
      if (["AuthenticationRequired", "CredentialCorrectionRequired", "ReauthorizationRequired", "MFARequired", "PermissionDenied", "NonRecoverableFailure"].includes(result.properties.authenticationState)) { accountAnalytics=emptyPinterestAccountAnalytics(); topPinsAnalytics=emptyPinterestTopPins(); }
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
      if (!(result instanceof PinterestObservationWorkflowResult)) {
        if (["AuthenticationRequired", "WaitingForCredentialCorrection", "WaitingForReauthorization"].includes(String(result))) accountAnalytics=emptyPinterestAccountAnalytics();
        contentAudit=withPinterestContentAuditState(contentAudit,"TemporarilyUnavailable");
        return { state: result, summary: undefined, warnings: [], failures: [], provenance: undefined, pins: pinSnapshot, audit: contentAudit };
      }
      const ids=boardIds(result.acceptedObservations);if(ids.length)await resolveBoardNames(ids,context.correlationIdentifier);
      const normalizedPins=rendererSafePins(result.acceptedObservations,boardLookup);
      if(normalizedPins.length>0){
        const snapshotChanged=normalizedPins.length!==pinSnapshot.length||normalizedPins.some((pin,index)=>!samePinSnapshotEntry(pin,pinSnapshot[index]));
        const mediaByPin=new Map<string,unknown>();for(const observation of result.acceptedObservations){const canonical=canonicalPayload(observation),id=optionalText(canonical?.resourceId,128);if(id)mediaByPin.set(id,canonical?.media);}
        pinSnapshot=await mergePinThumbnails(normalizedPins,mediaByPin,pinSnapshot,request.thumbnailFetcher??fetchPinterestThumbnail);
        contentAudit=auditPinterestContent(pinSnapshot.map(pin=>({pinId:pin.pinId,title:pin.title,description:pin.description,createdAt:pin.createdAt,boardName:pin.boardName,destinationDomain:pin.destinationDomain,thumbnailPresent:pin.thumbnail!==null})));
        if(snapshotChanged){organicAnalytics=emptyPinterestOrganicAnalytics();topPinsAnalytics=emptyPinterestTopPins();}
      }else if(result.finalState==="NoData"&&result.summary.properties.rawRecordsCollected===0){
        pinSnapshot=normalizedPins;
        contentAudit=auditPinterestContent([]);
        organicAnalytics=emptyPinterestOrganicAnalytics();topPinsAnalytics=emptyPinterestTopPins();
      }else if(["Failed","Unavailable"].includes(result.finalState))contentAudit=withPinterestContentAuditState(contentAudit,"TemporarilyUnavailable");
      return {
        state: result.finalState,
        summary: result.summary.properties,
        warnings: result.warnings,
        failures: result.failures,
        provenance: result.properties.provenance,
        pins: pinSnapshot,
        audit: contentAudit,
      };
    },
    async readAccountPerformance(input:Record<string, unknown> = {}) {
      const context=common(input),window=pinterestCompletedUtcWindow(clock());
      try {
        const interrupted=new InterruptedOperationReference({tcoTaskReference:"ElectronUI",sourceAdapterReference:ADAPTER_ID,businessPackageId,correlationIdentifier:context.correlationIdentifier});
        const authentication=await request.registration.authentication.authenticate(new ExternalAuthenticationRequest({id:new ExternalAuthenticationId(`electron-pinterest-account-analytics:${++sequence}`),credentialId,method:ExternalAuthenticationMethod.OAuth,businessPackageId,sourceAdapterReference:ADAPTER_ID,requestedCapability:"AnalyticsObservation",tcoTaskReference:"ElectronUI",sourceRequestReference:`electron-pinterest-account-analytics:${sequence}`,correlationIdentifier:context.correlationIdentifier,requestingAuthorityReference:"ElectronUI",requestedAt:clock(),interruptedOperation:interrupted}));
        if(!authentication.successful)return accountAnalytics=emptyPinterestAccountAnalytics("ReauthorizationRequired");
        const response=await request.registration.transport.execute({baseUrl:request.apiBaseUrl,environment:PinterestEnvironment.Production,path:"/v5/user_account/analytics",query:{start_date:window.startDate,end_date:window.endDate,from_claimed_content:"BOTH",pin_format:"ALL",app_types:"ALL",metric_types:PINTEREST_ACCOUNT_ORGANIC_METRICS.join(","),split_field:"NO_SPLIT",content_type:"ORGANIC"},timeoutMs:30_000,session:authentication.session});
        if(response.status===401||response.status===403)return accountAnalytics=withPinterestAccountAnalyticsState(accountAnalytics,"Unavailable");
        if(response.status===429)return accountAnalytics=withPinterestAccountAnalyticsState(accountAnalytics,"RateLimited");
        if(response.status!==200)return accountAnalytics=withPinterestAccountAnalyticsState(accountAnalytics,"Failed");
        return accountAnalytics=parsePinterestAccountAnalytics(response.body,window);
      } catch {
        return accountAnalytics=withPinterestAccountAnalyticsState(accountAnalytics,"Failed");
      }
    },
    async readPerformance(input:Record<string, unknown> = {}) {
      if (!pinSnapshot.length) return organicAnalytics=emptyPinterestOrganicAnalytics();
      const context=common(input),window=pinterestCompletedUtcWindow(clock()),pinIds=pinSnapshot.map(pin=>pin.pinId).slice(0,25);
      try {
        const interrupted=new InterruptedOperationReference({tcoTaskReference:"ElectronUI",sourceAdapterReference:ADAPTER_ID,businessPackageId,correlationIdentifier:context.correlationIdentifier});
        const authentication=await request.registration.authentication.authenticate(new ExternalAuthenticationRequest({id:new ExternalAuthenticationId(`electron-pinterest-organic-analytics:${++sequence}`),credentialId,method:ExternalAuthenticationMethod.OAuth,businessPackageId,sourceAdapterReference:ADAPTER_ID,requestedCapability:"PerformanceObservation",tcoTaskReference:"ElectronUI",sourceRequestReference:`electron-pinterest-organic-analytics:${sequence}`,correlationIdentifier:context.correlationIdentifier,requestingAuthorityReference:"ElectronUI",requestedAt:clock(),interruptedOperation:interrupted}));
        if(!authentication.successful)return organicAnalytics=emptyPinterestOrganicAnalytics("ReauthorizationRequired");
        const response=await request.registration.transport.execute({baseUrl:request.apiBaseUrl,environment:PinterestEnvironment.Production,path:"/v5/pins/analytics",query:{pin_ids:pinIds.join(","),start_date:window.startDate,end_date:window.endDate,metric_types:PINTEREST_ORGANIC_METRICS.join(",")},timeoutMs:30_000,session:authentication.session});
        if(response.status===401||response.status===403)return organicAnalytics=withPinterestOrganicAnalyticsState(organicAnalytics,"Unavailable");
        if(response.status===429)return organicAnalytics=withPinterestOrganicAnalyticsState(organicAnalytics,"RateLimited");
        if(response.status!==200)return organicAnalytics=withPinterestOrganicAnalyticsState(organicAnalytics,"Failed");
        return organicAnalytics=parsePinterestOrganicAnalytics(response.body,pinIds,window);
      } catch {
        return organicAnalytics=withPinterestOrganicAnalyticsState(organicAnalytics,"Failed");
      }
    },
    async readTopPins(input:Record<string, unknown> = {}) {
      if (!pinSnapshot.length) {topPinsAnalytics=emptyPinterestTopPins();return safeTopPinsResult();}
      const context=common(input),window=pinterestCompletedUtcWindow(clock()),pinIds=pinSnapshot.map(pin=>pin.pinId).slice(0,25);
      try {
        const interrupted=new InterruptedOperationReference({tcoTaskReference:"ElectronUI",sourceAdapterReference:ADAPTER_ID,businessPackageId,correlationIdentifier:context.correlationIdentifier});
        const authentication=await request.registration.authentication.authenticate(new ExternalAuthenticationRequest({id:new ExternalAuthenticationId(`electron-pinterest-top-pins:${++sequence}`),credentialId,method:ExternalAuthenticationMethod.OAuth,businessPackageId,sourceAdapterReference:ADAPTER_ID,requestedCapability:"PerformanceObservation",tcoTaskReference:"ElectronUI",sourceRequestReference:`electron-pinterest-top-pins:${sequence}`,correlationIdentifier:context.correlationIdentifier,requestingAuthorityReference:"ElectronUI",requestedAt:clock(),interruptedOperation:interrupted}));
        if(!authentication.successful){topPinsAnalytics=emptyPinterestTopPins("ReauthorizationRequired");return safeTopPinsResult();}
        const response=await request.registration.transport.execute({baseUrl:request.apiBaseUrl,environment:PinterestEnvironment.Production,path:"/v5/user_account/analytics/top_pins",query:{start_date:window.startDate,end_date:window.endDate,sort_by:"OUTBOUND_CLICK",from_claimed_content:"BOTH",pin_format:"ALL",app_types:"ALL",content_type:"ORGANIC",metric_types:PINTEREST_TOP_PINS_METRICS.join(","),num_of_pins:"25"},timeoutMs:30_000,session:authentication.session});
        if(response.status===401||response.status===403){topPinsAnalytics=withPinterestTopPinsState(topPinsAnalytics,"Unavailable");return safeTopPinsResult();}
        if(response.status===429){topPinsAnalytics=withPinterestTopPinsState(topPinsAnalytics,"RateLimited");return safeTopPinsResult();}
        if(response.status!==200){topPinsAnalytics=withPinterestTopPinsState(topPinsAnalytics,"Failed");return safeTopPinsResult();}
        topPinsAnalytics=parsePinterestTopPins(response.body,window,pinIds);return safeTopPinsResult();
      } catch { topPinsAnalytics=withPinterestTopPinsState(topPinsAnalytics,"Failed");return safeTopPinsResult(); }
    },
    clearAccountPerformance() { accountAnalytics=emptyPinterestAccountAnalytics(); topPinsAnalytics=emptyPinterestTopPins(); },
    verificationRepository,
    observationWorkflow,
    integration,
  });
}
