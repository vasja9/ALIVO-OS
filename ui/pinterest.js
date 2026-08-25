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
let topPinsTableSession = { result: null, filter: "all", sort: { key: "rank", direction: "ascending" }, expandedRank: null, selectedOrders: Object.freeze([]) };
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
const accountTrendChartSize = Object.freeze({width:640,height:280,left:68,right:20,top:30,bottom:58});
const topPinsMetrics=Object.freeze([Object.freeze({key:"impressions",label:"Impressions",rate:false}),Object.freeze({key:"saves",label:"Saves",rate:false}),Object.freeze({key:"pinClicks",label:"Pin clicks",rate:false}),Object.freeze({key:"outboundClicks",label:"Outbound clicks",rate:false}),Object.freeze({key:"saveRate",label:"Save rate",rate:true}),Object.freeze({key:"pinClickRate",label:"Pin click rate",rate:true}),Object.freeze({key:"outboundClickRate",label:"Outbound click rate",rate:true})]);
const topPinsAccountRateNumerators=Object.freeze({saveRate:"saves",pinClickRate:"pinClicks",outboundClickRate:"outboundClicks"});
const topPinsOutboundContextColumn=Object.freeze({key:"outboundVsAccount",label:"Outbound vs account",type:"number"});
const topPinsColumns=Object.freeze([Object.freeze({key:"rank",label:"Rank",type:"number"}),Object.freeze({key:"title",label:"Pin",type:"text"}),Object.freeze({key:"boardName",label:"Board",type:"text"}),...topPinsMetrics.map(metric=>Object.freeze({...metric,type:"number"})),topPinsOutboundContextColumn]);
const topPinsContributionMetrics=Object.freeze([Object.freeze({key:"impressions",label:"Impressions"}),Object.freeze({key:"saves",label:"Saves"}),Object.freeze({key:"pinClicks",label:"Pin clicks"}),Object.freeze({key:"outboundClicks",label:"Outbound clicks"})]);
const svgNamespace = "http://www.w3.org/2000/svg";
const observedRate=(numerator,impressions)=>{if(!Number.isFinite(impressions)||impressions<=0||!Number.isFinite(numerator))return null;const value=numerator/impressions*100;return Number.isFinite(value)?value:null};
const observedRateValue=value=>value===null?"—":`${value.toFixed(2)}%`;
const niceAxisScale=(maximum,isRate=false)=>{if(!Number.isFinite(maximum)||maximum<=0){const step=isRate?.2:1;return Object.freeze({maximum:1,step,ticks:Object.freeze(Array.from({length:Math.round(1/step)+1},(_,index)=>index*step))})}const padded=maximum*1.1,raw=padded/5,exponent=Math.floor(Math.log10(raw)),candidates=[-1,0,1].flatMap(offset=>[1,2,2.5,5,10].map(unit=>unit*10**(exponent+offset))).filter(step=>isRate||step>=1),suitable=candidates.map(step=>({step,intervals:Math.ceil(padded/step)})).filter(item=>item.intervals>=4&&item.intervals<=6).sort((a,b)=>Math.abs(a.intervals-5)-Math.abs(b.intervals-5)||a.step-b.step),step=suitable[0]?.step??Math.max(isRate?Number.MIN_VALUE:1,raw),axisMaximum=Math.ceil(padded/step)*step,intervals=Math.round(axisMaximum/step),precision=Math.max(0,-Math.floor(Math.log10(step)))+2,ticks=Array.from({length:intervals+1},(_,index)=>Number((index*step).toFixed(precision)));return Object.freeze({maximum:axisMaximum,step,ticks:Object.freeze(ticks)})};

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

const accountComparisonMetrics=Object.freeze([Object.freeze({key:"impressions",label:"Impressions"}),Object.freeze({key:"saves",label:"Saves"}),Object.freeze({key:"pinClicks",label:"Pin clicks"}),Object.freeze({key:"outboundClicks",label:"Outbound clicks"})]);
const comparisonInteger=value=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0?value:null;
const canonicalComparisonDate=value=>{if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(`${value}T00:00:00.000Z`);return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value};
const comparisonSigned=value=>value===null?"—":value>0?`+${value}`:value<0?`−${Math.abs(value)}`:"0";
const comparisonPercent=value=>value===null?"—":value>0?`+${value.toFixed(2)}%`:value<0?`−${Math.abs(value).toFixed(2)}%`:"0.00%";

function accountComparisonDates(window){
  if(window?.completedDays!==30||!canonicalComparisonDate(window.startDate)||!canonicalComparisonDate(window.endDate))return null;
  const start=new Date(`${window.startDate}T00:00:00.000Z`),dates=[];for(let index=0;index<30;index++){dates.push(start.toISOString().slice(0,10));start.setUTCDate(start.getUTCDate()+1)}return dates.at(-1)===window.endDate?Object.freeze(dates):null;
}

