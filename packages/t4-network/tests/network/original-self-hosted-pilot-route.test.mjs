import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {X509Certificate,createHash,randomBytes,generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {createT4NetworkTopology,openT4NativeTopologyTransport} from '../../src/network/network-topology.mjs';
import {createT4OriginalSelfHostedPilotRoute} from '../../src/network/original-self-hosted-pilot-route.mjs';
import {packageSha256} from '../../src/network/webdav-package-transfer.mjs';
import {createT4CandidateUnsignedFrame,signT4CandidateFrame} from '../../src/network/standard-network-wire-candidate.mjs';
import {createTemporaryOriginalPersonalAuthority} from '../../../t3-core/tests/support/t3-original-personal-authority.mjs';
const url=process.env.T4_TEST_URL,auth=process.env.T4_TEST_AUTH,peerAuth=process.env.T4_TEST_PEER_AUTH;
if(!url||!auth||!peerAuth||!process.env.NODE_EXTRA_CA_CERTS)throw Error('REAL_APACHE_PILOT_REQUIRED');
const ca=readFileSync(process.env.NODE_EXTRA_CA_CERTS,'utf8');
const pin=createHash('sha256').update(new X509Certificate(ca).raw).digest('hex');
const caps=['network.frame.read','network.frame.publish','network.frame.index.read','network.frame.index.publish'];
const actions=caps.map(x=>'t4.'+x),family='network:pilot',server='node:pilot:apache',location='location:pilot:apache';
function fixture({node='node:pilot:source',authorization=auth,certificateSha256=pin,onCredential=()=>{},simple=false}={}){
  const original=createTemporaryOriginalPersonalAuthority({workspaceId:'ws:pilot:real',operations:actions,purpose:'network.synchronization',clock:Date.now});
  const context=original.access.currentContext(),workspaceId=context.workspace_id,principal=context.principal_id,owner='owner:'+workspaceId;
  let live=true,credentials=0;
  const topology=createT4NetworkTopology({topologyRef:'topology:'+node,revision:1,localNodeRef:node,
    nodes:[{nodeRef:node,kind:'LOCAL_DEVICE',subjectRef:principal,operatorRef:principal,
      locationRef:'location:'+node,availability:'AVAILABLE',advertisedCapabilities:[]},
      {nodeRef:server,kind:'PERSONAL_SERVER',subjectRef:principal,operatorRef:principal,
        locationRef:location,profileRef:'profile:pilot',availability:'AVAILABLE',advertisedCapabilities:caps}],
    profiles:[{profileRef:'profile:pilot',mode:'SELF_HOSTED',operatorRef:principal,locationRef:location,endpointUrl:url}],
    connections:[{connectionRef:'connection:pilot',sourceNodeRef:node,targetNodeRef:server,
      profileRef:'profile:pilot',state:'READY',capabilities:caps,objectFamilies:[family]}],
    placements:[{policy:{workspaceId,objectFamily:family,authorityRoot:principal,writeOwnerRef:owner,
      primaryPlacement:'LOCAL_PRIMARY_HOSTED_REPLICA',allowedLocations:['location:'+node,location],
      retentionClass:'pilot',recoveryClass:'pilot',universalCloudMaster:false,subjectActionAuthority:false},
      primaryNodeRef:node,replicaNodeRefs:[server]}]});
  let selection={confirmed:true,...(simple?{endpointUrl:url}:{topology}),ca,certificateSha256};
  const selected=createT4OriginalSelfHostedPilotRoute({workspaceId,...(simple?{}:{objectFamily:family,serverNodeRef:server}),
    localNodeRef:node,originalWriteOwnerRef:owner,authorityRoot:principal,
    getMode:()=> 'T4_NETWORK',isOriginalHostActive:()=>live,readOriginalSelection:()=>selection,
    async readOriginalAuthorization(){credentials++;await onCredential();return authorization;}});
  const connection=openT4NativeTopologyTransport({...selected,workspaceId,nativeWireProfile:'INDEXED',
    getMode:()=> 'T4_NETWORK',originalSignedAccess:{access:original.access,expectedContext:context}});
  return {selected,connection,original,transport:connection.transport,
    change(p){selection={...selection,...p};},stop(){live=false;},get credentials(){return credentials;},
    close(){connection.close();original.closeOriginalVault();}};
}
const keyPair=generateKeyPairSync('ed25519');
async function payload(){
  // Legacy discovery in the same Apache fixture parses every .t4n. Use
  // a real canonical signed frame in an unrelated pilot scope, not junk
  // transport bytes that would contaminate the shared collection.
  const bytes=Buffer.from(await signT4CandidateFrame({unsignedFrame:createT4CandidateUnsignedFrame({
    messageType:'HEADS',messageId:'message:'+randomUUID(),sourceNodeRef:'node:pilot:source',
    recipientNodeRef:'node:pilot:recipient',scopeRef:'scope:pilot:route',sessionRef:'session:'+randomUUID(),
    ownerEpoch:1,sequence:1,permissionRef:'permission:pilot',signerRef:'key:pilot',
    cryptoSuite:'X25519_AES256GCM_ED25519',
    body:{familyRef:'family:pilot',ownerEpoch:1,heads:['sha256:'+randomBytes(32).toString('hex')]}}),
    signOriginalNodeBytes:async({bytes})=>sign(null,Buffer.from(bytes),keyPair.privateKey)}));
  const expectedSha256=packageSha256(bytes);return {bytes,expectedSha256,key:expectedSha256+'.t4n'};
}
test('real Apache original signed route, two independent credentials and native immutable index',async()=>{
  const a=fixture(),b=fixture({node:'node:pilot:recipient',authorization:peerAuth}),p=await payload(),idx={key:randomBytes(32).toString('hex')+'.t4i',frameSha256:p.expectedSha256};
  try{
    assert.equal(a.connection.originalSignedAccessBound,true);
    assert.equal((await a.transport.putSnapshot({...p,createOnly:true})).state,'PUBLISHED_AND_READ_BACK');
    assert.equal((await b.transport.putSnapshot({...p,createOnly:true})).state,'ALREADY_PRESENT_VERIFIED');
    assert.deepEqual((await b.transport.getSnapshot(p)).bytes,p.bytes);
    assert.equal(await a.transport.getNativeFrameIndex({key:idx.key}),null);
    assert.equal((await b.transport.putNativeFrameIndex(idx)).frameSha256,p.expectedSha256);
    assert.equal((await a.transport.getNativeFrameIndex({key:idx.key})).frameSha256,p.expectedSha256);
    assert.ok(a.original.proofCount>a.credentials&&b.original.proofCount>b.credentials);
    await assert.rejects(a.transport.listNativeFrameAddresses(),{code:'AUTHORIZATION_DENIED'});
    console.log('T4_REAL_NATIVE_SELF_HOSTED_SIGNED_ROUTE_PASS');
  }finally{a.close();b.close();}
});
test('wrong certificate and unrelated transport account cannot write',async()=>{
  const p=await payload(),wrongPin=fixture({certificateSha256:'0'.repeat(64)}),wrongAuth=fixture({authorization:process.env.T4_TEST_OTHER_AUTH}),a=fixture();
  try{
    await assert.rejects(wrongPin.transport.getSnapshot(p),{code:'NETWORK_UNAVAILABLE'});
    await assert.rejects(wrongPin.transport.putSnapshot({...p,createOnly:true}),{code:'OUTCOME_UNKNOWN'});
    await assert.rejects(a.transport.getSnapshot(p),{code:'REMOTE_NOT_FOUND'});
    await assert.rejects(wrongAuth.transport.putSnapshot({...p,createOnly:true}),{code:'REMOTE_AUTHORIZATION_DENIED'});
    await assert.rejects(a.transport.getSnapshot(p),{code:'REMOTE_NOT_FOUND'});
  }finally{wrongPin.close();wrongAuth.close();a.close();}
});
test('changed route and revoked original signed grant block dispatch',async()=>{
  const a=fixture(),p=await payload();
  try{
    a.change({certificateSha256:'0'.repeat(64)});
    await assert.rejects(a.transport.getSnapshot(p),{code:'T4_PILOT_NATIVE_ROUTE_CHANGED'});
    assert.equal(a.credentials,0);
  }finally{a.close();}
  let f;
  f=fixture({onCredential:()=>f.original.revoke()});
  try{
    await assert.rejects(f.transport.putSnapshot({...p,createOnly:true}),{code:'ORIGINAL_SIGNED_NETWORK_ACCESS_DENIED'});
    assert.equal(f.credentials,1);
    const a=fixture();try{await assert.rejects(a.transport.getSnapshot(p),{code:'REMOTE_NOT_FOUND'});}finally{a.close();}
  }finally{f.close();}
});
test('HTTPS adapter cannot follow redirects or send credentials to another collection',async()=>{
  const a=fixture(),p=await payload(),signal=new AbortController().signal;
  const options={method:'GET',redirect:'manual',signal,headers:{authorization:auth}};
  try{
    for(const target of [new URL('../'+p.key,url),new URL(p.key+'?query=1',url),new URL('https://other.invalid/'+p.key)])
      await assert.rejects(a.selected.fetchImpl(target,options),{code:'T4_PILOT_HTTPS_REQUEST_SCOPE_DENIED'});
    await assert.rejects(a.selected.fetchImpl(new URL(p.key,url),{...options,redirect:'follow'}),{code:'T4_PILOT_HTTPS_REQUEST_SCOPE_DENIED'});
    a.stop();await assert.rejects(a.transport.getSnapshot(p),{code:'T4_PILOT_NATIVE_ROUTE_INACTIVE'});
  }finally{a.close();}
});

test('native endpoint-only settings derive the same server and original owner without manual topology',async()=>{
  const a=fixture({simple:true}),b=fixture({simple:true,node:'node:pilot:recipient',authorization:peerAuth}),p=await payload();
  try{
    assert.equal(a.selected.serverNodeRef,b.selected.serverNodeRef);
    assert.notEqual(a.selected.topology.localNodeRef,b.selected.topology.localNodeRef);
    assert.equal(a.connection.binding.originalWriteOwnerRef,b.connection.binding.originalWriteOwnerRef);
    assert.equal(a.selected.topology.profiles[0].endpointUrl,url);
    assert.equal((await a.transport.putSnapshot({...p,createOnly:true})).state,'PUBLISHED_AND_READ_BACK');
    assert.deepEqual((await b.transport.getSnapshot(p)).bytes,p.bytes);
    a.change({endpointUrl:new URL('../person-b/',url).href});
    await assert.rejects(a.transport.getSnapshot(p),{code:'T4_PILOT_NATIVE_ROUTE_SCOPE_DENIED'});
  }finally{a.close();b.close();}
});
