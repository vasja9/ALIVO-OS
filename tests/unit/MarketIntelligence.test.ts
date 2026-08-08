import assert from "node:assert/strict";
import { test } from "node:test";

import { Kernel } from "../../src/core/kernel/Kernel.ts";
import { KernelState } from "../../src/core/kernel/KernelState.ts";
import { ModuleState } from "../../src/core/platform/ModuleState.ts";
import {
  BusinessPackageId,
  Confidence,
  Evidence,
  EvidenceId,
  EvidenceStatus,
  Freshness,
  FreshnessStatus,
  MarketObservation,
  MarketSource,
  MarketSourceId,
  ObservationId,
  Provenance,
} from "../../src/intelligence/market/MarketIntelligenceDomain.ts";
import {
  MARKET_INTELLIGENCE_SERVICE,
  MarketIntelligenceModule,
} from "../../src/intelligence/market/MarketIntelligenceModule.ts";
import {
  InMemoryMarketIntelligenceService,
} from "../../src/intelligence/market/MarketIntelligenceService.ts";
import type { MarketIntelligenceService } from "../../src/intelligence/market/MarketIntelligenceService.ts";

const timestamp = new Date("2026-01-02T03:04:05.000Z");
const sourceId = new MarketSourceId("public-catalogue");

function provenance(): Provenance {
  return new Provenance("public-record", timestamp, sourceId, ["record:42"]);
}

function observation(id = "observation-1", packageId?: BusinessPackageId): MarketObservation {
  return new MarketObservation(
    new ObservationId(id), sourceId, timestamp, "consumer-market", packageId,
    "public-item", "listed-value", "payload:42", provenance(),
    new Freshness(FreshnessStatus.Current, timestamp), new Confidence(0.8),
  );
}

test("registers the module and service through the Kernel lifecycle", async () => {
  const kernel = new Kernel();
  const module = new MarketIntelligenceModule(kernel);
  kernel.registerModule(module);

  await kernel.start();
  assert.equal(kernel.state, KernelState.Running);
  assert.equal(await module.health(), ModuleState.Running);
  assert.ok(kernel.requireService<MarketIntelligenceService>(MARKET_INTELLIGENCE_SERVICE));

  await kernel.shutdown();
  assert.equal(kernel.state, KernelState.Stopped);
  assert.equal(await module.health(), ModuleState.Stopped);
});

test("creates validated immutable observations with generic package context", () => {
  const packageId = new BusinessPackageId("package-one");
  const inputTimestamp = new Date("2026-01-02T03:04:05.000Z");
  const record = new MarketObservation(
    new ObservationId("observation-1"), sourceId, inputTimestamp, "consumer-market", packageId,
    "public-item", "listed-value", "payload:42", provenance(),
    new Freshness(FreshnessStatus.Current, inputTimestamp), new Confidence(0.8),
  );

  inputTimestamp.setUTCFullYear(1999);
  assert.equal(record.observedAt.toISOString(), "2026-01-02T03:04:05.000Z");
  const exposedDate = record.observedAt;
  exposedDate.setUTCFullYear(2000);
  assert.equal(record.observedAt.toISOString(), "2026-01-02T03:04:05.000Z");
  assert.equal(record.businessPackageId?.value, "package-one");
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.provenance), true);
  assert.deepEqual(record.provenance.supportingReferences, ["record:42"]);
});

test("rejects invalid observation, confidence, freshness, and provenance state", () => {
  assert.throws(() => new Confidence(-0.01), /between 0 and 1/);
  assert.throws(() => new Confidence(Number.NaN), /between 0 and 1/);
  assert.throws(() => new Freshness("recent" as FreshnessStatus, new Date()), /status is invalid/);
  assert.throws(() => new ObservationId(" "), /must not be empty/);
  assert.throws(
    () => new MarketObservation(
      new ObservationId("bad"), new MarketSourceId("other"), new Date("2026-01-02T03:04:05Z"),
      "market", undefined, "subject", "type", "payload", provenance(),
      new Freshness(FreshnessStatus.Current, new Date()),
    ),
    /same source and timestamp/,
  );
});

test("registers and discovers generic sources deterministically", () => {
  const service = new InMemoryMarketIntelligenceService();
  service.registerSource(new MarketSource(new MarketSourceId("z-source"), "Z", "public-feed"));
  service.registerSource(new MarketSource(sourceId, "Catalogue", "public-catalogue"));

  assert.equal(service.source(sourceId)?.name, "Catalogue");
  assert.deepEqual(service.sources().map((source) => source.id.value), ["public-catalogue", "z-source"]);
  assert.equal(Object.isFrozen(service.sources()), true);
  assert.throws(() => service.registerSource(new MarketSource(sourceId, "Again", "feed")), /already registered/);
});

test("preserves evidence traceability and rejects missing observations", () => {
  const service = new InMemoryMarketIntelligenceService();
  service.registerSource(new MarketSource(sourceId, "Catalogue", "public-catalogue"));
  const record = observation();
  service.registerObservation(record);
  const evidence = new Evidence(
    new EvidenceId("evidence-1"), [record.id], provenance(),
    new Date("2026-01-03T00:00:00Z"), new Confidence(1),
    new Freshness(FreshnessStatus.Ageing, new Date("2026-01-03T00:00:00Z")),
    EvidenceStatus.Active,
  );
  service.registerEvidence(evidence);

  const stored = service.evidence(evidence.id);
  assert.equal(stored?.observationIds[0]?.value, record.id.value);
  assert.equal(service.observation(stored!.observationIds[0]!), record);
  assert.equal(stored?.provenance.sourceId.value, sourceId.value);
  assert.equal(Object.isFrozen(stored?.observationIds), true);
  assert.throws(
    () => service.registerEvidence(new Evidence(
      new EvidenceId("orphan"), [new ObservationId("missing")], provenance(), timestamp,
      new Confidence(0.5), new Freshness(FreshnessStatus.Stale, timestamp), EvidenceStatus.Active,
    )),
    /not registered/,
  );
  assert.throws(
    () => new Evidence(
      new EvidenceId("empty"), [], provenance(), timestamp, new Confidence(0.5),
      new Freshness(FreshnessStatus.Expired, timestamp), EvidenceStatus.Invalidated,
    ),
    /at least one observation/,
  );
});
