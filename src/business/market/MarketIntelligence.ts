import { ContentOpportunity, ContentOpportunityType } from "./ContentOpportunity.ts";
import { KeywordOpportunity } from "./KeywordOpportunity.ts";
import { MarketInsight } from "./MarketInsight.ts";
import { MarketIntelligenceException } from "./MarketIntelligenceException.ts";
import { MarketObservation } from "./MarketObservation.ts";
import { MarketRecommendation, RecommendationPriority } from "./MarketRecommendation.ts";
import { MarketSignal, MarketSignalType } from "./MarketSignal.ts";
import { Trend, TrendDirection } from "./Trend.ts";

export interface MarketOperationalEvent { readonly name: "MarketObservationScheduled" | "MarketObservationsCollected" | "MarketObservationsClassified" | "MarketTrendsIdentified" | "MarketOpportunitiesIdentified" | "MarketRecommendationsPrepared"; readonly occurredAt: Date; readonly itemCount: number; }
export type MarketEventPublisher = (event: MarketOperationalEvent) => void;
export interface MarketIntelligenceOptions { readonly observationIntervalDays?: number; readonly publishEvent?: MarketEventPublisher; }
export interface MarketOpportunities { readonly keywords: readonly KeywordOpportunity[]; readonly content: readonly ContentOpportunity[]; }

/** Analysis boundary: it observes and recommends, but has no publishing or Business Memory dependency. */
export class MarketIntelligence {
  readonly observationIntervalDays: number;
  readonly #observations = new Map<string, MarketObservation>();
  readonly #publishEvent?: MarketEventPublisher;

  constructor(options: MarketIntelligenceOptions = {}) {
    const interval = options.observationIntervalDays ?? 30;
    if (!Number.isInteger(interval) || interval < 1) throw new MarketIntelligenceException("Observation interval must be a positive number of days", "INVALID_SCHEDULE");
    if (options.publishEvent !== undefined && typeof options.publishEvent !== "function") throw new MarketIntelligenceException("Event publisher is invalid", "INVALID_EVENT_PUBLISHER");
    this.observationIntervalDays = interval; this.#publishEvent = options.publishEvent;
  }

  scheduleMarketObservations(from: Date): Date {
    const timestamp = from?.getTime();
    if (!Number.isFinite(timestamp)) throw new MarketIntelligenceException("Schedule start is invalid", "INVALID_SCHEDULE");
    const next = new Date(timestamp); next.setUTCDate(next.getUTCDate() + this.observationIntervalDays);
    this.emit("MarketObservationScheduled", 1, from); return next;
  }

  collectObservations(observations: readonly MarketObservation[]): readonly MarketObservation[] {
    if (!Array.isArray(observations) || observations.some((item) => !(item instanceof MarketObservation))) throw new MarketIntelligenceException("Only market observations may be collected", "INVALID_OBSERVATION");
    for (const observation of observations) this.#observations.set(observation.observationId, observation);
    const collected = this.observations(); this.emit("MarketObservationsCollected", observations.length); return collected;
  }

