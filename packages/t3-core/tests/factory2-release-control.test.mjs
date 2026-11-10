import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  validateFactory2ReleaseLockCandidate,
  validateFactory2FreezeCandidate,
  validateFactory2P6Successor,
  validateFactory2P7Successor,
  Factory2ReleaseControlError,
} from '../src/factory2/control-plane/release-control.mjs';

const product=(name)=>JSON.parse(readFileSync(new URL('../../product/'+name,import.meta.url),'utf8'));

test('Factory 2 release lock exists only as a fail-closed unapproved candidate',()=>{
  const x=validateFactory2ReleaseLockCandidate(product('FACTORY2_COMMON_RELEASE_LOCK_CANDIDATE_2026-09-24.json'));
  assert.equal(x.status,'CANDIDATE_MATERIALIZED_NOT_APPROVED_NOT_LOCKED');
  assert.equal(x.effects.releaseLockIssued,false);
});
test('Factory 2 common freeze candidate cannot issue before a current release lock',()=>{
  const x=validateFactory2FreezeCandidate(product('FACTORY2_COMMON_FREEZE_CANDIDATE_2026-09-24.json'));
  assert.equal(x.prerequisiteReleaseLock.satisfied,false);
  assert.equal(x.effects.commonFreezeIssued,false);
});
test('Factory 2 P6/P7 successors are materialized without inherited authorization',()=>{
  const p6=validateFactory2P6Successor(product('FACTORY2_P6_SUCCESSOR_2026-09-24.json'));
  const p7=validateFactory2P7Successor(product('FACTORY2_P7_SUCCESSOR_2026-09-24.json'));
  assert.equal(p6.p6Authorized,false);
  assert.equal(p7.p7Authorized,false);
  assert.equal(p7.factoryAcceptanceGranted,false);
});
test('a synthetic release-lock approval is rejected',()=>{
  const x=product('FACTORY2_COMMON_RELEASE_LOCK_CANDIDATE_2026-09-24.json');
  x.approvalGranted=true;
  assert.throws(()=>validateFactory2ReleaseLockCandidate(x),(e)=>e instanceof Factory2ReleaseControlError&&e.code==='FACTORY2_RELEASE_LOCK_AUTHORITY_INVALID');
});
