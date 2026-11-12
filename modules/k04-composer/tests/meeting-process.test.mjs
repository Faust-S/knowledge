import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ComposerError,digest,matchTask,resolveRequiredCapabilities,
  createHostNeutralPlan} from '../index.mjs';
import {solution,sampleAvailability,extractStructuredMeeting} from '../sample/open-host.mjs';
import {extractAdoptedMeetingDecisions,prepareMeetingProcess,
  verifyMeetingProcess,reconcileMeetingDecisions,renderMeetingDocuments} from '../meeting-process.mjs';
import {publishMeetingDocuments} from '../meeting-document-host.mjs';
const transcript=await readFile(new URL('../sample/meeting-case-05.txt',import.meta.url),'utf8');
const expected=['Подготовить уточнённый бюджет пилота',
  'Проверить резервное копирование тестового контура',
  'Составить протокол приёмочных испытаний',
  'Подготовить инструкцию службы поддержки'];
const err=code=>e=>e instanceof ComposerError&&e.code===code;
const task=(text=transcript)=>({taskId:'K04-MEETING-05',kind:'meeting_followup',
  input:{transcript_text:text},source:{ref:'synthetic/meeting-case-05.txt',
    revision:'authored-2026-11-12',rights:'AUTHOR_OWNED',authorized:true}});
