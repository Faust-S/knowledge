import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  validateFactory2ControlPlaneSuccessorMap,
  evaluateFactory2ControlPlane,
  Factory2ControlPlaneError,
} from '../src/factory2/control-plane/control-plane.mjs';

const source=()=>JSON.parse(readFileSync(new URL('../../product/FACTORY2_CONTROL_PLANE_SUCCESSOR_MAP_2026-09-24.json',import.meta.url),'utf8'));

test('Factory 2 control-plane map validates as exact, fail-closed Generation 2 input',()=>{
  const x=validateFactory2ControlPlaneSuccessorMap(source());
  assert.equal(x.elements.length,10);
  assert.equal(x.kernelTarget,'0.3.5');
  assert.equal(x.authorityTransferPolicy.predecessorOwnerApprovalTransferAllowed,false);
});

test('current control-plane remains open while successor locks/materializations are pending',()=>{
  const result=evaluateFactory2ControlPlane(source());
  assert.equal(result.status,'FACTORY2_CONTROL_PLANE_OPEN');
  assert.equal(result.complete,false);
  assert.ok(result.pending.includes('common-release-lock'));
  assert.ok(result.pending.includes('common-freeze'));
  assert.equal(result.predecessorAuthorityTransferAllowed,false);
});

test('attempting to transfer predecessor Owner approval is rejected',()=>{
  const x=source();
  x.authorityTransferPolicy.predecessorOwnerApprovalTransferAllowed=true;
  assert.throws(
    ()=>validateFactory2ControlPlaneSuccessorMap(x),
    (e)=>e instanceof Factory2ControlPlaneError&&e.code==='FACTORY2_CONTROL_PLANE_AUTHORITY_TRANSFER_FORBIDDEN',
  );
});
