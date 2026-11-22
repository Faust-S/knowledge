import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createT4NetworkTopology,planT4NetworkRoute,listT4NetworkChoices,
  executeT4NetworkRoute,T4NetworkTopologyError
} from '../src/network/network-topology.mjs';
import {createT4NetworkConnectionProfile} from '../src/network/operator-connection.mjs';
import {createWebDavPackageTransport,packageSha256} from '../src/network/webdav-package-transfer.mjs';

const ref='t4:network:user';
const full={include_history:true,include_assets:true,include_relations:true,include_schemas:true};
const policy={objectFamily:'orders',workspaceId:'workspace:owner',
  authorityRoot:'original:t3:person',writeOwnerRef:'original:t2:owner',
  primaryPlacement:'LOCAL_PRIMARY_HOSTED_REPLICA',
  allowedLocations:['local:device','home:server','other:provider','iwxa:cloud'],
  retentionClass:'original-owner-retention',recoveryClass:'owner-recovery',
  universalCloudMaster:false,subjectActionAuthority:false};

const p=(profileRef,mode,operatorRef,locationRef,endpointUrl,cloudAgreement)=>createT4NetworkConnectionProfile({
  profileRef,mode,operatorRef,locationRef,endpointUrl,
  ...(cloudAgreement?{cloudAgreement}:{})
});
const agreement={
  schema:'IWXA_T4_CLOUD_PARTICIPATION_AGREEMENT_V1',originalOwnerRef:'original:t3:person',
  authorityEvidenceRef:'t3:original:agreement',termsDigest:'a'.repeat(64),
  permittedDataFamilies:['permitted:analytics'],permittedPurposes:['anonymized:industry:statistics'],
  operatorMayUseVerifiedAnonymizedDerivatives:true,rawSourceDataOwnershipTransferred:false,
  rawSourceDataMayBeRedistributed:false,reidentificationPermitted:false,
};
const profiles=[
  p('profile:home','SELF_HOSTED','owner:person','home:server','https://home.example.net/dav/'),
  p('profile:other','THIRD_PARTY','other:operator','other:provider','https://other.example.net/dav/'),
  p('profile:cloud','IWXA_CLOUD','iwxa:operator','iwxa:cloud','https://cloud.example.net/dav/',agreement),
];
const capabilities=['package.publish','package.read','delta.push','remote.compute'];
const nodes=[
  {nodeRef:'node:local',kind:'LOCAL_DEVICE',subjectRef:'original:t3:person',
    operatorRef:'owner:person',locationRef:'local:device',availability:'AVAILABLE',
    advertisedCapabilities:['package.read']},
  {nodeRef:'node:home',kind:'PERSONAL_SERVER',subjectRef:'original:t3:person',
    operatorRef:'owner:person',locationRef:'home:server',profileRef:'profile:home',
    availability:'AVAILABLE',advertisedCapabilities:['package.read','package.publish','delta.push']},
  {nodeRef:'node:other',kind:'THIRD_PARTY_SERVER',subjectRef:'original:t3:person',
    operatorRef:'other:operator',locationRef:'other:provider',profileRef:'profile:other',
    availability:'AVAILABLE',advertisedCapabilities:['package.read','package.publish']},
  {nodeRef:'node:cloud',kind:'IWXA_CLOUD_SERVER',subjectRef:'original:t3:person',
    operatorRef:'iwxa:operator',locationRef:'iwxa:cloud',profileRef:'profile:cloud',
    availability:'AVAILABLE',advertisedCapabilities:capabilities},
];
const connections=[
  {connectionRef:'link:home',sourceNodeRef:'node:local',targetNodeRef:'node:home',
    profileRef:'profile:home',state:'READY',capabilities:['package.read','package.publish','delta.push'],
    objectFamilies:['orders']},
  {connectionRef:'link:other',sourceNodeRef:'node:local',targetNodeRef:'node:other',
    profileRef:'profile:other',state:'READY',capabilities:['package.read','package.publish'],
    objectFamilies:['orders']},
  {connectionRef:'link:cloud',sourceNodeRef:'node:local',targetNodeRef:'node:cloud',
    profileRef:'profile:cloud',state:'READY',capabilities,objectFamilies:['orders']},
];
const placement={policy,primaryNodeRef:'node:local',
  replicaNodeRefs:['node:home','node:other','node:cloud']};
