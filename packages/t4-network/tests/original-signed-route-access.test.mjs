import test from 'node:test';
import assert from 'node:assert/strict';
import {createT4NetworkTopology,openT4NativeTopologyTransport} from '../src/network/network-topology.mjs';
import {packageSha256} from '../src/network/webdav-package-transfer.mjs';
import {createT4OriginalNativeHostNetworkOwner} from '../src/network/original-native-host-network-owner.mjs';
import {createTemporaryOriginalPersonalAuthority} from '../../t3-core/tests/support/t3-original-personal-authority.mjs';
import {NOW,time,model,originalKernelFixture} from '../../t3-core/tests/support/t3-two-corp-original-authority.mjs';
import {digest,iso,signRecord} from '../../t3-core/src/t3/access/core.mjs';
import {emptyVault,importVaultKey,encryptVault} from '../../t3-core/src/t3/access/local-vault.mjs';
import {createOriginalVaultProofSigner} from '../../t3-core/src/t3/access/original-vault-proof.mjs';
import {createOriginalKernelRegistryStatePort} from '../../t3-core/src/t3/access/original-kernel-registry-state.mjs';
import {createOrganizationalOperationGate,isOriginalOrganizationalOperationGateForRegistry} from '../../t3-core/src/t3/access/organizational-operation.mjs';
import {createSignedAccessHostPort,isOriginalSignedAccessHostPortForEvaluator} from '../../t3-core/src/t3/signed-access-host-port.mjs';

const caps=['network.frame.read','network.frame.publish','network.frame.index.read','network.frame.index.publish'];
const actions=caps.map(x=>'t4.'+x),family='family:network:k35',source='node:k35:source',
  server='node:k35:server',location='location:k35:server',endpointUrl='https://k35.example.test/dav/';
