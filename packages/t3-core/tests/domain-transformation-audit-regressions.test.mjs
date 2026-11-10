import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildDomainSourceInspectionRequest,validateDomainSourceInspectionReceipt} from '../src/modules/base/features/domain-transformation/domain-source-inspection.mjs';
import {buildDomainTransformationPlan,validateDomainTransformationCandidate} from '../src/modules/base/features/domain-transformation/domain-transformation-kit.mjs';
import {evaluateDomainTransformationCandidateGate} from '../src/modules/base/features/domain-transformation/domain-transformation-candidate-gate.mjs';
import {buildDomainOwnerCommandMap} from '../src/modules/base/features/domain-transformation/domain-owner-command-map.mjs';
import {buildDomainSchemaMap} from '../src/modules/base/features/domain-transformation/domain-schema-map.mjs';
import {buildDomainResultAcceptanceMap} from '../src/modules/base/features/domain-transformation/domain-result-acceptance-map.mjs';
import {buildDomainCompatibilityMap} from '../src/modules/base/features/domain-transformation/domain-compatibility-map.mjs';
import {buildDomainRollbackPlan} from '../src/modules/base/features/domain-transformation/domain-rollback-plan.mjs';
const fixture=(name)=>new URL('./fixtures/'+name,import.meta.url);
const requestRecord=JSON.parse(readFileSync(fixture('source-inspection-request.sample.json'),'utf8'));
const raw=readFileSync(fixture('source-inspection-receipt.sample.json'));
const receipt=()=>JSON.parse(raw);
const request=()=>buildDomainSourceInspectionRequest(requestRecord);
const SHA=requestRecord.sourceSha256;
// These are synthetic unit-test maps, never product evidence or owner approvals.
function inputs(){
  const id={domainId:'D01',currentSourceSha256:SHA};
  return {
    intake:{domainId:'D01',productName:'Learn',currentSourceRef:'sha256:'+SHA,authorityStatus:'OWNER_DECISION_REQUIRED',ownerRefs:['service:study'],sourceTruthRefs:['source:'+SHA],schemaRefs:['schema:goal'],candidateRequirements:{schemaAdaptationTargets:[],ownerCommandContractTargets:[],resultAcceptanceContractTargets:[],compatibilityQualificationSubjects:[]},schemaMapStatus:'COMPLETE',ownerCommandMapStatus:'COMPLETE',processResultMapStatus:'COMPLETE',compatibilityMapStatus:'COMPLETE',rollbackPlanStatus:'COMPLETE'},
    schemaMap:{...id,targetSchemaIds:['goal'],mappings:[{targetSchemaId:'goal',status:'BOUND',ownerRef:'service:study',sourceSchemaRefs:['schema:goal'],migrationRefs:[]}]},
    ownerCommandMap:{...id,entries:[{component:'study',ownerRef:'service:study',status:'BOUND',commandIds:['study.create-goal']}]},
    resultAcceptanceMap:{...id,persistentAuthorityStatus:'OWNER_DECISION_REQUIRED',entries:[{resultKind:'study',producerRef:'service:study',status:'BOUND',acceptanceCriteriaRefs:['source:criterion'],provenanceRefs:['source:provenance']}]},
    compatibilityMap:{...id,entries:[{subject:'data',status:'BOUND',guarantees:['ids preserved']}]},
    rollbackPlan:{domainId:'D01',baselineSourceRef:'sha256:'+SHA,acceptedStateRef:'state:accepted',rollbackEvidenceRef:'source:rollback',verificationSteps:['verify identity'],executionAuthorized:false}
  };
}
function candidate(domainId='D01'){
  return {domainId,evidenceRefs:['test:compatibility'],rollbackRef:'source:rollback',compatibilityVerified:true,genericWriteAuthority:false,aiOutputSourceTruth:false};
}
test('the original supplied receipt bytes retain the exact user-confirmed checksum',()=>{
  assert.equal(createHash('sha256').update(raw).digest('hex'),'7d55aa350e27e1ad30c74959b40615cf837570666df18dcc9063ab00fd1d403e');
  assert.equal(validateDomainSourceInspectionReceipt(request(),receipt()).status,'COMPLETE_EXACT_SOURCE');
});
test('inspection covers all exact producers, not five arbitrary producer names',()=>{
  const r=receipt();r.findings.nativeResultAcceptance.items[0].producerRef='components/foreign/service-passport.json#output_object_types';
  assert.throws(()=>validateDomainSourceInspectionReceipt(request(),r));
});
test('inspection rejects null list fields instead of treating field presence as evidence',()=>{
  const r=receipt();r.findings.schemaOwnership.items[0].sourceSchemaRefs=null;
  assert.throws(()=>validateDomainSourceInspectionReceipt(request(),r));
});
test('inspection rejects null item status fields',()=>{
  const r=receipt();r.findings.nativeResultAcceptance.items[0].acceptanceStatus=null;
  assert.throws(()=>validateDomainSourceInspectionReceipt(request(),r));
});
test('inspection result owns a deep immutable snapshot',()=>{
  const r=receipt();const v=validateDomainSourceInspectionReceipt(request(),r);
  const ref=v.findings.schemaOwnership.items[0].sourceSchemaRefs[0];
  r.findings.schemaOwnership.items[0].sourceSchemaRefs[0]='changed-after-validation';
  assert.equal(v.findings.schemaOwnership.items[0].sourceSchemaRefs[0],ref);
  assert.equal(Object.isFrozen(v.findings.schemaOwnership.items[0].sourceSchemaRefs),true);
});
test('an untrusted request object cannot erase all required findings',()=>{
  const q={...request(),requiredFindings:[]};const r=receipt();r.findings={};
  assert.throws(()=>validateDomainSourceInspectionReceipt(q,r));
});
test('inspection never executes getters while copying receipt items',()=>{
  const r=receipt();let hits=0;
  Object.defineProperty(r.findings.schemaOwnership.items[0],'ownerRef',{enumerable:true,get(){hits++;return 'service:surprise';}});
  assert.throws(()=>validateDomainSourceInspectionReceipt(request(),r));
  assert.equal(hits,0);
});
test('generic putObject cannot be admitted as a domain owner command',()=>{
  const x=inputs().ownerCommandMap;x.entries[0].commandIds=['putObject'];
  assert.throws(()=>buildDomainOwnerCommandMap(x));
});
test('NONE_PROVEN cannot become bound schema authority',()=>{
  const x=inputs().schemaMap;x.mappings[0].ownerRef='NONE_PROVEN';x.mappings[0].sourceSchemaRefs=['NONE_PROVEN'];
  assert.throws(()=>buildDomainSchemaMap(x));
});
test('NONE_PROVEN cannot become bound Result acceptance/provenance',()=>{
  const x=inputs().resultAcceptanceMap;x.entries[0].acceptanceCriteriaRefs=['NONE_PROVEN'];x.entries[0].provenanceRefs=['NONE_PROVEN'];
  assert.throws(()=>buildDomainResultAcceptanceMap(x));
});
test('Result map authority cannot be overridden by intake authority',()=>{
  const x=inputs();x.intake.authorityStatus='AUTHORITY_BOUND_PRODUCT_LOGIC';
  assert.throws(()=>evaluateDomainTransformationCandidateGate(x));
});

