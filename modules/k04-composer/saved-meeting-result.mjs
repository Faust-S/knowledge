import {ComposerError,digest,checkMeetingEvidence} from './index.mjs';
import {reconcileMeetingDecisions,renderMeetingDraftPackage} from './meeting-process.mjs';

export const SAVED_MEETING_PACKAGE_VERSION='IWXA.K04.MEETING_GRAPH_DOCUMENTS/0.1.0';
const hex64=/^[a-f0-9]{64}$/;
const own=(obj,k)=>Object.prototype.hasOwnProperty.call(obj,k);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&x.trim().length>0;
const error=code=>{throw new ComposerError(code);};
const validString=x=>typeof x==='string'&&
  (typeof x.isWellFormed!=='function'||x.isWellFormed());
const keys=(obj,fields)=>object(obj)&&Object.keys(obj).length===fields.length&&
  fields.every(f=>own(obj,f));
const itemFields=['action','quote','start','end','assignee','due_date','worker_kind','actual_work_status'];

function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(object(value))return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
function sourceCheck(source){
  if(!object(source)||!text(source.ref)||!text(source.revision)||!text(source.rights)||
     !validString(source.ref)||!validString(source.revision)||!validString(source.rights)||
     !text(source.transcript)||!validString(source.transcript)||
     Buffer.byteLength(source.transcript,'utf8')>1_000_000||
     !hex64.test(source.transcriptDigest??'')||
     digest(source.transcript)!==source.transcriptDigest||
     !hex64.test(source.graphConfigDigest??''))
    error('SAVED_MEETING_SOURCE_INVALID');
  for(const name of ['ref','revision','rights']){
    if(source[name].length>512||/[\r\n]/u.test(source[name]))error('SAVED_MEETING_SOURCE_INVALID');
  }
}
function graphCheck(graph,source){
  if(!object(graph)||graph.execution_state!=='COMPLETED'||graph.node_id!=='result'||
    graph.content_type!=='text/plain'||graph.human_review_required!==true||
    graph.result_is_execution_authority!==false||
    !text(graph.execution_id)||!text(graph.graph_id)||
    !hex64.test(graph.graph_digest??'')||
    !hex64.test(graph.execution_digest??'')||
    !hex64.test(graph.artifact_digest??'')||
    !hex64.test(graph.node_run_digest??'')||
    !Number.isSafeInteger(graph.attempt)||graph.attempt<1||
    typeof graph.text!=='string'||!validString(graph.text)||
    Buffer.byteLength(graph.text,'utf8')>65536||
    graph.truncated===true)error('SAVED_GRAPH_RESULT_INVALID');
  const quality=graph.quality_evaluation;
  if(!object(quality)||quality.status!=='SOURCE_QUOTES_VERIFIED'||
    quality.passed!==true||quality.result_accepted!==false||
    quality.human_review_required!==true||
    quality.source_revision!==source.graphConfigDigest||
    !Number.isSafeInteger(quality.source_quotes_checked)||
    quality.source_quotes_checked<0||
    !Array.isArray(quality.errors)||quality.errors.length>0)
    error('SAVED_GRAPH_EVIDENCE_NOT_VERIFIED');
}
function parseSavedDraft(raw){
  let draft;
  try{draft=JSON.parse(raw);}catch{error('SAVED_GRAPH_DRAFT_NOT_JSON');}
  if(!keys(draft,['action_items','open_questions'])||
     !Array.isArray(draft.action_items)||draft.action_items.length>100||
     !Array.isArray(draft.open_questions)||draft.open_questions.length>100||
     (!draft.action_items.length&&!draft.open_questions.length))
    error('SAVED_GRAPH_DRAFT_INVALID');
  // P01's native Graph normalize step emits canonical UTF-8 JSON, without
  // duplicate keys. A noncanonical payload is NOT treated as its verified output.
  if(JSON.stringify(canonical(draft))!==raw)
    error('SAVED_GRAPH_DRAFT_NOT_CANONICAL');
  for(const item of draft.action_items){
    if(!keys(item,itemFields)||!['human','unassigned'].includes(item.worker_kind)||
      item.worker_kind!==(item.assignee==='UNKNOWN'?'unassigned':'human')||
      item.actual_work_status!=='NOT_EXECUTED'||
      !Number.isSafeInteger(item.start)||!Number.isSafeInteger(item.end)||
      item.start<0||item.end<=item.start||
      ['action','quote','assignee','due_date'].some(k=>
        !text(item[k])||!validString(item[k])||item[k].length>8192))
      error('SAVED_GRAPH_DRAFT_INVALID');
  }
  if(draft.open_questions.some(q=>!text(q)||!validString(q)||q.length>8192))
    error('SAVED_GRAPH_DRAFT_INVALID');
  return draft;
}
/** Consume ONLY a host-supplied, already persisted native graph_final_result.
 * Never invokes a model, reopens Graph, creates Task or supplies authority.
 * The P01 host must retrieve/verify the exact source Graph config itself.
 */
