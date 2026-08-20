export const PINTEREST_UI_STATE = Object.freeze({
  ConfigurationMissing: "ConfigurationMissing",
  Disconnected: "Disconnected",
  Connecting: "Connecting",
  Connected: "Connected",
  ConnectedLimitedPermissions: "ConnectedLimitedPermissions",
  Verifying: "Verifying",
  ObservationRead: "ObservationRead",
  ReauthorizationRequired: "ReauthorizationRequired",
  OAuthDenied: "OAuthDenied",
  TimeoutNetworkError: "TimeoutNetworkError",
  RateLimited: "RateLimited",
  PreloadMissing: "PreloadMissing",
});

const FAILURE_CODES = new Set(["CONFIGURATION_FAILURE", "PINTEREST_CONFIG_MISSING"]);
const DENIAL_CODES = new Set(["OAUTH_DENIED", "CALLBACK_VALIDATION_FAILURE", "CALLBACK_STATE_INVALID", "PERMISSION_DENIED", "PERMISSION_REQUIRED", "AUTHORIZATION_DENIED"]);
const RATE_CODES = new Set(["RATE_LIMITED", "PINTEREST_RATE_LIMITED"]);
const NETWORK_CODES = new Set(["TIMEOUT", "NETWORK_FAILURE", "PINTEREST_NETWORK_FAILURE"]);
const SENSITIVE_KEYS = /^(?:accessToken|refreshToken|clientSecret|sessionSecret|authorizationCode|codeVerifier|cookie|setCookie|rawCallback|callbackUrl|token)$/i;
const SAFE_MESSAGES = Object.freeze({
  CONFIGURATION_FAILURE: "Pinterest developer-app configuration is missing",
  CALLBACK_VALIDATION_FAILURE: "Pinterest authorization callback was rejected",
  CALLBACK_STATE_INVALID: "Pinterest authorization session expired or was rejected",
  OAUTH_DENIED: "Pinterest authorization was denied or cancelled",
  PERMISSION_DENIED: "Pinterest permission was denied",
  PERMISSION_REQUIRED: "Pinterest permission is required",
  PERMISSION_LIMITED: "Pinterest is connected, but one or more read-only permissions are missing. Reauthorize to grant them.",
  MISSING_SCOPE: "Pinterest is connected, but a required read-only permission is missing. Reauthorize to grant it.",
  RATE_LIMITED: "Pinterest rate limit reached",
  TIMEOUT: "Pinterest request timed out",
  NETWORK_FAILURE: "Pinterest network request failed",
  AUTHENTICATION_REQUIRED: "Pinterest authorization is required",
  REAUTHORIZATION_REQUIRED: "Pinterest session is expired, invalid, stale, or damaged. Reauthorize before continuing.",
  SESSION_INTEGRITY_FAILURE: "Pinterest local session is stale or damaged. Reauthorize before continuing.",
  SESSION_RECONFIGURED: "Pinterest local credentials changed. Reauthorize before continuing.",
});

const text = (value, fallback = "") => typeof value === "string" && value.trim() ? value.trim().slice(0, 240) : fallback;
const codeOf = value => text(value?.code || value?.failure || value?.state);
const hasCapabilityState = (value, states) => Array.isArray(value?.capabilities)
  && value.capabilities.some(capability => states.has(capability?.state));
const hasPermissionSignal = value => value?.state === "PermissionLimited"
  || value?.state === "PermissionRequired"
  || hasCapabilityState(value, new Set(["PermissionRequired"]))
  || Array.isArray(value?.capabilities) && value.capabilities.some(capability => capability?.reason === "MissingScope");
const hasReauthorizationSignal = value => value?.state === "AuthenticationRequired"
  || value?.state === "ReauthorizationRequired"
  || value?.authenticationState === "ReauthorizationRequired"
  || hasCapabilityState(value, new Set(["AuthenticationRequired"]));
const safeMessage = value => {
  if (hasReauthorizationSignal(value)) return SAFE_MESSAGES.REAUTHORIZATION_REQUIRED;
  if (hasPermissionSignal(value)) return value?.state === "PermissionLimited" ? SAFE_MESSAGES.PERMISSION_LIMITED : SAFE_MESSAGES.MISSING_SCOPE;
  const code = codeOf(value);
  return SAFE_MESSAGES[code] || "";
};

