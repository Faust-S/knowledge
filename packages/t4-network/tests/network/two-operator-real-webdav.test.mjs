import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,sign,verify} from 'node:crypto';
import {
  createT4NetworkTopology,planT4NetworkRoute,transitionT4NetworkTopology,
  executeT4NetworkRoute,openT4NativeTopologyTransport
} from '../../src/network/network-topology.mjs';
import {createT4NetworkConnectionProfile} from '../../src/network/operator-connection.mjs';
import {createWebDavPackageTransport,packageSha256} from '../../src/network/webdav-package-transfer.mjs';
import {createT4CandidateUnsignedFrame,signT4CandidateFrame,decodeT4CandidateFrame} from '../../src/network/standard-network-wire-candidate.mjs';
import {createT4CandidateFrameTransport} from '../../src/network/standard-network-wire-transport.mjs';
import {t4NativeFrameIndexKeys} from '../../src/network/original-network-frame-address.mjs';

const ownUrl=process.env.T4_TEST_URL;
const ownAuth=process.env.T4_TEST_AUTH;
const otherAuth=process.env.T4_TEST_OTHER_AUTH;
if(!ownUrl||!ownAuth||!otherAuth)throw Error('REAL_TWO_WEBDAV_NAMESPACES_REQUIRED');
const second=new URL(ownUrl);
if(!second.pathname.endsWith('/person-a/'))throw Error('EXPECTED_TEST_NAMESPACE_PERSON_A');
second.pathname=second.pathname.slice(0,-'/person-a/'.length)+'/person-b/';
const otherUrl=second.href;

const workspaceId='t4:original-owner:network-route';
const policy={
  objectFamily:'orders',workspaceId,authorityRoot:'t3:original:person',
  writeOwnerRef:'t2:original:owner',primaryPlacement:'LOCAL_PRIMARY_HOSTED_REPLICA',
  allowedLocations:['local:device','server:personal','operator:independent'],
  retentionClass:'original-owner',recoveryClass:'owner-restores',
  universalCloudMaster:false,subjectActionAuthority:false,
};
const definitions={
  topologyRef:'t4:network:qualified:two-namespaces',revision:1,localNodeRef:'device:original',
  nodes:[
    {nodeRef:'device:original',kind:'LOCAL_DEVICE',subjectRef:'t3:original:person',
      operatorRef:'person:original',locationRef:'local:device',
      availability:'AVAILABLE',advertisedCapabilities:['package.read']},
    {nodeRef:'server:personal',kind:'PERSONAL_SERVER',subjectRef:'t3:original:person',
      operatorRef:'person:original',locationRef:'server:personal',profileRef:'profile:own',
      availability:'AVAILABLE',advertisedCapabilities:['package.read','package.publish']},
    {nodeRef:'server:independent',kind:'THIRD_PARTY_SERVER',subjectRef:'t3:original:person',
      operatorRef:'operator:independent',locationRef:'operator:independent',profileRef:'profile:other',
      availability:'AVAILABLE',advertisedCapabilities:['package.read','package.publish']},
  ],
  profiles:[
    createT4NetworkConnectionProfile({profileRef:'profile:own',mode:'SELF_HOSTED',
      operatorRef:'person:original',locationRef:'server:personal',endpointUrl:ownUrl}),
    createT4NetworkConnectionProfile({profileRef:'profile:other',mode:'THIRD_PARTY',
      operatorRef:'operator:independent',locationRef:'operator:independent',endpointUrl:otherUrl}),
  ],
  connections:[
    {connectionRef:'route:own',sourceNodeRef:'device:original',targetNodeRef:'server:personal',
      profileRef:'profile:own',state:'READY',
      capabilities:['package.read','package.publish'],objectFamilies:['orders']},
    {connectionRef:'route:other',sourceNodeRef:'device:original',targetNodeRef:'server:independent',
      profileRef:'profile:other',state:'READY',
      capabilities:['package.read','package.publish'],objectFamilies:['orders']},
  ],
  placements:[{policy,primaryNodeRef:'device:original',replicaNodeRefs:['server:personal']}],
};

const selectedTransport=(endpoint,auth,location)=>createWebDavPackageTransport({
  baseUrl:endpoint,locationRef:location,placementPolicy:policy,
  getMode:()=> 'T4_NETWORK',authorize:async()=>true,
  getAuthorizationHeader:async()=>auth,
});
const request=({topology,targetNodeRef,capability,transport,key,bytes})=>
  executeT4NetworkRoute({
    topology,workspaceId,objectFamily:'orders',targetNodeRef,capability,
    getMode:()=> 'T4_NETWORK',
    verifyOriginalEndpoint:async ctx=>{
      const expected=targetNodeRef==='server:personal'?ownUrl:otherUrl;
      return ctx.endpointUrl===expected&&
        ctx.originalWriteOwnerRef==='t2:original:owner';
    },
    authorizeOriginalOperation:async ctx=>ctx.workspaceId===workspaceId&&
      ctx.originalWriteOwnerRef==='t2:original:owner',
    executeTransport:async()=>capability==='package.publish'?
      transport.putSnapshot({key,bytes,expectedSha256:packageSha256(bytes),createOnly:true}):
      transport.getSnapshot({key,expectedSha256:packageSha256(bytes)}),
  });

