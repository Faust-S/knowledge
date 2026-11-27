// W05.10. A thin consumer of the ORIGINAL local Agent SessionRuntime
// composer_draft read/compare-and-save operation. No Task creation, Store,
// queue, additional native owner, local model invocation, or transport.
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
