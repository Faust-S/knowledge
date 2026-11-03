import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePet} from '../pet_activity_benchmark.mjs';

const rows=[
  {
    'document name':'doc-1.1','sentence-ID':0,
    tokens:['The','nurse','reviews','orders','.'],
    'ner-tags':['O','B-Actor','B-Activity','B-Activity Data','O']
  },
  {
    'document name':'doc-2.1','sentence-ID':1,
    tokens:['A','manager','approves','invoices','.'],
    'ner-tags':['O','B-Actor','B-Activity','B-Activity Data','O']
  },
  {
    'document name':'doc-3.1','sentence-ID':0,
    tokens:['No','action','was','recorded','.'],
    'ner-tags':['O','O','O','O','O']
  }
];

test('family-heldout PET activity evaluation has real counts, never Task acceptance',()=>{
  const report=evaluatePet(rows,{split:'family'});
  assert.equal(report.benchmark_schema,'IWXA_PET_ACTIVITY_PROBE/0.2');
  assert.equal(report.evaluation.splitting,'LEAVE_ONE_DOCUMENT_PREFIX_FAMILY_OUT');
  assert.equal(report.evaluation.train_and_test_family_disjoint,true);
  assert.equal(report.counts.documents,3);
  assert.equal(report.counts.sentences,3);
  assert.equal(report.counts.gold_activity_tokens,2);
  assert.equal(report.counts.gold_activity_spans,2);
  assert.equal(report.task_vs_activity,'PET_ACTIVITIES_NOT_PERSONAL_TASK_GOALS');
  assert.equal(report.methods.all_tokens.token.recall,1);
  for (const method of ['all_tokens','explicit_request_cue','morphology_cue','document_heldout_perceptron']) {
    assert.ok(report.methods[method]);
    for (const measure of ['precision','recall','f1']) {
      const score=report.methods[method].token[measure];
      assert.ok(Number.isFinite(score)&&score>=0&&score<=1);
    }
  }
  assert.ok(report.review_queue.rows.every(x=>x.task_candidate===false&&x.accepted_task===false));
});

test('family-heldout predicted token positions never become accepted TaskTypes',()=>{
  const report=evaluatePet(rows,{split:'family',emitPredictions:true});
  const pred=report.prediction_export;
  assert.equal(pred.task_candidates_created,0);
  assert.equal(pred.task_type_ids_assigned,0);
  assert.equal(pred.engine_accepted,false);
  assert.equal(pred.original_text_exported,false);
  assert.equal(pred.rows.length,rows.length);
  assert.ok(pred.rows.every(x=>Array.isArray(x.activity_token_positions)
    && x.activity_token_positions.every(i=>Number.isInteger(i)&&i>=0&&i<x.token_count)));
  assert.ok(pred.rows.every(x=>!('tokens' in x)));
});

test('invalid labeling, input shapes, duplicate IDs and leaking document-mode predictions fail closed',()=>{
  assert.throws(()=>evaluatePet(rows,{split:'other'}),/PET_SPLIT_MODE_INVALID/);
  assert.throws(()=>evaluatePet(rows,{split:'document',emitPredictions:true}),/PET_PREDICTIONS_REQUIRE_GROUP_HELDOUT/);
  assert.throws(()=>evaluatePet([rows[0]]),/PET_RECORDS_MISSING/);
  assert.throws(()=>evaluatePet([rows[0],rows[0],rows[1]]),/PET_DUPLICATE_DOCUMENT_SENTENCE/);
  assert.throws(()=>evaluatePet([
    {...rows[0],'ner-tags':['I-Activity','O','O','O','O']},rows[1]
  ]),/PET_BIO_ACTIVITY_SEQUENCE_INVALID/);
});