const run=text=>prepareMeetingProcess({task:task(text),solution,available:sampleAvailability()});
test('complex meeting: real four explicit decisions, discussion excluded, exact source citations',()=>{
  const p=run(transcript);
  assert.deepEqual(p.extraction.draft.action_items.map(x=>x.action),expected);
  assert.equal(p.extraction.discussions.length,3);
  assert.equal(p.extraction.decisionCount,4);
  assert.equal(p.status,'CLARIFICATION_REQUIRED');
  assert.deepEqual(p.extraction.draft.action_items.map(x=>x.assignee),
    ['Мария','Иван','Олег','UNKNOWN']);
  assert.equal(p.extraction.draft.action_items.at(-1).due_date,'UNKNOWN');
  assert.equal(p.reconciliation.passed,true);
  assert.equal(p.legacyEvaluation.status,'DRAFT_READY_FOR_HUMAN_REVIEW');
  assert.equal(p.legacyEvaluation.assignmentsExecuted,false);
  assert.equal(p.legacyEvaluation.goalCompletionAttested,false);
  assert.equal(p.stepReceipts.length,2);
  assert.equal(p.k02Handoff.steps.length,2);
  assert.ok(p.stepReceipts.every(x=>x.status==='SUCCEEDED'&&x.durationMs>=0));
  assert.equal(verifyMeetingProcess(p),true);
  const plain=extractStructuredMeeting(transcript);
  assert.equal(plain.action_items.length,0,
    'regex baseline is not a model+Skills inference experiment');
});
test('whole solution remains resolved through current K04 API and K02 stage requirements',()=>{
  const selected=matchTask(task(),[solution]);
  assert.equal(selected.candidates[0].status,'CANDIDATE');
  const resolution=resolveRequiredCapabilities(solution,sampleAvailability());
  assert.equal(resolution.status,'SUPPORTED');
  const plan=createHostNeutralPlan({task:task(),solution,resolution});
  assert.equal(plan.steps[1].selected.kind,'tool');
  const p=run(transcript);
  assert.equal(p.hostPlan.planDigest,plan.planDigest);
  assert.deepEqual(p.k02Handoff.steps.map(s=>s.stepId),['extract','audit']);
  assert.deepEqual(p.k02Handoff.steps.map(s=>s.complexity.level),['LOW','HIGH']);
});
test('generated documents include provenance, owner, due date, exact quotes and honest execution status',()=>{
  const p=run(transcript),packageResult=renderMeetingDocuments(p);
  assert.equal(Object.keys(packageResult.documents).length,4);
  assert.equal(packageResult.assignmentsExecuted,false);
  const register=packageResult.documents['action-register.csv'];
  assert.equal(register.split('\n').length,6);
  assert.ok(register.includes('NOT_EXECUTED'));
  for(const a of expected)assert.ok(register.includes(a),a);
  assert.ok(register.includes('UNKNOWN'));
  assert.ok(register.includes(p.extraction.draft.action_items[0].quote));
  assert.ok(packageResult.documents['meeting-decisions.md'].includes(p.provenance.transcriptDigest));
  assert.ok(packageResult.documents['review-questions.md'].includes('Уточнить исполнителя'));
  assert.ok(packageResult.documents['human-followup-drafts.md'].includes('Сообщение не отправлено'));
});
test('actual open-host file write, digest readback and idempotent replay with no duplicate operation',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'iwxa-k04-'));
  try{
    const p=run(transcript),one=await publishMeetingDocuments(p,{directory});
    assert.equal(one.status,'DOCUMENTS_WRITTEN_AND_READ_BACK');
    assert.equal(one.documentsCreated,4);
    assert.equal(one.documentsReused,0);
    const two=await publishMeetingDocuments(p,{directory});
    assert.equal(two.documentsCreated,0);
    assert.equal(two.documentsReused,4);
    assert.deepEqual(one.files.map(f=>f.contentDigest),two.files.map(f=>f.contentDigest));
    for(const file of two.files){
      const text=await readFile(file.path,'utf8');
      assert.equal(digest(text),file.contentDigest);
    }
    assert.equal(two.assignmentsExecuted,false);
    assert.equal(two.humanReview,'PENDING');
    assert.equal(two.outboundMessagesSent,0);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('partial tool failure then retry only writes absent documents, preserving the first results',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'iwxa-k04-partial-'));
  try{
    const p=run(transcript);
    await assert.rejects(publishMeetingDocuments(p,{directory,failAfterWrites:2}),
      err('SIMULATED_HOST_TOOL_FAILURE'));
    const complete=await publishMeetingDocuments(p,{directory});
    assert.equal(complete.documentsCreated,2);
    assert.equal(complete.documentsReused,2);
    const changed=await readFile(join(directory,'meeting-decisions.md'),'utf8');
    await writeFile(join(directory,'meeting-decisions.md'),changed+'tampering','utf8');
    await assert.rejects(publishMeetingDocuments(p,{directory}),
      err('DOCUMENT_READBACK_MISMATCH'));
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('missing transcript content and no accepted decision produce needs-input, never invented work',()=>{
  const incomplete='Обсуждение: участники предложили изменить маркетинг, но решение не принято.';
  assert.equal(run(incomplete).status,'NEEDS_INPUT');
  assert.equal(run(incomplete).extraction.draft.action_items.length,0);
  assert.throws(()=>run(''),err('MEETING_SOURCE_REQUIRED'));
});
test('conflicting accepted decisions block progress while preserving both sources',()=>{
  const conflicting=transcript+'\nРешение принято: Подготовить уточнённый бюджет пилота; исполнитель: Иван; срок: 19 ноября 2026.\n';
  const p=run(conflicting);
  assert.equal(p.status,'CONFLICT_REVIEW_REQUIRED');
  assert.equal(p.reconciliation.conflicts.length,1);
  assert.ok(p.reconciliation.errors.some(x=>x.startsWith('DECISION_CONFLICT_')));
  assert.equal(p.legacyEvaluation.assignmentsExecuted,false);
});
test('missing owner is explicitly unresolved; no automatic Human Review or Task report',()=>{
  const p=run(transcript);
  assert.ok(p.extraction.draft.open_questions.some(x=>x.includes('Уточнить исполнителя')));
  assert.ok(p.extraction.draft.open_questions.some(x=>x.includes('Уточнить срок')));
  assert.equal(p.hostReview,'PENDING');
  assert.equal(p.taskReport,'NOT_SUBMITTED');
});
test('changed process contents or K02 stage digest invalidate the generated package',()=>{
  const p=run(transcript);
  const wrong=structuredClone(p);
  wrong.extraction.draft.action_items[0].actual_work_status='COMPLETED';
  assert.throws(()=>renderMeetingDocuments(wrong),err('MEETING_PROCESS_CHANGED'));
  const wrongK02=structuredClone(p);
  wrongK02.k02Handoff.handoffDigest='0'.repeat(64);
  assert.throws(()=>renderMeetingDocuments(wrongK02),err('MEETING_K02_HANDOFF_CHANGED'));
});
test('no compatible deterministic capability produces explicit refusal, not model substitution',()=>{
  assert.throws(()=>prepareMeetingProcess({task:task(),solution,
    available:sampleAvailability({withoutAudit:true})}),
    err('MEETING_REQUIRED_CAPABILITY_UNAVAILABLE'));
});
