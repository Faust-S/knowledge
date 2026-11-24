// Activity A4.1-III: read existing domain models in the trusted original Host.
// No additional Kernel, signer, Store, permission or Exchange. The original
// T3 subject binding owns authorization for every original T2 operation.
// Unlike D2's event projection this reads a selected normative Result schema.
import {ActivityHold,sha256Canonical} from './engine.mjs';
import {D05_SOURCE_PIN} from './d05-t3-evidence-binding.mjs';
import {reviewD05RouteModels} from './d05-route-comparison.mjs';

const SCHEMA=D05_SOURCE_PIN.domain+'.operation-route';
const MAX_MODELS=24,MAX_BYTES=8*1024*1024;
const READS=['t1.getWorkspace','t1.listObjects','t1.getObject'];
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const need=(ok,code)=>{if(!ok)throw new ActivityHold(code);};
const tag=v=>typeof v==='string'&&v.length>0&&v.length<=160;
const own=(value,property)=>Object.hasOwn(value,property);
const cmp=(a,b)=>a<b?-1:a>b?1:0;

function validateRows(rows,workspaceId){
  need(Array.isArray(rows)&&rows.length<=MAX_MODELS,'D05_ROUTE_HOST_SELECTION_LIMIT');
  need(rows.length>0,'D05_ROUTE_HOST_NO_MODELS');
  const ids=new Set();
  let bytes=0;
  for(const row of rows){
    need(record(row)&&row.workspace_id===workspaceId&&row.schema_id===SCHEMA&&
      row.schema_version===D05_SOURCE_PIN.version&&tag(row.object_id)&&
      Number.isSafeInteger(row.revision)&&row.revision>0&&!row.deleted_at&&
      record(row.data)&&!ids.has(row.object_id),'D05_ROUTE_HOST_RECORD_MISMATCH');
    ids.add(row.object_id);
    bytes+=new TextEncoder().encode(JSON.stringify(row)).byteLength;
    need(bytes<=MAX_BYTES,'D05_ROUTE_HOST_SOURCE_LIMIT');
  }
  return [...rows].sort((a,b)=>cmp(a.object_id,b.object_id));
}
function safeFailure(error){
  return error instanceof ActivityHold?error:
    new ActivityHold('D05_ROUTE_HOST_READ_REFUSED');
}

/** Trusted owner only. A signed operation grant is not inferred from a
 * selected workspace. The supplied binding MUST be the original T3 function.
 * No raw rows are returned. The review contains local operation labels and
 * is not approved for external disclosure. Do not hand this port to an LLM.
 */
