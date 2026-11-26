import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  createT4NetworkTopology,validateT4NetworkTopology,T4_TOPOLOGY_CANONICAL_ORDER,planT4NetworkRoute,listT4NetworkChoices,
  executeT4NetworkRoute,transitionT4NetworkTopology,T4NetworkTopologyError,openT4NativeTopologyTransport
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
  assert.throws(()=>build({placements:[{...placement,primaryNodeRef:'node:cloud',
    replicaNodeRefs:['node:home','node:other']}]}),
    code('PLACEMENT_MODE_TOPOLOGY_MISMATCH'));
  assert.throws(()=>build({placements:[{...placement,policy:{...policy,
    allowedLocations:['local:device','absent:server']}}]}),
    code('UNKNOWN_PLACEMENT_LOCATION'));
  assert.throws(()=>build({placements:[{...placement,policy:{...policy,
    writeOwnerRefs:['original:t2:owner','operator:cloud']}}]}),
    error=>error.code==='MULTIPLE_WRITE_OWNERS');
});
test('advertised future cloud compute is not executable before its actual engine exists',async()=>{
  const t=build(),callbacks=[];
  await assert.rejects(executeT4NetworkRoute({topology:t,workspaceId:'workspace:owner',
    objectFamily:'orders',targetNodeRef:'node:cloud',capability:'remote.compute',
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


test('a new topology revision has an explicit content-addressed parent',()=>{
  const before=build();
  assert.throws(()=>createT4NetworkTopology({
    ...before,revision:2,previousTopologyDigest:'invalid'
  }),code('TOPOLOGY_PARENT_DIGEST_INVALID'));
  const after=createT4NetworkTopology({
    ...before,revision:2,previousTopologyDigest:before.topologyDigest
  });
  assert.equal(after.previousTopologyDigest,before.topologyDigest);
  assert.notEqual(after.topologyDigest,before.topologyDigest);
});

test('user-authorized topology revision marks an offline home server but cannot promote replicas',async()=>{
  const before=build();
  const after=createT4NetworkTopology({
    ...before,revision:2,previousTopologyDigest:before.topologyDigest,
    nodes:before.nodes.map(x=>x.nodeRef==='node:home'?
      {...x,availability:'UNREACHABLE'}:x),
  });
  const approvals=[];
  const accepted=await transitionT4NetworkTopology({
    previous:before,candidate:after,authorizeOriginalTopologyChange:async ctx=>{
      approvals.push(ctx);return ctx.originalWriteOwnerRef==='original:t2:owner';
    },
  });
  assert.equal(accepted.topologyDigest,after.topologyDigest);
  assert.equal(approvals.length,1);
  assert.equal(approvals[0].previousTopologyDigest,before.topologyDigest);
  assert.equal(approvals[0].candidateTopologyDigest,after.topologyDigest);
  assert.equal(approvals[0].changesExistingOriginalOwner,false);
  assert.equal(accepted.placements[0].primaryNodeRef,'node:local');
});

test('server change is staged as an owner-authorized placement update, not an implicit provider transfer',async()=>{
  const before=build();
  const after=createT4NetworkTopology({
    ...before,revision:2,previousTopologyDigest:before.topologyDigest,
    placements:[{...placement,replicaNodeRefs:['node:other','node:cloud']}],
  });
  await assert.rejects(transitionT4NetworkTopology({
    previous:before,candidate:after,authorizeOriginalTopologyChange:async()=>false
  }),code('ORIGINAL_T3_TOPOLOGY_REVISION_DENIED'));
  const allowed=await transitionT4NetworkTopology({
    previous:before,candidate:after,authorizeOriginalTopologyChange:async()=>true
  });
  assert.throws(()=>planT4NetworkRoute({topology:allowed,workspaceId:'workspace:owner',
    objectFamily:'orders',targetNodeRef:'node:home',capability:'package.read'}),
    code('NETWORK_TARGET_NOT_PLACED'));
  assert.equal(allowed.placements[0].sourceWriteOwnerRef,'original:t2:owner');
});

test('T4 route topology revision cannot take over original writer ownership',async()=>{
  const before=build();
  const altered=createT4NetworkTopology({
    ...before,revision:2,previousTopologyDigest:before.topologyDigest,
    placements:[{...placement,policy:{...policy,writeOwnerRef:'operator:cloud'}}],
  });
  let authorizations=0;
  await assert.rejects(transitionT4NetworkTopology({
    previous:before,candidate:altered,
    authorizeOriginalTopologyChange:async()=>{authorizations++;return true;}
  }),code('ORIGINAL_T3_WRITE_AUTHORITY_IMMUTABLE'));
  assert.equal(authorizations,0);
});

test('a remote node cannot replace its operator or endpoint behind the same network identity',async()=>{
  const before=build();
  const switched=createT4NetworkTopology({
    ...before,revision:2,previousTopologyDigest:before.topologyDigest,
    nodes:before.nodes.map(n=>n.nodeRef==='node:home'?
      {...n,operatorRef:'other:operator'}:n),
    profiles:before.profiles.map(p=>p.profileRef==='profile:home'?
      {...p,operatorRef:'other:operator'}:p),
  });
  let granted=0;
  await assert.rejects(transitionT4NetworkTopology({
    previous:before,candidate:switched,
    authorizeOriginalTopologyChange:async()=>{granted++;return true;}
  }),code('NODE_IDENTITY_RETARGET_FORBIDDEN'));
  assert.equal(granted,0);
});

test('T4 delta route is now executable only where a specific server and connection advertise it',async()=>{
 const topology=build();
 const allowed=planT4NetworkRoute({topology,workspaceId:'workspace:owner',
   objectFamily:'orders',targetNodeRef:'node:home',capability:'delta.push'});
 assert.equal(allowed.executableByCurrentT4,true);
 assert.equal(allowed.originalOwnerAuthorized,false);
 assert.equal(allowed.isReplicaTarget,true);
 assert.throws(()=>planT4NetworkRoute({topology,workspaceId:'workspace:owner',
   objectFamily:'orders',targetNodeRef:'node:other',capability:'delta.push'}),
   code('CAPABILITY_NOT_AVAILABLE'));
});
test('delta executable route rechecks original owner before the callback can use its transport',async()=>{
 const topology=build(),steps=[];
 const receipt=await executeT4NetworkRoute({topology,workspaceId:'workspace:owner',
   objectFamily:'orders',targetNodeRef:'node:home',capability:'delta.push',
   getMode:()=>{steps.push('mode');return 'T4_NETWORK';},
   verifyOriginalEndpoint:async c=>{steps.push('endpoint');return c.endpointUrl==='https://home.example.net/dav/';},
   authorizeOriginalOperation:async c=>{steps.push('owner');return c.operation==='delta.push'&&
     c.originalWriteOwnerRef==='original:t2:owner';},
   executeTransport:async({route})=>{steps.push('transport');return {to:route.toNodeRef};}
 });
 assert.deepEqual(receipt,{to:'node:home'});
 assert.deepEqual(steps,['mode','endpoint','mode','owner','mode','transport']);
});

test('K34 same original topology profile identity cannot silently replace its HTTPS endpoint',async()=>{
  const before=build(),after=createT4NetworkTopology({...before,revision:2,
    previousTopologyDigest:before.topologyDigest,profiles:before.profiles.map(p=>p.profileRef==='profile:home'?
      {...p,endpointUrl:'https://different.example.net/dav/'}:p)});
  let calls=0;
  await assert.rejects(transitionT4NetworkTopology({previous:before,candidate:after,
    authorizeOriginalTopologyChange:async()=>{calls++;return true;}}),code('PROFILE_IDENTITY_RETARGET_FORBIDDEN'));
  assert.equal(calls,0);
});
const nativeCaps=['network.frame.publish','network.frame.read','network.frame.index.publish','network.frame.index.read'];
function nativeTopology(){
  return build({nodes:nodes.map(n=>n.nodeRef==='node:home'?{...n,advertisedCapabilities:[...n.advertisedCapabilities,...nativeCaps]}:n),
    connections:connections.map(c=>c.targetNodeRef==='node:home'?{...c,capabilities:[...c.capabilities,...nativeCaps]}:c)});
}
test('K34 original native indexed transport uses selected T4.1 operator and rejects stale topology before credentials or network',async()=>{
  const topology=nativeTopology(),b=Buffer.from('opaque original native frame');
  let current=topology,requests=0,credentials=0,authorizations=0,endpoints=0,allowed=true;
  const opened=openT4NativeTopologyTransport({topology,workspaceId:'workspace:owner',objectFamily:'orders',
    serverNodeRef:'node:home',nativeWireProfile:'INDEXED',readOriginalTopology:async()=>current,
    getMode:()=> 'T4_NETWORK',verifyOriginalEndpoint:async p=>{
      endpoints++;return p.endpointUrl==='https://home.example.net/dav/'&&p.originalWriteOwnerRef==='original:t2:owner';
    },authorizeOriginalOperation:async p=>{
      authorizations++;return allowed&&p.transportRequest.operation==='t4.network.frame.read'&&
        p.storageLocationIsNotProtocolPeer===true&&p.serverNodeRef==='node:home';
    },getAuthorizationHeader:async()=>{credentials++;return 'Bearer test';},
    fetchImpl:async(url,options)=>{requests++;assert.equal(url.origin,'https://home.example.net');assert.equal(options.method,'GET');return new Response(b);}});
  try{
    const input={key:packageSha256(b)+'.t4n',expectedSha256:packageSha256(b)};
    assert.equal(opened.transport.nativeFrameIndexVersion,1);
    assert.deepEqual((await opened.transport.getSnapshot(input)).bytes,b);
    assert.equal(requests,1);assert.equal(credentials,1);assert.ok(authorizations>0&&endpoints>0);
    await assert.rejects(opened.transport.listNativeFrameAddresses(),e=>e.code==='AUTHORIZATION_DENIED');
    assert.equal(requests,1);assert.equal(credentials,1);
    allowed=false;
    await assert.rejects(opened.transport.getSnapshot(input),code('ORIGINAL_OPERATION_NOT_AUTHORIZED'));
    assert.equal(requests,1);assert.equal(credentials,1);
    allowed=true;current=createT4NetworkTopology({...topology,revision:2,previousTopologyDigest:topology.topologyDigest});
    await assert.rejects(opened.transport.getSnapshot(input),code('ORIGINAL_NATIVE_TOPOLOGY_CHANGED'));
    assert.equal(requests,1);assert.equal(credentials,1);
    assert.equal(opened.binding.originalWriteOwnerRef,'original:t2:owner');assert.equal(opened.protocolPeerReassigned,false);
  }finally{opened.close();}
});
test('K34 native profile requires explicit capabilities and rejects a forged topology digest',()=>{
  const topology=nativeTopology(),options={topology,workspaceId:'workspace:owner',objectFamily:'orders',
    serverNodeRef:'node:home',nativeWireProfile:'INDEXED',readOriginalTopology:async()=>topology,
    getMode:()=> 'T4_NETWORK',verifyOriginalEndpoint:async()=>true,authorizeOriginalOperation:async()=>true,
    getAuthorizationHeader:async()=> 'Bearer test'};
  assert.throws(()=>openT4NativeTopologyTransport({...options,topology:{...topology,topologyDigest:'sha256:'+'a'.repeat(64)}}),code('TOPOLOGY_DIGEST_MISMATCH'));
  assert.throws(()=>openT4NativeTopologyTransport({...options,topology:build()}),code('CAPABILITY_NOT_AVAILABLE'));
  assert.throws(()=>openT4NativeTopologyTransport({...options,nativeWireProfile:'LEGACY'}),code('CAPABILITY_NOT_AVAILABLE'));
});

// Independent reproduction of the previous V1 byte representation. Its
// array order was locale-sensitive; old stored bytes must not be rewritten.
function mixedTopology(revision=1,previousTopologyDigest=null){
  const rename={ 'node:home':'node:A','node:other':'node:a',
    'profile:home':'profile:A','profile:other':'profile:a','link:home':'link:A','link:other':'link:a'};
  const change=x=>rename[x]??x;
  const p=[{...placement,replicaNodeRefs:placement.replicaNodeRefs.map(change)},
    {...placement,policy:{...placement.policy,objectFamily:'Orders'},replicaNodeRefs:placement.replicaNodeRefs.map(change)}];
  return build({revision,previousTopologyDigest,nodes:nodes.map(n=>({...n,nodeRef:change(n.nodeRef),profileRef:change(n.profileRef)})),
    profiles:profiles.map(p=>({...p,profileRef:change(p.profileRef)})),connections:connections.map(c=>({...c,
      connectionRef:change(c.connectionRef),targetNodeRef:change(c.targetNodeRef),profileRef:change(c.profileRef)})),placements:p});
}
const canonical=value=>Array.isArray(value)?value.map(canonical):
  value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
function oldDigest(raw){return 'sha256:'+createHash('sha256').update(JSON.stringify(canonical(raw))).digest('hex');}
function oldTopology(locale,topology=mixedTopology()){
  const {canonicalOrder,topologyDigest,...old}=structuredClone(topology);
  const order=(values,key)=>values.sort((a,b)=>key(a).localeCompare(key(b),locale));
  order(old.nodes,n=>n.nodeRef);order(old.profiles,p=>p.profileRef);order(old.connections,c=>c.connectionRef);
  order(old.placements,p=>p.policy.workspaceId+'\u0000'+p.policy.objectFamily);
  return {...old,topologyDigest:oldDigest(old)};
}
test('K151 topology constructor uses code-unit order for every outer array and never consults localeCompare',()=>{
  const original=String.prototype.localeCompare;
  const before=mixedTopology();
  try{
    String.prototype.localeCompare=function(){throw Error('locale sorting must not be called');};
    const fresh=mixedTopology();
    assert.equal(fresh.canonicalOrder,T4_TOPOLOGY_CANONICAL_ORDER);
    assert.equal(fresh.topologyDigest,before.topologyDigest);
    assert.deepEqual(fresh.nodes.map(x=>x.nodeRef),['node:A','node:a','node:cloud','node:local']);
    assert.deepEqual(fresh.profiles.map(x=>x.profileRef),['profile:A','profile:a','profile:cloud']);
    assert.deepEqual(fresh.connections.map(x=>x.connectionRef),['link:A','link:a','link:cloud']);
    assert.deepEqual(fresh.placements.map(x=>x.policy.objectFamily),['Orders','orders']);
    const reordered=createT4NetworkTopology({...fresh,nodes:[...fresh.nodes].reverse(),profiles:[...fresh.profiles].reverse(),
      connections:[...fresh.connections].reverse(),placements:[...fresh.placements].reverse()});
    assert.equal(reordered.topologyDigest,fresh.topologyDigest);
    assert.deepEqual(validateT4NetworkTopology(JSON.parse(JSON.stringify(fresh))),fresh);
  }finally{String.prototype.localeCompare=original;}
});
test('K151 legacy locale-specific topology identity is read exactly, and only explicit original revision migrates to canonical order',async()=>{
  const en=oldTopology('en-US'),da=oldTopology('da-DK');
  assert.notEqual(en.topologyDigest,da.topologyDigest);
  assert.deepEqual(validateT4NetworkTopology(en),en);
  assert.deepEqual(validateT4NetworkTopology(da),da);
  for(const old of [en,da]){
    const route=planT4NetworkRoute({topology:old,workspaceId:'workspace:owner',objectFamily:'orders',
      targetNodeRef:'node:A',capability:'package.read'});
    assert.equal(route.topologyDigest,old.topologyDigest);
    const next=createT4NetworkTopology({...old,revision:2,previousTopologyDigest:old.topologyDigest});
    await assert.rejects(transitionT4NetworkTopology({previous:old,candidate:next,authorizeOriginalTopologyChange:async()=>false}),
      code('ORIGINAL_T3_TOPOLOGY_REVISION_DENIED'));
    const approvals=[];
    const migrated=await transitionT4NetworkTopology({previous:old,candidate:next,authorizeOriginalTopologyChange:async p=>{approvals.push(p);return true;}});
    assert.equal(migrated.canonicalOrder,T4_TOPOLOGY_CANONICAL_ORDER);
    assert.equal(migrated.previousTopologyDigest,old.topologyDigest);
    assert.ok(approvals.every(p=>p.previousTopologyDigest===old.topologyDigest&&p.candidateTopologyDigest===migrated.topologyDigest&&p.changesExistingOriginalOwner===false));
    const downgrade=oldTopology('en-US',createT4NetworkTopology({...migrated,revision:3,previousTopologyDigest:migrated.topologyDigest}));
    await assert.rejects(transitionT4NetworkTopology({previous:migrated,candidate:downgrade,authorizeOriginalTopologyChange:async()=>true}),
      code('TOPOLOGY_CANONICAL_ORDER_DOWNGRADE'));
  }
});
test('K151 no route or network callback can use an unverified topology digest or silently reordered stored bytes',async()=>{
  const fresh=mixedTopology(),legacy=oldTopology('en-US');
  const args={workspaceId:'workspace:owner',objectFamily:'orders',targetNodeRef:'node:A',capability:'package.read'};
  let invoked=0;
  for(const bad of [{...legacy,nodes:[...legacy.nodes].reverse()},
    {...fresh,topologyDigest:'sha256:'+'0'.repeat(64)}]){
    assert.throws(()=>planT4NetworkRoute({...args,topology:bad}),code('TOPOLOGY_DIGEST_MISMATCH'));
    await assert.rejects(executeT4NetworkRoute({...args,topology:bad,getMode:()=> 'T4_NETWORK',
      verifyOriginalEndpoint:async()=>{invoked++;return true;},authorizeOriginalOperation:async()=>{invoked++;return true;},
      executeTransport:async()=>{invoked++;}}),code('TOPOLOGY_DIGEST_MISMATCH'));
  }
  assert.throws(()=>validateT4NetworkTopology({...fresh,nodes:[...fresh.nodes].reverse()}),code('TOPOLOGY_CANONICAL_SEQUENCE_INVALID'));
  assert.throws(()=>validateT4NetworkTopology({...fresh,canonicalOrder:'UNKNOWN'}),code('TOPOLOGY_CANONICAL_ORDER_UNSUPPORTED'));
  assert.equal(invoked,0);
});
