import test from 'node:test';
import assert from 'node:assert/strict';
import {makeFactory2LocalPipelineReceipt} from '../scripts/run-factory2-local-pipeline.mjs';

const head='a'.repeat(40);
const verification={status:'PASS',sourceCommitSha:head,sourceTreeSha:'b'.repeat(40)};
const preseal={status:'PASS_PRESEAL_TECHNICAL_EVIDENCE',sourceCommitSha:head};
const staging={status:'PASS',sourceCommitSha:head};
const zipReceipt={status:'PASS',artifactName:'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2.1.zip',sha256:'c'.repeat(64),bytes:123};
const freshExtract={status:'PASS'};
const readiness={
  status:'TECHNICAL_SUBJECT_BOUND_OWNER_DECISIONS_PENDING',
  subjectSha256:'d'.repeat(64),
  subject:{sourceCommitSha:head,artifactSha256:'c'.repeat(64)},
};

test('Factory 2 local pipeline receipt binds all technical outputs while retaining Owner decision boundary',()=>{
  const r=makeFactory2LocalPipelineReceipt({expectedHead:head,verification,preseal,staging,zipReceipt,freshExtract,readiness,outputRoot:'factory2-output'});
  assert.equal(r.status,'PASS_TECHNICAL_PIPELINE_OWNER_DECISIONS_PENDING');
  assert.equal(r.artifact.sha256,'c'.repeat(64));
  assert.equal(r.factoryAcceptanceGranted,false);
  assert.equal(r.ownerApprovalGranted,false);
  assert.equal(r.productionActivation,false);
});
