import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ComposerError,digest} from '../index.mjs';
import {prepareSavedMeetingDocuments,verifySavedMeetingDocuments} from '../saved-meeting-result.mjs';
import {publishSavedMeetingDocuments} from '../meeting-document-host.mjs';

const transcript='🧪 Совещание: Мария подготовит бюджет к пятнице. Иван проверит смету, срок не указан. Идею рекламы только обсуждали.';
const SHA='a'.repeat(64), SHA2='b'.repeat(64), SHA3='c'.repeat(64);
const pointOffset=quote=>Array.from(transcript.slice(0,transcript.indexOf(quote))).length;
const action=(quote,action,assignee,date)=>{
  const start=pointOffset(quote);
  return {action,quote,start,end:start+Array.from(quote).length,
    assignee,due_date:date,worker_kind:'human',actual_work_status:'NOT_EXECUTED'};
};
const draft=()=>({
  action_items:[
    action('Мария подготовит бюджет к пятнице.','Подготовить бюджет','Мария','пятнице'),
    action('Иван проверит смету, срок не указан.','Проверить смету','Иван','UNKNOWN')
  ],
  open_questions:['Уточнить срок проверки сметы']
});
function canonical(x){
  if(Array.isArray(x))return x.map(canonical);
  if(x && typeof x==='object')return Object.fromEntries(
    Object.keys(x).sort().map(k=>[k,canonical(x[k])]));
  return x;
}
const raw=thing=>JSON.stringify(canonical(thing));
const source=()=>({ref:'graph-source:MEETING-01',revision:'meeting-author-owned-v1',
  rights:'AUTHOR_OWNED',transcript,transcriptDigest:digest(transcript),
  graphConfigDigest:SHA3});
const graph=(d=draft())=>({
  execution_id:'EXEC-01',graph_id:'meeting-followup',
  graph_digest:SHA,execution_digest:SHA2,node_id:'result',
  node_run_digest:SHA3,artifact_digest:SHA2,attempt:1,
  text:raw(d),content_type:'text/plain',execution_state:'COMPLETED',
  result_is_execution_authority:false,human_review_required:true,
  quality_evaluation:{contract:'PA.K05.MEETING_SOURCE_EVALUATION/0.1.0',
    status:'SOURCE_QUOTES_VERIFIED',source_revision:SHA3,passed:true,
    source_quotes_checked:d.action_items.length,errors:[],
    result_accepted:false,human_review_required:true}
});
const run=(s=source(),g=graph())=>prepareSavedMeetingDocuments({
  taskRef:'TASK-K04-MEETING',source:s,graphResult:g
});
const error=code=>e=>e instanceof ComposerError&&e.code===code;

