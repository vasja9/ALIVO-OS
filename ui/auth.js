const params=new URLSearchParams(location.search),integration=(params.get('integration')||'').toLowerCase();
const form=document.querySelector('#form'),title=document.querySelector('#title'),status=document.querySelector('#status'),verify=document.querySelector('#verify');
const input=(id,label,type='text',placeholder='')=>`<label>${label}<input id="${id}" type="${type}" placeholder="${placeholder}" autocomplete="off"></label>`;
let oauthInfo;

if(integration==='wordpress'){
  title.textContent='Connect WordPress';
  form.innerHTML=input('site','WordPress site','url','https://alivo.eu')+input('username','ALIVO OS username')+input('applicationPassword','Application Password','password');
  verify.textContent='Verify & Save';
}else if(integration==='pinterest'){
  title.textContent='Connect Pinterest';
  form.innerHTML=`<p class="quiet">Production read access uses Pinterest OAuth. Trial publishing uses Pinterest API Sandbox.</p>${input('appId','Pinterest App ID')}${input('appSecret','Pinterest App secret','password')}<label>Redirect URI<input id="redirectUri" type="text" readonly value="Loading…"></label><p class="quiet">Add this exact Redirect URI to the Pinterest Developer app before connecting.</p><details open><summary>Trial Sandbox publishing</summary>${input('sandboxToken','Pinterest Sandbox access token','password','pina… / Sandbox token')}<button id="sandboxVerify" type="button" class="secondary">Verify & Save Sandbox Token</button><p class="quiet">Sandbox tokens are separate from production tokens and are used only against api-sandbox.pinterest.com.</p></details><details><summary>Temporary 24-hour production test token</summary>${input('accessToken','Pinterest access token','password','pina… / product-limited token')}<button id="temporaryVerify" type="button" class="secondary">Verify temporary token</button></details>`;
  verify.textContent='Connect with Pinterest';
  window.alivoAuth.pinterestOAuthInfo().then(info=>{oauthInfo=info;const el=document.querySelector('#redirectUri');if(el)el.value=info?.redirectUri||'Unavailable';});
}else{
  title.textContent='Unsupported integration';form.innerHTML='<p>This integration does not yet have a desktop authentication flow.</p>';verify.disabled=true;
}

document.querySelector('#cancel').onclick=()=>window.alivoAuth.close();

async function showResult(result,closeOnSuccess=true){
  status.textContent=result?.message||result?.state||'Operation finished.';
  status.className=`status ${result?.state==='Connected'?'ok':'error'}`;
  if(result?.state==='Connected'&&closeOnSuccess){document.querySelectorAll('input[type=password]').forEach(x=>x.value='');verify.textContent='Connected';setTimeout(()=>window.alivoAuth.close(),1200);return true}
  return false;
}

const sandbox=document.querySelector('#sandboxVerify');
if(sandbox)sandbox.onclick=async()=>{
  sandbox.disabled=true;status.className='status';status.textContent='Verifying Pinterest Sandbox token…';
  try{const result=await window.alivoAuth.verify({businessPackageId:'ALIVO',integration:'pinterest-sandbox',values:{accessToken:document.querySelector('#sandboxToken').value}});await showResult(result,false)}catch{status.textContent='Pinterest Sandbox token verification could not be completed.';status.className='status error'}
  sandbox.disabled=false;
};

const temporary=document.querySelector('#temporaryVerify');
if(temporary)temporary.onclick=async()=>{
  temporary.disabled=true;status.className='status';status.textContent='Verifying temporary token…';
  try{const result=await window.alivoAuth.verify({businessPackageId:'ALIVO',integration:'pinterest',values:{accessToken:document.querySelector('#accessToken').value}});await showResult(result)}catch{status.textContent='Temporary token verification could not be completed.';status.className='status error'}
  temporary.disabled=false;
};

verify.onclick=async()=>{
  verify.disabled=true;status.className='status';
  if(integration==='pinterest'){
    status.textContent='Opening Pinterest authorization in your browser…';
    try{const result=await window.alivoAuth.pinterestOAuth({appId:document.querySelector('#appId').value,appSecret:document.querySelector('#appSecret').value});if(await showResult(result))return}catch{status.textContent='Pinterest OAuth could not be completed.';status.className='status error'}
    verify.disabled=false;return;
  }
  status.textContent='Verifying connection…';
  const values={site:document.querySelector('#site').value,username:document.querySelector('#username').value,applicationPassword:document.querySelector('#applicationPassword').value};
  try{const result=await window.alivoAuth.verify({businessPackageId:'ALIVO',integration,values});if(await showResult(result))return}catch{status.textContent='Verification could not be completed.';status.className='status error'}
  verify.disabled=false;
};
