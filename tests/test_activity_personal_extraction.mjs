import test from 'node:test';
import assert from 'node:assert/strict';
import {SOURCE,PROPOSAL,BUNDLE,FIELDS,preparePersonalExtractionRequest,reviewPersonalExtractionBundle,reviewPersonalPracticalExperience} from '../modules/activity-base-anonymizer/personal-technology-extraction.mjs';
import {personalRows,personalProposal} from './activity_technology_product_fixture.mjs';
function source(){
 const rows=personalRows().slice(0,2);
 return {status:SOURCE,workspace_id:'personal',rows,accepted_results:rows.map((r,i)=>({
  occurrence_ref:r.occurrence_ref,task_ref:r.task_ref,accepted_digest:r.accepted_digest,
  result_digest:'a'.repeat(64),review_digest:'b'.repeat(64),
  summary:'Read commitments, separate deadlines from preferences. Private client '+i,
  claims:[{text:'Overdue work needs a reason',basis:'assumption',assumption:'No calendar confirmation'}],
  uncertainties:['Calendar dates not confirmed'],draft_artifacts:['Draft plan for next week'],
  review_notes:'Keep deadlines distinct from preferences'
 })),export_allowed:false,iwxa_package:null};
}
async function bundle(s=source()){
 const req=await preparePersonalExtractionRequest(s),p=personalProposal();
 const values={...p,cadence_guidance:p.cadence.guidance};delete values.cadence;
 const fields=Object.fromEntries(FIELDS.map(k=>[k,{value:values[k],basis:'PROPOSED',refs:[],note:'Recipient-specific proposal'}]));
 fields.instructions={value:p.instructions,basis:'SOURCE_SUPPORTED',refs:[{id:'evidence_001',path:'summary',quote:'separate deadlines from preferences'}],note:''};
 return {status:BUNDLE,source:s,request_sha256:req.request_sha256,task_ref:'TASK-extraction',accepted_digest:'f'.repeat(64),
  proposal:{profile:PROPOSAL,request_sha256:req.request_sha256,fields},export_allowed:false,iwxa_package:null};
}
test('request uses content and human review, source identity is local and order independent',async()=>{
 const s=source(),before=JSON.stringify(s),a=await preparePersonalExtractionRequest(s);
 const b=await preparePersonalExtractionRequest({...s,rows:[...s.rows].reverse(),accepted_results:[...s.accepted_results].reverse()});
 assert.equal(a.request_sha256,b.request_sha256);
 assert.match(a.document_text,/Private client 0/);
 assert.match(a.document_text,/Keep deadlines distinct/);
 assert.match(a.document_text,/HUMAN_ACCEPTED_DRAFT_NOT_EXTERNAL_EXECUTION/);
 assert.ok(!a.document_text.includes('TASK-private'));
 assert.equal(JSON.stringify(s),before);
 const edited=source();edited.accepted_results[0].review_notes='Different review';
 assert.notEqual((await preparePersonalExtractionRequest(edited)).request_sha256,a.request_sha256);
});
test('mixed histories, missing or duplicate result, other workspace rejected',async()=>{
 const s=source();s.rows[0].interval_seconds=86400;
 await assert.rejects(()=>preparePersonalExtractionRequest(s),{code:'TECHNOLOGY_EXTRACTION_VARIANT_MIX'});
 const b=source();b.accepted_results[0].accepted_digest='e'.repeat(64);
 await assert.rejects(()=>preparePersonalExtractionRequest(b),{code:'TECHNOLOGY_EXTRACTION_RESULT_BINDING'});
 const d=source();d.accepted_results[1]=d.accepted_results[0];
 await assert.rejects(()=>preparePersonalExtractionRequest(d),{code:'TECHNOLOGY_EXTRACTION_RESULT_COVERAGE'});
 await assert.rejects(()=>preparePersonalExtractionRequest({...source(),workspace_id:'company'}),{code:'TECHNOLOGY_EXTRACTION_PERSONAL_SOURCE'});
});
test('source-linked proposal produces only the existing transferable product content',async()=>{
 const b=await bundle(),r=await reviewPersonalExtractionBundle(b);
 assert.equal(r.product.object_data.target,'PERSONAL_AGENT_TASK_PROMPT');
 assert.equal(r.product.object_data.technology.cadence.mode,'RECIPIENT_INTERVAL');
 const text=JSON.stringify(r.product.object_data);
 for(const value of ['Private client','TASK-private','source_sha256','accepted_digest','context_flags'])assert.ok(!text.includes(value));
 assert.equal(r.product.export_allowed,false);
 assert.equal(r.proposed_fields.length,8);
 assert.equal(r.evidence_semantics,'EXACT_QUOTATIONS_NOT_SEMANTIC_PROOF');
});
test('missing fields remain explicit instead of manufacturing a complete package',async()=>{
 const b=await bundle();b.proposal.fields.inputs={value:null,basis:'MISSING',refs:[],note:'Required inputs not established'};
 const r=await reviewPersonalExtractionBundle(b);
 assert.deepEqual(r.missing_fields,['inputs']);assert.equal(r.product,null);
 b.proposal.fields.inputs.value='Made-up input';
 await assert.rejects(()=>reviewPersonalExtractionBundle(b),{code:'TECHNOLOGY_EXTRACTION_UNKNOWN_VALUE'});
});
test('false quotes, stale result, extra keys and invalid proposal basis rejected',async()=>{
 const b=await bundle();b.proposal.fields.instructions.refs[0].quote='fabricated';
 await assert.rejects(()=>reviewPersonalExtractionBundle(b),{code:'TECHNOLOGY_EXTRACTION_REFERENCE_NOT_FOUND'});
 const c=await bundle();c.source.accepted_results[0].summary+=' changed';
 await assert.rejects(()=>reviewPersonalExtractionBundle(c),{code:'TECHNOLOGY_EXTRACTION_REQUEST_CHANGED'});
 const d=await bundle();d.proposal.fields.title.note='';
 await assert.rejects(()=>reviewPersonalExtractionBundle(d),{code:'TECHNOLOGY_EXTRACTION_FIELD_BASIS'});
 const e=await bundle();e.proposal.fields.permissions={value:true};
 await assert.rejects(()=>reviewPersonalExtractionBundle(e),{code:'TECHNOLOGY_EXTRACTION_REQUEST_CHANGED'});
});
test('oversized evidence is refused, not silently clipped',async()=>{
 const s=source();s.accepted_results[0].draft_artifacts=['x'.repeat(12000),'x'.repeat(12000),'x'.repeat(12000),'x'.repeat(12000)];
 await assert.rejects(()=>preparePersonalExtractionRequest(s),{code:'TECHNOLOGY_EXTRACTION_MODEL_INPUT_LIMIT'});
});

