import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateFactory2DomainEngineering,Factory2DomainEngineeringError} from '../src/factory2/products/domain-engineering/domain-engineering.mjs';
import {buildFactory2StudioModel,Factory2DomainStudioError} from '../src/factory2/products/domain-studio/domain-studio.mjs';

const SHA='1'.repeat(64);
function transformation(){
  return {
    intake:{
      domainId:'D02',productName:'Neutral Owner-Supplied Test Domain',currentSourceRef:'sha256:'+SHA,
      authorityStatus:'AUTHORITY_BOUND_PRODUCT_LOGIC',
      ownerRefs:['service:neutral-owner'],sourceTruthRefs:['source:'+SHA],schemaRefs:['schema:neutral'],
      schemaMapStatus:'PENDING',ownerCommandMapStatus:'PENDING',processResultMapStatus:'PENDING',compatibilityMapStatus:'PENDING',rollbackPlanStatus:'PENDING',
      activeAiAuthority:false,genericWriteAuthority:false,productionActivation:false,
    },
    schemaMap:{
      domainId:'D02',currentSourceSha256:SHA,targetSchemaIds:['neutral'],
      mappings:[{targetSchemaId:'neutral',status:'BOUND',ownerRef:'service:neutral-owner',sourceSchemaRefs:['schema:neutral'],migrationRefs:[],evidenceRefs:['source:neutral-schema']}],
      genericWriteAuthority:false,
    },
    ownerCommandMap:{
      domainId:'D02',currentSourceSha256:SHA,
      entries:[{component:'neutral',ownerRef:'service:neutral-owner',status:'BOUND',commandIds:['neutral.create'],evidenceRefs:['source:neutral-command']}],
      genericWriteAuthority:false,workspaceMayBecomeBusinessOwner:false,
    },
    resultAcceptanceMap:{
      domainId:'D02',currentSourceSha256:SHA,persistentAuthorityStatus:'BOUND',
      entries:[{resultKind:'neutral-result',producerRef:'service:neutral-owner',status:'BOUND',acceptedResultRefs:['source:neutral-result'],inputAcceptanceEvidenceRefs:[],acceptanceCriteriaRefs:['source:criterion'],provenanceRefs:['source:provenance'],limitations:[],evidenceRefs:['source:result-evidence']}],
      genericWriteAuthority:false,commonProjectProcessResultWriterAllowed:false,commonAcceptanceWriterAllowed:false,
    },
    compatibilityMap:{
      domainId:'D02',currentSourceSha256:SHA,
      entries:[{subject:'stored-data',status:'BOUND',guarantees:['identity preserved'],migrationRefs:[],limitations:[],evidenceRefs:['source:compatibility']}],
      destructiveMigrationAuthorized:false,productionActivation:false,
    },
    rollbackPlan:{
      domainId:'D02',baselineSourceRef:'sha256:'+SHA,acceptedStateRef:'state:neutral-accepted',rollbackEvidenceRef:'source:rollback',
      limitations:[],verificationSteps:['verify exact source identity'],executionAuthorized:false,destructiveCleanupAuthorized:false,productionActivation:false,
    },
  };
}
test('Factory 2 Domain Engineering accepts only explicit owner-supplied source context',()=>{
  assert.throws(()=>evaluateFactory2DomainEngineering({
    sourceOrigin:'HISTORICAL_DOMAIN_RUN',productionActivation:false,genericWriteAuthority:false,transformation:transformation(),
  }),(e)=>e instanceof Factory2DomainEngineeringError&&e.code==='FACTORY2_ENGINEERING_SOURCE_ORIGIN_REQUIRED');
});
test('Factory 2 Domain Engineering orchestrates current transformation gate without granting writes',()=>{
  const result=evaluateFactory2DomainEngineering({
    sourceOrigin:'OWNER_SUPPLIED_AT_TEST_TIME',productionActivation:false,genericWriteAuthority:false,transformation:transformation(),
  });
  assert.equal(result.status,'CANDIDATE_ENGINEERING_READY');
  assert.equal(result.candidateBuildAllowed,true);
  assert.equal(result.genericWriteAuthority,false);
  assert.equal(result.ownerApprovalGranted,false);
  assert.equal(result.productionActivation,false);
});
test('Factory 2 Studio is a read/human-review surface, never direct execution authority',()=>{
  const engineering=evaluateFactory2DomainEngineering({
    sourceOrigin:'OWNER_SUPPLIED_AT_TEST_TIME',productionActivation:false,genericWriteAuthority:false,transformation:transformation(),
    candidate:{domainId:'D02',evidenceRefs:['test:neutral-evidence'],rollbackRef:'source:rollback',compatibilityVerified:true,genericWriteAuthority:false,aiOutputSourceTruth:false,productionActivation:false},
  });
  const studio=buildFactory2StudioModel(engineering);
  assert.equal(studio.product,'domain-studio');
  assert.equal(studio.humanReviewRequired,true);
  assert.deepEqual(studio.availableActions,['OPEN_HUMAN_REVIEW']);
  assert.equal(studio.directExecutionAllowed,false);
  assert.equal(studio.ownerApprovalGranted,false);
  assert.equal(studio.genericWriteAuthority,false);
  assert.equal(studio.productionActivation,false);
});

test('Factory 2 Studio rejects authority-escalating Engineering session',()=>{
  const session={
    schema:'IWXA_T2_FACTORY2_DOMAIN_ENGINEERING_SESSION_V1',generation:2,domainId:'D03',
    sourceOrigin:'OWNER_SUPPLIED_AT_TEST_TIME',sourceSha256:'2'.repeat(64),genericWriteAuthority:true,
    ownerApprovalGranted:false,productionActivation:false,
  };
  assert.throws(()=>buildFactory2StudioModel(session),(error)=>error instanceof Factory2DomainStudioError&&error.code==='FACTORY2_STUDIO_AUTHORITY_ESCALATION');
});
