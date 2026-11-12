import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile,readFile,readdir,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ComposerError,digest} from '../index.mjs';
import {prepareSavedMeetingDocuments} from '../saved-meeting-result.mjs';
import {prepareAgent05FileActions,inspectAgent05FileReadbacks,
  AGENT05_FILE_ACTION_VERSION,AGENT05_COMPACT_FILE_ACTION_VERSION} from '../agent05-file-actions.mjs';

const text='🧪 Встреча: Мария подготовит бюджет к пятнице.';
const quote='Мария подготовит бюджет к пятнице.';
const start=Array.from(text.slice(0,text.indexOf(quote))).length;
const SHA='a'.repeat(64),SHA2='b'.repeat(64),SHA3='c'.repeat(64);
const sort=x=>Array.isArray(x)?x.map(sort):x&&typeof x==='object'?
  Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;
const source=()=>({ref:'graph-source:meeting',revision:'author-fixture-1',
  rights:'AUTHOR_OWNED',transcript:text,transcriptDigest:digest(text),
  graphConfigDigest:SHA3});
const graph=()=>({
  execution_id:'EXEC-05',graph_id:'meeting-followup',
  graph_digest:SHA,execution_digest:SHA2,node_id:'result',
  node_run_digest:SHA3,artifact_digest:SHA2,attempt:1,
  text:JSON.stringify(sort({action_items:[{
    action:'Подготовить бюджет',quote,start,end:start+Array.from(quote).length,
    assignee:'Мария',due_date:'пятнице',worker_kind:'human',
    actual_work_status:'NOT_EXECUTED'}],open_questions:[]})),
  content_type:'text/plain',execution_state:'COMPLETED',
  result_is_execution_authority:false,human_review_required:true,
  quality_evaluation:{contract:'PA.K05.MEETING_SOURCE_EVALUATION/0.1.0',
    status:'SOURCE_QUOTES_VERIFIED',source_revision:SHA3,passed:true,
    source_quotes_checked:1,errors:[],result_accepted:false,human_review_required:true}
});
const pack=()=>prepareSavedMeetingDocuments({taskRef:'TASK-P01-05',source:source(),graphResult:graph()});
const rawsha=x=>createHash('sha256').update(x,'utf8').digest('hex');
const err=code=>e=>e instanceof ComposerError&&e.code===code;
function observations(batch){
  // TEST DOUBLE: mimics the data shape returned by native ToolRuntime.read;
  // the open K04 test does not authenticate P01 receipts or perform a U01 action.
  return batch.actions.map(a=>({
    data:{root_id:'personal',path:a.target,text:a.text,sha256:rawsha(a.text)},
    receipt:{tool_id:'files.read',status:'SUCCEEDED',receipt_digest:'f'.repeat(64)}
  }));
}
test('a saved P01 meeting yields four exact native files.write_text candidate arguments',()=>{
  const p=pack();
  const batch=prepareAgent05FileActions(p,{baseDirectory:'Документы/Встречи'});
  assert.equal(batch.schema,AGENT05_FILE_ACTION_VERSION);
  assert.equal(batch.actions.length,4);
  assert.equal(batch.authorityGranted,false);
  assert.equal(batch.executed,false);
  assert.equal(batch.resultAccepted,false);
  assert.equal(batch.rootId,'personal');
  assert.deepEqual(batch.actions.map(x=>x.name),[
    'action-register.csv','human-followup-drafts.md','meeting-decisions.md','review-questions.md']);
  assert.ok(batch.actions.every(x=>x.operation==='files.write_text'&&
    x.arguments.mode==='create'&&x.requiresHumanApproval===true&&
    x.effectClass==='WRITE'&&x.risk==='medium'&&x.reversible===true));
  for(const a of batch.actions){
    assert.equal(a.arguments.path,a.target);
    assert.equal(a.arguments.text,p.documents[a.name]);
    assert.equal(a.k04ContentDigest,p.documentDigests[a.name]);
    assert.equal(a.contentSha256,rawsha(a.text));
    assert.equal(a.bytes,Buffer.byteLength(a.text,'utf8'));
    assert.notEqual(a.contentSha256,a.k04ContentDigest,
      'K04 JSON-value digest is not native file SHA-256');
    assert.ok(a.target.startsWith('Документы/Встречи/K04-'));
  }
  assert.ok(batch.hostPrerequisites.includes('P01_HUMAN_ACCEPTED_TASK_AND_ACTION_CANDIDATES'));
  assert.equal(batch.onUnknownWriteOutcome,'RECONCILIATION_REQUIRED_NO_AUTO_RETRY');
  const replay=prepareAgent05FileActions(p,{baseDirectory:'Документы/Встречи'});
  assert.deepEqual(replay,batch);
});
test('native file path is stable per Task/Graph Result; two results cannot silently overwrite one another',()=>{
  const p=pack(),a=prepareAgent05FileActions(p,{baseDirectory:'K04'});
  const b=prepareAgent05FileActions(p,{baseDirectory:'K04'});
  assert.deepEqual(a.actions.map(x=>x.target),b.actions.map(x=>x.target));
  const next=graph();next.artifact_digest='d'.repeat(64);
  const newer=prepareSavedMeetingDocuments({taskRef:'TASK-P01-05',
    source:source(),graphResult:next});
  const c=prepareAgent05FileActions(newer,{baseDirectory:'K04'});
  assert.notDeepEqual(c.actions.map(x=>x.target),a.actions.map(x=>x.target));
  assert.equal(a.actions.some(x=>x.target===c.actions[0].target),false);
});
test('no native invocation, ToolRuntime write, directory creation or state mutation during preparation',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'iwxa-k04-prepare-'));
  try{
    const p=pack();
    const before=await readdir(directory);
    const a=prepareAgent05FileActions(p,{baseDirectory:'K04'});
    assert.equal(a.actions.length,4);
    assert.deepEqual(await readdir(directory),before);
    assert.equal(a.actions.every(x=>x.executionState==='NOT_EXECUTED'),true);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('open local file-byte smoke validates each proposed action and rejects duplicate writes',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'iwxa-k04-native-shape-'));
  try{
    const batch=prepareAgent05FileActions(pack());
    for(const action of batch.actions){
      const path=join(folder,action.target);
      await writeFile(path,action.arguments.text,{encoding:'utf8',flag:'wx'});
      assert.equal(rawsha(await readFile(path,'utf8')),action.contentSha256);
      await assert.rejects(writeFile(path,action.arguments.text,{encoding:'utf8',flag:'wx'}),
        e=>e.code==='EEXIST');
    }
    const reviewed=inspectAgent05FileReadbacks(batch,observations(batch));
    assert.equal(reviewed.status,'HOST_SUPPLIED_READBACK_BYTES_MATCH');
    assert.equal(reviewed.filesCompared,4);
    assert.equal(reviewed.nativeToolWriteReceiptsVerifiedByK04,false);
    assert.equal(reviewed.nativeToolReadReceiptsVerifiedByK04,false);
    assert.equal(reviewed.assignmentsExecuted,false);
    assert.equal(reviewed.goalCompleted,false);
    assert.ok(reviewed.files.every(x=>x.utf8Sha256===rawsha(batch.actions.find(
      a=>a.name===x.name).text)));
  }finally{await rm(folder,{recursive:true,force:true});}
});
test('host readback mismatch, forged success and duplicate observations fail closed',()=>{
  const batch=prepareAgent05FileActions(pack());
  const cases=[
    {mutate:o=>{o[0].data.sha256='0'.repeat(64);},code:'AGENT05_READBACK_MISMATCH'},
    {mutate:o=>{o[0].data.text+='changed';},code:'AGENT05_READBACK_MISMATCH'},
    {mutate:o=>{o[0].receipt.status='FAILED';},code:'AGENT05_READBACK_INVALID'},
    {mutate:o=>{o[0].receipt.tool_id='files.write_text';},code:'AGENT05_READBACK_INVALID'},
    {mutate:o=>{o[0].data.root_id='other';},code:'AGENT05_READBACK_MISMATCH'},
    {mutate:o=>{o[0].data.path='other.txt';},code:'AGENT05_READBACK_UNEXPECTED'},
    {mutate:o=>{o[0]=structuredClone(o[1]);},code:'AGENT05_READBACK_UNEXPECTED'},
    {mutate:o=>o.pop(),code:'AGENT05_READBACKS_INCOMPLETE'},
  ];
  for(const {mutate,code} of cases){
    const obs=observations(batch);mutate(obs);
    assert.throws(()=>inspectAgent05FileReadbacks(batch,obs),err(code),code);
  }
});
test('path traversal, Windows reserved names, and implicit folders are not allowed',()=>{
  for(const dir of [
    '/root','../files','A/../files','A//B','A\\B','C:\\tmp',
    'A/CON','A/PRN.txt','A/NUL','A/AUX','A/LPT1','A/COM8',
    'A/name.','A/name ','A//','A/foo:bar','A/foo|bar','A/\nB',
  ]){
    assert.throws(()=>prepareAgent05FileActions(pack(),{baseDirectory:dir}),
      err('AGENT05_TARGET_DIRECTORY_INVALID'),JSON.stringify(dir));
  }
  assert.equal(prepareAgent05FileActions(pack(),{baseDirectory:''}).actions.length,4);
});
test('modified batch intent cannot be accepted as trustworthy U01 readback input',()=>{
  const batch=prepareAgent05FileActions(pack());
  for(const corrupt of [
    b=>{b.actions[0].arguments.mode='replace';},
    b=>{b.actions[0].arguments.path='different';},
    b=>{b.actions[0].contentSha256='0'.repeat(64);},
    b=>{b.authorityGranted=true;},
    b=>{b.actions[1].text='altered';},
  ]){
    const bad=structuredClone(batch);corrupt(bad);
    assert.throws(()=>inspectAgent05FileReadbacks(bad,observations(batch)),
      err('AGENT05_FILE_BATCH_CHANGED'));
  }
});

