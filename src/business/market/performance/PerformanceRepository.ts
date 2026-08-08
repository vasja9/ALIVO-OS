import { EntityId } from "../../../core/platform/EntityId.ts";
import type { Repository } from "../../../core/platform/Repository.ts";
import { RepositoryRecord } from "../../../core/platform/RepositoryRecord.ts";
import { VersionToken } from "../../../core/platform/VersionToken.ts";
import { BusinessPackageId } from "../../../intelligence/market/MarketIntelligenceDomain.ts";
import { ExpectedOutcome, MeasurementWindow, ObservedOutcome, PerformanceEvaluation, PerformanceMetricType, PerformanceObservation, PerformanceRecordId } from "./PerformanceIntelligenceDomain.ts";
import { PerformanceIntelligenceException } from "./PerformanceIntelligenceException.ts";

export interface PerformanceHistoryFilter { businessPackageId?:BusinessPackageId;subjectId?:string;metricType?:PerformanceMetricType;window?:MeasurementWindow; }
export interface PerformanceHistory { observations:readonly PerformanceObservation[];expectedOutcomes:readonly ExpectedOutcome[];observedOutcomes:readonly ObservedOutcome[];evaluations:readonly PerformanceEvaluation[]; }
export class PerformanceRepository {
 readonly #observations=new Map<string,PerformanceObservation>();readonly #expected=new Map<string,ExpectedOutcome>();readonly #observed=new Map<string,ObservedOutcome>();readonly #evaluations=new Map<string,PerformanceEvaluation>();
 constructor(private readonly repository:Repository){}
 storeObservation(value:PerformanceObservation):void{this.store("performance-observation",value.id.value,value,value.measuredAt,this.#observations);}
 observation(id:PerformanceRecordId):PerformanceObservation|undefined{return this.#observations.get(id.value);}
 storeExpectedOutcome(value:ExpectedOutcome):void{this.store("expected-outcome",value.id.value,value,value.expectedAt,this.#expected);}
 expectedOutcome(id:PerformanceRecordId):ExpectedOutcome|undefined{return this.#expected.get(id.value);}
 storeObservedOutcome(value:ObservedOutcome):void{this.store("observed-outcome",value.id.value,value,value.window.end,this.#observed);}
 observedOutcome(id:PerformanceRecordId):ObservedOutcome|undefined{return this.#observed.get(id.value);}
 storeEvaluation(value:PerformanceEvaluation):void{this.store("performance-evaluation",value.id.value,value,value.evaluatedAt,this.#evaluations);}
 evaluation(id:PerformanceRecordId):PerformanceEvaluation|undefined{return this.#evaluations.get(id.value);}
 history(filter:PerformanceHistoryFilter={}):PerformanceHistory{const evaluations=Object.freeze([...this.#evaluations.values()].filter(x=>{const outcome=this.#observed.get(x.observedOutcomeId.value);return (!filter.businessPackageId||x.businessPackageId.value===filter.businessPackageId.value)&&(!filter.subjectId||outcome?.subject.id===filter.subjectId)&&(!filter.metricType||x.comparisons.some(c=>c.metricType===filter.metricType))&&(!filter.window||this.overlaps(new MeasurementWindow(x.evaluatedAt,x.evaluatedAt),filter.window));}).sort((a,b)=>a.evaluatedAt.getTime()-b.evaluatedAt.getTime()||a.id.value.localeCompare(b.id.value)));return Object.freeze({observations:this.filtered(this.#observations.values(),filter,x=>x.measuredAt,x=>x.metrics),expectedOutcomes:this.filtered(this.#expected.values(),filter,x=>x.expectedAt,x=>x.metrics),observedOutcomes:this.filtered(this.#observed.values(),filter,x=>x.window.end,x=>x.metrics),evaluations});}
 evaluations(filter:PerformanceHistoryFilter={}):readonly PerformanceEvaluation[]{return this.history(filter).evaluations;}
 private filtered<T extends {id:PerformanceRecordId;businessPackageId:BusinessPackageId;subject?:{id:string};window?:MeasurementWindow}>(values:Iterable<T>,f:PerformanceHistoryFilter,at:(x:T)=>Date,metrics:(x:T)=>readonly {type:PerformanceMetricType}[]):readonly T[]{return Object.freeze([...values].filter(x=>(!f.businessPackageId||x.businessPackageId.value===f.businessPackageId.value)&&(!f.subjectId||x.subject?.id===f.subjectId)&&(!f.metricType||metrics(x).some(m=>m.type===f.metricType))&&(!f.window||this.overlaps(x.window??new MeasurementWindow(at(x),at(x)),f.window))).sort((a,b)=>at(a).getTime()-at(b).getTime()||a.id.value.localeCompare(b.id.value)));}
 private overlaps(a:MeasurementWindow,b:MeasurementWindow):boolean{return a.start<=b.end&&a.end>=b.start;}
 private store<T>(type:string,id:string,value:T,at:Date,map:Map<string,T>):void{if(map.has(id))throw new PerformanceIntelligenceException(`Performance record already exists: ${id}`,"DUPLICATE_RECORD");this.repository.create(new RepositoryRecord({entityId:new EntityId(`${type}:${id}`),version:new VersionToken("1"),recordType:type,payload:{id},createdAt:at,updatedAt:at}));map.set(id,value);}
}