const bytes=Buffer.from('opaque original signed transport bytes');
const hash=packageSha256(bytes),input={key:hash+'.t4n',expectedSha256:hash};
const idx={key:'a'.repeat(64)+'.t4i',frameSha256:hash};
const makeTopology=context=>{
  const ws=context.workspace_id,principal=context.principal_id,owner='owner:'+ws;
  return createT4NetworkTopology({topologyRef:'topology:'+ws,revision:1,localNodeRef:source,
    nodes:[{nodeRef:source,kind:'LOCAL_DEVICE',subjectRef:principal,operatorRef:principal,
      locationRef:'location:k35:local',availability:'AVAILABLE',advertisedCapabilities:[]},
      {nodeRef:server,kind:context.kind==='CORP'?'ORGANIZATION_SERVER':'PERSONAL_SERVER',
        subjectRef:principal,operatorRef:principal,locationRef:location,profileRef:'profile:k35',
        availability:'AVAILABLE',advertisedCapabilities:caps}],
    profiles:[{profileRef:'profile:k35',mode:'SELF_HOSTED',operatorRef:principal,locationRef:location,endpointUrl}],
    connections:[{connectionRef:'connection:k35',sourceNodeRef:source,targetNodeRef:server,
      profileRef:'profile:k35',state:'READY',capabilities:caps,objectFamilies:[family]}],
    placements:[{policy:{workspaceId:ws,objectFamily:family,authorityRoot:principal,writeOwnerRef:owner,
      primaryPlacement:'LOCAL_PRIMARY_HOSTED_REPLICA',allowedLocations:['location:k35:local',location],
      retentionClass:'test',recoveryClass:'test',universalCloudMaster:false,subjectActionAuthority:false},
      primaryNodeRef:source,replicaNodeRefs:[server]}]});
};
function open(access,context,{clock=Date.now,beforeCredentials=async()=>{},onFetch=async()=>{},
  originalConsent=async()=>true}={}){
  const topology=makeTopology(context),records=new Map([[input.key,bytes]]);
  const stats={requests:0,credentials:0,consents:0},proofs=[];
  const connection=openT4NativeTopologyTransport({topology,workspaceId:context.workspace_id,
    objectFamily:family,serverNodeRef:server,nativeWireProfile:'INDEXED',readOriginalTopology:async()=>topology,
    getMode:()=> 'T4_NETWORK',originalSignedAccess:{access,expectedContext:context,clock},
    verifyOriginalEndpoint:async p=>p.endpointUrl===endpointUrl&&p.workspaceId===context.workspace_id,
    authorizeOriginalOperation:async p=>{
      stats.consents++;proofs.push(p);
      return p.originalSignedSubject?.principal_id===context.principal_id&&
        p.originalSignedSubject?.workspace_id===context.workspace_id&&
        p.originalWriteOwnerRef==='owner:'+context.workspace_id&&await originalConsent(p)===true;
    },
    getAuthorizationHeader:async()=>{stats.credentials++;await beforeCredentials();return 'Bearer test-only';},
    fetchImpl:async(url,options)=>{
      stats.requests++;assert.equal(url.href.startsWith(endpointUrl),true);
      await onFetch();
      const key=url.pathname.split('/').at(-1);
      if(options.method==='GET')return records.has(key)?new Response(records.get(key)):new Response(null,{status:404});
      assert.equal(options.method,'PUT');assert.equal(options.headers['If-None-Match'],'*');
      if(records.has(key))return new Response(null,{status:412});
      records.set(key,Buffer.from(options.body));return new Response(null,{status:201});
    }});
  return {connection,stats,proofs,records};
}
function personal(operations=actions){
  return createTemporaryOriginalPersonalAuthority({workspaceId:'ws:k35:personal',operations,
    purpose:'network.synchronization',clock:Date.now});
}
test('K35 original encrypted-vault PERSONAL grant authorizes exact native addresses and readback, not any subject write',async()=>{
  const f=personal(),context=f.access.currentContext(),x=open(f.access,context);
  try{
    assert.equal(x.connection.originalSignedAccessBound,true);
    assert.equal(x.connection.originalAuthorityGranted,false);
    assert.deepEqual((await x.connection.transport.getSnapshot(input)).bytes,bytes);
    const put=await x.connection.transport.putSnapshot({...input,bytes,createOnly:true});
    assert.equal(put.state,'ALREADY_PRESENT_VERIFIED');
    assert.equal(await x.connection.transport.getNativeFrameIndex({key:idx.key}),null);
    assert.equal((await x.connection.transport.putNativeFrameIndex(idx)).frameSha256,hash);
    assert.equal((await x.connection.transport.getNativeFrameIndex({key:idx.key})).frameSha256,hash);
    assert.deepEqual([...new Set(x.proofs.map(p=>p.transportRequest.operation))].sort(),[...actions].sort());
    assert.ok(x.proofs.every(p=>p.originalSignedSubject.grant_id===context.grant_id&&
      p.storageLocationIsNotProtocolPeer&&p.topologyDigest===x.connection.binding.topologyDigest));
    assert.equal(f.proofCount,f.registryReads);assert.ok(f.proofCount>x.stats.requests);
    const requests=x.stats.requests,credentials=x.stats.credentials;
    await assert.rejects(x.connection.transport.listNativeFrameAddresses(),{code:'AUTHORIZATION_DENIED'});
    assert.equal(x.stats.requests,requests);assert.equal(x.stats.credentials,credentials);
  }finally{x.connection.close();}
});
test('K35 original route consent and signed grant are independent, and a Kernel read cannot be relabelled as network access',async()=>{
  const f=personal(['t1.getObject']),context=f.access.currentContext();
  // Real original signed evaluator still decides. Even an explicit Host
  // action mapping cannot add an absent action to the signed grant.
  const exact=createSignedAccessHostPort({currentContext:f.access.currentContext,
    actionFor:op=>op,operationDigest:f.access.operationDigest,canonicalDigest:digest,
    personal:{check:request=>f.access.authorize(request)}});
  const x=open(exact,context);
  try{
    await assert.rejects(x.connection.transport.getSnapshot(input),{code:'ORIGINAL_SIGNED_NETWORK_ACCESS_DENIED'});
    assert.equal(x.stats.credentials,0);assert.equal(x.stats.requests,0);
    assert.ok(f.proofCount>0);
  }finally{x.connection.close();}
  const alias=createSignedAccessHostPort({currentContext:f.access.currentContext,
    actionFor:()=> 'object.read',operationDigest:f.access.operationDigest,canonicalDigest:digest,
    personal:{check:request=>f.access.authorize(request)}});
  const a=open(alias,context);
  try{
    await assert.rejects(a.connection.transport.getSnapshot(input),{code:'ORIGINAL_SIGNED_NETWORK_ACTION_MISMATCH'});
    assert.equal(a.stats.requests,0);assert.equal(a.stats.credentials,0);
  }finally{a.connection.close();}
  const signed=personal(),denied=open(signed.access,signed.access.currentContext(),{originalConsent:async()=>false});
  try{
    await assert.rejects(denied.connection.transport.getSnapshot(input),{code:'ORIGINAL_OPERATION_NOT_AUTHORIZED'});
    assert.equal(signed.proofCount,0);assert.equal(denied.stats.requests,0);assert.equal(denied.stats.credentials,0);
  }finally{denied.connection.close();}
  assert.throws(()=>open(Object.freeze({...signed.access}),signed.access.currentContext()),{code:'ORIGINAL_SIGNED_NETWORK_PORT_REQUIRED'});
  assert.throws(()=>createT4OriginalNativeHostNetworkOwner({requireSignedTopologyAccess:true}),{code:'NATIVE_NETWORK_OWNER_SIGNED_TOPOLOGY_REQUIRED'});
});
test('K35 revocation between original grant check and credential retrieval prevents any HTTPS dispatch',async()=>{
  const f=personal(['t4.network.frame.read']),context=f.access.currentContext();
  const x=open(f.access,context,{beforeCredentials:async()=>f.revoke()});
  try{
    await assert.rejects(x.connection.transport.getSnapshot(input),{code:'ORIGINAL_SIGNED_NETWORK_ACCESS_DENIED'});
    assert.equal(x.stats.credentials,1);assert.equal(x.stats.requests,0);
    assert.equal(f.proofCount,2);assert.equal(f.registryReads,2);
  }finally{x.connection.close();}
});
test('K35 signed context change during a network response blocks disclosure of returned bytes',async()=>{
  const f=personal(['t4.network.frame.read']),context=f.access.currentContext();
  let current=context;
  const access=createSignedAccessHostPort({currentContext:()=>current,
    actionFor:op=>op,operationDigest:f.access.operationDigest,canonicalDigest:digest,
    personal:{check:request=>f.access.authorize(request)}});
  const x=open(access,context,{onFetch:async()=>{current={...context,scope_revision:context.scope_revision+1};}});
  try{
    await assert.rejects(x.connection.transport.getSnapshot(input),{code:'ORIGINAL_SIGNED_NETWORK_CONTEXT_CHANGED'});
    assert.equal(x.stats.requests,1);assert.equal(x.stats.credentials,1);
  }finally{x.connection.close();}
});
test('K35 two signed corporate enrollments use their original Registry and encrypted credential, with independent revocation', {timeout:30000},async()=>{
  const f=model({operations:['t4.network.frame.read']}),kernel=originalKernelFixture();
  const registry=createOriginalKernelRegistryStatePort({kernel:kernel.api,workspaceId:'ws:k35:registry',
    trustedPolicy:f.policy,clock:time});
  await registry.commitSignedState(f.state);
  const gate=createOrganizationalOperationGate({registry}),vault=emptyVault(),keys={};
  for(const entry of Object.values(f.all)){
    const keyId=entry.issuedCredential.publicKeyRef;
    importVaultKey(vault,{keyId,subjectId:entry.context.actor_id,privateKeyPem:entry.credentialPrivateKeyPem,
      expectedPublicKeyPem:f.policy.keys[keyId].publicKey});
  }
  const password='K35_TEST_ONLY_CORPORATE_VAULT_PASSPHRASE',encrypted=encryptVault(vault,password);
  for(const entry of Object.values(f.all)){
    keys[entry.context.organization_id]=createOriginalVaultProofSigner({
      keyId:entry.issuedCredential.publicKeyRef,organizationId:entry.context.organization_id,
      readEncryptedVault:async()=>encrypted,unlockPassphrase:async()=>password});
  }
  let selected=f.all.north.context,proofCount=0;
  const access=createSignedAccessHostPort({currentContext:()=>selected,actionFor:op=>op,
    operationDigest:({operation,input,context})=>digest({operation,input,context}),canonicalDigest:digest,clock:time,
    corporate:{productId:'IWXA_CONTROL_CENTER',gate,
      inputFor:async c=>{
        const e=Object.values(f.all).find(x=>x.context.organization_id===c.organization_id);
        return {profile:e.profile,selection:e.selection,descriptors:e.descriptors,credential:e.issuedCredential,enrollment:e.enrollment};
      },
      prove:async args=>{proofCount++;return keys[args.context.organization_id](args);}
    }});
  assert.equal(isOriginalOrganizationalOperationGateForRegistry(gate,registry),true);
  assert.equal(isOriginalOrganizationalOperationGateForRegistry({...gate},registry),false);
  assert.equal(isOriginalSignedAccessHostPortForEvaluator(access,'CORP',gate),true);
  assert.equal(isOriginalSignedAccessHostPortForEvaluator(access,'PERSONAL',gate),false);
  const north=open(access,selected,{clock:time});let south=null;
  try{
    assert.deepEqual((await north.connection.transport.getSnapshot(input)).bytes,bytes);
    assert.ok(proofCount>0);assert.equal(north.stats.requests,1);
    selected=f.all.south.context;south=open(access,selected,{clock:time});
    await assert.rejects(north.connection.transport.getSnapshot(input),e=>
      ['ORIGINAL_SIGNED_NETWORK_CONTEXT_CHANGED','ORIGINAL_SIGNED_NETWORK_CONTEXT_INVALID'].includes(e.code));
    assert.equal(north.stats.requests,1);assert.equal(north.stats.credentials,1);
    assert.deepEqual((await south.connection.transport.getSnapshot(input)).bytes,bytes);
    const revoked={...f.all.north.status,sequence:2,issuedAt:iso(NOW-1000),
      entries:[{grantId:'grant:north',state:'REVOKED',effectiveAt:iso(NOW-1500),evidenceRef:'evidence:k35:north-revoked'}]};
    const state=structuredClone(f.state);state.statuses['issuer:north']=signRecord(revoked,f.all.north.issuerSigner);
    state.statusFloor['issuer:north']=2;
    await registry.commitSignedState(state);
    selected=f.all.north.context;
    await assert.rejects(north.connection.transport.getSnapshot(input),{code:'T3_ACCESS_NOT_PERMITTED'});
    assert.equal(north.stats.requests,1);assert.equal(north.stats.credentials,1);
    selected=f.all.south.context;
    assert.deepEqual((await south.connection.transport.getSnapshot(input)).bytes,bytes);
    assert.equal(south.stats.requests,2);
    assert.equal((await registry.getStatus()).sequences['issuer:north'],2);
    assert.equal((await registry.getStatus()).sequences['issuer:south'],1);
    console.log('T4_K35_ORIGINAL_SIGNED_CORPORATE_ROUTE_ACCESS_PASS',JSON.stringify({
      independentIssuerKeys:2,independentEncryptedCredentials:2,originalRegistry:true,
      originalProofs:proofCount,revokedNorthDeniedBeforeNetwork:true,southUnaffected:true,
      noOriginalSubjectMutation:true,realKernelRegistryFixture:false,installedProduct:false}));
  }finally{north.connection.close();south?.connection.close();}
});
