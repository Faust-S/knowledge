import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {BASE_KERNEL_ARTIFACT,CANDIDATE_KERNEL_ARTIFACT,selectQualificationKernelCandidate,
  assertQualificationKernelCandidate,qualificationKernelCandidateFields} from '../scripts/installed-kernel-candidate.mjs';

const center={GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',GITHUB_REPOSITORY:'Faust-S/Center',
  GITHUB_REF:'refs/heads/work/2026-11-24-corporate-installed-one-core'};
const knowledge={...center,GITHUB_REPOSITORY:'Faust-S/knowledge',
  GITHUB_REF:'refs/heads/work/2026-11-25-k036-corporate-event-qualification'};

test('no implicit candidate even inside the authorized build context',()=>{
  assert.equal(selectQualificationKernelCandidate(undefined,center),null);
  assert.equal(selectQualificationKernelCandidate(undefined,{}),null);
});
test('only the exact candidate ID can be requested',()=>{
  for(const bad of [null,'',true,BASE_KERNEL_ARTIFACT,CANDIDATE_KERNEL_ARTIFACT+'-other'])
    assert.throws(()=>selectQualificationKernelCandidate(bad,center),/ID_INVALID/);
});
test('candidate pin is immutable and unaccepted in exact authorized public contexts',()=>{
  const a=selectQualificationKernelCandidate(CANDIDATE_KERNEL_ARTIFACT,center);
  assert.equal(a,selectQualificationKernelCandidate(CANDIDATE_KERNEL_ARTIFACT,knowledge));
  assert.equal(a,selectQualificationKernelCandidate(CANDIDATE_KERNEL_ARTIFACT,{
    ...center,GITHUB_REF:'refs/heads/work/2026-11-27-t4-native-pilot-k036'}));
  assert.equal(a.baseQualifiedArtifactId,BASE_KERNEL_ARTIFACT);
  assert.equal(a.releaseAccepted,false);
  assert.equal(a.productionActivation,false);
  assert.equal(a.files.length,4);
  assert.equal(a.archiveSha256.length,64);
  assert.throws(()=>{a.releaseAccepted=true;},TypeError);
  assert.throws(()=>{a.files[0].sha256='fake';},TypeError);
  assert.throws(()=>a.files.push({}),TypeError);
});
test('private, local, non-disposable and wrong-branch builds reject candidate use',()=>{
  for(const bad of [{},{...center,GITHUB_ACTIONS:'false'}, {...center,RUNNER_ENVIRONMENT:'self-hosted'},
    {...center,GITHUB_REPOSITORY:'Faust-S/T2'},{...center,GITHUB_REPOSITORY:'Faust-S/T3'},
    {...center,GITHUB_REF:'refs/heads/main'},{...knowledge,GITHUB_REF:'refs/heads/main'},
    {...center,GITHUB_REF:'refs/heads/work/2026-11-27-t4-native-pilot-k036-other'}])
    assert.throws(()=>selectQualificationKernelCandidate(CANDIDATE_KERNEL_ARTIFACT,bad),/DISPOSABLE_PUBLIC_QUALIFICATION_REQUIRED/);
});
test('candidate receipt fields never claim qualified-release acceptance',()=>{
  const pin=selectQualificationKernelCandidate(CANDIDATE_KERNEL_ARTIFACT,center);
  assert.deepEqual(qualificationKernelCandidateFields(pin),{
    original_kernel_candidate_artifact:CANDIDATE_KERNEL_ARTIFACT,
    original_kernel_candidate_archive_sha256:pin.archiveSha256,original_kernel_release_accepted:false});
  assert.deepEqual(qualificationKernelCandidateFields(null),{});
  assert.deepEqual(qualificationKernelCandidateFields({releaseAccepted:true}),{});
});
test('missing or fabricated files cannot be admitted even on the allowed runner',()=>{
  const saved=Object.fromEntries(Object.keys(center).map(k=>[k,process.env[k]]));
  const root=mkdtempSync(join(tmpdir(),'iwxa-candidate-pin-'));
  try{
    Object.assign(process.env,center);
    const pin=selectQualificationKernelCandidate(CANDIDATE_KERNEL_ARTIFACT);
    assert.throws(()=>assertQualificationKernelCandidate(root,undefined),/EXPLICIT_SELECTION_REQUIRED/);
    assert.throws(()=>assertQualificationKernelCandidate(root,CANDIDATE_KERNEL_ARTIFACT),/FILE_PATH_INVALID/);
    for(const row of pin.files){const p=join(root,row.path);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,'fabricated');}
    assert.throws(()=>assertQualificationKernelCandidate(root,CANDIDATE_KERNEL_ARTIFACT),/FILE_DIGEST_MISMATCH/);
  }finally{
    for(const [k,v] of Object.entries(saved))v===undefined?delete process.env[k]:process.env[k]=v;
    rmSync(root,{recursive:true,force:true});
  }
});
