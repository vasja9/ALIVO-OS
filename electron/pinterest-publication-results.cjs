const path=require('node:path');
const fs=require('node:fs/promises');
const crypto=require('node:crypto');
const FILE='pinterest-publication-results.json';
const MAX_RECORDS=5000;
async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e?.code==='ENOENT')return fallback;throw e;}}
async function writeJson(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const tmp=`${file}.${process.pid}.${Date.now()}.tmp`;await fs.writeFile(tmp,JSON.stringify(value,null,2),{encoding:'utf8',mode:0o600});try{await fs.rename(tmp,file);}catch(e){if(process.platform==='win32'&&['EEXIST','EPERM','EACCES'].includes(e?.code)){await fs.rm(file,{force:true});await fs.rename(tmp,file);}else{try{await fs.rm(tmp,{force:true});}catch{}throw e;}}}
function imageMode(input={}){return String(input.imageBase64||'').trim()?'upload':String(input.imageUrl||'').trim()?'url':'unknown';}
function createPinterestPublicationResults(app){
 const file=path.join(app.getPath('userData'),'state',FILE);
 async function capture(result={},input={},source='manual'){
  if(result?.state!=='Published'||!result?.pinId)return{state:'Ignored',message:'Only Pinterest-confirmed publications are captured.'};
  const store=await readJson(file,{schemaVersion:1,records:[]});store.records=Array.isArray(store.records)?store.records:[];
  const record={id:crypto.randomUUID(),pinId:String(result.pinId),boardId:result.boardId?String(result.boardId):null,boardName:String(result.boardName||input.boardName||''),title:String(result.title||input.title||''),destinationUrl:String(result.link||input.link||''),imageMode:imageMode(input),imageUrl:imageMode(input)==='url'?String(input.imageUrl||''):null,imageContentType:imageMode(input)==='upload'?String(input.imageContentType||''):null,environment:String(result.environment||''),source:String(source||'manual'),publishedAt:result.createdAt||new Date().toISOString(),capturedAt:new Date().toISOString(),status:'Published'};
  const duplicate=store.records.find(r=>String(r.pinId)===record.pinId&&String(r.environment)===record.environment);if(duplicate)return{state:'Already Captured',record:duplicate};
  store.records.unshift(record);if(store.records.length>MAX_RECORDS)store.records.length=MAX_RECORDS;await writeJson(file,store);return{state:'Captured',record};
 }
 async function list(){const store=await readJson(file,{schemaVersion:1,records:[]});const records=Array.isArray(store.records)?store.records:[];return{state:'Connected',count:records.length,records};}
 return Object.freeze({capture,list});
}
module.exports={createPinterestPublicationResults,MAX_RECORDS};