// Native transport authorization is an additional consumer of the ONE
// original T3 signed Access Host. This port issues no key, grant or status,
// never stores decisions, and never authorizes a Kernel subject mutation.
import {randomUUID} from 'node:crypto';
import {snapshot} from '../../../t3-core/src/t3/access/core.mjs';
import {isOriginalSignedAccessHostPort} from '../../../t3-core/src/t3/signed-access-host-port.mjs';
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const HEX=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const CONTEXT=['kind','context_id','actor_id','principal_id','role_id','grant_id','realm_id',
  'audience','resource','purpose','workspace_id','organization_id','scope_revision'];
const ACTIONS=Object.freeze(['network.frame.publish','network.frame.read','network.frame.discover',
  'network.frame.index.publish','network.frame.index.read']);
const fail=code=>{throw Object.assign(Error(code),{code,outcome:'DENIED'});};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// Ephemeral reference identity of the existing Host port. No permission is
// implied by this token, which is never sent over the wire or persisted.
const accessIdentities=new WeakMap();
function identityOf(access){
  if(!accessIdentities.has(access))accessIdentities.set(access,Object.freeze({}));
  return accessIdentities.get(access);
}
const freeze=value=>{
  if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}
  return value;
};
function subject(value,workspaceId){
  if(!value||!['PERSONAL','CORP'].includes(value.kind)||
    !CONTEXT.filter(k=>!['kind','organization_id','scope_revision'].includes(k)).every(k=>ID(value[k]))||
    value.resource!==workspaceId||value.workspace_id!==workspaceId||
    !Number.isSafeInteger(value.scope_revision)||value.scope_revision<1||
    (value.kind==='CORP'?(value.organization_id!==value.principal_id||!ID(value.organization_id)):
      value.organization_id!==null))fail('ORIGINAL_SIGNED_NETWORK_CONTEXT_INVALID');
  return Object.freeze(Object.fromEntries(CONTEXT.map(k=>[k,value[k]])));
}
// A single JIT decision path for exact T4 actions; the calling owner port
// must first validate its own route or signing evidence. No permit cache.
export function createT4OriginalSignedOperationAccess({
  access,expectedContext,workspaceId,operations,getMode,clock=Date.now,
}={}){
  if(!isOriginalSignedAccessHostPort(access)||typeof getMode!=='function'||typeof clock!=='function'||
    !ID(workspaceId)||!Array.isArray(operations)||!operations.length||operations.length>64||
    !operations.every(op=>ID(op)&&op.startsWith('t4.network.'))||new Set(operations).size!==operations.length)
    fail('ORIGINAL_SIGNED_NETWORK_PORT_REQUIRED');
  const selected=subject(expectedContext,workspaceId),allowed=Object.freeze([...operations]);
  function current(){
    if(getMode()!=='T4_NETWORK')fail('T4_NETWORK_MODE_DISABLED');
    if(!same(subject(access.currentContext(),selected.workspace_id),selected))
      fail('ORIGINAL_SIGNED_NETWORK_CONTEXT_CHANGED');
  }
  async function authorize({operation,input,expectedPolicyDigest=null}={}){
    current();
    if(!allowed.includes(operation))fail('ORIGINAL_SIGNED_NETWORK_ACTION_MISMATCH');
    if(expectedPolicyDigest!==null&&!HEX(expectedPolicyDigest))fail('ORIGINAL_SIGNED_NETWORK_POLICY_MISMATCH');
    const proof=freeze(snapshot(input));
    const action=await access.actionFor(operation);
    current();
    // An existing grant for object.read/object.write is NOT network consent.
    if(action!==operation)fail('ORIGINAL_SIGNED_NETWORK_ACTION_MISMATCH');
    const operationDigest=await access.operationDigest({operation,input:proof,context:selected});
    current();
    if(!HEX(operationDigest))fail('ORIGINAL_SIGNED_NETWORK_DIGEST_INVALID');
    const request=Object.freeze({id:'t4-'+randomUUID(),actorId:selected.actor_id,
      principalId:selected.principal_id,roleId:selected.role_id,grantId:selected.grant_id,
      audience:selected.audience,resource:selected.resource,action,purpose:selected.purpose,
      realmId:selected.realm_id,operationDigest});
    const decision=await access.authorize(request);
    current();
    if(await access.verifyDecisionBinding(request,decision)!==true)
      fail('ORIGINAL_SIGNED_NETWORK_DECISION_UNBOUND');
    current();
    const now=clock(),corporate=selected.kind==='CORP';
    if(!Number.isSafeInteger(now)||now<=0||decision?.schema!==(corporate?
      'IWXA_T3_ORGANIZATION_OPERATION_DECISION/1':'IWXA_T3_AUTHORIZATION_DECISION/1')||
      decision.allowed!==true||decision.outcome!=='PERMITTED'||decision.evidenceOnly!==true||
      !HEX(decision.requestDigest)||!HEX(decision.policyDigest)||
      !Number.isSafeInteger(decision.statusSequence)||decision.statusSequence<0||
      !Number.isFinite(Date.parse(decision.validUntil))||Date.parse(decision.validUntil)<=now)
      fail('ORIGINAL_SIGNED_NETWORK_ACCESS_DENIED');
    if(expectedPolicyDigest!==null&&decision.policyDigest!==expectedPolicyDigest)
      fail('ORIGINAL_SIGNED_NETWORK_POLICY_MISMATCH');
    if(corporate){
      if(decision.organizationId!==selected.organization_id||decision.workspaceId!==selected.workspace_id||
        decision.grantId!==selected.grant_id||!HEX(decision.operationDigest)||!HEX(decision.evidenceDigest)||
        decision.productionActivation!==false||decision.doesNotTransferData!==true||
        decision.doesNotAcceptCorporateCopy!==true)
        fail('ORIGINAL_SIGNED_NETWORK_CORPORATE_SCOPE_MISMATCH');
    }else if(!Array.isArray(decision.authorityPath)||decision.authorityPath.at(-1)?.grantId!==selected.grant_id||
      !Number.isFinite(Date.parse(decision.statusObservedAt))||Date.parse(decision.statusObservedAt)>now||
      !Number.isFinite(Date.parse(decision.evaluatedAt))||Date.parse(decision.evaluatedAt)>now)
      fail('ORIGINAL_SIGNED_NETWORK_ACCESS_DENIED');
    return true;
  }
  return Object.freeze({subject:selected,originalAccessIdentity:identityOf(access),authorize,assertCurrent:current,originalSignedAccessOnly:true,
    createsGrant:false,createsStore:false,createsIAM:false});
}
export function createT4OriginalSignedRouteAccess({
  access,expectedContext,binding,route,authorityRoot,getMode,clock=Date.now,
}={}){
  if(!binding||!route||!ID(authorityRoot)||!ID(binding.workspaceId)||
    !['LEGACY','INDEXED'].includes(binding.nativeWireProfile))
    fail('ORIGINAL_SIGNED_NETWORK_PORT_REQUIRED');
  const scope=freeze(snapshot({binding,route,authorityRoot}));
  const allowed=ACTIONS.filter(x=>scope.binding.nativeWireProfile==='INDEXED'?
    x!=='network.frame.discover':!x.startsWith('network.frame.index.'));
  const signed=createT4OriginalSignedOperationAccess({access,expectedContext,workspaceId:binding.workspaceId,
    operations:allowed.map(op=>'t4.'+op),getMode,clock});
  const selected=signed.subject;
  signed.assertCurrent();
  function exactProof(input){
    const p=freeze(snapshot(input)),r=p.transportRequest,b=scope.binding;
    if(!allowed.includes(p.operation)||p.storageLocationIsNotProtocolPeer!==true||
      p.originalSignedSubject===undefined||!CONTEXT.every(k=>p.originalSignedSubject[k]===selected[k])||
      p.workspaceId!==b.workspaceId||p.objectFamily!==b.objectFamily||
      p.originalWriteOwnerRef!==b.originalWriteOwnerRef||p.targetNodeRef!==b.serverNodeRef||
      p.serverNodeRef!==b.serverNodeRef||p.topologyDigest!==b.topologyDigest||
      p.profileRef!==b.profileRef||p.locationRef!==b.locationRef||p.operatorRef!==scope.route.operatorRef||
      p.endpointUrl!==scope.route.endpointUrl||p.nativeWireProfile!==b.nativeWireProfile||
      r?.operation!=='t4.'+p.operation||r.workspaceId!==b.workspaceId||r.objectFamily!==b.objectFamily||
      r.writeOwnerRef!==b.originalWriteOwnerRef||r.authorityRoot!==scope.authorityRoot||
      r.locationRef!==b.locationRef||r.profileRef!==b.profileRef||
      r.profileMode!==scope.route.mode||r.operatorRef!==scope.route.operatorRef)
      fail('ORIGINAL_SIGNED_NETWORK_ROUTE_MISMATCH');
    // Exact bounded address only. Do not admit frame plaintext, credentials,
    // collection scans of indexed profiles, or arbitrary signed payloads.
    const discover=p.operation==='network.frame.discover',index=p.operation.includes('.index.');
    const keys=['operation','workspaceId','objectFamily','authorityRoot','writeOwnerRef','locationRef',
      'profileRef','operatorRef','profileMode',...(discover?['collectionOnly','depth']:['key','sha256'])];
    if(Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k))||
      (discover?(r.collectionOnly!==true||r.depth!==1):
        (typeof r.key!=='string'||!(index?/^[a-f0-9]{64}\.t4i$/:/^[a-f0-9]{64}\.t4n$/).test(r.key)||
          (index&&p.operation==='network.frame.index.read'?r.sha256!==null:
            !HEX(r.sha256)||(!index&&r.key!==r.sha256+'.t4n')))))
      fail('ORIGINAL_SIGNED_NETWORK_ADDRESS_INVALID');
    return p;
  }
  return Object.freeze({subject:selected,originalAccessIdentity:signed.originalAccessIdentity,async authorize(input){
      signed.assertCurrent();const proof=exactProof(input);
      return signed.authorize({operation:'t4.'+proof.operation,input:proof});
    },originalSignedAccessOnly:true,createsGrant:false,createsStore:false,createsIAM:false});
}
