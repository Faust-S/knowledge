// W05.10. A thin consumer of the ORIGINAL local Agent SessionRuntime
// composer_draft read/compare-and-save operation. No Task creation, Store,
// queue, additional native owner, local model invocation, or transport.
import {createHash} from 'node:crypto';
import {canonicalStringify} from '../persistence/canonical-codec.mjs';
const HEX=/^[a-f0-9]{64}$/;
const AREA=/^(personal|AREA-[0-9a-f]{18})$/;
const equal=(a,b)=>canonicalStringify(a)===canonicalStringify(b);
function check(ok,code){if(!ok)throw Object.assign(Error(code),{code,outcome:'DENIED'});}
function nativeBinding(row,workspaceId){
  check(row?.subjectKind==='PERSONAL'&&row.sourceWorkspaceId===workspaceId
    &&typeof row.agentWorkspaceId==='string'&&AREA.test(row.agentWorkspaceId)
    &&typeof row.contextEpoch==='string'&&row.contextEpoch.length>0&&row.contextEpoch.length<=256,
    'T3_METHOD_PERSONAL_DRAFT_NATIVE_SCOPE_MISMATCH');
  return Object.freeze({subjectKind:'PERSONAL',sourceWorkspaceId:workspaceId,
    agentWorkspaceId:row.agentWorkspaceId,contextEpoch:row.contextEpoch});
}
function originalDraft(row,binding){
  check(row?.workspace_id===binding.agentWorkspaceId&&['SAVED','EMPTY_OR_UNREADABLE'].includes(row.state)
    &&HEX.test(row.draft_digest??'')&&typeof row.text==='string'&&Array.isArray(row.knowledge_sources)
    &&Array.isArray(row.attachments)&&Object.hasOwn(row,'local_model')&&Object.hasOwn(row,'pending_submission'),
    'T3_METHOD_PERSONAL_DRAFT_READBACK_INVALID');
  // The existing owner rejects unreadable stored drafts rather than
  // returning them as empty. Never accept a nonempty empty-state response.
  check(row.state!=='EMPTY_OR_UNREADABLE'||(row.text===''&&row.knowledge_sources.length===0
    &&row.attachments.length===0&&row.local_model===null&&row.pending_submission===null),
    'T3_METHOD_PERSONAL_DRAFT_READBACK_INVALID');
  return structuredClone(row);
}
const sameDraft=(row,plan)=>row.state==='SAVED'&&row.pending_submission===null&&
  row.text===plan.draft.text&&equal(row.knowledge_sources,plan.draft.knowledge_sources)&&
  equal(row.attachments,plan.draft.attachments);
