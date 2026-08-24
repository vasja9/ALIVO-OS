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
const THUMBNAIL_MAX_BYTES = 256 * 1024;
const THUMBNAIL_MAX_BASE64_LENGTH = Math.ceil(THUMBNAIL_MAX_BYTES / 3) * 4;
const AUDIT_RULES = Object.freeze({
  TITLE_MISSING: Object.freeze({ level: "Required", message: "Add a Pin title." }),
  TITLE_TOO_LONG: Object.freeze({ level: "Required", message: "Shorten the title to 100 characters or fewer." }),
  DESTINATION_MISSING: Object.freeze({ level: "Required", message: "Add a destination to alivo.eu." }),
  DESTINATION_OUTSIDE_ALIVO: Object.freeze({ level: "Required", message: "Review the destination: it is outside alivo.eu." }),
  DESCRIPTION_MISSING: Object.freeze({ level: "Review", message: "Add a Pin description for Pinterest relevance." }),
  DESCRIPTION_TOO_LONG: Object.freeze({ level: "Review", message: "Shorten the description to 800 characters or fewer." }),
  THUMBNAIL_MISSING: Object.freeze({ level: "Review", message: "Add or repair the Pin image." }),
  BOARD_UNKNOWN: Object.freeze({ level: "Review", message: "Resolve the Pinterest board name." }),
  CREATED_AT_INVALID: Object.freeze({ level: "Review", message: "Review the creation date." }),
  DUPLICATE_TITLE: Object.freeze({ level: "Review", message: "Review Pins that use the same title." }),
  DUPLICATE_CONTENT: Object.freeze({ level: "Review", message: "Review Pins with identical content." }),
  POSSIBLE_TEST_CONTENT: Object.freeze({ level: "Review", message: "Remove test or placeholder content before publishing." }),
});
const AUDIT_CODES = Object.freeze(Object.keys(AUDIT_RULES));
function safeThumbnail(value) {
  if (!value || typeof value !== "object" || !["image/jpeg", "image/png", "image/webp"].includes(value.mimeType) || typeof value.base64 !== "string" || !value.base64.length || value.base64.length > THUMBNAIL_MAX_BASE64_LENGTH || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64)) return null;
  try {
    const binary = globalThis.atob(value.base64);
    if (!binary.length || binary.length > THUMBNAIL_MAX_BYTES || globalThis.btoa(binary) !== value.base64) return null;
    const byte = index => binary.charCodeAt(index < 0 ? binary.length + index : index);
    const ascii = (start, length) => Array.from({ length }, (_, index) => String.fromCharCode(byte(start + index))).join("");
    const jpeg = value.mimeType === "image/jpeg" && binary.length >= 4 && byte(0) === 0xff && byte(1) === 0xd8 && byte(2) === 0xff && byte(-2) === 0xff && byte(-1) === 0xd9;
    const pngEnd = [0x00,0x00,0x00,0x00,0x49,0x45,0x4e,0x44,0xae,0x42,0x60,0x82];
    const png = value.mimeType === "image/png" && binary.length >= 20 && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((item,index)=>byte(index)===item) && pngEnd.every((item,index)=>byte(binary.length-12+index)===item);
    const riffSize = byte(4) | byte(5) << 8 | byte(6) << 16 | byte(7) << 24;
    const webp = value.mimeType === "image/webp" && binary.length >= 12 && ascii(0,4) === "RIFF" && ascii(8,4) === "WEBP" && (riffSize >>> 0) + 8 === binary.length;
    return jpeg || png || webp ? Object.freeze({ mimeType: value.mimeType, base64: value.base64 }) : null;
  } catch { return null; }
}
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
  return !!api && ["startOAuth", "connectionStatus", "verifyConnection", "readObservation", "readAccountPerformance", "readTopPins", "readPerformance"].every(name => typeof api[name] === "function");
}

