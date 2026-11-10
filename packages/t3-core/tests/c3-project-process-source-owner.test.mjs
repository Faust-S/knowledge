import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MemoryCanonicalAdapter, OwnerWriteGateway } from '../src/persistence/canonical-persistence.mjs';
import {
  PROJECT_PROCESS_SOURCE_ACTIVATION,
  ProjectProcessSourceOwner,
  ProjectProcessSourceOwnerError,
  assertProjectProcessSourceActivationConfiguration,
  assertProjectProcessSourceActivationReceipt,
  createProjectProcessSourceOwnerQualificationHarness,
  projectProcessSourceActivationGateStatus,
} from '../src/modules/base/owners/project-process-source-owner.mjs';

const WORKSPACE='ws-qualification';

function project(overrides={}) {
  return {
    workspaceId:WORKSPACE,
    projectId:'project-1',
    name:'Canonical rollout',
    domainApplicability:['shared'],
    ...overrides,
  };
}
function work(overrides={}) {
  return {
    workspaceId:WORKSPACE,
    workId:'work-1',
    projectId:'project-1',
    name:'Qualify runtime',
    dependencies:[],
    ...overrides,
  };
}
function definition(overrides={}) {
  return {
    workspaceId:WORKSPACE,
    definitionId:'definition-1',
    versionId:'v1',
    name:'Qualification flow',
    domainApplicability:['shared'],
    activityIds:['inspect'],
    ...overrides,
  };
}
function run(overrides={}) {
  return {
    workspaceId:WORKSPACE,
    runId:'run-1',
    definitionId:'definition-1',
    projectId:'project-1',
    workId:'work-1',
    status:'running',
    ...overrides,
  };
}

test('production Project/Process source owner remains impossible to construct before D4 activation receipt', () => {
  const gateway=new OwnerWriteGateway({adapter:new MemoryCanonicalAdapter()});
  assert.equal(PROJECT_PROCESS_SOURCE_ACTIVATION.writesAuthorized,false);
  assert.equal(PROJECT_PROCESS_SOURCE_ACTIVATION.expectedActivationReceiptSha256,null);
  assert.equal(PROJECT_PROCESS_SOURCE_ACTIVATION.expectedActivationGateSha256,null);
  assert.throws(
    () => new ProjectProcessSourceOwner({gateway,activationReceipt:{receiptSha256:'a'.repeat(64)}}),
    (error) => error?.code === 'PROJECT_PROCESS_SOURCE_WRITE_ACTIVATION_PENDING',
  );
  assert.equal(gateway.owners.registration('iwxa.project'),null);
});