const emptyDraft=row=>row.pending_submission===null&&row.text===''&&row.knowledge_sources.length===0&&row.attachments.length===0;
export async function saveOriginalPersonalWorkflowDraft({plan,refreshPlan,composer,guarded,confirm,recoverOnly=false}){
  check(typeof composer?.currentBinding==='function'&&typeof composer?.composerDraft==='function'
    &&typeof guarded==='function'&&typeof refreshPlan==='function'&&typeof confirm==='function',
    'T3_METHOD_PERSONAL_DRAFT_ORIGINAL_OWNER_REQUIRED');
  const binding=nativeBinding(await guarded(()=>composer.currentBinding()),plan.workspaceId);
  if(plan.nativeBinding)check(equal(plan.nativeBinding,binding),'T3_METHOD_PERSONAL_DRAFT_NATIVE_SCOPE_CHANGED');
  const currentBinding=async()=>check(equal(nativeBinding(await guarded(()=>composer.currentBinding()),plan.workspaceId),binding),
    'T3_METHOD_PERSONAL_DRAFT_NATIVE_SCOPE_CHANGED');
  const read=async()=>{
    await currentBinding();
    const row=originalDraft(await guarded(()=>composer.composerDraft({context:'task'},binding)),binding);
    await currentBinding();return row;
  };
  const response=(state,row=null)=>Object.freeze({state,candidateDigest:plan.candidateDigest,
    workspaceId:plan.workspaceId,projectId:plan.projectId,stepId:plan.stepId,
    agentWorkspaceId:binding.agentWorkspaceId,draftDigest:row?.draft_digest??null,
    draftSaved:state==='DRAFT_CONFIRMED'||state==='DRAFT_ALREADY_PRESENT',
    taskCreated:false,executionPerformed:false,modelInvoked:false,allAssetsProven:false,exactInputBindingProven:false});
  const before=await read();
  if(sameDraft(before,plan))return response('DRAFT_ALREADY_PRESENT',before);
  if(recoverOnly)return response('OUTCOME_UNKNOWN');
  if(!emptyDraft(before))return response('DRAFT_OCCUPIED');
  // Capture owner digest and model preference BEFORE asking a person.
  const beforeDigest=before.draft_digest,model=canonicalStringify(before.local_model);
  const approved=await guarded(()=>confirm(Object.freeze({workspaceId:plan.workspaceId,projectId:plan.projectId,
    stepId:plan.stepId,agentWorkspaceId:binding.agentWorkspaceId,candidateDigest:plan.candidateDigest,
    counts:plan.counts,onlyEditableDraft:true,allAssetsProven:false})));
  await currentBinding();
  if(approved!==true)return response('USER_CANCELLED');
  const fresh=await refreshPlan();
  check(fresh.candidateDigest===plan.candidateDigest&&equal(fresh.draft,plan.draft),
    'T3_METHOD_PERSONAL_DRAFT_EVIDENCE_CHANGED');
  if(fresh.nativeBinding)check(equal(fresh.nativeBinding,binding),'T3_METHOD_PERSONAL_DRAFT_NATIVE_SCOPE_CHANGED');
  const latest=await read();
  if(sameDraft(latest,plan))return response('DRAFT_ALREADY_PRESENT',latest);
  if(latest.draft_digest!==beforeDigest||!emptyDraft(latest)||canonicalStringify(latest.local_model)!==model)
    return response('DRAFT_CHANGED');
  // The existing SessionRuntime CAS includes the original active WorkArea
  // identity. The installed adapter MUST check this binding and pending
  // submission/empty state under the original SessionRuntime mutation lock.
  // No caller-derived digest, no overwrite of an unrelated draft,
  // no model selection, pending submission, or automatic task launch.
  await currentBinding();
  let dispatched=false;
  try{
    await guarded(()=>{dispatched=true;return composer.composerDraft({context:'task',text:fresh.draft.text,
      knowledge_sources:fresh.draft.knowledge_sources,attachments:fresh.draft.attachments,expected_draft_digest:beforeDigest},binding);});
  }catch(error){
    if(!dispatched)throw error;
    // Save may have committed before the acknowledgement was lost.
    // Only ORIGINAL readback can recover it. Never re-send.
  }
  let after;
  try{after=await read();}catch{return response('OUTCOME_UNKNOWN');}
  return sameDraft(after,fresh)&&canonicalStringify(after.local_model)===model?
    response('DRAFT_CONFIRMED',after):response('OUTCOME_UNKNOWN');
}