function accountComparison(window,daily){
  const dates=accountComparisonDates(window);if(!dates||!Array.isArray(daily))return null;const source=daily.slice(0,30),byDate=new Map();let invalidDates=false;for(const item of source){if(!canonicalComparisonDate(item?.date)||byDate.has(item.date)){invalidDates=true;continue}byDate.set(item.date,Object.freeze({date:item.date,impressions:comparisonInteger(item.impressions),saves:comparisonInteger(item.saves),pinClicks:comparisonInteger(item.pinClicks),outboundClicks:comparisonInteger(item.outboundClicks)}))}if(dates.some(date=>!byDate.has(date)))invalidDates=true;
  const total=(period,key)=>{let value=0;for(const date of period){const dailyValue=byDate.get(date)?.[key];if(dailyValue===null||dailyValue===undefined)return null;value+=dailyValue;if(!Number.isSafeInteger(value))return null}return value},previousDates=dates.slice(0,15),latestDates=dates.slice(15),rows=accountComparisonMetrics.map(metric=>{if(invalidDates)return Object.freeze({...metric,previousTotal:null,latestTotal:null,absoluteChange:null,percentageChange:null});const previousTotal=total(previousDates,metric.key),latestTotal=total(latestDates,metric.key);if(previousTotal===null||latestTotal===null)return Object.freeze({...metric,previousTotal:null,latestTotal:null,absoluteChange:null,percentageChange:null});const absoluteChange=latestTotal-previousTotal;if(!Number.isSafeInteger(absoluteChange))return Object.freeze({...metric,previousTotal:null,latestTotal:null,absoluteChange:null,percentageChange:null});const percentageChange=previousTotal===0?(latestTotal===0?0:null):absoluteChange/previousTotal*100;return Object.freeze({...metric,previousTotal,latestTotal,absoluteChange,percentageChange:Number.isFinite(percentageChange)?percentageChange:null})});
  return Object.freeze({previousLabel:`${accountDay(previousDates[0])} – ${accountDay(previousDates.at(-1))}`,latestLabel:`${accountDay(latestDates[0])} – ${accountDay(latestDates.at(-1))}`,rows:Object.freeze(rows)});
}

function accountComparisonView(window,daily){
  const comparison=accountComparison(window,daily);if(!comparison)return null;const section=createElement("section","account-comparison"),ranges=createElement("p","account-comparison-ranges",`Previous: ${comparison.previousLabel} · Latest: ${comparison.latestLabel}`),wrapper=createElement("div","account-comparison-table-wrap"),table=createElement("table","account-comparison-table"),head=createElement("thead"),headingRow=createElement("tr"),body=createElement("tbody");for(const label of ["Metric","Previous 15 days","Latest 15 days","Absolute change","Percentage change"]){const cell=createElement("th","",label);cell.setAttribute("scope","col");headingRow.append(cell)}head.append(headingRow);for(const item of comparison.rows){const row=createElement("tr");row.append(createElement("th","",item.label),createElement("td","",item.previousTotal===null?"—":String(item.previousTotal)),createElement("td","",item.latestTotal===null?"—":String(item.latestTotal)),createElement("td","",comparisonSigned(item.absoluteChange)),createElement("td","",comparisonPercent(item.percentageChange)));row.children[0].setAttribute("scope","row");body.append(row)}table.append(head,body);wrapper.append(table);section.append(createElement("h3","","Observed 15-day comparison"),createElement("p","","Latest 15 completed UTC days compared with the previous 15 completed UTC days. Descriptive totals only; no prediction or causal attribution."),ranges,wrapper);return section;
}

const accountRateComparisonMetrics=Object.freeze([Object.freeze({key:"saves",label:"Save rate"}),Object.freeze({key:"pinClicks",label:"Pin click rate"}),Object.freeze({key:"outboundClicks",label:"Outbound click rate"})]);
const accountRateValue=value=>value===null?"—":`${value.toFixed(2)}%`;
const accountRateChange=value=>value===null?"—":value>0?`+${value.toFixed(2)} pp`:value<0?`−${Math.abs(value).toFixed(2)} pp`:"0.00 pp";

function accountRateComparison(window,daily){
  const dates=accountComparisonDates(window);if(!dates||!Array.isArray(daily))return null;const byDate=new Map(),duplicates=new Set();for(const item of daily.slice(0,30)){if(!canonicalComparisonDate(item?.date)||item.date<window.startDate||item.date>window.endDate)continue;if(byDate.has(item.date)){duplicates.add(item.date);continue}byDate.set(item.date,Object.freeze({date:item.date,impressions:comparisonInteger(item.impressions),saves:comparisonInteger(item.saves),pinClicks:comparisonInteger(item.pinClicks),outboundClicks:comparisonInteger(item.outboundClicks)}))}
  const rate=(period,key)=>{let impressions=0,numerator=0;for(const date of period){const item=byDate.get(date);if(!item||duplicates.has(date)||item.impressions===null||item[key]===null)return null;if(impressions>Number.MAX_SAFE_INTEGER-item.impressions||numerator>Number.MAX_SAFE_INTEGER-item[key])return null;impressions+=item.impressions;numerator+=item[key]}if(impressions===0)return null;const value=numerator/impressions*100;return Number.isFinite(value)?value:null},previousDates=dates.slice(0,15),latestDates=dates.slice(15),rows=accountRateComparisonMetrics.map(metric=>{const previousRate=rate(previousDates,metric.key),latestRate=rate(latestDates,metric.key),change=previousRate===null||latestRate===null?null:latestRate-previousRate;return Object.freeze({...metric,previousRate,latestRate,change:Number.isFinite(change)?change:null})});
  return Object.freeze({previousLabel:`${accountDay(previousDates[0])} – ${accountDay(previousDates.at(-1))}`,latestLabel:`${accountDay(latestDates[0])} – ${accountDay(latestDates.at(-1))}`,rows:Object.freeze(rows)});
}

