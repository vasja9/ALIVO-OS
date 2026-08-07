import assert from "node:assert/strict";
import { test } from "node:test";

import { AgentAssignment } from "../../src/intelligence/workforce/AgentAssignment.ts";
import { AgentCapability } from "../../src/intelligence/workforce/AgentCapability.ts";
import { AgentEvaluation } from "../../src/intelligence/workforce/AgentEvaluation.ts";
import { AgentException } from "../../src/intelligence/workforce/AgentException.ts";
import { AgentStatus } from "../../src/intelligence/workforce/AgentStatus.ts";
import { AgentTrustLevel } from "../../src/intelligence/workforce/AgentTrustLevel.ts";
import { AgentWorkforceManager } from "../../src/intelligence/workforce/AgentWorkforceManager.ts";
import { CapabilityPolicy } from "../../src/intelligence/workforce/CapabilityPolicy.ts";
import { DiscoveryPolicy } from "../../src/intelligence/workforce/DiscoveryPolicy.ts";
import { RecoveryPolicy } from "../../src/intelligence/workforce/RecoveryPolicy.ts";

const healthy = { availability: true, latency: 20, providerStatus: true, maintenance: false, quota: 10, failureRate: 0 };
const evaluation = (agent: string, capability: string, quality: number) => new AgentEvaluation(agent, capability, quality, .9, 1, 50, 2, .95, .01, 1);

test("enforces the trust lifecycle and CEO approval", () => {
  const manager = new AgentWorkforceManager();
  manager.agents.register("agent", ["writing"]);
  manager.agents.transition("agent", AgentTrustLevel.Candidate);
  manager.agents.transition("agent", AgentTrustLevel.Trial);
  assert.throws(() => manager.agents.transition("agent", AgentTrustLevel.Approved), AgentException);
  manager.agents.transition("agent", AgentTrustLevel.Approved, true);
  manager.agents.transition("agent", AgentTrustLevel.Trusted, true);
  manager.agents.transition("agent", AgentTrustLevel.FullTrust, true);
  assert.equal(manager.agents.trust("agent"), AgentTrustLevel.FullTrust);
});

test("applies capability-specific discovery policies and schedules", () => {
  const manager = new AgentWorkforceManager();
  manager.capabilities.register(new AgentCapability("active"), new CapabilityPolicy("active", DiscoveryPolicy.ACTIVE, 14));
  manager.capabilities.register(new AgentCapability("hold"), new CapabilityPolicy("hold", DiscoveryPolicy.HOLD));
  manager.capabilities.register(new AgentCapability("current"), new CapabilityPolicy("current", DiscoveryPolicy.CURRENT_ONLY));
  manager.capabilities.register(new AgentCapability("scoped"), new CapabilityPolicy("scoped", DiscoveryPolicy.SCOPED));
  assert.deepEqual(manager.discoverCandidates("active", ["new"]), ["new"]);
  assert.deepEqual(manager.discoverCandidates("scoped", ["approved-scope"]), ["approved-scope"]);
  assert.deepEqual(manager.discoverCandidates("hold", ["new"]), []);
  assert.deepEqual(manager.discoverCandidates("current", ["replacement"]), []);
  assert.equal(manager.capabilities.policy("active").discoveryIntervalDays, 14);
  assert.equal(manager.capabilities.policy("hold").discoveryIntervalDays, 30);
});

test("detects unavailable, degraded, maintenance, and recovered health", () => {
  const manager = new AgentWorkforceManager();
  manager.agents.register("worker", ["writing"], AgentTrustLevel.Trusted);
  assert.equal(manager.monitorHealth("worker", { ...healthy, availability: false }), AgentStatus.Unavailable);
  assert.equal(manager.monitorHealth("worker", healthy), AgentStatus.Recovered);
  assert.equal(manager.monitorHealth("worker", { ...healthy, failureRate: .2 }), AgentStatus.Degraded);
  assert.equal(manager.monitorHealth("worker", { ...healthy, maintenance: true }), AgentStatus.Maintenance);
});

test("runs shadow comparison without replacing the trusted agent", () => {
  const manager = new AgentWorkforceManager();
  manager.agents.register("trusted", ["writing"], AgentTrustLevel.Trusted);
  manager.agents.register("candidate", ["writing"], AgentTrustLevel.Candidate);
  const comparison = manager.shadowTest(evaluation("trusted", "writing", .8), evaluation("candidate", "writing", .9));
  assert.ok(comparison.scoreDifference > 0);
  assert.equal(manager.agents.trust("candidate"), AgentTrustLevel.Candidate);
  assert.equal(manager.comparisons().length, 1);
});

test("uses temporary production and automatically restores its previous trust", () => {
  const manager = new AgentWorkforceManager();
  manager.agents.register("primary", ["writing"], AgentTrustLevel.Trusted);
  manager.agents.register("backup", ["writing"], AgentTrustLevel.Approved);
  manager.monitorHealth("primary", { ...healthy, availability: false });
  manager.useTemporaryProduction("primary", "backup");
  assert.equal(manager.agents.trust("backup"), AgentTrustLevel.TemporaryProduction);
  manager.monitorHealth("primary", healthy);
  const notices: string[] = [];
  assert.equal(manager.recover("primary", "backup", RecoveryPolicy.AUTO, (recipient) => notices.push(recipient)), true);
  assert.deepEqual(notices, ["TCO", "CEO"]);
  assert.equal(manager.agents.trust("backup"), AgentTrustLevel.Approved);
});

test("manual recovery notifies and waits for CEO approval", () => {
  const manager = new AgentWorkforceManager();
  manager.agents.register("primary", ["writing"], AgentTrustLevel.Trusted);
  manager.agents.register("backup", ["writing"], AgentTrustLevel.Approved);
  manager.monitorHealth("primary", { ...healthy, providerStatus: false });
  manager.useTemporaryProduction("primary", "backup");
  manager.monitorHealth("primary", healthy);
  const notices: string[] = [];
  assert.equal(manager.recover("primary", "backup", RecoveryPolicy.MANUAL, (recipient) => notices.push(recipient)), false);
  assert.equal(manager.agents.trust("backup"), AgentTrustLevel.TemporaryProduction);
  assert.equal(manager.recover("primary", "backup", RecoveryPolicy.MANUAL, () => undefined, true), true);
  assert.deepEqual(notices, ["TCO", "CEO"]);
});

test("recommends rather than routes and maintains assignment history", () => {
  const manager = new AgentWorkforceManager();
  manager.capabilities.register(new AgentCapability("research"));
  manager.agents.register("candidate", ["research"], AgentTrustLevel.Candidate);
  manager.agents.register("trusted", ["research"], AgentTrustLevel.Trusted);
  assert.equal(manager.recommendAgent("research"), "trusted");
  const assignment = new AgentAssignment("research", "trusted", 120, false, .7, 3);
  manager.recordAssignment(assignment);
  assert.equal(manager.assignmentHistory()[0], assignment);
  assert.equal(assignment.failure, true);
});
