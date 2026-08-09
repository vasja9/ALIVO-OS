import type {ExecutiveDashboardReadModel,PinterestTrendPoint} from "../../src/application/dashboard/ExecutiveDashboardReadModel.ts";
const at=(day:number)=>new Date(`2026-07-${String(day).padStart(2,"0")}T12:00:00Z`);
export const pinterestTrendFixture:readonly PinterestTrendPoint[]=[
  {observedAt:at(1),impressions:100,outboundClicks:8,saves:5,ctrPercent:8},
  {observedAt:at(8),impressions:145,outboundClicks:11,saves:9,ctrPercent:7.6},
  {observedAt:at(15),impressions:190,outboundClicks:19,saves:8,ctrPercent:10},
  {observedAt:at(22),impressions:260,outboundClicks:17,saves:14,ctrPercent:6.5},
];
const count=(value:number)=>({state:"Available" as const,value,unit:"count" as const});
export const executiveDashboardFixture:ExecutiveDashboardReadModel={businessPackageId:"ALIVO",period:"30D",updatedAt:at(30),kpis:[{label:"Blogs Published",metric:count(0)},{label:"Questions Discovered",metric:{state:"Unavailable"}}],attention:[{id:"review-1",title:"Blog awaiting CEO approval",severity:"Review",route:"Blogs"}],pinterest:{metrics:{impressions:count(695),outboundClicks:count(55),saves:count(36),ctr:{state:"Available",value:7.9,unit:"percent"}},trend:pinterestTrendFixture,freshness:at(22),providerState:"Ready"},blog:{published:count(0),visits:{state:"Unavailable"},bookLinkClicks:count(4),primaryBookCtaClicks:count(0)},search:{state:"NotConfigured"},aiDiscovery:{state:"Observed",observedReferences:1,freshness:at(22)},bookEngagement:{linkClicks:count(4),primaryCtaClicks:count(0),relatedClicks:count(4)},providers:[{provider:"Pinterest",state:"Healthy"}]};