test('two isolated authenticated WebDAV namespaces preserve source owner through server migration',async()=>{
  const first=createT4NetworkTopology(definitions);
  const bytes=Buffer.from('T4 real routing and migration '+randomUUID());
  const digest=packageSha256(bytes),key=digest+'.iwxa';
  const own=selectedTransport(ownUrl,ownAuth,'server:personal');
  const other=selectedTransport(otherUrl,otherAuth,'operator:independent');
  try{
    const upload=await request({topology:first,targetNodeRef:'server:personal',
      capability:'package.publish',transport:own,key,bytes});
    assert.equal(upload.state,'PUBLISHED_AND_READ_BACK');
    const initial=await request({topology:first,targetNodeRef:'server:personal',
      capability:'package.read',transport:own,key,bytes});
    assert.deepEqual(initial.bytes,bytes);
    const next=createT4NetworkTopology({...first,revision:2,
      previousTopologyDigest:first.topologyDigest,
      placements:[{policy,primaryNodeRef:'device:original',
        replicaNodeRefs:['server:independent']}],
    });
    const approved=await transitionT4NetworkTopology({
      previous:first,candidate:next,authorizeOriginalTopologyChange:async ctx=>
        ctx.originalWriteOwnerRef==='t2:original:owner'&&
        ctx.candidateReplicaNodeRefs.includes('server:independent'),
    });
    assert.equal(approved.placements[0].sourceWriteOwnerRef,'t2:original:owner');
    assert.throws(()=>planT4NetworkRoute({topology:approved,workspaceId,
      objectFamily:'orders',targetNodeRef:'server:personal',capability:'package.read'}),
      e=>e.code==='NETWORK_TARGET_NOT_PLACED');
    const transferred=await request({topology:approved,targetNodeRef:'server:independent',
      capability:'package.publish',transport:other,key,bytes});
    assert.equal(transferred.state,'PUBLISHED_AND_READ_BACK');
    const restored=await request({topology:approved,targetNodeRef:'server:independent',
      capability:'package.read',transport:other,key,bytes});
    assert.deepEqual(restored.bytes,bytes);
    // Migration does not silently erase the original snapshot at the former server.
    const previous=await own.inspectOutcome({key,expectedSha256:digest});
    assert.equal(previous.state,'EXPECTED_BYTES_PRESENT');
  }finally{own.close();other.close();}
});

test('the original user cannot read the independent operator namespace with old credentials',async()=>{
  const bytes=Buffer.from('T4 isolated operator namespace '+randomUUID());
  const digest=packageSha256(bytes),key=digest+'.iwxa';
  const other=selectedTransport(otherUrl,otherAuth,'operator:independent');
  const wrong=selectedTransport(otherUrl,ownAuth,'operator:independent');
  try{
    const published=await other.putSnapshot({key,bytes,expectedSha256:digest,createOnly:true});
    assert.equal(published.state,'PUBLISHED_AND_READ_BACK');
    await assert.rejects(wrong.getSnapshot({key,expectedSha256:digest}),
      e=>e.code==='REMOTE_AUTHORIZATION_DENIED');
  }finally{other.close();wrong.close();}
});

