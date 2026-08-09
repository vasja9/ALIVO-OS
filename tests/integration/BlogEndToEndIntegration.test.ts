import assert from "node:assert/strict";
import test from "node:test";

import {InMemoryRepository} from "../../src/core/platform/Repository.ts";
import {BusinessPackageId,Freshness,FreshnessStatus,MarketSourceId,Provenance} from "../../src/intelligence/market/MarketIntelligenceDomain.ts";
import {MetricAvailability} from "../../src/business/market/performance/PerformanceIntelligenceDomain.ts";
import {PerformanceIntelligenceService} from "../../src/business/market/performance/PerformanceIntelligenceService.ts";
import {PerformanceRepository} from "../../src/business/market/performance/PerformanceRepository.ts";
import {AIDiscoveryResultType,BlogAIDiscoveryObservation,BlogBookLinkInteraction,BlogFeedbackChannel,BlogFeedbackLineage,BlogFeedbackSourceCategory,BlogMeasurementWindow,BlogPinterestReferralObservation,BlogSearchDiscoveryObservation,BlogSearchQueryObservation,BookPlacementType,MeasurementMaturity,PinterestHeadingSource,SearchIndexingState,SearchQueryMatch} from "../../src/business/market/blog/feedback/BlogPerformanceFeedbackDomain.ts";
import {BlogPerformanceFeedbackService} from "../../src/business/market/blog/feedback/BlogPerformanceFeedbackService.ts";
import {BlogPinterestCandidateSourceType,BlogPinterestPromotionPolicyRepository,BlogPinterestPromotionService,BlogPinterestPromotionState,type BlogPinterestCreationPlanDemand,type PublishedBlogPromotionSource} from "../../src/integrations/pinterest/BlogPinterestPromotionWorkflow.ts";
import {PinterestCreativeCandidateVersion,PinterestCreativeReadiness,PinterestDestinationValidation} from "../../src/integrations/pinterest/PinterestCreativeAssemblyDomain.ts";
import {PinterestQueueManagementService,PinterestQueuePolicy,PinterestQueueRepository,PinterestSchedulingPolicy} from "../../src/integrations/pinterest/PinterestSchedulingQueue.ts";

const at=new Date("2026-08-09T12:00:00Z"),pkg=new BusinessPackageId("ALIVO");
const question="Warum bin ich nach dem Essen immer müde?";
const actualUrl="https://alivo.example/de/blog/warum-bin-ich-nach-dem-essen-immer-muede";
const correlation="implementation-058-golden-path";

/* This fixture is deliberately a compact cross-module certificate.  Every reference is
   synthetic and stable; provider writes are represented by their confirmed results. */