// W05.12: correlate the explicitly selected accepted original personal
// Task and its actual accepted run, not the latest editable composer or a
// different historical snapshot. The native owner must verify the ORIGINAL
// Core Task/Result/Review chain and return its accepted-run snapshot.
// No acceptance, publication, workflow completion, or new Task is written.
const sha=text=>createHash('sha256').update(text,'utf8').digest('hex');
// One original accepted-run observation, used by the ordinary two-read
// inspection and by the personal chain's two complete source passes.
// The result text is for trusted Host composition, never a UI receipt.
export async function createOriginalPersonalWorkflowTaskObserver({workspaceId,composer,taskOwner,guarded}){
  check(typeof composer?.currentBinding==='function'&&typeof taskOwner?.readAcceptedRun==='function'
    &&typeof taskOwner?.taskDocumentSource==='function'&&typeof guarded==='function',
    'T3_METHOD_PERSONAL_TASK_ORIGINAL_OWNER_REQUIRED');
  const binding=nativeBinding(await guarded(()=>composer.currentBinding()),workspaceId);
  const current=async()=>check(equal(nativeBinding(await guarded(()=>composer.currentBinding()),workspaceId),binding),
    'T3_METHOD_PERSONAL_DRAFT_NATIVE_SCOPE_CHANGED');
  const read=async(plan,taskId)=>{
    check(plan?.workspaceId===workspaceId&&typeof taskId==='string'&&/^TASK-[A-Za-z0-9_-]{1,120}$/.test(taskId),
      'T3_METHOD_PERSONAL_TASK_ORIGINAL_OWNER_REQUIRED');
    if(plan.nativeBinding)check(equal(plan.nativeBinding,binding),'T3_METHOD_PERSONAL_DRAFT_NATIVE_SCOPE_CHANGED');
    await current();
    const value=structuredClone(await guarded(()=>taskOwner.readAcceptedRun(taskId,binding)));
    await current();
    const {task,result,snapshot,acceptedSource}=value??{};
    check(task?.task_id===taskId&&result?.task_id===taskId&&snapshot?.task_id===taskId
      &&acceptedSource?.task_id===taskId&&acceptedSource.workspace_ref===binding.agentWorkspaceId
      &&acceptedSource.contract_version==='PA.K01_ACCEPTED_RESULT_SOURCE/0.1.0'
      &&acceptedSource.state==='accepted'&&acceptedSource.kind==='result'&&acceptedSource.source_ref==='agent-result:'+taskId
      &&acceptedSource.read_only===true
      &&acceptedSource.commercial_approval_claimed===false&&acceptedSource.result_id===result.result_id
      &&HEX.test(result.task_digest??'')&&HEX.test(acceptedSource.accepted_artifact_digest??'')
      &&typeof acceptedSource.review_id==='string'&&acceptedSource.review_id.startsWith('REV-')
      &&typeof result.result_id==='string'&&result.result_id.startsWith('RES-')
      &&typeof result.summary==='string'&&result.summary.trim()!==''&&result.summary===acceptedSource.content
      &&acceptedSource.revision==='sha256:'+sha(result.summary)&&result.performed_external_actions===false
      &&snapshot.projection_digest===result.context_projection_digest&&snapshot.bundle_digest===result.run_bundle_digest
      &&HEX.test(snapshot.projection_digest??'')&&HEX.test(snapshot.bundle_digest??'')
      &&HEX.test(snapshot.snapshot_digest??'')&&/^CSN-[A-Za-z0-9_-]+$/.test(snapshot.snapshot_id??''),
      'T3_METHOD_PERSONAL_TASK_ACCEPTED_RUN_MISMATCH');
    // Only the exact selected inputs from the prepared draft are checked.
    // Additional retrievals or changed/extra attachments cannot masquerade
    // as the same executed input basis. No claim about system/model prompts.
    check(task.objective===plan.draft.text.trim()&&Array.isArray(snapshot.source_items)
      &&Array.isArray(snapshot.retrieval_refs)&&snapshot.retrieval_refs.length===0
      &&snapshot.source_items.length>=plan.draft.attachments.length
      &&snapshot.source_items.length<=plan.draft.attachments.length+2,
      'T3_METHOD_PERSONAL_TASK_INPUT_CHANGED');
    const expected=new Map(plan.draft.attachments.map((a,i)=>[
      'attachments/'+String(i+1).padStart(2,'0')+'-'+a.name,{sha256:sha(a.text),bytes:Buffer.byteLength(a.text,'utf8'),text:a.text}]));
    // These two sources are emitted by the ORIGINAL Agent when it
    // compiles the Task. Accept only their exact native path, origin,
    // trust level and bounded digest metadata. A changed Human revision
    // guidance is additional input and is NOT the prepared root Work.
    const systemPaths=new Set(),systemSources=[];
    const initialGuidance='# Revision guidance\nInitial run: no human revision guidance.\n';
    for(const item of snapshot.source_items){
      if(item.path==='iwxa/revision-guidance.md'||item.path==='iwxa/operational-skill.md'){
        const guidance=item.path==='iwxa/revision-guidance.md';
        check(!systemPaths.has(item.path)&&item.origin===(guidance?'iwxa_revision_control':'iwxa_operational_skill')
          &&item.classification==='personal'&&item.trust_level==='system_generated'
          &&HEX.test(item.sha256??'')&&Number.isSafeInteger(item.bytes)&&item.bytes>0
          &&(!guidance||(item.sha256===sha(initialGuidance)&&item.bytes===Buffer.byteLength(initialGuidance,'utf8'))),
          'T3_METHOD_PERSONAL_TASK_INPUT_CHANGED');
        systemPaths.add(item.path);systemSources.push({path:item.path,sha256:item.sha256,bytes:item.bytes});
        continue;
      }
      const match=expected.get(item.path);
      check(match&&item.origin==='interaction_attachment'&&item.sha256===match.sha256&&item.bytes===match.bytes,
        'T3_METHOD_PERSONAL_TASK_INPUT_CHANGED');
      const actual=await guarded(()=>taskOwner.taskDocumentSource(taskId,snapshot.snapshot_id,item.path,item.sha256,binding));
      check(actual?.task_id===taskId&&actual.snapshot_id===snapshot.snapshot_id&&actual.path===item.path
        &&actual.sha256===match.sha256&&actual.text===match.text,'T3_METHOD_PERSONAL_TASK_INPUT_CHANGED');
      expected.delete(item.path);
    }
    check(expected.size===0,'T3_METHOD_PERSONAL_TASK_INPUT_CHANGED');
    systemSources.sort((a,b)=>a.path.localeCompare(b.path));
    const nativeSystemSourcesDigest=sha(canonicalStringify(systemSources));
    await current();
    const evidence=Object.freeze({agentWorkspaceId:binding.agentWorkspaceId,taskId,resultId:result.result_id,taskDigest:result.task_digest,
      reviewId:acceptedSource.review_id,acceptedDigest:acceptedSource.accepted_artifact_digest,
      acceptedSummarySha256:sha(result.summary),snapshotId:snapshot.snapshot_id,snapshotDigest:snapshot.snapshot_digest,
      projectionDigest:snapshot.projection_digest,bundleDigest:snapshot.bundle_digest,
      nativeSystemSourceCount:systemSources.length,nativeSystemSourcesDigest});
    return Object.freeze({evidence,summary:result.summary});
  };
  return Object.freeze({binding,verifyCurrent:current,read});
}
export async function inspectOriginalPersonalWorkflowTask({plan,taskId,composer,taskOwner,guarded,refreshPlan}){
  check(typeof refreshPlan==='function','T3_METHOD_PERSONAL_TASK_ORIGINAL_OWNER_REQUIRED');
  const observer=await createOriginalPersonalWorkflowTaskObserver({workspaceId:plan.workspaceId,composer,taskOwner,guarded});
  const first=await observer.read(plan,taskId),fresh=await refreshPlan();
  check(fresh.candidateDigest===plan.candidateDigest&&equal(fresh.draft,plan.draft),'T3_METHOD_PERSONAL_DRAFT_EVIDENCE_CHANGED');
  const last=await observer.read(fresh,taskId);
  check(equal(first,last),'T3_METHOD_PERSONAL_TASK_ACCEPTED_RUN_CHANGED');
  return Object.freeze({state:'ORIGINAL_ACCEPTED_TASK_DECLARED_INPUTS_MATCHED',workspaceId:plan.workspaceId,projectId:plan.projectId,
    stepId:plan.stepId,candidateDigest:plan.candidateDigest,...last.evidence,
    declaredDraftInputsVerified:true,allAssetsProven:false,exactInputBindingProven:false,
    workCompleted:false,resultReuseProven:false,executionAuthority:false,writeAuthorized:false});
}
