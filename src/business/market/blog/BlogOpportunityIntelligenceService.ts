import { FreshnessStatus, Confidence } from "../../../intelligence/market/MarketIntelligenceDomain.ts";
import { OpportunityEffort, OpportunityId, OpportunityRisk, OpportunityValue } from "../opportunities/OpportunityIntelligenceDomain.ts";
import { QuestionCoverageState, QuestionTrend } from "../questions/QuestionIntelligenceDomain.ts";
import { BlogKnowledgeAvailability, BlogOpportunity, BlogOpportunityCandidateInput, BlogOpportunityCoverageAssessment, BlogOpportunityDuplicateState, BlogOpportunityEvaluationRequest, BlogOpportunityEvaluationResult, BlogOpportunityEvaluationSummary, BlogOpportunityEvidenceGap, BlogOpportunityEvidenceSet, BlogOpportunityException, BlogOpportunityRejectionReason, BlogOpportunityRelevance, BlogOpportunityState, BlogOpportunityType } from "./BlogOpportunityDomain.ts";
import { BlogOpportunityRepository } from "./BlogOpportunityRepository.ts";

export class BlogOpportunityIntelligenceService {
 constructor(private readonly repository=new BlogOpportunityRepository()){}
 evaluate(request:BlogOpportunityEvaluationRequest,input:BlogOpportunityCandidateInput,at=request.requestedAt,version=1):BlogOpportunityEvaluationResult {
  const cluster=input.cluster,p=input.properties;
  if(request.businessPackageId.value!==cluster.businessPackageId.value)throw new BlogOpportunityException("Request and Question Cluster cannot cross Business Package boundaries","PACKAGE_MISMATCH");
  if(request.properties.questionClusterReference!==cluster.id.value||request.properties.canonicalQuestionReference!==cluster.canonical.selectedObservation.id.value)throw new BlogOpportunityException("Request must reference the exact Question Intelligence authority","REFERENCE_MISMATCH");
  const mismatchedMarket=request.properties.market!==cluster.market,mismatchedLanguage=request.properties.language!==cluster.language;
  const coverage=p.coverage??new BlogOpportunityCoverageAssessment(cluster.coverage.state,cluster.coverage.evidence);
  const gaps:BlogOpportunityEvidenceGap[]=[];
  if(cluster.evidence.independentObservationCount<2)gaps.push(BlogOpportunityEvidenceGap.InsufficientQuestionEvidence);
  if(cluster.evidence.sourceCategoryCount<2)gaps.push(BlogOpportunityEvidenceGap.InsufficientSourceDiversity);
  if(p.actualSearchVolume===undefined)gaps.push(BlogOpportunityEvidenceGap.UnknownSearchVolume);
  gaps.push(BlogOpportunityEvidenceGap.UnknownMarketSize);
  if(cluster.trend===QuestionTrend.InsufficientEvidence)gaps.push(BlogOpportunityEvidenceGap.UnknownTrend);
  if(coverage.state===QuestionCoverageState.Unknown)gaps.push(BlogOpportunityEvidenceGap.UnknownCoverage);
  if(p.duplicateAssessment.state===BlogOpportunityDuplicateState.Unknown)gaps.push(BlogOpportunityEvidenceGap.UnknownDuplicateRisk);
  if(p.knowledgeAvailability===BlogKnowledgeAvailability.InsufficientKnowledge)gaps.push(BlogOpportunityEvidenceGap.InsufficientKnowledge);
  if(p.knowledgeAvailability===BlogKnowledgeAvailability.ResearchRequired||p.knowledgeAvailability===BlogKnowledgeAvailability.PartialKnowledge)gaps.push(BlogOpportunityEvidenceGap.ResearchRequired);
  if((p.competitiveAnalyses?.length??0)===0&&(p.competitiveGaps?.length??0)===0)gaps.push(BlogOpportunityEvidenceGap.UnknownCompetitiveCoverage);
  if(p.aiDiscoveryContext===undefined)gaps.push(BlogOpportunityEvidenceGap.UnknownAIDiscoveryPotential);
  const canonicalReference=cluster.canonical.selectedObservation.id.value;
  const evidence=new BlogOpportunityEvidenceSet(canonicalReference,cluster.canonical.text,cluster.id.value,cluster.patternId?.value,cluster.contentGap?cluster.id.value:undefined,cluster.observations.map(x=>x.id.value),cluster.evidence.independentObservationCount,cluster.evidence.sourceCategoryCount,cluster.evidence.sourceCategories,cluster.intent.types,cluster.trend,cluster.evidence.freshness,cluster.market,cluster.language,p.relevance,coverage,p.duplicateAssessment,p.competitiveAnalyses??[],p.competitiveGaps??[],p.knowledgeAvailability,cluster.evidence.contradictingEvidence,gaps,p.actualSearchVolume,cluster.evidence.supportingEvidence.map(x=>x.provenance));
  const confidence=this.confidence(input);
  let type=this.type(input,coverage),state=BlogOpportunityState.Candidate,rejectionReason:BlogOpportunityRejectionReason|undefined;
  if(mismatchedMarket)rejectionReason=BlogOpportunityRejectionReason.UnsupportedMarket;
  else if(mismatchedLanguage)rejectionReason=BlogOpportunityRejectionReason.UnsupportedLanguage;
  else if(p.granularity==="TooNarrow")rejectionReason=BlogOpportunityRejectionReason.QuestionTooNarrow;
  else if(p.granularity==="TooBroad")rejectionReason=BlogOpportunityRejectionReason.QuestionTooBroad;
  else if(p.relevance===BlogOpportunityRelevance.Irrelevant||p.relevance===BlogOpportunityRelevance.Low)rejectionReason=BlogOpportunityRejectionReason.InsufficientBusinessRelevance;
  else if(cluster.evidence.freshness.status===FreshnessStatus.Expired)rejectionReason=BlogOpportunityRejectionReason.StaleEvidence;
  else if(cluster.evidence.contradictingEvidence.length>=cluster.evidence.supportingEvidence.length)rejectionReason=BlogOpportunityRejectionReason.ContradictedEvidence;
  else if(p.knowledgeAvailability===BlogKnowledgeAvailability.InsufficientKnowledge)rejectionReason=BlogOpportunityRejectionReason.InsufficientKnowledge;
  else if(p.duplicateAssessment.state===BlogOpportunityDuplicateState.LikelyDuplicate||p.duplicateAssessment.state===BlogOpportunityDuplicateState.ExistingEquivalentContent||p.duplicateAssessment.state===BlogOpportunityDuplicateState.ExistingOpportunity){state=BlogOpportunityState.Duplicate;type=BlogOpportunityType.NoNewArticleOpportunity;rejectionReason=BlogOpportunityRejectionReason.LikelyDuplicate;}
  else if(cluster.evidence.independentObservationCount<2)rejectionReason=BlogOpportunityRejectionReason.InsufficientEvidence;
  else if(cluster.evidence.sourceCategoryCount<2)state=BlogOpportunityState.Weak;
  else if(p.knowledgeAvailability===BlogKnowledgeAvailability.ResearchRequired||p.knowledgeAvailability===BlogKnowledgeAvailability.PartialKnowledge){state=BlogOpportunityState.ResearchRequired;type=BlogOpportunityType.ResearchFirst;}
  else if(confidence.value>=.65&&p.relevance===BlogOpportunityRelevance.High)state=BlogOpportunityState.Qualified;
  else if(cluster.trend===QuestionTrend.Emerging||cluster.trend===QuestionTrend.Growing)state=BlogOpportunityState.Emerging;
  else if(confidence.value<.45)state=BlogOpportunityState.Weak;
  if(rejectionReason&&state!==BlogOpportunityState.Duplicate)state=BlogOpportunityState.Rejected;
  const effort=p.knowledgeAvailability===BlogKnowledgeAvailability.SufficientKnowledge?OpportunityEffort.Moderate:OpportunityEffort.High;
  const risk=state===BlogOpportunityState.Duplicate||p.duplicateAssessment.state===BlogOpportunityDuplicateState.PossibleOverlap?OpportunityRisk.High:confidence.value<.5?OpportunityRisk.Moderate:OpportunityRisk.Low;
  const value=p.relevance===BlogOpportunityRelevance.High&&coverage.state!==QuestionCoverageState.StrongCoverage?OpportunityValue.High:p.relevance===BlogOpportunityRelevance.Moderate?OpportunityValue.Moderate:OpportunityValue.Unknown;
  const opportunity=state===BlogOpportunityState.Rejected?undefined:new BlogOpportunity(new OpportunityId(`blog:${cluster.id.value}`),version,cluster.businessPackageId,canonicalReference,cluster.canonical.text,cluster.id.value,cluster.contentGap?cluster.id.value:undefined,type,state,evidence,confidence,value,effort,risk,p.pinterestPromotionLineageReference,at);
  return new BlogOpportunityEvaluationResult({evaluationId:request.evaluationId,businessPackageId:request.businessPackageId,canonicalQuestionReference:canonicalReference,canonicalQuestionText:cluster.canonical.text,questionClusterReference:cluster.id.value,contentGapReference:request.properties.contentGapReference,opportunity,opportunityType:type,state,confidence,value,effort,risk,relevance:p.relevance,coverage,duplicateAssessment:p.duplicateAssessment,knowledgeAvailability:p.knowledgeAvailability,evidenceGaps:gaps,warnings:state===BlogOpportunityState.Weak?["Evidence remains too weak for qualification."]:[],rejectionReason,startedAt:at,completedAt:at,correlationIdentifier:request.properties.correlationIdentifier,provenance:evidence.provenance});
 }
 evaluateAndStore(request:BlogOpportunityEvaluationRequest,input:BlogOpportunityCandidateInput,at=request.requestedAt,version=1){return this.repository.saveEvaluation(this.evaluate(request,input,at,version));}
 reevaluate(request:BlogOpportunityEvaluationRequest,input:BlogOpportunityCandidateInput,at:Date){const history=this.repository.history(`blog:${input.cluster.id.value}`,input.cluster.businessPackageId);return this.evaluateAndStore(request,input,at,history.length+1);}
 summarize(results:readonly BlogOpportunityEvaluationResult[]){return new BlogOpportunityEvaluationSummary(results.length,results.filter(x=>x.properties.rejectionReason===undefined).length,results.filter(x=>x.properties.state===BlogOpportunityState.Candidate).length,results.filter(x=>x.properties.state===BlogOpportunityState.Emerging).length,results.filter(x=>x.properties.state===BlogOpportunityState.Qualified).length,results.filter(x=>x.properties.state===BlogOpportunityState.ResearchRequired).length,results.filter(x=>x.properties.state===BlogOpportunityState.Duplicate||x.properties.coverage.state===QuestionCoverageState.StrongCoverage).length,results.filter(x=>x.properties.state===BlogOpportunityState.Weak).length,results.filter(x=>x.properties.state===BlogOpportunityState.Rejected).length,results.filter(x=>[BlogOpportunityType.ExistingArticleExpansion,BlogOpportunityType.ExistingArticleUpdate].includes(x.properties.opportunityType)).length,results.filter(x=>x.properties.opportunityType===BlogOpportunityType.NewArticle).length);}
 confidence(input:BlogOpportunityCandidateInput){const c=input.cluster.evidence,p=input.properties;let score=.12+Math.min(c.independentObservationCount,5)*.08+Math.min(c.sourceCategoryCount,4)*.07+c.confidence.value*.22;score+=p.relevance===BlogOpportunityRelevance.High?.12:p.relevance===BlogOpportunityRelevance.Moderate?.06:-.12;score+=p.duplicateAssessment.state===BlogOpportunityDuplicateState.NoDuplicateFound?.06:p.duplicateAssessment.state===BlogOpportunityDuplicateState.PossibleOverlap?-.04:-.12;score+=p.knowledgeAvailability===BlogKnowledgeAvailability.SufficientKnowledge?.08:p.knowledgeAvailability===BlogKnowledgeAvailability.PartialKnowledge?.02:-.08;score-=Math.min(c.contradictingEvidence.length*.08,.24);return new Confidence(Math.max(0,Math.min(1,Number(score.toFixed(4)))));}
 private type(input:BlogOpportunityCandidateInput,coverage:BlogOpportunityCoverageAssessment){const p=input.properties;if(p.granularity==="TooNarrow")return BlogOpportunityType.ExistingArticleExpansion;if(coverage.state===QuestionCoverageState.StrongCoverage)return BlogOpportunityType.ExistingArticleUpdate;if(coverage.state===QuestionCoverageState.PartialCoverage)return BlogOpportunityType.ExistingArticleExpansion;if(p.duplicateAssessment.state===BlogOpportunityDuplicateState.PossibleOverlap)return BlogOpportunityType.RelatedArticle;return BlogOpportunityType.NewArticle;}
}
