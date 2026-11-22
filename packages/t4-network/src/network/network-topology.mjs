import {createHash} from 'node:crypto';
import {createPlacementPolicy} from '../contracts/hosted-context-boundary.mjs';
import {createT4NetworkConnectionProfile} from './operator-connection.mjs';

export class T4NetworkTopologyError extends Error {
  constructor(code) {super(code);this.name='T4NetworkTopologyError';this.code=code;}
}
const fail=code=>{throw new T4NetworkTopologyError(code);};
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const required=(x,code='INVALID_TOPOLOGY_REFERENCE')=>{if(!id(x))fail(code);return x;};
const kinds=new Set(['LOCAL_DEVICE','PERSONAL_SERVER','ORGANIZATION_SERVER','THIRD_PARTY_SERVER','IWXA_CLOUD_SERVER']);
const states=new Set(['AVAILABLE','UNREACHABLE','UNKNOWN']);
const connectionStates=new Set(['READY','PAUSED','UNKNOWN']);
const capabilities=new Set([
  'package.publish','package.read','delta.push','delta.pull',
  'replica.recover','remote.search','remote.compute','operator.anonymized-analytics'
]);
const implemented=new Set(['package.publish','package.read','delta.push','delta.pull']);
const immutableArray=(xs,allowed,code)=>{
  if(!Array.isArray(xs)||xs.length>64||xs.some(x=>!id(x)||(allowed&&!allowed.has(x)))||
    new Set(xs).size!==xs.length)fail(code);
  return Object.freeze([...xs].sort());
};
const entries=(xs,limit,code)=>{
  if(!Array.isArray(xs)||xs.length>limit)fail(code);return xs;
};
const indexBy=(xs,key,code)=>{
  const m=new Map();
  for(const x of xs){if(m.has(x[key]))fail(code);m.set(x[key],x);}
  return m;
};
const ordered=value=>Array.isArray(value)?value.map(ordered):
  value&&typeof value==='object'
    ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])]))
    :value;
const sha=value=>'sha256:'+createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
const frozenObject=x=>Object.freeze(x);
const routeKey=(workspaceId,objectFamily)=>workspaceId+'\u0000'+objectFamily;

function normalizeNode(raw,localNodeRef) {
  if(!raw||!kinds.has(raw.kind))fail('NODE_KIND_INVALID');
  const nodeRef=required(raw.nodeRef),locationRef=required(raw.locationRef);
  const subjectRef=required(raw.subjectRef),operatorRef=required(raw.operatorRef);
  if(!states.has(raw.availability))fail('NODE_AVAILABILITY_INVALID');
  const local=nodeRef===localNodeRef;
  if(local!==(raw.kind==='LOCAL_DEVICE'))fail('LOCAL_T3_NODE_MISMATCH');
  if(local&&raw.availability!=='AVAILABLE')fail('LOCAL_T3_MUST_REMAIN_AVAILABLE');
  if(local&&raw.profileRef!==undefined&&raw.profileRef!==null)fail('LOCAL_T3_HAS_REMOTE_PROFILE');
  if(!local&&!id(raw.profileRef))fail('REMOTE_NODE_PROFILE_REQUIRED');
  return frozenObject({
    nodeRef,kind:raw.kind,subjectRef,operatorRef,locationRef,
    availability:raw.availability,advertisedCapabilities:
      immutableArray(raw.advertisedCapabilities,capabilities,'NODE_CAPABILITIES_INVALID'),
    profileRef:local?null:raw.profileRef,
    originalAuthority:false,operatorDataRightsGranted:false,
  });
}

function normalizeProfile(raw) {
  if(!raw||typeof raw!=='object')fail('PROFILE_REQUIRED');
  const p=createT4NetworkConnectionProfile(raw);
  let url;
  try{url=new URL(p.endpointUrl);}catch{fail('PROFILE_HTTPS_ENDPOINT_REQUIRED');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
    !url.pathname.endsWith('/'))fail('PROFILE_HTTPS_ENDPOINT_REQUIRED');
  return frozenObject({
    profileRef:p.profileRef,mode:p.mode,operatorRef:p.operatorRef,
    locationRef:p.locationRef,endpointUrl:url.href,
    cloudAgreement:p.cloudAgreement,originalOwnerPermissionVerified:false,
    cloudDerivativeUseActivated:false,
  });
}

