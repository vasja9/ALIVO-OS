"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { URL, URLSearchParams } = require("node:url");

const PINTEREST_AUTHORIZATION_URL = "https://www.pinterest.com/oauth/";
const PINTEREST_TOKEN_PATH = "/v5/oauth/token";
const DEFAULT_API_BASE_URL = "https://api.pinterest.com";
const DEFAULT_AUTHORIZATION_ORIGIN = "https://www.pinterest.com";
const DEFAULT_SCOPES = Object.freeze(["boards:read", "pins:read", "user_accounts:read"]);
const READ_CAPABILITIES = new Set(["AnalyticsObservation", "MarketObservation", "OwnBoards", "OwnPins", "PerformanceObservation", "TrendObservation"]);
const SAFE_QUERY_KEYS = new Set(["ad_account_id", "bookmark", "end_date", "metric_types", "page_size", "pin_id", "start_date"]);
const CALLBACK_TTL_MS = 10 * 60 * 1000;
const EXPIRY_SKEW_MS = 60 * 1000;

class PinterestRuntimeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PinterestRuntimeError";
    this.code = code;
  }
}

function required(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PinterestRuntimeError("CONFIGURATION_FAILURE", `${name} is required`);
  }
  return value.trim();
}

function redactSensitive(value) {
  return String(value)
    .replace(/(?:authorization|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|code|state|password|cookie)\s*[:=]\s*\S+/gi, "[REDACTED]")
    .replace(/(Bearer\s+)[^\s]+/gi, "$1[REDACTED]");
}

function safeProviderMessage(status) {
  if (status === 401) return "Pinterest authentication requires recovery";
  if (status === 403) return "Pinterest permission was denied";
  if (status === 429) return "Pinterest rate limit is active";
  if (status >= 500) return "Pinterest provider is temporarily unavailable";
  return "Pinterest authentication request was rejected";
}

function readConfiguration(environment = process.env) {
  return Object.freeze({
    clientId: environment.ALIVO_PINTEREST_CLIENT_ID || environment.PINTEREST_CLIENT_ID || "",
    clientSecret: environment.ALIVO_PINTEREST_CLIENT_SECRET || environment.PINTEREST_CLIENT_SECRET || "",
    redirectUri: environment.ALIVO_PINTEREST_REDIRECT_URI || environment.PINTEREST_REDIRECT_URI || "",
    apiBaseUrl: environment.ALIVO_PINTEREST_API_BASE_URL || environment.PINTEREST_API_BASE_URL || DEFAULT_API_BASE_URL,
    authorizationUrl: environment.ALIVO_PINTEREST_AUTHORIZATION_URL || PINTEREST_AUTHORIZATION_URL,
    sessionSecret: environment.ALIVO_PINTEREST_SESSION_SECRET || environment.SESSION_SECRET || "",
    continuousRefresh: (environment.ALIVO_PINTEREST_CONTINUOUS_REFRESH || "true").toLowerCase() !== "false",
  });
}

function validateRedirectUri(value) {
  const parsed = new URL(required(value, "Pinterest redirect URI"));
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new PinterestRuntimeError("CONFIGURATION_FAILURE", "Pinterest redirect URI must be a loopback HTTP URI");
  }
  if (!parsed.port || parsed.port === "0" || parsed.search || parsed.hash) {
    throw new PinterestRuntimeError("CONFIGURATION_FAILURE", "Pinterest redirect URI must contain a fixed port and no query or hash");
  }
  return parsed;
}

function validateConfiguration(configuration, requireSecret = true, allowTestEndpoints = false) {
  required(configuration.clientId, "Pinterest client ID");
  required(configuration.redirectUri, "Pinterest redirect URI");
  if (requireSecret) required(configuration.clientSecret, "Pinterest client secret");
  required(configuration.sessionSecret, "Pinterest session secret");
  const api = new URL(required(configuration.apiBaseUrl, "Pinterest API base URL"));
  if (api.protocol !== "https:") throw new PinterestRuntimeError("CONFIGURATION_FAILURE", "Pinterest API base URL must use HTTPS");
  const authorization = new URL(required(configuration.authorizationUrl, "Pinterest authorization URL"));
  if (!allowTestEndpoints && (api.origin !== DEFAULT_API_BASE_URL || authorization.origin !== DEFAULT_AUTHORIZATION_ORIGIN || authorization.pathname !== "/oauth/")) {
    throw new PinterestRuntimeError("CONFIGURATION_FAILURE", "Pinterest production endpoints are fixed and cannot be overridden");
  }
  if (authorization.protocol !== "https:") throw new PinterestRuntimeError("CONFIGURATION_FAILURE", "Pinterest authorization URL must use HTTPS");
  validateRedirectUri(configuration.redirectUri);
  return api;
}

