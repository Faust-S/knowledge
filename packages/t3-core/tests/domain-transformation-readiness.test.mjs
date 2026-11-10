import test from 'node:test';
import assert from 'node:assert/strict';
import {
  domainTransformationReadiness,
  listDomainTransformationReadiness,
} from '../src/modules/base/features/domain-transformation/index.mjs';

test('domain transformation readiness covers all twelve current T2 domains',()=>{
  const rows=listDomainTransformationReadiness();
  assert.equal(rows.length,12);
  assert.deepEqual(rows.map((row)=>row.domainId),[
    'D01','D02','D03','D04','D05','D06','D07','D08','D09','D10','D11','D12',
  ]);
  assert.ok(rows.every((row)=>row.transformationPlanningAllowed===true));
  assert.ok(rows.every((row)=>row.productionActivation===false));
});

test('D01 remains Owner-pending while D10 reflects the accepted Owner authority decision',()=>{
  const d01=domainTransformationReadiness('D01');
  const d10=domainTransformationReadiness('d10');
  assert.equal(d01.productName,'Learn');
  assert.equal(d10.productName,'ArtBazi');
  assert.equal(d01.ownerDecisionRequired,true);
  assert.equal(d01.persistentResultBindingAllowed,false);
  assert.equal(d10.ownerDecisionRequired,false);
  assert.equal(d10.persistentResultBindingAllowed,true);
  assert.equal(d10.authorityStatus,'AUTHORITY_BOUND_PRODUCT_LOGIC');
});

test('D12 IWXA Main keeps persistent native Result use case open',()=>{
  const d12=domainTransformationReadiness('D12');
  assert.equal(d12.productName,'IWXA Main');
  assert.equal(d12.persistentResultUseCaseOpen,true);
  assert.equal(d12.persistentResultBindingAllowed,false);
});

test('resolved domains expose authority-bound product logic without production activation',()=>{
  for(const id of ['D02','D03','D04','D05','D06','D07','D08','D09','D10','D11']){
    const row=domainTransformationReadiness(id);
    assert.equal(row.authorityStatus,'AUTHORITY_BOUND_PRODUCT_LOGIC');
    assert.equal(row.persistentResultBindingAllowed,true);
    assert.equal(row.productionActivation,false);
  }
});

test('program roles keep D01 as primary pilot, D10 as complex pilot and D12 as public information surface',()=>{
  const d01=domainTransformationReadiness('D01');
  const d10=domainTransformationReadiness('D10');
  const d12=domainTransformationReadiness('D12');
  assert.equal(d01.programRole,'PRIMARY_T2_TRANSFORMATION_PILOT');
  assert.equal(d01.transformationMode,'FULL_DOMAIN_TRANSFORMATION');
  assert.equal(d01.serviceRootAuthorityStatus,'RESOLVED_BY_OD_W07_LEARN');
  assert.equal(d01.persistentResultOwnerDecisionRequired,true);

  assert.equal(d10.programRole,'SECONDARY_COMPLEX_TRANSFORMATION_PILOT');
  assert.equal(d10.transformationMode,'FULL_DOMAIN_TRANSFORMATION');
  assert.equal(d10.persistentResultOwnerDecisionRequired,false);
  assert.equal(d10.serviceRootAuthorityStatus,'OWNER_APPROVED_D10_CANONICAL_AUTHORITY_CORE');

  assert.equal(d12.programRole,'PUBLIC_INFORMATION_SURFACE');
  assert.equal(d12.transformationMode,'PUBLIC_SURFACE_ASSESSMENT_ONLY');
  assert.equal(d12.persistentResultUseCaseOpen,true);
});
