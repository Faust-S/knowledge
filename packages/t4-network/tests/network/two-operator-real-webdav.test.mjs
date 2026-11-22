import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {
  createT4NetworkTopology,planT4NetworkRoute,transitionT4NetworkTopology,
  executeT4NetworkRoute
} from '../../src/network/network-topology.mjs';
import {createT4NetworkConnectionProfile} from '../../src/network/operator-connection.mjs';
import {createWebDavPackageTransport,packageSha256} from '../../src/network/webdav-package-transfer.mjs';

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
