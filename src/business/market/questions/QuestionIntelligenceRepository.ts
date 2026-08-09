import { BusinessPackageId } from "../../../intelligence/market/MarketIntelligenceDomain.ts";
import { ObservedQuestion, ObservedQuestionId, QuestionCluster, QuestionClusterId, QuestionIntelligenceException } from "./QuestionIntelligenceDomain.ts";

/** Append-only question intelligence history with mandatory Business Package isolation. */
export class QuestionIntelligenceRepository {
  readonly #observations = new Map<string, readonly ObservedQuestion[]>();
  readonly #clusters = new Map<string, readonly QuestionCluster[]>();
  #key(packageId:BusinessPackageId,id:string){return `${packageId.value}\u0000${id}`;}
  saveObservation(value:ObservedQuestion):void {const key=this.#key(value.businessPackageId,value.id.value),history=this.#observations.get(key)??[];if(history.some(x=>x.properties.version===value.properties.version))throw new QuestionIntelligenceException("Observed question version already exists");this.#observations.set(key,Object.freeze([...history,value]));}
  saveCluster(value:QuestionCluster):void {const key=this.#key(value.businessPackageId,value.id.value),history=this.#clusters.get(key)??[];if(history.some(x=>x.version===value.version))throw new QuestionIntelligenceException("Question cluster version already exists");this.#clusters.set(key,Object.freeze([...history,value]));}
  observationHistory(id:ObservedQuestionId,packageId:BusinessPackageId):readonly ObservedQuestion[]{return this.#observations.get(this.#key(packageId,id.value))??Object.freeze([]);}
  clusterHistory(id:QuestionClusterId,packageId:BusinessPackageId):readonly QuestionCluster[]{return this.#clusters.get(this.#key(packageId,id.value))??Object.freeze([]);}
  clusters(packageId:BusinessPackageId):readonly QuestionCluster[]{return Object.freeze([...this.#clusters.entries()].filter(([key])=>key.startsWith(`${packageId.value}\u0000`)).flatMap(([,history])=>history.at(-1)!).sort((a,b)=>a.id.value.localeCompare(b.id.value)));}
}
