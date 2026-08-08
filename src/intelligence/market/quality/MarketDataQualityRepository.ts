import { MarketDataAcceptanceDecision,MarketDataFreshnessState,MarketDataQualityGrade,MarketDataQualitySeverity,MarketDataValidationRequest,MarketDataValidationResult,MarketDuplicateGroup,MarketContradiction,MarketDataQualityException } from "./MarketDataQualityDomain.ts";

/** Append-only repository. Every query is package-isolated and deterministically ordered. */
export class MarketDataQualityRepository {
  readonly #requests=new Map<string,MarketDataValidationRequest>(); readonly #results:MarketDataValidationResult[]=[]; readonly #groups=new Map<string,MarketDuplicateGroup>(); readonly #contradictions=new Map<string,MarketContradiction>();
  storeRequest(r:MarketDataValidationRequest){if(this.#requests.has(r.id.value))throw new MarketDataQualityException("Validation request already exists","IMMUTABLE_HISTORY");this.#requests.set(r.id.value,r);}
  request(id:string){return this.#requests.get(id);}
  storeResult(r:MarketDataValidationResult){if(this.#results.some(x=>x===r||x.id.value===r.id.value&&x.evaluatedAt.getTime()===r.evaluatedAt.getTime()))throw new MarketDataQualityException("Validation result already exists","IMMUTABLE_HISTORY");this.#results.push(r);}
  current(requestId:string){return this.history(requestId).at(-1);}
  history(requestId:string){return Object.freeze(this.#results.filter(x=>x.request.id.value===requestId).sort(order));}
  storeDuplicateGroup(g:MarketDuplicateGroup){if(this.#groups.has(g.id))throw new MarketDataQualityException("Duplicate group already exists","IMMUTABLE_HISTORY");this.#groups.set(g.id,g);}
  duplicateGroup(id:string){return this.#groups.get(id);}
  storeContradiction(c:MarketContradiction){if(this.#contradictions.has(c.id))throw new MarketDataQualityException("Contradiction already exists","IMMUTABLE_HISTORY");this.#contradictions.set(c.id,c);}
  contradiction(id:string){return this.#contradictions.get(id);}
  query(q:{businessPackageId:string;sourceId?:string;grade?:MarketDataQualityGrade;acceptance?:MarketDataAcceptanceDecision;severity?:MarketDataQualitySeverity;freshness?:MarketDataFreshnessState}){return Object.freeze(this.#results.filter(x=>x.request.properties.businessPackageId.value===q.businessPackageId&&(!q.sourceId||x.request.properties.source.id.value===q.sourceId)&&(!q.grade||x.grade===q.grade)&&(!q.acceptance||x.acceptance===q.acceptance)&&(!q.severity||x.issues.some(i=>i.severity===q.severity))&&(!q.freshness||x.freshness.state===q.freshness)).sort(order));}
  candidates(packageId:string){return this.query({businessPackageId:packageId});}
}
const order=(a:MarketDataValidationResult,b:MarketDataValidationResult)=>a.evaluatedAt.getTime()-b.evaluatedAt.getTime()||a.id.value.localeCompare(b.id.value);