export function prepareSavedMeetingDocuments({taskRef,source,graphResult}){
  if(!text(taskRef)||taskRef.length>160||/[\r\n]/u.test(taskRef))
    error('SAVED_MEETING_TASK_INVALID');
  sourceCheck(source);
  graphCheck(graphResult,source);
  const draft=parseSavedDraft(graphResult.text);
  if(graphResult.quality_evaluation.source_quotes_checked!==draft.action_items.length)
    error('SAVED_GRAPH_EVIDENCE_NOT_VERIFIED');
  const evidence=checkMeetingEvidence(source.transcript,draft);
  if(!evidence.passed)error('SAVED_GRAPH_SOURCE_MISMATCH');
  const reconciliation=reconcileMeetingDecisions(source.transcript,draft);
  if(!reconciliation.evidencePassed)error('SAVED_GRAPH_SOURCE_MISMATCH');
  const unresolved=draft.action_items.some(x=>x.assignee==='UNKNOWN'||x.due_date==='UNKNOWN');
  const status=reconciliation.conflicts.length||reconciliation.duplicates.length
    ?'CONFLICT_REVIEW_REQUIRED':!draft.action_items.length?'NEEDS_INPUT':
     unresolved?'CLARIFICATION_REQUIRED':'DRAFT_READY_FOR_HUMAN_REVIEW';
  const origin='graph:'+graphResult.execution_id+':'+graphResult.artifact_digest;
  const rendered=renderMeetingDraftPackage({
    taskRef,provenance:{sourceRef:source.ref,revision:source.revision,
      rights:source.rights,transcriptDigest:source.transcriptDigest},
    draft,reconciliation,status,evidenceLabel:origin});
  const body={
    schema:SAVED_MEETING_PACKAGE_VERSION,
    taskRef,processDigest:rendered.processDigest,
    source:{ref:source.ref,revision:source.revision,rights:source.rights,
      transcriptDigest:source.transcriptDigest,graphConfigDigest:source.graphConfigDigest},
    graph:{executionId:graphResult.execution_id,graphId:graphResult.graph_id,
      graphDigest:graphResult.graph_digest,executionDigest:graphResult.execution_digest,
      artifactDigest:graphResult.artifact_digest,nodeRunDigest:graphResult.node_run_digest,
      attempt:graphResult.attempt,readbackStatus:'HOST_REVALIDATION_REQUIRED'},
    status,documents:rendered.documents,documentDigests:rendered.documentDigests,
    quotesIndependentlyChecked:draft.action_items.length,
    sourceSemanticReview:'HUMAN_REQUIRED',
    hostResultAuthVerifiedByK04:false,
    humanReview:'PENDING',assignmentsExecuted:false,
    taskReport:'NOT_SUBMITTED',goalDecision:'NOT_DECIDED',
    modelInvocationsByK04:0,graphExecutionsByK04:0,externalMessagesSent:0,
  };
  return {...body,packageDigest:digest(body)};
}
export function verifySavedMeetingDocuments(pack){
  if(!object(pack)||pack.schema!==SAVED_MEETING_PACKAGE_VERSION||
    !hex64.test(pack.packageDigest??''))error('SAVED_MEETING_PACKAGE_INVALID');
  const {packageDigest,...body}=pack;
  if(digest(body)!==packageDigest||
     pack.hostResultAuthVerifiedByK04!==false||
     pack.humanReview!=='PENDING'||pack.assignmentsExecuted!==false||
     pack.graph?.readbackStatus!=='HOST_REVALIDATION_REQUIRED')
    error('SAVED_MEETING_PACKAGE_CHANGED');
  return true;
}