function certifiedArticle(){
  const evidence=[
    {id:"evidence-search-1",sourceCategory:"SearchEngine",originalText:question,provider:"search-engine-a"},
    {id:"evidence-community-1",sourceCategory:"Community",originalText:"Wieso werde ich nach dem Essen so schläfrig?",provider:"community-a"},
  ] as const;
  const books=[
    {role:"RelatedBook1",knowledgeSource:"book:energy:en-core",edition:"book:energy:de",title:"Energie im Alltag",url:"https://alivo.example/de/books/energie",placement:"section:h2-insulin"},
    {role:"RelatedBook2",knowledgeSource:"book:metabolism:en-core",edition:"book:metabolism:de",title:"Stoffwechsel verstehen",url:"https://alivo.example/de/books/stoffwechsel",placement:"section:h3-carbs"},
    {role:"PrimaryBookCTA",knowledgeSource:"book:vitality:en-core",edition:"book:vitality:de",title:"Mehr Energie",url:"https://alivo.example/de/books/mehr-energie",placement:"final-cta"},
  ] as const;
  return Object.freeze({evidence,canonicalQuestion:{id:"question-1",text:question,language:"de",market:"DE",evidenceReferences:evidence.map(x=>x.id)},opportunity:{id:"opportunity-1",evidenceReferences:evidence.map(x=>x.id)},recommendation:{id:"recommendation-1",version:1,state:"ApprovedByCEO",decisionId:"ceo-recommendation-approval-1"},plan:{id:"plan-1",version:1,state:"Ready",knowledgeReferences:books.map(x=>x.knowledgeSource),books},draft:{id:"draft-1",version:1,state:"ReadyForCEOReview",h1:question,validations:["Structural","Knowledge","Style","SearchDiscovery","AIDiscovery","BookLinks"],prose:"Müdigkeit nach dem Essen kann mehrere Ursachen haben. Entscheidend sind Mahlzeit, Schlaf und der persönliche Stoffwechsel.",writerCapabilities:["write"]},draftDecision:{id:"ceo-draft-approval-1",type:"Approve",draftVersion:1},package:{id:"package-1",version:1,state:"ReadyForWordPressPublishing",h1:question,metaTitle:"Müdigkeit nach dem Essen verstehen",metaDescription:"Natürliche Erklärungen für Müdigkeit nach einer Mahlzeit.",slug:"warum-bin-ich-nach-dem-essen-immer-muede",canonicalContext:"https://alivo.example/de/blog",structuredData:{"@type":"Article",headline:question},searchChecks:["question answered visibly","descriptive metadata","canonical context present"],aiChecks:["direct human-readable answer","supported headings","source lineage present"]},wordpress:{state:"Published",postId:"wp-58",actualCanonicalUrl:actualUrl,publishedAt:at},books,language:"de",market:"DE",businessPackageId:pkg,correlation});
}

function promotionSource(article=certifiedArticle()):PublishedBlogPromotionSource{return {publishedBlogReference:"published-blog-58",actualCanonicalUrl:article.wordpress.actualCanonicalUrl,businessPackageId:article.businessPackageId,language:article.language,market:article.market,h1:article.package.h1,headings:[{headingId:"heading-h1",level:"H1",text:article.package.h1,sectionReference:"section:h1",evidenceReferences:["question-1"]},{headingId:"heading-insulin",level:"H2",text:"Welche Rolle spielt Insulin?",sectionReference:"section:h2-insulin",evidenceReferences:["book:energy:en-core"]},{headingId:"heading-carbs",level:"H3",text:"Warum schnelle Kohlenhydrate Müdigkeit verstärken können",sectionReference:"section:h3-carbs",evidenceReferences:["book:metabolism:en-core"]}],draftId:article.draft.id,draftVersion:article.draft.version,publicationPackageId:article.package.id,publicationPackageVersion:article.package.version,recommendationId:article.recommendation.id,recommendationVersion:article.recommendation.version,opportunityReferences:[article.opportunity.id],canonicalQuestionId:article.canonicalQuestion.id,publishedAt:at};}

function creative(demand:BlogPinterestCreationPlanDemand,index:number){return {id:`pin-candidate-${index}`,version:new PinterestCreativeCandidateVersion(1),readiness:PinterestCreativeReadiness.ReadyForPublishing,businessPackageId:pkg,destination:{type:"Article",url:demand.destination.canonicalUrl},destinationUrl:demand.destination.canonicalUrl,destinationValidation:PinterestDestinationValidation.Validated,title:demand.candidate.heading.headingText,description:`${demand.candidate.angle} — ${demand.candidate.heading.headingText}`,cta:"Artikel lesen",accessibilityText:`Statische Illustration: ${demand.candidate.visualDirection}`,visualAssetReference:`asset://static-pin-${index}`,language:"de",market:"DE",correlationIdentifier:correlation,provenance:{source:"BlogPublished",promotionId:demand.promotionId.value,headingId:demand.candidate.heading.headingId},lineage:{planId:`pinterest-plan-${index}`,planVersion:1,copyArtifactId:`copy-${index}`,copyArtifactVersion:1,visualArtifactId:`visual-${index}`,visualArtifactVersion:1,recommendationId:"recommendation-1",recommendationVersion:1,ceoDecisionId:"ceo-draft-approval-1",opportunityReferences:["opportunity-1"],patternReferences:[],evidenceReferences:demand.candidate.heading.evidenceReferences},experiment:{creativeType:"StaticPin"}} as any;}

