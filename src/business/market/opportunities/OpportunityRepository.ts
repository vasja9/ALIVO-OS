import { EntityId } from "../../../core/platform/EntityId.ts";
import type { Repository } from "../../../core/platform/Repository.ts";
import { RepositoryRecord } from "../../../core/platform/RepositoryRecord.ts";
import { VersionToken } from "../../../core/platform/VersionToken.ts";
import { BusinessPackageId, FreshnessStatus } from "../../../intelligence/market/MarketIntelligenceDomain.ts";
import { MarketOpportunity, OpportunityCandidate, OpportunityEffort, OpportunityId, OpportunityPriority, OpportunityRisk, OpportunityScope, OpportunityStatus, OpportunityType, OpportunityValue } from "./OpportunityIntelligenceDomain.ts";
import { OpportunityIntelligenceException } from "./OpportunityIntelligenceException.ts";

export interface OpportunityQuery { type?:OpportunityType;status?:OpportunityStatus;businessPackageId?:BusinessPackageId;minimumConfidence?:number;freshness?:FreshnessStatus;value?:OpportunityValue;effort?:OpportunityEffort;risk?:OpportunityRisk;priority?:OpportunityPriority;scope?:OpportunityScope; }
export class OpportunityRepository {
 readonly #candidates=new Map<string,OpportunityCandidate>();readonly #opportunities=new Map<string,MarketOpportunity[]>();
 constructor(private readonly repository:Repository){}
 createCandidate(candidate:OpportunityCandidate):OpportunityCandidate{const key=this.key(candidate.businessPackageId,candidate.id);if(this.#candidates.has(key))throw new OpportunityIntelligenceException("Opportunity candidate already exists","DUPLICATE_CANDIDATE");this.repository.create(new RepositoryRecord({entityId:new EntityId(`opportunity-candidate:${key}`),version:new VersionToken("1"),recordType:"opportunity-candidate",payload:{id:candidate.id.value,businessPackageId:candidate.businessPackageId.value},createdAt:candidate.firstDetectedAt,updatedAt:candidate.latestEvidenceAt}));this.#candidates.set(key,candidate);return candidate;}
 candidate(id:OpportunityId,pkg:BusinessPackageId):OpportunityCandidate|undefined{return this.#candidates.get(this.key(pkg,id));}
 store(opportunity:MarketOpportunity):MarketOpportunity{const key=this.key(opportunity.businessPackageId,opportunity.id),history=this.#opportunities.get(key)??[];if(opportunity.version!==history.length+1)throw new OpportunityIntelligenceException("Opportunity version must append immutable history","INVALID_VERSION");this.repository.create(new RepositoryRecord({entityId:new EntityId(`market-opportunity:${key}:v${opportunity.version}`),version:new VersionToken(String(opportunity.version)),recordType:"market-opportunity-version",payload:{id:opportunity.id.value,businessPackageId:opportunity.businessPackageId.value,version:opportunity.version},createdAt:opportunity.createdAt,updatedAt:opportunity.evaluatedAt}));this.#opportunities.set(key,[...history,opportunity]);return opportunity;}
 current(id:OpportunityId,pkg:BusinessPackageId):MarketOpportunity|undefined{return this.#opportunities.get(this.key(pkg,id))?.at(-1);}
 history(id:OpportunityId,pkg:BusinessPackageId):readonly MarketOpportunity[]{return Object.freeze([...(this.#opportunities.get(this.key(pkg,id))??[])]);}
 query(q:OpportunityQuery={}):readonly MarketOpportunity[]{return Object.freeze([...this.#opportunities.values()].map(h=>h.at(-1)!).filter(o=>(q.type===undefined||o.type===q.type)&&(q.status===undefined||o.status===q.status)&&(q.businessPackageId===undefined||o.businessPackageId.value===q.businessPackageId.value)&&(q.minimumConfidence===undefined||o.confidence.value>=q.minimumConfidence)&&(q.freshness===undefined||o.freshness.status===q.freshness)&&(q.value===undefined||o.value===q.value)&&(q.effort===undefined||o.effort===q.effort)&&(q.risk===undefined||o.risk===q.risk)&&(q.priority===undefined||o.priority===q.priority)&&(q.scope===undefined||o.scope.matches(q.scope))).sort((a,b)=>a.businessPackageId.value.localeCompare(b.businessPackageId.value)||a.id.value.localeCompare(b.id.value)));}
 private key(pkg:BusinessPackageId,id:OpportunityId):string{return `${pkg.value}:${id.value}`;}
}
