import test from 'node:test';
import assert from 'node:assert/strict';
import {buildT3EvidencePassport} from '../modules/activity-base-anonymizer/t3-evidence-passport.mjs';

const sourceSecret='PRIVATE_CUSTOMER_AND_WORKSPACE_ID';
const base=(reason_codes,status='HOLD')=>({
  status,reason_codes,anonymity:'NOT_ESTABLISHED',export_allowed:false,
  iwxa_package:null,
  structural_candidate:status==='HOLD'?null:[{
    object_type:'object_type_001',cohort_band:'3-9',
    observed_event_kinds:['event_type_001'],object_local_successions:[],
  }],
});
test('D05 reported transition and original based_on relation yield concrete next actions',()=>{
  const reasons=['T3_D2_UNVERIFIED_EVENT_STEP',
    'T3_D2_RARE_OBJECT_ROUTE',
    'T3_D2_RELATION_PRIVACY_REVIEW_REQUIRED'];
  const before=base(reasons);
  const old=structuredClone(before);
  const view=buildT3EvidencePassport(before);
  assert.equal(view.result,'INSUFFICIENT_FOR_RECONSTRUCTION');
  assert.equal(view.businessExecution,'NOT_INDEPENDENTLY_PROVEN');
  assert.equal(view.disclosure,'FORBIDDEN');
  assert.equal(view.actionCount,3);
  assert.deepEqual(view.groups.map(x=>x.area),['facts','privacy']);
  assert.match(view.groups[0].items[0].next,/проверку качества/);
  assert.match(view.groups[1].items[1].next,/прав на передачу/);
  assert.ok(Object.isFrozen(view)&&Object.isFrozen(view.groups));
  assert.deepEqual(before,old,'the original reviewed result never mutates');
  assert.equal(JSON.stringify(view).includes(sourceSecret),false);
  assert.equal(JSON.stringify(view).includes('120'),false);
});
test('an acceptable source structure is only internal review, never independent work proof',()=>{
  const p=buildT3EvidencePassport(base([
    'EXTERNAL_LINKAGE_RISK_UNMEASURED',
    'OCEL2_FULL_CONFORMANCE_NOT_ESTABLISHED',
    'T3_SIGNED_OWNER_RESULT_NOT_INDEPENDENTLY_ATTESTED',
    'T3_D2_SYSTEM_CONTEXT_EXCLUDED',
  ],'STRUCTURE_PRESERVED_REVIEW_REQUIRED'));
  assert.equal(p.result,'INTERNAL_STRUCTURE_ONLY');
  assert.equal(p.businessExecution,'NOT_INDEPENDENTLY_PROVEN');
  assert.equal(p.disclosure,'FORBIDDEN');
  assert.equal(p.actionCount,3);
  assert.equal(p.info.length,1);
  assert.match(p.info[0].next,/Исправление не требуется/);
  assert.ok(!p.groups.some(x=>x.area==='context'));
});
test('known reason codes cannot be duplicated into inflated tasks',()=>{
  const p=buildT3EvidencePassport(base([
    'T3_D2_UNVERIFIED_EVENT_STEP','T3_D2_UNVERIFIED_EVENT_STEP',
    'T3_D2_OBJECT_EVENT_ORDER_UNKNOWN',
  ]));
  assert.equal(p.actionCount,2);
  assert.deepEqual(p.groups.map(x=>x.area),['facts','time']);
});
test('unknown reasons, raw source strings and falsified export are rejected',()=>{
  for(const r of [
    base([sourceSecret]),
    base(['T3_D2_UNVERIFIED_EVENT_STEP',sourceSecret]),
    {...base([]),export_allowed:true},
    {...base([]),anonymity:'ANONYMOUS'},
    {...base([]),iwxa_package:{secret:sourceSecret}},
    {...base([]),structural_candidate:[{id:sourceSecret}]},
    {...base([],'STRUCTURE_PRESERVED_REVIEW_REQUIRED'),structural_candidate:null},
    {...base([]),status:'PRODUCTION_ACCEPTED'},
  ]) assert.throws(()=>buildT3EvidencePassport(r),/T3_EVIDENCE_PASSPORT_INVALID/);
});
test('unknown source code cannot render as a suggested operation or actionable instruction',()=>{
  const codes=[
    'T3_D2_UNRESOLVED_SOURCE_LINK','T3_D2_UNMAPPED_SOURCE_RECORD',
    'T3_D2_EVENT_OBJECT_UNVERIFIED','T3_D2_NO_OBSERVED_ACTIVITY',
    'T3_D2_UNVERIFIED_EVENT_STEP','T3_D2_EVENT_STATUS_NOT_DECLARED',
    'T3_D2_SYSTEM_CONTEXT_EXCLUDED','T3_D2_OBJECT_EVENT_ORDER_UNKNOWN',
    'T3_D2_OBJECT_WITHOUT_EVENTS','T3_D2_RARE_OBJECT_ROUTE',
    'T3_D2_RARE_OBJECT_RELATION','T3_D2_RELATION_PRIVACY_REVIEW_REQUIRED',
    'EXTERNAL_LINKAGE_RISK_UNMEASURED',
    'T3_SIGNED_OWNER_RESULT_NOT_INDEPENDENTLY_ATTESTED',
    'OCEL2_FULL_CONFORMANCE_NOT_ESTABLISHED',
  ];
  const p=buildT3EvidencePassport(base(codes));
  assert.equal(p.actionCount,14);
  assert.equal(p.info.length,1);
  assert.equal(new Set(p.groups.flatMap(x=>x.items.map(row=>row.code))).size,14);
  assert.equal(JSON.stringify(p).includes(sourceSecret),false);
});