test('D10 Owner-approved authority passes the same candidate gate that previously failed closed',()=>{
  const x=inputs();
  for(const value of Object.values(x)){
    if(value&&typeof value==='object'&&!Array.isArray(value)&&value.domainId==='D01') value.domainId='D10';
  }
  x.intake.productName='ArtBazi';
  x.intake.authorityStatus='AUTHORITY_BOUND_PRODUCT_LOGIC';
  x.intake.ownerRefs=['owner:ru.artbazi.artbazy-sales'];
  x.intake.sourceTruthRefs=['authority:ru.artbazi.artbazy-sales'];
  x.resultAcceptanceMap.persistentAuthorityStatus='BOUND';
  x.resultAcceptanceMap.entries[0].producerRef='service:ru.artbazi.artbazy-sales';
  const gate=evaluateDomainTransformationCandidateGate(x);
  assert.equal(gate.domainId,'D10');
  assert.equal(gate.persistentResultBindingAllowed,true);
  assert.equal(gate.plan.authorityResolved,true);
  assert.equal(gate.plan.ownerDecisionRequired,false);
});

test('D10 stale OWNER_DECISION_REQUIRED intake cannot override the corrected executable registry',()=>{
  const x=inputs();
  for(const value of Object.values(x)){
    if(value&&typeof value==='object'&&!Array.isArray(value)&&value.domainId==='D01') value.domainId='D10';
  }
  x.intake.productName='ArtBazi';
  x.intake.authorityStatus='OWNER_DECISION_REQUIRED';
  assert.throws(
    ()=>evaluateDomainTransformationCandidateGate(x),
    (error)=>error?.code==='TRANSFORMATION_AUTHORITY_REGISTRY_MISMATCH',
  );
});
test('both source fingerprint aliases must agree',()=>{
  const x=inputs();x.compatibilityMap.sourceSha256=SHA;x.compatibilityMap.currentSourceSha256='0'.repeat(64);
  assert.throws(()=>evaluateDomainTransformationCandidateGate(x));
});
test('changing the intake ref syntax cannot bypass exact map fingerprint checks',()=>{
  const x=inputs();x.intake.currentSourceRef='git:anything';x.compatibilityMap.currentSourceSha256='0'.repeat(64);
  assert.throws(()=>evaluateDomainTransformationCandidateGate(x));
});
test('unknown authority labels fail closed',()=>{
  const x=inputs();x.intake.authorityStatus='MAYBE';
  assert.throws(()=>buildDomainTransformationPlan(x.intake));
});
test('a blocked plan cannot validate a candidate for human review',()=>{
  const x=inputs();x.intake.schemaMapStatus='PARTIAL';
  assert.throws(()=>validateDomainTransformationCandidate({plan:buildDomainTransformationPlan(x.intake),candidate:candidate()}));
});
for(const flag of ['productionActivation','hiddenWritesAllowed','genericPutObjectAllowed','persistentResultBindingAllowed']){
  test(`candidate cannot smuggle ${flag}`,()=>{
    assert.throws(()=>validateDomainTransformationCandidate({plan:buildDomainTransformationPlan(inputs().intake),candidate:{...candidate(),[flag]:true}}));
  });
}
test('rollback rejects non-boolean authorization instead of silently normalizing it',()=>{
  assert.throws(()=>buildDomainRollbackPlan({...inputs().rollbackPlan,executionAuthorized:'true'}));
});