function normalizeConnection(raw,localNodeRef,nodes,profiles) {
  if(!raw)fail('CONNECTION_INVALID');
  const connectionRef=required(raw.connectionRef);
  const sourceNodeRef=required(raw.sourceNodeRef);
  const targetNodeRef=required(raw.targetNodeRef);
  const profileRef=required(raw.profileRef);
  if(sourceNodeRef!==localNodeRef||targetNodeRef===localNodeRef)fail('T3_ORIGIN_ROUTE_REQUIRED');
  const target=nodes.get(targetNodeRef),profile=profiles.get(profileRef);
  if(!target||!profile||target.profileRef!==profileRef||
    profile.locationRef!==target.locationRef||profile.operatorRef!==target.operatorRef)
    fail('CONNECTION_PROFILE_NODE_MISMATCH');
  if(target.kind==='IWXA_CLOUD_SERVER'&&profile.mode!=='IWXA_CLOUD')
    fail('CLOUD_OPERATOR_PROFILE_MISMATCH');
  if(target.kind==='THIRD_PARTY_SERVER'&&profile.mode!=='THIRD_PARTY')
    fail('THIRD_PARTY_PROFILE_MISMATCH');
  if((target.kind==='PERSONAL_SERVER'||target.kind==='ORGANIZATION_SERVER')&&
    profile.mode!=='SELF_HOSTED')fail('SELF_HOSTED_PROFILE_MISMATCH');
  if(!connectionStates.has(raw.state))fail('CONNECTION_STATE_INVALID');
  const available=immutableArray(raw.capabilities,capabilities,'CONNECTION_CAPABILITIES_INVALID');
  if(available.some(x=>!target.advertisedCapabilities.includes(x)))
    fail('CONNECTION_CAPABILITY_NOT_ADVERTISED');
  const objectFamilies=immutableArray(raw.objectFamilies,null,'CONNECTION_FAMILIES_INVALID');
  if(!objectFamilies.length)fail('CONNECTION_FAMILIES_REQUIRED');
  return frozenObject({
    connectionRef,sourceNodeRef,targetNodeRef,profileRef,state:raw.state,
    capabilities:available,objectFamilies,authorizationEstablished:false,
  });
}
function normalizePlacement(raw,nodes,localNodeRef,locationSet) {
  if(!raw||typeof raw!=='object')fail('PLACEMENT_INVALID');
  const policy=createPlacementPolicy(raw.policy);
  const primaryNodeRef=required(raw.primaryNodeRef);
  const primary=nodes.get(primaryNodeRef);
  if(!primary||!policy.allowedLocations.includes(primary.locationRef))
    fail('PRIMARY_LOCATION_NOT_ALLOWED');
  if(policy.allowedLocations.some(x=>!locationSet.has(x)))fail('UNKNOWN_PLACEMENT_LOCATION');
  const replicas=immutableArray(raw.replicaNodeRefs,null,'REPLICA_IDS_INVALID');
  if(replicas.includes(primaryNodeRef)||replicas.some(x=>!nodes.has(x)||
    !policy.allowedLocations.includes(nodes.get(x).locationRef)))
    fail('REPLICA_PLACEMENT_INVALID');
  const localPrimary=primaryNodeRef===localNodeRef;
  if((policy.primaryPlacement==='LOCAL_ONLY'&&(!localPrimary||replicas.length))||
    (policy.primaryPlacement==='LOCAL_PRIMARY_HOSTED_REPLICA'&&!localPrimary)||
    (policy.primaryPlacement==='HOSTED_PRIMARY_LOCAL_CACHE'&&
      (localPrimary||!replicas.includes(localNodeRef)))||
    (policy.primaryPlacement==='HOSTED_ONLY'&&
      (localPrimary||replicas.includes(localNodeRef)))||
    (policy.primaryPlacement==='EXTERNAL_REFERENCE_ONLY'&&replicas.length))
    fail('PLACEMENT_MODE_TOPOLOGY_MISMATCH');
  return frozenObject({
    policy,primaryNodeRef,replicaNodeRefs:replicas,
    sourceWriteOwnerRef:policy.writeOwnerRef,
    originalAuthorityRetained:true,replicaPromotionAllowed:false,
  });
}

