const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');

const DEFAULT_INTERVAL_MINUTES = 90;
const MIN_INTERVAL_MINUTES = 30;
const MAX_INTERVAL_MINUTES = 600;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_MINUTES = 5;
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
      return { schemaVersion:3, enabled:data.enabled === true, environment:'sandbox', defaultIntervalMinutes:Number(data.defaultIntervalMinutes || defaultIntervalMinutes), maxAttempts:Number(data.maxAttempts || maxAttempts), retryMinutes:Number(data.retryMinutes || retryMinutes), jobs:Array.isArray(data.jobs)?data.jobs:[], history:Array.isArray(data.history)?data.history:[], updatedAt:data.updatedAt || null };
    } catch (error) {
      if (error?.code === 'ENOENT') return { schemaVersion:3, enabled:false, environment:'sandbox', defaultIntervalMinutes, maxAttempts, retryMinutes, jobs:[], history:[], updatedAt:null };
      throw error;
    }
  }
  async function writeState(state) { await fs.mkdir(stateDir,{recursive:true}); const next={...state,schemaVersion:3,environment:'sandbox',updatedAt:new Date().toISOString()}; const tmp=`${queuePath}.tmp`; await fs.writeFile(tmp,JSON.stringify(next,null,2),{encoding:'utf8',mode:0o600}); await fs.rename(tmp,queuePath); return next; }
  function sanitizePin(input={}) { return { boardName:String(input.boardName||'').trim(), title:String(input.title||'').trim(), description:String(input.description||'').trim(), link:String(input.link||'').trim(), imageUrl:String(input.imageUrl||'').trim(), altText:String(input.altText||input.title||'').trim() }; }
  function isActive(job){ return ['Scheduled','Retry Scheduled','Publishing'].includes(job.status); }
  function publicationTime(job){ return Date.parse(job.nextAttemptAt || job.scheduledFor); }
  function activeJobs(state, excludeJobId){ return state.jobs.filter(job=>isActive(job)&&job.id!==excludeJobId&&Number.isFinite(publicationTime(job))).sort((a,b)=>publicationTime(a)-publicationTime(b)); }
  function conflictFor(state, requested, excludeJobId){ const spacingMs=Number(state.defaultIntervalMinutes||defaultIntervalMinutes)*60000; return activeJobs(state,excludeJobId).find(job=>Math.abs(publicationTime(job)-requested)<spacingMs); }
  function calculateNextSlot(state, from=Date.now(), excludeJobId){ const spacingMs=Number(state.defaultIntervalMinutes||defaultIntervalMinutes)*60000; let candidate=Math.max(Number(from)||Date.now(),Date.now()); const jobs=activeJobs(state,excludeJobId); for(const job of jobs){ const t=publicationTime(job); if(Math.abs(t-candidate)<spacingMs) candidate=t+spacingMs; } let conflict; do { conflict=jobs.find(job=>Math.abs(publicationTime(job)-candidate)<spacingMs); if(conflict) candidate=publicationTime(conflict)+spacingMs; } while(conflict); return new Date(candidate).toISOString(); }

  async function recoverInterrupted(state){ let changed=false; const now=new Date(); for(const job of state.jobs){ if(job.status!=='Publishing') continue; job.status='Retry Scheduled'; job.nextAttemptAt=now.toISOString(); job.recoveredAt=now.toISOString(); job.error='Recovered after ALIVO OS stopped while this job was publishing.'; state.history.unshift({jobId:job.id,status:'Recovered',at:now.toISOString(),message:job.error,title:job.pin?.title}); changed=true; } if(changed){state.history=state.history.slice(0,500); await writeState(state);} return changed; }

  async function nextSlot(from){ const state=await readState(); await recoverInterrupted(state); const fresh=await readState(); return {state:'Next Slot',scheduledFor:calculateNextSlot(fresh,from),defaultIntervalMinutes:fresh.defaultIntervalMinutes}; }
  async function schedule(input={}){
    const pin=sanitizePin(input.pin||input); if(!pin.boardName||!pin.title||!pin.link||!pin.imageUrl) return {state:'Configuration Invalid',message:'Board name, title, destination URL and image URL are required.'};
    const state=await readState(); await recoverInterrupted(state); const fresh=await readState(); let scheduledFor;
    if(input.autoNextSlot===true) scheduledFor=new Date(calculateNextSlot(fresh,input.scheduledFor?Date.parse(input.scheduledFor):Date.now())); else scheduledFor=new Date(input.scheduledFor||Date.now());
    if(Number.isNaN(scheduledFor.getTime())) return {state:'Configuration Invalid',message:'A valid scheduled time is required.'};
    const requested=scheduledFor.getTime(); const conflict=conflictFor(fresh,requested); if(conflict) return {state:'Cadence Conflict',message:`Another active Pinterest job is within the ${fresh.defaultIntervalMinutes}-minute publication interval.`,conflictJobId:conflict.id,conflictAt:conflict.nextAttemptAt||conflict.scheduledFor,suggestedAt:calculateNextSlot(fresh,requested)};
    const job={id:crypto.randomUUID(),environment:'sandbox',status:'Scheduled',scheduledFor:scheduledFor.toISOString(),nextAttemptAt:scheduledFor.toISOString(),createdAt:new Date().toISOString(),attempts:0,maxAttempts:fresh.maxAttempts,pin,result:null}; fresh.jobs.push(job); await writeState(fresh); return {state:'Scheduled',job};
  }
  async function reschedule(jobId, scheduledFor, options={}){ const state=await readState(); await recoverInterrupted(state); const fresh=await readState(); const job=fresh.jobs.find(x=>x.id===jobId); if(!job)return{state:'Not Found',message:'Scheduler job was not found.'}; if(!['Scheduled','Retry Scheduled'].includes(job.status))return{state:'Conflict',message:'Only scheduled or retry-scheduled jobs can be rescheduled.'}; let when; if(options.autoNextSlot===true)when=new Date(calculateNextSlot(fresh,scheduledFor?Date.parse(scheduledFor):Date.now(),jobId));else when=new Date(scheduledFor); if(Number.isNaN(when.getTime()))return{state:'Configuration Invalid',message:'A valid scheduled time is required.'}; const conflict=conflictFor(fresh,when.getTime(),jobId); if(conflict)return{state:'Cadence Conflict',message:`Another active Pinterest job is within the ${fresh.defaultIntervalMinutes}-minute publication interval.`,conflictJobId:conflict.id,conflictAt:conflict.nextAttemptAt||conflict.scheduledFor,suggestedAt:calculateNextSlot(fresh,when.getTime(),jobId)}; const previous=job.scheduledFor; job.status='Scheduled'; job.scheduledFor=when.toISOString(); job.nextAttemptAt=when.toISOString(); job.rescheduledAt=new Date().toISOString(); job.error=null; fresh.history.unshift({jobId:job.id,status:'Rescheduled',at:job.rescheduledAt,from:previous,to:job.scheduledFor,title:job.pin?.title}); fresh.history=fresh.history.slice(0,500); await writeState(fresh); return{state:'Rescheduled',job}; }
  async function cancel(jobId){ const state=await readState(); const job=state.jobs.find(x=>x.id===jobId); if(!job)return{state:'Not Found',message:'Scheduler job was not found.'}; if(job.status==='Published')return{state:'Conflict',message:'Published jobs cannot be cancelled.'}; job.status='Cancelled'; job.cancelledAt=new Date().toISOString(); await writeState(state); return{state:'Cancelled',jobId}; }
  async function list(){ const state=await readState(); await recoverInterrupted(state); const fresh=await readState(); const counts=fresh.jobs.reduce((acc,job)=>{acc[job.status]=(acc[job.status]||0)+1;return acc;},{}); return{state:'Connected',...fresh,counts,minIntervalMinutes:MIN_INTERVAL_MINUTES,maxIntervalMinutes:MAX_INTERVAL_MINUTES,nextAvailableSlot:calculateNextSlot(fresh)}; }
  async function setCadence(minutes){ const value=Number(minutes); if(!Number.isInteger(value)||value<MIN_INTERVAL_MINUTES||value>MAX_INTERVAL_MINUTES) return{state:'Configuration Invalid',message:`Publication cadence must be a whole number from ${MIN_INTERVAL_MINUTES} to ${MAX_INTERVAL_MINUTES} minutes.`}; const state=await readState(); state.defaultIntervalMinutes=value; await writeState(state); return{state:'Cadence Updated',defaultIntervalMinutes:value,minIntervalMinutes:MIN_INTERVAL_MINUTES,maxIntervalMinutes:MAX_INTERVAL_MINUTES,nextAvailableSlot:calculateNextSlot(state)}; }

  async function executeDue(now=new Date()){
    if(executionLock)return{state:'Busy'}; executionLock=true;
    try{ const state=await readState(); await recoverInterrupted(state); const current=await readState(); if(!current.enabled)return{state:'Disabled'}; const due=current.jobs.filter(job=>['Scheduled','Retry Scheduled'].includes(job.status)&&publicationTime(job)<=now.getTime()).sort((a,b)=>publicationTime(a)-publicationTime(b)); const results=[];
      for(const job of due){ job.status='Publishing'; job.lastAttemptAt=new Date().toISOString(); job.attempts=Number(job.attempts||0)+1; await writeState(current); let result; try{result=await publisher.create(job.pin,'sandbox');}catch(error){result={state:'Unavailable',message:error?.message||'Pinterest publisher threw an unexpected error.'};} job.result=result;
        if(result?.state==='Published'){job.status='Published';job.publishedAt=new Date().toISOString();job.nextAttemptAt=null;job.error=null;current.history.unshift({jobId:job.id,status:'Published',at:job.publishedAt,pinId:result.pinId,boardId:result.boardId,title:job.pin.title,attempts:job.attempts});}
        else if(job.attempts<Number(job.maxAttempts||current.maxAttempts||maxAttempts)){job.status='Retry Scheduled';job.error=result?.message||result?.state||'Unknown publishing failure';job.nextAttemptAt=new Date(Date.now()+Number(current.retryMinutes||retryMinutes)*60000).toISOString();current.history.unshift({jobId:job.id,status:'Retry Scheduled',at:new Date().toISOString(),message:job.error,nextAttemptAt:job.nextAttemptAt,title:job.pin.title,attempts:job.attempts});}
        else{job.status='Failed';job.failedAt=new Date().toISOString();job.nextAttemptAt=null;job.error=result?.message||result?.state||'Unknown publishing failure';current.history.unshift({jobId:job.id,status:'Failed',at:job.failedAt,message:job.error,title:job.pin.title,attempts:job.attempts});}
        current.history=current.history.slice(0,500); await writeState(current); results.push({jobId:job.id,status:job.status,result,attempts:job.attempts,nextAttemptAt:job.nextAttemptAt||null}); }
      return{state:'Executed',processed:results.length,results};
    } finally{executionLock=false;}
  }
  async function setEnabled(enabled){const state=await readState();state.enabled=enabled===true;await writeState(state);return{state:state.enabled?'Enabled':'Disabled',environment:'sandbox'};}
  async function initialize(){if(running)return;running=true;const state=await readState();await recoverInterrupted(state);timer=setInterval(()=>{executeDue().catch(()=>{});},tickMs);timer.unref?.();}
  async function shutdown(){if(timer)clearInterval(timer);running=false;}
  return Object.freeze({initialize,shutdown,schedule,reschedule,nextSlot,cancel,list,executeDue,setEnabled,setCadence});
}
module.exports={createPinterestScheduler,DEFAULT_INTERVAL_MINUTES,MIN_INTERVAL_MINUTES,MAX_INTERVAL_MINUTES,DEFAULT_MAX_ATTEMPTS,DEFAULT_RETRY_MINUTES,STATES};