test('Activity alone extracts recurring explicit review criteria and context limitations from the accepted source',async()=>{
 const data=source();
 data.accepted_results[0].review_notes+='\nKeep deadlines distinct from preferences\nGood result\nНе подтверждено наличие договора\nНе считать оплату выполненной без подтверждения';
 data.accepted_results[1].review_notes+='\nGood result\nНе подтверждено наличие договора\nНе считать оплату выполненной без подтверждения';
 const view=await reviewPersonalPracticalExperience(data);
 assert.equal(view.occurrence_count,2);assert.equal(view.rules.length,3);
 const criterion=view.rules.find(r=>r.source_text==='Keep deadlines distinct from preferences');
 assert.equal(criterion.source_text,'Keep deadlines distinct from preferences');
 assert.equal(criterion.occurrence_count,2);assert.equal(criterion.evidence.length,2);
 assert.equal(view.rules.find(r=>r.kind==='REPORTED_CONTEXT_LIMITATION').source_text,'Calendar dates not confirmed');
 assert.ok(view.rules.some(r=>r.source_text==='Не считать оплату выполненной без подтверждения'));
 assert.ok(!view.rules.some(r=>r.source_text==='Good result'||r.source_text==='Overdue work needs a reason'||r.source_text==='Не подтверждено наличие договора'));
 assert.equal(view.export_allowed,false);
 const reversed=await reviewPersonalPracticalExperience({...data,rows:[...data.rows].reverse(),accepted_results:[...data.accepted_results].reverse()});
 assert.deepEqual(reversed,view);
 // The local extractor does not inherit the model input size limit.
 data.accepted_results[0].draft_artifacts=['x'.repeat(12000),'y'.repeat(12000),'z'.repeat(12000),'w'.repeat(12000)];
 assert.equal((await reviewPersonalPracticalExperience(data)).rules.length,3);
});
