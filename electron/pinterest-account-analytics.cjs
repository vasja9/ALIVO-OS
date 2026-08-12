const path = require('node:path');
const fs = require('node:fs/promises');

const API_ROOT = 'https://api.pinterest.com/v5';
const RETENTION_DAYS = 365;
const MAX_LOOKBACK_DAYS = 90;
const DEFAULT_WINDOW_DAYS = 30;
const METRICS = ['IMPRESSION','ENGAGEMENT','PIN_CLICK','OUTBOUND_CLICK','SAVE'];

function classify(status) {
  if (status === 401) return 'Authentication Required';
  if (status === 403) return 'Permission Denied';
  if (status === 429) return 'Rate Limited';
  return status >= 500 ? 'Unavailable' : 'Provider Error';
}

async function timedFetch(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

function normalizeKey(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function isoDate(date) { return new Date(date).toISOString().slice(0,10); }
function windowDates(days = DEFAULT_WINDOW_DAYS) {
  const bounded = Math.max(1, Math.min(MAX_LOOKBACK_DAYS, Number(days) || DEFAULT_WINDOW_DAYS));
  const end = new Date();
  const start = new Date(end.getTime() - (bounded - 1) * 86400000);
  return { days: bounded, startDate: isoDate(start), endDate: isoDate(end) };
}

function numericMetric(source, aliases) {
  if (!source || typeof source !== 'object') return undefined;
  const wanted = new Set(aliases.map(normalizeKey));
  for (const [key, value] of Object.entries(source)) {
    if (wanted.has(normalizeKey(key)) && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function collectMetricObjects(value, output = []) {
  if (!value || typeof value !== 'object') return output;
  if (Array.isArray(value)) { for (const item of value) collectMetricObjects(item, output); return output; }
  const keys = Object.keys(value).map(normalizeKey);
  if (keys.some(key => ['impression','impressions','engagement','engagements','pinclick','pinclicks','outboundclick','outboundclicks','save','saves'].includes(key))) output.push(value);
  for (const child of Object.values(value)) if (child && typeof child === 'object') collectMetricObjects(child, output);
  return output;
}

function normalizeAnalytics(payload = {}) {
  const rows = collectMetricObjects(payload);
  const totals = { impressions:0, engagements:0, pinClicks:0, outboundClicks:0, saves:0 };
  const aliases = {
    impressions:['IMPRESSION','IMPRESSIONS'], engagements:['ENGAGEMENT','ENGAGEMENTS'], pinClicks:['PIN_CLICK','PIN_CLICKS','PINCLICK'], outboundClicks:['OUTBOUND_CLICK','OUTBOUND_CLICKS','CLICKTHROUGH'], saves:['SAVE','SAVES']
  };
  for (const row of rows) {
    for (const [key, names] of Object.entries(aliases)) {
      const value = numericMetric(row, names);
      if (value !== undefined) totals[key] += value;
    }
  }
  return { totals, rowsFound: rows.length };
}

function createPinterestAccountAnalyticsCollector(app, getAccessToken) {
  const stateDir = path.join(app.getPath('userData'), 'state');
  const historyPath = path.join(stateDir, 'pinterest-account-analytics.json');

  async function readHistory() {
    try {
      const parsed = JSON.parse(await fs.readFile(historyPath, 'utf8'));
      return { schemaVersion:1, snapshots:Array.isArray(parsed.snapshots)?parsed.snapshots:[], updatedAt:parsed.updatedAt||null };
    } catch (error) {
      if (error?.code === 'ENOENT') return { schemaVersion:1, snapshots:[], updatedAt:null };
      throw error;
    }
  }

  async function writeHistory(history) {
    await fs.mkdir(stateDir,{recursive:true});
    const cutoff = Date.now() - RETENTION_DAYS * 86400000;
    const next = { schemaVersion:1, snapshots:history.snapshots.filter(s=>Date.parse(s.collectedAt)>=cutoff), updatedAt:new Date().toISOString() };
    const tmp = `${historyPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next,null,2), {encoding:'utf8',mode:0o600});
    await fs.rename(tmp, historyPath);
    return next;
  }

  async function request(days = DEFAULT_WINDOW_DAYS) {
    const accessToken = await getAccessToken();
    if (!accessToken) return { state:'Authentication Required', message:'Pinterest does not have a usable production read token.' };
    const range = windowDates(days);
    const params = new URLSearchParams({
      start_date:range.startDate,
      end_date:range.endDate,
      from_claimed_content:'BOTH',
      pin_format:'ALL',
      app_types:'ALL',
      content_type:'ALL',
      source:'ALL',
      split_field:'NO_SPLIT',
    });
    for (const metric of METRICS) params.append('metric_types', metric);
    const response = await timedFetch(`${API_ROOT}/user_account/analytics?${params.toString()}`, { headers:{Authorization:`Bearer ${accessToken}`,Accept:'application/json'} });
    let payload; try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) { const error=new Error(`Pinterest account analytics returned HTTP ${response.status}.`); error.state=classify(response.status); error.statusCode=response.status; error.payload=payload; throw error; }
    return { state:'Fetched', range, payload, rateLimit:{limit:response.headers.get('x-ratelimit-limit')||undefined,remaining:response.headers.get('x-ratelimit-remaining')||undefined,reset:response.headers.get('x-ratelimit-reset')||undefined} };
  }

  async function collect(days = DEFAULT_WINDOW_DAYS) {
    try {
      const result = await request(days);
      if (result.state !== 'Fetched') return result;
      const normalized = normalizeAnalytics(result.payload);
      const snapshot = { collectedAt:new Date().toISOString(), windowDays:result.range.days, startDate:result.range.startDate, endDate:result.range.endDate, metrics:normalized.totals, rowsFound:normalized.rowsFound };
      const history = await readHistory(); history.snapshots.push(snapshot); const stored = await writeHistory(history);
      return { state:'Collected', ...snapshot, historySnapshots:stored.snapshots.length, retentionDays:RETENTION_DAYS, rateLimit:result.rateLimit };
    } catch (error) {
      return { state:error?.state||'Unavailable', statusCode:error?.statusCode, message:error?.name==='AbortError'?'Pinterest account analytics request timed out.':(error?.message||'Pinterest account analytics could not be collected.') };
    }
  }

  async function history() {
    const stored = await readHistory();
    return { state:'Connected', snapshotCount:stored.snapshots.length, updatedAt:stored.updatedAt, latest:stored.snapshots.at(-1)||null, retentionDays:RETENTION_DAYS, maxLookbackDays:MAX_LOOKBACK_DAYS };
  }

  return Object.freeze({ collect, history });
}

module.exports = { createPinterestAccountAnalyticsCollector, normalizeAnalytics, windowDates, RETENTION_DAYS, MAX_LOOKBACK_DAYS, DEFAULT_WINDOW_DAYS, METRICS };
