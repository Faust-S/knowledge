import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOMAIN_RESULT_AUTHORITY_REGISTRY,
  DomainResultAuthorityRegistryError,
  bindDomainNativeResultAuthority,
  domainResultAuthority,
  domainResultAuthorityReadiness,
} from '../src/modules/base/features/project-process/domain-result-authority-registry.mjs';

test('C3 domain Result registry carries all 12 exact Product Logic authority rows', () => {
  assert.equal(Object.keys(DOMAIN_RESULT_AUTHORITY_REGISTRY.entries).length,12);
  assert.equal(domainResultAuthority('D02').resultProducer,'Club IWXA');
  assert.equal(domainResultAuthority('D02').canonicalAuthorityCore,'ru.iwxa.club');
  assert.equal(domainResultAuthority('D05').resultProducer,'Cehovod');
  assert.equal(domainResultAuthority('D05').canonicalAuthorityCore,'artbazy');
  assert.equal(domainResultAuthority('D06').resultProducer,'Komplektovod');
  assert.equal(domainResultAuthority('D06').canonicalAuthorityCore,'komplektovod');
  assert.equal(domainResultAuthority('D09').canonicalAuthorityCore,'club.iwxa');
  assert.equal(domainResultAuthority('D11').canonicalAuthorityCore,'ru.iwxa.advice-logistics.workspace');
  assert.equal(domainResultAuthority('D12').canonicalAuthorityCore,'NO_NEW_ROOT_AUTHORITY');
});

test('D01 remains unresolved while D10 uses the explicit Owner-approved authority core', () => {
  const d01=domainResultAuthorityReadiness('D01');
  assert.equal(d01.status,'OWNER_DECISION_REQUIRED');
  assert.equal(d01.sourceTruthBindingAllowed,false);

  const d10=domainResultAuthorityReadiness('D10');
  assert.equal(d10.status,'AUTHORITY_BOUND_PRODUCT_LOGIC');
  assert.equal(d10.sourceTruthBindingAllowed,true);
  assert.equal(domainResultAuthority('D10').resultProducer,'ArtBazi');
  assert.equal(domainResultAuthority('D10').canonicalAuthorityCore,'ru.artbazi.artbazy-sales');
});

test('D12 preserves NO_NEW_ROOT_AUTHORITY but does not invent a persistent private T2 result', () => {
  const readiness=domainResultAuthorityReadiness('D12');
  assert.equal(readiness.status,'NATIVE_RESULT_USE_CASE_NOT_PROVEN');
  assert.equal(readiness.sourceTruthBindingAllowed,false);
  assert.equal(readiness.reason,'PERSISTENT_NATIVE_T2_RESULT_NOT_PROVEN');
});

test('bound domain Result authority requires exact Product Logic producer and authority core', () => {
  const base={
    resultProducer:'Cehovod',
    canonicalAuthorityCore:'artbazy',
    acceptanceCriteriaRefs:['criteria:quality'],
    stableIdentity:{
      workspace_id:'ws-1',
      object_id:'result-1',
      schema_id:'cehovod.result',
      schema_version:'1.0.0',
      created_by_service:'Cehovod',
      updated_by_service:'Cehovod',
    },
    provenanceRefs:['event:1','receipt:1'],
  };
  const binding=bindDomainNativeResultAuthority('D05',base);
  assert.equal(binding.domainId,'D05');
  assert.equal(binding.sourceTruthBinding,true);
  assert.equal(binding.resultProducer,'Cehovod');
  assert.equal(binding.canonicalAuthorityCore,'artbazy');

  assert.throws(
    () => bindDomainNativeResultAuthority('D05',{...base,resultProducer:'iwxa.project-process.owner'}),
    (error) => error instanceof DomainResultAuthorityRegistryError
      && error.code === 'DOMAIN_RESULT_PRODUCER_MISMATCH',
  );
});