export function createT4NetworkTopology(input={}) {
  const topologyRef=required(input.topologyRef);
  const localNodeRef=required(input.localNodeRef);
  if(!Number.isSafeInteger(input.revision)||input.revision<1)
    fail('TOPOLOGY_REVISION_INVALID');
  const previousTopologyDigest=input.previousTopologyDigest??null;
  if((input.revision===1&&previousTopologyDigest!==null)||
    (input.revision>1&&!/^sha256:[a-f0-9]{64}$/.test(previousTopologyDigest)))
    fail('TOPOLOGY_PARENT_DIGEST_INVALID');
  const nodes=entries(input.nodes,128,'NODES_INVALID').map(x=>normalizeNode(x,localNodeRef));
  const nodeMap=indexBy(nodes,'nodeRef','NODE_DUPLICATE');
  if(!nodeMap.has(localNodeRef))fail('LOCAL_T3_NODE_MISSING');
  const locations=indexBy(nodes,'locationRef','LOCATION_DUPLICATE');
  const profiles=entries(input.profiles,127,'PROFILES_INVALID').map(normalizeProfile);
  const profileMap=indexBy(profiles,'profileRef','PROFILE_DUPLICATE');
  for(const node of nodes)if(node.nodeRef!==localNodeRef){
    const p=profileMap.get(node.profileRef);
    if(!p||p.operatorRef!==node.operatorRef||p.locationRef!==node.locationRef)
      fail('REMOTE_PROFILE_NODE_MISMATCH');
  }
  const connections=entries(input.connections,127,'CONNECTIONS_INVALID')
    .map(x=>normalizeConnection(x,localNodeRef,nodeMap,profileMap));
  indexBy(connections,'connectionRef','CONNECTION_DUPLICATE');
  indexBy(connections,'targetNodeRef','DUPLICATE_ROUTE_TO_NODE');
  const placements=entries(input.placements,128,'PLACEMENTS_INVALID')
    .map(x=>normalizePlacement(x,nodeMap,localNodeRef,locations));
  const keys=new Set();
  for(const p of placements){
    const key=routeKey(p.policy.workspaceId,p.policy.objectFamily);
    if(keys.has(key))fail('PLACEMENT_DUPLICATE');keys.add(key);
  }
  const stable={
    schema:'IWXA_T4_NETWORK_TOPOLOGY_V1',topologyRef,revision:input.revision,
    previousTopologyDigest,localNodeRef,nodes:Object.freeze(nodes.sort((a,b)=>a.nodeRef.localeCompare(b.nodeRef))),
    profiles:Object.freeze(profiles.sort((a,b)=>a.profileRef.localeCompare(b.profileRef))),
    connections:Object.freeze(connections.sort((a,b)=>a.connectionRef.localeCompare(b.connectionRef))),
    placements:Object.freeze(placements.sort((a,b)=>routeKey(a.policy.workspaceId,a.policy.objectFamily)
      .localeCompare(routeKey(b.policy.workspaceId,b.policy.objectFamily)))),
    t3SovereignOfflinePreserved:true,
    networkTopologyIsNotAnOriginalGrant:true,universalCloudMaster:false,
  };
  return frozenObject({...stable,topologyDigest:sha(stable)});
}

