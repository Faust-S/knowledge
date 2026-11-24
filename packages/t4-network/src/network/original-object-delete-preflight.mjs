import {createHash} from 'node:crypto';
import {digestT4OriginalObjectContent} from './original-object-delta.mjs';

/**
 * Read-only inspection before any ORIGINAL T3 Object delete.
 * It NEVER invokes deleteObject and NEVER authorizes a network deletion.
 * The original Host must separately recheck permissions and dependencies
 * atomically at the eventual original T3 mutation boundary.
 */
export class T4OriginalObjectDeletePreflightError extends Error {
  constructor(code,details={}) {
    super(code);this.name='T4OriginalObjectDeletePreflightError';
    this.code=code;this.details=Object.freeze({...details});
  }
}
const fail=(code,details)=>{throw new T4OriginalObjectDeletePreflightError(code,details);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const canonical=x=>Array.isArray(x)?x.map(canonical):
  x&&typeof x==='object'?Object.fromEntries(
    Object.keys(x).filter(k=>x[k]!==undefined).sort().map(k=>[k,canonical(x[k])])):x;
const digest=x=>'sha256:'+createHash('sha256')
  .update(JSON.stringify(canonical(x))).digest('hex');
const frozen=value=>Object.freeze(value);
function verifyOriginalSnapshot(graph,workspaceId,objectId,revision){
  const object=graph?.object;
  if(!object||object.workspace_id!==workspaceId||
    object.object_id!==objectId||object.deleted===true||
    object.deleted_at!==undefined)
    fail('OBJECT_DELETE_ORIGINAL_OBJECT_ABSENT_OR_TOMBSTONED');
  if(!Number.isSafeInteger(object.revision)||
    object.revision!==revision)
    fail('OBJECT_DELETE_ORIGINAL_REVISION_CONFLICT');
  const relations=graph?.relations;
  if(!Array.isArray(relations?.outgoing)||
    !Array.isArray(relations?.incoming))
    fail('OBJECT_DELETE_ORIGINAL_GRAPH_UNAVAILABLE');
  if(relations.outgoing.length||relations.incoming.length)
    fail('OBJECT_DELETE_ORIGINAL_RELATIONS_REQUIRE_REVIEW',{
      outgoing:relations.outgoing.length,incoming:relations.incoming.length,
      physicalCascadeAllowed:false,
    });
  return object;
}
export async function inspectT4OriginalObjectDeletePreflight({
  workspaceId,objectId,originalWriteOwnerRef,expectedBaseRevision,
  originalKernel,authorizeOriginalRead,authorizeOriginalDelete,getMode,
}={}) {
  if(![workspaceId,objectId,originalWriteOwnerRef].every(ID)||
    !Number.isSafeInteger(expectedBaseRevision)||expectedBaseRevision<1||
    originalKernel?.hasOperation?.('t1.getObject')!==true||
    originalKernel?.hasOperation?.('t1.listAssets')!==true||
    originalKernel?.hasOperation?.('t1.deleteObject')!==true||
    typeof originalKernel.getObject!=='function'||
    typeof originalKernel.listAssets!=='function'||
    typeof authorizeOriginalRead!=='function'||
    typeof authorizeOriginalDelete!=='function'||
    typeof getMode!=='function')
    fail('OBJECT_DELETE_ORIGINAL_HOST_PORTS_REQUIRED');
  const mode=()=>{
    if(getMode()!=='T4_NETWORK')
      fail('OBJECT_DELETE_T4_NETWORK_MODE_OFF');
  };
  const ctx=operation=>frozen({
    operation,workspaceId,objectId,originalWriteOwnerRef,
    expectedBaseRevision,originalT3WriteOwnerRequired:true,
    networkAuthorityDoesNotGrantOriginalDeletion:true,
  });
  const guard=async()=>{
    mode();
    if(await authorizeOriginalRead(ctx('t1.getObject'))!==true||
      await authorizeOriginalRead(ctx('t1.listAssets'))!==true||
      await authorizeOriginalDelete(ctx('t1.deleteObject'))!==true)
      fail('OBJECT_DELETE_ORIGINAL_AUTHORITY_DENIED');
    mode();
  };
  await guard();
  const before=await originalKernel.getObject(workspaceId,objectId);
  mode();
  const originalObject=verifyOriginalSnapshot(
    before,workspaceId,objectId,expectedBaseRevision);
  await guard();
  const assets=await originalKernel.listAssets({workspace_id:workspaceId});
  mode();
  if(!Array.isArray(assets)||assets.length>100000)
    fail('OBJECT_DELETE_ORIGINAL_ASSET_LIST_INVALID');
  const attached=assets.filter(a=>a?.object_id===objectId);
  if(attached.length)
    fail('OBJECT_DELETE_ORIGINAL_ASSETS_REQUIRE_REVIEW',{
      attachedAssets:attached.length,physicalCascadeAllowed:false,
    });
  // A second original read checks that the inspected graph and object
  // did not change before this advisory result. It cannot lock a future
  // destructive mutation and MUST NOT be used as delete authority.
  await guard();
  const after=await originalKernel.getObject(workspaceId,objectId);
  const stableObject=verifyOriginalSnapshot(
    after,workspaceId,objectId,expectedBaseRevision);
  if(digest(originalObject)!==digest(stableObject)||
    digest(before.relations)!==digest(after.relations))
    fail('OBJECT_DELETE_ORIGINAL_PREIMAGE_CHANGED');
  await guard();
  return frozen({
    schema:'IWXA_T4_ORIGINAL_OBJECT_DELETE_PREFLIGHT_V1',
    workspaceId,objectId,originalWriteOwnerRef,
    originalRevision:expectedBaseRevision,
    preImageDigest:digest(stableObject),
    originalRelationsPresent:false,originalAssetsPresent:false,
    originalT3ReadbackVerified:true,
    originalT3DeleteInvoked:false,
    originalHostMustRecheckAtMutation:true,
    networkDeletePermitted:false,
    originalPreImageNotPersisted:true,
    pendingOriginalEvent:false,
    advisoryOnly:true,
  });
}

// The original getObject API filters edges by endpoint schema permission;
// listAssets filters by its owning live Object. A granted operation is not
// proof of complete visibility. Only the existing, trusted original owner
// can attest the actual authorized unfiltered scope. This function cannot
// elevate a passport or make an advisory read a mutation lock.
export async function readT4OriginalObjectDeletionReview({
  workspaceId,objectId,originalWriteOwnerRef,expectedBaseRevision,
  originalKernel,authorizeOriginalRead,authorizeOriginalDelete,
  readOriginalDependencyCoverage,getMode,
}={}){
  if(![workspaceId,objectId,originalWriteOwnerRef].every(ID)||
    !Number.isSafeInteger(expectedBaseRevision)||expectedBaseRevision<1||
    !['t1.getObject','t1.listAssets','t1.deleteObject'].every(op=>
      originalKernel?.hasOperation?.(op)===true)||
    !['getObject','listAssets'].every(op=>typeof originalKernel?.[op]==='function')||
    [authorizeOriginalRead,authorizeOriginalDelete,readOriginalDependencyCoverage,
      getMode].some(f=>typeof f!=='function'))
    fail('OBJECT_DELETE_COMPLETE_ORIGINAL_SCOPE_REQUIRED');
  let originalCoverage=null;
  const ctx=operation=>Object.freeze({operation,workspaceId,objectId,
    originalWriteOwnerRef,expectedBaseRevision,
    originalT3WriteOwnerRequired:true,
    networkAuthorityDoesNotGrantOriginalDeletion:true,
    allIncidentRelationsAndLiveOwnedAssetsMustBeVisible:true});
  const mode=()=>{if(getMode()!=='T4_NETWORK')fail('OBJECT_DELETE_T4_NETWORK_MODE_OFF');};
  const checkCoverage=async()=>{
    mode();
    const c=await readOriginalDependencyCoverage(ctx('t4.original.object-delete.dependency-coverage'));
    if(c?.schema!=='IWXA_T4_ORIGINAL_OBJECT_DELETE_COVERAGE_V1'||
      c.workspaceId!==workspaceId||c.objectId!==objectId||
      c.originalWriteOwnerRef!==originalWriteOwnerRef||
      !ID(c.hostSessionRef)||!ID(c.originalAccessRef)||
      c.allIncidentRelationsVisible!==true||c.allLiveOwnedAssetsVisible!==true||
      c.completeOriginalAuthorityVerified!==true)
      fail('OBJECT_DELETE_ORIGINAL_DEPENDENCY_VISIBILITY_UNPROVEN');
    const normalized={schema:c.schema,workspaceId:c.workspaceId,objectId:c.objectId,
      originalWriteOwnerRef:c.originalWriteOwnerRef,hostSessionRef:c.hostSessionRef,
      originalAccessRef:c.originalAccessRef,allIncidentRelationsVisible:true,
      allLiveOwnedAssetsVisible:true,completeOriginalAuthorityVerified:true};
    if(originalCoverage!==null&&digest(normalized)!==digest(originalCoverage))
      fail('OBJECT_DELETE_ORIGINAL_DEPENDENCY_COVERAGE_CHANGED');
    originalCoverage=normalized;mode();
  };
  const guard=async()=>{
    mode();
    if(await authorizeOriginalRead(ctx('t1.getObject'))!==true||
      await authorizeOriginalRead(ctx('t1.listAssets'))!==true||
      await authorizeOriginalDelete(ctx('t1.deleteObject'))!==true)
      fail('OBJECT_DELETE_ORIGINAL_AUTHORITY_DENIED');
    await checkCoverage();mode();
  };
  async function snapshot(){
    await guard();
    const graph=await originalKernel.getObject(workspaceId,objectId);
    await guard();
    const o=graph?.object;
    if(!o||o.workspace_id!==workspaceId||o.object_id!==objectId||
      o.deleted===true||o.deleted_at!==undefined)
      fail('OBJECT_DELETE_ORIGINAL_OBJECT_ABSENT_OR_TOMBSTONED');
    if(o.revision!==expectedBaseRevision||!ID(o.schema_id)||!ID(o.schema_version))
      fail('OBJECT_DELETE_ORIGINAL_REVISION_CONFLICT');
    const incoming=graph.relations?.incoming,outgoing=graph.relations?.outgoing;
    if(!Array.isArray(incoming)||!Array.isArray(outgoing)||
      incoming.length+outgoing.length>100000)
      fail('OBJECT_DELETE_ORIGINAL_GRAPH_UNAVAILABLE');
    const links=new Map();
    for(const [direction,rows] of [['incoming',incoming],['outgoing',outgoing]]){
      const seen=new Set();
      for(const row of rows){
        if(row?.workspace_id!==workspaceId||
          ![row.relation_id,row.from_object_id,row.to_object_id,row.kind].every(ID)||
          !ID(row.created_by_service)||seen.has(row.relation_id)||
          (direction==='incoming'?row.to_object_id:row.from_object_id)!==objectId)
          fail('OBJECT_DELETE_ORIGINAL_RELATION_LIST_INVALID');
        seen.add(row.relation_id);
        const value={relationId:row.relation_id,fromObjectId:row.from_object_id,
          toObjectId:row.to_object_id,relationKind:row.kind,
          originalCreatorRef:row.created_by_service};
        const prior=links.get(value.relationId);
        if(prior&&digest(prior)!==digest(value))
          fail('OBJECT_DELETE_ORIGINAL_RELATION_LIST_INVALID');
        links.set(value.relationId,value);
      }
    }
    // A self-edge must be visible from both directions. Do not silently
    // collapse a partial or inconsistent original graph.
    for(const link of links.values())if(link.fromObjectId===objectId&&link.toObjectId===objectId&&
      (!incoming.some(r=>r.relation_id===link.relationId)||
       !outgoing.some(r=>r.relation_id===link.relationId)))
      fail('OBJECT_DELETE_ORIGINAL_RELATION_LIST_INVALID');
    const rawAssets=await originalKernel.listAssets({workspace_id:workspaceId,object_id:objectId});
    await guard();
    if(!Array.isArray(rawAssets)||rawAssets.length>100000)
      fail('OBJECT_DELETE_ORIGINAL_ASSET_LIST_INVALID');
    const seenAssets=new Set(),assets=[];
    for(const row of rawAssets){
      if(row?.workspace_id!==workspaceId||row.object_id!==objectId||
        !ID(row.asset_id)||!ID(row.service_id)||seenAssets.has(row.asset_id)||
        !Number.isSafeInteger(row.revision)||row.revision<1||
        !Number.isSafeInteger(row.size)||row.size<0||
        typeof row.mime!=='string'||!row.mime||row.mime.length>255)
        fail('OBJECT_DELETE_ORIGINAL_ASSET_LIST_INVALID');
      seenAssets.add(row.asset_id);
      assets.push({assetId:row.asset_id,objectId,originalCreatorRef:row.service_id,
        revision:row.revision,size:row.size,mime:row.mime});
    }
    const order=(a,b)=>a<b?-1:a>b?1:0;
    return {object:{objectId,schemaId:o.schema_id,schemaVersion:o.schema_version,
      revision:o.revision,objectContentDigest:digestT4OriginalObjectContent({
        schemaId:o.schema_id,schemaVersion:o.schema_version,data:o.data,extensions:o.extensions??{}})},
      relations:[...links.values()].sort((a,b)=>order(a.relationId,b.relationId)),
      assets:assets.sort((a,b)=>order(a.assetId,b.assetId))};
  }
  const before=await snapshot(),after=await snapshot();
  if(digest(before)!==digest(after))fail('OBJECT_DELETE_ORIGINAL_DEPENDENCIES_CHANGED');
  await guard();
  const count=before.relations.length+before.assets.length;
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_OBJECT_DELETE_REVIEW_V1',workspaceId,objectId,
    originalWriteOwnerRef,originalRevision:expectedBaseRevision,
    originalAccessRef:originalCoverage.originalAccessRef,
    originalHostSessionRef:originalCoverage.hostSessionRef,
    state:count?'DEPENDENCIES_REQUIRE_EXPLICIT_MUTATIONS':'ISOLATED_ORIGINAL_OBJECT',
    reviewDigest:digest(before),originalCompleteDependencyVisibilityVerified:true,
    object:Object.freeze(before.object),
    relations:Object.freeze(before.relations.map(Object.freeze)),
    assets:Object.freeze(before.assets.map(Object.freeze)),
    dependencyCount:count,physicalCascadeAllowed:false,
    originalHostMustRecheckAtMutation:true,networkDeletePermitted:false,
    originalT3DeleteInvoked:false,advisoryOnly:true,
  });
}