test('isolated qualification harness exercises the adopted Project→Work→Process source writer without persistent activation', async () => {
  const harness=await createProjectProcessSourceOwnerQualificationHarness();
  assert.equal(harness.qualificationOnly,true);
  assert.equal(harness.persistent,false);
  const owner=harness.owner;

  const p1=await owner.create('project',{
    ...project(),
    recordId:'project-1@1',
    knowledgeAt:'2026-09-18T00:00:00Z',
  });
  const p2=await owner.revise('project',{
    ...project({status:'active'}),
    recordId:'project-1@2',
    baseRevisionId:p1.recordId,
    knowledgeAt:'2026-09-18T00:01:00Z',
  });
  const w1=await owner.create('work',{
    ...work(),
    recordId:'work-1@1',
    knowledgeAt:'2026-09-18T00:02:00Z',
  });
  const d1=await owner.create('processDefinition',{
    ...definition(),
    recordId:'definition-1@1',
    knowledgeAt:'2026-09-18T00:03:00Z',
  });
  const r1=await owner.create('processRun',{
    ...run(),
    recordId:'run-1@1',
    knowledgeAt:'2026-09-18T00:04:00Z',
  });
  const c1=await owner.create('case',{
    workspaceId:WORKSPACE,
    caseId:'case-1',
    projectId:'project-1',
    runId:'run-1',
    recordId:'case-1@1',
    knowledgeAt:'2026-09-18T00:05:00Z',
  });
  const a1=await owner.create('activity',{
    workspaceId:WORKSPACE,
    activityId:'activity-1',
    runId:'run-1',
    caseId:'case-1',
    definitionActivityId:'inspect',
    recordId:'activity-1@1',
    knowledgeAt:'2026-09-18T00:06:00Z',
  });
  const e1=await owner.create('event',{
    workspaceId:WORKSPACE,
    eventId:'event-1',
    runId:'run-1',
    caseId:'case-1',
    activityId:'activity-1',
    eventType:'observed',
    occurredAt:'2026-09-18T00:06:30Z',
    evidenceRefs:['evidence:event-1'],
    recordId:'event-1@1',
    knowledgeAt:'2026-09-18T00:07:00Z',
  });
  const dec1=await owner.create('decision',{
    workspaceId:WORKSPACE,
    decisionId:'decision-1',
    runId:'run-1',
    caseId:'case-1',
    decisionType:'gate',
    outcome:{pass:true},
    evidenceRefs:['evidence:decision-1'],
    decidedAt:'2026-09-18T00:07:30Z',
    recordId:'decision-1@1',
    knowledgeAt:'2026-09-18T00:08:00Z',
  });

  assert.equal(p1.ownerId,'iwxa.project-process.owner');
  assert.equal(p2.previousRevisionId,p1.recordId);
  assert.equal(w1.refs.canonicalHeads.project.recordId,p2.recordId);
  assert.equal(r1.refs.canonicalHeads.definition.recordId,d1.recordId);
  assert.equal(r1.refs.canonicalHeads.work.recordId,w1.recordId);
  assert.equal(c1.refs.canonicalHeads.run.recordId,r1.recordId);
  assert.equal(a1.refs.canonicalHeads.case.recordId,c1.recordId);
  assert.equal(e1.refs.canonicalHeads.activity.recordId,a1.recordId);
  assert.equal(dec1.refs.canonicalHeads.case.recordId,c1.recordId);

  const loaded=await owner.load('project',WORKSPACE,'project-1');
  assert.equal(loaded.baseRevisionId,p2.recordId);
  assert.equal(loaded.value.status,'active');

  await assert.rejects(
    owner.create('result',{
      workspaceId:WORKSPACE,
      resultId:'result-1',
      projectId:'project-1',
      workId:'work-1',
      resultType:'artifact',
      evidenceRefs:['evidence:result-1'],
      recordId:'result-1@1',
      knowledgeAt:'2026-09-18T00:09:00Z',
    }),
    (error) => error?.code === 'PROJECT_PROCESS_FAMILY_OUTSIDE_APPROVED_SCOPE',
  );

  const audit=await owner.audit();
  assert.equal(audit.length,9);
  assert.equal(audit.every((entry) => entry.ownerId === 'iwxa.project-process.owner'),true);
});

test('activation configuration remains atomically fail-closed before D4 receipt binding', () => {
  assert.equal(assertProjectProcessSourceActivationConfiguration(),true);
  assert.equal(PROJECT_PROCESS_SOURCE_ACTIVATION.commonResultAcceptanceWrites,'FORBIDDEN');
  assert.deepEqual(PROJECT_PROCESS_SOURCE_ACTIVATION.sourceKinds,['project','work','processDefinition','processRun','case','decision','activity','event']);
});

test('activation configuration refuses partial active state and Result/Acceptance common writes', () => {
  const partial={...PROJECT_PROCESS_SOURCE_ACTIVATION,status:'ACTIVATED_EXACT_RECEIPT_BOUND',writesAuthorized:true,expectedActivationReceiptSha256:null};
  assert.throws(()=>assertProjectProcessSourceActivationConfiguration(partial),(e)=>e instanceof ProjectProcessSourceOwnerError&&e.code==='PROJECT_PROCESS_SOURCE_ACTIVE_ACTIVATION_CONFIG_INVALID');
  const common={...PROJECT_PROCESS_SOURCE_ACTIVATION,commonResultAcceptanceWrites:'ALLOWED'};
  assert.throws(()=>assertProjectProcessSourceActivationConfiguration(common),(e)=>e instanceof ProjectProcessSourceOwnerError&&e.code==='PROJECT_PROCESS_SOURCE_COMMON_RESULT_ACCEPTANCE_WRITES_FORBIDDEN');
});

