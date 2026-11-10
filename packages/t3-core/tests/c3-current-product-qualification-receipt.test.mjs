import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  CurrentC3QualificationReceiptError,
  buildCurrentC3QualificationReceipt,
} from '../../product/tools/c3-current-product-qualification-receipt.mjs';

function stable(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(stable).join(',')+']';const ks=Object.keys(v).sort();return '{'+ks.map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}'}
const X=n=>String(n).repeat(64);
function qualification(){return {
  schema:'IWXA_T2_C3_PROJECT_PROCESS_QUALIFICATION_RESULT_V2',
  status:'PASS',
  exactCurrentSubject:true,
  historicalRecoveryRequired:false,
  productionWriteActivation:false,
  commonResultAcceptanceWrites:'FORBIDDEN',
  qualificationHarnessPersistent:false,
  ownerId:'iwxa.project-process.owner',
  sourceFamiliesQualified:['a','b','c','d','e','f','g','h'],
  commandsQualified:{create:8,revise:8,load:8,release:8},
  relationChecks:{a:true,b:true},
  loadQualified:{a:true,b:true},
  loadAfterReleaseQualified:{a:true,b:true},
  revisionConflictQualified:true,
  resultAcceptanceScopeRejection:{result:true,acceptance:true},
  auditIdentityQualified:true,
  releaseQualified:true,
};}
function r11(){
  const body={
    schema:'IWXA_T2_K035_RC20_R11_PREACCEPTANCE_CLOSURE_V2',
    status:'PASS',
    testOnlyReleasePreview:{authority:'TEST_ONLY_DERIVATIVE_NOT_STAGE_D',stageDAuthorized:false,releaseZipSha256:X(2)},
    currentBuild:{packageLockSha256:X(3),buildTreeSha256:X(4),buildFileCount:11,buildCount:2,buildsByteEquivalent:true},
  };
  return {...body,receiptSha256:createHash('sha256').update(stable(body)).digest('hex')};
}

test('builds self-hashed current-subject C3 qualification receipt without historical dependency',()=>{
  const x=buildCurrentC3QualificationReceipt({qualification:qualification(),r11Closure:r11()});
  assert.equal(x.schema,'IWXA_T2_C3_PROJECT_PROCESS_CURRENT_QUALIFICATION_V1');
  assert.equal(x.status,'PASS');
  assert.equal(x.exactCurrentSubject,true);
  assert.equal(x.historicalRecoveryRequired,false);
  assert.equal(x.productionWriteActivation,false);
  assert.equal(x.commonResultAcceptanceWrites,'FORBIDDEN');
  assert.equal(x.sourceFamilyCount,8);
  assert.equal(x.currentBuild.packageLockSha256,X(3));
  assert.equal(x.currentBuild.buildTreeSha256,X(4));
  assert.equal(x.currentBuild.buildCount,2);
    assert.match(x.qualificationResultSha256,/^[0-9a-f]{64}$/);
  assert.match(x.receiptSha256,/^[0-9a-f]{64}$/);
});

test('rejects any current qualification that reintroduces historical recovery',()=>{
  const q=qualification();q.historicalRecoveryRequired=true;
  assert.throws(
    ()=>buildCurrentC3QualificationReceipt({qualification:q,r11Closure:r11()}),
    (e)=>e instanceof CurrentC3QualificationReceiptError&&e.code==='CURRENT_C3_QUALIFICATION_SUBJECT_INVALID',
  );
});

test('rejects any current qualification that enables common Result/Acceptance writes',()=>{
  const q=qualification();q.commonResultAcceptanceWrites='ALLOWED';
  assert.throws(
    ()=>buildCurrentC3QualificationReceipt({qualification:q,r11Closure:r11()}),
    (e)=>e instanceof CurrentC3QualificationReceiptError&&e.code==='CURRENT_C3_QUALIFICATION_AUTHORITY_INVALID',
  );
});

test('rejects incomplete eight-family command coverage',()=>{
  const q=qualification();q.commandsQualified.revise=7;
  assert.throws(
    ()=>buildCurrentC3QualificationReceipt({qualification:q,r11Closure:r11()}),
    (e)=>e instanceof CurrentC3QualificationReceiptError&&e.code==='CURRENT_C3_QUALIFICATION_COMMAND_COVERAGE_INVALID',
  );
});

test('rejects forged R11 closure self-hash',()=>{
  const c=r11();c.receiptSha256=X(9);
  assert.throws(
    ()=>buildCurrentC3QualificationReceipt({qualification:qualification(),r11Closure:c}),
    (e)=>e instanceof CurrentC3QualificationReceiptError&&e.code==='CURRENT_C3_R11_SELF_HASH_INVALID',
  );
});

test('rejects R11 closure without current build binding',()=>{
  const c=r11();delete c.currentBuild;const body={...c};delete body.receiptSha256;c.receiptSha256=createHash('sha256').update(stable(body)).digest('hex');
  assert.throws(
    ()=>buildCurrentC3QualificationReceipt({qualification:qualification(),r11Closure:c}),
    (e)=>e instanceof CurrentC3QualificationReceiptError&&e.code==='CURRENT_C3_BUILD_BINDING_REQUIRED',
  );
});
