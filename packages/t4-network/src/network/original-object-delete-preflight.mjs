import {createHash} from 'node:crypto';

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
