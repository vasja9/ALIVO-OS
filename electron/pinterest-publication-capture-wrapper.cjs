function createPinterestPublicationCaptureWrapper({publisher,publicationResults,source='manual'}={}){
 if(!publisher||typeof publisher.create!=='function')throw new Error('A Pinterest publisher with create() is required.');
 if(!publicationResults||typeof publicationResults.capture!=='function')throw new Error('A publication result store with capture() is required.');
 async function create(input={},environment){
  const result=await publisher.create(input,environment);
  if(result?.state==='Published')await publicationResults.capture(result,input,source);
  return result;
 }
 return Object.freeze({create});
}
function wrapProductionTrial(trial,publicationResults,source='controlled-production-trial'){
 if(!trial||typeof trial.publish!=='function')throw new Error('A controlled production trial with publish() is required.');
 if(!publicationResults||typeof publicationResults.capture!=='function')throw new Error('A publication result store with capture() is required.');
 return Object.freeze({
  state:(...args)=>trial.state(...args),
  approve:(...args)=>trial.approve(...args),
  revoke:(...args)=>trial.revoke(...args),
  publish:async(input={})=>{const result=await trial.publish(input);if(result?.state==='Published')await publicationResults.capture(result,input,source);return result;},
 });
}
module.exports={createPinterestPublicationCaptureWrapper,wrapProductionTrial};
