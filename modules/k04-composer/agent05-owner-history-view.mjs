import {createHash} from 'node:crypto';
import {ComposerError,digest} from './index.mjs';
import {verifyAgent05FileActionBatch} from './agent05-file-actions.mjs';
import {projectAgent05DeliveryProgress} from './agent05-delivery-progress.mjs';

export const OWNER_HISTORY_BRIDGE_VERSION='IWXA.K04.AGENT05_OWNER_HISTORY_VIEW/0.1.0';
const HEX=/^[a-f0-9]{64}$/;
const TPLAN=/^TPLAN-[A-Za-z0-9_-]{1,100}$/;
const TXR=/^TXR-[A-Za-z0-9_-]{1,100}$/;
const REPAIR=/^REPAIR-[A-Za-z0-9_-]{1,100}$/;
const TIDK=/^IWXA-TIDK-[a-f0-9]{40}$/;
const STATES=new Set(['NOT_STARTED','OUTCOME_UNKNOWN','SUCCEEDED','ATTEMPTED']);
const EFFECTS=new Set(['NONE','UNKNOWN','ACKNOWLEDGED']);
const FILE_STATES=new Set(['UNAVAILABLE','WORKSPACE_CHANGED','WORKSPACE_UNAVAILABLE',
  'MATCHES_PROPOSAL','MATCHES_PREVIOUS','OTHER_CONTENT','NOT_FOUND']);
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fail=code=>{throw new ComposerError(code);};
const eq=(a,b)=>digest(a)===digest(b);
const byteSha=text=>createHash('sha256').update(text,'utf8').digest('hex');
const RECOVERY_NEXT_STEP=Object.freeze({
  MATCHES_PROPOSAL:'P01_RECONCILE_MATCHING_BYTES_NOT_EXECUTION_PROOF',
  OTHER_CONTENT:'P01_STOP_AND_INSPECT_DIFFERENT_FILE',
  NOT_FOUND:'P01_RECONCILE_MISSING_FILE_NO_AUTO_RETRY',
  WORKSPACE_CHANGED:'P01_INSPECT_CHANGED_WORKSPACE_BINDING',
  WORKSPACE_UNAVAILABLE:'P01_RECONNECT_WORKSPACE_AND_REOBSERVE',
  UNAVAILABLE:'P01_RETRY_READ_ONLY_OBSERVATION'
});
const fields=(row,allowed,code)=>{
  if(!obj(row)||Object.keys(row).some(k=>!allowed.includes(k)))fail(code);
};
function checkPlan(batch,action,plan){
  if(!obj(plan)||!TPLAN.test(plan.plan_id??'')||
    !HEX.test(plan.plan_digest??'')||
    !HEX.test(plan.provider_binding_digest??'')||
    !TIDK.test(plan.idempotency_key??'')||
    plan.schema_version!=='1.0.0'||
    plan.plan_contract!=='PA.CONTRACT.TOOL_PLANNING@1.0.0'||
    !HEX.test(plan.tool_descriptor_digest??'')||
    plan.task_ref?.kind!=='task'||
    !HEX.test(plan.task_ref?.digest_sha256??'')||
    plan.task_ref?.ref_id!==batch.taskRef||
    plan.tool_id!=='files.write_text'||plan.operation!=='files.write_text'||
    plan.provider_slot!=='file_workspace'||plan.provider_id!=='LOCAL_FILES_V1'||
    plan.effect_class!=='CONSEQUENTIAL'||plan.effect_subclass!=='WRITE'||
    plan.approval_requirement!=='REQUIRED'||
    plan.idempotency_semantics!=='STRONG_LOCAL'||
    plan.target!==action.target||
    !obj(plan.arguments)||!eq(plan.arguments,action.arguments))
    fail('AGENT05_NATIVE_PLAN_MISMATCH');
}
function checkReceipt(plan,receipt,execution){
  // P01 ToolRuntime execution-receipt-v1 is bound by typed plan_ref.
  // The old 0.12 plan_id/plan_digest fields do not exist in native 1.0.0.
  const planRef=receipt?.plan_ref,approvalRef=receipt?.approval_ref;
  if(!obj(receipt)||receipt.schema_version!=='1.0.0'||
    receipt.execution_contract!=='PA.CONTRACT.TOOL_EXECUTION@1.0.0'||
    !TXR.test(receipt.receipt_id??'')||
    receipt.receipt_id!==execution.receipt_id||
    !obj(planRef)||planRef.kind!=='tool_execution_plan'||
    planRef.ref_id!==plan.plan_id||
    planRef.digest_sha256!==plan.plan_digest||
    !obj(approvalRef)||approvalRef.kind!=='approval'||
    !/^TEAPR-[A-Za-z0-9_-]{1,100}$/.test(approvalRef.ref_id??'')||
    !HEX.test(approvalRef.digest_sha256??'')||
    receipt.tool_id!==plan.tool_id||
    receipt.tool_descriptor_digest!==plan.tool_descriptor_digest||
    receipt.provider_slot!==plan.provider_slot||
    receipt.provider_id!==plan.provider_id||
    receipt.provider_binding_digest!==plan.provider_binding_digest||
    receipt.idempotency_key!==plan.idempotency_key||
    !HEX.test(receipt.output_digest??'')||
    !HEX.test(receipt.receipt_digest??'')||
    !obj(receipt.response_meta)||
    !['SUCCEEDED','FAILED','INPUT_REQUIRED'].includes(receipt.status)||
    !EFFECTS.has(receipt.external_effect_state)||
    !['SUCCEEDED','FAILED_KNOWN','UNKNOWN_RECONCILIATION_REQUIRED']
      .includes(receipt.contract_state)||
    (receipt.external_effect_state==='UNKNOWN'&&
      receipt.contract_state!=='UNKNOWN_RECONCILIATION_REQUIRED')||
    (receipt.external_effect_state==='NONE'&&
      receipt.contract_state==='UNKNOWN_RECONCILIATION_REQUIRED')||
    (receipt.status!=='SUCCEEDED'&&
      receipt.external_effect_state==='ACKNOWLEDGED')||
    (receipt.status==='FAILED'&&receipt.contract_state==='SUCCEEDED')||
    (receipt.status==='SUCCEEDED'&&
      receipt.contract_state==='FAILED_KNOWN'))
    fail('AGENT05_NATIVE_RECEIPT_MISMATCH');
}
function checkReadback(action,plan,readback){
  fields(readback,['data','receipt'],'AGENT05_NATIVE_READBACK_INVALID');
  const data=readback.data,receipt=readback.receipt;
  // The read-side ToolRuntime is still on tool-read-receipt/0.12 even
  // though consequential execution receipts use execution-receipt-v1.
  // P01 owns native receipt authentication; this is a pure shape and
  // source/argument/provider cross-check, never a new receipt authority.
  const readArguments={root_id:'personal',path:action.target};
  if(!obj(data)||!obj(receipt)||
     receipt.schema_version!=='0.12'||
     !/^TRR-[A-Za-z0-9_-]{1,100}$/.test(receipt.receipt_id??'')||
     receipt.tool_id!=='files.read'||receipt.status!=='SUCCEEDED'||
     receipt.provider_slot!==plan.provider_slot||
     receipt.provider_id!==plan.provider_id||
     receipt.provider_binding_digest!==plan.provider_binding_digest||
     !HEX.test(receipt.tool_descriptor_digest??'')||
     receipt.arguments_digest!==digest(readArguments)||
     receipt.output_digest!==digest(data)||
     !HEX.test(receipt.receipt_digest??'')||
     !obj(receipt.response_meta)||
     typeof receipt.started_at!=='string'||
     typeof receipt.finished_at!=='string'||
     data.root_id!=='personal'||data.path!==action.target||
     typeof data.text!=='string'||
     typeof data.bytes!=='number'||!Number.isSafeInteger(data.bytes)||
     data.bytes!==Buffer.byteLength(data.text,'utf8')||
     !HEX.test(data.sha256??'')||
     byteSha(data.text)!==data.sha256)
    fail('AGENT05_NATIVE_READBACK_INVALID');
  return {root_id:data.root_id,path:data.path,text:data.text,sha256:data.sha256};
}
function checkRecovery(action,plan,recovery){
  if(!obj(recovery)||!REPAIR.test(recovery.case_id??'')||
    recovery.authority!=='READ_ONLY_OBSERVATION'||
    recovery.plan_id!==plan.plan_id||
    recovery.path!==action.target||recovery.mode!=='create'||
    recovery.planned_text!==action.text||
    recovery.planned_sha256!==action.contentSha256||
    recovery.previous_sha256!==null||
    !FILE_STATES.has(recovery.current_state)||
    recovery.current_state==='MATCHES_PREVIOUS'||
    recovery.outcome_proven!==false||
    recovery.retry_authorized!==false||
    recovery.provider_invoked_for_write!==false)
    fail('AGENT05_NATIVE_RECOVERY_MISMATCH');
  const hasText=typeof recovery.current_text==='string';
  const readable=['MATCHES_PROPOSAL','OTHER_CONTENT']
    .includes(recovery.current_state);
  if(hasText!==readable||
    (hasText&&(!HEX.test(recovery.current_sha256??'')||
      byteSha(recovery.current_text)!==recovery.current_sha256))||
    (!hasText&&(recovery.current_text!==undefined||
      recovery.current_sha256!==null)))
    fail('AGENT05_NATIVE_RECOVERY_MISMATCH');
  const matching=hasText&&recovery.current_sha256===action.contentSha256&&
    recovery.current_text===action.text;
  if(recovery.current_state==='MATCHES_PROPOSAL'&&!matching||
    recovery.current_state==='OTHER_CONTENT'&&matching)
    fail('AGENT05_NATIVE_RECOVERY_MISMATCH');
  // A matching file is merely a read-only observation. It is never a
  // native receipt, execution proof or authorization to retry the write.
  return hasText?{root_id:'personal',path:action.target,
    text:recovery.current_text,sha256:recovery.current_sha256}:null;
}

