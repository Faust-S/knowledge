import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FACTORY2_CONTROL_PLANE} from '../src/modules/base/features/factory2/factory2-completeness.mjs';

const mapping=()=>JSON.parse(readFileSync(new URL('../../product/FACTORY2_CONTROL_PLANE_SUCCESSOR_MAP_2026-09-24.json',import.meta.url),'utf8'));

test('Factory 2 control-plane successor map covers the exact ten-element predecessor set',()=>{
  const x=mapping();
  assert.equal(x.kernelTarget,'0.3.5');
  assert.deepEqual(x.elements.map(e=>e.id).sort(),[...FACTORY2_CONTROL_PLANE].sort());
  assert.equal(new Set(x.elements.map(e=>e.id)).size,FACTORY2_CONTROL_PLANE.length);
});

test('predecessor approvals and locks are explicitly non-transferable to Factory 2',()=>{
  const x=mapping();
  assert.equal(x.authorityTransferPolicy.predecessorOwnerApprovalTransferAllowed,false);
  assert.equal(x.authorityTransferPolicy.predecessorLockTransferAllowed,false);
  assert.equal(x.authorityTransferPolicy.syntheticOwnerApprovalAllowed,false);
  assert.equal(x.authorityTransferPolicy.genericResultAcceptanceWriteAllowed,false);
});

test('P7 now has an explicit Generation 2 mapping without claiming successor authorization',()=>{
  const p7=mapping().elements.find(e=>e.id==='p7');
  assert.equal(p7.disposition,'SUPERSEDED');
  assert.equal(p7.mappingStatus,'MAPPED_IMPLEMENTATION_OPEN');
  assert.match(p7.remaining,/authorization remains blocked on current release-lock\/freeze\/P6 closure/i);
});
