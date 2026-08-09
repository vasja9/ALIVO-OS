import { BusinessPackageId, Freshness, FreshnessStatus, MarketObservation, MarketSource, MarketSourceId, ObservationId, Provenance } from "../../intelligence/market/MarketIntelligenceDomain.ts";
import { MarketCollectionRequest, MarketCollectionResult, MarketCollectionResultStatus, MarketNormalizationResult, MarketNormalizationStatus, MarketSourceAdapterId, MarketSourceAvailability, MarketSourceCapability, MarketSourceDescriptor, MarketSourceFailure, MarketSourceFailureCategory, MarketSourceHealth, MarketSourceHealthState, MarketSourceRateLimit, MarketSourceState, RawMarketRecord } from "../../intelligence/market/integration/MarketSourceIntegrationDomain.ts";
import type { MarketSourceAdapter } from "../../intelligence/market/integration/MarketSourceIntegrationDomain.ts";
import { ExternalAuthenticationFailureType, ExternalAuthenticationId, ExternalAuthenticationMethod, ExternalAuthenticationRequest, InterruptedOperationReference } from "../../security/authentication/ExternalAuthenticationDomain.ts";
import type { AuthenticationSessionReference } from "../../security/authentication/ExternalAuthenticationDomain.ts";
import { CredentialId } from "../../security/credentials/CredentialVault.ts";
import { PinterestAccessMetadata, PinterestConnectionVerificationRequest } from "./PinterestConnectionVerificationDomain.ts";
import type { PinterestCapabilityProbeResult } from "./PinterestConnectionVerificationDomain.ts";

export enum PinterestEnvironment { Production="Production", Sandbox="Sandbox" }
export enum PinterestAccessTier { Unknown="Unknown", Trial="Trial", Standard="Standard", Other="Other" }
export enum PinterestOwnership { OwnedAuthorizedResource="OwnedAuthorizedResource", PublicExternalResource="PublicExternalResource", UnknownOwnership="UnknownOwnership" }
export enum PinterestValueState { Observed="Observed", Unavailable="Unavailable" }

export interface PinterestAdapterConfiguration {
  readonly environment:PinterestEnvironment;
  readonly apiBaseUrl:string;
  readonly accessTier:PinterestAccessTier;
  readonly approvedCapabilities:readonly MarketSourceCapability[];
  readonly requestedScopes:readonly string[];
  readonly pageSize:number;
  readonly maximumPages:number;
  readonly timeoutMs:number;
  readonly adapterVersion:string;
}

interface PinterestRequest { readonly baseUrl:string; readonly environment:PinterestEnvironment; readonly path:string; readonly query:Readonly<Record<string,string>>; readonly continuation?:string; readonly timeoutMs:number; readonly session:AuthenticationSessionReference; }
export interface PinterestTransportResponse { readonly status:number; readonly body:unknown; readonly headers?:Readonly<Record<string,string>>; }
export interface PinterestTransport { execute(request:PinterestRequest):Promise<PinterestTransportResponse>; }
export interface PinterestAuthenticationBoundary {
  authenticate(request:ExternalAuthenticationRequest):Promise<{successful:true;session:AuthenticationSessionReference}|{successful:false;failure:ExternalAuthenticationFailureType}>;
  reportProviderFailure(request:ExternalAuthenticationRequest,failure:ExternalAuthenticationFailureType):Promise<void>;
}
export interface PinterestQualityGate { validate(input:{normalization:MarketNormalizationResult;request:MarketCollectionRequest;collectionResultReference:string;fields:Readonly<Record<string,unknown>>}):{accepted:boolean}; }
export interface PinterestOperationalReporter { report(name:string,context:Readonly<Record<string,string>>):void; }

type ProviderRecord={id:string;type:"pin"|"board"|"trend"|"analytics";observedAt?:string;title?:string;description?:string;link?:string;boardId?:string;media?:unknown;ownership:PinterestOwnership;keyword?:string;rank?:number;region?:string;growth?:number;metric?:string;value?:number;windowStart?:string;windowEnd?:string};
type StoredRecord={provider:ProviderRecord;request:MarketCollectionRequest};