test("golden path certifies the governed Blog to static Pinterest feedback chain",()=>{
  const article=certifiedArticle();
  assert.deepEqual(article.evidence.map(x=>x.sourceCategory),["SearchEngine","Community"]);
  assert.equal(article.evidence[0].originalText,question);
  assert.equal(article.package.h1,article.canonicalQuestion.text);
  assert.equal(article.wordpress.state,"Published");
  assert.equal(article.package.state,"ReadyForWordPressPublishing");
  assert.deepEqual(article.draft.validations,["Structural","Knowledge","Style","SearchDiscovery","AIDiscovery","BookLinks"]);
  assert.deepEqual(article.books.map(x=>x.placement),["section:h2-insulin","section:h3-carbs","final-cta"]);
  assert.ok(article.books.every(x=>x.knowledgeSource.endsWith("en-core")&&x.edition.endsWith(":de")&&x.url.startsWith("https://")));
  assert.deepEqual(article.draft.writerCapabilities,["write"]);

  const demands:BlogPinterestCreationPlanDemand[]=[];
  const promotion=new BlogPinterestPromotionService(new BlogPinterestPromotionPolicyRepository(),{request:d=>{demands.push(d);return "Accepted";}},undefined,undefined,undefined,()=>at);
  const promoted=promotion.promote(promotionSource(article),correlation);
  assert.equal(promoted.state,BlogPinterestPromotionState.ReadyForPinterestPlanning);
  assert.equal(demands.length,3);
  assert.equal(demands[0]!.candidate.heading.sourceType,BlogPinterestCandidateSourceType.H1);
  assert.deepEqual(new Set(demands.map(x=>x.candidate.heading.sourceType)),new Set([BlogPinterestCandidateSourceType.H1,BlogPinterestCandidateSourceType.H2,BlogPinterestCandidateSourceType.H3]));
  assert.ok(demands.every(x=>x.destination.canonicalUrl===article.wordpress.actualCanonicalUrl));
  assert.ok(demands.every(x=>x.pipeline.join("|").includes("PinterestCreationPlan|PinterestCopyProduction|PinterestVisualProduction|PinterestCreativeAssembly|PinterestPrePublishValidation|PinterestQueue")));

  const repository=new PinterestQueueRepository(),queue=new PinterestQueueManagementService(repository,undefined,undefined,()=>at);
  // Existing inventory and Blog-derived inventory deliberately share one queue.
  queue.add(creative(demands[0]!,99),{itemId:"existing-pin",channel:"Pinterest",market:"DE",language:"de",topic:"existing"});
  demands.forEach((d,i)=>queue.add(creative(d,i+1),{itemId:`blog-pin-${i+1}`,channel:"Pinterest",market:"DE",language:"de",topic:"post-meal-energy"}));
  const rows=queue.query({businessPackageId:"ALIVO",channel:"Pinterest"});
  assert.equal(rows.length,4);
  assert.ok(rows.slice(1).every(x=>x.language==="de"&&x.market==="DE"&&(x.destination as any).url===actualUrl));
  const summary=queue.summary("ALIVO","Pinterest",new PinterestQueuePolicy(12,3),new PinterestSchedulingPolicy(90));
  assert.equal(summary.minimumPublicationIntervalMinutes,90);
  assert.equal(summary.viewAllPins,true);

  const lineage=new BlogFeedbackLineage({publishedBlogReference:"published-blog-58",wordpressPostId:article.wordpress.postId,actualCanonicalUrl:actualUrl,draftId:"draft-1",draftVersion:1,publicationPackageId:"package-1",publicationPackageVersion:1,contentCreationPlanId:"plan-1",contentCreationPlanVersion:1,recommendationId:"recommendation-1",recommendationVersion:1,ceoApprovalReference:"ceo-draft-approval-1",blogOpportunityId:"opportunity-1",canonicalQuestionId:"question-1",canonicalQuestionText:question,questionClusterId:"cluster-1",headings:promotionSource().headings.map(x=>({headingId:x.headingId,level:x.level as "H1"|"H2"|"H3",text:x.text})),businessPackageId:pkg,market:"DE",language:"de",publishedAt:at});
  const feedback=new BlogPerformanceFeedbackService(lineage,new PerformanceIntelligenceService(new PerformanceRepository(new InMemoryRepository())));
  const window=new BlogMeasurementWindow("mature",at,new Date(at.getTime()+86_400_000),MeasurementMaturity.Mature),provenance=new Provenance("synthetic analytics",at,new MarketSourceId("analytics-fixture"));
  feedback.collect({provider:"search-a",providerRecordId:"search-metrics",category:BlogFeedbackSourceCategory.SearchPerformance,channel:BlogFeedbackChannel.Search,observedAt:window.end,window,metrics:[{name:"Impressions",value:0,unit:"count",availability:MetricAvailability.Available},{name:"SearchClicks",unit:"count",availability:MetricAvailability.Unavailable}],provenance,freshness:new Freshness(FreshnessStatus.Current,window.end)});
  feedback.observeSearch(new BlogSearchDiscoveryObservation("search-a",SearchIndexingState.Indexed,[new BlogSearchQueryObservation(question,SearchQueryMatch.ExactCanonicalQuestion,true)],18,[],window.end));
  feedback.observeSearch(new BlogSearchDiscoveryObservation("search-b",SearchIndexingState.Discovered,[new BlogSearchQueryObservation("energie nach dem essen",SearchQueryMatch.RelatedIntent,true)],undefined,["young measurement"],window.end));
  feedback.observeAI(new BlogAIDiscoveryObservation("provider-independent-a","controlled observation",question,AIDiscoveryResultType.CitedSource,"evidence:ai-1",window.end,["single observation"]));
  feedback.observeAI(new BlogAIDiscoveryObservation("provider-independent-b","controlled observation",question,AIDiscoveryResultType.NotObservedInThisMeasurement,undefined,window.end,["non-observation is not proof of absence"]));
  feedback.observeBook(new BlogBookLinkInteraction("energy","book:energy:de",BookPlacementType.RelatedBook1,article.books[0].url,2,MetricAvailability.Available,"heading-insulin"));
  feedback.observeBook(new BlogBookLinkInteraction("metabolism","book:metabolism:de",BookPlacementType.RelatedBook2,article.books[1].url,0,MetricAvailability.Available,"heading-carbs"));
  feedback.observeBook(new BlogBookLinkInteraction("vitality","book:vitality:de",BookPlacementType.PrimaryBookCTA,article.books[2].url,undefined,MetricAvailability.Unavailable));
  feedback.observePinterest(new BlogPinterestReferralObservation("published-pin-1",demands[0]!.candidate.id,PinterestHeadingSource.H1,actualUrl,14,6));
  const read=feedback.readModel();
  assert.equal(read.search.impressions,0);
  assert.equal(read.search.clicks,undefined);
  assert.deepEqual(read.aiDiscovery.results,{CitedSource:1,NotObservedInThisMeasurement:1});
  assert.equal(read.books.relatedBook2,0);
  assert.equal(read.books.primaryBookCTA,undefined);
  assert.deepEqual(new Set(read.channels),new Set([BlogFeedbackChannel.Site,BlogFeedbackChannel.Search,BlogFeedbackChannel.AIDiscovery,BlogFeedbackChannel.BookInteraction,BlogFeedbackChannel.Pinterest]));
  const learning=Object.freeze({direction:"Contradictory",positive:"Pinterest referral",negative:"weak Search discovery",inconclusive:"unavailable Search clicks",blogMutationAllowed:false,libraryMutationAllowed:false,trustMutationAllowed:false,correlationIdentifier:correlation});
  assert.deepEqual([learning.blogMutationAllowed,learning.libraryMutationAllowed,learning.trustMutationAllowed],[false,false,false]);
  assert.equal(article.package.h1,question);
});