export function hasPinterestContract(api) {
  return !!api && ["startOAuth", "connectionStatus", "verifyConnection", "readObservation"].every(name => typeof api[name] === "function");
}

export function createPinterestUiState(contractAvailable = true) {
  return Object.freeze({
    uiState: contractAvailable ? PINTEREST_UI_STATE.Disconnected : PINTEREST_UI_STATE.PreloadMissing,
    pendingOAuth: false,
    observation: undefined,
    message: contractAvailable ? "Pinterest is not connected" : "Pinterest preload contract is unavailable",
  });
}

function failureState(value) {
  const code = codeOf(value);
  if (FAILURE_CODES.has(code)) return PINTEREST_UI_STATE.ConfigurationMissing;
  if (DENIAL_CODES.has(code)) return PINTEREST_UI_STATE.OAuthDenied;
  if (RATE_CODES.has(code) || value?.status === 429) return PINTEREST_UI_STATE.RateLimited;
  if (NETWORK_CODES.has(code) || value?.status === 408 || value?.status >= 500) return PINTEREST_UI_STATE.TimeoutNetworkError;
  if (code === "REAUTHORIZATION_REQUIRED" || code === "AUTHENTICATION_REQUIRED") return PINTEREST_UI_STATE.ReauthorizationRequired;
  if (["INVALID_TOKEN", "TOKEN_EXPIRED", "EXPIRED_TOKEN", "SESSION_INTEGRITY_FAILURE"].includes(code)) return PINTEREST_UI_STATE.ReauthorizationRequired;
  return PINTEREST_UI_STATE.Disconnected;
}

function resultState(value, pendingOAuth = false, oauthTimedOut = false) {
  if (!value?.ok) {
    if (pendingOAuth && (value?.state === "AuthenticationRequired" || value?.code === "AUTHENTICATION_REQUIRED")) {
      return oauthTimedOut ? PINTEREST_UI_STATE.OAuthDenied : PINTEREST_UI_STATE.Connecting;
    }
    return failureState(value);
  }
  if (value.state === "Authenticated") return PINTEREST_UI_STATE.Connected;
  if (value.state === "PermissionLimited") return PINTEREST_UI_STATE.ConnectedLimitedPermissions;
  if (value.state === "RefreshRequired") return PINTEREST_UI_STATE.Connecting;
  if (value.state === "AuthenticationRequired") return pendingOAuth ? (oauthTimedOut ? PINTEREST_UI_STATE.OAuthDenied : PINTEREST_UI_STATE.Connecting) : PINTEREST_UI_STATE.Disconnected;
  if (value.state === "ReauthorizationRequired") return PINTEREST_UI_STATE.ReauthorizationRequired;
  if (value.state === "RateLimited") return PINTEREST_UI_STATE.RateLimited;
  if (value.state === "PermissionRequired" || value.state === "PermissionDenied") return PINTEREST_UI_STATE.OAuthDenied;
  return PINTEREST_UI_STATE.Disconnected;
}

function verificationState(value) {
  if (!value?.ok) return failureState(value);
  if (value.state === "Available" || value.state === "PartiallyAvailable") return PINTEREST_UI_STATE.Connected;
  if (value.state === "RateLimited") return PINTEREST_UI_STATE.RateLimited;
  if (hasReauthorizationSignal(value)) return PINTEREST_UI_STATE.ReauthorizationRequired;
  if (hasPermissionSignal(value) || value.state === "PermissionDenied") return PINTEREST_UI_STATE.ConnectedLimitedPermissions;
  return failureState(value);
}

function observationState(value) {
  if (!value?.ok) return failureState(value);
  if (value.state === "Completed" || value.state === "CompletedWithWarnings" || value.state === "Read") return PINTEREST_UI_STATE.ObservationRead;
  if (value.state === "RateLimited") return PINTEREST_UI_STATE.RateLimited;
  if (value.state === "AuthenticationRequired" || value.state === "ReauthorizationRequired") return PINTEREST_UI_STATE.ReauthorizationRequired;
  return failureState(value);
}

