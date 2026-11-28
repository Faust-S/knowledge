// Node Host composition candidate for W05. Uses original signed D1
// binding, original scoped Project/Work owner and already-installed
// original Agent readAccepted. No UI-selected owner, no new IAM, Task,
// Store or native dispatch. Do not mount before product owner adoption.
import {createHash} from 'node:crypto';
import { canonicalClone,canonicalStringify } from '../persistence/canonical-codec.mjs';
import { createSubjectKernelBinding } from './subject-access-binding.mjs';
import {compareWorkspaceMethodWithCreation,compareWorkspaceMethodWithOrigin} from '../modules/base/owners/project-process-method-comparison.mjs';
import {runOriginalWorkspaceMethodAlternative,reopenOriginalSavedWorkspaceMethodAlternative} from './workspace-method-alternative-lifecycle.mjs';
import { inspectWorkspaceMethodAgentPredecessorResults,readWorkspaceMethodInputOverview,
  previewWorkspaceMethodStageHandoff,inspectWorkspaceMethodNativeContinuation,inspectWorkspaceMethodMaterialEvidence,
  buildWorkspaceMethodPersonalTaskDraft,prepareWorkspaceMethodPersonalChain,buildWorkspaceMethodCorporateTaskReference,buildWorkspaceMethodCorporateTaskInputs,
  buildWorkspaceMethodProgramInput } from '../modules/base/owners/project-process-method-stage-input.mjs';

import {saveOriginalPersonalWorkflowDraft,inspectOriginalPersonalWorkflowTask,createOriginalPersonalWorkflowTaskObserver,
  recoverOriginalPersonalWorkflowTaskSelection,recoverOriginalPersonalWorkflowTaskSelections,personalWorkflowTaskInspection} from './workspace-method-personal-draft.mjs';

