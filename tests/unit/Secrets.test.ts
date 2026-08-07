import assert from "node:assert/strict";
import { inspect } from "node:util";
import { test } from "node:test";

import { AuditRecorder } from "../../src/core/platform/AuditRecorder.ts";
import { AuthorizationService } from "../../src/core/platform/AuthorizationService.ts";
import { IdentityId } from "../../src/core/platform/IdentityId.ts";
import { IdentityType } from "../../src/core/platform/IdentityType.ts";
import { InMemorySecretStore } from "../../src/core/platform/InMemorySecretStore.ts";
import { Permission } from "../../src/core/platform/Permission.ts";
import { SecretAccessRequest } from "../../src/core/platform/SecretAccessRequest.ts";
import { SecretException } from "../../src/core/platform/SecretException.ts";
import { SecretId } from "../../src/core/platform/SecretId.ts";
import { SecretMetadata } from "../../src/core/platform/SecretMetadata.ts";
import { SecretState } from "../../src/core/platform/SecretState.ts";
import { SecretValue } from "../../src/core/platform/SecretValue.ts";
import { ServicePermissionPolicy } from "../../src/core/platform/ServicePermissionPolicy.ts";
import { SystemIdentity } from "../../src/core/platform/SystemIdentity.ts";

const instant = new Date("2026-01-01T00:00:00Z");
const id = new SecretId("secret-1");
const owner = new IdentityId("owner-1");
const permission = new Permission({ identifier: "secrets.retrieve", resourceCategory: "secret", action: "retrieve" });
function actor(allowed: boolean): SystemIdentity { return new SystemIdentity({ id: new IdentityId(allowed ? "allowed" : "denied"), type: IdentityType.InternalService,
  displayName: "Service", enabled: true, permissions: allowed ? [permission] : [] }); }
function metadata(expiryTimestamp?: Date): SecretMetadata { return new SecretMetadata({ secretId: id, description: "service credential", ownerIdentity: owner,
  creationTimestamp: instant, lastRotationTimestamp: instant, expiryTimestamp, state: SecretState.Active }); }
function setup(expiryTimestamp?: Date) {
  const audit = new AuditRecorder(); const authorization = new AuthorizationService(); authorization.registerPolicy(new ServicePermissionPolicy());
  const store = new InMemorySecretStore(authorization, audit); const value = new SecretValue("original-material"); store.register(metadata(expiryTimestamp), value);
  return { store, audit, value };
}
function request(allowed: boolean, timestamp = instant): SecretAccessRequest { return new SecretAccessRequest({ requestingIdentity: actor(allowed), secretId: id,
  purpose: "perform approved work", taskOrWorkflowId: "task-1", timestamp }); }

test("secret identifiers are immutable stable value objects and values are redacted", () => {
  assert.equal(Object.isFrozen(id), true); assert.equal(id.equals(new SecretId("secret-1")), true);
  const value = new SecretValue("material-never-visible");
  assert.equal(Object.isFrozen(value), true); assert.equal(value.toString(), "[REDACTED]"); assert.equal(JSON.stringify(value), '"[REDACTED]"');
  assert.equal(inspect(value).includes("material-never-visible"), false); assert.equal(value.access(), "material-never-visible");
});

test("registration rejects duplicate identifiers and listings contain metadata only", () => {
  const { store } = setup(); assert.throws(() => store.register(metadata(), new SecretValue("other")), SecretException);
  assert.deepEqual(store.listMetadata(), [store.getMetadata(id)]); assert.equal("value" in store.listMetadata()[0], false);
  assert.equal(JSON.stringify(store.listMetadata()).includes("original-material"), false); assert.equal(JSON.stringify(store.getMetadata(id)).includes("original-material"), false);
});

test("retrieval requires explicit authorization and records safe audit information", () => {
  const { store, audit, value } = setup(); assert.equal(store.retrieve(request(true)), value); assert.equal(value.access(), "original-material");
  assert.throws(() => store.retrieve(request(false)), /explicitly allow/);
  const serialized = JSON.stringify(audit.getEvents()); assert.equal(serialized.includes("original-material"), false);
  assert.match(serialized, /access attempt/); assert.match(serialized, /successful access/); assert.match(serialized, /denied access/);
});

test("revoked and expired secrets cannot be retrieved", () => {
  const revoked = setup(); revoked.store.revoke(id, owner, instant); assert.throws(() => revoked.store.retrieve(request(true)), /revoked/);
  const expired = setup(new Date("2025-12-31T00:00:00Z")); assert.throws(() => expired.store.retrieve(request(true)), /expired/);
  assert.equal(expired.store.getMetadata(id).state, SecretState.Expired); assert.match(JSON.stringify(expired.audit.getEvents()), /expiry rejection/);
});

test("rotation replaces the old material and updates metadata", () => {
  const { store, value } = setup(); const replacement = new SecretValue("replacement-material"); const rotated = new Date("2026-02-01T00:00:00Z");
  store.rotate(id, replacement, owner, rotated); const retrieved = store.retrieve(request(true, rotated));
  assert.equal(retrieved, replacement); assert.notEqual(retrieved, value); assert.equal(retrieved.access(), "replacement-material");
  assert.equal(store.getMetadata(id).lastRotationTimestamp.getTime(), rotated.getTime());
});