  observations(): readonly MarketObservation[] {
    return Object.freeze([...this.#observations.values()].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.observationId.localeCompare(b.observationId)));
  }

  classifyObservations(observations: readonly MarketObservation[] = this.observations()): readonly MarketSignal[] {
    if (observations.some((item) => !(item instanceof MarketObservation))) throw new MarketIntelligenceException("Only market observations may be classified", "INVALID_OBSERVATION");
    const signals = observations.map((observation) => new MarketSignal({ signalIdentifier: `signal:${observation.observationId}`, type: this.signalType(observation.category), confidence: observation.confidence, supportingObservationIds: [observation.observationId] })).sort((a, b) => a.signalIdentifier.localeCompare(b.signalIdentifier));
    this.emit("MarketObservationsClassified", signals.length); return Object.freeze(signals);
  }

  identifyTrends(signals: readonly MarketSignal[], observations: readonly MarketObservation[] = this.observations()): readonly Trend[] {
    if (!Array.isArray(signals) || signals.some((item) => !(item instanceof MarketSignal))) throw new MarketIntelligenceException("Only market signals may form trends", "INVALID_SIGNAL");
    const times = new Map(observations.map((item) => [item.observationId, item.timestamp.getTime()]));
    const grouped = new Map<MarketSignalType, MarketSignal[]>();
    for (const signal of signals) grouped.set(signal.type, [...(grouped.get(signal.type) ?? []), signal]);
    const trends = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([type, members]) => {
      const ids = [...new Set(members.flatMap((item) => item.supportingObservationIds))].sort();
      const dates = ids.map((id) => times.get(id)).filter((value): value is number => value !== undefined);
      if (dates.length === 0) throw new MarketIntelligenceException("Trend observations must have been collected", "MISSING_OBSERVATION");
      return new Trend({ trendIdentifier: `trend:${type}`, direction: this.direction(type), confidence: members.reduce((sum, item) => sum + item.confidence, 0) / members.length, timeWindow: { start: new Date(Math.min(...dates)), end: new Date(Math.max(...dates)) }, supportingObservationIds: ids });
    });
    this.emit("MarketTrendsIdentified", trends.length); return Object.freeze(trends);
  }

  identifyOpportunities(keywords: readonly KeywordOpportunity[]): MarketOpportunities {
    if (!Array.isArray(keywords) || keywords.some((item) => !(item instanceof KeywordOpportunity))) throw new MarketIntelligenceException("Keyword opportunities are invalid", "INVALID_KEYWORD_OPPORTUNITY");
    const ordered = [...keywords].sort((a, b) => b.estimatedOpportunity - a.estimatedOpportunity || a.keyword.localeCompare(b.keyword));
    const content = ordered.map((keyword) => new ContentOpportunity({ opportunityIdentifier: `content:${keyword.language}:${keyword.keyword}`, type: ContentOpportunityType.Blog, description: `Create new content for ${keyword.keyword}; do not alter published content`, supportingEvidence: [keyword.keyword, ...keyword.relatedTopics], confidence: keyword.confidence }));
    this.emit("MarketOpportunitiesIdentified", ordered.length + content.length);
    return Object.freeze({ keywords: Object.freeze(ordered), content: Object.freeze(content) });
  }

  reviewKeywords(keywords: readonly KeywordOpportunity[]): MarketOpportunities { return this.identifyOpportunities(keywords); }

  prepareRecommendations(insights: readonly MarketInsight[]): readonly MarketRecommendation[] {
    if (!Array.isArray(insights) || insights.some((item) => !(item instanceof MarketInsight))) throw new MarketIntelligenceException("Only market insights may support recommendations", "INVALID_INSIGHT");
    const recommendations = insights.map((insight, index) => new MarketRecommendation({ recommendationIdentifier: `market-recommendation-${String(index + 1).padStart(4, "0")}`, description: insight.summary, priority: insight.confidence >= .8 ? RecommendationPriority.High : insight.confidence >= .5 ? RecommendationPriority.Medium : RecommendationPriority.Low, supportingEvidence: insight.supportingEvidence, confidence: insight.confidence, recommendedCapability: "TCO" }));
    this.emit("MarketRecommendationsPrepared", recommendations.length); return Object.freeze(recommendations);
  }

  private signalType(category: string): MarketSignalType {
    const normalized = category.toLowerCase().replace(/[^a-z]/g, "");
    const match = Object.values(MarketSignalType).find((type) => type.toLowerCase() === normalized);
    return match ?? MarketSignalType.EmergingTopic;
  }
  private direction(type: MarketSignalType): TrendDirection {
    if (type === MarketSignalType.GrowingKeyword || type === MarketSignalType.TrafficOpportunity || type === MarketSignalType.CompetitorActivity) return TrendDirection.Growing;
    if (type === MarketSignalType.DecliningKeyword) return TrendDirection.Declining;
    if (type === MarketSignalType.SeasonalTopic) return TrendDirection.Seasonal;
    return TrendDirection.Emerging;
  }
  private emit(name: MarketOperationalEvent["name"], itemCount: number, occurredAt = new Date()): void { this.#publishEvent?.(Object.freeze({ name, occurredAt: new Date(occurredAt.getTime()), itemCount })); }
}
