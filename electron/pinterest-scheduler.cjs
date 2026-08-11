const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');

const DEFAULT_INTERVAL_MINUTES = 90;
const MIN_INTERVAL_MINUTES = 30;
const MAX_INTERVAL_MINUTES = 600;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_MINUTES = 5;
const DEFAULT_TIMING_HORIZON_HOURS = 48;
const STATES = new Set(['Scheduled','Publishing','Retry Scheduled','Published','Failed','Cancelled']);

function createPinterestScheduler(app, publisher, options = {}) {
  const stateDir = path.join(app.getPath('userData'), 'state');
  const queuePath = path.join(stateDir, 'pinterest-scheduler.json');
  const tickMs = Number(options.tickMs || 30000);
  const defaultIntervalMinutes = Number(options.defaultIntervalMinutes || DEFAULT_INTERVAL_MINUTES);
  const maxAttempts = Number(options.maxAttempts || DEFAULT_MAX_ATTEMPTS);
  const retryMinutes = Number(options.retryMinutes || DEFAULT_RETRY_MINUTES);
  let timer; let running = false; let executionLock = false;

  async function readState() {
    try {
      const data = JSON.parse(await fs.readFile(queuePath, 'utf8'));
      return { schemaVersion:4, enabled:data.enabled === true, environment:'sandbox', defaultIntervalMinutes:Number(data.defaultIntervalMinutes || defaultIntervalMinutes), maxAttempts:Number(data.maxAttempts || maxAttempts), retryMinutes:Number(data.retryMinutes || retryMinutes), timingMode:data.timingMode==='adaptive'?'adaptive':'cadence', jobs:Array.isArray(data.jobs)?data.jobs:[], history:Array.isArray(data.history)?data.history:[], updatedAt:data.updatedAt || null };
    } catch (error) {
      if (error?.code === 'ENOENT') return { schemaVersion:4, enabled:false, environment:'sandbox', defaultIntervalMinutes, maxAttempts, retryMinutes, timingMode:'cadence', jobs:[], history:[], updatedAt:null };
      throw error;
    }
  }
  async function writeState(state) { await fs.mkdir(stateDir,{recursive:true}); const next={...state,schemaVersion:4,environment:'sandbox',updatedAt:new Date().toISOString()}; const tmp=`${queuePath}.tmp`; await fs.writeFile(tmp,JSON.stringify(next,null,2),{encoding:'utf8',mode:0o600}); await fs.rename(tmp,queuePath); return next; }
  function sanitizePin(input={}) { return { boardName:String(input.boardName||'').trim(), title:String(input.title||'').trim(), description:String(input.description||'').trim(), link:String(input.link||'').trim(), imageUrl:String(input.imageUrl||'').trim(), altText:String(input.altText||input.title||'').trim() }; }
  function isActive(job){ return ['Scheduled','Retry Scheduled','Publishing'].includes(job.status); }
  function publicationTime(job){ return Date.parse(job.nextAttemptAt || job.scheduledFor); }
  function activeJobs(state, excludeJobId){ return state.jobs.filter(job=>isActive(job)&&job.id!==excludeJobId&&Number.isFinite(publicationTime(job))).sort((a,b)=>publicationTime(a)-publicationTime(b)); }
  function conflictFor(state, requested, excludeJobId){ const spacingMs=Number(state.defaultIntervalMinutes||defaultIntervalMinutes)*60000; return activeJobs(state,excludeJobId).find(job=>Math.abs(publicationTime(job)-requested)<spacingMs); }
  function calculateNextSlot(state, from=Date.now(), excludeJobId){ const spacingMs=Number(state.defaultIntervalMinutes||defaultIntervalMinutes)*60000; let candidate=Math.max(Number(from)||Date.now(),Date.now()); const jobs=activeJobs(state,excludeJobId); for(const job of jobs){ const t=publicationTime(job); if(Math.abs(t-candidate)<spacingMs) candidate=t+spacingMs; } let conflict; do { conflict=jobs.find(job=>Math.abs(publicationTime(job)-candidate)<spacingMs); if(conflict) candidate=publicationTime(conflict)+spacingMs; } while(conflict); return new Date(candidate).toISOString(); }

  // 005E-B foundation: timing candidates are scored independently from queue safety.
  // Today the score uses transparent local-time priors only; future Pinterest performance
  // signals can replace/augment these priors without changing scheduler/publisher contracts.
  function timingPrior(date){ const hour=date.getHours(),day=date.getDay(); let score=0; if(hour>=18&&hour<=22)score+=30; else if(hour>=11&&hour<=14)score+=20; else if(hour>=7&&hour<=10)score+=12; else if(hour>=23||hour<=5)score-=18; if(day===0||day===6)score+=5; return score; }
  function candidateTimes(state, from=Date.now(), excludeJobId){ const cadence=Number(state.defaultIntervalMinutes||defaultIntervalMinutes),step=Math.max(15,Math.min(cadence,60)),start=Math.max(Number(from)||Date.now(),Date.now()),end=start+DEFAULT_TIMING_HORIZON_HOURS*60*60000,candidates=[]; for(let t=start;t<=end;t+=step*60000){if(!conflictFor(state,t,excludeJobId))candidates.push(t);} return candidates; }
  function chooseAutomaticSlot(state, from=Date.now(), excludeJobId){ const candidates=candidateTimes(state,from,excludeJobId); if(!candidates.length)return{scheduledFor:calculateNextSlot(state,from,excludeJobId),score:null,reason:'First cadence-safe slot'}; if(state.timingMode!=='adaptive')return{scheduledFor:new Date(candidates[0]).toISOString(),score:null,reason:'First cadence-safe slot'}; const start=Math.max(Number(from)||Date.now(),Date.now()); const ranked=candidates.map(t=>{const delayHours=(t-start)/3600000;return{t,score:timingPrior(new Date(t))-Math.min(24,delayHours*.75)};}).sort((a,b)=>b.score-a.score||a.t-b.t); const best=ranked[0]; return{scheduledFor:new Date(best.t).toISOString(),score:Number(best.score.toFixed(2)),reason:'Adaptive local-time prior'}; }

  async function recoverInterrupted(state){ let changed=false; const now=new Date(); for(const job of state.jobs){ if(job.status!=='Publishing') continue; job.status='Retry Scheduled'; job.nextAttemptAt=now.toISOString(); job.recoveredAt=now.toISOString(); job.error='Recovered after ALIVO OS stopped while this job was publishing.'; state.history.unshift({jobId:job.id,status:'Recovered',at:now.toISOString(),message:job.error,title:job.pin?.title}); changed=true; } if(changed){state.history=state.history.slice(0,500); await writeState(state);} return changed; }

  async function nextSlot(from){ const state=await readState(); await recoverInterrupted(state); const fresh=await readState(); const decision=chooseAutomaticSlot(fresh,from); return {state:'Next Slot',scheduledFor:decision.scheduledFor,defaultIntervalMinutes:fresh.defaultIntervalMinutes,timingMode:fresh.timingMode,timingScore:decision.score,timingReason:decision.reason}; }
  async function schedule(input={}){
    const pin=sanitizePin(input.pin||input); if(!pin.boardName||!pin.title||!pin.link||!pin.imageUrl) return {state:'Configuration Invalid',message:'Board name, title, destination URL and image URL are required.'};
    const state=await readState(); await recoverInterrupted(state); const fresh=await readState(); let scheduledFor,timingDecision=null;
    if(input.autoNextSlot===true||input.autoTiming===true){timingDecision=chooseAutomaticSlot(fresh,input.scheduledFor?Date.parse(input.scheduledFor):Date.now());scheduledFor=new Date(timingDecision.scheduledFor);}else scheduledFor=new Date(input.scheduledFor||Date.now());
    if(Number.isNaN(scheduledFor.getTime())) return {state:'Configuration Invalid',message:'A valid scheduled time is required.'};
    const requested=scheduledFor.getTime(); const conflict=conflictFor(fresh,requested); if(conflict) return {state:'Cadence Conflict',message:`Another active Pinterest job is within the ${fresh.defaultIntervalMinutes}-minute publication interval.`,conflictJobId:conflict.id,conflictAt:conflict.nextAttemptAt||conflict.scheduledFor,suggestedAt:chooseAutomaticSlot(fresh,requested).scheduledFor};
    const job={id:crypto.randomUUID(),environment:'sandbox',status:'Scheduled',scheduledFor:scheduledFor.toISOString(),nextAttemptAt:scheduledFor.toISOString(),createdAt:new Date().toISOString(),attempts:0,maxAttempts:fresh.maxAttempts,timingMode:timingDecision?fresh.timingMode:'manual',timingScore:timingDecision?.score??null,timingReason:timingDecision?.reason||'Manual schedule',pin,result:null}; fresh.jobs.push(job); await writeState(fresh); return {state:'Scheduled',job};
  }
  async function reschedule(jobId, scheduledFor, options={}){ const state=await readState(); await recoverInterrupted(state); const fresh=await readState(); const job=fresh.jobs.find(x=>x.id===jobId); if(!job)return{state:'Not Found',message:'Scheduler job was not found.'}; if(!['Scheduled','Retry Scheduled'].includes(job.status))return{state:'Conflict',message:'Only scheduled or retry-scheduled jobs can be rescheduled.'}; let when,decision=null; if(options.autoNextSlot===true||options.autoTiming===true){decision=chooseAutomaticSlot(fresh,scheduledFor?Date.parse(scheduledFor):Date.now(),jobId);when=new Date(decision.scheduledFor);}else when=new Date(scheduledFor); if(Number.isNaN(when.getTime()))return{state:'Configuration Invalid',message:'A valid scheduled time is required.'}; const conflict=conflictFor(fresh,when.getTime(),jobId); if(conflict)return{state:'Cadence Conflict',message:`Another active Pinterest job is within the ${fresh.defaultIntervalMinutes}-minute publication interval.`,conflictJobId:conflict.id,conflictAt:conflict.nextAttemptAt||conflict.scheduledFor,suggestedAt:chooseAutomaticSlot(fresh,when.getTime(),jobId).scheduledFor}; const previous=job.scheduledFor; job.status='Scheduled'; job.scheduledFor=when.toISOString(); job.nextAttemptAt=when.toISOString(); job.rescheduledAt=new Date().toISOString(); job.error=null; job.timingMode=decision?fresh.timingMode:'manual'; job.timingScore=decision?.score??null; job.timingReason=decision?.reason||'Manual reschedule'; fresh.history.unshift({jobId:job.id,status:'Rescheduled',at:job.rescheduledAt,from:previous,to:job.scheduledFor,title:job.pin?.title,timingMode:job.timingMode}); fresh.history=fresh.history.slice(0,500); await writeState(fresh); return{state:'Rescheduled',job}; }
  async function cancel(jobId){ const state=await readState(); const job=state.jobs.find(x=>x.id===jobId); if(!job)return{state:'Not Found',message:'Scheduler job was not found.'}; if(job.status==='Published')return{state:'Conflict',message:'Published jobs cannot be cancelled.'}; job.status='Cancelled'; job.cancelledAt=new Date().toISOString(); await writeState(state); return{state:'Cancelled',jobId}; }
  async function list(){ const state=await readState(); await recoverInterrupted(state); const fresh=await readState(); const counts=fresh.jobs.reduce((acc,job)=>{acc[job.status]=(acc[job.status]||0)+1;return acc;},{}),decision=chooseAutomaticSlot(fresh); return{state:'Connected',...fresh,counts,minIntervalMinutes:MIN_INTERVAL_MINUTES,maxIntervalMinutes:MAX_INTERVAL_MINUTES,nextAvailableSlot:decision.scheduledFor,nextTimingScore:decision.score,nextTimingReason:decision.reason,timingIntelligence:{mode:fresh.timingMode,horizonHours:DEFAULT_TIMING_HORIZON_HOURS,performanceSignals:false,description:fresh.timingMode==='adaptive'?'Adaptive timing uses local-time priors; Pinterest performance learning is not enabled yet.':'Cadence mode uses the first safe queue slot.'}}; }
  async function setCadence(minutes){ const value=Number(minutes); if(!Number.isInteger(value)||value<MIN_INTERVAL_MINUTES||value>MAX_INTERVAL_MINUTES) return{state:'Configuration Invalid',message:`Publication cadence must be a whole number from ${MIN_INTERVAL_MINUTES} to ${MAX_INTERVAL_MINUTES} minutes.`}; const state=await readState(); state.defaultIntervalMinutes=value; await writeState(state); const decision=chooseAutomaticSlot(state); return{state:'Cadence Updated',defaultIntervalMinutes:value,minIntervalMinutes:MIN_INTERVAL_MINUTES,maxIntervalMinutes:MAX_INTERVAL_MINUTES,nextAvailableSlot:decision.scheduledFor}; }
  async function setTimingMode(mode){ if(!['cadence','adaptive'].includes(mode))return{state:'Configuration Invalid',message:'Timing mode must be cadence or adaptive.'}; const state=await readState(); state.timingMode=mode; await writeState(state); const decision=chooseAutomaticSlot(state); return{state:'Timing Mode Updated',timingMode:mode,nextAvailableSlot:decision.scheduledFor,timingScore:decision.score,timingReason:decision.reason}; }

  async function executeDue(now=new Date()){
    if(executionLock)return{state:'Busy'}; executionLock=true;
    try{ const state=await readState(); await recoverInterrupted(state); const current=await readState(); if(!current.enabled)return{state:'Disabled'}; const due=current.jobs.filter(job=>['Scheduled','Retry Scheduled'].includes(job.status)&&publicationTime(job)<=now.getTime()).sort((a,b)=>publicationTime(a)-publicationTime(b)); const results=[];
      for(const job of due){ job.status='Publishing'; job.lastAttemptAt=new Date().toISOString(); job.attempts=Number(job.attempts||0)+1; await writeState(current); let result; try{result=await publisher.create(job.pin,'sandbox');}catch(error){result={state:'Unavailable',message:error?.message||'Pinterest publisher threw an unexpected error.'};} job.result=result;
        if(result?.state==='Published'){job.status='Published';job.publishedAt=new Date().toISOString();job.nextAttemptAt=null;job.error=null;current.history.unshift({jobId:job.id,status:'Published',at:job.publishedAt,pinId:result.pinId,boardId:result.boardId,title:job.pin.title,attempts:job.attempts,timingMode:job.timingMode});}
        else if(job.attempts<Number(job.maxAttempts||current.maxAttempts||maxAttempts)){job.status='Retry Scheduled';job.error=result?.message||result?.state||'Unknown publishing failure';job.nextAttemptAt=new Date(Date.now()+Number(current.retryMinutes||retryMinutes)*60000).toISOString();current.history.unshift({jobId:job.id,status:'Retry Scheduled',at:new Date().toISOString(),message:job.error,nextAttemptAt:job.nextAttemptAt,title:job.pin.title,attempts:job.attempts});}
        else{job.status='Failed';job.failedAt=new Date().toISOString();job.nextAttemptAt=null;job.error=result?.message||result?.state||'Unknown publishing failure';current.history.unshift({jobId:job.id,status:'Failed',at:job.failedAt,message:job.error,title:job.pin.title,attempts:job.attempts});}
        current.history=current.history.slice(0,500); await writeState(current); results.push({jobId:job.id,status:job.status,result,attempts:job.attempts,nextAttemptAt:job.nextAttemptAt||null}); }
      return{state:'Executed',processed:results.length,results};
    } finally{executionLock=false;}
  }
  async function setEnabled(enabled){const state=await readState();state.enabled=enabled===true;await writeState(state);return{state:state.enabled?'Enabled':'Disabled',environment:'sandbox'};}
  async function initialize(){if(running)return;running=true;const state=await readState();await recoverInterrupted(state);timer=setInterval(()=>{executeDue().catch(()=>{});},tickMs);timer.unref?.();}
  async function shutdown(){if(timer)clearInterval(timer);running=false;}
  return Object.freeze({initialize,shutdown,schedule,reschedule,nextSlot,cancel,list,executeDue,setEnabled,setCadence,setTimingMode});
}
module.exports={createPinterestScheduler,DEFAULT_INTERVAL_MINUTES,MIN_INTERVAL_MINUTES,MAX_INTERVAL_MINUTES,DEFAULT_MAX_ATTEMPTS,DEFAULT_RETRY_MINUTES,DEFAULT_TIMING_HORIZON_HOURS,STATES};
