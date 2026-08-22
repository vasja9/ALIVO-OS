import { actionAllowed, createPinterestUiState, hasPinterestContract, PINTEREST_UI_STATE, safeObservation, transition } from "./pinterest-connection-state.js";

const $ = selector => document.querySelector(selector);
const packageId = "ALIVO";
const views = new Set(["overview", "queue", "all", "timing", "scheduled", "published", "performance", "attention"]);
const labels = Object.freeze({
  [PINTEREST_UI_STATE.ConfigurationMissing]: ["Configuration missing", "Pinterest developer-app configuration is missing. Add approved configuration before connecting."],
  [PINTEREST_UI_STATE.Disconnected]: ["Not connected", "Pinterest is not connected. No Pinterest data is being read."],
  [PINTEREST_UI_STATE.Connecting]: ["Connecting", "Complete Pinterest authorization in the browser, then refresh this workspace."],
  [PINTEREST_UI_STATE.Connected]: ["Connected", "Pinterest connection verified for read-only observation."],
  [PINTEREST_UI_STATE.ConnectedLimitedPermissions]: ["Connected with limited permissions", "Pinterest is connected, but one or more read-only permissions are missing. Reauthorize to grant them."],
  [PINTEREST_UI_STATE.Verifying]: ["Checking connection", "Verifying Pinterest read capability. No write operation is performed."],
  [PINTEREST_UI_STATE.ObservationRead]: ["Read-only observation ready", "The latest Pinterest observation was received and remains advisory evidence."],
  [PINTEREST_UI_STATE.ReauthorizationRequired]: ["Reauthorization required", "The Pinterest session is expired, invalid, or locally stale. Reauthorize before another observation can be read."],
  [PINTEREST_UI_STATE.OAuthDenied]: ["OAuth denied", "Pinterest authorization was denied or cancelled. Try again only when approval is intended."],
  [PINTEREST_UI_STATE.TimeoutNetworkError]: ["Timeout / network error", "Pinterest did not respond. Retry later; provider details are hidden."],
  [PINTEREST_UI_STATE.RateLimited]: ["Rate limited", "Pinterest rate-limited the request. Wait before retrying."],
  [PINTEREST_UI_STATE.PreloadMissing]: ["Preload unavailable", "The secure Pinterest preload contract is missing or incomplete. Reopen the app after the update."],
});
const viewCopy = Object.freeze({
  queue: "Queue data is outside this read-only provider observation contract.",
  timing: "Timing policy remains governed elsewhere and is not changed by Pinterest observation.",
  scheduled: "Scheduling remains governed elsewhere and is not changed by Pinterest observation.",
  published: "Publishing remains governed elsewhere and no write operation is exposed here.",
  performance: "Performance observation will appear when Pinterest returns a governed read-only result.",
  attention: "No Pins need attention",
});

let view = "overview";
let connection = createPinterestUiState(hasPinterestContract(globalThis.window?.alivoPinterest));
let statusPoll;
let oauthInFlight = false;
let verifyInFlight = false;
let observationInFlight = false;
let pollAttempts = 0;