test('future active configuration requires exact receipt SHA, exact gate SHA, and exact source scope', () => {
  const partial={...PROJECT_PROCESS_SOURCE_ACTIVATION,status:'ACTIVATED_EXACT_RECEIPT_BOUND',writesAuthorized:true,expectedActivationReceiptSha256:'a'.repeat(64),expectedActivationGateSha256:null};
  assert.throws(()=>assertProjectProcessSourceActivationConfiguration(partial),(e)=>e instanceof ProjectProcessSourceOwnerError&&e.code==='PROJECT_PROCESS_SOURCE_ACTIVE_ACTIVATION_CONFIG_INVALID');
  const ok={...partial,expectedActivationGateSha256:'b'.repeat(64)};
  assert.equal(assertProjectProcessSourceActivationConfiguration(ok),true);
  const badScope={...ok,sourceKinds:[...ok.sourceKinds,'result']};
  assert.throws(()=>assertProjectProcessSourceActivationConfiguration(badScope),(e)=>e instanceof ProjectProcessSourceOwnerError&&e.code==='PROJECT_PROCESS_SOURCE_ACTIVATION_SCOPE_INVALID');
});

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const keys=Object.keys(value).sort();
  return `{${keys.map((key)=>`${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function activationGateSha256ForReceipt(receipt) {
  const gate={
    schema:'IWXA_T2_C3_PROJECT_PROCESS_SOURCE_ACTIVATION_GATE_V1',
    status:'ACTIVATED_EXACT_RECEIPT_BOUND',
    writesAuthorized:true,
    expectedActivationReceiptSha256:receipt.receiptSha256,
    qualificationHarnessPersistent:false,
    sourceKinds:['project','work','processDefinition','processRun','case','decision','activity','event'],
    commonResultAcceptanceWrites:'FORBIDDEN',
  };
  return createHash('sha256').update(stableJson(gate)).digest('hex');
}

function currentActivationReceipt() {
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
    bindingEffect:{
      writesAuthorizedNow:false,
      qualificationHarnessPersistent:false,
      commonResultAcceptanceWrites:'FORBIDDEN',
    },
    invalidationRule:'Any bound current-subject identity change invalidates this receipt.',
  };
  return {...body,receiptSha256:createHash('sha256').update(stableJson(body)).digest('hex')};
}

test('exact current activation receipt validates only against exact canonical active binding', () => {
  const receipt=currentActivationReceipt();
  const active={
    ...PROJECT_PROCESS_SOURCE_ACTIVATION,
    status:'ACTIVATED_EXACT_RECEIPT_BOUND',
    writesAuthorized:true,
    expectedActivationReceiptSha256:receipt.receiptSha256,
    expectedActivationGateSha256:activationGateSha256ForReceipt(receipt),
  };
  assert.equal(assertProjectProcessSourceActivationReceipt(receipt,active),receipt.receiptSha256);

  const mismatched={...active,expectedActivationReceiptSha256:'c'.repeat(64)};
  assert.throws(
    ()=>assertProjectProcessSourceActivationReceipt(receipt,mismatched),
    (e)=>e instanceof ProjectProcessSourceOwnerError&&e.code==='PROJECT_PROCESS_SOURCE_ACTIVATION_RECEIPT_MISMATCH',
  );
});

