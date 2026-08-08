import { EntityId } from "../../../core/platform/EntityId.ts";
import type { Repository } from "../../../core/platform/Repository.ts";
import { RepositoryQuery } from "../../../core/platform/RepositoryQuery.ts";
import { RepositoryRecord } from "../../../core/platform/RepositoryRecord.ts";
import { VersionToken } from "../../../core/platform/VersionToken.ts";
import { BusinessPackageId, MarketSourceId } from "../../../intelligence/market/MarketIntelligenceDomain.ts";
import { CompetitiveAnalysis, CompetitiveAnalysisId, CompetitiveObservation, CompetitiveSubject, CompetitiveSubjectType } from "./CompetitiveIntelligenceDomain.ts";
import { CompetitiveIntelligenceException } from "./CompetitiveIntelligenceException.ts";

const OBSERVATION = "competitive-observation"; const ANALYSIS = "competitive-analysis";
export interface CompetitiveAnalysisFilter { businessPackageId?: BusinessPackageId; sourceId?: MarketSourceId; subjectId?: string; subjectType?: CompetitiveSubjectType; }
export interface CompetitiveIntelligenceService { registerObservation(observation: CompetitiveObservation): void; observations(businessPackageId?: BusinessPackageId): readonly CompetitiveObservation[]; analyse(subject: CompetitiveSubject, businessPackageId: BusinessPackageId | undefined, analysis: CompetitiveAnalysis): CompetitiveAnalysis; analyses(filter?: CompetitiveAnalysisFilter): readonly CompetitiveAnalysis[]; analysis(id: CompetitiveAnalysisId): CompetitiveAnalysis | undefined; }

export class RepositoryCompetitiveIntelligenceService implements CompetitiveIntelligenceService {
  readonly #observations = new Map<string, CompetitiveObservation>();
  readonly #analyses = new Map<string, CompetitiveAnalysis>();
  constructor(private readonly repository: Repository) {}
  registerObservation(observation: CompetitiveObservation): void { this.create(OBSERVATION, observation.id.value, observation, observation.marketObservation.observedAt); }
  observations(businessPackageId?: BusinessPackageId): readonly CompetitiveObservation[] { return Object.freeze(this.records<CompetitiveObservation>(OBSERVATION).filter(o=>businessPackageId===undefined || o.businessPackageId?.value===businessPackageId.value).sort((a,b)=>a.marketObservation.observedAt.getTime()-b.marketObservation.observedAt.getTime() || a.id.value.localeCompare(b.id.value))); }
  analyse(subject: CompetitiveSubject, businessPackageId: BusinessPackageId | undefined, analysis: CompetitiveAnalysis): CompetitiveAnalysis {
    if (analysis.subject.id!==subject.id || analysis.businessPackageId?.value!==businessPackageId?.value) throw new CompetitiveIntelligenceException("Analysis request context does not match result", "ANALYSIS_CONTEXT_MISMATCH");
    const registered = new Set(this.observations(businessPackageId).filter(o=>o.subject.id===subject.id).map(o=>o.id.value));
    if (analysis.sourceObservations.some(o=>!registered.has(o.id.value))) throw new CompetitiveIntelligenceException("Analysis may use only registered observations from its Business Package", "UNREGISTERED_OBSERVATION");
    this.create(ANALYSIS, analysis.id.value, analysis, analysis.analysisTimestamp); return analysis;
  }
  analyses(filter: CompetitiveAnalysisFilter = {}): readonly CompetitiveAnalysis[] { return Object.freeze(this.records<CompetitiveAnalysis>(ANALYSIS).filter(a=>(filter.businessPackageId===undefined||a.businessPackageId?.value===filter.businessPackageId.value)&&(filter.sourceId===undefined||a.sourceObservations.some(o=>o.marketObservation.sourceId.value===filter.sourceId!.value))&&(filter.subjectId===undefined||a.subject.id===filter.subjectId)&&(filter.subjectType===undefined||a.subject.type===filter.subjectType)).sort((a,b)=>a.analysisTimestamp.getTime()-b.analysisTimestamp.getTime()||a.id.value.localeCompare(b.id.value))); }
  analysis(id: CompetitiveAnalysisId): CompetitiveAnalysis | undefined { return this.records<CompetitiveAnalysis>(ANALYSIS).find(a=>a.id.value===id.value); }
  private records<T>(type: string): T[] {
    this.repository.query(new RepositoryQuery({recordType:type,ordering:"entity-id"}));
    return [...(type === OBSERVATION ? this.#observations.values() : this.#analyses.values())] as T[];
  }
  private create(type:string,id:string,payload:CompetitiveObservation|CompetitiveAnalysis,when:Date):void { try {
    this.repository.create(new RepositoryRecord({entityId:new EntityId(`${type}:${id}`),version:new VersionToken("1"),recordType:type,payload:{id},createdAt:when,updatedAt:when}));
    if (type === OBSERVATION) this.#observations.set(id, payload as CompetitiveObservation); else this.#analyses.set(id, payload as CompetitiveAnalysis);
  } catch(error) { throw new CompetitiveIntelligenceException(`${type} is already registered: ${id}`,"DUPLICATE_RECORD",{cause:error}); } }
}
