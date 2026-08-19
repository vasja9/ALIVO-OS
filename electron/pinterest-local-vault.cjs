"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const LOCAL_VAULT_VERSION = 1;
const LOCAL_VAULT_FILE_NAME = "pinterest-local-config.enc";
const DEFAULT_LOCAL_REDIRECT_URI = "http://localhost:48123/pinterest/oauth/callback";

class PinterestLocalVaultError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PinterestLocalVaultError";
    this.code = code;
  }
}

function required(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PinterestLocalVaultError("LOCAL_CONFIG_INVALID", `${name} is required`);
  }
  return value.trim();
}

function validateLocalRedirectUri(value) {
  const redirectUri = required(value, "Pinterest redirect URI");
  if (redirectUri !== DEFAULT_LOCAL_REDIRECT_URI) {
    throw new PinterestLocalVaultError(
      "LOCAL_CONFIG_INVALID",
      "Pinterest local redirect URI must be the approved localhost callback",
    );
  }
  return redirectUri;
}

function createSafeStorageAdapter(safeStorage) {
  if (
    !safeStorage
    || typeof safeStorage.isEncryptionAvailable !== "function"
    || typeof safeStorage.encryptString !== "function"
    || typeof safeStorage.decryptString !== "function"
  ) {
    throw new PinterestLocalVaultError("ENCRYPTION_UNAVAILABLE", "Electron safeStorage is unavailable");
  }
  return Object.freeze({
    isEncryptionAvailable: () => {
      try {
        return safeStorage.isEncryptionAvailable() === true;
      } catch {
        return false;
      }
    },
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
  });
}

function localStatus({
  encryptionAvailable,
  configured = false,
  corrupt = false,
  errorCode,
  value,
}) {
  return Object.freeze({
    ok: !errorCode,
    configured,
    encryptionAvailable,
    appIdConfigured: Boolean(value?.clientId),
    appSecretConfigured: Boolean(value?.clientSecret),
    redirectUriConfigured: value?.redirectUri === DEFAULT_LOCAL_REDIRECT_URI,
    sessionMaterialConfigured: Boolean(value?.sessionSecret),
    ...(corrupt ? { corrupt: true } : {}),
    ...(errorCode ? { code: errorCode } : {}),
  });
}

