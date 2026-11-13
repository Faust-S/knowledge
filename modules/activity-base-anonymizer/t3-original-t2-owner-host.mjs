// Product composition of the EXISTING T2 0.3.6 Runtime session with the
// EXISTING T3 signed Control and the Activity review port. There is one
// original Kernel/Store, one selected Workspace and no new IAM or router.
// Only trusted Host code may call these functions, never Activity renderer.
import {openOriginalT3ActivityReviewHost} from './t3-control-host-link.mjs';
import {T3ActivityHold} from './t3-selected-host.mjs';

const OPERATIONS=Object.freeze([
  't1.getWorkspace','t1.listObjects','t1.getObject','t1.listEventsSince',
  't1.putObject',
]);
const METHODS=Object.freeze([
  'getWorkspace','listObjects','getObject','listEventsSince','putObject',
]);
const required=(ok,code)=>{if(!ok)throw new T3ActivityHold(code);};

/** Preserve the original IWXA.connect session methods byte-for-byte.
 * This is ONLY a facade adapting Runtime 1.3.0 shape to the already
 * standardized T3 createSubjectKernelBinding shape. Not a second Kernel.
 * The caller retains the ORIGINAL session in its trusted Host realm.
 */
export function useOriginalT2ActivityKernelFacade(session){
  const t1=session?.t1;
  const grants=session?.granted_operations;
  required(session?.contract_version==='1.3.0'&&
    session?.runtime_version==='0.3.6'&&
    typeof session?.service?.service_id==='string'&&
    session.service.service_id.length>0&&
    Array.isArray(grants)&&new Set(grants).size===grants.length&&
    grants.every(op=>typeof op==='string')&&
    OPERATIONS.every(op=>grants.includes(op))&&
    t1&&METHODS.every(m=>typeof t1[m]==='function'),
    'T3_ACTIVITY_ORIGINAL_T2_SERVICE_REQUIRED');
  const available=new Set(grants);
  return Object.freeze({
    sessionInfo:Object.freeze({
      mode:session.mode,contract_version:session.contract_version,
      runtime_version:session.runtime_version,service_id:session.service.service_id,
    }),
    // Expose only the operations backed by methods of this actual facade.
    hasOperation:op=>OPERATIONS.includes(op)&&available.has(op),
    getWorkspace:ws=>t1.getWorkspace(ws),
    listObjects:query=>t1.listObjects(query),
    getObject:(ws,id)=>t1.getObject(ws,id),
    listEventsSince:ws=>t1.listEventsSince(ws),
    putObject:input=>t1.putObject(input),
  });
}

/** Composition point in the product's ORIGINAL trusted T3 Host.
 * The Host supplies its own T2 session, signed Control, D2 and original
 * signed subject binding. All unscoped APIs remain in this closure; the
 * only return value is the established Activity Host port and dispose.
 */
export async function openActivityFromOriginalT2Host({
  session,control,currentWorkspace,bindings,
  readActivityFromWorkspaceContext,createSubjectKernelBinding,
  subscribeExistingInvalidation=null,
}={}){
  required(currentWorkspace&&typeof currentWorkspace.get==='function'&&
    typeof currentWorkspace.subscribe==='function',
    'T3_ACTIVITY_ORIGINAL_WORKSPACE_SELECTION_REQUIRED');
  const originalKernel=useOriginalT2ActivityKernelFacade(session);
  return openOriginalT3ActivityReviewHost({
    control,originalKernel,
    context:Object.freeze({kernel:originalKernel,currentWorkspace}),
    bindings,readActivityFromWorkspaceContext,createSubjectKernelBinding,
    subscribeExistingInvalidation,
  });
}
