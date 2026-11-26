// Product composition only; never a grant, policy, issuer, or write authority.
const ID=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(value);
const FIELDS=Object.freeze(['kind','context_id','actor_id','principal_id','role_id','grant_id',
  'realm_id','audience','resource','purpose','workspace_id','organization_id','scope_revision']);
const fail=code=>{throw Object.assign(Error(code),{code,outcome:'DENIED'});};
export const T4_PRODUCT_NETWORK_PURPOSE='network.synchronization';
const BASE=Object.freeze(['t4.network.frame.publish','t4.network.frame.read',
  't4.network.frame.index.publish','t4.network.frame.index.read',
  't4.network.node.sign','t4.network.node.verify',
  't4.network.original.replacement.owner.read-history','t4.network.original.replacement.peer.read-history']);

// Minimum actions used by the RC.1 INDEXED native profile. The original
// history request constructors constrain source-window and result direction.
export function requiredT4ProductNetworkActions({role,enableSourceEventWindowRead=false,enableRecipientResultRead=false}={}){
  if(!['SOURCE','RECIPIENT'].includes(role)||typeof enableSourceEventWindowRead!=='boolean'||
    typeof enableRecipientResultRead!=='boolean')fail('T4_PRODUCT_NETWORK_ROLE_INVALID');
  const source=role==='SOURCE';
  return Object.freeze([...BASE,source?'t4.network.content.seal':'t4.network.content.open',
    ...(enableSourceEventWindowRead?[source?'t4.network.original.source.owner.read-window':
      't4.network.original.source.peer.read-window']:[]),
    ...(enableRecipientResultRead?[source?'t4.network.original.recipient.peer.read-result':
      't4.network.original.recipient.owner.read-result']:[])]);
}
function context(value,workspaceId){
  if(!value||!['PERSONAL','CORP'].includes(value.kind)||
    !FIELDS.filter(k=>!['kind','organization_id','scope_revision'].includes(k)).every(k=>ID(value[k]))||
    value.resource!==workspaceId||value.workspace_id!==workspaceId||value.purpose!==T4_PRODUCT_NETWORK_PURPOSE||
    !Number.isSafeInteger(value.scope_revision)||value.scope_revision<1||
    (value.kind==='CORP'?(value.organization_id!==value.principal_id||!ID(value.organization_id)):value.organization_id!==null))
    fail('T4_PRODUCT_NETWORK_CONTEXT_INVALID');
  return Object.freeze(Object.fromEntries(FIELDS.map(k=>[k,value[k]])));
}
const equal=(a,b)=>FIELDS.every(k=>a[k]===b[k]);

// This is a scope/lifetime guard at the trusted native composition boundary.
// It cannot authorize anything. The original signed evaluator still decides
// every operation using live signed state, proof, status and enrollment.
export function bindT4ProductNetworkSelection({role,sourceWorkspaceId,expectedContext,currentContext,getMode,
  enableSourceEventWindowRead=false,enableRecipientResultRead=false}={}){
  if(!ID(sourceWorkspaceId)||typeof currentContext!=='function'||typeof getMode!=='function')
    fail('T4_PRODUCT_NETWORK_OWNER_REQUIRED');
  const actions=requiredT4ProductNetworkActions({role,enableSourceEventWindowRead,enableRecipientResultRead});
  const selected=context(expectedContext,sourceWorkspaceId);
  let closed=false;
  function current(){
    if(closed)fail('T4_PRODUCT_NETWORK_SELECTION_CLOSED');
    try{
      if(getMode()!=='T4_NETWORK')fail('T4_PRODUCT_NETWORK_MODE_DISABLED');
      if(!equal(selected,context(currentContext(),sourceWorkspaceId)))fail('T4_PRODUCT_NETWORK_CONTEXT_CHANGED');
      return selected;
    }catch(error){closed=true;throw error;}
  }
  function requireContext(value){
    current();
    if(!equal(selected,context(value,sourceWorkspaceId)))fail('T4_PRODUCT_NETWORK_CONTEXT_CHANGED');
  }
  function requireAction(operation){
    current();
    if(!actions.includes(operation))fail('T4_PRODUCT_NETWORK_ACTION_DENIED');
    return operation;
  }
  function requireRequest(request,selectedContext){
    requireContext(selectedContext);
    requireAction(request?.action);
    for(const [a,b] of [['actorId','actor_id'],['principalId','principal_id'],['roleId','role_id'],
      ['grantId','grant_id'],['realmId','realm_id'],['audience','audience'],['resource','resource'],['purpose','purpose']])
      if(request[a]!==selected[b])fail('T4_PRODUCT_NETWORK_REQUEST_SCOPE_DENIED');
  }
  current();
  return Object.freeze({selected,actions,current,requireContext,requireAction,requireRequest,
    close(){closed=true;}});
}
