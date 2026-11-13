import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ComposerError,digest} from '../index.mjs';
import {prepareSavedMeetingDocuments} from '../saved-meeting-result.mjs';
import {prepareAgent05FileActions} from '../agent05-file-actions.mjs';
import {projectAgent05OwnerHistory,OWNER_HISTORY_BRIDGE_VERSION} from
  '../agent05-owner-history-view.mjs';

const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64),D='d'.repeat(64);
const text='🧪 Принятое на встрече: Мария готовит бюджет к пятнице.';
const quote='Мария готовит бюджет к пятнице.';
const start=Array.from(text.slice(0,text.indexOf(quote))).length;
const canonical=value=>Array.isArray(value)?value.map(canonical):
  value!==null&&typeof value==='object'?Object.fromEntries(
    Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const sha=text=>createHash('sha256').update(text,'utf8').digest('hex');
const err=code=>e=>e instanceof ComposerError&&e.code===code;
const pack=()=>{
  const draft={action_items:[{
    action:'Подготовить бюджет',quote,start,end:start+Array.from(quote).length,
    assignee:'Мария',due_date:'пятнице',worker_kind:'human',
    actual_work_status:'NOT_EXECUTED'
  }],open_questions:[]};
  const source={ref:'public-author-fixture',revision:'authored-1',rights:'AUTHOR_OWNED',
    transcript:text,transcriptDigest:digest(text),graphConfigDigest:C};
  const graphResult={execution_id:'PUBLIC-SYNTHETIC-1',graph_id:'meeting-followup',
    graph_digest:A,execution_digest:B,node_id:'result',
    node_run_digest:C,artifact_digest:B,attempt:1,
    text:JSON.stringify(canonical(draft)),content_type:'text/plain',
    execution_state:'COMPLETED',result_is_execution_authority:false,
    human_review_required:true,quality_evaluation:{
      contract:'PUBLIC_TEST_NOT_NATIVE_K05',status:'SOURCE_QUOTES_VERIFIED',
      source_revision:C,passed:true,source_quotes_checked:1,errors:[],
      result_accepted:false,human_review_required:true
    }};
  return prepareSavedMeetingDocuments({taskRef:'K04-HISTORY-TEST-1',
    source,graphResult});
};
const batch=mode=>prepareAgent05FileActions(pack(),{deliveryMode:mode??'full',
  baseDirectory:'Встречи'});
function plan(b,action,index=0){
  return {
    schema_version:'1.0.0',plan_contract:'PA.CONTRACT.TOOL_PLANNING@1.0.0',
    plan_id:'TPLAN-fixture-'+(index+1),plan_digest:[A,B,C,D][index],
    task_ref:{kind:'task',ref_id:b.taskRef,digest_sha256:A},
    candidate_ref:{kind:'action_candidate',ref_id:'CAND-test-'+(index+1),digest_sha256:B},
    accepted_artifact_ref:{kind:'accepted_artifact',ref_id:'ART-test',digest_sha256:C},
    tool_id:'files.write_text',tool_descriptor_digest:B,
    operation:'files.write_text',
    provider_slot:'file_workspace',provider_id:'LOCAL_FILES_V1',
    provider_binding_digest:C,effect_class:'CONSEQUENTIAL',
    effect_subclass:'WRITE',approval_requirement:'REQUIRED',
    idempotency_semantics:'STRONG_LOCAL',
    idempotency_key:'IWXA-TIDK-'+String(index+1).repeat(40),
    target:action.target,arguments:structuredClone(action.arguments)
  };
}
function receipt(p,status='SUCCEEDED',effect='ACKNOWLEDGED'){
  const contractState=effect==='UNKNOWN'?'UNKNOWN_RECONCILIATION_REQUIRED':
    status==='SUCCEEDED'?'SUCCEEDED':'FAILED_KNOWN';
  return {schema_version:'1.0.0',
    execution_contract:'PA.CONTRACT.TOOL_EXECUTION@1.0.0',
    receipt_id:'TXR-fixture-'+p.plan_id.slice(-1),
    plan_ref:{kind:'tool_execution_plan',ref_id:p.plan_id,
      digest_sha256:p.plan_digest},
    approval_ref:{kind:'approval',ref_id:'TEAPR-fixture-'+p.plan_id.slice(-1),
      digest_sha256:A},
    tool_id:p.tool_id,tool_descriptor_digest:p.tool_descriptor_digest,
    provider_slot:p.provider_slot,provider_id:p.provider_id,
    provider_binding_digest:p.provider_binding_digest,
    idempotency_key:p.idempotency_key,
    status,contract_state:contractState,external_effect_state:effect,
    started_at:'2026-11-12T12:00:00+00:00',
    finished_at:'2026-11-12T12:00:01+00:00',
    output_digest:C,response_meta:{},provider_operation_ref:null,
    receipt_digest:D};
}
const readback=action=>({
  data:{root_id:'personal',path:action.target,text:action.text,
    sha256:sha(action.text)},
  receipt:{tool_id:'files.read',status:'SUCCEEDED',receipt_digest:D,
    receipt_id:'TRR-public-test'}
});
function entry(b,index,state,options={}){
  const action=b.actions[index],p=plan(b,action,index);
  const rec=options.receipt??(state==='SUCCEEDED'?receipt(p):
    state==='ATTEMPTED'?receipt(p,'FAILED','NONE'):null);
  return {target:action.target,plan:p,
    execution:{state,receipt_id:rec?.receipt_id??null},
    receipt:rec,...(options.readback?{readback:readback(action)}:{}),
    ...(options.recovery?{recovery:options.recovery}:{})};
}
function recover(action,plan,kind='MATCHES_PROPOSAL'){
  return {authority:'READ_ONLY_OBSERVATION',case_id:'REPAIR-fixture-1',
    plan_id:plan.plan_id,path:action.target,mode:'create',
    planned_text:action.text,planned_sha256:action.contentSha256,
    previous_sha256:null,current_state:kind,
    ...(kind==='MATCHES_PROPOSAL'?{
      current_text:action.text,current_sha256:sha(action.text)}
      :{current_sha256:null}),
    outcome_proven:false,retry_authorized:false,provider_invoked_for_write:false};
}
test('empty native owner history projects a pending K04 compact/full delivery with no authority',()=>{
  for(const mode of ['compact','full']){
    const b=batch(mode),v=projectAgent05OwnerHistory(b);
    assert.equal(v.schema,OWNER_HISTORY_BRIDGE_VERSION);
    assert.equal(v.ownerHistoryEntries,0);
    assert.equal(v.progress.counts.total,b.actions.length);
    assert.equal(v.progress.counts.notStarted,b.actions.length);
    assert.equal(v.progress.overallStatus,'NOT_STARTED');
    assert.equal(v.ownerPlansAuthenticatedByK04,false);
    assert.equal(v.ownerReceiptsAuthenticatedByK04,false);
    assert.equal(v.hostCanInvokeActions,false);
    assert.equal(v.hostCanRetryActions,false);
    assert.equal(v.resultAcceptedByK04,false);
    const {viewDigest,...body}=v;
    assert.equal(viewDigest,digest(body));
  }
});
test('a real-shape historical U01 plan with no execution asks host to show current approval state',()=>{
  const b=batch('compact'),e=entry(b,0,'NOT_STARTED');
  const v=projectAgent05OwnerHistory(b,{entries:[e]});
  assert.equal(v.progress.overallStatus,'PREPARED_OWNER_APPROVAL_UNVERIFIED');
  assert.equal(v.progress.nextHostStep,'P01_INSPECT_NATIVE_PLAN_AND_APPROVAL');
  assert.equal(v.progress.counts.preparedOwnerApprovalUnknown,1);
  assert.equal(v.planReferences[0].approvalStatus,'NOT_OBSERVED_BY_K04');
  assert.equal(v.planReferences[0].planId,e.plan.plan_id);
  assert.equal(v.planReferences[0].receiptId,null);
  assert.equal(v.progress.deliveryCompletedByK04,false);
});
test('native-shaped ACK + exact readback maps to observed bytes but never a completed Task',()=>{
  const b=batch('compact'),e=entry(b,0,'SUCCEEDED',{readback:true});
  const v=projectAgent05OwnerHistory(b,{entries:[e]});
  assert.equal(v.progress.overallStatus,'HOST_REPORTED_ACK_AND_BYTES_MATCH');
  assert.equal(v.progress.counts.hostReportedMatched,1);
  assert.equal(v.planReferences[0].receiptId,e.receipt.receipt_id);
  assert.equal(v.progress.nextHostStep,'P01_VERIFY_NATIVE_RECEIPTS_AND_CORE_RESULT');
  assert.equal(v.ownerReceiptsAuthenticatedByK04,false);
  assert.equal(v.resultAcceptedByK04,false);
});
test('partial full delivery preserves lost ACK with bytes matching until owner reconciliation',()=>{
  const b=batch(),a=entry(b,0,'SUCCEEDED',{readback:true}),
    pending=entry(b,1,'NOT_STARTED'),
    unknown=entry(b,2,'OUTCOME_UNKNOWN');
  unknown.recovery=recover(b.actions[2],unknown.plan);
  const entries=[a,pending,unknown];
  const v=projectAgent05OwnerHistory(b,{entries});
  assert.equal(v.progress.counts.total,4);
  assert.equal(v.progress.counts.hostReportedMatched,1);
  assert.equal(v.progress.counts.awaitingApproval,0);
  assert.equal(v.progress.counts.preparedOwnerApprovalUnknown,1);
  assert.equal(v.progress.counts.needsReconciliation,1);
  assert.equal(v.progress.counts.notStarted,1);
  assert.equal(v.progress.overallStatus,'RECONCILIATION_REQUIRED');
  assert.equal(v.progress.files[2].readbackStatus,'MATCHES_PROPOSAL');
  assert.equal(v.progress.files[2].repairCaseId,'REPAIR-fixture-1');
  assert.equal(v.planReferences[2].recoveryCurrentState,'MATCHES_PROPOSAL');
  assert.equal(v.planReferences[2].recoveryNextHostStep,
    'P01_RECONCILE_MATCHING_BYTES_NOT_EXECUTION_PROOF');
  assert.equal(v.progress.retryAuthorizedByK04,false);
  assert.equal(v.ownerRecoveriesAuthenticatedByK04,false);
  assert.deepEqual(v,projectAgent05OwnerHistory(b,{entries:structuredClone(entries)}));
});
test('historical UNKNOWN no receipt still remains non-retryable without provider invocation',()=>{
  const b=batch('compact'),e=entry(b,0,'OUTCOME_UNKNOWN');
  const v=projectAgent05OwnerHistory(b,{entries:[e]});
  assert.equal(v.progress.overallStatus,'RECONCILIATION_REQUIRED');
  assert.equal(v.progress.files[0].readbackStatus,'NOT_OBSERVED');
  assert.equal(v.hostCanRetryActions,false);
  assert.equal(v.hostCanInvokeActions,false);
});
test('failed execution and unknown external effect never become successful delivery',()=>{
  const b=batch('compact');
  const failed=entry(b,0,'ATTEMPTED');
  assert.equal(projectAgent05OwnerHistory(b,{entries:[failed]})
    .progress.overallStatus,'FAILED_REQUIRES_REVIEW');
  const e=entry(b,0,'SUCCEEDED');
  e.receipt.external_effect_state='UNKNOWN';
  e.receipt.contract_state='UNKNOWN_RECONCILIATION_REQUIRED';
  assert.equal(projectAgent05OwnerHistory(b,{entries:[e]})
    .progress.overallStatus,'RECONCILIATION_REQUIRED');
});
test('stale or other-task plan, changed arguments or new provider are refused',()=>{
  const b=batch('compact'),base=entry(b,0,'SUCCEEDED',{readback:true});
  for(const alter of [
    x=>{x.plan.schema_version='0.12';},
    x=>{x.plan.plan_contract='WRONG';},
    x=>{x.plan.tool_descriptor_digest='invalid';},
    x=>{x.plan.task_ref.kind='other';},
    x=>{x.plan.task_ref.ref_id='OTHER-TASK';},
    x=>{x.plan.target='other.md';},
    x=>{x.plan.arguments.text+='new';},
    x=>{x.plan.arguments.mode='replace';},
    x=>{x.plan.provider_id='UNRELATED';},
    x=>{x.plan.provider_binding_digest='invalid';},
    x=>{x.plan.tool_id='files.trash';},
    x=>{x.plan.effect_subclass='DELETE';},
    x=>{x.plan.idempotency_key='UNKNOWN';},
  ]){
    const e=structuredClone(base);alter(e);
    assert.throws(()=>projectAgent05OwnerHistory(b,{entries:[e]}),
      err('AGENT05_NATIVE_PLAN_MISMATCH'));
  }
});
test('forged receipt identity, idempotency or provider binding cannot move the file to ACK',()=>{
  const b=batch('compact'),base=entry(b,0,'SUCCEEDED',{readback:true});
  for(const alter of [
    x=>{x.receipt.plan_ref.ref_id='TPLAN-another';},
    x=>{x.receipt.plan_ref.digest_sha256='0'.repeat(64);},
    x=>{x.receipt.plan_ref.kind='not_a_plan';},
    x=>{x.receipt.approval_ref.kind='not_approval';},
    x=>{x.receipt.approval_ref.digest_sha256='0';},
    x=>{x.receipt.tool_descriptor_digest='0'.repeat(64);},
    x=>{x.receipt.schema_version='0.12';},
    x=>{x.receipt.execution_contract='UNKNOWN';},
    x=>{x.receipt.idempotency_key='IWXA-TIDK-'+'f'.repeat(40);},
    x=>{x.receipt.provider_binding_digest='0'.repeat(64);},
    x=>{x.receipt.tool_id='other';},
    x=>{x.receipt.receipt_id='TXR-another';},
    x=>{x.receipt.status='COMPLETE';},
    x=>{x.receipt.external_effect_state='INFERRED';},
    x=>{x.receipt.contract_state='UNKNOWN';},
    x=>{x.receipt.output_digest='invalid';},
  ]){
    const e=structuredClone(base);alter(e);
    assert.throws(()=>projectAgent05OwnerHistory(b,{entries:[e]}),
      err('AGENT05_NATIVE_RECEIPT_MISMATCH'));
  }
});
test('bad or unverified readback cannot qualify a native ACK',()=>{
  const b=batch('compact'),base=entry(b,0,'SUCCEEDED',{readback:true});
  for(const alter of [
    x=>{x.readback.receipt.status='FAILED';},
    x=>{x.readback.receipt.tool_id='files.write_text';},
    x=>{x.readback.receipt.receipt_digest='bad';},
    x=>{x.readback.data.path='other-file';},
    x=>{x.readback.data.root_id='private';}
  ]){
    const e=structuredClone(base);alter(e);
    assert.throws(()=>projectAgent05OwnerHistory(b,{entries:[e]}),
      err('AGENT05_NATIVE_READBACK_INVALID'));
  }
  const e=structuredClone(base);
  e.readback.data.text+='tampered';
  e.readback.data.sha256=sha(e.readback.data.text);
  assert.equal(projectAgent05OwnerHistory(b,{entries:[e]}).progress.overallStatus,
    'CONTENT_CONFLICT');
});
test('owner recovery cannot grant retries, claim completed outcome or substitute another file',()=>{
  const b=batch('compact'),base=entry(b,0,'OUTCOME_UNKNOWN');
  base.recovery=recover(b.actions[0],base.plan);
  const ok=projectAgent05OwnerHistory(b,{entries:[base]});
  assert.equal(ok.progress.overallStatus,'RECONCILIATION_REQUIRED');
  const bad=[
    x=>{x.recovery.retry_authorized=true;},
    x=>{x.recovery.outcome_proven=true;},
    x=>{x.recovery.provider_invoked_for_write=true;},
    x=>{x.recovery.path='other.md';},
    x=>{x.recovery.planned_sha256='0'.repeat(64);},
    x=>{x.recovery.planned_text='other plan';},
    x=>{x.recovery.previous_sha256='0'.repeat(64);},
    x=>{x.recovery.current_sha256='0'.repeat(64);},
    x=>{x.recovery.current_state='OTHER_CONTENT';},
    x=>{x.recovery.current_state='MATCHES_PREVIOUS';},
    x=>{x.recovery.plan_id='TPLAN-other';},
    x=>{x.recovery.current_text='something else';},
    x=>{delete x.recovery.current_text;},
    x=>{x.recovery.current_state='OUTCOME_PROVEN';},
  ];
  for(const alter of bad){
    const e=structuredClone(base);alter(e);
    assert.throws(()=>projectAgent05OwnerHistory(b,{entries:[e]}),
      e=>e instanceof ComposerError&&
      ['AGENT05_NATIVE_RECOVERY_MISMATCH','AGENT05_PROGRESS_READBACK_INVALID']
        .includes(e.code));
  }
  const extra=structuredClone(base);extra.readback=readback(b.actions[0]);
  assert.throws(()=>projectAgent05OwnerHistory(b,{entries:[extra]}),
    err('AGENT05_NATIVE_DUPLICATE_READBACK'));
});
test('duplicate plans, duplicate targets, missing historical receipt and inconsistent summary fail',()=>{
  const b=batch(),first=entry(b,0,'SUCCEEDED');
  const second=entry(b,1,'NOT_STARTED');
  const duplicate=structuredClone(second);
  duplicate.plan.plan_id=first.plan.plan_id;
  assert.throws(()=>projectAgent05OwnerHistory(b,{entries:[first,duplicate]}),
    err('AGENT05_NATIVE_DUPLICATE_PLAN'));
  assert.throws(()=>projectAgent05OwnerHistory(b,{entries:[first,first]}),
    err('AGENT05_NATIVE_UNEXPECTED_TARGET'));
  const noReceipt=structuredClone(first);noReceipt.receipt=null;
  assert.throws(()=>projectAgent05OwnerHistory(b,{entries:[noReceipt]}),
    err('AGENT05_NATIVE_EXECUTION_RECEIPT_REQUIRED'));
  const wrongSummary=structuredClone(first);
  wrongSummary.execution.receipt_id='TXR-another';
  assert.throws(()=>projectAgent05OwnerHistory(b,{entries:[wrongSummary]}),
    err('AGENT05_NATIVE_RECEIPT_MISMATCH'));
  const wrongRead=structuredClone(first);
  wrongRead.execution.state='NOT_STARTED';
  assert.throws(()=>projectAgent05OwnerHistory(b,{entries:[wrongRead]}),
    err('AGENT05_NATIVE_EXECUTION_RECEIPT_REQUIRED'));
});

test('native read-only recovery gives distinct owner guidance without granting retry',()=>{
  const b=batch('compact'),action=b.actions[0],base=entry(b,0,'OUTCOME_UNKNOWN');
  const cases=[
    ['NOT_FOUND','P01_RECONCILE_MISSING_FILE_NO_AUTO_RETRY'],
    ['WORKSPACE_CHANGED','P01_INSPECT_CHANGED_WORKSPACE_BINDING'],
    ['WORKSPACE_UNAVAILABLE','P01_RECONNECT_WORKSPACE_AND_REOBSERVE'],
    ['UNAVAILABLE','P01_RETRY_READ_ONLY_OBSERVATION'],
    ['MATCHES_PROPOSAL','P01_RECONCILE_MATCHING_BYTES_NOT_EXECUTION_PROOF']
  ];
  for(const [kind,expected] of cases){
    const row=structuredClone(base);
    row.recovery=recover(action,row.plan,kind);
    const v=projectAgent05OwnerHistory(b,{entries:[row]});
    assert.equal(v.progress.overallStatus,'RECONCILIATION_REQUIRED',kind);
    assert.equal(v.planReferences[0].recoveryCurrentState,kind);
    assert.equal(v.planReferences[0].recoveryNextHostStep,expected);
    assert.equal(v.hostCanRetryActions,false);
    assert.equal(v.ownerRecoveriesAuthenticatedByK04,false);
  }
  const other=structuredClone(base);
  other.recovery=recover(action,other.plan,'OTHER_CONTENT');
  other.recovery.current_text='different file bytes';
  other.recovery.current_sha256=sha(other.recovery.current_text);
  const v=projectAgent05OwnerHistory(b,{entries:[other]});
  assert.equal(v.progress.overallStatus,'RECONCILIATION_REQUIRED');
  assert.equal(v.progress.files[0].readbackStatus,'OTHER_CONTENT');
  assert.equal(v.planReferences[0].recoveryNextHostStep,
    'P01_STOP_AND_INSPECT_DIFFERENT_FILE');
});
test('a non-successful native receipt cannot claim an acknowledged external write',()=>{
  const b=batch('compact');
  const row=entry(b,0,'ATTEMPTED');
  row.receipt.external_effect_state='ACKNOWLEDGED';
  assert.throws(()=>projectAgent05OwnerHistory(b,{entries:[row]}),
    err('AGENT05_NATIVE_RECEIPT_MISMATCH'));
});
test('all existing public non-owner delivery states remain unchanged',()=>{
  const b=batch('compact');
  const initial=projectAgent05OwnerHistory(b);
  assert.equal(initial.progress.overallStatus,'NOT_STARTED');
  assert.equal(initial.progress.counts.notStarted,1);
  assert.equal('preparedOwnerApprovalUnknown' in initial.progress.counts,false);
});

test('reject legacy 0.12 flat receipt even when IDs appear to match the plan',()=>{
  const b=batch('compact'),e=entry(b,0,'SUCCEEDED',{readback:true});
  const legacy=structuredClone(e.receipt);
  legacy.schema_version='0.12';
  delete legacy.plan_ref;
  delete legacy.approval_ref;
  legacy.plan_id=e.plan.plan_id;
  legacy.plan_digest=e.plan.plan_digest;
  e.receipt=legacy;
  assert.throws(()=>projectAgent05OwnerHistory(b,{entries:[e]}),
    err('AGENT05_NATIVE_RECEIPT_MISMATCH'));
});
test('native v1 receipt remains tied to original plan across a new prepared attempt',()=>{
  const b=batch(),one=entry(b,0,'SUCCEEDED');
  const two=entry(b,1,'SUCCEEDED');
  two.receipt.plan_ref=structuredClone(one.receipt.plan_ref);
  assert.throws(()=>projectAgent05OwnerHistory(b,{entries:[two]}),
    err('AGENT05_NATIVE_RECEIPT_MISMATCH'));
});
test('an actual-shaped v1 failure with unknown effect remains reconciliation-only',()=>{
  const b=batch('compact'),e=entry(b,0,'ATTEMPTED');
  e.receipt.status='FAILED';
  e.receipt.external_effect_state='UNKNOWN';
  e.receipt.contract_state='UNKNOWN_RECONCILIATION_REQUIRED';
  const view=projectAgent05OwnerHistory(b,{entries:[e]});
  assert.equal(view.progress.overallStatus,'RECONCILIATION_REQUIRED');
  assert.equal(view.hostCanRetryActions,false);
});