function accountRateComparisonView(window,daily){
  const comparison=accountRateComparison(window,daily);if(!comparison)return null;const section=createElement("section","account-rate-comparison"),ranges=createElement("p","account-rate-comparison-ranges",`Previous: ${comparison.previousLabel} · Latest: ${comparison.latestLabel}`),wrapper=createElement("div","account-rate-comparison-table-wrap"),table=createElement("table","account-rate-comparison-table"),head=createElement("thead"),headingRow=createElement("tr"),body=createElement("tbody");for(const label of ["Metric","Previous 15 days","Latest 15 days","Change"]){const cell=createElement("th","",label);cell.setAttribute("scope","col");headingRow.append(cell)}head.append(headingRow);for(const item of comparison.rows){const row=createElement("tr");row.append(createElement("th","",item.label),createElement("td","",accountRateValue(item.previousRate)),createElement("td","",accountRateValue(item.latestRate)),createElement("td","",accountRateChange(item.change)));row.children[0].setAttribute("scope","row");body.append(row)}table.append(head,body);wrapper.append(table);section.append(createElement("h3","","Observed 15-day rate comparison"),createElement("p","","Observed interaction rates calculated from organic account totals. Descriptive comparison only; not prediction or causal attribution."),ranges,wrapper);return section;
}