const api = () => globalThis.window?.alivoPinterest;
const words = value => String(value ?? "").replace(/([a-z])([A-Z])/g, "$1 $2");
const displayDate = value => {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.${String(date.getUTCFullYear()).slice(-2)}`;
};
const busy = () => connection.uiState === PINTEREST_UI_STATE.Connecting || connection.uiState === PINTEREST_UI_STATE.Verifying;
const statusLabel = () => labels[connection.uiState] || ["Pinterest status unavailable", "Pinterest state is unavailable."];

function observationSummary() {
  const observation = connection.observation;
  if (!observation) {
    const empty = document.createElement("article");
    empty.className = "card empty";
    empty.append(createElement("h2", "", "Read-only observation"), createElement("p", "", "No Pinterest observation has been read yet."));
    return empty;
  }
  const summary = observation.summary && typeof observation.summary === "object" ? observation.summary : {};
  const card = createElement("article", "card");
  const metrics = createElement("div", "pin-kpis");
  Object.entries(summary).filter(([, value]) => Number.isFinite(value)).slice(0, 6).forEach(([key, value]) => {
    const metric = createElement("div", "pin-metric");
    metric.append(createElement("span", "", words(key)), createElement("strong", "", String(value)));
    metrics.append(metric);
  });
  if (!metrics.childElementCount) metrics.append(createElement("div", "quiet", "No aggregate counts returned"));
  card.append(createElement("p", "eyebrow", "Pinterest evidence · read-only"), createElement("h2", "", "Observation result"), metrics);
  if (observation.warningCount || observation.failureCount) {
    const diagnostics = [];
    if (observation.warningCount) diagnostics.push(`${observation.warningCount} workflow warning${observation.warningCount === 1 ? "" : "s"} withheld`);
    if (observation.failureCount) diagnostics.push(`${observation.failureCount} workflow failure${observation.failureCount === 1 ? "" : "s"} withheld`);
    card.append(createElement("p", "", diagnostics.join(" · ")));
  }
  card.append(createElement("small", "", "Provider payloads, tokens, callback data and secrets are never rendered."));
  return card;
}

function contentAuditSummary() {
  const audit = connection.observation?.audit;
  const card = createElement("article", "card content-readiness");
  card.append(createElement("p", "eyebrow", "Deterministic content audit · Not performance analytics"), createElement("h2", "", "Content readiness"));
  if (!audit || audit.state === "NotRead") {
    card.append(createElement("p", "", "No content audit has been run yet."));
    return card;
  }
  if (audit.state === "TemporarilyUnavailable") card.append(createElement("p", "quiet", "Content audit is temporarily unavailable. The last valid audit remains visible."));
  if (!audit.analyzedPins) {
    card.append(createElement("p", "", "No Pins are available for content audit."));
    return card;
  }
  const required = audit.pins.reduce((total, pin) => total + pin.issues.filter(issue => issue.level === "Required").length, 0);
  const review = audit.pins.reduce((total, pin) => total + pin.issues.filter(issue => issue.level === "Review").length, 0);
  const metrics = createElement("div", "pin-kpis");
  for (const [label, value] of [["Pins analyzed", audit.analyzedPins], ["Ready", audit.readyPins], ["Needs attention", audit.attentionPins], ["Required issues", required], ["Review issues", review]]) {
    const metric = createElement("div", "pin-metric");
    metric.append(createElement("span", "", label), createElement("strong", "", value));
    metrics.append(metric);
  }
  card.append(metrics, createElement("small", "", "Performance data is not included."));
  return card;
}

function auditForPin(pinId) {
  return connection.observation?.audit?.pins?.find(pin => pin.pinId === pinId);
}

function pinCard(pin, showIssues = false) {
  const card = createElement("article", "card pin-card");
  const visual = createElement("div", "pin-thumbnail");
  if (pin.thumbnail) {
    const image = createElement("img", "pin-thumbnail-image", undefined);
    image.src = `data:${pin.thumbnail.mimeType};base64,${pin.thumbnail.base64}`;
    image.loading = "lazy";
    image.decoding = "async";
    image.alt = (pin.title || "").slice(0, 160);
    visual.append(image);
  } else visual.append(createElement("span", "pin-thumbnail-placeholder", "No image"));
  const content = createElement("div", "pin-card-content");
  const audit = auditForPin(pin.pinId);
  const issueCount = audit?.issues?.length ?? 0;
  if (audit) content.append(createElement("span", `badge ${issueCount ? "warning" : "success"}`, issueCount ? `Needs attention (${issueCount})` : "Ready"));
  content.append(createElement("h2", "", pin.title || "Untitled Pin"));
  if (pin.description) content.append(createElement("p", "", pin.description));
  const details = createElement("div", "pin-metadata");
  const segments = [];
  const date = displayDate(pin.createdAt);
  if (date) segments.push(`Datum: ${date}`);
  if (pin.boardName) segments.push(`Board: ${pin.boardName}`);
  if (pin.destinationDomain) segments.push(`Destination: ${pin.destinationDomain}`);
  details.textContent = segments.join(" · ");
  content.append(details);
  if (showIssues && audit) {
    const issues = createElement("div", "pin-audit-issues");
    for (const issue of audit.issues) {
      const row = createElement("p", `pin-audit-issue ${issue.level.toLowerCase()}`);
      row.append(createElement("strong", "", issue.level), createElement("span", "", `: ${issue.message}`));
      issues.append(row);
    }
    content.append(issues);
  }
  card.append(visual, content);
  return card;
}

function allPinsView() {
  const fragment = document.createDocumentFragment();
  const observation = connection.observation;
  const pins = Array.isArray(observation?.pins) ? observation.pins : [];
  if (connection.observationStatus === "unread") {
    const empty = createElement("article", "card empty");
    empty.append(createElement("h2", "", "All Pins"), createElement("p", "", "No observation has been read yet. Use Read observation to load Pins."));
    fragment.append(empty);
    return fragment;
  }
  if (connection.observationStatus === "unavailable") {
    const unavailable = createElement("article", "card empty");
    unavailable.append(createElement("h2", "", "Pinterest observation temporarily unavailable"), createElement("p", "", "The authenticated connection remains available. Previously observed Pins remain listed below when available."));
    fragment.append(unavailable);
  }
  if (!pins.length) {
    const empty = createElement("article", "card empty");
    empty.append(createElement("h2", "", "All Pins"), createElement("p", "", connection.observationStatus === "empty" ? "The observation completed successfully with no Pins." : "No safe Pin snapshot is available."));
    fragment.append(empty);
    return fragment;
  }
  const list = createElement("div", "pin-list");
  for (const pin of pins) list.append(pinCard(pin));
  fragment.append(list);
  return fragment;
}

function attentionView() {
  const fragment = document.createDocumentFragment();
  const audit = connection.observation?.audit;
  const pins = Array.isArray(connection.observation?.pins) ? connection.observation.pins : [];
  const attentionIds = new Set(audit?.pins?.filter(pin => pin.status === "NeedsAttention").map(pin => pin.pinId) ?? []);
  const attentionPins = pins.filter(pin => attentionIds.has(pin.pinId));
  if (!attentionPins.length) {
    const empty = createElement("article", "card empty");
    empty.append(createElement("h2", "", "Attention"), createElement("p", "", "No Pins need attention"));
    fragment.append(empty);
    return fragment;
  }
  const list = createElement("div", "pin-list");
  for (const pin of attentionPins) list.append(pinCard(pin, true));
  fragment.append(list);
  return fragment;
}

function createElement(tag, className = "", content = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = String(content);
  return element;
}

function actionButton(label, action, enabled) {
  const control = createElement("button", "secondary", label);
  control.type = "button";
  control.dataset.pinAction = action;
  control.disabled = !enabled;
  return control;
}

function connectionPanel() {
  const [title, description] = statusLabel();
  const canConnect = actionAllowed(connection, "connect") && !oauthInFlight;
  const canVerify = actionAllowed(connection, "verify") && !verifyInFlight;
  const canObserve = actionAllowed(connection, "observe") && !observationInFlight;
  const needsReauthorization = connection.uiState === PINTEREST_UI_STATE.ConnectedLimitedPermissions
    || connection.uiState === PINTEREST_UI_STATE.ReauthorizationRequired;
  const card = createElement("article", "card pinterest-connection-card");
  card.setAttribute("aria-live", "polite");
  const head = createElement("div", "card-head");
  const heading = createElement("div");
  heading.append(createElement("p", "eyebrow", "Pinterest connection"), createElement("h2", "", title));
  const state = createElement("span", `state ${connection.uiState.toLowerCase()}`, words(connection.uiState));
  head.append(heading, state);
  const actions = createElement("div", "pin-actions");
  actions.append(actionButton(needsReauthorization ? "Reauthorize Pinterest" : "Connect Pinterest", "connect", canConnect), actionButton("Verify read access", "verify", canVerify), actionButton("Read observation", "observe", canObserve), actionButton("Refresh status", "refresh", !busy()));
  card.append(head, createElement("p", "", description), createElement("p", "quiet", connection.message || ""), actions, createElement("small", "", `Business Package ${packageId} · read-only observation only`));
  return card;
}

function scopedView() {
  const fragment = document.createDocumentFragment();
  fragment.append(connectionPanel());
  if (view === "overview") {
    fragment.append(observationSummary(), contentAuditSummary());
    return fragment;
  }
  if (view === "all") {
    fragment.append(allPinsView());
    return fragment;
  }
  if (view === "attention") {
    fragment.append(attentionView());
    return fragment;
  }
  const card = createElement("article", "card empty");
  card.append(createElement("h2", "", words(view)), createElement("p", "", viewCopy[view] || "This Pinterest view is unavailable from the current read-only contract."));
  fragment.append(card);
  return fragment;
}

function render() {
  $("#pin-loading").hidden = !busy();
  $("#pin-error").hidden = true;
  $("#pin-overview").replaceChildren();
  $("#pin-view-content").replaceChildren();
  (view === "overview" ? $("#pin-overview") : $("#pin-view-content")).append(scopedView());
  document.querySelectorAll("[data-pin-view]").forEach(tab => tab.setAttribute("aria-selected", String(tab.dataset.pinView === view)));
  const attentionCount = $("#pin-attention-count");
  if (attentionCount) attentionCount.textContent = String(connection.observation?.audit?.attentionPins ?? 0);
  bind();
  history.replaceState({}, "", `#pinterest?${new URLSearchParams({ view })}`);
}

