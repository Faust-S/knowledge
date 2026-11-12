import test from 'node:test';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runStudy} from '../k05_commercial_ablation.mjs';
import {verifyK01ProjectEvidence} from '../k05_k01_evidence_check.mjs';

const root=process.env.K05_K01_OWNER_ROOT;
async function owner(){
 assert.ok(root,'K05_K01_OWNER_ROOT is required');
 const folder=resolve(root);
 const fixture=await import(pathToFileURL(join(folder,
  'modules/k01-context/tests/fixtures/commercial-project.mjs')).href);
 const k01=await import(pathToFileURL(join(folder,
  'modules/k01-context/integrations/project-continuation.mjs')).href);
 return {fixture,k01};
}
test('four real method implementations, same 4 controlled project states',async()=>{
 const result=await runStudy(root);
 assert.equal(result.scenarios.length,4);
 assert.deepEqual(result.scenarios.map(s=>s.caseId),[
  'approved','revised','conflicting_approved_decisions','unavailable_accepted_quote'
 ]);
 const methods=['DIRECT_FULL_READ_FIRST_MATCH_PROXY','EXACT_SEARCH_LATEST_APPROVED_PROXY',
  'K01_CONTEXT_ONLY','K01_PLUS_K05_SOURCE_CHECK'];
 for(const scenario of result.scenarios){
  assert.deepEqual(scenario.methods.map(s=>s.method),methods);
  assert.ok(scenario.methods.every(m=>m.assessment.denominator===14));
  assert.ok(scenario.methods.every(m=>m.metrics.hostReads>=0));
  assert.ok(scenario.methods.every(m=>Number.isFinite(m.metrics.elapsedMs)));
  const [full,search,k01,k05]=scenario.methods;
  assert.equal(k01.assessment.fixtureMismatches,0);
  assert.equal(k05.assessment.fixtureMismatches,0);
  assert.deepEqual(k01.assessment,k05.assessment);
  assert.equal(k05.metrics.hostReads,k01.metrics.hostReads);
  assert.equal(k05.metrics.additionalHostReads,0);
  assert.ok(k05.metrics.additionalVerificationBytes>0);
  assert.equal(k05.provenance.status,'SOURCE_LINES_VERIFIED_NOT_SEMANTIC_GOLD');
  assert.equal(k05.provenance.confirmed>0,true);
  assert.ok(full.metrics.bytesRead>=search.metrics.contextBytes);
  assert.equal(k01.assessment.precision,null);
 }
 assert.equal(result.constraints.llmCalls,0);
 assert.equal(result.constraints.independentHumanGold,false);
 assert.equal(result.constraints.precision,null);
 assert.equal(result.constraints.measuredComputeCostUsd,null);
});
test('conflict is abstained; inaccessible current quote does not invent current terms',async()=>{
 const result=await runStudy(root);
 const byId=Object.fromEntries(result.scenarios.map(x=>[x.caseId,x]));
 const conflict=byId.conflicting_approved_decisions.methods[2];
 assert.equal(conflict.assessment.desiredAbstentions,1);
 assert.equal(conflict.assessment.unjustifiedAssertions,0);
 assert.ok(conflict.issues.some(x=>x.type==='contradiction'&&x.fieldKey==='advance'));
 const unavailable=byId.unavailable_accepted_quote.methods[2];
 assert.ok(unavailable.assessment.desiredAbstentions>=5);
 assert.ok(unavailable.issues.some(x=>x.type==='source_unavailable'));
 const revised=byId.revised.methods[2];
 assert.equal(revised.assessment.fixtureMatches,14);
 assert.equal(revised.assessment.missing,0);
});
test('K05 independently verifies actual owner line locators and revision from authorized bytes',async()=>{
 const {fixture,k01}=await owner();
 const host=fixture.makeCommercialCase({updated:true});
 const p=await k01.prepareProjectContinuation(host.request,host.sourcePort);
 const proof=verifyK01ProjectEvidence(p,host.documents);
 assert.equal(proof.confirmed,18);
 assert.equal(proof.metrics.hostReadsByK05,0);
 assert.equal(proof.epistemic.taskAccepted,false);
 assert.equal(proof.epistemic.agentResultReadback,'NOT_TESTED');
 assert.ok(!JSON.stringify(proof).includes('412000 руб.'));
});
test('forged locator, claim excerpt, revision, source bytes, field coverage rejected',async()=>{
 const {fixture,k01}=await owner();
 const host=fixture.makeCommercialCase();
 const p=await k01.prepareProjectContinuation(host.request,host.sourcePort);
 for(const mutate of [
  copy=>{copy.projection.selected[0].evidenceRef='line:777777';},
  copy=>{copy.projection.selected[0].excerpt='Invented: 999999';},
  copy=>{copy.projection.selected[0].revision='sha256:'+'0'.repeat(64);},
  copy=>{copy.covered.pop();},
  copy=>{copy.projection.selected[0].sourceRef='doc:quote-old';},
 ]){
  const changed=structuredClone(p);mutate(changed);
  assert.throws(()=>verifyK01ProjectEvidence(changed,host.documents),/K05_K01_EVIDENCE_/);
 }
 const tampered=structuredClone(host.documents);
 tampered[0].content+='SECRET_CHANGE';
 assert.throws(()=>verifyK01ProjectEvidence(p,tampered),/K05_K01_EVIDENCE_SOURCE_BYTES_MISMATCH/);
});
test('unverified duplicate or different Workspace source cannot be treated as evidence',async()=>{
 const {fixture,k01}=await owner();
 const host=fixture.makeCommercialCase();
 const p=await k01.prepareProjectContinuation(host.request,host.sourcePort);
 const duplicated=[...host.documents,structuredClone(host.documents[0])];
 assert.throws(()=>verifyK01ProjectEvidence(p,duplicated),
  /K05_K01_EVIDENCE_SOURCE_CATALOG_INVALID/);
 const wrong=structuredClone(host.documents);
 wrong[0].workspaceRef='commercial:elsewhere';
 assert.throws(()=>verifyK01ProjectEvidence(p,wrong),
  /K05_K01_EVIDENCE_SOURCE_CATALOG_INVALID/);
});
