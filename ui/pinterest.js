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
let accountPerformanceInFlight = false;
let topPinsInFlight = false;
let performanceInFlight = false;
let accountTrendMetric = "impressions";
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
const metricValue = value => value === null || value === undefined ? "Unavailable" : String(value);
const accountDay = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? displayDate(`${value}T00:00:00.000Z`) : "";
const dailyMetricValue = value => value === null || value === undefined ? "\u2014" : String(value);
const accountDailyColumns = Object.freeze([Object.freeze({key:"date",label:"Date"}),Object.freeze({key:"impressions",label:"Impressions"}),Object.freeze({key:"saves",label:"Saves"}),Object.freeze({key:"pinClicks",label:"Pin clicks"}),Object.freeze({key:"outboundClicks",label:"Outbound clicks"})]);
const accountTrendMetrics = Object.freeze([Object.freeze({key:"impressions",label:"Impressions"}),Object.freeze({key:"saves",label:"Saves"}),Object.freeze({key:"pinClicks",label:"Pin clicks"}),Object.freeze({key:"outboundClicks",label:"Outbound clicks"})]);
const accountTrendChartSize = Object.freeze({width:640,height:240,left:48,right:16,top:20,bottom:36});
const svgNamespace = "http://www.w3.org/2000/svg";

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

function stableAccountRows(rows,column,direction) {
  return rows.map((item,index)=>({item,index})).sort((left,right)=>{const leftValue=left.item[column.key],rightValue=right.item[column.key],leftMissing=leftValue===null||leftValue===undefined,rightMissing=rightValue===null||rightValue===undefined;if(leftMissing||rightMissing){if(leftMissing&&rightMissing)return left.index-right.index;return leftMissing?1:-1}const comparison=leftValue<rightValue?-1:leftValue>rightValue?1:0;return comparison===0?left.index-right.index:direction==="ascending"?comparison:-comparison}).map(entry=>entry.item);
}

const accountTrendNumber = value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const accountTrendCoordinate = (value, maximum) => String(Math.min(maximum, Math.max(0, Math.round((Number.isFinite(value) ? value : 0) * 100) / 100)));

function accountTrendRows(daily) {
  return daily.slice(0,30).flatMap(item=>typeof item?.date==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(item.date)&&accountDay(item.date)?[{date:item.date,impressions:accountTrendNumber(item.impressions),saves:accountTrendNumber(item.saves),pinClicks:accountTrendNumber(item.pinClicks),outboundClicks:accountTrendNumber(item.outboundClicks)}]:[]).sort((left,right)=>left.date.localeCompare(right.date));
}