function accountTrendSvg(rows, metric) {
  const values=rows.map((item,index)=>({index,date:item.date,value:item[metric.key]})),usable=values.filter(item=>item.value!==null);
  if(!usable.length)return null;
  const {width,height,left,right,top,bottom}=accountTrendChartSize,plotWidth=width-left-right,baseline=height-bottom,plotHeight=baseline-top,scale=niceAxisScale(Math.max(0,...usable.map(item=>item.value))),lastIndex=Math.max(rows.length-1,1);
  const points=values.map(item=>item.value===null?null:{...item,x:rows.length===1?left+plotWidth/2:left+plotWidth*item.index/lastIndex,y:baseline-plotHeight*item.value/scale.maximum});
  const svg=document.createElementNS(svgNamespace,"svg");
  svg.setAttribute("class","account-trend-chart");
  svg.setAttribute("viewBox",`0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio","xMidYMid meet");
  svg.setAttribute("role","img");
  svg.setAttribute("aria-label",`${metric.label} organic account trend from ${accountDay(rows[0].date)} to ${accountDay(rows.at(-1).date)} with ${usable.length} usable daily values.`);
  const axisLine=(className,x1,y1,x2,y2)=>{const line=document.createElementNS(svgNamespace,"line");line.setAttribute("class",className);line.setAttribute("x1",accountTrendCoordinate(x1,width));line.setAttribute("y1",accountTrendCoordinate(y1,height));line.setAttribute("x2",accountTrendCoordinate(x2,width));line.setAttribute("y2",accountTrendCoordinate(y2,height));line.setAttribute("aria-hidden","true");return line},axisText=(className,x,y,anchor,value)=>{const text=document.createElementNS(svgNamespace,"text");text.setAttribute("class",className);text.setAttribute("x",accountTrendCoordinate(x,width));text.setAttribute("y",accountTrendCoordinate(y,height));text.setAttribute("text-anchor",anchor);text.textContent=value;return text};
  svg.append(axisLine("account-trend-x-axis",left,baseline,width-right,baseline),axisLine("account-trend-y-axis",left,top,left,baseline));
  for(const value of scale.ticks){const y=baseline-plotHeight*value/scale.maximum;svg.append(axisLine("account-trend-tick",left-4,y,left,y),axisText("account-trend-tick-label",left-8,y+4,"end",String(Math.round(value))))}
  let segment=[];
  const appendSegment=()=>{if(segment.length>1){const line=document.createElementNS(svgNamespace,"polyline");line.setAttribute("class","account-trend-line");line.setAttribute("points",segment.map(point=>`${accountTrendCoordinate(point.x,width)},${accountTrendCoordinate(point.y,height)}`).join(" "));svg.append(line)}segment=[]};
  for(const point of points){if(point===null){appendSegment();continue}segment.push(point)}appendSegment();
  for(const point of points){if(point===null)continue;const marker=document.createElementNS(svgNamespace,"circle");marker.setAttribute("class","account-trend-point");marker.setAttribute("cx",accountTrendCoordinate(point.x,width));marker.setAttribute("cy",accountTrendCoordinate(point.y,height));marker.setAttribute("r","3");svg.append(marker)}
  for(const [x,anchor,label] of [[left,"start",accountDay(rows[0].date)],[width-right,"end",accountDay(rows.at(-1).date)]])svg.append(axisText("account-trend-date-label",x,baseline+20,anchor,label));
  svg.append(axisText("account-trend-y-label",left,16,"start",metric.label),axisText("account-trend-x-label",left+plotWidth/2,height-8,"middle","Date (UTC)"));
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
  if(performance?.window&&(performance.state==="Available"||performance.stale)){const comparison=accountComparisonView(performance.window,performance.daily??[]),rateComparison=accountRateComparisonView(performance.window,performance.daily??[]);if(comparison)card.append(comparison);if(rateComparison)card.append(rateComparison)}
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

function stableTopPinsRows(rows,column,direction){
  const multiplier=direction==="ascending"?1:-1;
  return rows.map((row,index)=>({row,index})).sort((left,right)=>{const a=left.row[column.key],b=right.row[column.key],aMissing=a===null,bMissing=b===null;if(aMissing||bMissing)return aMissing===bMissing?left.index-right.index:aMissing?1:-1;const comparison=column.type==="text"?String(a).toLocaleLowerCase("en-US").localeCompare(String(b).toLocaleLowerCase("en-US"),"en-US"):a-b;return comparison===0?left.index-right.index:comparison*multiplier}).map(item=>item.row);
}

function topPinsAccountRate(account,topPins,metric){
  if(!metric.rate)return null;const accountRetained=account&&(account.state==="Available"||account.stale===true),topPinsRetained=topPins&&(topPins.state==="Available"||topPins.stale===true),accountDates=accountRetained?accountComparisonDates(account.window):null,topPinsDates=topPinsRetained?accountComparisonDates(topPins.window):null,numeratorKey=topPinsAccountRateNumerators[metric.key];if(!accountDates||!topPinsDates||!numeratorKey||account.window.startDate!==topPins.window.startDate||account.window.endDate!==topPins.window.endDate||account.window.completedDays!==topPins.window.completedDays)return null;const impressions=comparisonInteger(account.totals?.impressions),numerator=comparisonInteger(account.totals?.[numeratorKey]);if(impressions===null||numerator===null||impressions===0)return null;const value=numerator/impressions*100;return Number.isFinite(value)?Object.freeze({value,stale:account.stale===true||topPins.stale===true}):null;
}

const topPinsOutboundDifferenceValue=value=>value===null?"—":value>0?`+${value.toFixed(2)} pp`:value<0?`−${Math.abs(value).toFixed(2)} pp`:"0.00 pp";

function topPinsOutboundContext(account,topPins){
  const metric=topPinsMetrics.find(item=>item.key==="outboundClickRate"),reference=metric?topPinsAccountRate(account,topPins,metric):null;if(!reference)return null;return Object.freeze({accountRate:reference.value,stale:reference.stale,startDate:topPins.window.startDate,endDate:topPins.window.endDate,completedDays:topPins.window.completedDays});
}

function topPinsOutboundDifference(row,context){
  if(!context)return null;const impressions=comparisonInteger(row.impressions),outboundClicks=comparisonInteger(row.outboundClicks);if(impressions===null||outboundClicks===null||impressions===0)return null;const topPinRate=outboundClicks/impressions*100,difference=topPinRate-context.accountRate;return Number.isFinite(topPinRate)&&Number.isFinite(difference)?difference:null;
}

function topPinsComparison(rows,account,topPins){
  const window=topPins.window,section=createElement("section","top-pins-comparison"),selectors=createElement("div","top-pins-selectors"),context=createElement("div","top-pins-account-reference-context"),frame=createElement("div","top-pins-chart-frame"),buttons=[];
  let selected="outboundClicks";
  const renderChart=()=>{const metric=topPinsMetrics.find(item=>item.key===selected)??topPinsMetrics[3],reference=topPinsAccountRate(account,topPins,metric);for(const button of buttons)button.setAttribute("aria-pressed",String(button.dataset.topPinsMetric===metric.key));if(metric.rate){if(reference){const items=[createElement("p","top-pins-account-reference-copy","Same-period organic account rate shown for descriptive context only; it is not a target."),createElement("p","top-pins-account-reference-value",`Account 30-day rate: ${observedRateValue(reference.value)}`)];if(reference.stale)items.push(createElement("p","top-pins-account-reference-stale","Retained same-period account reference; data may be stale."));context.replaceChildren(...items)}else context.replaceChildren(createElement("p","top-pins-account-reference-unavailable","Same-period account rate unavailable."))}else context.replaceChildren();const copied=rows.slice(0,25).map(row=>Object.freeze({...row})),ordered=copied.map((row,index)=>({row,index})).sort((a,b)=>{const av=a.row[metric.key],bv=b.row[metric.key];if(av===null||bv===null)return av===bv?a.index-b.index:av===null?1:-1;return bv-av||a.index-b.index}).map(item=>item.row),usable=ordered.filter(row=>Number.isFinite(row[metric.key]));if(!usable.length){frame.replaceChildren(createElement("p","top-pins-chart-empty","No usable Top Pins values"));return}const width=Math.min(2000,Math.max(640,ordered.length*72+94)),height=300,left=70,right=24,top=30,baseline=242,plotWidth=width-left-right,plotHeight=baseline-top,scale=niceAxisScale(Math.max(0,...usable.map(row=>row[metric.key]),reference?.value??0),metric.rate),slot=plotWidth/ordered.length,barWidth=Math.min(28,Math.max(4,slot*.45)),svg=document.createElementNS(svgNamespace,"svg"),axisLine=(className,x1,y1,x2,y2)=>{const line=document.createElementNS(svgNamespace,"line");line.setAttribute("class",className);line.setAttribute("x1",String(x1));line.setAttribute("y1",String(y1));line.setAttribute("x2",String(x2));line.setAttribute("y2",String(y2));line.setAttribute("aria-hidden","true");return line},axisText=(className,x,y,anchor,value)=>{const text=document.createElementNS(svgNamespace,"text");text.setAttribute("class",className);text.setAttribute("x",String(x));text.setAttribute("y",String(y));text.setAttribute("text-anchor",anchor);text.textContent=value;return text},tickText=value=>metric.rate?`${value.toFixed(2)}%`:String(Math.round(value)),referenceText=reference?` Account 30-day rate: ${observedRateValue(reference.value)}.${reference.stale?" Retained same-period account reference; data may be stale.":""}`:"";svg.setAttribute("class","top-pins-chart");svg.setAttribute("viewBox",`0 0 ${width} ${height}`);svg.setAttribute("width",String(width));svg.setAttribute("height",String(height));svg.setAttribute("role","img");svg.setAttribute("aria-label",`${metric.label} Top Pins comparison from ${accountDay(window.startDate)} to ${accountDay(window.endDate)} with ${usable.length} usable values${metric.rate?" in percent":""}.${referenceText}`);svg.append(axisLine("top-pins-x-axis",left,baseline,width-right,baseline),axisLine("top-pins-y-axis",left,top,left,baseline));for(const value of scale.ticks){const y=baseline-plotHeight*value/scale.maximum;svg.append(axisLine("top-pins-tick",left-4,y,left,y),axisText("top-pins-tick-label",left-8,y+4,"end",tickText(value)))}svg.append(axisText("top-pins-y-label",left,16,"start",metric.rate?`${metric.label} (%)`:metric.label),axisText("top-pins-x-label",left+plotWidth/2,height-8,"middle","Pin rank"));if(reference){const y=baseline-plotHeight*reference.value/scale.maximum;svg.append(axisLine("top-pins-account-reference-line",left,y,width-right,y),axisText("top-pins-account-reference-label",width-right,Math.max(22,y-6),"end",`Account 30-day rate: ${observedRateValue(reference.value)}`))}ordered.forEach((row,index)=>{const value=Number.isFinite(row[metric.key])?row[metric.key]:null,barHeight=value===null?0:plotHeight*value/scale.maximum,center=left+slot*(index+.5),x=center-barWidth/2,y=baseline-barHeight,valueText=metric.rate?observedRateValue(value):dailyMetricValue(value),bar=document.createElementNS(svgNamespace,"rect"),label=document.createElementNS(svgNamespace,"text"),rank=document.createElementNS(svgNamespace,"text");bar.setAttribute("class","top-pins-bar");bar.setAttribute("x",String(x));bar.setAttribute("y",String(y));bar.setAttribute("width",String(barWidth));bar.setAttribute("height",String(barHeight));bar.setAttribute("role","img");bar.setAttribute("aria-label",`Rank ${row.rank}: ${metric.label}: ${valueText}`);label.setAttribute("class","top-pins-value-label");label.setAttribute("x",String(center));label.setAttribute("y",String(Math.max(22,y-6)));label.setAttribute("text-anchor","middle");label.textContent=valueText;rank.setAttribute("class","top-pins-rank-label");rank.setAttribute("x",String(center));rank.setAttribute("y",String(baseline+20));rank.setAttribute("text-anchor","middle");rank.textContent=`#${row.rank}`;svg.append(bar,label,rank)});frame.replaceChildren(svg)};
  for(const metric of topPinsMetrics){const button=createElement("button","top-pins-selector",metric.label);button.type="button";button.dataset.topPinsMetric=metric.key;button.onclick=()=>{selected=metric.key;renderChart()};buttons.push(button);selectors.append(button)}section.append(createElement("h3","","Top Pins comparison"),selectors,context,frame);renderChart();return section;
}

function topPinsContribution(account,topPins,sourceRows){
  const accountRetained=account&&(account.state==="Available"||account.stale)&&account.window&&account.totals,topPinsRetained=topPins&&(topPins.state==="Available"||topPins.state==="NoData"||topPins.stale)&&topPins.window;
  if(!accountRetained||!topPinsRetained)return null;
  const accountWindow=Object.freeze({startDate:account.window.startDate,endDate:account.window.endDate,completedDays:account.window.completedDays}),topPinsWindow=Object.freeze({startDate:topPins.window.startDate,endDate:topPins.window.endDate,completedDays:topPins.window.completedDays}),section=createElement("section","top-pins-contribution");
  section.append(createElement("h3","","Observed Top Pins contribution"),createElement("p","","Share of organic account totals represented by snapshot-matched Top Pins. Descriptive coverage only; not attribution or prediction."));
  if(account.stale||topPins.stale)section.append(createElement("p","top-pins-contribution-stale","Contribution uses retained stale account or Top Pins data."));
  if(accountWindow.completedDays!==30||topPinsWindow.completedDays!==30||accountWindow.startDate!==topPinsWindow.startDate||accountWindow.endDate!==topPinsWindow.endDate){section.append(createElement("p","top-pins-contribution-state","Top Pins contribution cannot be compared for different periods."));return section}
  const rows=Object.freeze(sourceRows.slice(0,25).map(item=>Object.freeze({impressions:item.impressions,saves:item.saves,pinClicks:item.pinClicks,outboundClicks:item.outboundClicks})));
  if(!rows.length){section.append(createElement("p","top-pins-contribution-state","No snapshot-matched Top Pins are available for contribution comparison."));return section}
  section.append(createElement("p","top-pins-contribution-period",`Shared period: ${accountDay(accountWindow.startDate)} – ${accountDay(accountWindow.endDate)} · 30 completed UTC days`),createElement("p","top-pins-contribution-count",`Snapshot-matched Top Pins used: ${rows.length}`));
  const wrapper=createElement("div","top-pins-contribution-table-wrap"),table=createElement("table","top-pins-contribution-table"),head=createElement("thead"),headingRow=createElement("tr"),body=createElement("tbody");
  for(const label of ["Metric","Snapshot Top Pins","Account total","Observed share"]){const cell=createElement("th","",label);cell.setAttribute("scope","col");headingRow.append(cell)}head.append(headingRow);
  for(const metric of topPinsContributionMetrics){const accountTotal=account.totals[metric.key],values=rows.map(item=>item[metric.key]);let topPinsTotal=0,valid=Number.isSafeInteger(accountTotal)&&accountTotal>=0&&values.every(value=>Number.isSafeInteger(value)&&value>=0);if(valid){for(const value of values){if(topPinsTotal>Number.MAX_SAFE_INTEGER-value){valid=false;break}topPinsTotal+=value}}const share=valid&&accountTotal>0&&topPinsTotal<=accountTotal?topPinsTotal/accountTotal*100:null,row=createElement("tr");row.append(createElement("th","",metric.label),createElement("td","",valid?String(topPinsTotal):"—"),createElement("td","",valid?String(accountTotal):"—"),createElement("td","",share===null?"—":`${share.toFixed(2)}%`));row.children[0].setAttribute("scope","row");body.append(row)}
  table.append(head,body);wrapper.append(table);section.append(wrapper);return section;
}

const topPinsReadinessText=value=>value?.status==="Ready"?"Content ready":value?.status==="NeedsAttention"?`Content needs attention (${value.issueCount})`:"Content readiness unavailable";
const topPinsReadinessClass=value=>value?.status==="Ready"?"ready":value?.status==="NeedsAttention"?"warning":"neutral";

function topPinsReadinessControl(value,activate){
  const needsAttention=value?.status==="NeedsAttention",control=createElement(needsAttention?"button":"span",`state top-pins-readiness-status ${topPinsReadinessClass(value)}${needsAttention?" top-pins-readiness-action":""}`,topPinsReadinessText(value));
  if(needsAttention){control.type="button";control.setAttribute("aria-label","Show Top Pins that need content attention");control.onclick=activate}
  return control;
}

function topPinsReadinessDetailsControl(value,details,rank,expanded,activate){
  if(value?.status!=="NeedsAttention")return null;
  if(!details)return createElement("span","top-pins-readiness-details-unavailable","Readiness details unavailable.");
  const id=`top-pins-readiness-details-${rank}`,container=createElement("div","top-pins-readiness-details-control"),button=createElement("button","top-pins-readiness-details-action","View readiness details"),region=createElement("div","top-pins-readiness-details");
  button.type="button";button.setAttribute("aria-expanded",String(expanded));button.setAttribute("aria-controls",id);button.onclick=activate;
  region.id=id;region.hidden=!expanded;region.setAttribute("aria-label",`Content readiness details for endpoint rank ${rank}`);
  for(const message of details.required.slice(0,12))region.append(createElement("div","top-pins-readiness-detail required",`Required: ${message}`));
  for(const message of details.review.slice(0,12-details.required.length))region.append(createElement("div","top-pins-readiness-detail review",`Review: ${message}`));
  container.append(button,region);return container;
}

function syncTopPinsTableSession(result){
  if(topPinsTableSession.result===result)return;
  const retainedStale=topPinsTableSession.result!==null&&result?.stale===true&&Array.isArray(result.pins)&&result.pins.length>0;
  const expandedRank=retainedStale&&Number.isSafeInteger(topPinsTableSession.expandedRank)&&topPinsTableSession.expandedRank>0&&topPinsTableSession.expandedRank<=Math.min(25,result.pins.length)?topPinsTableSession.expandedRank:null;
  const selectedOrders=retainedStale?topPinsReviewSelection(topPinsTableSession.selectedOrders,Math.min(25,result.pins.length)):Object.freeze([]);
  topPinsTableSession=retainedStale?{...topPinsTableSession,result,expandedRank,selectedOrders}:{result,filter:"all",sort:{key:"rank",direction:"ascending"},expandedRank:null,selectedOrders:Object.freeze([])};
}

function topPinsReviewSelection(value,rowCount){
  const limit=Math.min(25,Number.isSafeInteger(rowCount)&&rowCount>0?rowCount:0),seen=new Set(),accepted=[];
  for(const item of Array.isArray(value)?value:[]){if(!Number.isSafeInteger(item)||item<0||item>=limit||seen.has(item))continue;seen.add(item);accepted.push(item)}
  return Object.freeze(accepted.sort((left,right)=>left-right).slice(0,25));
}

function topPinsTable(sourceRows,account,topPins){
  const section=createElement("section","top-pins-table-section"),context=topPinsOutboundContext(account,topPins),contextCopy=createElement("p","top-pins-outbound-context",context?`Same-period account outbound click rate: ${observedRateValue(context.accountRate)}. Differences are percentage points and descriptive only.`:"Same-period account outbound click rate unavailable."),wrapper=createElement("div","top-pins-table-wrap"),table=createElement("table","top-pins-table"),head=createElement("thead"),body=createElement("tbody");if(context){contextCopy.setAttribute("aria-label",`${contextCopy.textContent} Shared 30-day UTC period: ${accountDay(context.startDate)} – ${accountDay(context.endDate)}.`)}section.append(contextCopy);if(context?.stale)section.append(createElement("p","top-pins-outbound-context-stale","Retained same-period account context; data may be stale."));const rows=sourceRows.slice(0,25).flatMap((item,sourceOrder)=>item&&typeof item==="object"?[Object.freeze({...item,sourceOrder,outboundVsAccount:topPinsOutboundDifference(item,context)})]:[]);
  const ready=rows.filter(item=>item.contentReadiness?.status==="Ready").length,attention=rows.filter(item=>item.contentReadiness?.status==="NeedsAttention").length,unavailable=rows.length-ready-attention,summary=createElement("p","top-pins-readiness-summary",`Snapshot-matched Top Pins content readiness: ${ready} ready · ${attention} need attention · ${unavailable} unavailable.`);
  const needsAttention=item=>item.contentReadiness?.status==="NeedsAttention",belowAccount=item=>typeof item.outboundVsAccount==="number"&&Number.isFinite(item.outboundVsAccount)&&item.outboundVsAccount<0;
  const filterDefinitions=Object.freeze([
    {key:"all",label:"All",matches:()=>true},
    {key:"attention",label:"Content needs attention",matches:needsAttention},
    {key:"below",label:"Below account outbound rate",matches:belowAccount},
    {key:"both",label:"Both signals",matches:item=>needsAttention(item)&&belowAccount(item)},
    {key:"selected",label:"Selected for review",matches:item=>item.manuallySelected},
  ].map(filter=>Object.freeze(filter)));
  const controls=createElement("div","top-pins-filter-control"),label=createElement("span","top-pins-filter-label","Show Top Pins:"),buttons=createElement("div","top-pins-filter-buttons"),filterButtons=[],selectionSummary=createElement("p","top-pins-review-summary"),selectionActions=createElement("div","top-pins-review-actions"),resultCount=createElement("p","top-pins-filter-result"),empty=createElement("p","top-pins-filter-empty","No Top Pins match this local filter.");
  controls.setAttribute("role","group");controls.setAttribute("aria-label","Show Top Pins");selectionSummary.setAttribute("aria-live","polite");resultCount.setAttribute("aria-live","polite");empty.setAttribute("aria-live","polite");
  const renderTable=()=>{
    const selectedOrders=topPinsReviewSelection(topPinsTableSession.selectedOrders,rows.length),selectedSet=new Set(selectedOrders),derivedRows=rows.map(item=>Object.freeze({...item,manuallySelected:selectedSet.has(item.sourceOrder)})),filters=filterDefinitions.map(filter=>Object.freeze({...filter,count:derivedRows.filter(filter.matches).length})),selected=filters.find(filter=>filter.key===topPinsTableSession.filter)??filters[0],column=topPinsColumns.find(item=>item.key===topPinsTableSession.sort.key)??topPinsColumns[0],filtered=derivedRows.filter(selected.matches),renderedRows=stableTopPinsRows(filtered.slice(),column,topPinsTableSession.sort.direction);
    for(const button of filterButtons){const filter=filters.find(item=>item.key===button.dataset.topPinsFilter);button.textContent=`${filter.label} (${filter.count})`;button.setAttribute("aria-pressed",String(filter.key===selected.key))}
    selectionSummary.textContent=`Manually selected for review: ${selectedOrders.length} of ${rows.length} snapshot-matched Top Pins.`;selectionActions.replaceChildren();if(selectedOrders.length){const clear=createElement("button","top-pins-review-clear","Clear review selection");clear.type="button";clear.onclick=()=>{topPinsTableSession={...topPinsTableSession,selectedOrders:Object.freeze([])};renderTable()};selectionActions.append(clear)}
    resultCount.textContent=`Showing ${renderedRows.length} of ${rows.length} snapshot-matched Top Pins.`;empty.textContent=selected.key==="selected"?"No Top Pins are selected for review.":"No Top Pins match this local filter.";empty.hidden=renderedRows.length!==0;
    const header=createElement("tr");
    for(const item of topPinsColumns){const cell=createElement("th"),button=createElement("button","top-pins-sort"),indicator=createElement("span","top-pins-sort-indicator");cell.setAttribute("scope","col");const active=topPinsTableSession.sort.key===item.key;cell.setAttribute("aria-sort",active?topPinsTableSession.sort.direction:"none");button.type="button";button.dataset.topPinsSort=item.key;button.append(createElement("span","",item.label),indicator);indicator.setAttribute("aria-hidden","true");if(active)indicator.textContent=topPinsTableSession.sort.direction==="ascending"?"▲":"▼";button.onclick=()=>{const direction=active?(topPinsTableSession.sort.direction==="ascending"?"descending":"ascending"):(item.type==="text"?"ascending":"descending");topPinsTableSession={...topPinsTableSession,sort:{key:item.key,direction}};renderTable()};cell.append(button);header.append(cell)}
    const rendered=renderedRows.map(item=>{const row=createElement("tr"),pinCell=createElement("td"),reviewControl=createElement("div","top-pins-review-control"),reviewToggle=createElement("button","top-pins-review-toggle",item.manuallySelected?"Remove from review":"Select for review"),statusLine=createElement("div","top-pins-readiness-line"),detailsControl=topPinsReadinessDetailsControl(item.contentReadiness,item.contentReadinessDetails,item.rank,topPinsTableSession.expandedRank===item.rank,()=>{topPinsTableSession={...topPinsTableSession,expandedRank:topPinsTableSession.expandedRank===item.rank?null:item.rank};renderTable()});
    reviewToggle.type="button";reviewToggle.setAttribute("aria-pressed",String(item.manuallySelected));reviewToggle.setAttribute("aria-label",item.manuallySelected?`Remove ${item.title} from manual review`:`Select ${item.title} for manual review`);reviewToggle.onclick=()=>{const current=topPinsReviewSelection(topPinsTableSession.selectedOrders,rows.length),next=item.manuallySelected?current.filter(value=>value!==item.sourceOrder):current.includes(item.sourceOrder)?current:[...current,item.sourceOrder];topPinsTableSession={...topPinsTableSession,selectedOrders:topPinsReviewSelection(next,rows.length)};renderTable()};reviewControl.append(reviewToggle);if(item.manuallySelected)reviewControl.append(createElement("span","top-pins-review-selected","Selected for review"));statusLine.append(topPinsReadinessControl(item.contentReadiness,()=>{topPinsTableSession={...topPinsTableSession,filter:"attention"};renderTable()}));if(detailsControl)statusLine.append(detailsControl);pinCell.append(createElement("div","top-pins-title",item.title),reviewControl,statusLine);row.append(createElement("td","",item.rank),pinCell,createElement("td","",item.boardName));for(const key of ["impressions","saves","pinClicks","outboundClicks"])row.append(createElement("td","",dailyMetricValue(item[key])));for(const key of ["saveRate","pinClickRate","outboundClickRate"])row.append(createElement("td","",observedRateValue(item[key])));row.append(createElement("td","",topPinsOutboundDifferenceValue(item.outboundVsAccount)));return row});
    head.replaceChildren(header);body.replaceChildren(...rendered);
  };
  for(const filter of filterDefinitions){const button=createElement("button","top-pins-filter",filter.label);button.type="button";button.dataset.topPinsFilter=filter.key;button.onclick=()=>{topPinsTableSession={...topPinsTableSession,filter:filter.key};renderTable()};filterButtons.push(button);buttons.append(button)}controls.append(label,buttons);renderTable();table.append(head,body);wrapper.append(table);section.append(summary,controls,createElement("p","top-pins-filter-copy","Local table filters use only the current snapshot. They do not score or recommend Pins."),createElement("p","top-pins-review-copy","Manual local selection only. Pins are not scored, recommended, edited, or saved."),selectionSummary,selectionActions,resultCount,empty,wrapper);return section;
}

function topPinsView(){
  const snapshot=connection.observation?.pins??[],result=connection.topPins,card=createElement("article","card pinterest-top-pins");
  syncTopPinsTableSession(result);
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
  const rows=[];
  for(const pin of (result?.pins??[]).slice(0,25))rows.push(Object.freeze({rank:rows.length+1,title:pin.title,boardName:pin.boardName,impressions:pin.impressions,saves:pin.saves,pinClicks:pin.pinClicks,outboundClicks:pin.outboundClicks,saveRate:observedRate(pin.saves,pin.impressions),pinClickRate:observedRate(pin.pinClicks,pin.impressions),outboundClickRate:observedRate(pin.outboundClicks,pin.impressions),contentReadiness:pin.contentReadiness,contentReadinessDetails:pin.contentReadinessDetails}));
  if(result?.window){const immutableRows=Object.freeze(rows.slice()),contributionRows=Object.freeze(immutableRows.map(item=>Object.freeze({impressions:item.impressions,saves:item.saves,pinClicks:item.pinClicks,outboundClicks:item.outboundClicks}))),account=connection.accountPerformance,contributionAccount=Object.freeze({state:account?.state,stale:account?.stale===true,window:account?.window?Object.freeze({startDate:account.window.startDate,endDate:account.window.endDate,completedDays:account.window.completedDays}):null,totals:account?.totals?Object.freeze({impressions:account.totals.impressions,saves:account.totals.saves,pinClicks:account.totals.pinClicks,outboundClicks:account.totals.outboundClicks}):null}),contributionTopPins=Object.freeze({state:result.state,stale:result.stale===true,window:Object.freeze({startDate:result.window.startDate,endDate:result.window.endDate,completedDays:result.window.completedDays})});if(rows.length)card.append(createElement("h3","","Observed rates"),createElement("p","quiet","Descriptive event ratios for the selected 30-day window. They are not predictions, conversion attribution, or causal analysis."),topPinsComparison(immutableRows,contributionAccount,contributionTopPins));const contribution=topPinsContribution(contributionAccount,contributionTopPins,contributionRows);if(contribution)card.append(contribution);if(rows.length)card.append(topPinsTable(immutableRows,contributionAccount,contributionTopPins))}
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