export function transition(current, event) {
  const state = current || createPinterestUiState();
  if (event.type === "PRELOAD_MISSING") return Object.freeze({ ...state, uiState: PINTEREST_UI_STATE.PreloadMissing, pendingOAuth: false, message: "Pinterest preload contract is unavailable" });
  if (event.type === "START_REQUEST") {
    if (state.uiState === PINTEREST_UI_STATE.Connecting && state.pendingOAuth) return state;
    return Object.freeze({ ...state, uiState: PINTEREST_UI_STATE.Connecting, pendingOAuth: true, message: "Pinterest authorization is in progress" });
  }
  if (event.type === "START_RESULT") {
    const next = event.value?.ok ? PINTEREST_UI_STATE.Connecting : failureState(event.value);
    return Object.freeze({ ...state, uiState: next, pendingOAuth: !!event.value?.ok, message: safeMessage(event.value) || (next === PINTEREST_UI_STATE.Connecting ? "Complete Pinterest authorization in the browser" : "Pinterest authorization could not be started") });
  }
  if (event.type === "STATUS_RESULT") {
    const next = resultState(event.value, state.pendingOAuth, event.oauthTimedOut);
    return Object.freeze({ ...state, uiState: next, pendingOAuth: next === PINTEREST_UI_STATE.Connecting && state.pendingOAuth, message: safeMessage(event.value) || state.message });
  }
  if (event.type === "VERIFY_REQUEST") return Object.freeze({ ...state, uiState: PINTEREST_UI_STATE.Verifying, message: "Checking the Pinterest read-only connection" });
  if (event.type === "VERIFY_RESULT") {
    const next = verificationState(event.value);
    return Object.freeze({ ...state, uiState: next, pendingOAuth: false, message: safeMessage(event.value) || (next === PINTEREST_UI_STATE.Connected ? "Pinterest connection verified" : "Pinterest connection verification did not complete") });
  }
  if (event.type === "OBSERVATION_REQUEST") return Object.freeze({ ...state, uiState: PINTEREST_UI_STATE.Verifying, message: "Reading Pinterest observation data" });
  if (event.type === "OBSERVATION_RESULT") {
    const next = observationState(event.value);
    return Object.freeze({ ...state, uiState: next, pendingOAuth: false, observation: next === PINTEREST_UI_STATE.ObservationRead ? safeObservation(event.value) : undefined, message: safeMessage(event.value) || (next === PINTEREST_UI_STATE.ObservationRead ? "Read-only Pinterest observation received" : "Pinterest observation is unavailable") });
  }
  return state;
}

export function actionAllowed(state, action) {
  if (action === "connect") return state.uiState !== PINTEREST_UI_STATE.Connecting && state.uiState !== PINTEREST_UI_STATE.Verifying && state.uiState !== PINTEREST_UI_STATE.PreloadMissing;
  if (action === "verify") return state.uiState === PINTEREST_UI_STATE.Connected || state.uiState === PINTEREST_UI_STATE.ConnectedLimitedPermissions || state.uiState === PINTEREST_UI_STATE.ObservationRead;
  if (action === "observe") return state.uiState === PINTEREST_UI_STATE.Connected || state.uiState === PINTEREST_UI_STATE.ConnectedLimitedPermissions || state.uiState === PINTEREST_UI_STATE.ObservationRead;
  return false;
}

function redact(value, key = "") {
  if (SENSITIVE_KEYS.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.slice(0, 25).map(item => redact(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 40).map(([name, item]) => [name, redact(item, name)]));
  if (typeof value === "string") return text(value);
  return value;
}

export function safeObservation(value) {
  if (!value || typeof value !== "object") return undefined;
  return redact({
    state: value.state,
    status: value.status,
    summary: value.summary,
    warningCount: Array.isArray(value.warnings) ? Math.min(value.warnings.length, 25) : 0,
    failureCount: Array.isArray(value.failures) ? Math.min(value.failures.length, 25) : 0,
    provenance: value.provenance,
  });
}