import test from 'node:test';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {reviewK01ProjectRefresh,K05_K01_REFRESH_REVIEW} from '../k05_k01_refresh_review.mjs';
import {verifyK01ProjectEvidence} from '../k05_k01_evidence_check.mjs';
import {studyK01Refresh} from '../k05_k01_refresh_study.mjs';

const root=process.env.K05_K01_OWNER_ROOT;
async function owner(){
 assert.ok(root,'K05_K01_OWNER_ROOT_REQUIRED');
 const base=resolve(root);
 const mod=await import(pathToFileURL(join(base,
  'modules/k01-context/integrations/project-continuation.mjs')).href);
 const fixture=await import(pathToFileURL(join(base,
  'modules/k01-context/tests/fixtures/commercial-project.mjs')).href);
 assert.equal(mod.PROJECT_CONTINUATION_VERSION,'0.1.1');
 assert.equal(mod.PROJECT_REFRESH_VERSION,'0.1.0');
 return {mod,fixture};
}
async function beforeAfter(opts={}){
 const {mod,fixture}=await owner();
 const old=fixture.makeCommercialCase();
 const saved=await mod.prepareProjectContinuation(old.request,old.sourcePort);
 const current=fixture.makeCommercialCase(opts);
 const ownerReceipt=await mod.refreshProjectContinuation(saved,current.request,current.sourcePort);
 const proof=reviewK01ProjectRefresh({
  saved,ownerRefresh:ownerReceipt,
  previousAuthorizedDocuments:old.documents,
  currentAuthorizedDocuments:current.documents
 });
 return {old,current,saved,ownerReceipt,proof,mod};
}
test('latest K01 0.1.1 source proof works; historical K05 0.1.0 still supported',async()=>{
 const {fixture,mod}=await owner();
 const host=fixture.makeCommercialCase();
 const saved=await mod.prepareProjectContinuation(host.request,host.sourcePort);
 assert.equal(saved.contractVersion,'0.1.1');
 const proof=verifyK01ProjectEvidence(saved,host.documents);
 assert.equal(proof.status,'SOURCE_LINES_VERIFIED_NOT_SEMANTIC_GOLD');
 assert.ok(proof.confirmed>0);
 const legacy=structuredClone(saved);
 legacy.contractVersion='0.1.0';
 delete legacy.sourceRevisions;
 delete legacy.catalogBinding;
 assert.equal(verifyK01ProjectEvidence(legacy,host.documents).confirmed,proof.confirmed);
});
test('unchanged K01 owner refresh is reusable, but only after fresh owner read',async()=>{
 const {current,ownerReceipt,proof}=await beforeAfter();
 assert.equal(ownerReceipt.status,'CURRENT');
 assert.equal(proof.schema,K05_K01_REFRESH_REVIEW);
 assert.equal(proof.status,'SOURCE_BOUND_REUSABLE');
 assert.equal(proof.unchangedClaims,true);
 assert.equal(proof.pastSourceProof,'PINNED_LINES_VERIFIED_HISTORICAL_ONLY');
 assert.equal(proof.metrics.k05HostReads,0);
 assert.ok(proof.metrics.k05RehashedSourceBytes>0);
 assert.equal(proof.quality.semanticTruth,'NOT_MEASURED');
 assert.equal(proof.quality.taskAccepted,false);
 assert.ok(current.getMetrics().reads>0);
 assert.equal(current.getMetrics().lists,2);
});
test('revised accepted commercial proposal: K05 refuses to call old evidence current',async()=>{
 const {saved,old,current,ownerReceipt,proof}=await beforeAfter({updated:true});
 assert.equal(ownerReceipt.status,'UPDATED');
 assert.equal(proof.status,'REVIEW_REQUIRED');
 assert.equal(proof.unchangedClaims,false);
 assert.ok(proof.changeCounts.fields>=7);
 assert.ok(proof.changeCounts.sources>=1);
 assert.equal(proof.latestClaimCount,18);
 assert.equal(proof.metrics.k05HostReads,0);
 assert.ok(current.getMetrics().reads>0);
 const historic=verifyK01ProjectEvidence(saved,old.documents);
 assert.equal(historic.status,'SOURCE_LINES_VERIFIED_NOT_SEMANTIC_GOLD');
 // A historically true source SHA proves nothing about the NEW approval.
 assert.equal(proof.pastSourceProof,'PINNED_LINES_VERIFIED_HISTORICAL_ONLY');
});
test('conflicting accepted decisions force review, no automatic adjudication',async()=>{
 const {ownerReceipt,proof}=await beforeAfter({addConflict:true});
 assert.equal(ownerReceipt.status,'INCOMPLETE');
 assert.equal(proof.status,'REVIEW_REQUIRED');
 assert.ok(proof.changeCounts.issuesAppeared>0);
 assert.equal(proof.quality.humanGold,false);
 assert.equal(proof.quality.f1,null);
});
test('disappearing signed source blocks stale fallback, and exposes no obsolete fact',async()=>{
 const {mod,fixture}=await owner();
 const initial=fixture.makeCommercialCase();
 const saved=await mod.prepareProjectContinuation(initial.request,initial.sourcePort);
 const next=fixture.makeCommercialCase(),port=next.sourcePort;
 const missing={
  async listSources(args){const c=await port.listSources(args);
   return {...c,sources:c.sources.filter(x=>x.sourceRef!=='doc:quote-approved')};},
  async readSource(args){return port.readSource(args);}
 };
 const receipt=await mod.refreshProjectContinuation(saved,next.request,missing);
 assert.equal(receipt.status,'REJECTED');
 assert.equal(receipt.reason,'selected_source_missing');
 const before=next.getMetrics();
 const proof=reviewK01ProjectRefresh({
  saved,ownerRefresh:receipt,previousAuthorizedDocuments:initial.documents
 });
 assert.equal(proof.status,'NOT_REUSABLE');
 assert.equal(proof.currentSourceProof,'NOT_AVAILABLE');
 assert.equal(proof.pastSourceProof,'NOT_CHECKED_AFTER_REJECTION');
 assert.equal(proof.metrics.k05RehashedSourceBytes,0);
 assert.deepEqual(next.getMetrics(),before);
 const serialized=JSON.stringify(proof);
 assert.equal(serialized.includes('398000 руб.'),false);
 assert.equal(serialized.includes('doc:quote-approved'),false);
});
test('revoked access: K01 rejects without host reads; K05 never touches old bytes',async()=>{
 const {mod,fixture}=await owner();
 const initial=fixture.makeCommercialCase();
 const saved=await mod.prepareProjectContinuation(initial.request,initial.sourcePort);
 const next=fixture.makeCommercialCase();
 const rejectedRequest={...next.request,allowedSources:
  next.request.allowedSources.filter(x=>x!=='doc:quote-approved')};
 const receipt=await mod.refreshProjectContinuation(saved,rejectedRequest,next.sourcePort);
 assert.equal(receipt.reason,'permissions_changed');
 assert.equal(next.getMetrics().reads,0);
 assert.equal(next.getMetrics().lists,0);
 const check=reviewK01ProjectRefresh({
  saved,ownerRefresh:receipt,
  previousAuthorizedDocuments:[{content:'must not be used'}]
 });
 assert.equal(check.status,'NOT_REUSABLE');
 assert.equal(check.metrics.k05RehashedSourceBytes,0);
 assert.equal(next.getMetrics().reads,0);
});
test('K05 fails closed on forged CURRENT, falsified revision or a fake owner status',async()=>{
 const {saved,old,current,ownerReceipt}=await beforeAfter({updated:true});
 const forged={...structuredClone(ownerReceipt),status:'CURRENT',
  requiresReview:false,reusable:true};
 assert.throws(()=>reviewK01ProjectRefresh({
  saved,ownerRefresh:forged,
  previousAuthorizedDocuments:old.documents,
  currentAuthorizedDocuments:current.documents
 }),/K05_K01_REFRESH_FORGED_CURRENT_WITH_CHANGED_SOURCES/);
 const changed=structuredClone(ownerReceipt);
 changed.latest.projection.selected[0].excerpt='Поддельный новый факт: 1 руб.';
 assert.throws(()=>reviewK01ProjectRefresh({
  saved,ownerRefresh:changed,
  previousAuthorizedDocuments:old.documents,
  currentAuthorizedDocuments:current.documents
 }),/K05_K01_EVIDENCE_/);
 const invalid={...ownerReceipt,contractVersion:'0.9.0'};
 assert.throws(()=>reviewK01ProjectRefresh({
  saved,ownerRefresh:invalid
 }),/K05_K01_REFRESH_OWNER_REFRESH_CONTRACT_INVALID/);
});
test('forged CURRENT cannot conceal approval metadata or changed issue roster',async()=>{
 const {saved,old,current,ownerReceipt}=await beforeAfter();
 assert.equal(ownerReceipt.status,'CURRENT');
 const forged=structuredClone(ownerReceipt);
 forged.latest.sourceRevisions[0].metadataBinding='f'.repeat(64);
 assert.throws(()=>reviewK01ProjectRefresh({
  saved,ownerRefresh:forged,
  previousAuthorizedDocuments:old.documents,
  currentAuthorizedDocuments:current.documents
 }),/K05_K01_REFRESH_FORGED_CURRENT_WITH_CHANGED_SOURCES/);
 const changedIssues=structuredClone(ownerReceipt);
 changedIssues.latest.issues.push({fieldKey:'cabinet',type:'pending_change',sources:[]});
 assert.throws(()=>reviewK01ProjectRefresh({
  saved,ownerRefresh:changedIssues,
  previousAuthorizedDocuments:old.documents,
  currentAuthorizedDocuments:current.documents
 }),/K05_K01_REFRESH_FORGED_CURRENT_WITH_CHANGED_SOURCES/);
});
test('K01 source manifest and approval provenance cannot be forged in K05',async()=>{
 const {fixture,mod}=await owner();
 const host=fixture.makeCommercialCase();
 const saved=await mod.prepareProjectContinuation(host.request,host.sourcePort);
 const missing=structuredClone(saved);
 missing.sourceRevisions=[];
 assert.throws(()=>verifyK01ProjectEvidence(missing,host.documents),
  /K05_K01_EVIDENCE_SOURCE_MANIFEST_MISMATCH/);
 const forged=structuredClone(saved);
 forged.sourceRevisions[0].metadataBinding='a';
 assert.throws(()=>verifyK01ProjectEvidence(forged,host.documents),
  /K05_K01_EVIDENCE_SOURCE_MANIFEST_INVALID/);
 const altered=structuredClone(host.documents);
 altered.find(d=>d.sourceRef===saved.projection.selected[0].sourceRef).content+=' \n';
 assert.throws(()=>verifyK01ProjectEvidence(saved,altered),
  /K05_K01_EVIDENCE_SOURCE_BYTES_MISMATCH/);
});
test('K01 newly rejects invalid supersession chronology and scope before any document read',async()=>{
 const {mod,fixture}=await owner();
 const original=fixture.makeCommercialCase();
 const saved=await mod.prepareProjectContinuation(original.request,original.sourcePort);
 const cases=[
  {id:'older_cannot_replace_newer',code:'SUPERSESSION_ORDER_INVALID',change:roster=>{
   roster.find(x=>x.sourceRef==='doc:quote-old').supersedes=['doc:quote-approved'];
   roster.find(x=>x.sourceRef==='doc:quote-approved').supersedes=[];
  }},
  {id:'equal_utc_instants',code:'SUPERSESSION_ORDER_INVALID',change:roster=>{
   roster.find(x=>x.sourceRef==='doc:quote-old').issuedAt='2026-11-04T11:00:00Z';
   roster.find(x=>x.sourceRef==='doc:quote-approved').issuedAt='2026-11-04T14:00:00+03:00';
  }},
  {id:'unapproved_correspondence',code:'SUPERSESSION_NOT_ACCEPTED',change:roster=>{
   roster.find(x=>x.sourceRef==='mail:proposed-discount').supersedes=[
    {sourceRef:'doc:quote-approved',fields:['advance']}];
  }},
  {id:'scope_exceeds_document',code:'SUPERSESSION_SCOPE_INVALID',change:roster=>{
   roster.find(x=>x.sourceRef==='doc:quote-approved').topics=['cabinet'];
  }},
  {id:'invalid_timezone',code:'SOURCE_INVALID',change:roster=>{
   roster.find(x=>x.sourceRef==='doc:quote-old').issuedAt='2026-11-04T14:00:00+15:00';
  }},
 ];
 for(const scenario of cases){
  const next=fixture.makeCommercialCase();
  const port={
   async listSources(args){
    const roster=structuredClone(await next.sourcePort.listSources(args));
    scenario.change(roster.sources);
    return roster;
   },
   async readSource(){throw Error('FAIL_K05_CONSUMER_OWNER_READ_NOT_EXPECTED')}
  };
  await assert.rejects(mod.refreshProjectContinuation(saved,next.request,port),
   new RegExp('K01_CONTINUATION_'+scenario.code),scenario.id);
  assert.equal(next.getMetrics().reads,0,scenario.id);
  // K05 is never asked to infer a refresh status from a failed owner operation.
 }
});
test('metadata of a non-authorized source does not invalidate a proven current K01 Task',async()=>{
 const {mod,fixture}=await owner();
 const prior=fixture.makeCommercialCase();
 const saved=await mod.prepareProjectContinuation(prior.request,prior.sourcePort);
 const current=fixture.makeCommercialCase();
 const port={
  async listSources(args){
   const roster=structuredClone(await current.sourcePort.listSources(args));
   roster.sources.push({sourceRef:'foreign:unpermitted',workspaceRef:'other',
    issuedAt:'malformed',revision:'not-a-digest',state:'not-accepted',
    supersedes:'bad',topics:'bad',kind:'untrusted'});
   return roster;
  },
  async readSource(args){return current.sourcePort.readSource(args)}
 };
 const refresh=await mod.refreshProjectContinuation(saved,current.request,port);
 assert.equal(refresh.status,'CURRENT');
 const proof=reviewK01ProjectRefresh({saved,ownerRefresh:refresh,
  previousAuthorizedDocuments:prior.documents,
  currentAuthorizedDocuments:current.documents});
 assert.equal(proof.status,'SOURCE_BOUND_REUSABLE');
 assert.ok(!JSON.stringify(proof).includes('foreign:unpermitted'));
});
test('unselected proposed-source removal and unavailable proposal are reviewable, not silently current',async()=>{
 const report=await studyK01Refresh(root);
 for(const id of ['unselected_proposal_removed','proposed_letter_unavailable']){
  const row=report.trials.find(x=>x.scenario===id);
  assert.ok(row,id);
  assert.equal(row.status,'UPDATED');
  assert.equal(row.k05Status,'REVIEW_REQUIRED');
  assert.equal(row.unchangedClaims,true,'the selected price remains but the source roster changed');
  assert.equal(row.k05SourceReads,0);
  assert.ok(row.k05BytesRehashed>0);
  assert.equal(row.userTimeMs,null);
 }
});
test('K05 refuses under-reported field, source and issue changes in owner receipt',async()=>{
 const revised=await beforeAfter({updated:true});
 const sources=[revised.saved,revised.old.documents,revised.current.documents];
 const invoke=receipt=>reviewK01ProjectRefresh({
  saved:sources[0],ownerRefresh:receipt,
  previousAuthorizedDocuments:sources[1],currentAuthorizedDocuments:sources[2],
 });
 assert.ok(revised.ownerReceipt.fieldChanges.length>0);
 assert.ok(revised.ownerReceipt.sourceChanges.length>0);
 for(const [name,mutate,code] of [
  ['fields',r=>{r.fieldChanges=[];},'OWNER_FIELD_CHANGES_DISAGREE'],
  ['sources',r=>{r.sourceChanges=[];},'OWNER_SOURCE_CHANGES_DISAGREE'],
 ]){
  const altered=structuredClone(revised.ownerReceipt);mutate(altered);
  assert.throws(()=>invoke(altered),new RegExp('K05_K01_REFRESH_'+code),name);
 }
 const conflict=await beforeAfter({addConflict:true});
 assert.ok(conflict.ownerReceipt.issueChanges.appeared.length>0);
 const forged=structuredClone(conflict.ownerReceipt);
 forged.issueChanges.appeared=[];
 assert.throws(()=>reviewK01ProjectRefresh({
  saved:conflict.saved,ownerRefresh:forged,
  previousAuthorizedDocuments:conflict.old.documents,
  currentAuthorizedDocuments:conflict.current.documents,
 }),/K05_K01_REFRESH_OWNER_ISSUE_CHANGES_DISAGREE/);
});
test('receipt never leaks raw source refs, excerpts, Task content or user filenames',async()=>{
 const {proof,old}=await beforeAfter({updated:true});
 const raw=JSON.stringify(proof);
 assert.equal(raw.includes('398000 руб.'),false);
 for(const d of old.documents)
  assert.equal(raw.includes(d.sourceRef),false);
 assert.equal(raw.includes('doc:quote-approved'),false);
 assert.equal(raw.includes('task:renew-warehouse-control-offer'),false);
 assert.ok(proof.changedSourceDigests.every(x=>/^[a-f0-9]{64}$/.test(x)));
});

test('single owner refresh vs zero K05 re-reads, measured for all five cases',async()=>{
 const evidence=await studyK01Refresh(root);
 assert.equal(evidence.trials.length,7);
 assert.deepEqual(evidence.trials.map(x=>x.status),
  ['CURRENT','UPDATED','INCOMPLETE','REJECTED','REJECTED','UPDATED','UPDATED']);
 for(const row of evidence.trials){
  assert.equal(row.repetitions,12);
  assert.equal(row.k05SourceReads,0);
  assert.ok(Number.isFinite(row.ownerWallMsMedian));
  assert.ok(Number.isFinite(row.k05WallMsMedian));
  assert.ok(row.ownerSourceReads>=0);
  assert.equal(row.humanGold,false);
  assert.equal(row.f1,null);
 }
 assert.equal(evidence.trials[4].ownerSourceReads,0);
 assert.equal(evidence.trials[4].ownerSourceCatalogReads,0);
 assert.equal(evidence.limits.realModelInvocations,0);
 assert.equal(evidence.limits.skillGain,'NOT_MEASURED');
});
