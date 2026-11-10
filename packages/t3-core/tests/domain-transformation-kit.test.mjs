import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DomainTransformationError,
  buildDomainTransformationPlan,
  normalizeDomainTransformationIntake,
  validateDomainTransformationCandidate,
} from '../src/modules/base/features/domain-transformation/index.mjs';

function intake(overrides={}){
  return {
    domainId:'D03',
    productName:'ArtBazy',
    currentSourceRef:'git:artbazy@current',
    authorityStatus:'AUTHORITY_BOUND_PRODUCT_LOGIC',
    ownerRefs:['owner:artbazy'],
    sourceTruthRefs:['authority:artbazy'],
    schemaRefs:['schema:project','schema:result'],
    schemaMapStatus:'COMPLETE',
    ownerCommandMapStatus:'COMPLETE',
    processResultMapStatus:'COMPLETE',
    compatibilityMapStatus:'COMPLETE',
    rollbackPlanStatus:'COMPLETE',
    compatibilityConstraints:['preserve-public-routes'],
    candidateRequirements:{
      schemaAdaptationTargets:[],
      ownerCommandContractTargets:[],
      resultAcceptanceContractTargets:[],
      compatibilityQualificationSubjects:[],
    },
    ...overrides,
  };
}

test('domain transformation intake is canonical and does not grant AI or generic write authority',()=>{
  const value=normalizeDomainTransformationIntake(intake());
  assert.equal(value.domainId,'D03');
  assert.equal(value.activeAiAuthority,false);
  assert.equal(value.genericWriteAuthority,false);
});

test('authority-bound domain can reach candidate build while production remains disabled',()=>{
  const plan=buildDomainTransformationPlan(intake());
  assert.equal(plan.candidateBuildAllowed,true);
  assert.equal(plan.persistentResultBindingAllowed,true);
  assert.equal(plan.productionActivation,false);
  assert.equal(plan.genericPutObjectAllowed,false);
  assert.equal(plan.aiOutputSourceTruth,false);
});

test('missing owner/source/schema maps fail closed before candidate build',()=>{
  const plan=buildDomainTransformationPlan(intake({ownerRefs:[],ownerCommandMapStatus:'PENDING',sourceTruthRefs:[],schemaRefs:[],schemaMapStatus:'PENDING',processResultMapStatus:'COMPLETE',compatibilityMapStatus:'COMPLETE',rollbackPlanStatus:'COMPLETE'}));
  assert.equal(plan.candidateBuildAllowed,false);
  assert.deepEqual(plan.blockers,[
    'OWNER_MAP_REQUIRED','SOURCE_TRUTH_MAP_REQUIRED','SCHEMA_MAP_REQUIRED',
  ]);
});

test('D01 unresolved Result authority remains explicit without blocking read/schema transformation work',()=>{
  const plan=buildDomainTransformationPlan(intake({
    domainId:'D01',
    productName:'Learn',
    authorityStatus:'OWNER_DECISION_REQUIRED',
  }));
  assert.equal(plan.candidateBuildAllowed,true);
  assert.equal(plan.ownerDecisionRequired,true);
  assert.equal(plan.persistentResultBindingAllowed,false);
  assert.ok(plan.blockers.includes('RESULT_AUTHORITY_OWNER_DECISION_REQUIRED'));
});

test('D10 accepted Owner authority reaches authority-bound transformation planning',()=>{
  const plan=buildDomainTransformationPlan(intake({
    domainId:'D10',
    productName:'ArtBazi',
    authorityStatus:'AUTHORITY_BOUND_PRODUCT_LOGIC',
  }));
  assert.equal(plan.candidateBuildAllowed,true);
  assert.equal(plan.ownerDecisionRequired,false);
  assert.equal(plan.persistentResultBindingAllowed,true);
  assert.ok(!plan.blockers.includes('RESULT_AUTHORITY_OWNER_DECISION_REQUIRED'));
});

test('D12-style unproven persistent Result use case stays fail closed',()=>{
  const plan=buildDomainTransformationPlan(intake({
    domainId:'D12',
    productName:'IWXA Main',
    authorityStatus:'NATIVE_RESULT_USE_CASE_NOT_PROVEN',
  }));
  assert.equal(plan.candidateBuildAllowed,true);
  assert.equal(plan.resultUseCaseOpen,true);
  assert.equal(plan.persistentResultBindingAllowed,false);
});

test('candidate validation requires compatibility evidence and rollback and rejects authority escalation',()=>{
  const plan=buildDomainTransformationPlan(intake());
  const result=validateDomainTransformationCandidate({
    plan,
    candidate:{
      domainId:'D03',
      evidenceRefs:['test:domain-contract','test:compatibility'],
      rollbackRef:'rollback:artbazy-v1',
      compatibilityVerified:true,
      genericWriteAuthority:false,
      aiOutputSourceTruth:false,
    },
  });
  assert.equal(result.status,'READY_FOR_HUMAN_REVIEW');
  assert.equal(result.productionActivation,false);

  assert.throws(
    ()=>validateDomainTransformationCandidate({
      plan,
      candidate:{
        domainId:'D03',evidenceRefs:['x'],rollbackRef:'r',compatibilityVerified:true,
        aiOutputSourceTruth:true,
      },
    }),
    (error)=>error instanceof DomainTransformationError
      && error.code==='TRANSFORMATION_AUTHORITY_ESCALATION',
  );
});

test('partial schema map blocks candidate build even when schema refs are present',()=>{
  const plan=buildDomainTransformationPlan(intake({schemaMapStatus:'PARTIAL'}));
  assert.equal(plan.candidateBuildAllowed,false);
  assert.ok(plan.blockers.includes('SCHEMA_MAP_INCOMPLETE'));
});

test('partial owner command map blocks candidate build even when owner refs are present',()=>{
  const plan=buildDomainTransformationPlan(intake({ownerCommandMapStatus:'PARTIAL'}));
  assert.equal(plan.candidateBuildAllowed,false);
  assert.ok(plan.blockers.includes('OWNER_COMMAND_MAP_INCOMPLETE'));
});

test('partial result or compatibility maps block candidate build independently',()=>{
  const resultPlan=buildDomainTransformationPlan(intake({processResultMapStatus:'PARTIAL'}));
  assert.equal(resultPlan.candidateBuildAllowed,false);
  assert.ok(resultPlan.blockers.includes('PROCESS_RESULT_MAP_INCOMPLETE'));

  const compatibilityPlan=buildDomainTransformationPlan(intake({compatibilityMapStatus:'PARTIAL'}));
  assert.equal(compatibilityPlan.candidateBuildAllowed,false);
  assert.ok(compatibilityPlan.blockers.includes('COMPATIBILITY_MAP_INCOMPLETE'));
});

test('missing rollback plan blocks candidate build',()=>{
  const plan=buildDomainTransformationPlan(intake({rollbackPlanStatus:'PENDING'}));
  assert.equal(plan.candidateBuildAllowed,false);
  assert.ok(plan.blockers.includes('ROLLBACK_PLAN_REQUIRED'));
});