/** Convert read-only, P01-supplied native ToolRuntime history into K04 UI
 * observations. Each entry references one already-selected historical plan.
 * P01 must independently authenticate every plan, receipt, source, approval,
 * permission and recovery case. This function cannot grant any authority.
 */
export function projectAgent05OwnerHistory(batch,{entries=[]}={}){
  verifyAgent05FileActionBatch(batch);
  if(!Array.isArray(entries)||entries.length>batch.actions.length)
    fail('AGENT05_NATIVE_ENTRIES_INVALID');
  const targets=new Set();
  const planIds=new Set();
  const observations=[];
  const provenance=[];
  for(const entry of entries){
    fields(entry,['target','plan','execution','receipt','readback','recovery'],
      'AGENT05_NATIVE_ENTRY_INVALID');
    const action=batch.actions.find(a=>a.target===entry.target);
    if(!action||targets.has(entry.target))fail('AGENT05_NATIVE_UNEXPECTED_TARGET');
    targets.add(entry.target);
    const plan=entry.plan,execution=entry.execution;
    checkPlan(batch,action,plan);
    if(planIds.has(plan.plan_id))fail('AGENT05_NATIVE_DUPLICATE_PLAN');
    planIds.add(plan.plan_id);
    if(!obj(execution)||!STATES.has(execution.state)||
      !Object.hasOwn(execution,'receipt_id')||
      (execution.receipt_id!==null&&!TXR.test(execution.receipt_id??'')))
      fail('AGENT05_NATIVE_EXECUTION_STATE_INVALID');
    const hasReceipt=entry.receipt!==null&&entry.receipt!==undefined;
    if(hasReceipt)checkReceipt(plan,entry.receipt,execution);
    if(hasReceipt&&(
      execution.state==='SUCCEEDED'&&entry.receipt.status!=='SUCCEEDED'||
      execution.state==='ATTEMPTED'&&entry.receipt.status==='SUCCEEDED'))
      fail('AGENT05_NATIVE_EXECUTION_STATE_INVALID');
    if(['SUCCEEDED','ATTEMPTED'].includes(execution.state)&&!hasReceipt||
      execution.state==='NOT_STARTED'&&(hasReceipt||execution.receipt_id!==null)||
      !hasReceipt&&execution.receipt_id!==null)
      fail('AGENT05_NATIVE_EXECUTION_RECEIPT_REQUIRED');
    let writeState;
    switch(execution.state){
      case 'NOT_STARTED':writeState='OWNER_PLAN_PREPARED';break;
      case 'OUTCOME_UNKNOWN':writeState='UNKNOWN';break;
      case 'SUCCEEDED':
        writeState=hasReceipt&&entry.receipt.status==='SUCCEEDED'&&
          entry.receipt.external_effect_state==='ACKNOWLEDGED'
          ?'ACKNOWLEDGED':'UNKNOWN';break;
      case 'ATTEMPTED':
        writeState=hasReceipt&&entry.receipt.external_effect_state==='UNKNOWN'
          ?'UNKNOWN':'FAILED';break;
      default:fail('AGENT05_NATIVE_EXECUTION_STATE_INVALID');
    }
    const hasRecovery=entry.recovery!==null&&entry.recovery!==undefined;
    if(hasRecovery&&writeState!=='UNKNOWN')
      fail('AGENT05_NATIVE_RECOVERY_OUT_OF_CONTEXT');
    if(hasRecovery&&entry.readback!==undefined&&entry.readback!==null)
      fail('AGENT05_NATIVE_DUPLICATE_READBACK');
    let readback=null,repairCaseId=null;
    if(hasRecovery){
      readback=checkRecovery(action,plan,entry.recovery);
      repairCaseId=entry.recovery.case_id;
    }else if(entry.readback!==undefined&&entry.readback!==null){
      readback=checkReadback(action,plan,entry.readback);
    }
    observations.push({target:action.target,writeState,
      ...(readback?{readback}:{}),
      ...(repairCaseId?{repairCaseId}:{})});
    provenance.push({target:action.target,planId:plan.plan_id,
      receiptId:hasReceipt?entry.receipt.receipt_id:null,
      repairCaseId,executionState:execution.state,
      approvalStatus:'NOT_OBSERVED_BY_K04',
      recoveryCurrentState:hasRecovery?entry.recovery.current_state:null,
      recoveryNextHostStep:hasRecovery
        ?RECOVERY_NEXT_STEP[entry.recovery.current_state]:null,
      hostNativePlanDigestReported:plan.plan_digest});
  }
  const progress=projectAgent05DeliveryProgress(batch,{observations});
  const body={schema:OWNER_HISTORY_BRIDGE_VERSION,
    batchDigest:batch.batchDigest,taskRef:batch.taskRef,
    progress,planReferences:provenance,
    ownerHistoryEntries:entries.length,
    ownerPlansAuthenticatedByK04:false,
    ownerReceiptsAuthenticatedByK04:false,
    ownerRecoveriesAuthenticatedByK04:false,
    hostCanInvokeActions:false,hostCanRetryActions:false,
    resultAcceptedByK04:false,
    evidenceMeaning:'HOST_SUPPLIED_OWNER_HISTORY_UNTRUSTED_UNTIL_P01_READBACK'};
  return {...body,viewDigest:digest(body)};
}
