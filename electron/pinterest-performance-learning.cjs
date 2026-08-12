const path=require('node:path');
const fs=require('node:fs/promises');

const PERFORMANCE_FILE='pinterest-performance.json';
const ACCOUNT_FILE='pinterest-account-analytics.json';
const MIN_IMPRESSIONS=25;
const MIN_SAMPLES_PER_BUCKET=2;

function safeNumber(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function readJson(file){return fs.readFile(file,'utf8').then(JSON.parse).catch(e=>{if(e?.code==='ENOENT')return null;throw e;});}
function metricScore(metrics={}){
  const impressions=Math.max(0,safeNumber(metrics.impressions));
  const saves=Math.max(0,safeNumber(metrics.saves));
  const pinClicks=Math.max(0,safeNumber(metrics.pinClicks));
  const outboundClicks=Math.max(0,safeNumber(metrics.outboundClicks));
  if(impressions<MIN_IMPRESSIONS)return null;
  const saveRate=saves/impressions;
  const pinClickRate=pinClicks/impressions;
  const outboundRate=outboundClicks/impressions;
  return Number(((outboundRate*55)+(saveRate*30)+(pinClickRate*15)).toFixed(6));
}
function localParts(value){const d=new Date(value);if(Number.isNaN(d.getTime()))return null;return{hour:d.getHours(),day:d.getDay()};}
function aggregate(entries,keyFn){const map=new Map();for(const e of entries){const key=keyFn(e);if(key===null||key===undefined)continue;const a=map.get(key)||{key,samples:0,scoreSum:0,impressions:0,outboundClicks:0,saves:0,pinClicks:0};a.samples++;a.scoreSum+=e.score;a.impressions+=e.impressions;a.outboundClicks+=e.outboundClicks;a.saves+=e.saves;a.pinClicks+=e.pinClicks;map.set(key,a);}return[...map.values()].map(a=>({...a,averageScore:Number((a.scoreSum/a.samples).toFixed(6)),eligible:a.samples>=MIN_SAMPLES_PER_BUCKET})).sort((a,b)=>Number(a.key)-Number(b.key));}
function normalizeLatestPerformance(history){const latest=history?.snapshots?.at?.(-1)||history?.snapshots?.[history.snapshots.length-1];const pins=Array.isArray(latest?.pins)?latest.pins:[];const entries=[];for(const pin of pins){const metrics=pin?.metrics?.lifetime||{};const score=metricScore(metrics);const parts=localParts(pin.createdAt);if(score===null||!parts)continue;entries.push({pinId:pin.id,title:pin.title||'',boardId:pin.boardId||null,createdAt:pin.createdAt,hour:parts.hour,day:parts.day,score,impressions:safeNumber(metrics.impressions),outboundClicks:safeNumber(metrics.outboundClicks),saves:safeNumber(metrics.saves),pinClicks:safeNumber(metrics.pinClicks)});}return{latest,entries};}
function accountTrend(history){const snapshots=Array.isArray(history?.snapshots)?history.snapshots:[];const latestByWindow={};for(const s of snapshots){const days=Number(s?.windowDays);if([30,60,90].includes(days))latestByWindow[days]=s;}const thirty=latestByWindow[30];return{available:Boolean(thirty),windowDays:thirty?.windowDays||null,metrics:thirty?.metrics||null,collectedAt:thirty?.collectedAt||null};}
function buildModel(performanceHistory,accountHistory){const normalized=normalizeLatestPerformance(performanceHistory||{}),entries=normalized.entries;const hourly=aggregate(entries,e=>e.hour),weekday=aggregate(entries,e=>e.day);const eligibleHours=hourly.filter(x=>x.eligible).sort((a,b)=>b.averageScore-a.averageScore||b.samples-a.samples);const eligibleDays=weekday.filter(x=>x.eligible).sort((a,b)=>b.averageScore-a.averageScore||b.samples-a.samples);return{state:entries.length?'Learning':'Insufficient Data',mode:'READ_ONLY',generatedAt:new Date().toISOString(),sourceSnapshotAt:normalized.latest?.collectedAt||null,samplePins:entries.length,minImpressions:MIN_IMPRESSIONS,minSamplesPerBucket:MIN_SAMPLES_PER_BUCKET,performanceSignals:entries.length>0,hourly,weekday,bestHours:eligibleHours.slice(0,5),bestDays:eligibleDays.slice(0,3),accountTrend:accountTrend(accountHistory||{}),weights:{outboundClickRate:0.55,saveRate:0.30,pinClickRate:0.15},notes:['No scheduler decisions are changed by this model yet.','Pins below the minimum impression threshold are excluded to reduce noise.']};}
function createPinterestPerformanceLearning(app){const stateDir=path.join(app.getPath('userData'),'state');async function model(){const[performanceHistory,accountHistory]=await Promise.all([readJson(path.join(stateDir,PERFORMANCE_FILE)),readJson(path.join(stateDir,ACCOUNT_FILE))]);return buildModel(performanceHistory||{},accountHistory||{});}return Object.freeze({model});}

module.exports={createPinterestPerformanceLearning,buildModel,metricScore,MIN_IMPRESSIONS,MIN_SAMPLES_PER_BUCKET};