export async function reviewSelectedD05RouteModels({
 context,signedAccess,createSubjectKernelBinding,subscribeOwnerInvalidation,
}={}){
  need(record(context?.kernel)&&typeof context.kernel.hasOperation==='function'&&
    READS.every(op=>context.kernel.hasOperation(op))&&
    typeof context.currentWorkspace?.get==='function'&&
    typeof context.currentWorkspace?.subscribe==='function'&&
    typeof signedAccess?.currentContext==='function'&&
    typeof signedAccess?.actionFor==='function'&&
    typeof createSubjectKernelBinding==='function'&&
    typeof subscribeOwnerInvalidation==='function',
    'D05_ROUTE_HOST_REQUIRED');
  const selected=context.currentWorkspace.get();
  const workspaceId=selected?.workspace_id;
  need(tag(workspaceId),'D05_ROUTE_HOST_WORKSPACE_REQUIRED');
  let changed=false,stopSelection=null,stopOwner=null;
  const invalidate=()=>{changed=true;};
  const live=()=>!changed&&context.currentWorkspace.get()===selected&&
    context.currentWorkspace.get()?.workspace_id===workspaceId;
  const checkLive=()=>need(live(),'D05_ROUTE_HOST_CONTEXT_CHANGED');
  try{
    stopSelection=context.currentWorkspace.subscribe(invalidate);
    stopOwner=subscribeOwnerInvalidation(invalidate);
    need(typeof stopSelection==='function'&&typeof stopOwner==='function','D05_ROUTE_HOST_INVALIDATION_REQUIRED');
    checkLive();
    const owner=await signedAccess.currentContext();
    need(record(owner)&&owner.workspace_id===workspaceId&&
      ['PERSONAL','CORP'].includes(owner.kind)&&owner.purpose==='activity.analysis',
      'D05_ROUTE_HOST_CONTEXT_MISMATCH');
    const identity=JSON.stringify(owner);
    // Preserve the existing analysis right; never substitute a derivation or
    // export grant. The original binding independently authorizes each read.
    for(const operation of READS){
      need(await signedAccess.actionFor(operation)==='activity.read',
        'D05_ROUTE_HOST_READ_ACTION_REQUIRED');
      checkLive();
    }
    const scoped=createSubjectKernelBinding({kernel:context.kernel,access:signedAccess,
      isHostActive:live});
    const query=Object.freeze({workspace_id:workspaceId,schema_id:SCHEMA,
      include_deleted:false,limit:MAX_MODELS+1});
    const firstWorkspace=await scoped.getWorkspace(workspaceId);
    need(record(firstWorkspace)&&firstWorkspace.workspace_id===workspaceId&&!firstWorkspace.deleted_at,
      'D05_ROUTE_HOST_WORKSPACE_REQUIRED');
    const wsDigest=await sha256Canonical(firstWorkspace);
    const rows=validateRows(await scoped.listObjects(query),workspaceId);
    // Capture before detail reads. Do not trust shared mutable references.
    const firstDigest=await sha256Canonical(rows);
    const firstRows=structuredClone(rows);
    const details=[];
    for(const row of firstRows){
      checkLive();
      const detail=await scoped.getObject(workspaceId,row.object_id);
      need(record(detail?.object)&&await sha256Canonical(detail.object)===await sha256Canonical(row),
        'D05_ROUTE_HOST_SOURCE_CHANGED');
      details.push(structuredClone(detail.object));
    }
    checkLive();
    const afterWorkspace=await scoped.getWorkspace(workspaceId);
    need(record(afterWorkspace)&&!afterWorkspace.deleted_at&&
      await sha256Canonical(afterWorkspace)===wsDigest,'D05_ROUTE_HOST_SOURCE_CHANGED');
    const after=validateRows(await scoped.listObjects(query),workspaceId);
    need(await sha256Canonical(after)===firstDigest,'D05_ROUTE_HOST_SOURCE_CHANGED');
    checkLive();
    need(JSON.stringify(await signedAccess.currentContext())===identity,
      'D05_ROUTE_HOST_CONTEXT_CHANGED');
    checkLive();
    const result=reviewD05RouteModels(details);
    checkLive();
    return {...result,source_authority:'ORIGINAL_SIGNED_SELECTED_READBACK'};
  }catch(error){throw safeFailure(error);}
  finally{
    try{if(typeof stopOwner==='function')stopOwner();}
    finally{if(typeof stopSelection==='function')stopSelection();}
  }
}

/** Optional separate domain capability for an owner-local review screen.
 * Keep generic D2 unchanged; its aliases do not become named route models.
 * Selection/owner invalidation also removes already displayed results.
 */
export function createTrustedD05RouteReviewPort(config){
  need(typeof config?.context?.currentWorkspace?.subscribe==='function'&&
    typeof config?.subscribeOwnerInvalidation==='function','D05_ROUTE_HOST_REQUIRED');
  return Object.freeze({
    readSelectedRoutes:()=>reviewSelectedD05RouteModels(config),
    subscribeInvalidation(listener){
      need(typeof listener==='function','D05_ROUTE_HOST_INVALIDATION_REQUIRED');
      const stopSelection=config.context.currentWorkspace.subscribe(listener);
      try{
        const stopOwner=config.subscribeOwnerInvalidation(listener);
        need(typeof stopSelection==='function'&&typeof stopOwner==='function',
          'D05_ROUTE_HOST_INVALIDATION_REQUIRED');
        let stopped=false;
        return ()=>{if(!stopped){stopped=true;try{stopOwner();}finally{stopSelection();}}};
      }catch(error){if(typeof stopSelection==='function')stopSelection();throw safeFailure(error);}
    },
  });
}
