const path=require('node:path');
const fs=require('node:fs/promises');
const crypto=require('node:crypto');
const FILE='pinterest-production-trial.json';
const MAX_PINS_PER_APPROVAL=1;
const APPROVAL_TTL_MINUTES=30;
async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e?.code==='ENOENT')return fallback;throw e;}}
async function writeJson(file,value){
  await fs.mkdir(path.dirname(file),{recursive:true});
  const tmp=`${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp,JSON.stringify(value,null,2),{encoding:'utf8',mode:0o600});
  try{await fs.rename(tmp,file);}catch(e){
    if(process.platform==='win32'&&['EEXIST','EPERM','EACCES'].includes(e?.code)){
      await fs.rm(file,{force:true});
      await fs.rename(tmp,file);
    }else{try{await fs.rm(tmp,{force:true});}catch{}throw e;}
  }
}
function createPinterestProductionTrial(app,publisher){
  const file=path.join(app.getPath('userData'),'state',FILE);
  async function state(){const s=await readJson(file,{schemaVersion:1,approval:null,audit:[]});const approval=s.approval,now=Date.now(),expires=approval?Date.parse(approval.expiresAt):0,active=Boolean(approval&&approval.status==='APPROVED'&&expires>now&&Number(approval.remaining||0)>0);return{state:'Connected',mode:active?'APPROVED':'LOCKED',active,remaining:active?Number(approval.remaining||0):0,expiresAt:active?approval.expiresAt:null,maxPinsPerApproval:MAX_PINS_PER_APPROVAL,approvalTtlMinutes:APPROVAL_TTL_MINUTES,schedulerControl:false,automaticApproval:false,auditCount:Array.isArray(s.audit)?s.audit.length:0};}
  async function approve(request={}){if(request.confirmation!=='ENABLE ONE PRODUCTION TRIAL')return{state:'Confirmation Required',message:'Exact explicit confirmation is required.'};const s=await readJson(file,{schemaVersion:1,approval:null,audit:[]}),now=new Date(),approval={id:crypto.randomUUID(),status:'APPROVED',approvedAt:now.toISOString(),expiresAt:new Date(now.getTime()+APPROVAL_TTL_MINUTES*60000).toISOString(),remaining:MAX_PINS_PER_APPROVAL};s.approval=approval;s.audit=Array.isArray(s.audit)?s.audit:[];s.audit.push({at:approval.approvedAt,event:'APPROVED',approvalId:approval.id,limit:MAX_PINS_PER_APPROVAL});await writeJson(file,s);return{state:'Approved',approvalId:approval.id,expiresAt:approval.expiresAt,remaining:approval.remaining};}
  async function revoke(){const s=await readJson(file,{schemaVersion:1,approval:null,audit:[]});if(s.approval)s.approval.status='REVOKED';s.audit=Array.isArray(s.audit)?s.audit:[];s.audit.push({at:new Date().toISOString(),event:'REVOKED',approvalId:s.approval?.id||null});await writeJson(file,s);return{state:'Locked'};}
  async function publish(input={}){const s=await readJson(file,{schemaVersion:1,approval:null,audit:[]}),approval=s.approval,now=Date.now();if(!approval||approval.status!=='APPROVED'||Date.parse(approval.expiresAt)<=now||Number(approval.remaining||0)<1)return{state:'Production Trial Locked',message:'A fresh explicit one-Pin production trial approval is required.'};const result=await publisher.create(input,'production-trial');s.audit=Array.isArray(s.audit)?s.audit:[];s.audit.push({at:new Date().toISOString(),event:'PUBLISH_ATTEMPT',approvalId:approval.id,result:result?.state||'Unknown',pinId:result?.pinId||null});if(result?.state==='Published'){approval.remaining=Math.max(0,Number(approval.remaining||0)-1);approval.status='CONSUMED';approval.consumedAt=new Date().toISOString();approval.pinId=result.pinId||null;}await writeJson(file,s);return result;}
  return Object.freeze({state,approve,revoke,publish});
}
module.exports={createPinterestProductionTrial,MAX_PINS_PER_APPROVAL,APPROVAL_TTL_MINUTES};