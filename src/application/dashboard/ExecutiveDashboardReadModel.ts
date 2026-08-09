export type DashboardPeriod="7D"|"30D"|"90D"|"12M"|"ALL";
export type AvailabilityState="Unavailable"|"Unknown"|"NotConnected"|"NoDataYet"|"NotConfigured";
export type AvailableMetric={readonly state:"Available";readonly value:number;readonly unit:"count"|"percent"};
export type DashboardMetric=AvailableMetric|{readonly state:AvailabilityState};
export type TrendDirection="Increase"|"Decrease"|"Stable"|"Unavailable";

export interface ExecutiveKPI{readonly label:string;readonly metric:DashboardMetric;readonly comparison?:{readonly change:number;readonly unit:"percent"|"percentagePoints";readonly direction:TrendDirection;readonly label:string};readonly route?:string}
export interface PinterestTrendPoint{readonly observedAt:Date;readonly impressions:number;readonly outboundClicks:number;readonly saves:number;readonly ctrPercent:number}
export interface ExecutiveAttentionItem{readonly id:string;readonly title:string;readonly severity:"Critical"|"ActionRequired"|"Review"|"Warning"|"Information";readonly detail?:string;readonly route?:string}
export interface ProviderHealth{readonly provider:string;readonly state:"Healthy"|"Working"|"AttentionRequired"|"Degraded"|"Unavailable"|"AuthenticationRequired"|"NotConfigured"}

/** Application-facing snapshot. Values are composed by application queries; the UI never
 * reaches repositories, provider APIs, or recomputes performance semantics. */
export interface ExecutiveDashboardReadModel{
  readonly businessPackageId:string;
  readonly period:DashboardPeriod;
  readonly updatedAt:Date;
  readonly kpis:readonly ExecutiveKPI[];
  readonly attention:readonly ExecutiveAttentionItem[];
  readonly pinterest:{readonly metrics:Readonly<Record<"impressions"|"outboundClicks"|"saves"|"ctr",DashboardMetric>>;readonly trend:readonly PinterestTrendPoint[];readonly freshness?:Date;readonly providerState:"Ready"|"Loading"|"NoData"|"Error"};
  readonly blog:Readonly<Record<"published"|"visits"|"bookLinkClicks"|"primaryBookCtaClicks",DashboardMetric>>;
  readonly search:{readonly state:"Observed"|"Unavailable"|"NotConfigured";readonly freshness?:Date};
  readonly aiDiscovery:{readonly state:"Observed"|"Unavailable"|"NotConfigured";readonly observedReferences?:number;readonly freshness?:Date};
  readonly bookEngagement:Readonly<Record<"linkClicks"|"primaryCtaClicks"|"relatedClicks",DashboardMetric>>;
  readonly providers:readonly ProviderHealth[];
}

export interface ExecutiveDashboardQuery{
  read(input:{readonly businessPackageId:string;readonly period:DashboardPeriod}):Promise<ExecutiveDashboardReadModel>;
}