const build=patch=>createT4NetworkTopology({
  topologyRef:ref,revision:1,localNodeRef:'node:local',
  nodes,profiles,connections,placements:[placement],...patch,
});
const code=expected=>error=>{assert.equal(error.code,expected);return true;};

test('a real T4 multi-operator topology contains only T3 references and declared offered functions',()=>{
  const t=build();
  assert.equal(t.nodes.length,4);
  assert.equal(t.profiles.length,3);
  assert.equal(t.connections.length,3);
  assert.equal(t.placements[0].sourceWriteOwnerRef,'original:t2:owner');
  assert.equal(t.t3SovereignOfflinePreserved,true);
  assert.equal(t.universalCloudMaster,false);
  assert.equal(t.networkTopologyIsNotAnOriginalGrant,true);
  assert.match(t.topologyDigest,/^sha256:[a-f0-9]{64}$/);
});
test('network topology has stable digest under input ordering but changes on a state observation',()=>{
  const t=build();
  const alternate=build({
    nodes:[...nodes].reverse(),profiles:[...profiles].reverse(),
    connections:[...connections].reverse(),
    placements:[{...placement,replicaNodeRefs:[...placement.replicaNodeRefs].reverse()}],
  });
  assert.equal(t.topologyDigest,alternate.topologyDigest);
  const offline=build({nodes:nodes.map(x=>x.nodeRef==='node:home'?
    {...x,availability:'UNREACHABLE'}:x)});
  assert.notEqual(t.topologyDigest,offline.topologyDigest);
});
test('T4 mode and per-family placement choose a nominated server, never a cloud master',()=>{
  const t=build();
  const route=planT4NetworkRoute({topology:t,workspaceId:'workspace:owner',
    objectFamily:'orders',targetNodeRef:'node:home',capability:'package.publish'});
  assert.equal(route.toNodeRef,'node:home');
  assert.equal(route.originalWriteOwnerRef,'original:t2:owner');
  assert.equal(route.isReplicaTarget,true);
  assert.equal(route.executableByCurrentT4,true);
  assert.equal(route.originalOwnerAuthorized,false);
  assert.equal(route.operatorEndpointVerified,false);
  assert.equal(route.derivativeDataRightActivated,false);
});
test('cloud declares capabilities but not permissions, processing or any existing user rights',()=>{
  const t=build();
  const r=planT4NetworkRoute({topology:t,workspaceId:'workspace:owner',
    objectFamily:'orders',targetNodeRef:'node:cloud',capability:'remote.compute'});
  assert.equal(r.mode,'IWXA_CLOUD');
  assert.equal(r.executableByCurrentT4,false);
  assert.equal(t.profiles.find(x=>x.profileRef==='profile:cloud').cloudDerivativeUseActivated,false);
  assert.equal(t.nodes.find(x=>x.nodeRef==='node:cloud').operatorDataRightsGranted,false);
});
test('independent operator cannot be implicitly retyped as IWXA cloud',()=>{
  assert.throws(()=>build({nodes:nodes.map(x=>x.nodeRef==='node:other'?
    {...x,kind:'IWXA_CLOUD_SERVER'}:x)}),code('CLOUD_OPERATOR_PROFILE_MISMATCH'));
});
test('self-hosted server and external provider both remain functional choices',()=>{
  const v=listT4NetworkChoices({topology:build(),workspaceId:'workspace:owner',
    objectFamily:'orders',capability:'package.read'});
  assert.deepEqual(v.map(x=>x.targetNodeRef),['node:cloud','node:home','node:other']);
  assert.ok(v.every(x=>x.state==='OFFERED_NOT_AUTHORIZED'));
});
test('disconnection does not promote any other replica to source owner',()=>{
  const t=build({nodes:nodes.map(x=>x.nodeRef==='node:home'?
    {...x,availability:'UNREACHABLE'}:x)});
  assert.throws(()=>planT4NetworkRoute({topology:t,workspaceId:'workspace:owner',
    objectFamily:'orders',targetNodeRef:'node:home',capability:'package.read'}),
    code('NETWORK_NODE_NOT_AVAILABLE'));
  const other=planT4NetworkRoute({topology:t,workspaceId:'workspace:owner',
    objectFamily:'orders',targetNodeRef:'node:other',capability:'package.read'});
  assert.equal(other.originalWriteOwnerRef,'original:t2:owner');
  assert.equal(t.placements[0].primaryNodeRef,'node:local');
});
test('a paused connection disables routing without disabling local T3',()=>{
  const t=build({connections:connections.map(x=>x.targetNodeRef==='node:cloud'?
    {...x,state:'PAUSED'}:x)});
  assert.throws(()=>planT4NetworkRoute({topology:t,workspaceId:'workspace:owner',
    objectFamily:'orders',targetNodeRef:'node:cloud',capability:'package.publish'}),
    code('NETWORK_CONNECTION_NOT_READY'));
  assert.equal(t.t3SovereignOfflinePreserved,true);
});
test('non-placed arbitrary destination and non-advertised capability are refused',()=>{
  const t=build({placements:[{...placement,replicaNodeRefs:['node:home']}]});
  assert.throws(()=>planT4NetworkRoute({topology:t,workspaceId:'workspace:owner',
    objectFamily:'orders',targetNodeRef:'node:cloud',capability:'package.publish'}),
    code('NETWORK_TARGET_NOT_PLACED'));
  assert.throws(()=>planT4NetworkRoute({topology:build(),workspaceId:'workspace:owner',
    objectFamily:'orders',targetNodeRef:'node:other',capability:'remote.compute'}),
    code('CAPABILITY_NOT_AVAILABLE'));
});
test('invalid or duplicated node location is not a second authority',()=>{
  assert.throws(()=>build({nodes:[...nodes,nodes[1]]}),code('NODE_DUPLICATE'));
  assert.throws(()=>build({nodes:nodes.map(x=>x.nodeRef==='node:home'?
    {...x,locationRef:'iwxa:cloud'}:x)}),code('LOCATION_DUPLICATE'));
});
test('invalid location, hosted primary and cloud-only placement cannot silently change T3 origin',()=>{
  assert.throws(()=>build({placements:[{...placement,primaryNodeRef:'node:cloud'}]}),
    code('PLACEMENT_MODE_TOPOLOGY_MISMATCH'));
  assert.throws(()=>build({placements:[{...placement,policy:{...policy,
    allowedLocations:['local:device','absent:server']}}]}),
    code('UNKNOWN_PLACEMENT_LOCATION'));
  assert.throws(()=>build({placements:[{...placement,policy:{...policy,
    writeOwnerRefs:['original:t2:owner','operator:cloud']}}]}),
    error=>error.code==='MULTIPLE_WRITE_OWNERS');
});
test('advertised server does not execute unsupported future data sync or operator analytics',async()=>{
  const t=build(),callbacks=[];
  await assert.rejects(executeT4NetworkRoute({topology:t,workspaceId:'workspace:owner',
    objectFamily:'orders',targetNodeRef:'node:home',capability:'delta.push',
    getMode:()=>{callbacks.push('mode');return 'T4_NETWORK';},
    verifyOriginalEndpoint:async()=>{callbacks.push('endpoint');return true;},
    authorizeOriginalOperation:async()=>{callbacks.push('owner');return true;},
    executeTransport:async()=>{callbacks.push('execute');}}),code('T4_CAPABILITY_NOT_YET_EXECUTABLE'));
  assert.deepEqual(callbacks,[]);
});
test('real operation rechecks original endpoint, owner permission and T4 mode before transport',async()=>{
  const t=build();const calls=[];
  const operation={topology:t,workspaceId:'workspace:owner',objectFamily:'orders',
    targetNodeRef:'node:home',capability:'package.read',
    getMode:()=>{calls.push('mode');return 'T4_NETWORK';},
    verifyOriginalEndpoint:async ctx=>{calls.push('endpoint');assert.equal(ctx.operatorRef,'owner:person');return true;},
    authorizeOriginalOperation:async ctx=>{calls.push('original');assert.equal(ctx.originalWriteOwnerRef,'original:t2:owner');return true;},
    executeTransport:async ({route})=>{calls.push('transport');return {key:route.profileRef};},
  };
  assert.deepEqual(await executeT4NetworkRoute(operation),{key:'profile:home'});
  assert.deepEqual(calls,['mode','endpoint','mode','original','mode','transport']);
});
test('endpoint rejection prevents original data operations and network transfer',async()=>{
  let hit=0;
  await assert.rejects(executeT4NetworkRoute({
    topology:build(),workspaceId:'workspace:owner',objectFamily:'orders',
    targetNodeRef:'node:cloud',capability:'package.publish',
    getMode:()=> 'T4_NETWORK',verifyOriginalEndpoint:async()=>false,
    authorizeOriginalOperation:async()=>{hit++;return true;},
    executeTransport:async()=>{hit++;},
  }),code('ORIGINAL_ENDPOINT_NOT_VERIFIED'));
  assert.equal(hit,0);
});
test('original denial stops actual network transfer even when cloud advertises service',async()=>{
  let hit=0;
  await assert.rejects(executeT4NetworkRoute({
    topology:build(),workspaceId:'workspace:owner',objectFamily:'orders',
    targetNodeRef:'node:cloud',capability:'package.publish',
    getMode:()=> 'T4_NETWORK',verifyOriginalEndpoint:async()=>true,
    authorizeOriginalOperation:async()=>false,
    executeTransport:async()=>{hit++;},
  }),code('ORIGINAL_OPERATION_NOT_AUTHORIZED'));
  assert.equal(hit,0);
});
test('a changed mode during original checks stops the requested network transfer',async()=>{
  let mode='T4_NETWORK',hit=0;
  await assert.rejects(executeT4NetworkRoute({
    topology:build(),workspaceId:'workspace:owner',objectFamily:'orders',
    targetNodeRef:'node:home',capability:'package.publish',
    getMode:()=>mode,verifyOriginalEndpoint:async()=>{mode='LOCAL_T3';return true;},
    authorizeOriginalOperation:async()=>{hit++;return true;},
    executeTransport:async()=>{hit++;},
  }),code('T4_NETWORK_MODE_DISABLED'));
  assert.equal(hit,0);
});
test('real existing WebDAV transport is selectable through topology without duplicated Store or IAM',async()=>{
  const t=build(),bytes=Buffer.from('native original exchange bytes through a selected home server');
  const key=packageSha256(bytes)+'.iwxa',calls=[];
  const network=createWebDavPackageTransport({
    baseUrl:'https://home.example.net/dav/',locationRef:'home:server',
    placementPolicy:policy,getMode:()=> 'T4_NETWORK',authorize:async()=>true,
    getAuthorizationHeader:async()=> 'Bearer original-t3-host-token',
    fetchImpl:async()=>{calls.push('GET');return new Response(bytes,{status:200});},
  });
  const result=await executeT4NetworkRoute({topology:t,workspaceId:'workspace:owner',
    objectFamily:'orders',targetNodeRef:'node:home',capability:'package.read',
    getMode:()=> 'T4_NETWORK',verifyOriginalEndpoint:async()=>true,
    authorizeOriginalOperation:async()=>true,
    executeTransport:async({route})=>{
      assert.equal(route.locationRef,'home:server');
      return network.getSnapshot({key,expectedSha256:packageSha256(bytes)});
    },
  });
  assert.deepEqual(result.bytes,bytes);
  assert.equal(result.receipt.state,'DOWNLOADED_VERIFIED_BYTES');
  assert.deepEqual(calls,['GET']);network.close();
});
