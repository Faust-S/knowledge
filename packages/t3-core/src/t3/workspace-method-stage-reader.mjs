// Node Host composition candidate for W05. Uses original signed D1
// binding, original scoped Project/Work owner and already-installed
// original Agent readAccepted. No UI-selected owner, no new IAM, Task,
// Store or native dispatch. Do not mount before product owner adoption.
import { canonicalClone,canonicalStringify } from '../persistence/canonical-codec.mjs';
import { createSubjectKernelBinding } from './subject-access-binding.mjs';
import { inspectWorkspaceMethodAgentPredecessorResults } from '../modules/base/owners/project-process-method-stage-input.mjs';

function deny(code){throw Object.assign(new Error(code),{code,outcome:'DENIED'});}
function check(ok,code){if(!ok)deny(code);}
export function createTrustedWorkspaceMethodStageReader({kernel,accessForRead,currentWorkspace,
  sourceOwner,originalAgentResultOwner,isHostActive}={}){
  check(kernel?.sessionInfo?.contract_version==='1.3.0'&&typeof kernel.hasOperation==='function'
    &&kernel.hasOperation('t1.getObject')===true&&typeof accessForRead==='function'
    &&typeof currentWorkspace?.get==='function'&&typeof currentWorkspace?.subscribe==='function'
    &&typeof sourceOwner?.load==='function'&&typeof originalAgentResultOwner?.readAccepted==='function'
    &&typeof isHostActive==='function','T3_METHOD_STAGE_TRUSTED_HOST_REQUIRED');
  return Object.freeze({async inspect(input){
    // Snapshot selections before any original owner await. No caller port,
    // context, Result content, digest, permission or dispatch callback.
    check(input&&typeof input.workspaceId==='string'&&typeof input.projectId==='string'
      &&typeof input.stepId==='string'&&Array.isArray(input.expected?.workRefs),
      'T3_METHOD_STAGE_SELECTION_REQUIRED');
    const ref=value=>({family:value?.family,objectId:value?.objectId,recordId:value?.recordId,revision:value?.revision});
    const request=canonicalClone({workspaceId:input.workspaceId,projectId:input.projectId,stepId:input.stepId,
      expected:{projectRef:ref(input.expected.projectRef),workRefs:input.expected.workRefs.map(ref)},
      resultSelections:(input.resultSelections??[]).map(row=>({stepId:row.stepId,reference:{
        workspace_id:row.reference?.workspace_id,object_id:row.reference?.object_id,
        schema_id:row.reference?.schema_id,revision:row.reference?.revision}}))});
    check(isHostActive()===true,'T3_HOST_DISPOSED');
    const selected=currentWorkspace.get();
    check(selected?.workspace_id===request.workspaceId&&selected.deleted_at==null,'T3_METHOD_STAGE_WORKSPACE_REQUIRED');
    let changed=false;
    const unsubscribe=currentWorkspace.subscribe(()=>{changed=true;});
    const active=()=>isHostActive()===true&&!changed&&currentWorkspace.get()===selected;
    const live=()=>check(active(),'T3_METHOD_STAGE_WORKSPACE_CHANGED');
    try{
      live();
      const access=await accessForRead('t1.getObject');
      live();
      const context=canonicalClone(await access.currentContext());
      live();
      check(context?.workspace_id===request.workspaceId&&context.resource===request.workspaceId,
        'T3_METHOD_STAGE_SIGNED_SCOPE_MISMATCH');
      const identity=canonicalStringify(context);
      const unchanged=async()=>{
        live();
        check(canonicalStringify(await access.currentContext())===identity,'T3_METHOD_STAGE_SIGNED_CONTEXT_CHANGED');
        live();
      };
      const signed=createSubjectKernelBinding({kernel,access,isHostActive:active});
      const guarded=async fn=>{await unchanged();const result=await fn();await unchanged();return result;};
      const owner={load:(kind,workspaceId,id)=>{
        check(workspaceId===request.workspaceId,'T3_METHOD_STAGE_SIGNED_SCOPE_MISMATCH');
        return guarded(()=>sourceOwner.load(kind,workspaceId,id));
      }};
      const readObject=(workspaceId,id)=>{
        check(workspaceId===request.workspaceId,'T3_METHOD_STAGE_SIGNED_SCOPE_MISMATCH');
        return guarded(()=>signed.getObject(workspaceId,id));
      };
      const readAccepted=reference=>{
        check(reference.workspace_id===request.workspaceId,'T3_METHOD_STAGE_SIGNED_SCOPE_MISMATCH');
        return guarded(()=>originalAgentResultOwner.readAccepted(reference));
      };
      // Establish a current original D1 workspace read even for a stage
      // without material or Result references. The trusted source-owner
      // port remains independently responsible for its own permissions.
      check(kernel.hasOperation('t1.getWorkspace')===true,'T3_METHOD_STAGE_WORKSPACE_READ_REQUIRED');
      const workspace=await guarded(()=>signed.getWorkspace(request.workspaceId));
      check(workspace?.workspace_id===request.workspaceId&&workspace.deleted_at==null,'T3_METHOD_STAGE_WORKSPACE_REQUIRED');
      const report=await inspectWorkspaceMethodAgentPredecessorResults({...request,owner,readObject,readAccepted});
      await unchanged();
      return report;
    }finally{unsubscribe();}
  }});
}