function keyFromSecret(secret) {
  return crypto.createHash("sha256").update(required(secret, "Pinterest session secret")).digest();
}

function encrypt(value, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return JSON.stringify({
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  });
}

function decrypt(document, secret) {
  try {
    const envelope = JSON.parse(document);
    if (envelope?.version !== 1 || envelope.algorithm !== "aes-256-gcm") throw new Error("Invalid session envelope");
    const decipher = crypto.createDecipheriv("aes-256-gcm", keyFromSecret(secret), Buffer.from(envelope.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new PinterestRuntimeError("SESSION_INTEGRITY_FAILURE", "Pinterest session storage could not be opened");
  }
}

class EncryptedPinterestSessionStore {
  constructor(filePath, secret, fileSystem = fs) {
    this.filePath = filePath;
    this.secret = secret;
    this.fileSystem = fileSystem;
  }

  async load() {
    try {
      const document = await this.fileSystem.readFile(this.filePath, "utf8");
      const value = JSON.parse(decrypt(document, this.secret));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid session payload");
      return value;
    } catch (error) {
      if (error?.code === "ENOENT") return {};
      if (error instanceof PinterestRuntimeError) throw error;
      throw new PinterestRuntimeError("SESSION_INTEGRITY_FAILURE", "Pinterest session storage could not be opened");
    }
  }

  async save(value) {
    const directory = path.dirname(this.filePath);
    await this.fileSystem.mkdir(directory, { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await this.fileSystem.writeFile(temporary, encrypt(JSON.stringify(value), this.secret), { encoding: "utf8", mode: 0o600 });
    await this.fileSystem.rename(temporary, this.filePath);
    try {
      await this.fileSystem.chmod(this.filePath, 0o600);
    } catch {
      // Windows does not expose POSIX mode bits; the atomic write still applies.
    }
  }
}

class InMemoryPinterestSessionStore {
  constructor(initial = {}) {
    this.value = { ...initial };
  }

  async load() {
    return { ...this.value };
  }

  async save(value) {
    this.value = { ...value };
  }
}

function encodeBasicCredentials(clientId, clientSecret) {
  return Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
}

function headerSubset(headers) {
  const result = {};
  for (const key of ["retry-after", "x-ratelimit-reset"]) {
    const value = headers?.get?.(key) ?? headers?.[key];
    if (value !== undefined) result[key] = String(value);
  }
  return Object.freeze(result);
}

function jsonOrUndefined(response) {
  return response.text().then((text) => {
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  });
}

function safeTokenRecord(body, previous = {}, clock = () => new Date()) {
  if (!body || typeof body.access_token !== "string" || !body.access_token.trim()) {
    throw new PinterestRuntimeError("AUTHENTICATION_FAILURE", "Pinterest did not return an access token");
  }
  const expiresIn = Number(body.expires_in);
  const refreshExpiresIn = Number(body.refresh_token_expires_in);
  const now = clock().getTime();
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : previous.refreshToken,
    tokenType: typeof body.token_type === "string" ? body.token_type : "bearer",
    scope: typeof body.scope === "string" ? body.scope : previous.scope,
    businessPackageId: previous.businessPackageId,
    expiresAt: Number.isFinite(expiresIn) ? new Date(now + expiresIn * 1000).toISOString() : previous.expiresAt,
    refreshTokenExpiresAt: Number.isFinite(refreshExpiresIn) ? new Date(now + refreshExpiresIn * 1000).toISOString() : previous.refreshTokenExpiresAt,
  };
}

function capabilityPath(capability, subjectReference, marketContext) {
  const value = typeof capability === "string" ? capability : capability?.value;
  if (!READ_CAPABILITIES.has(value)) throw new PinterestRuntimeError("UNSUPPORTED_CAPABILITY", "Pinterest capability is not approved for read-only observation");
  if (value === "TrendObservation") return `/v5/trends/keywords/${encodeURIComponent(marketContext || "global")}/top/growing`;
  if (value === "PerformanceObservation" || value === "AnalyticsObservation") return "/v5/user_account/analytics";
  if (value === "OwnBoards") return "/v5/boards";
  if (value === "MarketObservation" && typeof subjectReference === "string" && subjectReference.startsWith("board:")) return `/v5/boards/${encodeURIComponent(subjectReference.slice(6))}`;
  return "/v5/pins";
}

function createPinterestRuntime(options = {}) {
  const configuration = options.configuration || readConfiguration(options.environment || process.env);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || (() => new Date());
  const openExternal = options.openExternal || (async () => {});
  const userDataPath = options.userDataPath || (() => process.env.ALIVO_USER_DATA_PATH || process.cwd());
  const allowTestEndpoints = options.allowTestEndpoints === true;
  if (typeof fetchImpl !== "function") throw new PinterestRuntimeError("CONFIGURATION_FAILURE", "Fetch is unavailable in the Electron runtime");

  let sessionStore = options.sessionStore;
  let callbackServer;
  let callbackServerPort;
  const pending = new Map();
  const sessions = new Map();

  function getStore() {
    if (!sessionStore) {
      validateConfiguration(configuration, true, allowTestEndpoints);
      sessionStore = new EncryptedPinterestSessionStore(path.join(userDataPath(), "state", "pinterest-sessions.enc"), configuration.sessionSecret);
    }
    return sessionStore;
  }

  function apiBase() {
    return validateConfiguration(configuration, false, allowTestEndpoints);
  }

  async function readSessions() {
    return getStore().load();
  }

  async function writeSessions(value) {
    return getStore().save(value);
  }

  async function exchangeToken(parameters, previous) {
    const api = apiBase();
    const response = await fetchImpl(new URL(PINTEREST_TOKEN_PATH, api), {
      method: "POST",
      headers: {
        Authorization: `Basic ${encodeBasicCredentials(required(configuration.clientId, "Pinterest client ID"), required(configuration.clientSecret, "Pinterest client secret"))}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(parameters),
    });
    const body = await jsonOrUndefined(response);
    if (!response.ok) {
      const failure = response.status === 429 ? "RATE_LIMITED" : response.status === 401 ? "REAUTHORIZATION_REQUIRED" : response.status >= 500 ? "AUTHENTICATION_UNAVAILABLE" : "AUTHENTICATION_FAILURE";
      throw new PinterestRuntimeError(failure, safeProviderMessage(response.status));
    }
    return safeTokenRecord(body, previous, now);
  }

  async function persistCredential(credentialId, record, context = {}) {
    const stored = await readSessions();
    stored[credentialId] = {
      ...record,
      ...(context.businessPackageId !== undefined ? { businessPackageId: context.businessPackageId } : {}),
      updatedAt: now().toISOString(),
    };
    await writeSessions(stored);
    return stored[credentialId];
  }

  async function removeCredential(credentialId) {
    const stored = await readSessions();
    delete stored[credentialId];
    await writeSessions(stored);
  }

  async function refreshCredential(credentialId, record) {
    if (!record.refreshToken || (record.refreshTokenExpiresAt && Date.parse(record.refreshTokenExpiresAt) <= now().getTime())) {
      throw new PinterestRuntimeError("REAUTHORIZATION_REQUIRED", "Pinterest reauthorization is required");
    }
    const refreshed = await exchangeToken({
      grant_type: "refresh_token",
      refresh_token: record.refreshToken,
      ...(configuration.continuousRefresh ? { continuous_refresh: "true" } : {}),
    }, record);
    return persistCredential(credentialId, refreshed);
  }

  async function credentialRecord(credentialId) {
    const stored = await readSessions();
    const record = stored[credentialId];
    if (!record) throw new PinterestRuntimeError("REAUTHORIZATION_REQUIRED", "Pinterest reauthorization is required");
    if (!record.expiresAt || Date.parse(record.expiresAt) - EXPIRY_SKEW_MS <= now().getTime()) return refreshCredential(credentialId, record);
    return record;
  }

  async function authenticate(request) {
    const credentialId = request?.properties?.credentialId?.value || request?.credentialId;
    const businessPackageId = request?.properties?.businessPackageId?.value || request?.properties?.businessPackageId || request?.businessPackageId?.value || request?.businessPackageId;
    if (!credentialId || !businessPackageId) return { successful: false, failure: "InvalidCredential" };
    try {
      const record = await credentialRecord(credentialId);
      if (record.businessPackageId !== businessPackageId) throw new PinterestRuntimeError("PACKAGE_SCOPE_MISMATCH", "Pinterest credential is not scoped to this Business Package");
      const opaqueReference = crypto.randomBytes(24).toString("base64url");
      sessions.set(opaqueReference, { credentialId, record });
      return {
        successful: true,
        session: {
          opaqueReference,
          providerReference: "Pinterest",
          businessPackageId,
          expiresAt: record.expiresAt ? new Date(record.expiresAt) : undefined,
        },
      };
    } catch (error) {
      const failure = error instanceof PinterestRuntimeError && error.code === "PACKAGE_SCOPE_MISMATCH" ? "InvalidCredential" : error instanceof PinterestRuntimeError && error.code === "REAUTHORIZATION_REQUIRED" ? "ReauthorizationRequired" : error instanceof PinterestRuntimeError && error.code === "RATE_LIMITED" ? "RateLimited" : "AuthenticationUnavailable";
      return { successful: false, failure };
    }
  }

  async function reportProviderFailure(request, failure) {
    if (failure !== "ReauthorizationRequired" && failure !== "ExpiredToken") return;
    const credentialId = request?.properties?.credentialId?.value || request?.credentialId;
    if (!credentialId) return;
    for (const [opaque, value] of sessions) if (value.credentialId === credentialId) sessions.delete(opaque);
    await removeCredential(credentialId);
  }

  async function execute(request) {
    const session = sessions.get(request?.session?.opaqueReference);
    if (!session) throw new PinterestRuntimeError("REAUTHORIZATION_REQUIRED", "Pinterest session is unavailable");
    const configuredApi = apiBase();
    const baseUrl = new URL(request.baseUrl || configuredApi);
    if (baseUrl.origin !== configuredApi.origin) throw new PinterestRuntimeError("CONFIGURATION_FAILURE", "Pinterest API base URL is not allowed");
    const url = new URL(request.path, `${configuredApi.origin}/`);
    if (url.origin !== configuredApi.origin) throw new PinterestRuntimeError("CONFIGURATION_FAILURE", "Pinterest API path is not allowed");
    for (const [key, value] of Object.entries(request.query || {})) if (value !== undefined) url.searchParams.set(key, value);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, Number(request.timeoutMs) || 30_000));
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${session.record.accessToken}`, Accept: "application/json" },
        signal: controller.signal,
      });
      const body = await jsonOrUndefined(response);
      if (response.status === 401) await reportProviderFailure({ credentialId: session.credentialId }, "ReauthorizationRequired");
      return { status: response.status, body, headers: headerSubset(response.headers), provenance: { endpoint: url.pathname, operation: "read-only" } };
    } catch (error) {
      if (error?.name === "AbortError") throw new PinterestRuntimeError("TIMEOUT", "Pinterest request timed out");
      throw new PinterestRuntimeError("NETWORK_UNAVAILABLE", "Pinterest network request failed");
    } finally {
      clearTimeout(timeout);
    }
  }

  async function startCallbackServer() {
    if (callbackServer) return callbackServerPort;
    const redirect = validateRedirectUri(configuration.redirectUri);
    callbackServer = http.createServer(async (request, response) => {
      try {
        const callbackUrl = new URL(request.url || "/", redirect.origin);
        const result = await handleCallbackUrl(callbackUrl.toString());
        response.writeHead(result.success ? 200 : 400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(result.success ? "<!doctype html><title>ALIVO OS</title><p>Authorization completed. You may return to ALIVO OS.</p>" : "<!doctype html><title>ALIVO OS</title><p>Authorization could not be completed.</p>");
      } catch {
        response.writeHead(400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end("<!doctype html><title>ALIVO OS</title><p>Authorization could not be completed.</p>");
      }
    });
    await new Promise((resolve, reject) => {
      callbackServer.once("error", reject);
      callbackServer.listen(Number(redirect.port), redirect.hostname, () => {
        callbackServer.removeListener("error", reject);
        callbackServerPort = redirect.port;
        resolve();
      });
    });
    return callbackServerPort;
  }

  async function startAuthorization(input = {}) {
    validateConfiguration(configuration, true, allowTestEndpoints);
    const credentialId = required(input.credentialId, "Pinterest credential ID");
    const businessPackageId = required(input.businessPackageId?.value || input.businessPackageId, "Business Package ID");
    const scopes = Object.freeze([...(input.scopes || DEFAULT_SCOPES)]);
    if (!scopes.length || scopes.some((scope) => !DEFAULT_SCOPES.includes(scope))) throw new PinterestRuntimeError("CONFIGURATION_FAILURE", "Pinterest authorization accepts approved read scopes only");
    await startCallbackServer();
    const state = crypto.randomBytes(32).toString("base64url");
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    const expiresAt = new Date(now().getTime() + CALLBACK_TTL_MS);
    pending.set(state, { credentialId, businessPackageId, correlationIdentifier: input.correlationIdentifier || "pinterest-oauth", scopes, codeVerifier, expiresAt });
    const url = new URL(configuration.authorizationUrl);
    url.search = new URLSearchParams({ client_id: configuration.clientId, redirect_uri: configuration.redirectUri, response_type: "code", scope: scopes.join(","), state, code_challenge: codeChallenge, code_challenge_method: "S256" }).toString();
    const authorizationUrl = url.toString();
    await openExternal(authorizationUrl);
    return Object.freeze({ authorizationUrl, redirectUri: configuration.redirectUri, expiresAt: expiresAt.toISOString() });
  }

  async function handleCallbackUrl(rawUrl) {
    const redirect = validateRedirectUri(configuration.redirectUri);
    const callback = new URL(rawUrl);
    if (callback.origin !== redirect.origin || callback.pathname !== redirect.pathname) throw new PinterestRuntimeError("CALLBACK_VALIDATION_FAILURE", "Pinterest callback URI does not match configuration");
    const state = callback.searchParams.get("state");
    const context = state ? pending.get(state) : undefined;
    if (!context || context.expiresAt.getTime() <= now().getTime()) throw new PinterestRuntimeError("CALLBACK_STATE_INVALID", "Pinterest callback state is invalid or expired");
    pending.delete(state);
    const providerError = callback.searchParams.get("error");
    if (providerError) return { success: false, failure: "PermissionDenied" };
    const code = callback.searchParams.get("code");
    if (!code) throw new PinterestRuntimeError("CALLBACK_VALIDATION_FAILURE", "Pinterest callback did not contain an authorization code");
    const token = await exchangeToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: configuration.redirectUri,
      code_verifier: context.codeVerifier,
      ...(configuration.continuousRefresh ? { continuous_refresh: "true" } : {}),
    });
    await persistCredential(context.credentialId, token, context);
    return Object.freeze({ success: true, credentialId: context.credentialId, expiresAt: token.expiresAt });
  }

  async function status(credentialId) {
    const sessionsStored = await readSessions();
    const record = sessionsStored[credentialId];
    if (!record) return Object.freeze({ state: "AuthenticationRequired" });
    const expired = record.expiresAt ? Date.parse(record.expiresAt) - EXPIRY_SKEW_MS <= now().getTime() : false;
    return Object.freeze({ state: expired && !record.refreshToken ? "AuthenticationRequired" : expired ? "RefreshRequired" : "Authenticated", expiresAt: record.expiresAt, scope: record.scope });
  }

  async function verifyConnection(request = {}) {
    const authentication = await authenticate(request);
    if (!authentication.successful) {
      return Object.freeze({ state: "AuthenticationRequired", authenticationState: authentication.failure, capabilities: [] });
    }
    const requestedCapabilities = Array.isArray(request.requestedCapabilities) && request.requestedCapabilities.length ? request.requestedCapabilities : ["OwnPins"];
    const capabilities = [];
    for (const capability of requestedCapabilities) {
      try {
        const response = await execute({
          baseUrl: configuration.apiBaseUrl,
          path: capabilityPath(capability, request.subjectReference, request.marketContext),
          query: { page_size: "1" },
          timeoutMs: request.timeoutMs,
          session: authentication.session,
        });
        const state = response.status === 401 ? "AuthenticationRequired" : response.status === 403 ? "PermissionRequired" : response.status === 429 ? "RateLimited" : response.status >= 200 && response.status < 300 ? "Available" : response.status >= 500 ? "TemporarilyUnavailable" : "Unavailable";
        capabilities.push(Object.freeze({ capability, state, noData: state === "Available" && Array.isArray(response.body?.items) && response.body.items.length === 0, status: response.status, headers: response.headers }));
      } catch (error) {
        capabilities.push(Object.freeze({ capability, state: error?.code === "TIMEOUT" ? "TemporarilyUnavailable" : "Unavailable", safeReason: error instanceof PinterestRuntimeError ? error.message : "Pinterest connection probe failed" }));
      }
    }
    const available = capabilities.filter((value) => value.state === "Available").length;
    const state = available === capabilities.length ? "Available" : available > 0 ? "PartiallyAvailable" : capabilities.some((value) => value.state === "RateLimited") ? "RateLimited" : "Unavailable";
    return Object.freeze({ state, authenticationState: "Authenticated", capabilities: Object.freeze(capabilities) });
  }

  async function readObservation(request = {}) {
    const authentication = await authenticate(request);
    if (!authentication.successful) return Object.freeze({ state: "AuthenticationRequired", authenticationState: authentication.failure });
    const response = await execute({
      baseUrl: configuration.apiBaseUrl,
      path: capabilityPath(request.capability || "MarketObservation", request.subjectReference, request.marketContext),
      query: Object.fromEntries(Object.entries(request.query || {}).filter(([key, value]) => SAFE_QUERY_KEYS.has(key) && typeof value === "string" && value.length <= 200).concat([["page_size", String(request.pageSize || 25)]])),
      timeoutMs: request.timeoutMs,
      session: authentication.session,
    });
    return Object.freeze({ state: response.status === 200 ? "Read" : response.status === 429 ? "RateLimited" : response.status === 401 ? "ReauthorizationRequired" : "Unavailable", status: response.status, body: response.body, headers: response.headers, provenance: response.provenance });
  }

  async function probeCapability(capability, session, request = {}) {
    return execute({
      baseUrl: configuration.apiBaseUrl,
      path: capabilityPath(capability, request.subjectReference, request.marketContext),
      query: { page_size: "1" },
      timeoutMs: request.timeoutMs,
      session,
    });
  }

  async function close() {
    if (!callbackServer) return;
    await new Promise((resolve) => callbackServer.close(() => resolve()));
    callbackServer = undefined;
    callbackServerPort = undefined;
  }

  return Object.freeze({
    configuration: Object.freeze({ apiBaseUrl: configuration.apiBaseUrl, authorizationUrl: configuration.authorizationUrl, redirectUri: configuration.redirectUri }),
    authentication: Object.freeze({ authenticate, reportProviderFailure }),
    transport: Object.freeze({ execute }),
    getProviderRegistration: () => Object.freeze({
      authentication: Object.freeze({ authenticate, reportProviderFailure }),
      transport: Object.freeze({ execute }),
      verifyAuthentication: authenticate,
      probeCapability,
      verificationMetadata: (verifiedAt = now()) => Object.freeze({ accessEnvironment: "Production", providerApiReference: "Pinterest API v5", adapterVersion: "electron-runtime", verifiedAt }),
    }),
    startAuthorization,
    handleCallbackUrl,
    verifyConnection,
    readObservation,
    status,
    close,
    redactSensitive,
  });
}

module.exports = {
  DEFAULT_API_BASE_URL,
  DEFAULT_SCOPES,
  EncryptedPinterestSessionStore,
  InMemoryPinterestSessionStore,
  PinterestRuntimeError,
  createPinterestRuntime,
  readConfiguration,
  redactSensitive,
};