test('K34 real indexed native route follows admitted operator placement without changing signed peer or original owner',async()=>{
  const caps=['network.frame.publish','network.frame.read','network.frame.index.publish','network.frame.index.read'];
  const first=createT4NetworkTopology({...definitions,
    nodes:definitions.nodes.map(n=>n.kind==='LOCAL_DEVICE'?n:{...n,advertisedCapabilities:[...n.advertisedCapabilities,...caps]}),
    connections:definitions.connections.map(c=>({...c,capabilities:[...c.capabilities,...caps]}))});
  let current=first,requests=0,credentials=0,signatures=0;
  const open=(topology,serverNodeRef,auth)=>openT4NativeTopologyTransport({topology,
    workspaceId,objectFamily:'orders',serverNodeRef,nativeWireProfile:'INDEXED',
    readOriginalTopology:async()=>current,getMode:()=> 'T4_NETWORK',
    verifyOriginalEndpoint:async p=>p.endpointUrl===(serverNodeRef==='server:personal'?ownUrl:otherUrl)&&
      p.originalWriteOwnerRef===policy.writeOwnerRef,
    authorizeOriginalOperation:async p=>p.workspaceId===workspaceId&&p.originalWriteOwnerRef===policy.writeOwnerRef&&
      p.storageLocationIsNotProtocolPeer===true,
    getAuthorizationHeader:async()=>{credentials++;return auth;},
    fetchImpl:async(url,options)=>{requests++;assert.notEqual(options.method,'PROPFIND');return fetch(url,options);}
  });
  const keys=generateKeyPairSync('ed25519'),sourceNodeRef='device:original',recipientNodeRef='device:recipient',
    scopeRef='scope:k34',sessionRef='session:k34:'+randomUUID(),suite='X25519_AES256GCM_ED25519';
  const bytes=await signT4CandidateFrame({unsignedFrame:createT4CandidateUnsignedFrame({
    messageType:'HEADS',messageId:'message:'+randomUUID(),sourceNodeRef,recipientNodeRef,scopeRef,sessionRef,
    ownerEpoch:1,sequence:1,permissionRef:'permission:k34',signerRef:'key:k34',cryptoSuite:suite,
    body:{familyRef:'family:k34',ownerEpoch:1,heads:['sha256:'+'a'.repeat(64)]},
  }),signOriginalNodeBytes:async({bytes})=>{signatures++;return sign(null,Buffer.from(bytes),keys.privateKey);}});
  const key=packageSha256(bytes)+'.t4n',sha256=packageSha256(bytes);
  const framePort=(connection,node)=>createT4CandidateFrameTransport({wireTransport:connection.transport,
    getMode:()=> 'T4_NETWORK',originalHostNodeRef:node,originalHostScopeRef:scopeRef,
    readOriginalHostContext:async()=>({nodeRef:node,scopeRef,originalOwnerRef:policy.writeOwnerRef,hostSessionRef:'host:k34'}),
    authorizeOriginalHostWire:async()=>true,
    verifyOriginalNodeSignature:async p=>p.signerRef==='key:k34'&&verify(null,Buffer.from(p.bytes),keys.publicKey,Buffer.from(p.signature)),
    authorizeOriginalNetwork:async p=>p.sourceNodeRef===sourceNodeRef&&p.recipientNodeRef===recipientNodeRef,
    persistOriginalReplayDecision:async()=> 'RECORDED'});
  const old=open(first,'server:personal',ownAuth);
  let next=null,wrong=null;
  try{
    await framePort(old,sourceNodeRef).publishSignedFrame({wireBytes:bytes});
    const index=t4NativeFrameIndexKeys(decodeT4CandidateFrame(bytes))[0];
    assert.equal((await old.transport.getNativeFrameIndex({key:index})).frameSha256,sha256);
    const received=await framePort(old,recipientNodeRef).discoverUniqueSignedFrame({
      selector:{sourceNodeRef,sessionRef,ownerEpoch:1,messageType:'HEADS',sequence:1},requiredCryptoSuite:suite});
    assert.equal(received.receipt.originalSignatureVerified,true);assert.equal(received.receipt.sha256,sha256);
    assert.equal(received.receipt.originalBusinessApplied,false);
    const candidate=createT4NetworkTopology({...first,revision:2,previousTopologyDigest:first.topologyDigest,
      placements:[{policy,primaryNodeRef:'device:original',replicaNodeRefs:['server:independent']}]});
    current=await transitionT4NetworkTopology({previous:first,candidate,
      authorizeOriginalTopologyChange:async p=>p.originalWriteOwnerRef===policy.writeOwnerRef});
    const r=requests,c=credentials;
    await assert.rejects(old.transport.getSnapshot({key,expectedSha256:sha256}),e=>e.code==='ORIGINAL_NATIVE_TOPOLOGY_CHANGED');
    assert.equal(requests,r);assert.equal(credentials,c);
    next=open(current,'server:independent',otherAuth);
    assert.equal(await next.transport.getNativeFrameIndex({key:index}),null);
    await framePort(next,sourceNodeRef).publishSignedFrame({wireBytes:bytes});
    assert.equal(signatures,1);
    assert.equal((await next.transport.getNativeFrameIndex({key:index})).frameSha256,sha256);
    assert.deepEqual((await next.transport.getSnapshot({key,expectedSha256:sha256})).bytes,Buffer.from(bytes));
    wrong=open(current,'server:independent',ownAuth);
    await assert.rejects(wrong.transport.getNativeFrameIndex({key:index}),e=>e.code==='REMOTE_AUTHORIZATION_DENIED');
    assert.equal(next.binding.originalWriteOwnerRef,policy.writeOwnerRef);
    console.log('T4_K34_REAL_NATIVE_TOPOLOGY_OPERATOR_ROUTE_PASS',JSON.stringify({
      originalOwnerUnchanged:true,signedFrameUnchanged:true,oldRouteRefusedBeforeNetwork:true,
      independentAuthenticatedNamespaces:2,oldOperatorCredentialsDenied:true,signatureCalls:signatures,
      automaticSubjectMigrationClaimed:false,physicalIndependentServers:false}));
  }finally{old.close();next?.close();wrong?.close();}
});
