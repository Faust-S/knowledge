import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
  CURRENT_BRANCH,
  CURRENT_REPOSITORY,
  CURRENT_REMOTE,
  CURRENT_REMOTE_URL,
  LIVE_HEAD_EVIDENCE_MAX_AGE_MS,
  assertCurrentLiveHead,
  assertCurrentLiveHeadEvidenceIdentity,
  gitArgsForWorktree,
  makeCurrentLiveHeadEvidence,
  runNpmCiOnlyAfterLiveHead,
} from '../scripts/current-live-head.mjs';

const HEAD='a'.repeat(40);
const STALE='b'.repeat(40);
const TREE='c'.repeat(40);
const FETCHED_AT='2026-09-23T10:00:00.000Z';
const NOW=Date.parse(FETCHED_AT);
const COMMON_GIT_DIR=tmpdir();

function evidence(overrides={}){
  return makeCurrentLiveHeadEvidence({
    remoteHead:HEAD,
    remoteTree:TREE,
    commonGitDir:COMMON_GIT_DIR,
    fetchedAt:FETCHED_AT,
    ...overrides,
  });
}

function verify(overrides={}){
  return assertCurrentLiveHeadEvidenceIdentity({
    localHead:HEAD,
    localTree:TREE,
    trackingHead:HEAD,
    trackingTree:TREE,
    expectedHead:HEAD,
    evidence:evidence(),
    commonGitDir:COMMON_GIT_DIR,
    now:NOW,
    ...overrides,
  });
}

test('fresh fetch evidence passes only when local, tracking, expected and remote identities agree',()=>{
  const result=verify();
  assert.equal(result.status,'PASS');
  assert.equal(result.branch,CURRENT_BRANCH);
  assert.equal(result.repository,CURRENT_REPOSITORY);
  assert.equal(result.remoteName,CURRENT_REMOTE);
  assert.equal(result.remoteUrl,CURRENT_REMOTE_URL);
  assert.equal(result.localHead,HEAD);
  assert.equal(result.remoteHead,HEAD);
  assert.equal(result.tree,TREE);
});

test('stale detached local HEAD is rejected against freshly fetched remote evidence',()=>{
  assert.throws(()=>verify({localHead:STALE}),/CURRENT_LIVE_HEAD_LOCAL_STALE/);
});

test('expected HEAD must equal the remotely fetched branch head',()=>{
  assert.throws(()=>verify({expectedHead:STALE}),/CURRENT_LIVE_HEAD_EXPECTED_MISMATCH/);
});

test('malformed expected SHA is rejected',()=>{
  assert.throws(()=>verify({expectedHead:'not-a-sha'}),/CURRENT_LIVE_HEAD_INVALID_EXPECTED_HEAD/);
});

test('evidence from another branch is rejected',()=>{
  assert.throws(
    ()=>verify({evidence:evidence({branch:'agent/other-branch'})}),
    /CURRENT_LIVE_HEAD_BRANCH_MISMATCH/,
  );
});

test('stale fetch evidence is rejected even when local and remote-tracking heads agree',()=>{
  assert.throws(
    ()=>verify({evidence:evidence({fetchedAt:new Date(NOW-LIVE_HEAD_EVIDENCE_MAX_AGE_MS-1).toISOString()})}),
    /CURRENT_LIVE_HEAD_EVIDENCE_STALE/,
  );
});

test('tracking refs must match the fetch evidence instead of serving as proof by themselves',()=>{
  assert.throws(()=>verify({trackingHead:STALE}),/CURRENT_LIVE_HEAD_TRACKING_REF_MISMATCH/);
});

test('assert:live verifies fresh local evidence offline and performs no network fetch',()=>{
  const cwd=mkdtempSync(join(tmpdir(),'t2-current-live-offline-'));
  const evidencePath=join(cwd,'fetch-evidence.json');
  const calls=[];
  writeFileSync(evidencePath,`${JSON.stringify(evidence())}\n`,'utf8');
  const gitRunner=(args)=>{
    calls.push(args);
    if(args[0]==='remote') return CURRENT_REMOTE_URL;
    if(args[0]==='rev-parse'&&args[1]==='--git-common-dir') return COMMON_GIT_DIR;
    if(args[0]==='rev-parse'&&args[1]==='HEAD') return HEAD;
    if(args[0]==='rev-parse'&&args[1]==='HEAD^{tree}') return TREE;
    if(args[0]==='rev-parse'&&args[1]===`refs/remotes/${CURRENT_REMOTE}/${CURRENT_BRANCH}`) return HEAD;
    if(args[0]==='rev-parse'&&args[1]===`${HEAD}^{tree}`) return TREE;
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  };
  try{
    const result=assertCurrentLiveHead({cwd,expectedHead:HEAD,evidencePath,now:NOW,gitRunner});
    assert.equal(result.status,'PASS');
    assert.equal(calls.some((args)=>args.includes('fetch')),false);
  }finally{rmSync(cwd,{recursive:true,force:true});}
});

test('Git ownership trust is scoped to one exact worktree path and never uses a wildcard',()=>{
  const path='C:\\IWXA-Codex\\T2\\current-verification';
  const args=gitArgsForWorktree(path,['status','--porcelain']);
  assert.deepEqual(args.slice(0,2),['-c',`safe.directory=${path}`]);
  assert.equal(args.some((arg)=>arg.includes('*')),false);
});

test('verify:current cannot begin npm ci if current-head evidence fails',()=>{
  let npmCiStarted=false;
  assert.throws(
    ()=>runNpmCiOnlyAfterLiveHead({
      verifyLiveHead:()=>{throw new Error('CURRENT_LIVE_HEAD_EVIDENCE_STALE');},
      runNpmCi:()=>{npmCiStarted=true;},
    }),
    /CURRENT_LIVE_HEAD_EVIDENCE_STALE/,
  );
  assert.equal(npmCiStarted,false);
});