function accountTrendSvg(rows, metric) {
  const values=rows.map((item,index)=>({index,date:item.date,value:item[metric.key]})),usable=values.filter(item=>item.value!==null);
  if(!usable.length)return null;
  const {width,height,left,right,top,bottom}=accountTrendChartSize,plotWidth=width-left-right,baseline=height-bottom,plotHeight=baseline-top,maximum=Math.max(0,...usable.map(item=>item.value)),lastIndex=Math.max(rows.length-1,1);
  const points=values.map(item=>item.value===null?null:{...item,x:rows.length===1?left+plotWidth/2:left+plotWidth*item.index/lastIndex,y:baseline-plotHeight*(maximum===0?0:item.value/maximum)});
  const svg=document.createElementNS(svgNamespace,"svg");
  svg.setAttribute("class","account-trend-chart");
  svg.setAttribute("viewBox",`0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio","xMidYMid meet");
  svg.setAttribute("role","img");
  svg.setAttribute("aria-label",`${metric.label} organic account trend from ${accountDay(rows[0].date)} to ${accountDay(rows.at(-1).date)} with ${usable.length} usable daily values.`);
  const baselineLine=document.createElementNS(svgNamespace,"line");
  baselineLine.setAttribute("class","account-trend-baseline");
  baselineLine.setAttribute("x1",accountTrendCoordinate(left,width));baselineLine.setAttribute("y1",accountTrendCoordinate(baseline,height));baselineLine.setAttribute("x2",accountTrendCoordinate(width-right,width));baselineLine.setAttribute("y2",accountTrendCoordinate(baseline,height));
  svg.append(baselineLine);
  let segment=[];
  const appendSegment=()=>{if(segment.length>1){const line=document.createElementNS(svgNamespace,"polyline");line.setAttribute("class","account-trend-line");line.setAttribute("points",segment.map(point=>`${accountTrendCoordinate(point.x,width)},${accountTrendCoordinate(point.y,height)}`).join(" "));svg.append(line)}segment=[]};
  for(const point of points){if(point===null){appendSegment();continue}segment.push(point)}appendSegment();
  for(const point of points){if(point===null)continue;const marker=document.createElementNS(svgNamespace,"circle");marker.setAttribute("class","account-trend-point");marker.setAttribute("cx",accountTrendCoordinate(point.x,width));marker.setAttribute("cy",accountTrendCoordinate(point.y,height));marker.setAttribute("r","3");svg.append(marker)}
  for(const [x,anchor,label] of [[left,"start",accountDay(rows[0].date)],[width-right,"end",accountDay(rows.at(-1).date)]]){const text=document.createElementNS(svgNamespace,"text");text.setAttribute("class","account-trend-axis-label");text.setAttribute("x",accountTrendCoordinate(x,width));text.setAttribute("y",accountTrendCoordinate(height-10,height));text.setAttribute("text-anchor",anchor);text.textContent=label;svg.append(text)}
  return svg;
}

function accountTrendView(daily) {
  const section=createElement("section","account-performance-trend"),selectors=createElement("div","account-trend-selectors"),chart=createElement("div","account-trend-chart-frame"),rows=accountTrendRows(daily),buttons=[];
  const renderChart=()=>{const metric=accountTrendMetrics.find(item=>item.key===accountTrendMetric)??accountTrendMetrics[0];for(const button of buttons)button.setAttribute("aria-pressed",String(button.dataset.accountTrendMetric===metric.key));const svg=accountTrendSvg(rows,metric);chart.replaceChildren(svg??createElement("p","account-trend-empty","No usable daily values"))};
  for(const metric of accountTrendMetrics){const button=createElement("button","account-trend-selector",metric.label);button.type="button";button.dataset.accountTrendMetric=metric.key;button.onclick=()=>{accountTrendMetric=metric.key;renderChart()};buttons.push(button);selectors.append(button)}
  section.append(createElement("h3","","30-day organic trend"),selectors,chart,createElement("p","account-trend-note","Local visualization of the already-read organic account metrics."));renderChart();return section;
}

function accountDailyTable(daily) {
  const wrapper=createElement("div","account-performance-table-wrap"),table=createElement("table","account-performance-table"),head=createElement("thead"),body=createElement("tbody");
  let rows=daily.slice(0,30),sort=null;
  const renderTable=()=>{const headerRow=createElement("tr");for(const column of accountDailyColumns){const cell=createElement("th"),button=createElement("button","account-performance-sort"),indicator=createElement("span","account-performance-sort-indicator");cell.setAttribute("scope","col");button.type="button";button.dataset.accountSort=column.key;button.append(createElement("span","",column.label),indicator);if(sort?.key===column.key){cell.setAttribute("aria-sort",sort.direction);indicator.textContent=sort.direction==="ascending"?"\u25b2":"\u25bc"}indicator.setAttribute("aria-hidden","true");button.onclick=()=>{const direction=sort?.key===column.key&&sort.direction==="descending"?"ascending":"descending";rows=stableAccountRows(rows,column,direction);sort={key:column.key,direction};renderTable()};cell.append(button);headerRow.append(cell)}const renderedRows=rows.map(item=>{const row=createElement("tr");row.append(createElement("td","",accountDay(item.date)));for(const key of ["impressions","saves","pinClicks","outboundClicks"])row.append(createElement("td","",dailyMetricValue(item[key])));return row});head.replaceChildren(headerRow);body.replaceChildren(...renderedRows)};
  renderTable();table.append(head,body);wrapper.append(table);return wrapper;
}

function accountPerformanceView() {
  const performance=connection.accountPerformance,card=createElement("article","card pinterest-account-performance");
  card.append(createElement("p","eyebrow","Organic account metrics · Read-only"),createElement("h2","","Account performance"));
  const analyticsBusy=accountPerformanceInFlight||topPinsInFlight||performanceInFlight;
  card.append(actionButton(accountPerformanceInFlight?"Reading account performance":"Read account performance","account-performance",!analyticsBusy&&actionAllowed(connection,"observe")));
  if(performance?.state==="NotRead"){card.append(createElement("p","","No organic account performance has been read yet."));return card}
  if(performance?.stale)card.append(createElement("p","quiet","Account performance is temporarily unavailable. The last valid account analytics snapshot remains visible as stale data."));
  if(performance?.state==="Unavailable")card.append(createElement("p","","Organic account analytics is unavailable. The authenticated Pinterest content connection remains available."));
  else if(performance?.state==="RateLimited")card.append(createElement("p","","Pinterest rate-limited the account performance request. Retry later."));
  else if(performance?.state==="Failed")card.append(createElement("p","","Account performance could not be read. The Pinterest content connection remains available."));
  else if(performance?.state==="ReauthorizationRequired"){card.append(createElement("p","","Reauthorize Pinterest before reading account performance."));return card}
  if(performance?.window)card.append(createElement("p","pin-performance-window",`${performance.window.startDate} to ${performance.window.endDate} · 30 completed UTC days`));
  if(performance?.latestAvailableDate)card.append(createElement("p","quiet",`Latest available date: ${performance.latestAvailableDate}`));
  if(performance?.totals){const metrics=createElement("div","pin-kpis");for(const [label,key] of [["Impressions","impressions"],["Saves","saves"],["Pin clicks","pinClicks"],["Outbound clicks","outboundClicks"]]){const metric=createElement("div","pin-metric");metric.append(createElement("span","",label),createElement("strong","",metricValue(performance.totals[key])));metrics.append(metric)}card.append(metrics)}
  if(performance?.state==="NoData")card.append(createElement("p","","No organic account metrics were available for this date window."));
  if(performance?.daily?.length&&(performance.state==="Available"||performance.stale))card.append(accountTrendView(performance.daily));
  if(performance?.daily?.length)card.append(createElement("h3","","Daily organic metrics"),accountDailyTable(performance.daily));
  return card;
}

function pinPerformanceView() {
  const pins=connection.observation?.pins??[],performance=connection.performance,card=createElement("article","card pinterest-organic-performance");
  card.append(createElement("p","eyebrow","Per-Pin metrics · Beta · Read-only"),createElement("h2","","Pin performance"));
  const analyticsBusy=accountPerformanceInFlight||topPinsInFlight||performanceInFlight;
  card.append(actionButton(performanceInFlight?"Reading Pin performance":"Read Pin performance","performance",pins.length>0&&!analyticsBusy&&actionAllowed(connection,"observe")));
  if(!pins.length){card.append(createElement("p","","Read Pins first. Use Read observation before reading Pin performance."));return card}
  if(performance?.state==="NotRead"){card.append(createElement("p","","No organic Pin performance has been read yet."));return card}
  if(["Unavailable","RateLimited","Failed"].includes(performance?.state)&&performance?.pins?.length)card.append(createElement("p","quiet","Performance is temporarily unavailable. The last valid analytics snapshot remains visible."));
  if(performance?.state==="Unavailable")card.append(createElement("p","","Organic Pin analytics is unavailable for this Pinterest application."));
  else if(performance?.state==="RateLimited")card.append(createElement("p","","Pinterest rate-limited the Pin performance request. Retry later."));
  else if(performance?.state==="Failed")card.append(createElement("p","","Pin performance could not be read. The Pinterest content connection remains available."));
  else if(performance?.state==="ReauthorizationRequired"){card.append(createElement("p","","Reauthorize Pinterest before reading Pin performance."));return card}
  if(performance?.window)card.append(createElement("p","pin-performance-window",`${performance.window.startDate} to ${performance.window.endDate} · 30 completed UTC days`));
  if(performance?.totals){const metrics=createElement("div","pin-kpis");for(const [label,key] of [["Impressions","impressions"],["Saves","saves"],["Pin clicks","pinClicks"],["Outbound clicks","outboundClicks"]]){const metric=createElement("div","pin-metric");metric.append(createElement("span","",label),createElement("strong","",metricValue(performance.totals[key])));metrics.append(metric)}card.append(metrics)}
  if(performance?.state==="NoData")card.append(createElement("p","","No organic Pin metrics were available for this date window."));
  const byId=new Map((performance?.pins??[]).map(pin=>[pin.pinId,pin])),list=createElement("div","pin-list");
  for(const pin of pins){const metrics=byId.get(pin.pinId);if(!metrics)continue;const pinItem=pinCard(pin),values=createElement("div","pin-kpis");for(const [label,key] of [["Impressions","impressions"],["Saves","saves"],["Pin clicks","pinClicks"],["Outbound clicks","outboundClicks"]]){const item=createElement("div","pin-metric");item.append(createElement("span","",label),createElement("strong","",metricValue(metrics[key])));values.append(item)}pinItem.children[1]?.append(values);list.append(pinItem)}
  if(list.childElementCount)card.append(list);
  return card;
}

function topPinsView(){
  const snapshot=connection.observation?.pins??[],result=connection.topPins,card=createElement("article","card pinterest-top-pins");
  card.append(createElement("p","eyebrow","Top organic Pins · Read-only"),createElement("h2","","Top Pins"));
  const analyticsBusy=accountPerformanceInFlight||topPinsInFlight||performanceInFlight;
  card.append(actionButton(topPinsInFlight?"Reading Top Pins":"Read Top Pins","top-pins",snapshot.length>0&&!analyticsBusy&&actionAllowed(connection,"observe")),createElement("p","quiet","Organic, read-only results limited to Pins in the current session snapshot."));
  if(!snapshot.length){card.append(createElement("p","","Read Pins first. Use Read observation before reading Top Pins."));return card}
  if(result?.state==="NotRead"){card.append(createElement("p","","No Top Pins analytics has been read yet."));return card}
  if(result?.stale)card.append(createElement("p","quiet","Top Pins is temporarily unavailable. The last valid result remains visible as stale data."));
  if(result?.state==="Unavailable")card.append(createElement("p","","Top Pins analytics is unavailable for this Pinterest application."));
  else if(result?.state==="RateLimited")card.append(createElement("p","","Pinterest rate-limited the Top Pins request. Retry later."));
  else if(result?.state==="Failed")card.append(createElement("p","","Top Pins could not be read. The Pinterest content connection remains available."));
  else if(result?.state==="ReauthorizationRequired"){card.append(createElement("p","","Reauthorize Pinterest before reading Top Pins."));return card}
  if(result?.window)card.append(createElement("p","pin-performance-window",`${accountDay(result.window.startDate)} to ${accountDay(result.window.endDate)} · 30 completed UTC days`));
  if(result?.state==="NoData")card.append(createElement("p","","No safely joinable Top Pins were available for this date window."));
  const safeById=new Map(snapshot.slice(0,25).map(pin=>[pin.pinId,pin])),rows=[];
  for(const metrics of result?.pins??[]){const pin=safeById.get(metrics.pinId);if(!pin)continue;const row=createElement("tr");row.append(createElement("td","",rows.length+1),createElement("td","",pin.title||"Untitled Pin"),createElement("td","",pin.boardName||"Unknown board"));for(const key of ["impressions","saves","pinClicks","outboundClicks"])row.append(createElement("td","",dailyMetricValue(metrics[key])));rows.push(row)}
  if(rows.length){const table=createElement("table","top-pins-table"),head=createElement("thead"),header=createElement("tr"),body=createElement("tbody");for(const label of ["Rank","Pin","Board","Impressions","Saves","Pin clicks","Outbound clicks"]){const cell=createElement("th","",label);cell.setAttribute("scope","col");header.append(cell)}head.append(header);body.append(...rows);table.append(head,body);card.append(table)}
  return card;
}

function performanceView() {
  const fragment=document.createDocumentFragment();
  fragment.append(accountPerformanceView(),topPinsView(),pinPerformanceView());
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
  if (view === "performance") {
    fragment.append(performanceView());
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

async function readAccountPerformance(){
  if(accountPerformanceInFlight||topPinsInFlight||performanceInFlight||!hasPinterestContract(api())||!actionAllowed(connection,"observe"))return;
  accountPerformanceInFlight=true;render();
  try{const result=await api().readAccountPerformance({correlationIdentifier:"pinterest-ui-account-organic-performance"});connection=transition(connection,{type:"ACCOUNT_PERFORMANCE_RESULT",value:result});}
  catch{connection=transition(connection,{type:"ACCOUNT_PERFORMANCE_RESULT",value:{state:"Failed"}})}
  finally{accountPerformanceInFlight=false;render()}
}
async function readTopPins(){
  if(topPinsInFlight||accountPerformanceInFlight||performanceInFlight||!hasPinterestContract(api())||!(connection.observation?.pins?.length))return;
  topPinsInFlight=true;render();
  try{const result=await api().readTopPins({correlationIdentifier:"pinterest-ui-top-pins"});connection=transition(connection,{type:"TOP_PINS_RESULT",value:result});}
  catch{connection=transition(connection,{type:"TOP_PINS_RESULT",value:{state:"Failed"}})}
  finally{topPinsInFlight=false;render()}
}
async function readPerformance(){
  if(performanceInFlight||topPinsInFlight||accountPerformanceInFlight||!hasPinterestContract(api())||!(connection.observation?.pins?.length))return;
  performanceInFlight=true;render();
  try{const result=await api().readPerformance({correlationIdentifier:"pinterest-ui-organic-performance"});connection=transition(connection,{type:"PERFORMANCE_RESULT",value:result});}
  catch{connection=transition(connection,{type:"PERFORMANCE_RESULT",value:{state:"Failed"}})}
  finally{performanceInFlight=false;render()}
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
      if (control.dataset.pinAction === "account-performance") return readAccountPerformance();
      if (control.dataset.pinAction === "top-pins") return readTopPins();
      if (control.dataset.pinAction === "performance") return readPerformance();
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
