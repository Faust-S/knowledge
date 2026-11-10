import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {initFactory2DomainRun,evaluateFactory2DomainRun,submitFactory2DomainRun,decideFactory2DomainRun} from '../scripts/factory2-domain-run-cli.mjs';

const SOURCE_ZIP=Buffer.from('UEsDBBQAAAAAAAAAIQDqnHnKIAAAACAAAAARAAAAZG9tYWluLXNvdXJjZS50eHRmYWN0b3J5MiBzeW50aGV0aWMgb3duZXIgc291cmNlClBLAQIUAxQAAAAAAAAAIQDqnHnKIAAAACAAAAARAAAAAAAAAAAAAACAAQAAAABkb21haW4tc291cmNlLnR4dFBLBQYAAAAAAQABAD8AAABPAAAAAAA=','base64');

test('Factory 2 domain-run init preserves a valid owner-supplied ZIP and creates no authority',()=>{
  const d=mkdtempSync(join(tmpdir(),'f2-run-')),src=join(d,'source.zip'),out=join(d,'run');
  writeFileSync(src,SOURCE_ZIP);
  const s=initFactory2DomainRun({sourceZip:src,domainId:'D03',out});
  assert.equal(s.status,'BOOTSTRAPPED');
  assert.equal(s.sourceArchiveFormat,'ZIP');
  assert.equal(s.sourceArchiveEntryCount,1);
  assert.match(s.sourceSha256,/^[0-9a-f]{64}$/);
  const b=JSON.parse(readFileSync(join(out,'ENGINEERING_BOOTSTRAP.json'),'utf8'));
  assert.equal(b.productionActivation,false);
});

test('Studio decision cannot be applied before submission',()=>{
  const d=mkdtempSync(join(tmpdir(),'f2-run-')),src=join(d,'source.zip'),out=join(d,'run');
  writeFileSync(src,SOURCE_ZIP);
  initFactory2DomainRun({sourceZip:src,domainId:'D02',out});
  assert.throws(()=>decideFactory2DomainRun(out,{schema:'IWXA_T2_FACTORY2_STUDIO_HUMAN_DECISION_V1',decisionSource:'HUMAN_EXPLICIT',decision:'APPROVE'}),/NOT_SUBMITTED/);
});

test('Factory 2 ONE_DAY is a real bounded execution profile with unchanged authority boundary',()=>{
  const d=mkdtempSync(join(tmpdir(),'f2-one-day-')),src=join(d,'source.zip'),out=join(d,'run');
  writeFileSync(src,SOURCE_ZIP);
  const s=initFactory2DomainRun({sourceZip:src,domainId:'D04',out,executionProfile:'ONE_DAY'});
  assert.equal(s.executionProfile,'ONE_DAY');
  const b=JSON.parse(readFileSync(join(out,'ENGINEERING_BOOTSTRAP.json'),'utf8'));
  assert.equal(b.productionActivation,false);
  assert.equal(b.ownerApprovalGranted,false);
});

test('Factory 2 domain-run rejects non-ZIP owner source bytes',()=>{
  const d=mkdtempSync(join(tmpdir(),'f2-run-invalid-')),src=join(d,'source.zip'),out=join(d,'run');
  writeFileSync(src,Buffer.from('not a zip'));
  assert.throws(()=>initFactory2DomainRun({sourceZip:src,domainId:'D03',out}),/SOURCE_ZIP_INVALID/);
});

