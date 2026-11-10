import test from 'node:test';
import assert from 'node:assert/strict';
import {assertDomainNativeResultAuthorityBinding,ResultAcceptanceAuthorityError} from '../src/modules/base/features/project-process/result-acceptance-authority.mjs';
import {bindDomainNativeResultAuthority,domainResultAuthorityReadiness} from '../src/modules/base/features/project-process/domain-result-authority-registry.mjs';
function input(){return {domainId:'D03',acceptedNativeResultRef:'domain:result',resultProducer:'ArtBazy',canonicalAuthorityCore:'artbazy',acceptanceCriteriaRefs:['source:criteria'],provenanceRefs:['source:provenance'],stableIdentity:{workspace_id:'w',object_id:'o',schema_id:'result',schema_version:'1',created_by_service:'ArtBazy',updated_by_service:'ArtBazy'}};}
test('existing domain-bound Result authority still binds through the registry',()=>{
  assert.equal(bindDomainNativeResultAuthority('D03',input()).sourceTruthBinding,true);
});
for(const domainId of ['D01','D12']){
  test(`${domainId} cannot acquire persistent Result authority through a forged input`,()=>{
    assert.equal(domainResultAuthorityReadiness(domainId).sourceTruthBindingAllowed,false);
    assert.throws(()=>bindDomainNativeResultAuthority(domainId,input()));
  });
}
test('D10 rejects forged producer and obsolete authority after the accepted Owner decision',()=>{
  assert.equal(domainResultAuthorityReadiness('D10').sourceTruthBindingAllowed,true);
  assert.throws(()=>bindDomainNativeResultAuthority('D10',input()),e=>e.code==='DOMAIN_RESULT_PRODUCER_MISMATCH');
  for(const canonicalAuthorityCore of ['artbazy','artbazi','OWNER_DECISION_REQUIRED']){
    assert.throws(()=>bindDomainNativeResultAuthority('D10',{...input(),resultProducer:'ArtBazi',canonicalAuthorityCore}),e=>e.code==='DOMAIN_RESULT_AUTHORITY_MISMATCH');
  }
});
test('NO_NEW_ROOT_AUTHORITY is not a resolved authority core',()=>{
  assert.throws(()=>assertDomainNativeResultAuthorityBinding({...input(),canonicalAuthorityCore:'NO_NEW_ROOT_AUTHORITY'}),ResultAcceptanceAuthorityError);
});
test('NONE_PROVEN is not an acceptance/provenance reference',()=>{
  assert.throws(()=>assertDomainNativeResultAuthorityBinding({...input(),acceptanceCriteriaRefs:['NONE_PROVEN'],provenanceRefs:['NONE_PROVEN']}),ResultAcceptanceAuthorityError);
});
test('sparse evidence lists cannot satisfy non-empty criteria',()=>{
  assert.throws(()=>assertDomainNativeResultAuthorityBinding({...input(),acceptanceCriteriaRefs:Array(1)}),ResultAcceptanceAuthorityError);
});
test('a common Project/Process updater cannot write a native Result',()=>{
  const i=input();i.stableIdentity.updated_by_service='iwxa.project-process.owner';
  assert.throws(()=>assertDomainNativeResultAuthorityBinding(i),ResultAcceptanceAuthorityError);
});
test('authority validation must not execute an input getter',()=>{
  const i=input();let calls=0;
  Object.defineProperty(i,'acceptedNativeResultRef',{enumerable:true,get(){calls++;return 'source:x';}});
  assert.throws(()=>assertDomainNativeResultAuthorityBinding(i),ResultAcceptanceAuthorityError);
  assert.equal(calls,0);
});