async function refreshStatus({ polling = false } = {}) {
  if (!hasPinterestContract(api())) {
    connection = transition(connection, { type: "PRELOAD_MISSING" });
    render();
    return;
  }
  let result;
  try {
    result = await api().connectionStatus();
  } catch {
    result = { ok: false, code: "NETWORK_FAILURE" };
  }
  connection = transition(connection, { type: "STATUS_RESULT", value: result, oauthTimedOut: polling && pollAttempts >= 8 });
  render();
  if (polling && connection.uiState === PINTEREST_UI_STATE.Connecting && pollAttempts < 8) {
    clearTimeout(statusPoll);
    statusPoll = setTimeout(() => { pollAttempts += 1; refreshStatus({ polling: true }); }, 1500);
  }
}

async function connect() {
  if (oauthInFlight || !actionAllowed(connection, "connect") || !hasPinterestContract(api())) return;
  oauthInFlight = true;
  connection = transition(connection, { type: "START_REQUEST" });
  render();
  try {
    const result = await api().startOAuth({ correlationIdentifier: "pinterest-ui-connect" });
    connection = transition(connection, { type: "START_RESULT", value: result });
    render();
    if (result?.ok) {
      pollAttempts = 0;
      clearTimeout(statusPoll);
      statusPoll = setTimeout(() => { pollAttempts += 1; refreshStatus({ polling: true }); }, 1500);
    }
  } catch {
    connection = transition(connection, { type: "START_RESULT", value: { ok: false, code: "NETWORK_FAILURE" } });
    render();
  } finally {
    oauthInFlight = false;
  }
}