function deny(code){throw Object.assign(new Error(code),{code,outcome:'DENIED'});}
function check(ok,code){if(!ok)deny(code);}
export function createTrustedWorkspaceMethodStageReader(options={}){return createReader(options,false);}
// Native-only entry point. The ordinary UI reader does not expose actual
// material contents or an input transport callback.
export function createTrustedWorkspaceMethodCorporateInputReader(options={}){
  return createReader(options,true);
}
// Native-only program owner input transport. Never expose file text to the
// ordinary Workspace reader or accept a UI-supplied owner.
export function createTrustedWorkspaceMethodProgramInputReader(options={}){
  return createReader(options,false,true);
}
function createReader({kernel,accessForRead,currentWorkspace,
  sourceOwner,originalAgentResultOwner=null,nativeContinuation=null,nativeRecipientId=null,
  personalComposer=null,confirmPersonalDraft=null,personalTaskOwner=null,corporateTaskOwner=null,corporateResultOwner=null,
  confirmAlternative=null,isHostActive}={},nativeCorporateOnly=false,nativeProgramOnly=false){
  check(kernel?.sessionInfo?.contract_version==='1.3.0'&&typeof kernel.hasOperation==='function'
    &&kernel.hasOperation('t1.getObject')===true&&typeof accessForRead==='function'
    &&typeof currentWorkspace?.get==='function'&&typeof currentWorkspace?.subscribe==='function'
    &&typeof sourceOwner?.load==='function'
    &&(originalAgentResultOwner===null||typeof originalAgentResultOwner?.readAccepted==='function')
    &&(nativeContinuation===null||(typeof nativeContinuation?.preview==='function'&&typeof nativeContinuation?.recover==='function'
      &&typeof nativeRecipientId==='string'&&nativeRecipientId.length>0))
    &&(personalComposer===null||(typeof personalComposer.currentBinding==='function'
      &&typeof personalComposer.composerDraft==='function'&&typeof confirmPersonalDraft==='function'))
    &&(personalTaskOwner===null||(personalComposer!==null&&typeof personalTaskOwner.readAcceptedRun==='function'
      &&typeof personalTaskOwner.taskDocumentSource==='function'))
    &&(corporateTaskOwner===null||typeof corporateTaskOwner.readSignedTask==='function')
    &&(corporateResultOwner===null||typeof corporateResultOwner.readAccepted==='function'||typeof corporateResultOwner.readAcceptedForInputs==='function'||
      typeof corporateResultOwner.readSharedResult==='function')
    &&typeof isHostActive==='function'&&(!nativeCorporateOnly||corporateTaskOwner!==null),'T3_METHOD_STAGE_TRUSTED_HOST_REQUIRED');
  if(nativeCorporateOnly)check(typeof corporateTaskOwner.verifyTextInputs==='function','T3_METHOD_CORPORATE_TASK_INPUT_VERIFIER_REQUIRED');
  // Actual scoped source-owner write adoption and native confirmation are
  // required from trusted Host composition. Never enable from UI inputs.
  const alternativeEnabled=!nativeCorporateOnly&&!nativeProgramOnly&&confirmAlternative!==null;
  if(alternativeEnabled)check(typeof confirmAlternative==='function'
    &&['create','load','history','historyThrough'].every(name=>typeof sourceOwner[name]==='function'),
    'T3_METHOD_ALTERNATIVE_ORIGINAL_OWNER_REQUIRED');
  let alternativeInFlight=false;
  async function alternativeAction(input,mode){
    check(alternativeEnabled&&!alternativeInFlight,'T3_METHOD_ALTERNATIVE_IN_PROGRESS_OR_UNAVAILABLE');
    alternativeInFlight=true;
    try{return await read(input,mode);}finally{alternativeInFlight=false;}
  }
  let personalDraftInFlight=false;
  async function personalDraft(input,mode){
    check(!personalDraftInFlight,'T3_METHOD_PERSONAL_DRAFT_IN_PROGRESS');
    personalDraftInFlight=true;
    try{return await read(input,mode);}finally{personalDraftInFlight=false;}
  }
  async function read(input,mode,selectedOnly=false){
    const savedAlternativeMode=mode==='alternative-reopen';
    const alternativeMode=mode==='alternative-create'||mode==='alternative-recover'||savedAlternativeMode;
    const programMode=mode==='program-input';
    check(!programMode||nativeProgramOnly,'T3_METHOD_PROGRAM_NATIVE_OWNER_REQUIRED');
    const methodOnly=mode==='overview'||mode==='compare-creation'||mode==='compare-origin'||alternativeMode;
    // Native-only selection from an existing signed Task, never from UI metadata.
    const selected=selectedOnly?currentWorkspace.get():null;
    if(selectedOnly)check(nativeCorporateOnly&&mode==='corporate-inputs'&&input&&
      Object.keys(input).length===1&&/^task:[A-Za-z0-9:-]{1,100}$/.test(input.taskId??'')&&
      typeof selected?.workspace_id==='string'&&selected.deleted_at==null,'T3_METHOD_STAGE_SELECTION_REQUIRED');
    // Snapshot selections before any original owner await. No caller port,
    // context, Result content, digest, permission or dispatch callback.
    check(selectedOnly||(savedAlternativeMode?(alternativeEnabled&&input&&Object.keys(input).sort().join(',')==='projectId,targetProjectId,workspaceId'
      &&typeof input.workspaceId==='string'&&/^[A-Za-z0-9_-]{1,63}$/u.test(input.projectId??'')
      &&typeof input.projectId==='string'&&typeof input.targetProjectId==='string'&&/^[A-Za-z0-9_-]{1,63}$/u.test(input.targetProjectId)
      &&input.projectId!==input.targetProjectId):(input&&typeof input.workspaceId==='string'&&typeof input.projectId==='string'
      &&(methodOnly||typeof input.stepId==='string')&&Array.isArray(input.expected?.workRefs)
      &&(!alternativeMode||alternativeEnabled)
      &&(!programMode||(input.sourceAsset&&input.program&&(input.resultSelections??[]).length===0
        &&input.personalResultSelections===undefined&&input.corporateResultSelections===undefined))
      &&(mode!=='alternative-recover'||(typeof input.targetProjectId==='string'
        &&/^[A-Za-z0-9_-]{1,63}$/u.test(input.targetProjectId)&&input.targetProjectId!==input.projectId))
      &&input.expected.workRefs.length>0&&input.expected.workRefs.length<=64
      &&(methodOnly||input.resultSelections==null||(Array.isArray(input.resultSelections)&&input.resultSelections.length<=64))
      &&(!['native-preview','native-recover'].includes(mode)||typeof input.predecessorStepId==='string')
      &&(mode!=='handoff'||input.includeMaterialEvidence===undefined||typeof input.includeMaterialEvidence==='boolean')
      &&(!['personal-draft','personal-draft-recover','personal-task-inspect','corporate-reference','corporate-reference-inspect'].includes(mode)||/^[a-f0-9]{64}$/.test(input.expectedCandidateDigest??''))
      &&(!['personal-task-inspect','personal-task-recover','corporate-reference-inspect','corporate-reference-recover','corporate-inputs'].includes(mode)||typeof input.taskId==='string')
      &&(!['corporate-reference-inspect','corporate-reference-recover','corporate-inputs'].includes(mode)||/^task:[A-Za-z0-9:-]{1,100}$/.test(input.taskId))
      &&(!['corporate-reference-recover','corporate-inputs'].includes(mode)||input.expectedCandidateDigest===undefined)
      &&(mode!=='corporate-inputs'||(nativeCorporateOnly&&(input.resultSelections??[]).length===0))
      &&(input.corporateResultSelections===undefined||(['handoff','corporate-reference','corporate-reference-inspect','corporate-reference-recover','corporate-inputs'].includes(mode)
        &&Array.isArray(input.corporateResultSelections)&&input.corporateResultSelections.length>0&&input.corporateResultSelections.length<=63
        &&(input.resultSelections??[]).length===0&&input.personalResultSelections===undefined
        &&(mode!=='handoff'||input.includeMaterialEvidence===true)))
      &&(mode!=='personal-task-recover'||(input.personalResultSelections===undefined&&(input.resultSelections??[]).length===0))
      &&(input.personalResultSelections===undefined||(['handoff','personal-draft','personal-draft-recover','personal-task-inspect'].includes(mode)
        &&Array.isArray(input.personalResultSelections)&&input.personalResultSelections.length<=63
        &&(input.resultSelections??[]).length===0)))),
      'T3_METHOD_STAGE_SELECTION_REQUIRED');
    const ref=value=>({family:value?.family,objectId:value?.objectId,recordId:value?.recordId,revision:value?.revision});
    const request=selectedOnly?{workspaceId:selected.workspace_id,taskId:input.taskId,resultSelections:[]}:savedAlternativeMode?
      canonicalClone({workspaceId:input.workspaceId,projectId:input.projectId,targetProjectId:input.targetProjectId}):canonicalClone({workspaceId:input.workspaceId,projectId:input.projectId,
      expected:{projectRef:ref(input.expected.projectRef),workRefs:input.expected.workRefs.map(ref)},
      ...(mode==='alternative-recover'?{targetProjectId:input.targetProjectId}:{}),
      ...(programMode?{sourceAsset:input.sourceAsset,program:input.program}:{}),
      ...(methodOnly?{}:{stepId:input.stepId,
        resultSelections:(input.resultSelections??[]).map(row=>({stepId:row.stepId,reference:{
          workspace_id:row.reference?.workspace_id,object_id:row.reference?.object_id,
          schema_id:row.reference?.schema_id,revision:row.reference?.revision}}))}),
      ...(['native-preview','native-recover'].includes(mode)?{predecessorStepId:input.predecessorStepId}:{}),
      ...(mode==='handoff'&&input.includeMaterialEvidence===true?{includeMaterialEvidence:true}:{}),
      ...(['personal-draft','personal-draft-recover','personal-task-inspect','corporate-reference','corporate-reference-inspect'].includes(mode)?{expectedCandidateDigest:input.expectedCandidateDigest}:{}),
      ...(['personal-task-inspect','personal-task-recover','corporate-reference-inspect','corporate-reference-recover','corporate-inputs'].includes(mode)?{taskId:input.taskId}:{}),
      ...(input.personalResultSelections===undefined?{}:{personalResultSelections:input.personalResultSelections.map(row=>({
        stepId:row?.stepId,taskId:row?.taskId}))}),
      ...(input.corporateResultSelections===undefined?{}:{corporateResultSelections:input.corporateResultSelections.map(row=>({
        stepId:row?.stepId,acceptanceId:row?.acceptanceId,resultRevisionId:row?.resultRevisionId}))})});
    check(isHostActive()===true,'T3_HOST_DISPOSED');
    const workspaceSelection=selectedOnly?selected:currentWorkspace.get();
    check(workspaceSelection?.workspace_id===request.workspaceId&&workspaceSelection.deleted_at==null,'T3_METHOD_STAGE_WORKSPACE_REQUIRED');
    let changed=false;
    const unsubscribe=currentWorkspace.subscribe(()=>{changed=true;});
    const active=()=>isHostActive()===true&&!changed&&currentWorkspace.get()===workspaceSelection;
    const live=()=>check(active(),'T3_METHOD_STAGE_WORKSPACE_CHANGED');
    try{
      live();
      const access=await accessForRead('t1.getObject');
      live();
      const context=canonicalClone(await access.currentContext());
      live();
      check(context?.workspace_id===request.workspaceId&&context.resource===request.workspaceId,
        'T3_METHOD_STAGE_SIGNED_SCOPE_MISMATCH');
      const corporateMode=['corporate-reference','corporate-reference-inspect','corporate-reference-recover','corporate-inputs'].includes(mode);
      const corporateChain=request.corporateResultSelections!==undefined;
      if(corporateMode||corporateChain)check(context.kind==='CORP','T3_METHOD_CORPORATE_TASK_SCOPE_REQUIRED');
      if(programMode)check(context.kind==='PERSONAL','T3_METHOD_PROGRAM_PERSONAL_OWNER_REQUIRED');
      const personalChain=request.personalResultSelections!==undefined;
      const recoverTask=mode==='personal-task-recover';
      const inspectTask=mode==='personal-task-inspect'||recoverTask;
      const personalMode=personalChain||inspectTask||['personal-draft','personal-draft-recover'].includes(mode);
      if(personalChain&&mode==='personal-task-inspect')check(!request.personalResultSelections.some(row=>row.taskId===request.taskId),
        'T3_METHOD_STAGE_SELECTION_REQUIRED');
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
      },...((mode==='compare-creation'||mode==='compare-origin'||alternativeMode)&&typeof sourceOwner.historyThrough==='function'?{
        historyThrough:(kind,workspaceId,id,recordId,revision)=>{
          check(workspaceId===request.workspaceId,'T3_METHOD_STAGE_SIGNED_SCOPE_MISMATCH');
          return guarded(()=>sourceOwner.historyThrough(kind,workspaceId,id,recordId,revision));
        },
      }:{}),...(alternativeMode?{
        history:(kind,workspaceId,id)=>{
          check(workspaceId===request.workspaceId,'T3_METHOD_STAGE_SIGNED_SCOPE_MISMATCH');
          return guarded(()=>sourceOwner.history(kind,workspaceId,id));
        },
        ...(typeof sourceOwner.sourceIdentityExists==='function'?{
          sourceIdentityExists:(kind,workspaceId,id)=>{
            check(workspaceId===request.workspaceId,'T3_METHOD_STAGE_SIGNED_SCOPE_MISMATCH');
            return guarded(()=>sourceOwner.sourceIdentityExists(kind,workspaceId,id));
          },
        }:{}),
        create:async(kind,input)=>{
          check(['project','work'].includes(kind)&&input?.workspaceId===request.workspaceId,
            'T3_METHOD_STAGE_SIGNED_SCOPE_MISMATCH');
          // Re-observe the original D1 read before each original source
          // write. The adopted source owner must independently authorize
          // CREATE; the read grant and human confirmation are not a write grant.
          const current=await guarded(()=>signed.getWorkspace(request.workspaceId));
          check(current?.workspace_id===request.workspaceId&&current.deleted_at==null,'T3_METHOD_STAGE_WORKSPACE_REQUIRED');
          return guarded(()=>sourceOwner.create(kind,input));
        },
      }:{})};
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
      // The original recipient (Admin) may read its accepted Result for
      // planning. Native execution is a DIFFERENT original access route:
      // no fallback to the administrator's data access when running a Task.
      const planningResult=selected=>{
        check(typeof corporateResultOwner?.readAccepted==='function','T3_METHOD_CORPORATE_RESULT_ORIGINAL_OWNER_REQUIRED');
        return guarded(()=>corporateResultOwner.readAccepted(selected,context));
      };
      if(corporateChain&&mode!=='corporate-inputs')check(typeof corporateResultOwner?.readAccepted==='function',
        'T3_METHOD_CORPORATE_RESULT_ORIGINAL_OWNER_REQUIRED');
      const args={...request,owner,readObject,readAccepted,subjectKind:context.kind,
        ...(corporateChain?{organizationId:context.organization_id,readCorporateAcceptedResult:planningResult}:{})};
      let report;
      if(mode==='overview')report=await readWorkspaceMethodInputOverview(args);
      else if(mode==='compare-creation')report=await compareWorkspaceMethodWithCreation(args);
      else if(mode==='compare-origin')report=await compareWorkspaceMethodWithOrigin(args);
      else if(savedAlternativeMode)report=await reopenOriginalSavedWorkspaceMethodAlternative({...args,
        confirm:value=>guarded(()=>confirmAlternative(value))});
      else if(alternativeMode)report=await runOriginalWorkspaceMethodAlternative({...args,
        confirm:value=>guarded(()=>confirmAlternative(value))});
      else if(mode==='handoff'&&!request.includeMaterialEvidence&&!personalChain)report=await previewWorkspaceMethodStageHandoff(args);
      else if(mode==='material-evidence'||mode==='handoff'||personalMode||corporateMode||programMode){
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
        if(programMode)report=await buildWorkspaceMethodProgramInput(evidenceArgs);
        else if(corporateMode){
          if(mode==='corporate-reference')report=await buildWorkspaceMethodCorporateTaskReference(evidenceArgs);
          else{
            check(corporateTaskOwner!==null,'T3_METHOD_CORPORATE_TASK_ORIGINAL_OWNER_REQUIRED');
            const readReference=async()=>{
              const value=canonicalClone(await guarded(()=>corporateTaskOwner.readSignedTask(request.taskId,context)));
              const reference=value?.workflowReference;
              check(value?.found===true&&value.taskId===request.taskId&&/^[a-f0-9]{64}$/.test(value.taskRevisionId??'')
                &&/^[a-f0-9]{64}$/.test(value.packageSha256??'')&&typeof value.recipientId==='string'
                &&reference?.state==='SIGNED_WORKFLOW_REFERENCE_ONLY'&&reference.taskId===value.taskId
                &&reference.taskRevisionId===value.taskRevisionId&&reference.exactInputBindingProven===false
                &&reference.workCompleted===false&&reference.resultReuseProven===false&&reference.executionAuthorized===false,
                'T3_METHOD_CORPORATE_TASK_SIGNED_REFERENCE_REQUIRED');
              if(mode==='corporate-inputs')check(value.status==='SIGNED_TASK_CURRENT_SELECTED'&&
                value.organizationId===context.organization_id&&value.workspaceId===context.workspace_id
                &&value.recipientId===context.actor_id&&Number.isSafeInteger(value.originalContextEpoch)&&value.originalContextEpoch>0,
                'T3_METHOD_CORPORATE_TASK_EXECUTOR_MISMATCH');
              return {taskId:value.taskId,taskRevisionId:value.taskRevisionId,packageSha256:value.packageSha256,
                recipientId:value.recipientId,workflowInput:reference.workflowInput,
                ...(mode==='corporate-inputs'?{organizationId:value.organizationId,workspaceId:value.workspaceId,
                  originalContextEpoch:value.originalContextEpoch}:{})};
            };
            const first=await readReference();
            // A signed original Task may supply its own expected reference after restart.
            // Native selected-only reads reconstruct precisely its declared closure;
            // historical explicit selections continue to use the full method set.
            // Never derive authority or complete material content from carrier metadata.
            const recovering=mode==='corporate-reference-recover'||mode==='corporate-inputs';
            const w=first.workflowInput;
            const signedSelection=selectedOnly?{
              projectId:w?.projectId,stepId:w?.stepId,expected:{projectRef:w?.projectRef,
                workRefs:[w?.workRef,...(Array.isArray(w?.acceptedPredecessors)?w.acceptedPredecessors.map(row=>row?.acceptedResult?.workflowInput?.workRef):[])]},
              selectedClosureOnly:true}:null;
            const effectiveRequest=signedSelection?{...request,...signedSelection}:request;
            if(recovering)check(w?.schema==='IWXA_T3_WORKFLOW_INPUT_REFERENCE/1'&&w.workspaceId===request.workspaceId
              &&w.projectId===effectiveRequest.projectId&&w.stepId===effectiveRequest.stepId
              &&canonicalStringify(w.projectRef)===canonicalStringify(effectiveRequest.expected.projectRef)
              &&effectiveRequest.expected.workRefs.some(ref=>canonicalStringify(ref)===canonicalStringify(w.workRef))
              &&/^[a-f0-9]{64}$/.test(w.candidateDigest??''),
              'T3_METHOD_CORPORATE_TASK_REFERENCE_SCOPE_MISMATCH');
            const prepare=mode==='corporate-inputs'?buildWorkspaceMethodCorporateTaskInputs:buildWorkspaceMethodCorporateTaskReference;
            const preparedArgs=recovering?{...evidenceArgs,...(signedSelection??{}),expectedCandidateDigest:w.candidateDigest}:evidenceArgs;
            // New independent assignments carry only a flat, signed list
            // of the selected accepted Result references. Recover the
            // complete prerequisite closure without UI/manager lookup.
            const signedPredecessors=w.acceptedPredecessors;
            const sharedSnapshot=mode==='corporate-inputs'&&signedPredecessors!==undefined;
            if(signedPredecessors!==undefined){
              check(Array.isArray(signedPredecessors)&&signedPredecessors.length>0&&signedPredecessors.length<=63,
                'T3_METHOD_CORPORATE_TASK_REFERENCE_SCOPE_MISMATCH');
              const declared=signedPredecessors.map(row=>({
                stepId:row.stepId,acceptanceId:row.acceptedResult.acceptanceId,
                resultRevisionId:row.acceptedResult.resultRevisionId}));
              const byStep=new Map(signedPredecessors.map(row=>[row.stepId,row]));
              check(byStep.size===declared.length,'T3_METHOD_CORPORATE_TASK_REFERENCE_SCOPE_MISMATCH');
              if(request.corporateResultSelections!==undefined){
                const ordered=rows=>rows.slice().sort((a,b)=>a.stepId.localeCompare(b.stepId));
                check(canonicalStringify(ordered(declared))===canonicalStringify(ordered(request.corporateResultSelections)),
                  'T3_METHOD_CORPORATE_TASK_REFERENCE_SCOPE_MISMATCH');
              }
              preparedArgs.corporateResultSelections=declared;
              preparedArgs.organizationId=context.organization_id;
              if(sharedSnapshot){
                check(typeof corporateResultOwner?.readSharedResult==='function',
                  'T3_METHOD_CORPORATE_RESULT_ORIGINAL_OWNER_REQUIRED');
                preparedArgs.corporateResultObservation='SIGNED_ASSIGNMENT_SNAPSHOT';
                preparedArgs.readCorporateAcceptedResult=selected=>guarded(async()=>{
                  const row=byStep.get(selected.stepId),a=row?.acceptedResult;
                  check(a&&a.acceptanceId===selected.acceptanceId&&a.resultRevisionId===selected.resultRevisionId
                    &&a.organizationId===context.organization_id&&a.workspaceId===context.workspace_id,
                    'T3_METHOD_CORPORATE_TASK_REFERENCE_SCOPE_MISMATCH');
                  const sourceTask={organizationId:a.organizationId,workspaceId:a.workspaceId,executorId:a.executorId,
                    taskId:a.taskId,taskRevisionId:a.taskRevisionId,packageSha256:a.taskPackageSha256};
                  // This is the existing native company Workspace persistence
                  // owner, with the employee's own DATA. No Admin readback.
                  const seen=canonicalClone(await corporateResultOwner.readSharedResult({
                    sourceTask,artifactId:row.artifactId,artifactSha256:a.resultSha256},context,first));
                  const obj=seen?.originalObject,data=obj?.data;
                  check(seen?.state==='COMPANY_ORIGINAL_RESULT_OBSERVED'&&seen.originalKernelReadback===true
                    &&seen.corporateAcceptanceProven===false&&seen.sourceCurrentnessProven===false
                    &&seen.executionAuthorized===false&&seen.writeAuthorized===false&&seen.workCompleted===false
                    &&seen.organizationId===context.organization_id&&seen.workspaceId===context.workspace_id
                    &&seen.readerExecutorId===context.actor_id&&canonicalStringify(seen.sourceTask)===canonicalStringify(sourceTask)
                    &&seen.artifactId===row.artifactId&&seen.artifactSha256===a.resultSha256
                    &&obj.workspace_id===context.workspace_id&&obj.object_id===row.originalCompanyRecordId
                    &&obj.schema_id==='iwxa.t3.company-work-record'&&obj.revision===1&&obj.deleted!==true&&obj.deleted_at==null
                    &&data?.schema==='IWXA_T3_ORIGINAL_COMPANY_WORK_RECORD/1'&&data.kind==='RESULT'
                    &&data.sourceKind==='ORIGINAL_AGENT_HUMAN_ACCEPTED'&&data.artifactId===row.artifactId
                    &&['organizationId','workspaceId','executorId','taskId','taskRevisionId'].every(k=>data[k]===sourceTask[k])
                    &&data.taskPackageSha256===sourceTask.packageSha256&&data.sha256===a.resultSha256
                    &&typeof data.text==='string'&&createHash('sha256').update(data.text,'utf8').digest('hex')===a.resultSha256,
                    'T3_METHOD_CORPORATE_SHARED_RESULT_READBACK_MISMATCH');
                  return Object.freeze({...a,artifactId:row.artifactId,originalCompanyRecordId:row.originalCompanyRecordId,
                    result:data.text,state:'ORIGINAL_SIGNED_WORKFLOW_PREDECESSOR_OBSERVED',originalRecipientReadback:false,
                    originalKernelReadback:true,readOnly:true,acceptanceState:'ACCEPTED',currentness:'ISSUER_ACCEPTANCE_AT_SIGNING',
                    sourceCurrentnessProven:false,executionAuthorized:false});
                });
              }else{
                check(typeof corporateResultOwner?.readAccepted==='function','T3_METHOD_CORPORATE_RESULT_ORIGINAL_OWNER_REQUIRED');
                preparedArgs.readCorporateAcceptedResult=planningResult;
              }
            }else if(mode==='corporate-inputs'&&corporateChain){
              // Historical signed v2 without the new declaration must not
              // borrow Admin planning authority. Its existing explicit
              // installed recipient input port remains separate.
              check(typeof corporateResultOwner?.readAcceptedForInputs==='function',
                'T3_METHOD_CORPORATE_RESULT_ORIGINAL_OWNER_REQUIRED');
              preparedArgs.readCorporateAcceptedResult=selected=>guarded(()=>corporateResultOwner.readAcceptedForInputs(selected,context,first));
            }
            const prepared=await prepare(preparedArgs);
            if(mode==='corporate-inputs'){
              // The original Task owner now performs the final selected
              // signed-carrier read AND independently verifies every byte.
              // Keep two owner observations, no additional full Asset read.
              check(canonicalStringify(first.workflowInput)===canonicalStringify(prepared.workflowInput),
                'T3_METHOD_CORPORATE_TASK_REFERENCE_MISMATCH');
              const attachmentDigest=createHash('sha256').update(canonicalStringify(prepared.attachments),'utf8').digest('hex');
              const verified=canonicalClone(await guarded(()=>corporateTaskOwner.verifyTextInputs({
                taskId:first.taskId,taskRevisionId:first.taskRevisionId,packageSha256:first.packageSha256,
                attachments:canonicalClone(prepared.attachments)},context)));
              check(verified?.taskId===first.taskId&&verified.taskRevisionId===first.taskRevisionId
                &&verified.packageSha256===first.packageSha256&&verified.originalContextEpoch===first.originalContextEpoch,
                'T3_METHOD_CORPORATE_TASK_REVISION_CHANGED');
              check(verified.state==='WORKFLOW_TEXT_INPUT_SNAPSHOT_MATCHED'
                &&verified.candidateDigest===first.workflowInput.candidateDigest&&verified.attachmentDigest===attachmentDigest
                &&verified.declaredSnapshotBytesVerified===true&&verified.sourceCurrentnessProven===false
                &&verified.allAssetsProven===false&&verified.disclosureAuthorized===false&&verified.executionAuthorized===false
                &&verified.exactInputBindingProven===false&&verified.workCompleted===false
                &&['materials','assets','attachments','attachmentBytes'].every(k=>verified.counts?.[k]===prepared.counts[k])
                &&verified.counts?.results===(prepared.counts.results??0),'T3_METHOD_CORPORATE_TASK_INPUT_VERIFICATION_FAILED');
              report=Object.freeze({...prepared,...first,declaredReferenceMatched:true,
                declaredSnapshotBytesVerified:true,attachmentDigest,
                ...(sharedSnapshot?{predecessorAcceptanceObservation:'ISSUER_ACCEPTANCE_AT_SIGNING',sourceCurrentnessProven:false}:{})});
            }else{
              const last=await readReference();
              check(canonicalStringify(first)===canonicalStringify(last),'T3_METHOD_CORPORATE_TASK_REVISION_CHANGED');
              check(canonicalStringify(last.workflowInput)===canonicalStringify(prepared.workflowInput),'T3_METHOD_CORPORATE_TASK_REFERENCE_MISMATCH');
              report=Object.freeze({state:'SIGNED_CORPORATE_TASK_CURRENT_REFERENCE_MATCHED',...last,
                ...(recovering?{recoveredFromOriginalTask:true}:{}),declaredReferenceMatched:true,exactInputBindingProven:false,allAssetsProven:false,workCompleted:false,
                executionAuthority:false,writeAuthorized:false,resultReuseProven:false});
            }
          }
        }else if(personalMode){
          const observer=(personalChain||recoverTask)?await createOriginalPersonalWorkflowTaskObserver({workspaceId:request.workspaceId,
            composer:personalComposer,taskOwner:personalTaskOwner,guarded}):null;
          const recovered=recoverTask?await recoverOriginalPersonalWorkflowTaskSelection({...request,observer}):null;
          const selectedArgs=recovered?{...evidenceArgs,personalResultSelections:recovered.personalResultSelections,
            expectedCandidateDigest:recovered.candidateDigest}:evidenceArgs;
          const chain=personalChain||!!recovered?.personalResultSelections.length;
          let resolvedSelections=null;
          const prepare=async()=>{
            const prepared=chain?await prepareWorkspaceMethodPersonalChain({...selectedArgs,
              ...(resolvedSelections?{personalResultSelections:resolvedSelections}:{}),
              resolvePersonalResultSelections:selections=>recoverOriginalPersonalWorkflowTaskSelections({
                workspaceId:request.workspaceId,projectId:request.projectId,expected:request.expected,observer,selections}),
              readVerifiedPersonalResult:observer.read,...(inspectTask?{targetTaskId:request.taskId}:{})}):
              {plan:await buildWorkspaceMethodPersonalTaskDraft(selectedArgs)};
            // Scope-local exact resolved choices only. On consent recheck
            // every actual Task and byte again; no repeated discovery and
            // no durable cache or implicit selection of a later result.
            if(chain)resolvedSelections=prepared.resolvedSelections;
            const current=await guarded(()=>signed.getWorkspace(request.workspaceId));
            check(current?.workspace_id===request.workspaceId&&current.deleted_at==null,'T3_METHOD_STAGE_WORKSPACE_REQUIRED');
            if(observer)await observer.verifyCurrent();
            return observer?{...prepared,plan:Object.freeze({...prepared.plan,nativeBinding:observer.binding})}:prepared;
          };
          const build=async()=>(await prepare()).plan;
          const prepared=await prepare(),plan=prepared.plan;
          if(mode==='handoff')report=prepared.report;
          else if(inspectTask){
            check(personalTaskOwner!==null,'T3_METHOD_PERSONAL_TASK_ORIGINAL_OWNER_REQUIRED');
            report=chain?personalWorkflowTaskInspection(plan,prepared.targetAccepted):
              await inspectOriginalPersonalWorkflowTask({plan,taskId:request.taskId,composer:personalComposer,
                taskOwner:personalTaskOwner,guarded,refreshPlan:build});
            if(recovered)report=Object.freeze({...report,recoveredFromOriginalTask:true,
              canonicalWorkRef:recovered.canonicalWorkRef,personalResultSelections:recovered.personalResultSelections});
          }else report=await saveOriginalPersonalWorkflowDraft({plan,refreshPlan:build,composer:personalComposer,
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
  if(nativeProgramOnly)return Object.freeze({readInputs:input=>read(input,'program-input')});
  if(nativeCorporateOnly)return Object.freeze({readInputs:input=>read(input,'corporate-inputs'),
    readSelectedInputs:input=>read(input,'corporate-inputs',true)});
  return Object.freeze({
    inspect:input=>read(input,'inspect'),
    overview:input=>read(input,'overview'),
    ...(typeof sourceOwner.historyThrough==='function'?{compareCreation:input=>read(input,'compare-creation'),
      compareOrigin:input=>read(input,'compare-origin')}:{}),
    ...(alternativeEnabled?{createAlternative:input=>alternativeAction(input,'alternative-create'),
      recoverAlternative:input=>alternativeAction(input,'alternative-recover'),
      reopenSavedAlternative:input=>alternativeAction(input,'alternative-reopen')}:{}),
    previewHandoff:input=>read(input,'handoff'),
    inspectMaterialEvidence:input=>read(input,'material-evidence'),
    prepareCorporateTaskReference:input=>read(input,'corporate-reference'),
    ...(corporateTaskOwner===null?{}:{inspectCorporateTaskReference:input=>read(input,'corporate-reference-inspect'),
      recoverCorporateTaskReference:input=>read(input,'corporate-reference-recover')}),
    ...(personalComposer===null?{}:{
      createPersonalDraft:input=>personalDraft(input,'personal-draft'),
      recoverPersonalDraft:input=>personalDraft(input,'personal-draft-recover'),
    }),
    ...(personalTaskOwner===null?{}:{inspectPersonalTask:input=>read(input,'personal-task-inspect'),
      recoverPersonalTask:input=>read(input,'personal-task-recover')}),
    previewContinuation:input=>read(input,'native-preview'),
    recoverContinuation:input=>read(input,'native-recover'),
  });
}