test('D10 binds only the explicit Owner-approved authority and rejects obsolete guesses', () => {
  const base={
    resultProducer:'ArtBazi',
    canonicalAuthorityCore:'ru.artbazi.artbazy-sales',
    acceptanceCriteriaRefs:['criteria:d10-current'],
    stableIdentity:{
      workspace_id:'ws-d10',
      object_id:'result-d10',
      schema_id:'ru.artbazi.artbazy-sales.campaign',
      schema_version:'1.0.0',
      created_by_service:'ArtBazi',
      updated_by_service:'ArtBazi',
    },
    provenanceRefs:['event:d10','receipt:d10'],
  };
  const binding=bindDomainNativeResultAuthority('D10',base);
  assert.equal(binding.domainId,'D10');
  assert.equal(binding.canonicalAuthorityCore,'ru.artbazi.artbazy-sales');
  assert.equal(binding.resultProducer,'ArtBazi');

  for(const obsolete of ['artbazy','artbazi','OWNER_DECISION_REQUIRED']){
    assert.throws(
      () => bindDomainNativeResultAuthority('D10',{...base,canonicalAuthorityCore:obsolete}),
      (error) => error instanceof DomainResultAuthorityRegistryError
        && error.code === 'DOMAIN_RESULT_AUTHORITY_MISMATCH',
    );
  }
});

test('D06 rejects obsolete external authority and binds only current Komplektovod authority', () => {
  const base={
    resultProducer:'Komplektovod',
    canonicalAuthorityCore:'komplektovod',
    acceptanceCriteriaRefs:['criteria:d06-current'],
    stableIdentity:{
      workspace_id:'ws-d06',
      object_id:'result-d06',
      schema_id:'ru.iwxa.komplektovod.required-outcome',
      schema_version:'1.0.0',
      created_by_service:'Komplektovod',
      updated_by_service:'Komplektovod',
    },
    provenanceRefs:['event:d06','receipt:d06'],
  };
  const binding=bindDomainNativeResultAuthority('D06',base);
  assert.equal(binding.domainId,'D06');
  assert.equal(binding.canonicalAuthorityCore,'komplektovod');
  assert.equal(binding.resultProducer,'Komplektovod');

  assert.throws(
    () => bindDomainNativeResultAuthority('D06',{...base,canonicalAuthorityCore:'artbazy'}),
    (error) => error instanceof DomainResultAuthorityRegistryError
      && error.code === 'DOMAIN_RESULT_AUTHORITY_MISMATCH',
  );
});


test('D02 rejects stale club.iwxa authority and binds only current Club namespace', () => {
  const base={
    resultProducer:'Club IWXA',
    canonicalAuthorityCore:'ru.iwxa.club',
    acceptanceCriteriaRefs:['criteria:d02-current'],
    stableIdentity:{
      workspace_id:'ws-d02',
      object_id:'result-d02',
      schema_id:'ru.iwxa.club.personal-economy-map',
      schema_version:'1.0.0',
      created_by_service:'Club IWXA',
      updated_by_service:'Club IWXA',
    },
    provenanceRefs:['event:d02','receipt:d02'],
  };
  const binding=bindDomainNativeResultAuthority('D02',base);
  assert.equal(binding.domainId,'D02');
  assert.equal(binding.canonicalAuthorityCore,'ru.iwxa.club');
  assert.equal(binding.resultProducer,'Club IWXA');

  assert.throws(
    () => bindDomainNativeResultAuthority('D02',{...base,canonicalAuthorityCore:'club.iwxa'}),
    (error) => error instanceof DomainResultAuthorityRegistryError
      && error.code === 'DOMAIN_RESULT_AUTHORITY_MISMATCH',
  );
});

test('D11 cannot inherit ArtBazy corporate acceptance',()=>{
 const d11=domainResultAuthority('D11');
 assert.equal(d11.nativeResultPhase,'PROPOSAL_ONLY');
 assert.equal(d11.nativeResultAcceptance,'NOT_REQUESTED');
 assert.equal(d11.canonicalAuthorityCore,'ru.iwxa.advice-logistics.workspace');
 const fix=DOMAIN_RESULT_AUTHORITY_REGISTRY.corrections.find(c=>c.domainId==='D11');
 assert.equal(fix.previousCanonicalAuthorityCore,'artbazy');
 assert.equal(fix.externalAuthorityInherited,false);
 assert.equal(domainResultAuthorityReadiness('D11').status,'AUTHORITY_BOUND_PRODUCT_LOGIC');
 assert.throws(()=>bindDomainNativeResultAuthority('D11',{
  resultProducer:'Advice Logistics',canonicalAuthorityCore:'artbazy',
  acceptanceCriteriaRefs:['criterion:review'],provenanceRefs:['event:1'],
  stableIdentity:{workspace_id:'ws1',object_id:'o1',schema_id:'ru.iwxa.advice-logistics.process.proposal',schema_version:'1.0.0',created_by_service:'Advice Logistics',updated_by_service:'Advice Logistics'}
 }),error=>error?.code==='DOMAIN_RESULT_AUTHORITY_MISMATCH');
});
