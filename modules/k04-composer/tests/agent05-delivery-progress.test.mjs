import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {digest,ComposerError} from '../index.mjs';
import {prepareSavedMeetingDocuments} from '../saved-meeting-result.mjs';
import {prepareAgent05FileActions} from '../agent05-file-actions.mjs';
import {projectAgent05DeliveryProgress,DELIVERY_PROGRESS_VERSION} from
  '../agent05-delivery-progress.mjs';

const transcript='🧪 Рабочая встреча: Мария подготовит бюджет к пятнице.';
const quote='Мария подготовит бюджет к пятнице.';
const start=Array.from(transcript.slice(0,transcript.indexOf(quote))).length;
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
const canonical=v=>Array.isArray(v)?v.map(canonical):
  v!==null&&typeof v==='object'?Object.fromEntries(
    Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const draft={action_items:[{
  action:'Подготовить бюджет',quote,start,end:start+Array.from(quote).length,
  assignee:'Мария',due_date:'пятнице',worker_kind:'human',
  actual_work_status:'NOT_EXECUTED'
}],open_questions:[]};
const pack=()=>{
  const source={ref:'open-author-fixture',revision:'meeting-v1',
    rights:'AUTHOR_OWNED',transcript,transcriptDigest:digest(transcript),
    graphConfigDigest:C};
  const graphResult={execution_id:'SYNTHETIC-EXEC-55',graph_id:'meeting-followup',
    graph_digest:A,execution_digest:B,node_id:'result',
    node_run_digest:C,artifact_digest:B,attempt:1,
    text:JSON.stringify(canonical(draft)),content_type:'text/plain',
    execution_state:'COMPLETED',result_is_execution_authority:false,
    human_review_required:true,
    quality_evaluation:{
      contract:'PUBLIC_SYNTHETIC_NOT_NATIVE_P01',
      status:'SOURCE_QUOTES_VERIFIED',passed:true,source_revision:C,
      source_quotes_checked:1,errors:[],result_accepted:false,
      human_review_required:true
    }};
  return prepareSavedMeetingDocuments({taskRef:'MEET-PROGRESS-01',
    source,graphResult});
};
const batch=(deliveryMode='full')=>
  prepareAgent05FileActions(pack(),{baseDirectory:'Встречи',deliveryMode});
const rawSha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const match=a=>({root_id:'personal',path:a.target,text:a.text,sha256:rawSha(a.text)});
const error=code=>e=>e instanceof ComposerError&&e.code===code;

test('zero I/O: initially one/four files await P01 without presenting fake completed results',()=>{
  for(const mode of ['compact','full']){
    const b=batch(mode),p=projectAgent05DeliveryProgress(b);
    assert.equal(p.schema,DELIVERY_PROGRESS_VERSION);
    assert.equal(p.counts.total,mode==='compact'?1:4);
    assert.equal(p.counts.notStarted,p.counts.total);
    assert.equal(p.counts.hostReportedMatched,0);
    assert.equal(p.overallStatus,'NOT_STARTED');
    assert.equal(p.nextHostStep,'P01_PREPARE_ACCEPTED_ACTION_CANDIDATE');
    assert.equal(p.retryAuthorizedByK04,false);
    assert.equal(p.deliveryCompletedByK04,false);
    assert.equal(p.hostAuthorityGranted,false);
    assert.equal(p.nativeWriteReceiptsVerifiedByK04,false);
    assert.equal(p.nativeReadReceiptsVerifiedByK04,false);
    assert.equal(p.goalDecision,'NOT_DECIDED');
    const {progressDigest,...unsigned}=p;
    assert.equal(progressDigest,digest(unsigned));
  }
});
test('four-file partial progress never treats matching bytes under UNKNOWN as permission to retry',()=>{
  const b=batch(),[first,second,third]=b.actions;
  const rows=[
    {target:first.target,writeState:'ACKNOWLEDGED',readback:match(first)},
    {target:second.target,writeState:'AWAITING_APPROVAL'},
    {target:third.target,writeState:'UNKNOWN',readback:match(third),
      repairCaseId:'REPAIR-original-case-1'},
  ];
  const p=projectAgent05DeliveryProgress(b,{observations:rows});
  assert.equal(p.counts.total,4);
  assert.equal(p.counts.hostReportedMatched,1);
  assert.equal(p.counts.awaitingApproval,1);
  assert.equal(p.counts.needsReconciliation,1);
  assert.equal(p.counts.notStarted,1);
  assert.equal(p.overallStatus,'RECONCILIATION_REQUIRED');
  assert.equal(p.nextHostStep,'P01_RECOVER_INTERRUPTED_ACTION_AND_RECONCILE');
  assert.equal(p.files[2].readbackStatus,'MATCHES_PROPOSAL');
  assert.equal(p.files[2].status,'RECONCILIATION_REQUIRED');
  assert.equal(p.files[2].repairCaseId,'REPAIR-original-case-1');
  assert.equal(p.files[0].status,'HOST_REPORTED_ACK_AND_BYTES_MATCH');
  assert.equal(p.deliveryCompletedByK04,false);
  assert.equal(p.retryAuthorizedByK04,false);
  assert.deepEqual(projectAgent05DeliveryProgress(b,{observations:structuredClone(rows)}),p,
    'restart can recompute the same UI projection without a K04 Store');
});
test('all four host-reported ACK+matching bytes require P01 native receipts and Result check',()=>{
  const b=batch(),rows=b.actions.map(a=>({
    target:a.target,writeState:'ACKNOWLEDGED',readback:match(a)
  }));
  const p=projectAgent05DeliveryProgress(b,{observations:rows});
  assert.equal(p.counts.hostReportedMatched,4);
  assert.equal(p.counts.notStarted,0);
  assert.equal(p.overallStatus,'HOST_REPORTED_ACK_AND_BYTES_MATCH');
  assert.equal(p.nextHostStep,'P01_VERIFY_NATIVE_RECEIPTS_AND_CORE_RESULT');
  assert.equal(p.nativeWriteReceiptsVerifiedByK04,false);
  assert.equal(p.nativeReadReceiptsVerifiedByK04,false);
  assert.equal(p.deliveryCompletedByK04,false);
});
test('compact single-file mode shows useful human-visible approval and readback states',()=>{
  const b=batch('compact'),a=b.actions[0];
  const waiting=projectAgent05DeliveryProgress(b,{observations:[
    {target:a.target,writeState:'AWAITING_APPROVAL'}]});
  assert.equal(waiting.deliveryMode,'compact');
  assert.equal(waiting.counts.total,1);
  assert.equal(waiting.counts.awaitingApproval,1);
  assert.equal(waiting.overallStatus,'AWAITING_USER_APPROVAL');
  const ack=projectAgent05DeliveryProgress(b,{observations:[
    {target:a.target,writeState:'ACKNOWLEDGED'}]});
  assert.equal(ack.overallStatus,'READBACK_REQUIRED');
  assert.equal(ack.nextHostStep,'P01_FILES_READ_AND_COMPARE_BYTES');
  const verified=projectAgent05DeliveryProgress(b,{observations:[
    {target:a.target,writeState:'ACKNOWLEDGED',readback:match(a)}]});
  assert.equal(verified.counts.hostReportedMatched,1);
  assert.equal(verified.deliveryCompletedByK04,false);
  assert.equal(verified.nextHostStep,'P01_VERIFY_NATIVE_RECEIPTS_AND_CORE_RESULT');
});
test('matching pre-existing bytes cannot be attributed to the proposed new write',()=>{
  const b=batch('compact'),a=b.actions[0];
  for(const writeState of ['NOT_STARTED','AWAITING_APPROVAL']){
    const p=projectAgent05DeliveryProgress(b,{observations:[
      {target:a.target,writeState,readback:match(a)}]});
    assert.equal(p.overallStatus,'PREEXISTING_FILE_NEEDS_HOST_REVIEW');
    assert.equal(p.counts.hostReportedMatched,0);
    assert.equal(p.retryAuthorizedByK04,false);
  }
});
test('different file bytes stop delivery; unknown write still requires native reconciliation',()=>{
  const b=batch('compact'),a=b.actions[0];
  const altered=a.text+' changed';
  const p=projectAgent05DeliveryProgress(b,{observations:[{
    target:a.target,writeState:'ACKNOWLEDGED',
    readback:{...match(a),text:altered,sha256:rawSha(altered)}
  }]});
  assert.equal(p.overallStatus,'CONTENT_CONFLICT');
  assert.equal(p.files[0].readbackStatus,'OTHER_CONTENT');
  assert.equal(p.files[0].nextHostStep,'STOP_AND_INSPECT_EXISTING_FILE');
  const unknown=projectAgent05DeliveryProgress(b,{observations:[{
    target:a.target,writeState:'UNKNOWN'
  }]});
  assert.equal(unknown.overallStatus,'RECONCILIATION_REQUIRED');
  assert.equal(unknown.files[0].readbackStatus,'NOT_OBSERVED');
});
test('a failed write or declined approval cannot be reclassified as a success',()=>{
  const b=batch('compact'),a=b.actions[0];
  const declined=projectAgent05DeliveryProgress(b,{observations:[
    {target:a.target,writeState:'DECLINED'}]});
  assert.equal(declined.overallStatus,'DECLINED_BY_USER');
  assert.equal(declined.nextHostStep,'AWAIT_NEW_USER_DECISION');
  const failed=projectAgent05DeliveryProgress(b,{observations:[
    {target:a.target,writeState:'FAILED',readback:match(a)}]});
  assert.equal(failed.overallStatus,'FAILED_REQUIRES_REVIEW');
  assert.equal(failed.counts.hostReportedMatched,0);
  assert.equal(failed.deliveryCompletedByK04,false);
  const inFlight=projectAgent05DeliveryProgress(b,{observations:[
    {target:a.target,writeState:'IN_FLIGHT'}]});
  assert.equal(inFlight.overallStatus,'IN_FLIGHT');
});
test('invalid, duplicate, unexpected, forged or stale observations fail closed',()=>{
  const b=batch('compact'),a=b.actions[0];
  const good={target:a.target,writeState:'ACKNOWLEDGED',readback:match(a)};
  const bad=[
    [{...good,writeState:'COMPLETED'},'AGENT05_PROGRESS_OBSERVATION_INVALID'],
    [{...good,readback:{...match(a),sha256:A}},'AGENT05_PROGRESS_READBACK_INVALID'],
    [{...good,readback:{...match(a),path:'another-file.md'}},
      'AGENT05_PROGRESS_READBACK_INVALID'],
    [{...good,readback:{...match(a),root_id:'private'}},
      'AGENT05_PROGRESS_READBACK_INVALID'],
    [{...good,target:'wrong-file.md'},'AGENT05_PROGRESS_UNEXPECTED_TARGET'],
    [{...good,extra:'authority'},'AGENT05_PROGRESS_OBSERVATION_INVALID'],
    [{...good,repairCaseId:'REPAIR-unknown'},'AGENT05_PROGRESS_REPAIR_CASE_INVALID'],
    [{...good,readback:{...match(a),text:'\ud800',sha256:rawSha('\ud800')}},
      'AGENT05_PROGRESS_READBACK_INVALID'],
  ];
  for(const [observation,code] of bad)
    assert.throws(()=>projectAgent05DeliveryProgress(b,{observations:[observation]}),
      error(code),code);
  assert.throws(()=>projectAgent05DeliveryProgress(b,{observations:[good,good]}),
    error('AGENT05_PROGRESS_OBSERVATIONS_INVALID'));
  const modified=structuredClone(b);
  modified.actions[0].arguments.mode='replace';
  assert.throws(()=>projectAgent05DeliveryProgress(modified),
    error('AGENT05_FILE_BATCH_CHANGED'));
});
