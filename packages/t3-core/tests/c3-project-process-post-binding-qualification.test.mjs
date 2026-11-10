import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildC3ProjectProcessActivationBindingPlan} from '../../product/tools/c3-project-process-activation-binding-plan.mjs';
import {qualifyProjectProcessPostBinding} from '../src/modules/base/owners/project-process-qualification.mjs';

function stable(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(stable).join(',')+']';const ks=Object.keys(v).sort();return '{'+ks.map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}'}
function activationReceipt(){
  const body={
    schema:'IWXA_T2_C3_PROJECT_PROCESS_CURRENT_ACTIVATION_RECEIPT_V1',
    status:'AUTHORIZED_FOR_EXACT_OWNER_GATE_BINDING',
    historicalRecoveryRequired:false,
    ownerId:'iwxa.project-process.owner',
    sourceFamilies:['project','work','processDefinition','processRun','case','decision','activity','event'],
    ownerAdoptionApprovalSha256:'1'.repeat(64),
    d4PreflightSha256:'2'.repeat(64),
    d4SubjectSha256:'3'.repeat(64),
    productGraphSha256:'4'.repeat(64),
    kernelSourceSha256:'5'.repeat(64),
    workspaceSha256:'6'.repeat(64),
    c3QualificationReceiptSha256:'7'.repeat(64),
    r11ClosureSha256:'8'.repeat(64),
    runtimeAcceptanceReceiptSha256:'9'.repeat(64),
    d4EvidenceSha256:'a'.repeat(64),
    releaseZipSha256:'b'.repeat(64),
    bindingEffect:{writesAuthorizedNow:false,qualificationHarnessPersistent:false,commonResultAcceptanceWrites:'FORBIDDEN'},
    invalidationRule:'Any bound current-subject identity change invalidates this receipt.',
  };
  return {...body,receiptSha256:createHash('sha256').update(stable(body)).digest('hex')};
}

test('post-binding regression reuses full eight-family qualification behind exact dual-hash gate',async()=>{
  const receipt=activationReceipt();
  const plan=buildC3ProjectProcessActivationBindingPlan({activationReceipt:receipt});
  const result=await qualifyProjectProcessPostBinding({
    activationReceipt:receipt,
    config:plan.proposedCanonicalActivationConfig,
  });
  assert.equal(result.schema,'IWXA_T2_C3_PROJECT_PROCESS_POST_BINDING_QUALIFICATION_RESULT_V1');
  assert.equal(result.status,'PASS');
  assert.equal(result.postBindingSimulation,true);
  assert.equal(result.activationGateQualified,true);
  assert.equal(result.activationGateSha256,plan.activationGateSha256);
  assert.equal(result.activationReceiptSha256,receipt.receiptSha256);
  assert.equal(result.productionWriteActivation,false);
  assert.equal(result.qualificationHarnessPersistent,false);
  assert.equal(result.historicalRecoveryRequired,false);
  assert.equal(result.commonResultAcceptanceWrites,'FORBIDDEN');
  assert.deepEqual(result.commandsQualified,{create:8,revise:8,load:8,release:8});
  assert.equal(Object.values(result.relationChecks).every(Boolean),true);
  assert.equal(Object.values(result.loadQualified).every(Boolean),true);
  assert.equal(Object.values(result.loadAfterReleaseQualified).every(Boolean),true);
  assert.equal(result.revisionConflictQualified,true);
  assert.deepEqual(result.resultAcceptanceScopeRejection,{result:true,acceptance:true});
  assert.equal(result.auditIdentityQualified,true);
  assert.equal(result.releaseQualified,true);
  assert.match(result.qualificationSha256,/^[0-9a-f]{64}$/);
});

test('post-binding regression rejects a binding config for another gate identity',async()=>{
  const receipt=activationReceipt();
  const plan=buildC3ProjectProcessActivationBindingPlan({activationReceipt:receipt});
  const bad={...plan.proposedCanonicalActivationConfig,expectedActivationGateSha256:'c'.repeat(64)};
  await assert.rejects(
    qualifyProjectProcessPostBinding({activationReceipt:receipt,config:bad}),
    (e)=>e?.code==='PROJECT_PROCESS_SOURCE_ACTIVATION_GATE_MISMATCH',
  );
});