test('compact output contains decisions, unknowns and unsent drafts in one reviewable file',()=>{
  const p=pack();
  const full=prepareAgent05FileActions(p,{baseDirectory:'Встречи'});
  const unchanged=prepareAgent05FileActions(p,{baseDirectory:'Встречи',deliveryMode:'full'});
  assert.deepEqual(full,unchanged,'the existing four-file contract remains unchanged');
  const compact=prepareAgent05FileActions(p,{baseDirectory:'Встречи',deliveryMode:'compact'});
  assert.equal(compact.schema,AGENT05_COMPACT_FILE_ACTION_VERSION);
  assert.equal(compact.deliveryMode,'compact');
  assert.equal(compact.actions.length,1);
  assert.equal(compact.actions[0].name,'meeting-followup.md');
  assert.ok(compact.actions[0].target.startsWith('Встречи/K04-'));
  assert.equal(compact.actions[0].operation,'files.write_text');
  assert.equal(compact.actions[0].arguments.mode,'create');
  assert.equal(compact.actions[0].requiresHumanApproval,true);
  const result=compact.actions[0].text;
  assert.ok(result.includes(p.documents['meeting-decisions.md']));
  assert.ok(result.includes(p.documents['review-questions.md']));
  assert.ok(result.includes(p.documents['human-followup-drafts.md']));
  assert.ok(result.includes('НЕ ВЫПОЛНЕНО'));
  assert.ok(result.includes('Ничего не отправлено'));
  assert.ok(result.includes('отдельного CSV-реестра'));
  assert.ok(!compact.sourceDocuments.includes('action-register.csv'));
  assert.equal(compact.actions[0].bytes,Buffer.byteLength(result,'utf8'));
  assert.equal(compact.actions[0].contentSha256,rawsha(result));
  assert.equal(compact.actions[0].k04ContentDigest,digest(result));
  assert.equal(compact.authorityGranted,false);
  assert.equal(compact.executed,false);
  assert.equal(compact.resultAccepted,false);
});
test('compact save uses one real open-host write and one readback without duplicating work',async()=>{
  const root=await mkdtemp(join(tmpdir(),'iwxa-k04-compact-'));
  try{
    const original=pack();
    const batch=prepareAgent05FileActions(original,{deliveryMode:'compact'});
    assert.equal(batch.actions.length,1);
    const one=batch.actions[0];
    await writeFile(join(root,one.target),one.arguments.text,{encoding:'utf8',flag:'wx'});
    await assert.rejects(writeFile(join(root,one.target),one.arguments.text,
      {encoding:'utf8',flag:'wx'}),e=>e.code==='EEXIST');
    const readback=await readFile(join(root,one.target),'utf8');
    const obs=[{data:{root_id:'personal',path:one.target,text:readback,sha256:rawsha(readback)},
      receipt:{tool_id:'files.read',status:'SUCCEEDED',receipt_digest:'e'.repeat(64)}}];
    const verified=inspectAgent05FileReadbacks(batch,obs);
    assert.equal(verified.filesCompared,1);
    assert.equal(verified.files.length,1);
    assert.equal(verified.status,'HOST_SUPPLIED_READBACK_BYTES_MATCH');
    assert.equal(verified.nativeToolWriteReceiptsVerifiedByK04,false);
    assert.equal(verified.nativeToolReadReceiptsVerifiedByK04,false);
    assert.equal(verified.assignmentsExecuted,false);
    const resumed=prepareAgent05FileActions(pack(),{deliveryMode:'compact'});
    assert.equal(resumed.batchDigest,batch.batchDigest);
    assert.equal(rawsha(await readFile(join(root,resumed.actions[0].target),'utf8')),
      resumed.actions[0].contentSha256);
    const tampered=structuredClone(obs);tampered[0].data.text+='unexpected';
    assert.throws(()=>inspectAgent05FileReadbacks(batch,tampered),
      err('AGENT05_READBACK_MISMATCH'));
  }finally{await rm(root,{recursive:true,force:true});}
});
test('compact mode validates source-derived document package and rejects changed receipts',()=>{
  const batch=prepareAgent05FileActions(pack(),{deliveryMode:'compact'});
  const corrupted=structuredClone(batch);
  corrupted.deliveryMode='full';
  assert.throws(()=>inspectAgent05FileReadbacks(corrupted,observations(batch)),
    err('AGENT05_FILE_BATCH_CHANGED'));
  const another=structuredClone(batch);
  another.sourceDocuments.reverse();
  assert.throws(()=>inspectAgent05FileReadbacks(another,observations(batch)),
    err('AGENT05_FILE_BATCH_CHANGED'));
  const other=structuredClone(batch);
  other.actions[0].name='review-questions.md';
  assert.throws(()=>inspectAgent05FileReadbacks(other,observations(batch)),
    err('AGENT05_FILE_BATCH_CHANGED'));
  const obs=observations(batch);
  assert.equal(inspectAgent05FileReadbacks(batch,obs).filesCompared,1);
  assert.throws(()=>inspectAgent05FileReadbacks(batch,[...obs,...obs]),
    err('AGENT05_READBACKS_INCOMPLETE'));
  assert.throws(()=>prepareAgent05FileActions(pack(),{deliveryMode:'unspecified'}),
    err('AGENT05_DELIVERY_MODE_INVALID'));
});
test('oversized compact/individual file is explicitly refused before any U01 action',()=>{
  const p=pack();
  p.documents['human-followup-drafts.md']='A'.repeat(1_020_000);
  p.documentDigests['human-followup-drafts.md']=digest(p.documents['human-followup-drafts.md']);
  const {packageDigest,...body}=p;
  p.packageDigest=digest(body);
  assert.throws(()=>prepareAgent05FileActions(p,{deliveryMode:'full'}),
    err('AGENT05_DOCUMENT_TOO_LARGE'));
  assert.throws(()=>prepareAgent05FileActions(p,{deliveryMode:'compact'}),
    err('AGENT05_DOCUMENT_TOO_LARGE'));
});