function engineeringInput(domainId,sourceSha256){return {sourceOrigin:'OWNER_SUPPLIED_AT_TEST_TIME',genericWriteAuthority:false,productionActivation:false,transformation:{intake:{domainId,productName:'Regression Domain',currentSourceRef:'sha256:'+sourceSha256,authorityStatus:'AUTHORITY_BOUND_PRODUCT_LOGIC',ownerRefs:['owner:regression'],sourceTruthRefs:['source:regression'],schemaRefs:['schema:regression'],schemaMapStatus:'COMPLETE',ownerCommandMapStatus:'COMPLETE',processResultMapStatus:'COMPLETE',compatibilityMapStatus:'COMPLETE',rollbackPlanStatus:'COMPLETE',compatibilityConstraints:[]},schemaMap:{domainId,currentSourceSha256:sourceSha256,targetSchemaIds:['neutral-object'],mappings:[{targetSchemaId:'neutral-object',status:'BOUND',ownerRef:'owner:regression',sourceSchemaRefs:['schema:neutral-object'],migrationRefs:[],evidenceRefs:['evidence:schema']}],genericWriteAuthority:false},ownerCommandMap:{domainId,sourceSha256,entries:[{component:'owner',ownerRef:'owner:regression',status:'BOUND',commandIds:['regression.create'],evidenceRefs:['evidence:command']}],genericWriteAuthority:false,workspaceMayBecomeBusinessOwner:false},resultAcceptanceMap:{domainId,currentSourceSha256:sourceSha256,persistentAuthorityStatus:'BOUND',entries:[{resultKind:'regression-result',producerRef:'owner:regression',status:'BOUND',acceptedResultRefs:['result:regression'],inputAcceptanceEvidenceRefs:[],acceptanceCriteriaRefs:['criteria:regression'],provenanceRefs:['provenance:regression'],limitations:[],evidenceRefs:['evidence:result']}],genericWriteAuthority:false,commonProjectProcessResultWriterAllowed:false,commonAcceptanceWriterAllowed:false},compatibilityMap:{domainId,currentSourceSha256:sourceSha256,entries:[{subject:'state',status:'BOUND',guarantees:['identity'],migrationRefs:[],limitations:[],evidenceRefs:['evidence:compat']}],destructiveMigrationAuthorized:false,productionActivation:false},rollbackPlan:{domainId,baselineSourceRef:'sha256:'+sourceSha256,acceptedStateRef:'state:regression',rollbackEvidenceRef:'evidence:rollback',limitations:[],verificationSteps:['verify'],executionAuthorized:false,destructiveCleanupAuthorized:false,productionActivation:false}},candidate:{domainId,evidenceRefs:['evidence:candidate'],rollbackRef:'evidence:rollback',compatibilityVerified:true,genericWriteAuthority:false,aiOutputSourceTruth:false,hiddenWritesAllowed:false,genericPutObjectAllowed:false,productionActivation:false}};}
function readyRun(){const d=mkdtempSync(join(tmpdir(),'f2-ready-')),src=join(d,'source.zip'),out=join(d,'run');writeFileSync(src,SOURCE_ZIP);const state=initFactory2DomainRun({sourceZip:src,domainId:'D03',out});writeFileSync(join(out,'engineering-input.json'),JSON.stringify(engineeringInput('D03',state.sourceSha256),null,2)+'\n');const evaluated=evaluateFactory2DomainRun(out);assert.equal(evaluated.status,'READY_FOR_STUDIO_SUBMISSION');return {out,state};}
test('Factory 2 domain-run evaluation binds Engineering session to the exact bootstrapped source',()=>{const d=mkdtempSync(join(tmpdir(),'f2-mismatch-')),src=join(d,'source.zip'),out=join(d,'run');writeFileSync(src,SOURCE_ZIP);initFactory2DomainRun({sourceZip:src,domainId:'D03',out});writeFileSync(join(out,'engineering-input.json'),JSON.stringify(engineeringInput('D03','8'.repeat(64)),null,2)+'\n');assert.throws(()=>evaluateFactory2DomainRun(out),/SUBJECT_MISMATCH:ENGINEERING_SESSION/);});
test('Factory 2 submission rejects a tampered Engineering session subject',()=>{const {out}=readyRun();const session=JSON.parse(readFileSync(join(out,'ENGINEERING_SESSION.json'),'utf8'));session.sourceSha256='7'.repeat(64);writeFileSync(join(out,'ENGINEERING_SESSION.json'),JSON.stringify(session,null,2)+'\n');assert.throws(()=>submitFactory2DomainRun(out),/ARTIFACT_BYTES_CHANGED:ENGINEERING_SESSION|SUBJECT_MISMATCH:ENGINEERING_SESSION/);});
test('Factory 2 Studio terminal decision requires decision identity metadata',()=>{const {out,state}=readyRun();submitFactory2DomainRun(out);assert.throws(()=>decideFactory2DomainRun(out,{schema:'IWXA_T2_FACTORY2_STUDIO_HUMAN_DECISION_V1',decisionSource:'HUMAN_EXPLICIT',decision:'APPROVE',domainId:'D03',sourceSha256:state.sourceSha256,decidedBy:'owner',decidedAt:'2026-09-29T00:00:00Z'}),/DECISION_ID_REQUIRED/);});
test('Factory 2 terminal run cannot be resubmitted',()=>{const {out,state}=readyRun();submitFactory2DomainRun(out);decideFactory2DomainRun(out,{schema:'IWXA_T2_FACTORY2_STUDIO_HUMAN_DECISION_V1',decisionSource:'HUMAN_EXPLICIT',decision:'APPROVE',domainId:'D03',sourceSha256:state.sourceSha256,decisionId:'D-1',decidedBy:'owner',decidedAt:'2026-09-29T00:00:00Z'});assert.throws(()=>submitFactory2DomainRun(out),/NOT_READY_FOR_SUBMISSION/);});

