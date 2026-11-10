import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {initFactory2DomainRun,evaluateFactory2DomainRun,submitFactory2DomainRun,decideFactory2DomainRun} from '../scripts/factory2-domain-run-cli.mjs';
import {domainResultAuthority,domainResultAuthorityReadiness,bindDomainNativeResultAuthority,validateFutureDomainAuthorityRegistration} from '../src/modules/base/features/project-process/domain-result-authority-registry.mjs';
import {buildDomainTransformationPlan} from '../src/modules/base/features/domain-transformation/domain-transformation-kit.mjs';
import {qualifyFactory2DomainProduct} from '../src/factory2/products/domain-completion/product-completion.mjs';
import {buildFactory2StudioModel} from '../src/factory2/products/domain-studio/domain-studio.mjs';

const ZIP=Buffer.from('UEsDBBQAAAAAAAAAIQDqnHnKIAAAACAAAAARAAAAZG9tYWluLXNvdXJjZS50eHRmYWN0b3J5MiBzeW50aGV0aWMgb3duZXIgc291cmNlClBLAQIUAxQAAAAAAAAAIQDqnHnKIAAAACAAAAARAAAAAAAAAAAAAACAAQAAAABkb21haW4tc291cmNlLnR4dFBLBQYAAAAAAQABAD8AAABPAAAAAAA=','base64');
function source(){const dir=mkdtempSync(join(tmpdir(),'factory2-future-'));const zip=join(dir,'domain.zip');writeFileSync(zip,ZIP);return {dir,zip};}
test('future D13 and D100 can enter Factory Domain Run without predefined domain business grants',()=>{
 for(const domainId of ['D13','D100','D999']){
  const {dir,zip}=source(),out=join(dir,'run');
  const s=initFactory2DomainRun({sourceZip:zip,domainId,out});
  assert.equal(s.domainId,domainId);
  assert.equal(s.productionActivation,false);
  assert.equal(JSON.parse(readFileSync(join(out,'DOMAIN_RUN.json'),'utf8')).status,'BOOTSTRAPPED');
  const a=domainResultAuthorityReadiness(domainId);
  assert.equal(a.status,'OWNER_DECISION_REQUIRED');
  assert.equal(a.sourceTruthBindingAllowed,false);
  assert.equal(a.reason,'DOMAIN_AUTHORITY_REGISTRATION_REQUIRED');
  assert.throws(()=>domainResultAuthority(domainId),/UNKNOWN_T2_DOMAIN_RESULT_AUTHORITY|unknown T2 domain/i);
 }
});
test('invalid IDs D00 D0 D1 and arbitrary registry identifiers are rejected',()=>{
 for(const domainId of ['D00','D0','D1','DOMAIN13','D-13','D013']){
  const {dir,zip}=source();
  assert.throws(()=>initFactory2DomainRun({sourceZip:zip,domainId,out:join(dir,'run')}),/DOMAIN_ID_INVALID/);
 }
});
test('unknown future domain cannot invent canonical persistent Result authority',()=>{
 const intake={domainId:'D13',productName:'Future domain',currentSourceRef:'sha256:'+'a'.repeat(64),
 authorityStatus:'AUTHORITY_BOUND_PRODUCT_LOGIC',ownerRefs:['owner:d13'],sourceTruthRefs:['source:d13'],schemaRefs:['schema:d13'],schemaMapStatus:'COMPLETE',ownerCommandMapStatus:'COMPLETE',processResultMapStatus:'COMPLETE',compatibilityMapStatus:'COMPLETE',rollbackPlanStatus:'COMPLETE'};
 assert.throws(()=>buildDomainTransformationPlan(intake),{code:'TRANSFORMATION_AUTHORITY_REGISTRY_MISMATCH'});
 const plan=buildDomainTransformationPlan({...intake,authorityStatus:'OWNER_DECISION_REQUIRED'});
 assert.equal(plan.candidateBuildAllowed,true);
 assert.equal(plan.persistentResultBindingAllowed,false);
 assert.equal(plan.ownerDecisionRequired,true);
});
test('Factory Studio accepts exact future-domain Engineering identity but cannot self-approve',()=>{
 const engineering={schema:'IWXA_T2_FACTORY2_DOMAIN_ENGINEERING_SESSION_V1',generation:2,
 domainId:'D13',sourceSha256:'1'.repeat(64),sourceOrigin:'OWNER_SUPPLIED_AT_TEST_TIME',
 genericWriteAuthority:false,ownerApprovalGranted:false,productionActivation:false,
 sourceBytesVerified:false,derived:{},blockers:[],candidateRequirements:{},candidateValidation:null,status:'ENGINEERING_BLOCKED'};
 const studio=buildFactory2StudioModel(engineering);
 assert.equal(studio.domainId,'D13');
 assert.equal(studio.ownerApprovalGranted,false);
 assert.equal(studio.humanReviewRequired,false);
});

