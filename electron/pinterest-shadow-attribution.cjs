const path=require('node:path');
const fs=require('node:fs/promises');

const SHADOW_FILE='pinterest-shadow-decisions.json';
const SCHEDULER_FILE='pinterest-scheduler.json';
const PERFORMANCE_FILE='pinterest-performance.json';

function safeNumber(v){const n=Number(v);return Number.isFinite(n)?n:0;}
async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e?.code==='ENOENT')return fallback;throw e;}}
function scoreMetrics(m={}){const impressions=Math.max(0,safeNumber(m.impressions));if(!impressions)return 0;return Number((safeNumber(m.outboundClicks)/impressions*55+safeNumber(m.saves)/impressions*30+safeNumber(m.pinClicks)/impressions*15).toFixed(6));}
function latestPinMetrics(snapshots,pinId){for(let i=snapshots.length-1;i>=0;i--){const snap=snapshots[i],pin=Array.isArray(snap?.pins)?snap.pins.find(p=>String(p.id)===String(pinId)):null;if(pin)return{snapshotAt:snap.collectedAt||null,metrics:pin.metrics?.lifetime||{}};}return null;}
function createPinterestShadowAttribution(app){
 const stateDir=path.join(app.getPath('userData'),'state');
 const shadowPath=path.join(stateDir,SHADOW_FILE),schedulerPath=path.join(stateDir,SCHEDULER_FILE),performancePath=path.join(stateDir,PERFORMANCE_FILE);
 async function attribute(){
  const [shadow,scheduler,performance]=await Promise.all([
   readJson(shadowPath,{schemaVersion:1,decisions:[],updatedAt:null}),
   readJson(schedulerPath,{jobs:[]}),
   readJson(performancePath,{snapshots:[]})
  ]);
  const decisions=Array.isArray(shadow.decisions)?shadow.decisions:[],jobs=Array.isArray(scheduler.jobs)?scheduler.jobs:[],snapshots=Array.isArray(performance.snapshots)?performance.snapshots:[];
  let updated=0,eligible=0,matched=0;
  for(const job of jobs){
   if(String(job.environment||'').toLowerCase()!=='production'||job.status!=='Published'||!job.result?.pinId||!job.shadowDecisionId)continue;
   eligible++;
   const decision=decisions.find(d=>String(d.id)===String(job.shadowDecisionId));if(!decision)continue;
   const observed=latestPinMetrics(snapshots,job.result.pinId);if(!observed)continue;
   matched++;
   const nextOutcome={state:'OBSERVED',pinId:String(job.result.pinId),publishedAt:job.publishedAt||null,observedAt:observed.snapshotAt,metrics:observed.metrics,score:scoreMetrics(observed.metrics)};
   const before=JSON.stringify(decision.outcome||null),after=JSON.stringify(nextOutcome);if(before!==after){decision.outcome=nextOutcome;updated++;}
  }
  if(updated){shadow.updatedAt=new Date().toISOString();await fs.mkdir(stateDir,{recursive:true});const tmp=`${shadowPath}.tmp`;await fs.writeFile(tmp,JSON.stringify(shadow,null,2),{encoding:'utf8',mode:0o600});await fs.rename(tmp,shadowPath);}
  const attributed=decisions.filter(d=>d?.outcome?.state==='OBSERVED').length;
  const pending=decisions.filter(d=>!d?.outcome).length;
  return{state:'Attributed',updated,eligibleProductionPublications:eligible,matchedProductionPins:matched,attributedDecisions:attributed,pendingDecisions:pending,totalDecisions:decisions.length,productionRequired:true,message:eligible===0?'Waiting for production publications linked to shadow decisions. Sandbox Pins are intentionally excluded from outcome attribution.':'Outcome attribution evaluated.'};
 }
 async function status(){const shadow=await readJson(shadowPath,{schemaVersion:1,decisions:[],updatedAt:null}),decisions=Array.isArray(shadow.decisions)?shadow.decisions:[],attributed=decisions.filter(d=>d?.outcome?.state==='OBSERVED');return{state:'Connected',totalDecisions:decisions.length,attributedDecisions:attributed.length,pendingDecisions:decisions.length-attributed.length,latestOutcome:attributed[0]?.outcome||null,productionRequired:true};}
 return Object.freeze({attribute,status});
}
module.exports={createPinterestShadowAttribution,scoreMetrics,latestPinMetrics};