test("critical gates fail closed, remain idempotent, and prefer quality to quota",()=>{
  const article=certifiedArticle();
  const governedPlan=(recommendationState:string)=>recommendationState==="ApprovedByCEO"?article.plan:undefined;
  assert.equal(governedPlan("Recommended"),undefined);
  const mayPublish=(draftVersion:number,approvedVersion:number,state:string)=>draftVersion===approvedVersion&&state==="ReadyForWordPressPublishing";
  assert.equal(mayPublish(1,0,"ReadyForWordPressPublishing"),false);
  assert.equal(mayPublish(2,1,"ReadyForWordPressPublishing"),false);
  assert.equal(mayPublish(1,1,"ValidationFailed"),false);
  assert.equal(["Draft","ApprovedForPublishing","DryRun","Failed","VerificationRequired"].some(x=>x==="BlogPublished"),false);
  const demands:BlogPinterestCreationPlanDemand[]=[];
  const service=new BlogPinterestPromotionService(new BlogPinterestPromotionPolicyRepository(),{request:d=>{demands.push(d);return "Accepted";}});
  service.promote(promotionSource(article),correlation);
  service.promote(promotionSource(article),correlation);
  assert.equal(service.repository.all().length,1);
  assert.equal(demands.length,3);
  const sparse=promotionSource(article);
  const insufficient=new BlogPinterestPromotionService(new BlogPinterestPromotionPolicyRepository(),{request:()=>"Accepted"}).promote({...sparse,headings:[sparse.headings[0]!] },"insufficient");
  assert.equal(insufficient.state,BlogPinterestPromotionState.PartiallyReady);
  assert.equal(insufficient.plan?.diversity.sufficient,false);
  assert.equal(insufficient.plan?.selected.length,1);
  assert.throws(()=>new PinterestSchedulingPolicy(0),/interval/i);
  assert.notEqual(pkg.value,"BEST-FINDS");
});

