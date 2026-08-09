import assert from "node:assert/strict";
import { test } from "node:test";

import { AuditRecorder } from "../../src/core/platform/AuditRecorder.ts";
import { AuthorizationService } from "../../src/core/platform/AuthorizationService.ts";
import { CEOAuthorityPolicy } from "../../src/core/platform/CEOAuthorityPolicy.ts";
import { EventBus } from "../../src/core/platform/EventBus.ts";
import { EventSubscription } from "../../src/core/platform/EventSubscription.ts";
import { EventType } from "../../src/core/platform/EventType.ts";
import { IdentityId } from "../../src/core/platform/IdentityId.ts";
import { IdentityType } from "../../src/core/platform/IdentityType.ts";
import { SystemIdentity } from "../../src/core/platform/SystemIdentity.ts";
import {
  AuthenticationType, CredentialAuthenticationFailure, CredentialStatus, CredentialVault,
  CredentialVaultError, CredentialVaultPermissions, InMemoryCredentialVaultStorage, VaultStatus,
} from "../../src/security/credentials/CredentialVault.ts";

const MASTER = "SYNTHETIC-MASTER-ONE";
const NEW_MASTER = "SYNTHETIC-MASTER-TWO";
const SECRET = "SYNTHETIC-SECRET-ALPHA";
const REPLACEMENT = "SYNTHETIC-SECRET-BETA";
const instant = new Date("2026-08-09T12:00:00.000Z");

function identity(allowed = true): SystemIdentity { return new SystemIdentity({ id: new IdentityId(allowed ? "ceo-test" : "worker-test"), type: allowed ? IdentityType.CEO : IdentityType.AIWorker, displayName: "Synthetic Actor", enabled: true, permissions: allowed ? Object.values(CredentialVaultPermissions) : [] }); }
function input(id = "credential-z", scopes: readonly string[] = ["PACKAGE-ALPHA"], sharedScopeApproved = false) { return { credentialId: id, displayName: "Synthetic credential", serviceReference: id === "credential-a" ? "Alpha Service" : "Zulu Service", accountReference: "Synthetic Account", username: "synthetic-user", secret: SECRET, authenticationType: AuthenticationType.UsernamePassword, businessPackageScopes: scopes, sharedScopeApproved, capabilityScopes: ["synthetic.read"], notes: "No secret material" }; }
function setup() { const storage = new InMemoryCredentialVaultStorage(); const audit = new AuditRecorder(); const authorization = new AuthorizationService(); authorization.registerPolicy(new CEOAuthorityPolicy()); const events = new EventBus(); const vault = new CredentialVault(storage, authorization, audit, events, () => instant); return { vault, storage, audit, events, ceo: identity(), denied: identity(false) }; }

test("initialization validates confirmation, encrypts persistence, locks and rejects a wrong password", async () => {
  const mismatch = setup(); await assert.rejects(mismatch.vault.initialize(MASTER, "MISMATCH", mismatch.ceo), CredentialVaultError); assert.equal(await mismatch.vault.status(), VaultStatus.Uninitialized);
  await assert.rejects(mismatch.vault.initialize("", "", mismatch.ceo), CredentialVaultError);
  const { vault, storage, ceo } = setup(); await vault.initialize(MASTER, MASTER, ceo); assert.equal(await vault.status(), VaultStatus.Unlocked);
  await vault.addCredential(input(), ceo); const persisted = (await storage.load())!; assert.equal(persisted.includes(MASTER), false); assert.equal(persisted.includes(SECRET), false); assert.match(persisted, /PBKDF2/); assert.match(persisted, /AES-GCM/);
  vault.lock(ceo); assert.equal(await vault.status(), VaultStatus.Locked); assert.throws(() => vault.revealSecret("credential-z", ceo, "PACKAGE-ALPHA"), /Locked/); await assert.rejects(vault.unlock("SYNTHETIC-WRONG", ceo), /AuthenticationFailure/); await vault.unlock(MASTER, ceo); assert.equal(vault.revealSecret("credential-z", ceo, "PACKAGE-ALPHA"), SECRET);
});

test("credential metadata operations are deterministic, scoped, explicit, and never reveal secrets", async () => {
  const { vault, ceo, denied } = setup(); await vault.initialize(MASTER, MASTER, ceo); await vault.addCredential(input(), ceo); await vault.addCredential(input("credential-a", ["PACKAGE-BETA"]), ceo);
  assert.deepEqual(vault.listMetadata(ceo).map(({ credentialId }) => credentialId), ["credential-a", "credential-z"]); assert.deepEqual(vault.searchMetadata("alpha", ceo).map(({ credentialId }) => credentialId), ["credential-a"]);
  const metadata = vault.getMetadata("credential-z", ceo, "PACKAGE-ALPHA"); assert.equal("secret" in metadata, false); assert.equal(JSON.stringify(metadata).includes(SECRET), false);
  assert.throws(() => vault.getMetadata("credential-z", ceo, "PACKAGE-BETA"), /Unauthorized/); assert.throws(() => vault.revealSecret("credential-z", denied, "PACKAGE-ALPHA"), /Unauthorized/);
  await assert.rejects(vault.addCredential(input("shared", ["PACKAGE-ALPHA", "PACKAGE-BETA"]), ceo), /Unauthorized/); await vault.addCredential(input("shared", ["PACKAGE-ALPHA", "PACKAGE-BETA"], true), ceo); assert.equal(vault.revealSecret("shared", ceo, "PACKAGE-BETA"), SECRET);
});

