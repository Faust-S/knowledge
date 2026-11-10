import test from 'node:test';
import assert from 'node:assert/strict';
import {FACTORY2_PRODUCT_SEAL_SPECS} from '../scripts/factory2-product-seal.mjs';
import {buildFactory2EngineeringBootstrap,Factory2EngineeringBootstrapError} from '../src/factory2/products/domain-engineering/engineering-bootstrap.mjs';

test('Factory 2 deterministic seal specs cover all four incomplete Generation 2 product successors',()=>{
  const ids=Object.keys(FACTORY2_PRODUCT_SEAL_SPECS).sort();
  assert.deepEqual(ids,['common-modules','domain-engineering','domain-keys','domain-studio']);
});
test('Domain Engineering bootstrap is owner-source-bound and proposal-only',()=>{
  const x=buildFactory2EngineeringBootstrap({
    domainId:'NEUTRAL',
    sourceOrigin:'OWNER_SUPPLIED_AT_TEST_TIME',
    sourceSha256:'a'.repeat(64),
    genericWriteAuthority:false,
    ownerApprovalGranted:false,
    productionActivation:false,
  });
  assert.equal(x.candidateOutputRole,'PROPOSAL_ONLY_UNTIL_HUMAN_REVIEW');
  assert.equal(x.studioRoute,'/workspace/studio/');
  assert.equal(x.productionActivation,false);
});
test('Domain Engineering bootstrap rejects historical domain source substitution',()=>{
  assert.throws(()=>buildFactory2EngineeringBootstrap({
    domainId:'D01',
    sourceOrigin:'HISTORICAL_DOMAIN_RUN',
    sourceSha256:'b'.repeat(64),
    genericWriteAuthority:false,
    ownerApprovalGranted:false,
    productionActivation:false,
  }),(e)=>e instanceof Factory2EngineeringBootstrapError&&e.code==='FACTORY2_ENGINEERING_BOOTSTRAP_SOURCE_REQUIRED');
});
