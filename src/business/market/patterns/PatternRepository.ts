import { EntityId } from "../../../core/platform/EntityId.ts";
import type { Repository } from "../../../core/platform/Repository.ts";
import { RepositoryRecord } from "../../../core/platform/RepositoryRecord.ts";
import { VersionToken } from "../../../core/platform/VersionToken.ts";
import { BusinessPackageId, FreshnessStatus } from "../../../intelligence/market/MarketIntelligenceDomain.ts";
import { MarketPattern, PatternCandidate, PatternDecay, PatternDirection, PatternId, PatternStability, PatternStatus, PatternType } from "./PatternIntelligenceDomain.ts";
import { PatternIntelligenceException } from "./PatternIntelligenceException.ts";

export interface PatternQuery { type?:PatternType;direction?:PatternDirection;status?:PatternStatus;businessPackageId?:BusinessPackageId;minimumConfidence?:number;freshness?:FreshnessStatus;stability?:PatternStability;decay?:PatternDecay; }
export class PatternRepository {
 readonly #candidates=new Map<string,PatternCandidate>();readonly #patterns=new Map<string,MarketPattern[]>();
 constructor(private readonly repository:Repository){}
 createCandidate(candidate:PatternCandidate):PatternCandidate{const key=this.candidateKey(candidate.businessPackageId,candidate.id);if(this.#candidates.has(key))throw new PatternIntelligenceException("Pattern candidate already exists","DUPLICATE_CANDIDATE");this.repository.create(new RepositoryRecord({entityId:new EntityId(`pattern-candidate:${key}`),version:new VersionToken("1"),recordType:"pattern-candidate",payload:{id:candidate.id.value,businessPackageId:candidate.businessPackageId.value},createdAt:candidate.firstObservedAt,updatedAt:candidate.latestObservedAt}));this.#candidates.set(key,candidate);return candidate;}
 candidate(id:PatternId,businessPackageId:BusinessPackageId):PatternCandidate|undefined{return this.#candidates.get(this.candidateKey(businessPackageId,id));}
 store(pattern:MarketPattern):MarketPattern{const key=this.patternKey(pattern.businessPackageId,pattern.id),history=this.#patterns.get(key)??[];if(pattern.version!==history.length+1)throw new PatternIntelligenceException("Pattern version must append immutable history","INVALID_VERSION");this.repository.create(new RepositoryRecord({entityId:new EntityId(`market-pattern:${key}:v${pattern.version}`),version:new VersionToken(String(pattern.version)),recordType:"market-pattern-version",payload:{id:pattern.id.value,businessPackageId:pattern.businessPackageId.value,version:pattern.version},createdAt:pattern.createdAt,updatedAt:pattern.evaluatedAt}));this.#patterns.set(key,[...history,pattern]);return pattern;}
 current(id:PatternId,businessPackageId:BusinessPackageId):MarketPattern|undefined{return this.#patterns.get(this.patternKey(businessPackageId,id))?.at(-1);}
 history(id:PatternId,businessPackageId:BusinessPackageId):readonly MarketPattern[]{return Object.freeze([...(this.#patterns.get(this.patternKey(businessPackageId,id))??[])]);}
 query(filter:PatternQuery={}):readonly MarketPattern[]{return Object.freeze([...this.#patterns.values()].map(h=>h.at(-1)!).filter(p=>(filter.type===undefined||p.type===filter.type)&&(filter.direction===undefined||p.direction===filter.direction)&&(filter.status===undefined||p.status===filter.status)&&(filter.businessPackageId===undefined||p.businessPackageId.value===filter.businessPackageId.value)&&(filter.minimumConfidence===undefined||p.confidence.value>=filter.minimumConfidence)&&(filter.freshness===undefined||p.freshness.status===filter.freshness)&&(filter.stability===undefined||p.stability===filter.stability)&&(filter.decay===undefined||p.decay===filter.decay)).sort((a,b)=>a.businessPackageId.value.localeCompare(b.businessPackageId.value)||a.id.value.localeCompare(b.id.value)));}
 private candidateKey(pkg:BusinessPackageId,id:PatternId):string{return `${pkg.value}:${id.value}`;} private patternKey(pkg:BusinessPackageId,id:PatternId):string{return `${pkg.value}:${id.value}`;}
}