test("updates replace material, revocation and deletion work, and errors are secret-safe", async () => {
  const { vault, ceo } = setup(); await vault.initialize(MASTER, MASTER, ceo); await vault.addCredential(input(), ceo); const updated = await vault.updateCredential("credential-z", { username: "replacement-user", secret: REPLACEMENT, accountReference: "Replacement Account" }, ceo); assert.equal(updated.username, "replacement-user"); assert.equal(vault.revealSecret("credential-z", ceo, "PACKAGE-ALPHA"), REPLACEMENT); assert.equal(JSON.stringify(updated).includes(REPLACEMENT), false);
  await vault.revokeCredential("credential-z", ceo); assert.equal(vault.getMetadata("credential-z", ceo, "PACKAGE-ALPHA").status, CredentialStatus.Revoked); await vault.deleteCredential("credential-z", ceo); assert.throws(() => vault.getMetadata("credential-z", ceo, "PACKAGE-ALPHA"), /NotFound/);
  try { vault.revealSecret("missing", ceo, SECRET); assert.fail(); } catch (error) { assert.equal(String(error).includes(SECRET), false); }
});

test("master password change is atomic and replaces the old protection", async () => {
  const { vault, ceo } = setup(); await vault.initialize(MASTER, MASTER, ceo); await vault.addCredential(input(), ceo);
  await assert.rejects(vault.changeMasterPassword("SYNTHETIC-WRONG", NEW_MASTER, NEW_MASTER, ceo), /AuthenticationFailure/); vault.lock(ceo); await vault.unlock(MASTER, ceo);
  await assert.rejects(vault.changeMasterPassword(MASTER, NEW_MASTER, "MISMATCH", ceo), /AuthenticationFailure/); vault.lock(ceo); await vault.unlock(MASTER, ceo);
  await vault.changeMasterPassword(MASTER, NEW_MASTER, NEW_MASTER, ceo); vault.lock(ceo); await assert.rejects(vault.unlock(MASTER, ceo), /AuthenticationFailure/); await vault.unlock(NEW_MASTER, ceo); assert.equal(vault.revealSecret("credential-z", ceo, "PACKAGE-ALPHA"), SECRET);
});

test("authentication failure contracts preserve recovery and interrupted-operation references", async () => {
  const { vault, ceo } = setup(); await vault.initialize(MASTER, MASTER, ceo); await vault.addCredential(input(), ceo); const failures = Object.values(CredentialAuthenticationFailure); assert.deepEqual(failures, ["InvalidUsername", "InvalidPassword", "ExpiredPassword", "ExpiredCredential", "ExpiredToken", "MFARequired", "AccountLocked", "PermissionDenied", "ReauthorizationRequired", "UnknownAuthenticationFailure"]);
  for (const failure of failures) { const record = await vault.recordAuthenticationFailure("credential-z", failure, { workflowRunReference: "workflow-synthetic", tcoTaskReference: "task-synthetic", sourceRequestReference: "request-synthetic", correlationIdentifier: `correlation-${failure}` }, ceo); assert.equal(record.interruptedOperation.workflowRunReference, "workflow-synthetic"); assert.equal(record.correctionRequired, failure !== CredentialAuthenticationFailure.UnknownAuthenticationFailure); }
});

test("audit and event payloads remain safe", async () => {
  const { vault, ceo, audit, events } = setup(); const received: unknown[] = []; for (const name of ["VaultInitialized", "CredentialCreated", "CredentialSecretRevealed", "CredentialUpdated"]) events.subscribe(new EventSubscription({ handle: (event) => received.push(event) }, [new EventType(name)]));
  await vault.initialize(MASTER, MASTER, ceo); await vault.addCredential(input(), ceo); vault.revealSecret("credential-z", ceo, "PACKAGE-ALPHA"); await vault.updateCredential("credential-z", { secret: REPLACEMENT }, ceo); const output = JSON.stringify({ audit: audit.getEvents(), events: received }); for (const sensitive of [MASTER, SECRET, REPLACEMENT]) assert.equal(output.includes(sensitive), false); assert.match(output, /CredentialSecretRevealed/);
});

test("encrypted backups restore and reject corruption or authenticated tampering", async () => {
  const source = setup(); await source.vault.initialize(MASTER, MASTER, source.ceo); await source.vault.addCredential(input(), source.ceo); const backup = await source.vault.exportEncryptedBackup(source.ceo); assert.equal(backup.includes(SECRET), false); assert.equal(source.vault.validateEncryptedBackup(backup), true);
  const restored = setup(); await restored.vault.restoreEncryptedBackup(backup, MASTER, restored.ceo); assert.equal(restored.vault.revealSecret("credential-z", restored.ceo, "PACKAGE-ALPHA"), SECRET);
  await assert.rejects(restored.vault.restoreEncryptedBackup("corrupt", MASTER, restored.ceo), /IntegrityFailure/); const envelope = JSON.parse(backup); envelope.cipher.ciphertext = `${envelope.cipher.ciphertext.slice(0, -2)}00`; await assert.rejects(restored.vault.restoreEncryptedBackup(JSON.stringify(envelope), MASTER, restored.ceo), /AuthenticationFailure/); assert.equal(restored.vault.revealSecret("credential-z", restored.ceo, "PACKAGE-ALPHA"), SECRET);
});
