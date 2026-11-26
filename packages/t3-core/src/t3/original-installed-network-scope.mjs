// Shared trusted Control / Kernel-realm configuration. This is routing,
// not an Access evaluator or an authority issued to the UI.
const ID=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(value);
const fail=code=>{throw Object.assign(Error(code),{code});};
const SCHEMA='IWXA_T4_INSTALLED_NATIVE_NETWORK_SCOPE/1';
const KEYS=['schema','role','sourceWorkspaceId','technicalWorkspaceId','registryWorkspaceId'];
const CAPTURE=new Set(['putObject','deleteObject','putAsset','deleteAsset','putRelation','deleteRelation','commitObjectGraph']);
const MUTATIONS=new Set([...CAPTURE,'createWorkspace','softDeleteWorkspace','restoreWorkspace','purgeCommit','importCommit','confirmExport']);
const READS=new Set(['getWorkspace','getObject','listObjects','listObjectWindow','getAsset','listAssets','listEventsSince','listEventCommitWindow','listEventObjectCommitWindow','exportPreview','exportPackage','activity.read']);
const LOCAL=Object.freeze({kind:'LOCAL_T3'});
export function normalizeOriginalInstalledNetworkScope(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==KEYS.length||
    !KEYS.every(k=>Object.hasOwn(value,k))||value.schema!==SCHEMA||!['SOURCE','RECIPIENT'].includes(value.role)||
    ![value.sourceWorkspaceId,value.technicalWorkspaceId,value.registryWorkspaceId].every(ID)||
    new Set([value.sourceWorkspaceId,value.technicalWorkspaceId,value.registryWorkspaceId]).size!==3)
    fail('T3_ORIGINAL_INSTALLED_NETWORK_SCOPE_INVALID');
  return Object.freeze(Object.fromEntries(KEYS.map(k=>[k,value[k]])));
}
export function sameOriginalInstalledNetworkScope(a,b){
  const x=normalizeOriginalInstalledNetworkScope(a),y=normalizeOriginalInstalledNetworkScope(b);
  return KEYS.every(k=>x[k]===y[k]);
}
function internal(scope,id){return id===scope.registryWorkspaceId||id===scope.technicalWorkspaceId;}
// Called in the existing authenticated HTTP owner route, independently of
// the compiled browser. Never substitute this ceiling for signed Access.
export function allowOriginalInstalledNetworkUiOperation(scope,operation,context,networkReady=false){
  const id=context?.workspace_id;
  if(!ID(id)||context.resource!==id||internal(scope,id))return false;
  if(id!==scope.sourceWorkspaceId)return true;
  if(READS.has(operation))return true;
  return scope.role==='SOURCE'&&networkReady===true&&CAPTURE.has(operation);
}
// At the original signed facade's last mutation hop, no ordinary local
// operation may bypass the native source capture or write a replica.
export function createOriginalInstalledNetworkMutationRoute({scope,sourceRoute=null,isHostActive}={}){
  scope=normalizeOriginalInstalledNetworkScope(scope);
  if(typeof isHostActive!=='function'||(scope.role==='SOURCE'?(typeof sourceRoute?.route!=='function'):sourceRoute!==null))
    fail('T3_ORIGINAL_INSTALLED_NETWORK_SCOPE_INVALID');
  const capture=sourceRoute?.route.bind(sourceRoute);
  return async(method,args)=>{
    if(isHostActive()!==true)fail('T3_HOST_DISPOSED');
    if(!MUTATIONS.has(method))return LOCAL;
    if(!Array.isArray(args)||args.length!==1)fail('T3_ORIGINAL_INSTALLED_NETWORK_MUTATION_INVALID');
    const first=args[0];
    // A preview token does not prove the target workspace. Never let these
    // ambiguous mutations cross the configured single-writer boundary.
    const id=method==='purgeCommit'||method==='importCommit'?null:method==='confirmExport'?
      (first?.workspace_ids?.length===1?first.workspace_ids[0]:null):typeof first==='string'?first:first?.workspace_id;
    if(!ID(id))fail('T3_ORIGINAL_INSTALLED_NETWORK_MUTATION_SCOPE_UNKNOWN');
    if(internal(scope,id))fail('T3_ORIGINAL_INSTALLED_NETWORK_INTERNAL_WRITE_DENIED');
    if(id!==scope.sourceWorkspaceId)return LOCAL;
    if(scope.role==='RECIPIENT')fail('T3_ORIGINAL_INSTALLED_NETWORK_REPLICA_READ_ONLY');
    if(!CAPTURE.has(method))fail('T3_LOCAL_SOURCE_CAPTURE_OPERATION_NOT_SUPPORTED');
    const result=await capture(method,structuredClone(args));
    if(isHostActive()!==true)fail('T3_HOST_DISPOSED');
    if(result?.kind!=='CAPTURED'||!result.originalReceipt||typeof result.originalReceipt!=='object')
      fail('T3_ORIGINAL_INSTALLED_NETWORK_CAPTURE_REQUIRED');
    return result;
  };
}
