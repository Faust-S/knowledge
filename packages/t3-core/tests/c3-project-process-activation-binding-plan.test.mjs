import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  C3ProjectProcessActivationBindingPlanError,
  buildC3ProjectProcessActivationBindingPlan,
} from '../../product/tools/c3-project-process-activation-binding-plan.mjs';

function stable(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(stable).join(',')+']';const ks=Object.keys(v).sort();return '{'+ks.map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}'}
function receipt(){
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

test('builds exact dual-hash binding plan without mutating source or authorizing writes',()=>{
  const r=receipt();
  const p=buildC3ProjectProcessActivationBindingPlan({activationReceipt:r});
  assert.equal(p.status,'READY_FOR_EXACT_BINDING_COMMIT');
  assert.equal(p.currentCanonicalStatus,'QUALIFICATION_AND_D4_PENDING');
  assert.equal(p.productionWriteActivation,false);
  assert.equal(p.historicalRecoveryRequired,false);
  assert.equal(p.activationReceiptSha256,r.receiptSha256);
  assert.match(p.activationGateSha256,/^[0-9a-f]{64}$/);
  assert.equal(p.proposedCanonicalActivationConfig.status,'ACTIVATED_EXACT_RECEIPT_BOUND');
  assert.equal(p.proposedCanonicalActivationConfig.writesAuthorized,true);
  assert.equal(p.proposedCanonicalActivationConfig.expectedActivationReceiptSha256,r.receiptSha256);
  assert.equal(p.proposedCanonicalActivationConfig.expectedActivationGateSha256,p.activationGateSha256);
  assert.equal(p.proposedCanonicalActivationConfig.commonResultAcceptanceWrites,'FORBIDDEN');
  assert.equal(p.gatePreview.gateSha256,p.activationGateSha256);
  assert.equal(p.nonEffects.sourceFileModified,false);
  assert.equal(p.nonEffects.writesAuthorizedNow,false);
  assert.equal(p.nonEffects.commonResultAcceptanceWrites,'FORBIDDEN');
  assert.match(p.planSha256,/^[0-9a-f]{64}$/);
});

test('binding plan rejects tampered activation receipt',()=>{
  const r=receipt();r.productGraphSha256='c'.repeat(64);
  assert.throws(
    ()=>buildC3ProjectProcessActivationBindingPlan({activationReceipt:r}),
    (e)=>e?.code==='PROJECT_PROCESS_SOURCE_ACTIVATION_RECEIPT_SELF_HASH_MISMATCH',
  );
});

test('binding plan rejects missing activation receipt identity',()=>{
  const r=receipt();delete r.receiptSha256;
  assert.throws(
    ()=>buildC3ProjectProcessActivationBindingPlan({activationReceipt:r}),
    (e)=>e instanceof C3ProjectProcessActivationBindingPlanError&&e.code==='INVALID_BINDING_PLAN_SHA256',
  );
});