const SOURCE_ID=new MarketSourceId("Pinterest");
const ADAPTER_ID=new MarketSourceAdapterId("PinterestMarketSourceAdapter");
const SOURCE=new MarketSource(SOURCE_ID,"Pinterest","external-market-source");
const READ_SCOPES=new Set(["boards:read","pins:read","user_accounts:read","analytics:read"]);
const required=(value:string,name:string)=>{if(typeof value!=="string"||!value.trim())throw new Error(`${name} is required`);return value;};
const safeDate=(value:unknown):Date|undefined=>typeof value==="string"&&Number.isFinite(Date.parse(value))?new Date(value):undefined;
const object=(value:unknown):Record<string,unknown>|undefined=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:undefined;

export class PinterestMarketSourceAdapter implements MarketSourceAdapter {
  readonly id=ADAPTER_ID;
  readonly #records=new Map<string,StoredRecord>();
  #health:MarketSourceHealth;
  constructor(
    readonly credentialId:CredentialId,
    readonly businessPackageId:BusinessPackageId,
    readonly configuration:PinterestAdapterConfiguration,
    private readonly authentication:PinterestAuthenticationBoundary,
    private readonly transport:PinterestTransport,
    private readonly quality:PinterestQualityGate,
    private readonly reporter?:PinterestOperationalReporter,
    private readonly clock=()=>new Date(),
  ) {
    if(!(credentialId instanceof CredentialId)||!(businessPackageId instanceof BusinessPackageId))throw new Error("Pinterest adapter requires credential and Business Package references");
    required(configuration.apiBaseUrl,"API base URL");required(configuration.adapterVersion,"Adapter version");
    if(!Object.values(PinterestEnvironment).includes(configuration.environment)||!Number.isInteger(configuration.pageSize)||configuration.pageSize<1||!Number.isInteger(configuration.maximumPages)||configuration.maximumPages<1||!Number.isFinite(configuration.timeoutMs)||configuration.timeoutMs<=0)throw new Error("Pinterest adapter configuration is invalid");
    if(configuration.requestedScopes.some(scope=>!READ_SCOPES.has(scope)))throw new Error("Pinterest adapter accepts approved read scopes only");
    this.#health=new MarketSourceHealth(MarketSourceHealthState.Unknown,this.clock());Object.freeze(configuration.approvedCapabilities);Object.freeze(configuration.requestedScopes);
  }
  descriptor(){return new MarketSourceDescriptor({adapterId:this.id,source:SOURCE,displayName:"Pinterest Market Source Adapter",capabilities:this.configuration.approvedCapabilities,state:MarketSourceState.Registered,availability:MarketSourceAvailability.Unknown,health:this.#health,authorizations:[{businessPackageId:this.businessPackageId,capabilities:this.configuration.approvedCapabilities}],registeredAt:this.clock(),configurationReference:`pinterest:${this.configuration.environment}:${this.configuration.adapterVersion}`,credentialId:this.credentialId});}

  verifyAuthentication(request:PinterestConnectionVerificationRequest){const interrupted=new InterruptedOperationReference({tcoTaskReference:request.properties.requestingAuthorityReference,sourceAdapterReference:this.id,businessPackageId:request.properties.businessPackageId,correlationIdentifier:request.properties.correlationIdentifier});return this.authentication.authenticate(new ExternalAuthenticationRequest({id:new ExternalAuthenticationId(`pinterest-verification-auth:${request.id.value}`),credentialId:request.properties.credentialId,method:ExternalAuthenticationMethod.OAuth,businessPackageId:request.properties.businessPackageId,sourceAdapterReference:this.id,requestedCapability:request.requestedCapabilities.map(x=>x.value).join(","),tcoTaskReference:request.properties.requestingAuthorityReference,sourceRequestReference:request.id.value,correlationIdentifier:request.properties.correlationIdentifier,requestingAuthorityReference:request.properties.requestingAuthorityReference,requestedAt:request.requestedAt,interruptedOperation:interrupted}));}
  async probeCapability(capability:MarketSourceCapability,session:AuthenticationSessionReference):Promise<PinterestCapabilityProbeResult>{const path=capability.value===MarketSourceCapability.TrendObservation.value?"/v5/trends/keywords/verification/top/growing":capability.value===MarketSourceCapability.PerformanceObservation.value||capability.value===MarketSourceCapability.AnalyticsObservation.value?"/v5/user_account/analytics":capability.value==="OwnBoards"?"/v5/boards":"/v5/pins";const response=await this.transport.execute({baseUrl:this.configuration.apiBaseUrl,environment:this.configuration.environment,path,query:{page_size:"1"},timeoutMs:this.configuration.timeoutMs,session});const root=object(response.body);return {status:response.status,noData:response.status>=200&&response.status<300&&Array.isArray(root?.items)&&root.items.length===0,headers:response.headers,provenance:{endpoint:path,operation:"read-only-minimal-probe"}};}
  verificationMetadata(at:Date){return new PinterestAccessMetadata(this.configuration.environment,this.configuration.accessTier,this.configuration.requestedScopes,at,"Pinterest API v5",this.configuration.adapterVersion);}

  async collect(request:MarketCollectionRequest):Promise<MarketCollectionResult>{
    const at=this.clock(),provenance=new Provenance("PinterestMarketSourceAdapter",at,SOURCE_ID,[request.id,request.properties.correlationId]);
    if(request.properties.businessPackageId.value!==this.businessPackageId.value||!this.configuration.approvedCapabilities.some(c=>c.equals(request.properties.capability)))return this.result(request,MarketCollectionResultStatus.Unavailable,[],provenance,new MarketSourceFailure(MarketSourceFailureCategory.AuthorizationFailure,"Pinterest capability is unavailable for this Business Package",at));
    this.report("PinterestCollectionRequested",request);this.report("PinterestCollectionStarted",request);
    const authRequest=this.authenticationRequest(request,at),auth=await this.authentication.authenticate(authRequest);
    if(!auth.successful){this.report("PinterestAuthenticationRequired",request,"AuthenticationFailure");this.failHealth(at);return this.result(request,MarketCollectionResultStatus.Failed,[],provenance,new MarketSourceFailure(MarketSourceFailureCategory.AuthenticationFailure,"Pinterest authorization requires recovery",at));}
    const collected:RawMarketRecord[]=[];let continuation:string|undefined;const seen=new Set<string>();
    for(let page=0;page<this.configuration.maximumPages;page++){
      let response:PinterestTransportResponse;
      try{response=await this.transport.execute({baseUrl:this.configuration.apiBaseUrl,environment:this.configuration.environment,...this.mapRequest(request),continuation,timeoutMs:this.configuration.timeoutMs,session:auth.session});}
      catch(error){const category=error instanceof PinterestTimeoutError?MarketSourceFailureCategory.Timeout:MarketSourceFailureCategory.Unavailable;this.failHealth(this.clock());return this.partialOrFailed(request,collected,provenance,new MarketSourceFailure(category,error instanceof PinterestTimeoutError?"Pinterest request timed out":"Pinterest network request failed",this.clock()));}
      if(response.status===401){await this.authentication.reportProviderFailure(authRequest,ExternalAuthenticationFailureType.ReauthorizationRequired);this.report("PinterestAuthenticationRequired",request,"AuthenticationFailure");this.failHealth(this.clock());return this.partialOrFailed(request,collected,provenance,new MarketSourceFailure(MarketSourceFailureCategory.AuthenticationFailure,"Pinterest reauthorization is required",this.clock()));}
      if(response.status===403){this.report("PinterestPermissionDenied",request,"AuthorizationFailure");this.failHealth(this.clock());return this.partialOrFailed(request,collected,provenance,new MarketSourceFailure(MarketSourceFailureCategory.AuthorizationFailure,"Pinterest permission denied",this.clock()));}
      if(response.status===429){const rate=this.rateLimit(response,provenance);this.report("PinterestRateLimited",request,"RateLimited");this.failHealth(this.clock());return new MarketCollectionResult(request.id,this.id,SOURCE_ID,collected.length?MarketCollectionResultStatus.Partial:MarketCollectionResultStatus.RateLimited,collected,this.clock(),provenance,collected.length?new MarketSourceFailure(MarketSourceFailureCategory.RateLimited,"Pinterest rate limit reached after partial collection",this.clock()):undefined,rate);}
      if(response.status<200||response.status>=300){const category=response.status>=500?MarketSourceFailureCategory.Unavailable:MarketSourceFailureCategory.InvalidResponse;this.failHealth(this.clock());return this.partialOrFailed(request,collected,provenance,new MarketSourceFailure(category,response.status===404?"Pinterest resource was not found":"Pinterest provider request failed",this.clock()));}
      const parsed=this.parsePage(response.body);if(!parsed){this.report("PinterestCollectionFailed",request,"InvalidResponse");this.failHealth(this.clock());return this.partialOrFailed(request,collected,provenance,new MarketSourceFailure(MarketSourceFailureCategory.InvalidResponse,"Pinterest response was malformed",this.clock()));}
      for(const provider of parsed.records){const key=`${provider.type}:${provider.id}`;if(seen.has(key))continue;seen.add(key);const collectedAt=this.clock(),observedAt=safeDate(provider.observedAt);const recordProvenance=new Provenance("Pinterest API",observedAt??collectedAt,SOURCE_ID,[request.id,key]);const raw=new RawMarketRecord({id:`pinterest:${request.id}:${key}`,sourceId:SOURCE_ID,requestId:request.id,providerRecordReference:key,collectedAt,observedAt,payloadReference:`pinterest-raw:${request.id}:${key}`,provenance:recordProvenance,recordType:provider.type});this.#records.set(raw.id,{provider,request});collected.push(raw);}
      if(!parsed.continuation)break;if(seen.has(`continuation:${parsed.continuation}`))return this.partialOrFailed(request,collected,provenance,new MarketSourceFailure(MarketSourceFailureCategory.InvalidResponse,"Pinterest pagination did not advance",this.clock()));seen.add(`continuation:${parsed.continuation}`);continuation=parsed.continuation;
    }
    this.successHealth();const status=collected.length?MarketCollectionResultStatus.Success:MarketCollectionResultStatus.NoData;this.report(status===MarketCollectionResultStatus.Success?"PinterestCollectionCompleted":"PinterestCollectionNoData",request);return this.result(request,status,collected,provenance);
  }

  async normalize(raw:RawMarketRecord):Promise<MarketNormalizationResult>{
    const stored=this.#records.get(raw.id),at=this.clock();if(!stored)return new MarketNormalizationResult(raw,undefined,MarketNormalizationStatus.Unsupported,["Pinterest raw payload is unavailable"],raw.provenance,at);
    const p=stored.provider,observedAt=raw.properties.observedAt??raw.properties.collectedAt;
    if(!p.id||!p.type){this.report("PinterestNormalizationFailed",stored.request,"InvalidResponse");return new MarketNormalizationResult(raw,undefined,MarketNormalizationStatus.Rejected,["Required provider identity is missing"],raw.provenance,at);}
    const canonical={resourceId:p.id,resourceType:p.type,ownership:p.ownership,dataState:PinterestValueState.Observed,title:p.title,description:p.description,link:p.link,boardReference:p.boardId,media:p.media,keyword:p.keyword,rank:p.rank,region:p.region,growth:p.growth,analytics:p.type==="analytics"?{metric:p.metric,value:p.value,windowStart:p.windowStart,windowEnd:p.windowEnd}:undefined,competitorPrivateMetrics:{clicks:PinterestValueState.Unavailable,ctr:PinterestValueState.Unavailable,conversions:PinterestValueState.Unavailable,revenue:PinterestValueState.Unavailable}};
    const provenance=new Provenance("Pinterest API",observedAt,SOURCE_ID,[stored.request.id,raw.id,p.id]);const observation=new MarketObservation(new ObservationId(`pinterest-observation:${stored.request.properties.businessPackageId.value}:${p.type}:${p.id}:${observedAt.toISOString()}`),SOURCE_ID,observedAt,stored.request.properties.marketContext,stored.request.properties.businessPackageId,p.keyword??p.title??p.id,p.type,JSON.stringify(canonical),provenance,new Freshness(FreshnessStatus.Current,at));const normalization=new MarketNormalizationResult(raw,observation,MarketNormalizationStatus.Normalized,[],provenance,at);
    const decision=this.quality.validate({normalization,request:stored.request,collectionResultReference:`pinterest-result:${stored.request.id}`,fields:canonical});
    if(!decision.accepted){this.report("PinterestNormalizationFailed",stored.request,"DataQualityRejected");return new MarketNormalizationResult(raw,undefined,MarketNormalizationStatus.Rejected,["Market Data Quality did not accept the observation"],provenance,at);}
    return normalization;
  }

  private authenticationRequest(request:MarketCollectionRequest,at:Date){const interrupted=new InterruptedOperationReference({tcoTaskReference:request.properties.workflowOrTcoReference,marketCollectionRequestReference:request.id,sourceAdapterReference:this.id,businessPackageId:request.properties.businessPackageId,correlationIdentifier:request.properties.correlationId});return new ExternalAuthenticationRequest({id:new ExternalAuthenticationId(`pinterest-auth:${request.id}`),credentialId:this.credentialId,method:ExternalAuthenticationMethod.OAuth,businessPackageId:request.properties.businessPackageId,sourceAdapterReference:this.id,requestedCapability:request.properties.capability.value,tcoTaskReference:request.properties.workflowOrTcoReference,sourceRequestReference:request.id,correlationIdentifier:request.properties.correlationId,requestingAuthorityReference:request.properties.workflowOrTcoReference,requestedAt:at,interruptedOperation:interrupted});}
  private mapRequest(request:MarketCollectionRequest):Omit<PinterestRequest,"baseUrl"|"environment"|"continuation"|"timeoutMs"|"session">{const capability=request.properties.capability.value;const path=capability===MarketSourceCapability.TrendObservation.value?`/v5/trends/keywords/${encodeURIComponent(request.properties.marketContext)}/top/growing`:capability===MarketSourceCapability.PerformanceObservation.value||capability===MarketSourceCapability.AnalyticsObservation.value?"/v5/user_account/analytics":capability===MarketSourceCapability.MarketObservation.value&&request.properties.subjectReference?.startsWith("board:")?`/v5/boards/${encodeURIComponent(request.properties.subjectReference.slice(6))}`:"/v5/pins";const query:Record<string,string>={page_size:String(this.configuration.pageSize),market:request.properties.marketContext};if(request.properties.languageContext)query.language=request.properties.languageContext;if(request.properties.subjectReference)query.subject=request.properties.subjectReference;if(request.properties.windowStart)query.start_date=request.properties.windowStart.toISOString();if(request.properties.windowEnd)query.end_date=request.properties.windowEnd.toISOString();return {path,query};}
  private parsePage(body:unknown):{records:ProviderRecord[];continuation?:string}|undefined{const root=object(body);if(!root||!Array.isArray(root.items))return undefined;const records:ProviderRecord[]=[];for(const item of root.items){const v=object(item);if(!v||typeof v.id!=="string"||!v.id.trim()||!(["pin","board","trend","analytics"] as unknown[]).includes(v.type))return undefined;const ownership=Object.values(PinterestOwnership).includes(v.ownership as PinterestOwnership)?v.ownership as PinterestOwnership:PinterestOwnership.UnknownOwnership;const record:ProviderRecord={id:v.id,type:v.type as ProviderRecord["type"],ownership};for(const key of ["observedAt","title","description","link","boardId","keyword","region","metric","windowStart","windowEnd"] as const)if(typeof v[key]==="string")record[key]=v[key] as never;for(const key of ["rank","growth","value"] as const)if(typeof v[key]==="number"&&Number.isFinite(v[key]))record[key]=v[key] as never;if(v.media!==undefined)record.media=v.media;records.push(record);}return {records,...(typeof root.bookmark==="string"&&root.bookmark?{continuation:root.bookmark}:{})};}
  private rateLimit(response:PinterestTransportResponse,provenance:Provenance){const retry=response.headers?.["retry-after"],seconds=retry===undefined?undefined:Number(retry);return new MarketSourceRateLimit(true,this.clock(),provenance,Number.isFinite(seconds)?new Date(this.clock().getTime()+seconds!*1000):undefined,response.headers?.["x-ratelimit-reset"]);}
  private partialOrFailed(request:MarketCollectionRequest,records:RawMarketRecord[],provenance:Provenance,failure:MarketSourceFailure){const status=records.length?MarketCollectionResultStatus.Partial:MarketCollectionResultStatus.Failed;this.report(records.length?"PinterestCollectionPartial":"PinterestCollectionFailed",request,failure.category);return this.result(request,status,records,provenance,failure);}
  private result(request:MarketCollectionRequest,status:MarketCollectionResultStatus,records:RawMarketRecord[],provenance:Provenance,failure?:MarketSourceFailure){return new MarketCollectionResult(request.id,this.id,SOURCE_ID,status,records,this.clock(),provenance,failure);}
  private report(name:string,request:MarketCollectionRequest,failure?:string){this.reporter?.report(name,Object.freeze({businessPackageId:request.properties.businessPackageId.value,sourceId:SOURCE_ID.value,adapterId:this.id.value,capability:request.properties.capability.value,requestId:request.id,correlationId:request.properties.correlationId,...(failure&&{failure})}));}
  private successHealth(){this.#health=new MarketSourceHealth(MarketSourceHealthState.Healthy,this.clock(),0,this.clock());}
  private failHealth(at:Date){this.#health=new MarketSourceHealth(MarketSourceHealthState.Degraded,at,this.#health.consecutiveFailures+1,this.#health.lastSuccessfulInteraction,at);}
}

export class PinterestTimeoutError extends Error { constructor(){super("Pinterest transport timeout");this.name="PinterestTimeoutError";} }
