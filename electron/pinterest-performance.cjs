const path = require('node:path');
const fs = require('node:fs/promises');

const API_ROOT = 'https://api.pinterest.com/v5';
const RETENTION_DAYS = 365;

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

function metricValue(metrics, names) {
  for (const name of names) {
    const value = metrics?.[name];
    if (Number.isFinite(Number(value))) return Number(value);
  }
  return 0;
}

function normalizePinMetrics(pin = {}) {
  const metrics = pin.pin_metrics || pin.pin_stats || {};
  const lifetime = metrics.lifetime_metrics || metrics.all_time || metrics.lifetime || metrics;
  const ninety = metrics['90d'] || metrics.ninety_day || metrics.last_90_days || {};
  const pick = source => ({
    impressions: metricValue(source, ['IMPRESSION','IMPRESSION_1','impressions']),
    saves: metricValue(source, ['SAVE','SAVE_1','saves']),
    pinClicks: metricValue(source, ['PIN_CLICK','CLICKTHROUGH','pin_clicks']),
    outboundClicks: metricValue(source, ['OUTBOUND_CLICK','OUTBOUND_CLICK_1','outbound_clicks']),
    engagements: metricValue(source, ['ENGAGEMENT','ENGAGEMENT_1','engagements']),
  });
  return { lifetime: pick(lifetime), ninetyDay: pick(ninety) };
}

function createPinterestPerformanceCollector(app, getAccessToken) {
  const stateDir = path.join(app.getPath('userData'), 'state');
  const historyPath = path.join(stateDir, 'pinterest-performance.json');

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
    const cutoff=Date.now()-RETENTION_DAYS*86400000;
    const next={schemaVersion:1,snapshots:history.snapshots.filter(s=>Date.parse(s.collectedAt)>=cutoff),updatedAt:new Date().toISOString()};
    const tmp=`${historyPath}.tmp`;
    await fs.writeFile(tmp,JSON.stringify(next,null,2),{encoding:'utf8',mode:0o600});
    await fs.rename(tmp,historyPath);
    return next;
  }

  async function fetchPinsWithMetrics(accessToken) {
    const items=[]; let bookmark; let pages=0; let rateLimit;
    do {
      const params=new URLSearchParams({page_size:'100',pin_metrics:'true'});
      if(bookmark)params.set('bookmark',bookmark);
      const response=await timedFetch(`${API_ROOT}/pins?${params}`,{headers:{Authorization:`Bearer ${accessToken}`,Accept:'application/json'}});
      let payload; try{payload=await response.json();}catch{payload={};}
      if(!response.ok){const error=new Error(`Pinterest analytics request returned HTTP ${response.status}.`);error.state=classify(response.status);error.statusCode=response.status;throw error;}
      pages+=1; if(Array.isArray(payload.items))items.push(...payload.items); bookmark=payload.bookmark||undefined;
      rateLimit={limit:response.headers.get('x-ratelimit-limit')||undefined,remaining:response.headers.get('x-ratelimit-remaining')||undefined,reset:response.headers.get('x-ratelimit-reset')||undefined};
    } while(bookmark&&pages<100);
    return {items,pages,complete:!bookmark,rateLimit};
  }

  async function collect() {
    try {
      const accessToken=await getAccessToken();
      if(!accessToken)return{state:'Authentication Required',message:'Pinterest does not have a usable production read token.'};
      const result=await fetchPinsWithMetrics(accessToken);
      const collectedAt=new Date().toISOString();
      const pins=result.items.map(pin=>({id:pin.id,title:pin.title||'',boardId:pin.board_id,createdAt:pin.created_at,link:pin.link||'',metrics:normalizePinMetrics(pin)}));
      const snapshot={collectedAt,pinCount:pins.length,pages:result.pages,complete:result.complete,pins};
      const history=await readHistory(); history.snapshots.push(snapshot); const stored=await writeHistory(history);
      return{state:'Collected',collectedAt,pinCount:pins.length,pages:result.pages,complete:result.complete,historySnapshots:stored.snapshots.length,retentionDays:RETENTION_DAYS,rateLimit:result.rateLimit,pins};
    } catch(error) {
      return{state:error?.state||'Unavailable',statusCode:error?.statusCode,message:error?.name==='AbortError'?'Pinterest performance request timed out.':(error?.message||'Pinterest performance could not be collected.')};
    }
  }

  async function history() {
    const stored=await readHistory();
    const latest=stored.snapshots.at(-1)||null;
    return{state:'Connected',snapshotCount:stored.snapshots.length,updatedAt:stored.updatedAt,latest,retentionDays:RETENTION_DAYS};
  }

  return Object.freeze({collect,history});
}

module.exports={createPinterestPerformanceCollector,normalizePinMetrics,RETENTION_DAYS};
