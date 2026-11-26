import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {PROFILE,digest,iso,makeProof,keyObjectSigner,signRecord} from '../../t3-core/src/t3/access/core.mjs';
import {createOriginalKernelRegistryStatePort,isOriginalKernelRegistryStatePortForKernel} from '../../t3-core/src/t3/access/original-kernel-registry-state.mjs';
import {createOriginalPersonalAccessCheck} from '../../t3-core/src/t3/access/original-personal-evaluator.mjs';
import {signOrganizationEnrollment} from '../../t3-core/src/t3/access/organizational-operation.mjs';
import {createSignedAccessHostPort} from '../../t3-core/src/t3/signed-access-host-port.mjs';
import {originalKernelFixture,model,NOW,time} from '../../t3-core/tests/support/t3-two-corp-original-authority.mjs';
import {createT4OriginalProductNetworkAccess as createAccess} from '../src/network/original-product-network-access.mjs';
import {createT4OriginalSignedOperationAccess} from '../src/network/original-signed-route-access.mjs';
import {bindT4OriginalProductKernelAccess,createT4OriginalProductProfileFactory} from '../src/network/original-product-network-profile.mjs';
const WS='ws:product:source',TECH='ws:product:technical',REG='ws:product:registry',ACTOR='person:product',PURPOSE='network.synchronization';
const READ='t4.network.frame.read',PUBLISH='t4.network.frame.publish',AUTH='authority:product';
const scope={schema:'IWXA_T4_INSTALLED_NATIVE_NETWORK_SCOPE/1',role:'SOURCE',sourceWorkspaceId:WS,technicalWorkspaceId:TECH,registryWorkspaceId:REG};
const now=NOW,clock=time;
function signer(keyId,uses){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  return {provider:keyObjectSigner(keyId,privateKey),key:{subjectId:ACTOR,environment:'TEST',status:'ACTIVE',uses,
    publicKey:publicKey.export({type:'spki',format:'pem'}).toString(),notBefore:iso(now-60000),expiresAt:iso(now+600000)}};
}
async function personal({signHook=null}={}){
  const issuer=signer('key:product:issuer',['GRANT','STATUS']),actor=signer('key:product:actor',['PROOF']);
  const actions=[READ,'object.read'];
  const policy={schema:PROFILE,id:'policy:product',version:'v1',realmId:'realm:product',environment:'TEST',statusMode:'OFFLINE_BOUNDED',
    timeAssurance:'LOCAL_BEST_EFFORT',proofMaxAgeSeconds:60,snapshotMaxAgeSeconds:3600,offlineMaxAgeSeconds:3600,
    keys:{[issuer.provider.keyId]:issuer.key,[actor.provider.keyId]:actor.key},authorities:{[AUTH]:{principalId:ACTOR,
      issuerKeys:[issuer.provider.keyId],statusKeys:[issuer.provider.keyId],audiences:['host:t3'],resources:[WS,TECH],actions,
      purposes:[PURPOSE,'workspace.work'],roles:['role:member'],rightClasses:['ACTION'],membershipEpoch:1,maxTtlSeconds:3600,maxDelegationDepth:0}},
    actionCatalog:Object.fromEntries(actions.map(a=>[a,'ACTION'])),prohibitions:[],confirmations:[]};
  const grant={kind:'GRANT',id:'grant:product:network',lineageId:'grant:product:network',renewalOf:null,parentGrantId:null,
    authorityId:AUTH,principalId:ACTOR,holderId:ACTOR,roleId:'role:member',rightClass:'ACTION',realmId:policy.realmId,environment:'TEST',
    audience:'host:t3',resources:[WS],actions:[READ],purposes:[PURPOSE],issuedAt:iso(now-30000),notBefore:iso(now-20000),
    expiresAt:iso(now+500000),remainingDepth:0,membershipEpoch:1,policyId:policy.id,policyVersion:policy.version,evidenceRefs:['evidence:product']};
  const status={kind:'STATUS',id:'status:product:1',environment:'TEST',realmId:policy.realmId,authorityId:AUTH,sequence:1,
    membershipEpoch:1,issuedAt:iso(now-1000),validUntil:iso(now+500000),
    entries:[{grantId:grant.id,state:'ACTIVE',effectiveAt:iso(now-2000),evidenceRef:'evidence:active'}]};
  const state={policy,grants:{[grant.id]:signRecord(grant,issuer.provider)},statuses:{[AUTH]:signRecord(status,issuer.provider)},statusFloor:{[AUTH]:1},tombstones:{}};
  const storage=originalKernelFixture(),registry=createOriginalKernelRegistryStatePort({kernel:storage.api,workspaceId:REG,trustedPolicy:policy,clock});
  await registry.commitSignedState(state);
  const context={kind:'PERSONAL',context_id:'context:product',actor_id:ACTOR,principal_id:ACTOR,role_id:grant.roleId,grant_id:grant.id,
    realm_id:policy.realmId,audience:grant.audience,resource:WS,purpose:PURPOSE,workspace_id:WS,organization_id:null,scope_revision:1};
  let current={...context},proofs=0;
  const signProof=async({request,challenge,asOf})=>{proofs++;if(signHook)await signHook();return makeProof(request,challenge,Date.parse(asOf),actor.provider);};
  const options={registry,role:'SOURCE',sourceWorkspaceId:WS,expectedContext:context,currentContext:()=>current,getMode:()=> 'T4_NETWORK',clock,personal:{signProof}};
  const access=createAccess(options);
  return {storage,registry,policy,state,context,options,access,signProof,get proofs(){return proofs;},
    change(){current={...current,scope_revision:2};},
    async revoke(){const next=structuredClone(state);next.statusFloor[AUTH]=2;next.statuses[AUTH]=signRecord({...status,id:'status:product:2',sequence:2,
      entries:[{...status.entries[0],state:'REVOKED',evidenceRef:'evidence:revoked'}]},issuer.provider);await registry.commitSignedState(next);}};
}
function signedGate(f,operations=[READ,PUBLISH]){
  return createT4OriginalSignedOperationAccess({access:f.access.originalAccess.access,expectedContext:f.context,
    workspaceId:f.context.workspace_id,operations,getMode:()=> 'T4_NETWORK',clock});
}
test('PERSONAL product adapter uses actual signed Registry, Ed25519 proof and JIT network decision; absent action is denied',async()=>{
  const f=await personal(),gate=signedGate(f);try{
    assert.equal(await gate.authorize({operation:READ,input:{route:'product:read'}}),true);
    assert.equal(f.proofs,1);
    await assert.rejects(gate.authorize({operation:PUBLISH,input:{route:'product:write'}}),{code:'ORIGINAL_SIGNED_NETWORK_ACCESS_DENIED'});
    assert.equal(f.proofs,2);
    await f.revoke();
    await assert.rejects(gate.authorize({operation:READ,input:{route:'product:read'}}),{code:'ORIGINAL_SIGNED_NETWORK_ACCESS_DENIED'});
    assert.equal(f.proofs,3);assert.equal(f.storage.calls.length,2);
  }finally{f.access.close();}
});
test('product adapter refuses mode/context change during actual signer proof',async()=>{
  let enter,release;const started=new Promise(r=>{enter=r;}),wait=new Promise(r=>{release=r;});
  const f=await personal({signHook:async()=>{enter();await wait;}});try{
    const pending=signedGate(f).authorize({operation:READ,input:{route:'product:read'}});pending.catch(()=>{});
    await started;f.change();release();await assert.rejects(pending);
    await assert.rejects(signedGate(f).authorize({operation:READ,input:{route:'product:read'}}));
  }finally{release();f.access.close();}
});
test('CORP product adapter preserves real signed organizational enrollment and grant, never treats another organization as authority',async()=>{
  // Existing two-organization fixture, with explicit TEST-only network
  // purpose in the issuer-signed policy, grant and enrollment. No production grant.
  const m=model({operations:[READ]});
  for(const short of ['north','south']){
    const x=m.all[short],id=x.context.grant_id,authority=x.enrollment.payload.issuerAuthorityId;
    m.policy.authorities[authority].purposes=[PURPOSE];
    const envelope=signRecord({...m.state.grants[id].payload,purposes:[PURPOSE]},x.issuerSigner);
    m.state.grants[id]=envelope;
    Object.assign(x.descriptors.grants.find(g=>g.grantId===id),{purposes:[PURPOSE],signedEnvelopeDigest:digest(envelope)});
    x.enrollment=signOrganizationEnrollment({...x.enrollment.payload,signedGrantDigest:digest(envelope)},x.issuerSigner);
    x.context={...x.context,purpose:PURPOSE};
  }
  const x=m.all.north,storage=originalKernelFixture(),registry=createOriginalKernelRegistryStatePort({kernel:storage.api,workspaceId:REG,trustedPolicy:m.policy,clock});
  await registry.commitSignedState(m.state);
  let foreign=false,proofs=0;
  const f={context:x.context,access:createAccess({registry,role:'SOURCE',sourceWorkspaceId:x.context.workspace_id,expectedContext:x.context,
    currentContext:()=>x.context,getMode:()=> 'T4_NETWORK',clock,corporate:{productId:'IWXA_CONTROL_CENTER',
      inputFor(){const v=foreign?m.all.south:x;return {profile:v.profile,selection:v.selection,descriptors:v.descriptors,credential:v.issuedCredential,enrollment:v.enrollment};},
      prove({request,challenge,asOf}){proofs++;return makeProof(request,challenge,Date.parse(asOf),x.credentialSigner);}}})};
  try{
    const gate=signedGate(f,[READ]);assert.equal(await gate.authorize({operation:READ,input:{route:'product:corp'}}),true);assert.equal(proofs,1);
    foreign=true;await assert.rejects(gate.authorize({operation:READ,input:{route:'product:corp'}}),{code:'T4_PRODUCT_NETWORK_ORIGINAL_SELECTION_REQUIRED'});
    assert.equal(proofs,1);
  }finally{f.access.close();}
});
test('original Registry provenance requires exact Kernel and technical Object; profile rejects a different source before using it',async()=>{
  const f=await personal();try{
    const kernel=f.storage.api;
    assert.equal(isOriginalKernelRegistryStatePortForKernel(f.registry,kernel,{workspaceId:REG}),true);
    assert.equal(isOriginalKernelRegistryStatePortForKernel(f.registry,{...kernel},{workspaceId:REG}),false);
    assert.equal(isOriginalKernelRegistryStatePortForKernel(f.registry,kernel,{workspaceId:TECH}),false);
    assert.equal(isOriginalKernelRegistryStatePortForKernel(f.registry,kernel,{workspaceId:REG,objectId:'registry:other'}),false);
    const create=createT4OriginalProductProfileFactory({scope,readOriginalOwnerInputs:()=>({registry:f.registry,profile:{},networkAccess:{},resolveOriginalKernelAccess:()=>null})});
    const lifetime={registryKernel:{...kernel},sessionId:'s'.repeat(43),contextEpoch:1,isHostActive:()=>true};
    await assert.rejects(create(lifetime),{code:'T4_INSTALLED_PRODUCT_ORIGINAL_REGISTRY_MISMATCH'});
    await assert.rejects(create({...lifetime,registryKernel:kernel}),{code:'T4_INSTALLED_PRODUCT_PROFILE_SCOPE_MISMATCH'});
  }finally{f.access.close();}
});
test('native subject/technical resolver accepts only exact original Registry-bound Access evaluator, not an equal Registry copy',async()=>{
  const f=await personal();try{
    const registry=f.registry,foreign=createOriginalKernelRegistryStatePort({kernel:f.storage.api,workspaceId:REG,trustedPolicy:f.policy,clock});
    let selected=f.access.originalAccess;
    let active=true;
    const lifetime={sessionId:'s'.repeat(43),contextEpoch:1,isHostActive:()=>active};
    const resolve=bindT4OriginalProductKernelAccess({registry,scope,lifetime,resolveOriginalKernelAccess:()=>selected});
    const proof={operation:'t1.getObject',method:'getObject',args:[WS,'item:1'],sessionId:lifetime.sessionId,contextEpoch:1,
      originalKernelOperation:true,networkGrantsNoWriteAuthority:true};
    assert.equal(await resolve(proof),selected.access);
    assert.equal(await resolve({...proof,args:['ws:foreign','item:1']}),null);
    assert.equal(await resolve({...proof,contextEpoch:2}),null);
    const check=createOriginalPersonalAccessCheck({registry:foreign,clock,signProof:f.signProof});
    const access=createSignedAccessHostPort({currentContext:()=>f.context,actionFor:op=>op,operationDigest:digest,canonicalDigest:digest,clock,personal:{check}});
    selected={access,originalEvaluator:check};
    await assert.rejects(resolve(proof),{code:'T4_INSTALLED_PRODUCT_KERNEL_REGISTRY_MISMATCH'});
    active=false;await assert.rejects(resolve(proof),{code:'T4_INSTALLED_PRODUCT_HOST_DISPOSED'});
  }finally{f.access.close();}
});