export function planT4NetworkRoute({topology,workspaceId,objectFamily,targetNodeRef,capability}={}) {
  if(topology?.schema!=='IWXA_T4_NETWORK_TOPOLOGY_V1')fail('TOPOLOGY_REQUIRED');
  required(workspaceId);required(objectFamily);required(targetNodeRef);
  if(!capabilities.has(capability))fail('CAPABILITY_UNKNOWN');
  const place=topology.placements.find(x=>x.policy.workspaceId===workspaceId&&
    x.policy.objectFamily===objectFamily);
  if(!place)fail('PLACEMENT_NOT_FOUND');
  const target=topology.nodes.find(x=>x.nodeRef===targetNodeRef);
  if(!target||target.nodeRef===topology.localNodeRef||
    !place.policy.allowedLocations.includes(target.locationRef)||
    (targetNodeRef!==place.primaryNodeRef&&!place.replicaNodeRefs.includes(targetNodeRef)))
    fail('NETWORK_TARGET_NOT_PLACED');
  if(target.availability!=='AVAILABLE')fail('NETWORK_NODE_NOT_AVAILABLE');
  const connection=topology.connections.find(x=>x.targetNodeRef===targetNodeRef);
  if(!connection||connection.state!=='READY')fail('NETWORK_CONNECTION_NOT_READY');
  if(!target.advertisedCapabilities.includes(capability)||
    !connection.capabilities.includes(capability)||
    !connection.objectFamilies.includes(objectFamily))fail('CAPABILITY_NOT_AVAILABLE');
  const profile=topology.profiles.find(x=>x.profileRef===connection.profileRef);
  if(!profile)fail('PROFILE_NOT_FOUND');
  return frozenObject({
    schema:'IWXA_T4_NETWORK_ROUTE_PLAN_V1',
    topologyDigest:topology.topologyDigest,workspaceId,objectFamily,capability,
    fromNodeRef:topology.localNodeRef,toNodeRef:targetNodeRef,
    locationRef:target.locationRef,operatorRef:target.operatorRef,
    profileRef:profile.profileRef,connectionRef:connection.connectionRef,
    endpointUrl:profile.endpointUrl,mode:profile.mode,
    originalWriteOwnerRef:place.policy.writeOwnerRef,
    isReplicaTarget:place.replicaNodeRefs.includes(targetNodeRef),
    executableByCurrentT4:implemented.has(capability),
    originalOwnerAuthorized:false,operatorEndpointVerified:false,
    derivativeDataRightActivated:false,
  });
}
export function listT4NetworkChoices({topology,workspaceId,objectFamily,capability}={}) {
  if(topology?.schema!=='IWXA_T4_NETWORK_TOPOLOGY_V1')fail('TOPOLOGY_REQUIRED');
  const placement=topology.placements.find(x=>x.policy.workspaceId===workspaceId&&
    x.policy.objectFamily===objectFamily);
  if(!placement)fail('PLACEMENT_NOT_FOUND');
  return Object.freeze([...new Set([placement.primaryNodeRef,...placement.replicaNodeRefs])]
    .filter(x=>x!==topology.localNodeRef)
    .sort().map(targetNodeRef=>{
      try{
        const route=planT4NetworkRoute({topology,workspaceId,objectFamily,targetNodeRef,capability});
        return frozenObject({targetNodeRef,state:'OFFERED_NOT_AUTHORIZED',
          executableByCurrentT4:route.executableByCurrentT4,mode:route.mode});
      }catch(error){
        if(!(error instanceof T4NetworkTopologyError))throw error;
        return frozenObject({targetNodeRef,state:'UNAVAILABLE',reason:error.code,
          executableByCurrentT4:false});
      }
    }));
}

export async function executeT4NetworkRoute({
  topology,workspaceId,objectFamily,targetNodeRef,capability,
  getMode,verifyOriginalEndpoint,authorizeOriginalOperation,executeTransport,
}={}) {
  const route=planT4NetworkRoute({topology,workspaceId,objectFamily,targetNodeRef,capability});
  if(!route.executableByCurrentT4)fail('T4_CAPABILITY_NOT_YET_EXECUTABLE');
  if([getMode,verifyOriginalEndpoint,authorizeOriginalOperation,executeTransport]
    .some(f=>typeof f!=='function'))fail('ORIGINAL_HOST_PORTS_REQUIRED');
  const online=()=>{if(getMode()!=='T4_NETWORK')fail('T4_NETWORK_MODE_DISABLED');};
  online();
  const context=frozenObject({
    operation:capability,originalWriteOwnerRef:route.originalWriteOwnerRef,
    workspaceId,objectFamily,locationRef:route.locationRef,operatorRef:route.operatorRef,
    profileRef:route.profileRef,targetNodeRef,topologyDigest:route.topologyDigest,
    endpointUrl:route.endpointUrl,
  });
  if(await verifyOriginalEndpoint(context)!==true)fail('ORIGINAL_ENDPOINT_NOT_VERIFIED');
  online();
  if(await authorizeOriginalOperation(context)!==true)fail('ORIGINAL_OPERATION_NOT_AUTHORIZED');
  online();
  // No new IAM token or persisted right is produced. The existing transport must
  // independently check its original Host authorization before each request.
  return executeTransport(frozenObject({route,context}));
}