test('source owner emits one self-hashed activation gate only after exact receipt validation', () => {
  const receipt=currentActivationReceipt();
  const active={
    ...PROJECT_PROCESS_SOURCE_ACTIVATION,
    status:'ACTIVATED_EXACT_RECEIPT_BOUND',
    writesAuthorized:true,
    expectedActivationReceiptSha256:receipt.receiptSha256,
    expectedActivationGateSha256:activationGateSha256ForReceipt(receipt),
  };
  const gate=projectProcessSourceActivationGateStatus({activationReceipt:receipt,config:active});
  assert.equal(gate.schema,'IWXA_T2_C3_PROJECT_PROCESS_SOURCE_ACTIVATION_GATE_V1');
  assert.equal(gate.status,'ACTIVATED_EXACT_RECEIPT_BOUND');
  assert.equal(gate.writesAuthorized,true);
  assert.equal(gate.expectedActivationReceiptSha256,receipt.receiptSha256);
  assert.equal(gate.qualificationHarnessPersistent,false);
  assert.deepEqual(gate.sourceKinds,['project','work','processDefinition','processRun','case','decision','activity','event']);
  assert.equal(gate.commonResultAcceptanceWrites,'FORBIDDEN');
  const {gateSha256,...body}=gate;
  assert.equal(gateSha256,createHash('sha256').update(stableJson(body)).digest('hex'));
});

test('forged current activation receipt self-hash is rejected', () => {
  const receipt=currentActivationReceipt();
  receipt.productGraphSha256='d'.repeat(64);
  const active={
    ...PROJECT_PROCESS_SOURCE_ACTIVATION,
    status:'ACTIVATED_EXACT_RECEIPT_BOUND',
    writesAuthorized:true,
    expectedActivationReceiptSha256:receipt.receiptSha256,
    expectedActivationGateSha256:activationGateSha256ForReceipt(receipt),
  };
  assert.throws(
    ()=>assertProjectProcessSourceActivationReceipt(receipt,active),
    (e)=>e instanceof ProjectProcessSourceOwnerError&&e.code==='PROJECT_PROCESS_SOURCE_ACTIVATION_RECEIPT_SELF_HASH_MISMATCH',
  );
});

test('caller cannot activate production owner while canonical activation config remains pending', () => {
  const receipt=currentActivationReceipt();
  const gateway=new OwnerWriteGateway({adapter:new MemoryCanonicalAdapter()});
  assert.throws(
    ()=>new ProjectProcessSourceOwner({gateway,activationReceipt:receipt}),
    (e)=>e instanceof ProjectProcessSourceOwnerError&&e.code==='PROJECT_PROCESS_SOURCE_WRITE_ACTIVATION_PENDING',
  );
  assert.equal(gateway.owners.registration('iwxa.project'),null);
});

test('activation gate is rejected when canonical gate trust anchor differs', () => {
  const receipt=currentActivationReceipt();
  const active={
    ...PROJECT_PROCESS_SOURCE_ACTIVATION,
    status:'ACTIVATED_EXACT_RECEIPT_BOUND',
    writesAuthorized:true,
    expectedActivationReceiptSha256:receipt.receiptSha256,
    expectedActivationGateSha256:'e'.repeat(64),
  };
  assert.throws(
    ()=>projectProcessSourceActivationGateStatus({activationReceipt:receipt,config:active}),
    (e)=>e instanceof ProjectProcessSourceOwnerError&&e.code==='PROJECT_PROCESS_SOURCE_ACTIVATION_GATE_MISMATCH',
  );
});


test('C3 qualification owner registration rejects same-owner command supersets', async () => {
  const gateway=new OwnerWriteGateway({adapter:new MemoryCanonicalAdapter()});
  gateway.registerOwner({
    family:'iwxa.project',
    ownerId:'iwxa.project-process.owner',
    commands:['project.create','project.revise','project.release','project.unapproved-extra'],
    headKind:'source',
  });
  await assert.rejects(
    createProjectProcessSourceOwnerQualificationHarness({gateway}),
    (error) => error instanceof ProjectProcessSourceOwnerError
      && error.code === 'INCOMPATIBLE_PROJECT_PROCESS_SOURCE_OWNER',
  );
});