async function verifyConnection() {
  if (verifyInFlight || !hasPinterestContract(api())) return;
  verifyInFlight = true;
  connection = transition(connection, { type: "VERIFY_REQUEST" });
  render();
  try {
    const result = await api().verifyConnection({ requestedCapabilities: ["MarketObservation"], correlationIdentifier: "pinterest-ui-verify" });
    connection = transition(connection, { type: "VERIFY_RESULT", value: result });
    render();
  } catch {
    connection = transition(connection, { type: "VERIFY_RESULT", value: { ok: false, code: "NETWORK_FAILURE" } });
    render();
  } finally {
    verifyInFlight = false;
  }
}

async function readObservation() {
  if (observationInFlight || !hasPinterestContract(api()) || !actionAllowed(connection, "observe")) return;
  observationInFlight = true;
  connection = transition(connection, { type: "OBSERVATION_REQUEST" });
  render();
  try {
    const result = await api().readObservation({ capability: "MarketObservation", marketContext: "global", pageSize: 25, correlationIdentifier: "pinterest-ui-observation" });
    connection = transition(connection, { type: "OBSERVATION_RESULT", value: { ...result, ...safeObservation(result) } });
    render();
  } catch {
    connection = transition(connection, { type: "OBSERVATION_RESULT", value: { ok: false, code: "NETWORK_FAILURE" } });
    render();
  } finally {
    observationInFlight = false;
    render();
  }
}

function changeView(next) {
  view = views.has(next) ? next : "overview";
  render();
}

function bind() {
  document.querySelectorAll("[data-pin-view]").forEach(tab => { tab.onclick = () => changeView(tab.dataset.pinView); });
  document.querySelectorAll("[data-pin-action]").forEach(control => {
    control.onclick = () => {
      if (control.dataset.pinAction === "connect") return connect();
      if (control.dataset.pinAction === "verify") return verifyConnection();
      if (control.dataset.pinAction === "observe") return readObservation();
      return refreshStatus();
    };
  });
}

window.addEventListener("alivo:pinterest:open", () => { view = "overview"; refreshStatus(); });
if (location.hash.startsWith("#pinterest")) {
  const parameters = new URLSearchParams(location.hash.split("?")[1] || "");
  view = views.has(parameters.get("view")) ? parameters.get("view") : "overview";
}
render();
refreshStatus();