export async function transitionT4NetworkTopology({
  previous,candidate,authorizeOriginalTopologyChange,
}={}) {
  if(typeof authorizeOriginalTopologyChange!=='function')
    fail('ORIGINAL_T3_TOPOLOGY_AUTHORITY_PORT_REQUIRED');
  if(previous?.schema!=='IWXA_T4_NETWORK_TOPOLOGY_V1'||
    candidate?.schema!=='IWXA_T4_NETWORK_TOPOLOGY_V1')fail('TOPOLOGY_REQUIRED');
  const before=createT4NetworkTopology(previous),after=createT4NetworkTopology(candidate);
  if(before.topologyDigest!==previous.topologyDigest||
    after.topologyDigest!==candidate.topologyDigest)fail('TOPOLOGY_DIGEST_MISMATCH');
  if(after.revision!==before.revision+1||after.previousTopologyDigest!==before.topologyDigest||
    after.topologyRef!==before.topologyRef||after.localNodeRef!==before.localNodeRef)
    fail('TOPOLOGY_REVISION_CHAIN_INVALID');
  const prevLocal=before.nodes.find(n=>n.nodeRef===before.localNodeRef);
  const nextLocal=after.nodes.find(n=>n.nodeRef===after.localNodeRef);
  if(prevLocal.subjectRef!==nextLocal.subjectRef||prevLocal.operatorRef!==nextLocal.operatorRef||
    prevLocal.locationRef!==nextLocal.locationRef)fail('ORIGINAL_T3_LOCAL_OWNER_CHANGED');
  const oldNodes=new Map(before.nodes.map(n=>[n.nodeRef,n]));
  for(const node of after.nodes){
    const prior=oldNodes.get(node.nodeRef);
    if(prior&&['kind','subjectRef','operatorRef','locationRef','profileRef'].some(k=>prior[k]!==node[k]))
      fail('NODE_IDENTITY_RETARGET_FORBIDDEN');
  }
  const oldPlacements=new Map(before.placements.map(p=>
    [routeKey(p.policy.workspaceId,p.policy.objectFamily),p]));
  const newPlacements=new Map(after.placements.map(p=>
    [routeKey(p.policy.workspaceId,p.policy.objectFamily),p]));
  const familyKeys=[...new Set([...oldPlacements.keys(),...newPlacements.keys()])].sort();
  for(const familyKey of familyKeys){
    const original=oldPlacements.get(familyKey),next=newPlacements.get(familyKey);
    if(original&&next&&(original.policy.writeOwnerRef!==next.policy.writeOwnerRef||
      original.policy.authorityRoot!==next.policy.authorityRoot))
      fail('ORIGINAL_T3_WRITE_AUTHORITY_IMMUTABLE');
  }
  for(const familyKey of familyKeys){
    const original=oldPlacements.get(familyKey),next=newPlacements.get(familyKey);
    const p=next??original;
    const decision=Object.freeze({
      operation:'t4.topology.revise',
      topologyRef:before.topologyRef,
      previousTopologyDigest:before.topologyDigest,
      candidateTopologyDigest:after.topologyDigest,
      workspaceId:p.policy.workspaceId,objectFamily:p.policy.objectFamily,
      originalWriteOwnerRef:p.policy.writeOwnerRef,
      previousPrimaryNodeRef:original?.primaryNodeRef??null,
      candidatePrimaryNodeRef:next?.primaryNodeRef??null,
      previousReplicaNodeRefs:original?.replicaNodeRefs??Object.freeze([]),
      candidateReplicaNodeRefs:next?.replicaNodeRefs??Object.freeze([]),
      changesExistingOriginalOwner:false,
      networkTopologyIsNotOriginalGrant:true,
    });
    if(await authorizeOriginalTopologyChange(decision)!==true)
      fail('ORIGINAL_T3_TOPOLOGY_REVISION_DENIED');
  }
  return after;
}
