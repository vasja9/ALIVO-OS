"use strict";

const { PinterestRuntimeError } = require("./pinterest-runtime.cjs");
const { PinterestLocalVaultError } = require("./pinterest-local-vault.cjs");

function safeRuntimeCode(error, fallback) {
  return error instanceof PinterestRuntimeError ? error.code : fallback;
}

function createPinterestIpcController({
  getLifecycle,
  getLocalVault,
  context,
} = {}) {
  if (typeof getLifecycle !== "function") throw new TypeError("getLifecycle is required");
  if (typeof getLocalVault !== "function") throw new TypeError("getLocalVault is required");
  if (!context || typeof context.resolve !== "function") throw new TypeError("Pinterest context is required");

  return Object.freeze({
    async startOAuth(request) {
      try {
        const result = await getLifecycle().startAuthorization(context.resolve(request));
        return { ok: true, authorizationUrl: result.authorizationUrl, redirectUri: result.redirectUri, expiresAt: result.expiresAt };
      } catch (error) {
        return {
          ok: false,
          code: safeRuntimeCode(error, "PINTEREST_RUNTIME_FAILURE"),
          message: error instanceof PinterestRuntimeError ? error.message : "Pinterest authorization could not be started",
        };
      }
    },
    async connectionStatus(credentialId) {
      try {
        if (credentialId !== undefined && credentialId !== context.credentialId) throw new Error("Pinterest credential is not authorized");
        return { ok: true, ...(await getLifecycle().status(context.credentialId)) };
      } catch (error) {
        const code = safeRuntimeCode(error, "PINTEREST_STATUS_UNAVAILABLE");
        const sessionIntegrity = code === "SESSION_INTEGRITY_FAILURE";
        return {
          ok: false,
          code,
          state: sessionIntegrity ? "ReauthorizationRequired" : "AuthenticationRequired",
          message: sessionIntegrity
            ? "Pinterest local session is stale or damaged and requires reauthorization"
            : "Pinterest connection status is unavailable",
        };
      }
    },
    async verifyConnection(request) {
      try {
        return { ok: true, ...(await getLifecycle().verifyConnection(context.resolve(request))) };
      } catch {
        return { ok: false, state: "Unavailable", message: "Pinterest connection verification is unavailable" };
      }
    },
    async readObservation(request) {
      try {
        return { ok: true, ...(await getLifecycle().readObservation(context.resolve(request))) };
      } catch {
        return { ok: false, state: "Unavailable", message: "Pinterest observation is unavailable" };
      }
    },
    async readAccountPerformance(request) {
      try {
        return { ok: true, ...(await getLifecycle().readAccountPerformance(context.resolve(request))) };
      } catch {
        return { ok: false, state: "Failed" };
      }
    },
    async readPerformance(request) {
      try {
        return { ok: true, ...(await getLifecycle().readPerformance(context.resolve(request))) };
      } catch {
        return { ok: false, state: "Failed" };
      }
    },
    async localConfigStatus() {
      try {
        return { ok: true, ...(await getLocalVault().status()) };
      } catch {
        return { ok: false, configured: false, encryptionAvailable: false, code: "LOCAL_VAULT_UNAVAILABLE" };
      }
    },
    async saveLocalConfig(request) {
      try {
        const result = await getLifecycle().reconfigure(() => getLocalVault().save({
          clientId: request?.clientId,
          clientSecret: request?.clientSecret,
          redirectUri: request?.redirectUri,
        }));
        return { ok: true, ...result };
      } catch (error) {
        return {
          ok: false,
          code: error instanceof PinterestLocalVaultError ? error.code : "LOCAL_VAULT_SAVE_FAILED",
          message: error instanceof PinterestLocalVaultError && error.code === "LOCAL_CONFIG_INVALID"
            ? error.message
            : "Pinterest local configuration could not be saved",
        };
      }
    },
    async clearLocalConfig() {
      try {
        const result = await getLifecycle().reconfigure(() => getLocalVault().clear());
        return { ok: true, ...result };
      } catch {
        return { ok: false, configured: false, encryptionAvailable: false, code: "LOCAL_VAULT_CLEAR_FAILED" };
      }
    },
  });
}

module.exports = { createPinterestIpcController };
