import assert from "node:assert/strict";
import { test } from "node:test";
import { ContentOpportunity, ContentOpportunityType } from "../../src/business/market/ContentOpportunity.ts";
import { KeywordOpportunity } from "../../src/business/market/KeywordOpportunity.ts";
import { MarketInsight } from "../../src/business/market/MarketInsight.ts";
import { MarketIntelligence, type MarketOperationalEvent } from "../../src/business/market/MarketIntelligence.ts";
import { MarketObservation } from "../../src/business/market/MarketObservation.ts";
import { MarketRecommendation, RecommendationPriority } from "../../src/business/market/MarketRecommendation.ts";
import { MarketSource } from "../../src/business/market/MarketSource.ts";
import { Trend, TrendDirection } from "../../src/business/market/Trend.ts";

const observation = (id: string, category = "Growing keyword", timestamp = 1) => new MarketObservation({ observationId: id, source: MarketSource.SearchEngine, timestamp: new Date(timestamp), category, language: "en", confidence: .8, evidence: [`evidence-${id}`] });
const keyword = (name: string, estimate = .7) => new KeywordOpportunity({ keyword: name, language: "en", searchIntent: "informational", estimatedOpportunity: estimate, confidence: .8, relatedTopics: ["market"] });

test("market observations are immutable value objects", () => {
  const item = observation("one");
  assert.ok(Object.isFrozen(item)); assert.ok(Object.isFrozen(item.evidence)); assert.deepEqual(item.evidence, ["evidence-one"]);
  const returned = item.timestamp; returned.setTime(50); assert.equal(item.timestamp.getTime(), 1);
});

test("trends, keyword opportunities, and content opportunities validate and remain advisory", () => {
  const trend = new Trend({ trendIdentifier: "growing", direction: TrendDirection.Growing, confidence: .9, timeWindow: { start: new Date(1), end: new Date(2) }, supportingObservationIds: ["one"] });
  const key = keyword("strong-keyword");
  const content = new ContentOpportunity({ opportunityIdentifier: "content-one", type: ContentOpportunityType.FAQ, description: "Create a new FAQ", supportingEvidence: ["one"], confidence: .8 });
  assert.ok(Object.isFrozen(trend)); assert.ok(Object.isFrozen(key)); assert.equal(content.recommendationOnly, true); assert.equal("publish" in content, false);
});

test("default and configurable observation scheduling publish operational events", () => {
  const events: MarketOperationalEvent[] = [], start = new Date("2026-01-01T00:00:00Z");
  assert.equal(new MarketIntelligence({ publishEvent: (event) => events.push(event) }).scheduleMarketObservations(start).toISOString(), "2026-01-31T00:00:00.000Z");
  assert.equal(new MarketIntelligence({ observationIntervalDays: 7 }).scheduleMarketObservations(start).toISOString(), "2026-01-08T00:00:00.000Z");
  assert.equal(events[0].name, "MarketObservationScheduled");
});

test("collection, classification, and trend identification are deterministic", () => {
  const market = new MarketIntelligence(); market.collectObservations([observation("z", "Declining keyword", 20), observation("a", "Growing keyword", 10)]);
  assert.deepEqual(market.observations().map((item) => item.observationId), ["a", "z"]);
  const first = market.classifyObservations(), second = market.classifyObservations();
  assert.deepEqual(first, second); assert.deepEqual(market.identifyTrends(first).map((item) => item.trendIdentifier), ["trend:DecliningKeyword", "trend:GrowingKeyword"]);
});

test("keyword review recommends new content without replacement or publishing behaviour", () => {
  const result = new MarketIntelligence().reviewKeywords([keyword("weaker", .4), keyword("stronger", .9)]);
  assert.deepEqual(result.keywords.map((item) => item.keyword), ["stronger", "weaker"]);
  assert.match(result.content[0].description, /Create new content/); assert.match(result.content[0].description, /do not alter published content/);
  assert.equal("publish" in result, false); assert.equal("replace" in result, false);
});

test("recommendations are advisory, deterministic, and separate from Business Memory", () => {
  const opportunity = keyword("new-topic"), insight = new MarketInsight({ summary: "Consider new topic content", supportingEvidence: ["public evidence"], confidence: .9, relatedOpportunities: [opportunity] });
  const market = new MarketIntelligence(), recommendations = market.prepareRecommendations([insight]);
  assert.deepEqual(recommendations, [new MarketRecommendation({ recommendationIdentifier: "market-recommendation-0001", description: "Consider new topic content", priority: RecommendationPriority.High, supportingEvidence: ["public evidence"], confidence: .9, recommendedCapability: "TCO" })]);
  assert.equal(recommendations[0].advisory, true); assert.equal("businessMemory" in market, false); assert.equal("publishContent" in market, false);
});