export function createPinterestUiState(contractAvailable = true) {
  return Object.freeze({
    uiState: contractAvailable ? PINTEREST_UI_STATE.Disconnected : PINTEREST_UI_STATE.PreloadMissing,
    pendingOAuth: false,
    verifiedConnectionState: undefined,
    observation: undefined,
    observationStatus: "unread",
    performance: safePerformance(),
    accountPerformance: safeAccountPerformance(),
    topPins: safeTopPins(),
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

const observationSnapshotIdentity=pins=>JSON.stringify((Array.isArray(pins)?pins:[]).slice(0,25).map(pin=>[pin.pinId,pin.title??null,pin.description??null,pin.createdAt??null,pin.boardName,pin.destinationDomain??null,pin.thumbnail!==null]));

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
    const resetAnalytics = [PINTEREST_UI_STATE.ReauthorizationRequired, PINTEREST_UI_STATE.Disconnected, PINTEREST_UI_STATE.ConfigurationMissing].includes(next);
    const performance = resetAnalytics ? safePerformance() : state.performance;
    const accountPerformance = resetAnalytics ? safeAccountPerformance() : state.accountPerformance;
    const topPins = resetAnalytics ? safeTopPins() : state.topPins;
    return Object.freeze({ ...state, uiState: next, performance, accountPerformance, topPins, pendingOAuth: next === PINTEREST_UI_STATE.Connecting && state.pendingOAuth, message: safeMessage(event.value) || state.message });
  }
  if (event.type === "VERIFY_REQUEST") return Object.freeze({ ...state, uiState: PINTEREST_UI_STATE.Verifying, message: "Checking the Pinterest read-only connection" });
  if (event.type === "VERIFY_RESULT") {
    const next = verificationState(event.value);
    const verifiedConnectionState = next === PINTEREST_UI_STATE.Connected || next === PINTEREST_UI_STATE.ConnectedLimitedPermissions ? next : undefined;
    const accountPerformance = next === PINTEREST_UI_STATE.ReauthorizationRequired ? safeAccountPerformance() : state.accountPerformance;
    const topPins = next === PINTEREST_UI_STATE.ReauthorizationRequired ? safeTopPins() : state.topPins;
    return Object.freeze({ ...state, uiState: next, accountPerformance, topPins, verifiedConnectionState, pendingOAuth: false, message: safeMessage(event.value) || (next === PINTEREST_UI_STATE.Connected ? "Pinterest connection verified" : "Pinterest connection verification did not complete") });
  }
  if (event.type === "OBSERVATION_REQUEST") return Object.freeze({ ...state, uiState: PINTEREST_UI_STATE.Verifying, message: "Reading Pinterest observation data" });
  if (event.type === "OBSERVATION_RESULT") {
    const observationResult = observationState(event.value);
    const preserveVerifiedConnection = ["Failed", "Unavailable", "NoData"].includes(event.value?.state) || (!event.value?.ok && ![PINTEREST_UI_STATE.RateLimited, PINTEREST_UI_STATE.ReauthorizationRequired].includes(observationResult));
    const next = preserveVerifiedConnection && state.verifiedConnectionState ? state.verifiedConnectionState : observationResult;
    const safe = safeObservation(event.value);
    const observationStatus = ["Failed", "Unavailable"].includes(event.value?.state) || !event.value?.ok ? "unavailable" : safe.pins.length ? "available" : "empty";
    const priorAudit = state.observation?.audit;
    const retainedAudit = observationStatus === "unavailable" && safe.audit.state === "NotRead" && priorAudit?.state !== "NotRead"
      ? Object.freeze({ ...priorAudit, state: "TemporarilyUnavailable" })
      : safe.audit;
    const retainedPins = observationStatus === "unavailable" && !safe.pins.length && Array.isArray(state.observation?.pins) ? state.observation.pins : safe.pins;
    const observation = Object.freeze({ ...safe, pins: retainedPins, audit: retainedAudit });
    const priorSnapshot=observationSnapshotIdentity(state.observation?.pins??[]),nextSnapshot=observationSnapshotIdentity(retainedPins);
    const performance=priorSnapshot!=="[]"&&priorSnapshot===nextSnapshot?state.performance:safePerformance();
    const accountPerformance=next===PINTEREST_UI_STATE.ReauthorizationRequired?safeAccountPerformance():state.accountPerformance;
    const topPins=next===PINTEREST_UI_STATE.ReauthorizationRequired?safeTopPins():priorSnapshot!=="[]"&&priorSnapshot===nextSnapshot?state.topPins:safeTopPins();
    return Object.freeze({ ...state, uiState: next, performance, accountPerformance, topPins, pendingOAuth: false, observation, observationStatus, message: safeMessage(event.value) || (next === PINTEREST_UI_STATE.ObservationRead ? "Read-only Pinterest observation received" : "Pinterest observation is unavailable") });
  }
  if (event.type === "ACCOUNT_PERFORMANCE_RESULT") return Object.freeze({ ...state, accountPerformance: safeAccountPerformance(event.value) });
  if (event.type === "TOP_PINS_RESULT") return Object.freeze({ ...state, topPins: safeTopPins(event.value) });
  if (event.type === "PERFORMANCE_RESULT") return Object.freeze({ ...state, performance: safePerformance(event.value, state.observation?.pins ?? []) });
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
  if (!value || typeof value !== "object") return Object.freeze({ pins: Object.freeze([]) });
  const pins = Array.isArray(value.pins) ? value.pins.slice(0, 25).flatMap(pin => {
    if (!pin || typeof pin !== "object" || typeof pin.pinId !== "string" || !pin.pinId.trim()) return [];
    const safe = { pinId: text(pin.pinId).slice(0, 128), boardName: typeof pin.boardName === "string" && pin.boardName.trim() ? text(pin.boardName).slice(0, 160) : "Unknown board", thumbnail: null };
    for (const [key, maximum] of [["title", 160], ["description", 1000], ["createdAt", 32], ["destinationDomain", 253]]) {
      if (typeof pin[key] === "string" && pin[key].trim()) safe[key] = text(pin[key]).slice(0, maximum);
    }
    safe.thumbnail = safeThumbnail(pin.thumbnail);
    return [Object.freeze(safe)];
  }) : [];
  const envelope = redact({
    state: value.state,
    status: value.status,
    summary: value.summary,
    warningCount: Array.isArray(value.warnings) ? Math.min(value.warnings.length, 25) : 0,
    failureCount: Array.isArray(value.failures) ? Math.min(value.failures.length, 25) : 0,
    provenance: value.provenance,
  });
  return Object.freeze({ ...envelope, pins: Object.freeze(pins), audit: safeContentAudit(value.audit, pins) });
}

function safePerformance(value, pins = []) {
  const empty=()=>Object.freeze({state:"NotRead",window:null,totals:null,pins:Object.freeze([])});
  if(!value||typeof value!=="object")return empty();
  const states=new Set(["NotRead","Available","NoData","Unavailable","RateLimited","ReauthorizationRequired","Failed"]),state=states.has(value.state)?value.state:"Failed";
  if(state==="ReauthorizationRequired")return Object.freeze({...empty(),state});
  const allowed=new Set(pins.slice(0,25).map(pin=>pin.pinId)),seen=new Set();
  const number=value=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0?value:null;
  const safePins=Array.isArray(value.pins)?value.pins.slice(0,25).flatMap(pin=>{const pinId=typeof pin?.pinId==="string"?pin.pinId.trim().slice(0,128):"";if(!pinId||!allowed.has(pinId)||seen.has(pinId))return[];seen.add(pinId);return[Object.freeze({pinId,impressions:number(pin.impressions),saves:number(pin.saves),pinClicks:number(pin.pinClicks),outboundClicks:number(pin.outboundClicks)})]}):[];
  const date=value=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:null;
  const startDate=date(value.window?.startDate),endDate=date(value.window?.endDate),window=startDate&&endDate&&value.window?.completedDays===30?Object.freeze({startDate,endDate,completedDays:30}):null;
  const totals=value.totals&&typeof value.totals==="object"?Object.freeze({impressions:number(value.totals.impressions),saves:number(value.totals.saves),pinClicks:number(value.totals.pinClicks),outboundClicks:number(value.totals.outboundClicks)}):null;
  return Object.freeze({state,window,totals,pins:Object.freeze(safePins)});
}

function safeAccountPerformance(value) {
  const empty=()=>Object.freeze({state:"NotRead",window:null,latestAvailableDate:null,totals:null,daily:Object.freeze([]),stale:false});
  if(!value||typeof value!=="object")return empty();
  const states=new Set(["NotRead","Available","NoData","Unavailable","RateLimited","ReauthorizationRequired","Failed"]),state=states.has(value.state)?value.state:"Failed";
  if(state==="ReauthorizationRequired")return Object.freeze({...empty(),state});
  const number=value=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0?value:null;
  const date=value=>{if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;const parsed=new Date(`${value}T00:00:00.000Z`);return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value?value:null};
  const startDate=date(value.window?.startDate),endDate=date(value.window?.endDate),window=startDate&&endDate&&startDate<=endDate&&value.window?.completedDays===30?Object.freeze({startDate,endDate,completedDays:30}):null;
  const latestAvailableDate=date(value.latestAvailableDate);
  const totals=value.totals&&typeof value.totals==="object"?Object.freeze({impressions:number(value.totals.impressions),saves:number(value.totals.saves),pinClicks:number(value.totals.pinClicks),outboundClicks:number(value.totals.outboundClicks)}):null;
  const seen=new Set(),daily=Array.isArray(value.daily)?value.daily.slice(0,30).flatMap(item=>{const day=date(item?.date);if(!day||!window||day<window.startDate||day>window.endDate||seen.has(day))return[];seen.add(day);return[Object.freeze({date:day,impressions:number(item.impressions),saves:number(item.saves),pinClicks:number(item.pinClicks),outboundClicks:number(item.outboundClicks)})]}).sort((left,right)=>left.date.localeCompare(right.date)):[];
  const stale=value.stale===true&&["Unavailable","RateLimited","Failed"].includes(state)&&window!==null;
  return Object.freeze({state,window,latestAvailableDate,totals,daily:Object.freeze(daily),stale});
}
const plainRecord=value=>{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const prototype=Object.getPrototypeOf(value);return prototype===null||prototype===Object.prototype||Object.getPrototypeOf(prototype)===null&&Object.prototype.hasOwnProperty.call(prototype,"constructor")&&prototype.constructor?.name==="Object";
};
const safeTopPinContentReadiness=value=>{
  if(value===null)return null;
  if(!plainRecord(value))return null;
  const keys=Object.keys(value).sort(),expected=["issueCount","requiredIssueCount","reviewIssueCount","status"];
  if(keys.length!==expected.length||keys.some((key,index)=>key!==expected[index]))return null;
  const count=item=>typeof item==="number"&&Number.isSafeInteger(item)&&item>=0&&item<=12?item:null;
  const issueCount=count(value.issueCount),requiredIssueCount=count(value.requiredIssueCount),reviewIssueCount=count(value.reviewIssueCount),status=value.status;
  if(!["Ready","NeedsAttention"].includes(status)||issueCount===null||requiredIssueCount===null||reviewIssueCount===null||requiredIssueCount+reviewIssueCount!==issueCount)return null;
  if(status==="Ready"&&(issueCount!==0||requiredIssueCount!==0||reviewIssueCount!==0))return null;
  if(status==="NeedsAttention"&&issueCount===0)return null;
  return Object.freeze({status,issueCount,requiredIssueCount,reviewIssueCount});
};
function safeTopPins(value) {
  const empty=()=>Object.freeze({state:"NotRead",window:null,sortBy:null,pins:Object.freeze([]),stale:false});
  if(!plainRecord(value))return empty();
  const states=new Set(["NotRead","Available","NoData","Unavailable","RateLimited","ReauthorizationRequired","Failed"]),state=states.has(value.state)?value.state:"Failed";
  if(state==="ReauthorizationRequired")return Object.freeze({...empty(),state});
  const date=value=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:null,number=value=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0?value:null;
  const startDate=date(value.window?.startDate),endDate=date(value.window?.endDate),window=startDate&&endDate&&startDate<=endDate&&value.window?.completedDays===30?Object.freeze({startDate,endDate,completedDays:30}):null;
  const pins=Array.isArray(value.pins)?value.pins.slice(0,25).flatMap(pin=>{if(!plainRecord(pin))return[];return[Object.freeze({title:text(pin.title,"Untitled Pin").slice(0,160),boardName:text(pin.boardName,"Unknown board").slice(0,160),impressions:number(pin.impressions),saves:number(pin.saves),pinClicks:number(pin.pinClicks),outboundClicks:number(pin.outboundClicks),contentReadiness:safeTopPinContentReadiness(pin.contentReadiness)})]}):[];
  return Object.freeze({state,window,sortBy:value.sortBy==="OUTBOUND_CLICK"?"OUTBOUND_CLICK":null,pins:Object.freeze(pins),stale:value.stale===true&&["Unavailable","RateLimited","Failed"].includes(state)&&window!==null});
}
function safeContentAudit(value, pins) {
  const emptyCounts = () => Object.freeze(Object.fromEntries(AUDIT_CODES.map(code => [code, 0])));
  if (!value || typeof value !== "object") return Object.freeze({ state: "NotRead", analyzedPins: 0, readyPins: 0, attentionPins: 0, issueCounts: emptyCounts(), pins: Object.freeze([]) });
  const state = ["NotRead", "Available", "TemporarilyUnavailable"].includes(value.state) ? value.state : "NotRead";
  const allowedPins = new Set(pins.map(pin => pin.pinId));
  const seenPins = new Set();
  const counts = Object.fromEntries(AUDIT_CODES.map(code => [code, 0]));
  const auditedPins = Array.isArray(value.pins) ? value.pins.slice(0, 25).flatMap(pin => {
    const pinId = typeof pin?.pinId === "string" ? pin.pinId.trim().slice(0, 128) : "";
    if (!pinId || !allowedPins.has(pinId) || seenPins.has(pinId)) return [];
    seenPins.add(pinId);
    const seenCodes = new Set();
    const issues = Array.isArray(pin.issues) ? pin.issues.flatMap(issue => {
      const rule = AUDIT_RULES[issue?.code];
      if (!rule || seenCodes.has(issue.code)) return [];
      seenCodes.add(issue.code);
      counts[issue.code] += 1;
      return [Object.freeze({ code: issue.code, level: rule.level, message: rule.message })];
    }).sort((left, right) => AUDIT_CODES.indexOf(left.code) - AUDIT_CODES.indexOf(right.code)) : [];
    return [Object.freeze({ pinId, status: issues.length ? "NeedsAttention" : "Ready", issues: Object.freeze(issues) })];
  }) : [];
  const attentionPins = auditedPins.filter(pin => pin.status === "NeedsAttention").length;
  return Object.freeze({ state, analyzedPins: auditedPins.length, readyPins: auditedPins.length - attentionPins, attentionPins, issueCounts: Object.freeze(counts), pins: Object.freeze(auditedPins) });
}
