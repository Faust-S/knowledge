import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runFactory2NeutralAcceptanceCase,Factory2NeutralAcceptanceError} from '../src/factory2/acceptance/neutral-factory-acceptance.mjs';
import {
  validateFactory2DomainRunBootstrapTemplate,
  prepareFactory2DomainRun,
  Factory2DomainRunBootstrapError,
} from '../src/factory2/acceptance/domain-run-bootstrap.mjs';

const product=(name)=>JSON.parse(readFileSync(new URL('../../product/'+name,import.meta.url),'utf8'));

test('neutral Factory 2 acceptance case exercises the full mechanism without becoming a real domain authority',()=>{
  const result=runFactory2NeutralAcceptanceCase(product('FACTORY2_NEUTRAL_ACCEPTANCE_CASE_2026-09-24.json'));
  assert.equal(result.status,'READY_FOR_HUMAN_REVIEW');
  assert.equal(result.phases.length,10);
  assert.match(result.deterministicOutputSha256,/^[0-9a-f]{64}$/);
  assert.equal(result.realDomainAuthority,false);
  assert.equal(result.factoryAcceptanceGranted,false);
  assert.equal(result.ownerApprovalGranted,false);
});
test('neutral Factory 2 acceptance output is deterministic',()=>{
  const x=product('FACTORY2_NEUTRAL_ACCEPTANCE_CASE_2026-09-24.json');
  const a=runFactory2NeutralAcceptanceCase(x);
  const b=runFactory2NeutralAcceptanceCase(x);
  assert.equal(a.deterministicOutputSha256,b.deterministicOutputSha256);
});
test('neutral Factory 2 acceptance detects source-byte tampering',()=>{
  const x=product('FACTORY2_NEUTRAL_ACCEPTANCE_CASE_2026-09-24.json');
  x.source.bytesBase64=Buffer.from('tampered').toString('base64');
  assert.throws(()=>runFactory2NeutralAcceptanceCase(x),(e)=>e instanceof Factory2NeutralAcceptanceError&&e.code==='FACTORY2_NEUTRAL_ACCEPTANCE_SOURCE_MISMATCH');
});
test('Domain Run Bootstrap template exists but cannot activate before Factory 2 acceptance',()=>{
  const x=validateFactory2DomainRunBootstrapTemplate(product('FACTORY2_DOMAIN_RUN_BOOTSTRAP_2026-09-24.json'));
  assert.equal(x.activationAllowed,false);
  assert.equal(x.factoryAcceptance.accepted,false);
});
test('real domain bootstrap requires accepted Factory 2 plus owner-supplied exact source',()=>{
  const out=prepareFactory2DomainRun({
    factoryId:'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2',
    factoryAcceptanceStatus:'FACTORY2_ACCEPTED',
    factoryAcceptanceResultRef:'factory2:acceptance:receipt',
    domainId:'D03',
    sourceOrigin:'OWNER_SUPPLIED_AT_TEST_TIME',
    sourceSha256:'a'.repeat(64),
    ownerApprovalGranted:false,
    genericWriteAuthority:false,
    productionActivation:false,
  });
  assert.equal(out.next,'DOMAIN_ENGINEERING');
  assert.equal(out.productionActivation,false);
});
test('historical source substitution is rejected by Domain Run Bootstrap',()=>{
  assert.throws(()=>prepareFactory2DomainRun({
    factoryId:'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2',
    factoryAcceptanceStatus:'FACTORY2_ACCEPTED',
    factoryAcceptanceResultRef:'factory2:acceptance:receipt',
    domainId:'D01',
    sourceOrigin:'HISTORICAL_DOMAIN_RUN',
    sourceSha256:'b'.repeat(64),
    ownerApprovalGranted:false,
    genericWriteAuthority:false,
    productionActivation:false,
  }),(e)=>e instanceof Factory2DomainRunBootstrapError&&e.code==='FACTORY2_DOMAIN_RUN_BOOTSTRAP_SOURCE_REQUIRED');
});