test('Agent 0.5 graph_final_result readback yields four usable documents without model reinvocation',()=>{
  const p=run();
  assert.equal(p.schema,'IWXA.K04.MEETING_GRAPH_DOCUMENTS/0.1.0');
  assert.equal(p.status,'CLARIFICATION_REQUIRED');
  assert.equal(p.quotesIndependentlyChecked,2);
  assert.equal(Object.keys(p.documents).length,4);
  assert.ok(p.documents['meeting-decisions.md'].includes('Обсуждений без решения: не определено'));
  assert.ok(p.documents['action-register.csv'].includes('Иван проверит смету'));
  assert.ok(p.documents['review-questions.md'].includes('Уточнить срок'));
  assert.ok(p.documents['human-followup-drafts.md'].includes('Сообщение не отправлено'));
  assert.equal(p.modelInvocationsByK04,0);
  assert.equal(p.graphExecutionsByK04,0);
  assert.equal(p.hostResultAuthVerifiedByK04,false);
  assert.equal(p.humanReview,'PENDING');
  assert.equal(p.assignmentsExecuted,false);
  assert.equal(p.taskReport,'NOT_SUBMITTED');
  assert.equal(p.goalDecision,'NOT_DECIDED');
  assert.equal(verifySavedMeetingDocuments(p),true);
});
test('actual open-host write and P01-derived saved document readback are idempotent',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'k04-p01-saved-'));
  try{
    const p=run(),first=await publishSavedMeetingDocuments(p,{directory});
    assert.equal(first.documentsCreated,4);
    assert.equal(first.origin,'P01_SAVED_GRAPH_RESULT');
    assert.equal(first.originDigest,graph().artifact_digest);
    assert.equal(first.status,'DOCUMENTS_WRITTEN_AND_READ_BACK');
    for(const file of first.files)
      assert.equal(digest(await readFile(file.path,'utf8')),p.documentDigests[file.name]);
    const replay=await publishSavedMeetingDocuments(p,{directory});
    assert.equal(replay.documentsCreated,0);
    assert.equal(replay.documentsReused,4);
    assert.equal(replay.outboundMessagesSent,0);
    assert.equal(replay.assignmentsExecuted,false);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('partial output failure and recovery reuse already committed document bytes',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'k04-p01-recovery-'));
  try{
    const p=run();
    await assert.rejects(publishSavedMeetingDocuments(p,{directory,failAfterWrites:2}),
      error('SIMULATED_HOST_TOOL_FAILURE'));
    const retried=await publishSavedMeetingDocuments(p,{directory});
    assert.equal(retried.documentsCreated,2);
    assert.equal(retried.documentsReused,2);
    await writeFile(join(directory,'meeting-decisions.md'),'changed','utf8');
    await assert.rejects(publishSavedMeetingDocuments(p,{directory}),
      error('DOCUMENT_READBACK_MISMATCH'));
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('no writing from uncommitted, incomplete or unverified Graph Result',()=>{
  for(const mutate of [
    g=>{g.execution_state='RUNNING';},
    g=>{g.node_id='extract';},
    g=>{g.artifact_digest='not-a-digest';},
    g=>{g.result_is_execution_authority=true;},
    g=>{g.truncated=true;}
  ]){
    const g=graph();mutate(g);
    assert.throws(()=>run(source(),g),error('SAVED_GRAPH_RESULT_INVALID'));
  }
  for(const mutate of [
    g=>{g.quality_evaluation.status='REVIEW_REQUIRED';},
    g=>{g.quality_evaluation.source_revision=SHA;},
    g=>{g.quality_evaluation.source_quotes_checked=1;},
    g=>{g.quality_evaluation.passed=false;},
    g=>{g.quality_evaluation.result_accepted=true;}
  ]){
    const g=graph();mutate(g);
    assert.throws(()=>run(source(),g),error('SAVED_GRAPH_EVIDENCE_NOT_VERIFIED'));
  }
});
test('exact Unicode source and canonical P01 normalized payload required',()=>{
  const s=source();s.transcriptDigest=SHA;
  assert.throws(()=>run(s),error('SAVED_MEETING_SOURCE_INVALID'));
  const g=graph();g.text=JSON.stringify(draft());
  assert.throws(()=>run(source(),g),error('SAVED_GRAPH_DRAFT_NOT_CANONICAL'));
  const duplicate=graph();
  duplicate.text='{"action_items":[],"action_items":[],"open_questions":["Unknown"]}';
  assert.throws(()=>run(source(),duplicate),error('SAVED_GRAPH_DRAFT_NOT_CANONICAL'));
  const invalid=graph();
  invalid.text='not json';
  assert.throws(()=>run(source(),invalid),error('SAVED_GRAPH_DRAFT_NOT_JSON'));
  const wrong=graph();
  const d=draft();d.action_items[0].start+=1;wrong.text=raw(d);
  assert.throws(()=>run(source(),wrong),error('SAVED_GRAPH_SOURCE_MISMATCH'));
});
test('false owner and human-work completion claims cannot pass independently',()=>{
  for(const adjust of [
    d=>{d.action_items[0].assignee='Иван';},
    d=>{d.action_items[0].actual_work_status='COMPLETED';},
    d=>{d.action_items[0].worker_kind='model';},
    d=>{d.action_items[0].due_date='завтра';}
  ]){
    const d=draft();adjust(d);
    const g=graph(d);
    assert.throws(()=>run(source(),g),e=>e instanceof ComposerError&&
      ['SAVED_GRAPH_DRAFT_INVALID','SAVED_GRAPH_SOURCE_MISMATCH'].includes(e.code));
  }
});
test('no executed assignments, but an open question without assignments yields NEEDS_INPUT',()=>{
  const d={action_items:[],open_questions:['Какие решения были приняты?']};
  const p=run(source(),graph(d));
  assert.equal(p.status,'NEEDS_INPUT');
  assert.equal(p.quotesIndependentlyChecked,0);
  assert.equal(p.assignmentsExecuted,false);
});
test('saved document package mutations are not accepted for writing',async()=>{
  const p=run();const changed=structuredClone(p);
  changed.documents['meeting-decisions.md']+='fake completion';
  const directory=await mkdtemp(join(tmpdir(),'k04-p01-tamper-'));
  try{
    await assert.rejects(publishSavedMeetingDocuments(changed,{directory}),
      error('SAVED_MEETING_PACKAGE_CHANGED'));
  }finally{await rm(directory,{recursive:true,force:true});}
});