test('canonical future registration parser never mutates registry or creates Human decision',()=>{
 for(const domainId of ['D13','D100']){
  assert.throws(()=>validateFutureDomainAuthorityRegistration({domainId,canonicalAuthorityCore:'invented'}),{code:'DOMAIN_AUTHORITY_REGISTRATION_INVALID'});
  assert.throws(()=>bindDomainNativeResultAuthority(domainId,{}),{code:'OWNER_DECISION_REQUIRED'});
  assert.equal(domainResultAuthorityReadiness(domainId).sourceTruthBindingAllowed,false);
 }
});

test('D13 and D100 complete executable intake/Engineering/Studio traversal while genuine Human authority remains required',async()=>{
 for(const domainId of ['D13','D100']){
  const {dir,zip}=source(),run=join(dir,'run');const initial=initFactory2DomainRun({sourceZip:zip,domainId,out:run});
  const template=JSON.parse(readFileSync(join(run,'engineering-input.template.json'),'utf8'));
  const sourceSha256=initial.sourceSha256;
  template.transformation.schemaMap={domainId,currentSourceSha256:sourceSha256,targetSchemaIds:['fixture.note'],mappings:[{targetSchemaId:'fixture.note',status:'SOURCE_INSPECTION_REQUIRED'}],genericWriteAuthority:false};
  template.transformation.ownerCommandMap={domainId,sourceSha256,entries:[{component:'fixture',ownerRef:'source:synthetic-fixture',status:'COMMAND_INSPECTION_REQUIRED',commandIds:[]}],genericWriteAuthority:false};
  template.transformation.resultAcceptanceMap={domainId,currentSourceSha256:sourceSha256,persistentAuthorityStatus:'OWNER_DECISION_REQUIRED',entries:[{resultKind:'fixture-result',producerRef:'source:synthetic-fixture',status:'ACCEPTANCE_CRITERIA_INSPECTION_REQUIRED'}],genericWriteAuthority:false};
  template.transformation.compatibilityMap={domainId,currentSourceSha256:sourceSha256,entries:[{subject:'fixture-source',status:'SOURCE_INSPECTION_REQUIRED'}],destructiveMigrationAuthorized:false,productionActivation:false};
  template.transformation.rollbackPlan={domainId,baselineSourceRef:'sha256:'+sourceSha256,acceptedStateRef:'input/domain-source.zip',rollbackEvidenceRef:'sha256:'+sourceSha256,verificationSteps:['Verify preserved source ZIP SHA-256 before any writes'],executionAuthorized:false,productionActivation:false};
  writeFileSync(join(run,'engineering-input.json'),JSON.stringify(template));
  const evaluated=evaluateFactory2DomainRun(run);assert.equal(evaluated.status,'ENGINEERING_BLOCKED');
  const studio=JSON.parse(readFileSync(join(run,'STUDIO_MODEL.json'),'utf8'));assert.equal(studio.domainId,domainId);assert.equal(studio.qualificationStages.human,'HUMAN_DECISION_REQUIRED');
  assert.throws(()=>submitFactory2DomainRun(run),/NOT_READY_FOR_SUBMISSION/);assert.throws(()=>decideFactory2DomainRun(run,{decision:'APPROVE'}),/NOT_SUBMITTED/);
  await assert.rejects(()=>qualifyFactory2DomainProduct({runRoot:run,siteRoot:dir,runState:evaluated,canonicalRoot:dir}),/HUMAN_READY_REQUIRED/);
  assert.equal(domainResultAuthorityReadiness(initial.domainId).status,'OWNER_DECISION_REQUIRED');
 }
});