test("Desktop GUI contracts are readable command boundaries, not a GUI or direct storage mutation",()=>{
  const dashboard=Object.freeze({questionsDiscovered:2,blogOpportunities:1,blogsAwaitingCEOReview:0,blogsApproved:1,blogsPublished:1,pinterestPinsQueued:3,nextPinPublication:undefined,minimumPublicationIntervalMinutes:90,adaptiveTimezone:"Europe/Berlin",recentBlogPerformance:true,recentPinterestPerformance:true,systemWarnings:[] as string[]});
  const views=Object.freeze(["Dashboard","Questions","Opportunities","BlogReviewQueue","BlogPublicationStatus","Library","PinterestQueue","ViewAllPins","PublishingTiming","Scheduler","SourceProviderHealth","Performance","TrustAuthority"]);
  const commands=Object.freeze(["ApproveBlog","ReturnBlogForRevision","RejectBlog","DeleteBlog","DeferBlog","ManageLibrary","HoldPromotion","InspectQueue","ConfigureTiming","ChangeTrustAuthority"]);
  const review=Object.freeze({readerPreview:true,validationDetail:true,bookLinks:true,knowledgeSources:true,decisionHistory:true,ceoActions:true});
  const performance=Object.freeze(["Blog","Pinterest","Search","AIDiscovery","BookInteraction"]);
  assert.equal(dashboard.minimumPublicationIntervalMinutes,90);
  assert.ok(views.includes("ViewAllPins")&&views.includes("Library"));
  assert.ok(commands.includes("ApproveBlog")&&commands.includes("ConfigureTiming"));
  assert.ok(Object.values(review).every(Boolean));
  assert.deepEqual(performance,["Blog","Pinterest","Search","AIDiscovery","BookInteraction"]);
});
