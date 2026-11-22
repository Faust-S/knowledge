export class T4HostedContextBoundaryError extends Error {
  constructor(code, message) { super(message); this.name = 'T4HostedContextBoundaryError'; this.code = code; }
}
const fail=(code,message)=>{throw new T4HostedContextBoundaryError(code,message);};
const text=(v,l)=>{if(typeof v!=='string'||!v.trim())fail('INVALID_TEXT',l+' is required');return v.trim();};
const arr=(v,l)=>{if(!Array.isArray(v))fail('INVALID_ARRAY',l+' must be an array');return v;};
const boolFalse=(v,l)=>{if(v!==false)fail('AUTHORITY_ESCALATION',l+' must be false at T4');};
const boolTrue=(v,l)=>{if(v!==true)fail('ADDITIVITY_VIOLATION',l+' must be true at T4');};
const PLACEMENTS=new Set(['LOCAL_ONLY','LOCAL_PRIMARY_HOSTED_REPLICA','HOSTED_PRIMARY_LOCAL_CACHE','HOSTED_ONLY','EXTERNAL_REFERENCE_ONLY']);
const STRATEGIES=new Set(['SINGLE_WRITER_NO_CONFLICT','LWW_ALLOWED','CRDT_MERGE','MANUAL_RECONCILIATION','OWNER_DECIDES','APPEND_ONLY']);

export function createPlacementPolicy(input={}){
  const objectFamily=text(input.objectFamily,'objectFamily');
  const workspaceId=text(input.workspaceId,'workspaceId');
  const authorityRoot=text(input.authorityRoot,'authorityRoot');
  const writeOwnerRef=text(input.writeOwnerRef,'writeOwnerRef');
  const primaryPlacement=text(input.primaryPlacement,'primaryPlacement');
  if(!PLACEMENTS.has(primaryPlacement))fail('INVALID_PLACEMENT','unsupported primaryPlacement');
  const allowedLocations=arr(input.allowedLocations,'allowedLocations').map((v)=>text(v,'allowedLocations'));
  if(new Set(allowedLocations).size!==allowedLocations.length)fail('DUPLICATE_LOCATION','allowedLocations must be unique');
  if(allowedLocations.length===0)fail('EMPTY_LOCATION_SET','allowedLocations must be non-empty');
  if(input.writeOwnerRefs!==undefined){
    const owners=arr(input.writeOwnerRefs,'writeOwnerRefs').map(v=>text(v,'writeOwnerRefs'));
    if(new Set(owners).size!==1||owners[0]!==writeOwnerRef)fail('MULTIPLE_WRITE_OWNERS','exactly one write owner is permitted');
  }
  boolFalse(input.universalCloudMaster,'universalCloudMaster');
  boolFalse(input.subjectActionAuthority,'subjectActionAuthority');
  return Object.freeze({
    schema:'IWXA_T4_PLACEMENT_POLICY_V1',objectFamily,workspaceId,authorityRoot,writeOwnerRef,primaryPlacement,
    allowedLocations:Object.freeze(allowedLocations),retentionClass:text(input.retentionClass,'retentionClass'),
    recoveryClass:text(input.recoveryClass,'recoveryClass'),universalCloudMaster:false,subjectActionAuthority:false
  });
}

export function createReplicaBinding(input={}){
  const binding=Object.freeze({
    schema:'IWXA_T4_REPLICA_BINDING_V1',
    replicaId:text(input.replicaId,'replicaId'),
    objectFamily:text(input.objectFamily,'objectFamily'),
    workspaceId:text(input.workspaceId,'workspaceId'),
    sourceOwnerRef:text(input.sourceOwnerRef,'sourceOwnerRef'),
    locationRef:text(input.locationRef,'locationRef'),
    sourceVersion:text(input.sourceVersion,'sourceVersion'),
    replicaWriteOwner:false,
    sourceTruthAuthority:false,
    subjectActionAuthority:false
  });
  boolFalse(input.replicaWriteOwner,'replicaWriteOwner');
  boolFalse(input.sourceTruthAuthority,'sourceTruthAuthority');
  boolFalse(input.subjectActionAuthority,'subjectActionAuthority');
  return binding;
}

export function createSyncPlan(input={}){
  const strategy=text(input.conflictStrategy,'conflictStrategy');
  if(!STRATEGIES.has(strategy))fail('INVALID_CONFLICT_STRATEGY','conflictStrategy must be explicitly declared');
  if(strategy==='LWW_ALLOWED'&&input.lwwSemanticallySafe!==true)fail('UNSAFE_LWW','LWW requires explicit semantic safety');
  boolFalse(input.syncIsAuthority,'syncIsAuthority');
  boolFalse(input.silentOwnerPromotion,'silentOwnerPromotion');
  boolFalse(input.genericSilentLww,'genericSilentLww');
  return Object.freeze({
    schema:'IWXA_T4_SYNC_PLAN_V1',
    objectFamily:text(input.objectFamily,'objectFamily'),
    workspaceId:text(input.workspaceId,'workspaceId'),
    writeOwnerRef:text(input.writeOwnerRef,'writeOwnerRef'),
    conflictStrategy:strategy,
    topologyDigest:text(input.topologyDigest,'topologyDigest'),
    syncIsAuthority:false,silentOwnerPromotion:false,genericSilentLww:false
  });
}

export function createContextProjection(input={}){
  boolFalse(input.writeOwner,'writeOwner');
  boolFalse(input.subjectActionAuthority,'subjectActionAuthority');
  return Object.freeze({
    schema:'IWXA_T4_CONTEXT_PROJECTION_V1',
    projectionId:text(input.projectionId,'projectionId'),
    subjectCoreRef:text(input.subjectCoreRef,'subjectCoreRef'),
    purpose:text(input.purpose,'purpose'),
    sourceRefs:Object.freeze(arr(input.sourceRefs,'sourceRefs').map(v=>text(v,'sourceRefs'))),
    rightsRef:text(input.rightsRef,'rightsRef'),
    writeOwner:false,subjectActionAuthority:false
  });
}

export function assertT3SovereignAdditivity(input={}){
  boolTrue(input.t3SovereignModePreserved,'t3SovereignModePreserved');
  boolFalse(input.t4RequiredForT3Operation,'t4RequiredForT3Operation');
  boolFalse(input.t3ContextMustMoveRemote,'t3ContextMustMoveRemote');
  boolFalse(input.t3OnlineIdentityRequired,'t3OnlineIdentityRequired');
  boolFalse(input.t4OutageBreaksT3,'t4OutageBreaksT3');
  boolTrue(input.hostedCapabilitiesAreOptionalForT3,'hostedCapabilitiesAreOptionalForT3');
  return Object.freeze({
    schema:'IWXA_T4_T3_ADDITIVITY_GUARD_V1',
    t3SovereignModePreserved:true,
    t4RequiredForT3Operation:false,
    t3ContextMustMoveRemote:false,
    t3OnlineIdentityRequired:false,
    t4OutageBreaksT3:false,
    hostedCapabilitiesAreOptionalForT3:true
  });
}