function createPinterestLocalVault({
  filePath,
  safeStorage,
  fileSystem = fs,
  randomBytes = crypto.randomBytes,
} = {}) {
  const storage = createSafeStorageAdapter(safeStorage);
  if (typeof filePath !== "string" || filePath.trim() === "") {
    throw new PinterestLocalVaultError("LOCAL_CONFIG_INVALID", "Pinterest local vault path is required");
  }

  async function readDocument() {
    try {
      const document = await fileSystem.readFile(filePath, "utf8");
      const envelope = JSON.parse(document);
      if (
        envelope?.version !== LOCAL_VAULT_VERSION
        || envelope.provider !== "electron-safeStorage"
        || typeof envelope.ciphertext !== "string"
        || envelope.ciphertext.length < 1
      ) {
        throw new Error("Invalid local vault envelope");
      }
      const plaintext = storage.decrypt(Buffer.from(envelope.ciphertext, "base64url"));
      const value = JSON.parse(plaintext);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid local vault payload");
      return value;
    } catch (error) {
      if (error?.code === "ENOENT") return undefined;
      if (error instanceof PinterestLocalVaultError) throw error;
      throw new PinterestLocalVaultError("LOCAL_VAULT_CORRUPT", "Pinterest local configuration could not be opened");
    }
  }

  function validateValue(value) {
    const clientId = required(value?.clientId, "Pinterest App ID");
    const clientSecret = required(value?.clientSecret, "Pinterest App Secret");
    const redirectUri = validateLocalRedirectUri(value?.redirectUri);
    const sessionSecret = required(value?.sessionSecret, "Pinterest session material");
    return Object.freeze({
      version: LOCAL_VAULT_VERSION,
      clientId,
      clientSecret,
      redirectUri,
      sessionSecret,
    });
  }

  async function status() {
    const encryptionAvailable = storage.isEncryptionAvailable();
    if (!encryptionAvailable) return localStatus({ encryptionAvailable: false, errorCode: "ENCRYPTION_UNAVAILABLE" });
    try {
      const value = await load();
      if (!value) return localStatus({ encryptionAvailable: true });
      return localStatus({ encryptionAvailable: true, configured: true, value });
    } catch (error) {
      if (error instanceof PinterestLocalVaultError && error.code === "LOCAL_VAULT_CORRUPT") {
        return localStatus({ encryptionAvailable: true, corrupt: true, errorCode: error.code });
      }
      return localStatus({ encryptionAvailable: true, errorCode: "LOCAL_VAULT_UNAVAILABLE" });
    }
  }

  async function load() {
    if (!storage.isEncryptionAvailable()) {
      throw new PinterestLocalVaultError("ENCRYPTION_UNAVAILABLE", "Pinterest local encryption is unavailable");
    }
    const value = await readDocument();
    if (!value) return undefined;
    try {
      return validateValue(value);
    } catch (error) {
      if (error instanceof PinterestLocalVaultError && error.code === "LOCAL_CONFIG_INVALID") {
        throw new PinterestLocalVaultError("LOCAL_VAULT_CORRUPT", "Pinterest local configuration could not be opened");
      }
      throw error;
    }
  }

  async function save(input) {
    if (!storage.isEncryptionAvailable()) {
      throw new PinterestLocalVaultError("ENCRYPTION_UNAVAILABLE", "Pinterest local encryption is unavailable");
    }
    const existing = await load().catch((error) => {
      if (error instanceof PinterestLocalVaultError && error.code === "LOCAL_VAULT_CORRUPT") return undefined;
      throw error;
    });
    const value = validateValue({
      clientId: input?.clientId,
      clientSecret: input?.clientSecret,
      redirectUri: input?.redirectUri || DEFAULT_LOCAL_REDIRECT_URI,
      sessionSecret: randomBytes(32).toString("base64url"),
    });
    let ciphertext;
    try {
      ciphertext = storage.encrypt(JSON.stringify(value));
    } catch {
      throw new PinterestLocalVaultError("ENCRYPTION_FAILURE", "Pinterest local configuration could not be encrypted");
    }
    const envelope = JSON.stringify({
      version: LOCAL_VAULT_VERSION,
      provider: "electron-safeStorage",
      ciphertext: Buffer.from(ciphertext).toString("base64url"),
    });
    const directory = path.dirname(filePath);
    await fileSystem.mkdir(directory, { recursive: true });
    const temporary = `${filePath}.tmp`;
    await fileSystem.writeFile(temporary, envelope, { encoding: "utf8", mode: 0o600 });
    await fileSystem.rename(temporary, filePath);
    try {
      await fileSystem.chmod(filePath, 0o600);
    } catch {
      // Windows uses the current-user DPAPI boundary; POSIX mode bits may be unavailable.
    }
    return status();
  }

  async function clear() {
    try {
      await fileSystem.unlink(filePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw new PinterestLocalVaultError("LOCAL_VAULT_CLEAR_FAILED", "Pinterest local configuration could not be cleared");
    }
    try {
      await fileSystem.unlink(`${filePath}.tmp`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw new PinterestLocalVaultError("LOCAL_VAULT_CLEAR_FAILED", "Pinterest local configuration could not be cleared");
    }
    return status();
  }

  function environmentConfiguration(environment) {
    return Object.freeze({
      clientId: environment?.ALIVO_PINTEREST_CLIENT_ID || environment?.PINTEREST_CLIENT_ID || "",
      clientSecret: environment?.ALIVO_PINTEREST_CLIENT_SECRET || environment?.PINTEREST_CLIENT_SECRET || "",
      redirectUri: environment?.ALIVO_PINTEREST_REDIRECT_URI || environment?.PINTEREST_REDIRECT_URI || "",
      apiBaseUrl: environment?.ALIVO_PINTEREST_API_BASE_URL || "https://api.pinterest.com",
      authorizationUrl: environment?.ALIVO_PINTEREST_AUTHORIZATION_URL || "https://www.pinterest.com/oauth/",
      sessionSecret: environment?.ALIVO_PINTEREST_SESSION_SECRET || environment?.SESSION_SECRET || "",
      continuousRefresh: (environment?.ALIVO_PINTEREST_CONTINUOUS_REFRESH || "true").toLowerCase() !== "false",
    });
  }

  async function resolveConfiguration(environment, allowEnvironmentFallback) {
    if (!storage.isEncryptionAvailable()) {
      try {
        await fileSystem.access(filePath);
        throw new PinterestLocalVaultError("ENCRYPTION_UNAVAILABLE", "Pinterest local encryption is unavailable");
      } catch (error) {
        if (error instanceof PinterestLocalVaultError) throw error;
        if (error?.code !== "ENOENT") throw new PinterestLocalVaultError("LOCAL_VAULT_UNAVAILABLE", "Pinterest local configuration is unavailable");
        if (!allowEnvironmentFallback) throw new PinterestLocalVaultError("ENCRYPTION_UNAVAILABLE", "Pinterest local encryption is unavailable");
        return environmentConfiguration(environment);
      }
    }
    const local = await load();
    if (local) {
      return Object.freeze({
        ...local,
        apiBaseUrl: "https://api.pinterest.com",
        authorizationUrl: "https://www.pinterest.com/oauth/",
        continuousRefresh: true,
      });
    }
    if (!allowEnvironmentFallback) return undefined;
    return environmentConfiguration(environment);
  }

  return Object.freeze({
    status,
    load,
    save,
    clear,
    resolveConfiguration,
    filePath,
    defaultRedirectUri: DEFAULT_LOCAL_REDIRECT_URI,
  });
}

function defaultPinterestLocalVaultPath(userDataPath) {
  return path.join(userDataPath, "state", LOCAL_VAULT_FILE_NAME);
}

module.exports = {
  DEFAULT_LOCAL_REDIRECT_URI,
  LOCAL_VAULT_FILE_NAME,
  LOCAL_VAULT_VERSION,
  PinterestLocalVaultError,
  createPinterestLocalVault,
  createSafeStorageAdapter,
  defaultPinterestLocalVaultPath,
  validateLocalRedirectUri,
};