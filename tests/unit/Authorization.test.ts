import assert from "node:assert/strict";
import { test } from "node:test";

import { AuditRecorder } from "../../src/core/platform/AuditRecorder.ts";
import { AuthorizationDecision, AuthorizationDecisionValue } from "../../src/core/platform/AuthorizationDecision.ts";
import { AuthorizationException } from "../../src/core/platform/AuthorizationException.ts";
import type { AuthorizationPolicy } from "../../src/core/platform/AuthorizationPolicy.ts";
import { AuthorizationRequest } from "../../src/core/platform/AuthorizationRequest.ts";
import { AuthorizationService } from "../../src/core/platform/AuthorizationService.ts";
import { CEOAuthorityPolicy } from "../../src/core/platform/CEOAuthorityPolicy.ts";
import { IdentityId } from "../../src/core/platform/IdentityId.ts";
import { IdentityType } from "../../src/core/platform/IdentityType.ts";
import { Permission } from "../../src/core/platform/Permission.ts";
import { ServicePermissionPolicy } from "../../src/core/platform/ServicePermissionPolicy.ts";
import { SystemIdentity } from "../../src/core/platform/SystemIdentity.ts";

const read = new Permission({ identifier: "records.read", resourceCategory: "record", action: "read" });
const approve = new Permission({ identifier: "output.approve", resourceCategory: "output", action: "approve" });

function identity(type = IdentityType.InternalService, permissions: readonly Permission[] = [read]): SystemIdentity {
  return new SystemIdentity({ id: new IdentityId("actor-1"), type, displayName: "Actor One", enabled: true, permissions });
}
function request(actor = identity(), permission = read, context?: Record<string, unknown>): AuthorizationRequest {
  return new AuthorizationRequest({ identity: actor, permission, protectedResourceId: "resource-1", taskOrWorkflowId: "task-1", context });
}

test("identity identifiers and identities are immutable value objects", () => {
  const id = new IdentityId("actor-1");
  const actor = identity();
  assert.equal(id.equals(new IdentityId("actor-1")), true);
  assert.equal(Object.isFrozen(id), true);
  assert.equal(Object.isFrozen(actor), true);
  assert.equal(Object.isFrozen(actor.permissions), true);
  assert.throws(() => (actor.permissions as Permission[]).push(approve), TypeError);
});

test("permissions must be explicit and assignment is exact", () => {
  const actor = identity();
  assert.equal(actor.hasPermission(read), true);
  assert.equal(actor.hasPermission(approve), false);
  assert.throws(() => new Permission({ identifier: "*", resourceCategory: "record", action: "read" }), AuthorizationException);
  assert.throws(() => new Permission({ identifier: "all", resourceCategory: "record", action: "*" }), /wildcard/);
  assert.throws(() => new Permission({ identifier: "all", resourceCategory: "record", action: "read", scope: "*" }), /explicit/);
});

test("foundation policies allow assigned permissions and explain denials", () => {
  const services = new AuthorizationService();
  services.registerPolicy(new CEOAuthorityPolicy());
  services.registerPolicy(new ServicePermissionPolicy());
  const allowed = services.evaluate(request());
  const denied = services.evaluate(request(identity(IdentityType.InternalService, [])));
  const ceoAllowed = services.evaluate(request(identity(IdentityType.CEO)));
  assert.equal(allowed.decision, AuthorizationDecisionValue.Allowed);
  assert.equal(ceoAllowed.decision, AuthorizationDecisionValue.Allowed);
  assert.equal(denied.decision, AuthorizationDecisionValue.Denied);
  assert.ok(allowed.reason.length > 0);
  assert.ok(denied.reason.length > 0);
});

test("authorization denies by default and rejects disabled identities", () => {
  const service = new AuthorizationService();
  assert.equal(service.evaluate(request()).decision, AuthorizationDecisionValue.Denied);
  const disabled = service.disableIdentity(identity());
  assert.equal(disabled.enabled, false);
  assert.equal(identity().enabled, true);
  assert.equal(service.enableIdentity(disabled).enabled, true);
  assert.throws(() => service.evaluate(request(disabled)), /Disabled identity/);
});

test("policy registration rejects duplicates and preserves evaluation order", () => {
  const calls: string[] = [];
  const policy = (identifier: string, decision: AuthorizationDecisionValue): AuthorizationPolicy => ({ identifier, description: identifier,
    evaluate(input) { calls.push(identifier); return new AuthorizationDecision({ decision, reason: identifier, identity: input.identity.id, permission: input.permission, policyIdentifier: identifier }); } });
  const service = new AuthorizationService();
  service.registerPolicy(policy("first", AuthorizationDecisionValue.Denied));
  service.registerPolicy(policy("second", AuthorizationDecisionValue.Allowed));
  service.registerPolicy(policy("third", AuthorizationDecisionValue.Allowed));
  assert.deepEqual(service.getPolicyIdentifiers(), ["first", "second", "third"]);
  assert.equal(service.evaluate(request()).policyIdentifier, "second");
  assert.deepEqual(calls, ["first", "second"]);
  assert.throws(() => service.registerPolicy(policy("first", AuthorizationDecisionValue.Allowed)), /Duplicate/);
});

test("authorization decisions expose audit-compatible data without sensitive request context", () => {
  const audit = new AuditRecorder();
  const service = new AuthorizationService(audit);
  service.registerPolicy(new ServicePermissionPolicy());
  const decision = service.evaluate(request(identity(), read, { token: "secret", nested: { password: "hidden" } }));
  const [event] = audit.getEvents();
  assert.equal(decision.identity.value, "actor-1");
  assert.equal(decision.permission, read);
  assert.ok(decision.timestamp instanceof Date);
  assert.equal(event.responsibleIdentity, "actor-1");
  assert.equal(event.relatedTaskOrWorkflowId, "task-1");
  assert.deepEqual(event.context, { permission: "records.read", protectedResource: "resource-1", decision: "Allowed", reason: decision.reason });
  assert.equal(JSON.stringify(event).includes("secret"), false);
  assert.equal(JSON.stringify(event).includes("hidden"), false);
});

test("AI workers cannot approve their own output", () => {
  const service = new AuthorizationService();
  service.registerPolicy(new ServicePermissionPolicy());
  const worker = identity(IdentityType.AIWorker, [approve]);
  const decision = service.evaluate(request(worker, approve, { outputIdentityId: worker.id.value, apiKey: "secret" }));
  assert.equal(decision.decision, AuthorizationDecisionValue.Denied);
  assert.match(decision.reason, /own output/);
  assert.equal(JSON.stringify(decision).includes("secret"), false);
});
