import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {runAgent05DocumentDelivery} from '../sample/run-agent05-document-delivery.mjs';

const sha=x=>createHash('sha256').update(x,'utf8').digest('hex');
test('one compact real open-host file from synthetic multi-person meeting; replay is byte-identical',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'k04-compact-sample-'));
  try{
    const result=await runAgent05DocumentDelivery({directory,deliveryMode:'compact'});
    assert.equal(result.sourceKind,'AUTHOR_OWNED_SYNTHETIC_MEETING');
    assert.equal(result.graphEvidenceKind,'SYNTHETIC_SNAPSHOT_NOT_NATIVE_P01');
    assert.equal(result.packageStatus,'CLARIFICATION_REQUIRED');
    assert.equal(result.processValidations.actionsExtracted,4);
    assert.equal(result.processValidations.quotesIndependentlyChecked,4);
    assert.equal(result.actualLocalOpenHostWrites,1);
    assert.equal(result.actualLocalOpenHostReadbacks,1);
    assert.equal(result.created,1);
    assert.equal(result.documents.length,1);
    assert.equal(result.nativeU01Executed,false);
    assert.equal(result.nativeReceiptsAttested,false);
    assert.equal(result.modelInferenceExecuted,false);
    assert.equal(result.employeeActionsExecuted,false);
    const names=await readdir(directory);
    assert.equal(names.length,1);
    assert.ok(names[0].endsWith('-meeting-followup.md'));
    const saved=await readFile(join(directory,names[0]),'utf8');
    assert.ok(saved.includes('Подготовить уточнённый бюджет пилота'));
    assert.ok(saved.includes('Подготовить инструкцию службы поддержки'));
    assert.ok(saved.includes('Уточнить исполнителя'));
    assert.ok(saved.includes('НЕ ВЫПОЛНЕНО'));
    assert.equal(sha(saved),result.documents[0].utf8Sha256);
    const again=await runAgent05DocumentDelivery({directory,deliveryMode:'compact'});
    assert.equal(again.created,0);
    assert.equal(again.reused,1);
    assert.deepEqual(again.documents,result.documents);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('full kit is still four files using the same authored meeting source',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'k04-full-sample-'));
  try{
    const output=await runAgent05DocumentDelivery({directory,deliveryMode:'full'});
    assert.equal(output.mode,'full');
    assert.equal(output.created,4);
    assert.equal(output.actualLocalOpenHostReadbacks,4);
    assert.equal((await readdir(directory)).length,4);
    assert.ok(output.documents.some(row=>row.name==='action-register.csv'));
    assert.equal(output.humanReview,'PENDING');
    const again=await runAgent05DocumentDelivery({directory,deliveryMode:'full'});
    assert.equal(again.created,0);
    assert.equal(again.reused,4);
    assert.deepEqual(again.documents,output.documents);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('an existing tampered document is refused rather than silently rewritten',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'k04-collision-sample-'));
  try{
    const output=await runAgent05DocumentDelivery({directory,deliveryMode:'compact'});
    const file=output.documents[0].path;
    const {writeFile}=await import('node:fs/promises');
    await writeFile(join(directory,file),'tampered','utf8');
    await assert.rejects(runAgent05DocumentDelivery({directory,deliveryMode:'compact'}),
      /OPEN_HOST_READBACK_MISMATCH/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