test('Factory 2 domain-run detects source ZIP mutation after bootstrap',()=>{
  const d=mkdtempSync(join(tmpdir(),'f2-source-mutation-')),src=join(d,'source.zip'),out=join(d,'run');
  writeFileSync(src,SOURCE_ZIP);
  const state=initFactory2DomainRun({sourceZip:src,domainId:'D03',out});
  writeFileSync(join(out,'engineering-input.json'),JSON.stringify(engineeringInput('D03',state.sourceSha256),null,2)+'\n');
  const mutated=Buffer.from(SOURCE_ZIP); mutated[mutated.length-1]^=1;
  writeFileSync(join(out,'input','domain-source.zip'),mutated);
  assert.throws(()=>evaluateFactory2DomainRun(out),/SOURCE_BYTES_CHANGED|SOURCE_ZIP_INVALID/);
});

test('Factory 2 submission rejects same-subject Engineering session byte tampering',()=>{const {out}=readyRun();const session=JSON.parse(readFileSync(join(out,'ENGINEERING_SESSION.json'),'utf8'));session.candidateValidation.evidenceRefs=['evidence:tampered'];writeFileSync(join(out,'ENGINEERING_SESSION.json'),JSON.stringify(session,null,2)+'\n');assert.throws(()=>submitFactory2DomainRun(out),/ARTIFACT_BYTES_CHANGED:ENGINEERING_SESSION/);});
test('Factory 2 submission rejects Engineering input changes after evaluation',()=>{const {out}=readyRun();const input=JSON.parse(readFileSync(join(out,'engineering-input.json'),'utf8'));input.candidate.evidenceRefs=['evidence:changed-after-evaluate'];writeFileSync(join(out,'engineering-input.json'),JSON.stringify(input,null,2)+'\n');assert.throws(()=>submitFactory2DomainRun(out),/ARTIFACT_BYTES_CHANGED:ENGINEERING_INPUT/);});
test('Factory 2 Studio decision rejects same-subject submission byte tampering',()=>{const {out,state}=readyRun();submitFactory2DomainRun(out);const submission=JSON.parse(readFileSync(join(out,'STUDIO_SUBMISSION.json'),'utf8'));submission.evidenceRefs=['evidence:tampered'];writeFileSync(join(out,'STUDIO_SUBMISSION.json'),JSON.stringify(submission,null,2)+'\n');assert.throws(()=>decideFactory2DomainRun(out,{schema:'IWXA_T2_FACTORY2_STUDIO_HUMAN_DECISION_V1',decisionSource:'HUMAN_EXPLICIT',decision:'APPROVE',domainId:'D03',sourceSha256:state.sourceSha256,decisionId:'D-2',decidedBy:'owner',decidedAt:'2026-09-29T00:00:00Z'}),/ARTIFACT_BYTES_CHANGED:STUDIO_SUBMISSION/);});