test('map builders reject non-record input with their domain error type',()=>{
 for(const build of [buildDomainSchemaMap,buildDomainOwnerCommandMap,buildDomainResultAcceptanceMap,buildDomainCompatibilityMap]){
  for(const value of [null,[],42])assert.throws(()=>build(value),e=>e.code!==undefined);
 }
});
test('unresolved authority labels cannot be promoted into schema owner references',()=>{
 for(const ownerRef of ['OWNER_DECISION_REQUIRED','NO_NEW_ROOT_AUTHORITY','NATIVE_RESULT_USE_CASE_NOT_PROVEN']){
  assert.throws(()=>buildDomainSchemaMap({domainId:'D01',targetSchemaIds:['x'],mappings:[{targetSchemaId:'x',status:'BOUND',ownerRef,sourceSchemaRefs:['source:x']}]}));
 }
});

test('D11 Proposal-only source passes candidate gate without claiming Human Acceptance',()=>{
 const x=inputs();
 for(const value of Object.values(x))if(value&&typeof value==='object'&&!Array.isArray(value)&&value.domainId==='D01')value.domainId='D11';
 x.intake.productName='Advice Logistics';
 x.intake.authorityStatus='AUTHORITY_BOUND_PRODUCT_LOGIC';
 x.intake.ownerRefs=['service:ru.iwxa.advice-logistics.workspace'];
 x.intake.sourceTruthRefs=['authority:ru.iwxa.advice-logistics.workspace'];
 x.resultAcceptanceMap.persistentAuthorityStatus='BOUND';
 x.resultAcceptanceMap.entries=[{
   resultKind:'process-as-is-to-be',producerRef:'service:ru.iwxa.advice-logistics.workspace',
   status:'PERSISTED_UNACCEPTED',acceptanceStatus:'NOT_REQUESTED',
   acceptedResultRefs:[],inputAcceptanceEvidenceRefs:[],acceptanceCriteriaRefs:[],
   provenanceRefs:['receipt:d11'],evidenceRefs:['browser:d11-readback']
 }];
 const map=buildDomainResultAcceptanceMap(x.resultAcceptanceMap);
 assert.equal(map.entries[0].acceptanceStatus,'NOT_REQUESTED');
 assert.deepEqual(map.entries[0].acceptedResultRefs,[]);
 const gate=evaluateDomainTransformationCandidateGate(x);
 assert.equal(gate.domainId,'D11');
 assert.equal(gate.candidateValidationAllowed,true);
 assert.equal(gate.persistentResultBindingAllowed,true);
});
test('PERSISTED_UNACCEPTED fails closed on fabricated approval and missing evidence',()=>{
 const map=inputs().resultAcceptanceMap;
 map.persistentAuthorityStatus='BOUND';
 const base={resultKind:'d11.proposal',producerRef:'service:d11',
   status:'PERSISTED_UNACCEPTED',acceptanceStatus:'NOT_REQUESTED',
   acceptedResultRefs:[],inputAcceptanceEvidenceRefs:[],acceptanceCriteriaRefs:[],
   provenanceRefs:['receipt:d11'],evidenceRefs:['browser:d11']};
 for(const patch of [
   {acceptanceStatus:'APPROVED'},{accepted:true},{humanReviewed:true},
   {acceptedResultRefs:['human:fake']},{inputAcceptanceEvidenceRefs:['human:fake']},
   {acceptanceCriteriaRefs:['criteria:approval']},{provenanceRefs:[]},{evidenceRefs:[]},
   {approver:'auto'},{decision:'APPROVED'}
 ]){
   map.entries=[{...base,...patch}];
   assert.throws(()=>buildDomainResultAcceptanceMap(map),error=>error?.code==='PERSISTED_UNACCEPTED_AUTHORITY_INVALID');
 }
});
