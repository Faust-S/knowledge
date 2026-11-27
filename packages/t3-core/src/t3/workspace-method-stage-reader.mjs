// Node Host composition candidate for W05. Uses original signed D1
// binding, original scoped Project/Work owner and already-installed
// original Agent readAccepted. No UI-selected owner, no new IAM, Task,
// Store or native dispatch. Do not mount before product owner adoption.
import { canonicalClone,canonicalStringify } from '../persistence/canonical-codec.mjs';
import { createSubjectKernelBinding } from './subject-access-binding.mjs';
import { inspectWorkspaceMethodAgentPredecessorResults,readWorkspaceMethodInputOverview,
  previewWorkspaceMethodStageHandoff,inspectWorkspaceMethodNativeContinuation,inspectWorkspaceMethodMaterialEvidence,
  buildWorkspaceMethodPersonalTaskDraft } from '../modules/base/owners/project-process-method-stage-input.mjs';

import {saveOriginalPersonalWorkflowDraft} from './workspace-method-personal-draft.mjs';

function deny(code){throw Object.assign(new Error(code),{code,outcome:'DENIED'});}
function check(ok,code){if(!ok)deny(code);}
export function createTrustedWorkspaceMethodStageReader({kernel,accessForRead,currentWorkspace,
  sourceOwner,originalAgentResultOwner=null,nativeContinuation=null,nativeRecipientId=null,
  personalComposer=null,confirmPersonalDraft=null,isHostActive}={}){
  check(kernel?.sessionInfo?.contract_version==='1.3.0'&&typeof kernel.hasOperation==='function'
    &&kernel.hasOperation('t1.getObject')===true&&typeof accessForRead==='function'
    &&typeof currentWorkspace?.get==='function'&&typeof currentWorkspace?.subscribe==='function'
    &&typeof sourceOwner?.load==='function'
    &&(originalAgentResultOwner===null||typeof originalAgentResultOwner?.readAccepted==='function')
    &&(nativeContinuation===null||(typeof nativeContinuation?.preview==='function'&&typeof nativeContinuation?.recover==='function'
      &&typeof nativeRecipientId==='string'&&nativeRecipientId.length>0))
    &&(personalComposer===null||(typeof personalComposer.currentBinding==='function'
      &&typeof personalComposer.composerDraft==='function'&&typeof confirmPersonalDraft==='function'))
    &&typeof isHostActive==='function','T3_METHOD_STAGE_TRUSTED_HOST_REQUIRED');
  let personalDraftInFlight=false;
  async function personalDraft(input,mode){
    check(!personalDraftInFlight,'T3_METHOD_PERSONAL_DRAFT_IN_PROGRESS');
    personalDraftInFlight=true;
    try{return await read(input,mode);}finally{personalDraftInFlight=false;}
  }
  async function read(input,mode){
    // Snapshot selections before any original owner await. No caller port,
    // context, Result content, digest, permission or dispatch callback.
    check(input&&typeof input.workspaceId==='string'&&typeof input.projectId==='string'
      &&(mode==='overview'||typeof input.stepId==='string')&&Array.isArray(input.expected?.workRefs)
      &&input.expected.workRefs.length>0&&input.expected.workRefs.length<=64
      &&(mode==='overview'||input.resultSelections==null||(Array.isArray(input.resultSelections)&&input.resultSelections.length<=64))
      &&(!['native-preview','native-recover'].includes(mode)||typeof input.predecessorStepId==='string')
      &&(mode!=='handoff'||input.includeMaterialEvidence===undefined||typeof input.includeMaterialEvidence==='boolean')
      &&(!['personal-draft','personal-draft-recover'].includes(mode)||/^[a-f0-9]{64}$/.test(input.expectedCandidateDigest??'')),
      'T3_METHOD_STAGE_SELECTION_REQUIRED');
    const ref=value=>({family:value?.family,objectId:value?.objectId,recordId:value?.recordId,revision:value?.revision});
    const request=canonicalClone({workspaceId:input.workspaceId,projectId:input.projectId,
      expected:{projectRef:ref(input.expected.projectRef),workRefs:input.expected.workRefs.map(ref)},
      ...(mode==='overview'?{}:{stepId:input.stepId,
        resultSelections:(input.resultSelections??[]).map(row=>({stepId:row.stepId,reference:{
          workspace_id:row.reference?.workspace_id,object_id:row.reference?.object_id,
          schema_id:row.reference?.schema_id,revision:row.reference?.revision}}))}),
      ...(['native-preview','native-recover'].includes(mode)?{predecessorStepId:input.predecessorStepId}:{}),
      ...(mode==='handoff'&&input.includeMaterialEvidence===true?{includeMaterialEvidence:true}:{}),
      ...(['personal-draft','personal-draft-recover'].includes(mode)?{expectedCandidateDigest:input.expectedCandidateDigest}:{})});
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
      const personalMode=['personal-draft','personal-draft-recover'].includes(mode);
      if(personalMode)check(context.kind==='PERSONAL'&&personalComposer!==null,'T3_METHOD_PERSONAL_DRAFT_PERSONAL_OWNER_REQUIRED');
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
        check(originalAgentResultOwner!==null,'T3_METHOD_STAGE_RESULT_OWNER_REQUIRED');
        check(reference.workspace_id===request.workspaceId,'T3_METHOD_STAGE_SIGNED_SCOPE_MISMATCH');
        return guarded(()=>originalAgentResultOwner.readAccepted(reference));
      };
      // Establish a current original D1 workspace read even for a stage
      // without material or Result references. The trusted source-owner
      // port remains independently responsible for its own permissions.
      check(kernel.hasOperation('t1.getWorkspace')===true,'T3_METHOD_STAGE_WORKSPACE_READ_REQUIRED');
      const workspace=await guarded(()=>signed.getWorkspace(request.workspaceId));
      check(workspace?.workspace_id===request.workspaceId&&workspace.deleted_at==null,'T3_METHOD_STAGE_WORKSPACE_REQUIRED');
      const args={...request,owner,readObject,readAccepted,subjectKind:context.kind};
      let report;
      if(mode==='overview')report=await readWorkspaceMethodInputOverview(args);
      else if(mode==='handoff'&&!request.includeMaterialEvidence)report=await previewWorkspaceMethodStageHandoff(args);
      else if(mode==='material-evidence'||mode==='handoff'||personalMode){
        // Resolve the ORIGINAL owner for each Asset operation, then fence
        // its complete signed context against the already selected method.
        // Each individual read still receives a fresh D1 authorization.
        const assetPort=async operation=>{
          check(kernel.hasOperation(operation)===true,'T3_METHOD_STAGE_ASSET_READ_REQUIRED');
          const original=await guarded(()=>accessForRead(operation));
          check(original&&typeof original.currentContext==='function','T3_METHOD_STAGE_SIGNED_OWNER_REQUIRED');
          const matches=async()=>check(canonicalStringify(await original.currentContext())===identity,
            'T3_METHOD_STAGE_SIGNED_CONTEXT_CHANGED');
          await guarded(matches);
          const binding=createSubjectKernelBinding({kernel,access:original,isHostActive:active});
          return fn=>guarded(async()=>{await matches();const value=await fn(binding);await matches();return value;});
        };
        const list=await assetPort('t1.listAssets'),get=await assetPort('t1.getAsset');
        const evidenceArgs={...args,listAssets:query=>list(binding=>binding.listAssets(query)),
          getAsset:(workspaceId,id)=>get(binding=>binding.getAsset(workspaceId,id))};
        if(personalMode){
          const build=async()=>{
            const plan=await buildWorkspaceMethodPersonalTaskDraft(evidenceArgs);
            const current=await guarded(()=>signed.getWorkspace(request.workspaceId));
            check(current?.workspace_id===request.workspaceId&&current.deleted_at==null,'T3_METHOD_STAGE_WORKSPACE_REQUIRED');
            return plan;
          };
          const plan=await build();
          report=await saveOriginalPersonalWorkflowDraft({plan,refreshPlan:build,composer:personalComposer,
            guarded,confirm:confirmPersonalDraft,recoverOnly:mode==='personal-draft-recover'});
        }else report=mode==='handoff'?await previewWorkspaceMethodStageHandoff(evidenceArgs):
          await inspectWorkspaceMethodMaterialEvidence(evidenceArgs);
      }
      else if(['native-preview','native-recover'].includes(mode)){
        check(nativeContinuation!==null,'T3_METHOD_STAGE_NATIVE_OWNER_REQUIRED');
        // Only the original installed D6 port supplied by trusted Host
        // composition can be used. No recipient/dispatch from UI.
        const port=Object.freeze({
          preview:reference=>guarded(()=>nativeContinuation.preview(reference,context)),
          recover:reference=>guarded(()=>nativeContinuation.recover(reference,context)),
        });
        report=await inspectWorkspaceMethodNativeContinuation({...args,nativeContinuation:port,
          recipientId:nativeRecipientId,recover:mode==='native-recover'});
      }else report=await inspectWorkspaceMethodAgentPredecessorResults(args);
      const finalWorkspace=await guarded(()=>signed.getWorkspace(request.workspaceId));
      check(finalWorkspace?.workspace_id===request.workspaceId&&finalWorkspace.deleted_at==null,'T3_METHOD_STAGE_WORKSPACE_REQUIRED');
      await unchanged();
      return report;
    }finally{unsubscribe();}
  }
  return Object.freeze({
    inspect:input=>read(input,'inspect'),
    overview:input=>read(input,'overview'),
    previewHandoff:input=>read(input,'handoff'),
    inspectMaterialEvidence:input=>read(input,'material-evidence'),
    ...(personalComposer===null?{}:{
      createPersonalDraft:input=>personalDraft(input,'personal-draft'),
      recoverPersonalDraft:input=>personalDraft(input,'personal-draft-recover'),
    }),
    previewContinuation:input=>read(input,'native-preview'),
    recoverContinuation:input=>read(input,'native-recover'),
  });
}
