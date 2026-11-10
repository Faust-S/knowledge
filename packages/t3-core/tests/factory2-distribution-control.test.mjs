import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeFactory2LocalPipelineReceipt} from '../scripts/run-factory2-local-pipeline.mjs';
import {
  validateFactory2DistributionCandidate,
  validateFactory2CompatibilityManifest,
  validateFactory2ToolchainManifest,
} from '../src/factory2/distribution/distribution-control.mjs';

const product=(name)=>JSON.parse(readFileSync(new URL('../../product/'+name,import.meta.url),'utf8'));

test('Factory 2 distribution candidate preserves exact six-product plane and canonical artifact identity',()=>{
  const x=validateFactory2DistributionCandidate(product('FACTORY2_DISTRIBUTION_MANIFEST_CANDIDATE_2026-09-24.json'));
  assert.equal(x.products.length,6);
  assert.equal(x.artifactName,'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2.1.zip');
  assert.equal(x.factoryVersion,'2.1.0');
  assert.equal(x.releaseReady,false);
});
test('Factory 2 compatibility manifest binds K035, Runtime 1.2 and dedicated Studio route',()=>{
  const x=validateFactory2CompatibilityManifest(product('FACTORY2_CONTRACT_VERSION_COMPATIBILITY_MANIFEST_2026-09-24.json'));
  assert.equal(x.bindings.kernelTarget,'0.3.5');
  assert.equal(x.bindings.runtimeContract,'1.2.0');
  assert.equal(x.surfaces.studioRoute,'/workspace/studio/');
});
test('Factory 2 toolchain is local-first and does not require GitHub Actions',()=>{
  const x=validateFactory2ToolchainManifest(product('FACTORY2_ENVIRONMENT_TOOLCHAIN_MANIFEST_2026-09-24.json'));
  assert.equal(x.node,'24.18.1');
  assert.equal(x.npm,'11.16.0');
  assert.equal(x.githubActionsRequired,false);
});

test('Factory 2 distribution rejects regression to reference-only payload',()=>{const x=product('FACTORY2_DISTRIBUTION_MANIFEST_CANDIDATE_2026-09-24.json');x.payloadMode='REFERENCE_ONLY';assert.throws(()=>validateFactory2DistributionCandidate(x),/self-contained/i);});
test('Factory 2 distribution rejects predecessor archive identity',()=>{const x=product('FACTORY2_DISTRIBUTION_MANIFEST_CANDIDATE_2026-09-24.json');x.artifactName='IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2.zip';assert.throws(()=>validateFactory2DistributionCandidate(x),/identity mismatch/i);});
test('Factory 2 pipeline receipt emits only the 2.1 release archive name',()=>{
  const head='a'.repeat(40),artifactSha256='b'.repeat(64);
  const receipt=makeFactory2LocalPipelineReceipt({
    expectedHead:head,
    verification:{status:'PASS',sourceCommitSha:head,sourceTreeSha:'c'.repeat(40)},
    preseal:{status:'PASS_PRESEAL_TECHNICAL_EVIDENCE',sourceCommitSha:head},
    staging:{status:'PASS',sourceCommitSha:head},
    zipReceipt:{status:'PASS',artifactName:'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2.1.zip',sha256:artifactSha256,bytes:123},
    freshExtract:{status:'PASS'},
    readiness:{status:'TECHNICAL_SUBJECT_BOUND_OWNER_DECISIONS_PENDING',subject:{sourceCommitSha:head,artifactSha256},subjectSha256:'d'.repeat(64)},
    outputRoot:'qualification',
  });
  assert.equal(receipt.artifact.name,'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2.1.zip');
  assert.notEqual(receipt.artifact.name,'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2.zip');
  assert.equal(receipt.factoryId,'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2');
  assert.equal(receipt.generation,2);
  assert.throws(()=>makeFactory2LocalPipelineReceipt({
    expectedHead:head,
    verification:{status:'PASS',sourceCommitSha:head,sourceTreeSha:'c'.repeat(40)},
    preseal:{status:'PASS_PRESEAL_TECHNICAL_EVIDENCE',sourceCommitSha:head},
    staging:{status:'PASS',sourceCommitSha:head},
    zipReceipt:{status:'PASS',artifactName:'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2.zip',sha256:artifactSha256,bytes:123},
    freshExtract:{status:'PASS'},
    readiness:{status:'TECHNICAL_SUBJECT_BOUND_OWNER_DECISIONS_PENDING',subject:{sourceCommitSha:head,artifactSha256},subjectSha256:'d'.repeat(64)},
    outputRoot:'qualification',
  }),/PACKAGE_INVALID/);
});
