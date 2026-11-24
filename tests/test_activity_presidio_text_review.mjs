import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {sha256Canonical} from '../modules/activity-base-anonymizer/engine.mjs';
import {buildD05RouteQualityComparisonExample,reviewD05ResultSelection,prepareD05DisclosureCandidate}
 from '../modules/activity-base-anonymizer/d05-route-comparison.mjs';
import {reviewPresidioTextScreening} from '../modules/activity-base-anonymizer/presidio-text-review.mjs';
const candidate=()=>{
 const r=reviewD05ResultSelection(buildD05RouteQualityComparisonExample(),{includeTechnologyDraft:true});
 return prepareD05DisclosureCandidate(r,r.groups[0].id,1,{purpose:'📋 Contact quality@example.com'}, {});
};
async function output(c,language='en'){
 const rows=[...c.text_review_fields].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const fields=rows.map(row=>({path:row.path,text_length:Array.from(row.text).length,
  findings:row.path==='technology.terms.purpose'?[{entity_type:'EMAIL_ADDRESS',start:10,end:29,score:1}]:[]}));
 return {status:'LOCAL_TEXT_SCREENING_COMPLETE',engine:'Presidio Analyzer',version:'2.2.366',language,
  model:language==='en'?'en_core_web_sm':'ru_core_news_sm',model_version:'3.8.0',spacy_version:'3.8.11',
  score_threshold:0.3,supported_entities:['EMAIL_ADDRESS','PERSON'],phone_regions:['RU','US','GB','DE','FR'],
  input_sha256:'0'.repeat(64),technology_sha256:await sha256Canonical(c.technology),
  text_inventory_sha256:await sha256Canonical(rows),offset_unit:'UNICODE_CODE_POINT',fields,
  field_count:fields.length,finding_count:1,scope:'IDENTIFYING_TEXT_SCREENING_ONLY',
  anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null};
}
test('local screening uses exact current candidate and reports findings without copying detected text',async()=>{
 const c=candidate(),r=await reviewPresidioTextScreening(c,await output(c));
 assert.equal(r.finding_count,1);assert.equal(r.flagged_field_count,1);
 assert.equal(r.source_match,'EXACT_CURRENT_TECHNOLOGY_AND_TEXT_INVENTORY');
 assert.equal(r.source_authority,'UNVERIFIED_LOCAL_TOOL_OUTPUT');
 assert.equal(r.anonymity,'NOT_ESTABLISHED');assert.equal(r.export_allowed,false);
 assert.doesNotMatch(JSON.stringify(r),/quality@example.com/);
});
test('changed technology or hidden text inventory refuses previous screening',async()=>{
 const c=candidate(),raw=await output(c);
 c.technology.terms.purpose='Revised';c.text_review_fields.find(x=>x.path==='technology.terms.purpose').text='Revised';
 await assert.rejects(reviewPresidioTextScreening(c,raw),{code:'PRESIDIO_RESULT_SOURCE_CHANGED'});
 const a=candidate(),out=await output(a);a.text_review_fields.pop();
 await assert.rejects(reviewPresidioTextScreening(a,out),{code:'PRESIDIO_INVENTORY_MISMATCH'});
});
test('unknown paths, missing field rows, invalid codepoint offsets and fake permission refused',async()=>{
 for(const [mutate,code] of [
  [r=>{r.fields.pop();},'PRESIDIO_RESULT_COVERAGE_INVALID'],
  [r=>{r.fields[0].path='technology.unknown';},'PRESIDIO_RESULT_COVERAGE_INVALID'],
  [r=>{r.fields.find(x=>x.findings.length).findings[0].end=999;},'PRESIDIO_RESULT_FINDING_INVALID'],
  [r=>{r.export_allowed=true;},'PRESIDIO_RESULT_PROFILE_INVALID'],
 ]){
  const c=candidate(),raw=await output(c);mutate(raw);
  await assert.rejects(reviewPresidioTextScreening(c,raw),{code});
 }
});
test('no reported findings is not anonymity, completeness is screening coverage only',async()=>{
 const c=candidate(),raw=await output(c);
 raw.finding_count=0;raw.fields.forEach(f=>f.findings=[]);
 const r=await reviewPresidioTextScreening(c,raw);
 assert.equal(r.finding_count,0);assert.equal(r.scanned_field_count,c.text_review_fields.length);
 assert.equal(r.privacy_conclusion,'NOT_ESTABLISHED');assert.equal(r.export_allowed,false);
});
const root=process.env.IWXA_PRESIDIO_UPSTREAM_RESULTS;
if(root){
 test('actual original Presidio en/ru scans of Activity candidate match the same technology',async()=>{
  const c=JSON.parse(readFileSync(join(root,'candidate.json'),'utf8'));
  for(const language of ['en','ru']){
   const raw=JSON.parse(readFileSync(join(root,language+'.json'),'utf8'));
   const r=await reviewPresidioTextScreening(c,raw);
   assert.equal(r.language,language);assert.equal(r.scanned_field_count,c.text_review_fields.length);
   assert.ok(r.fields.some(f=>f.path==='technology.terms.purpose'&&f.findings.some(x=>x.entity_type==='EMAIL_ADDRESS')));
   assert.equal(r.export_allowed,false);assert.equal(r.anonymity,'NOT_ESTABLISHED');
  }
 });
}

import {productTextInventory,reviewProductPresidioTextScreening} from '../modules/activity-base-anonymizer/presidio-text-review.mjs';
import {preparePersonalTechnologyProduct} from '../modules/activity-base-anonymizer/technology-product.mjs';
import {personalRows,personalProposal} from './activity_technology_product_fixture.mjs';
test('complete product text inventory includes title, procedure, acceptance and cadence guidance',async()=>{
 const p=await preparePersonalTechnologyProduct(personalRows(),'routine_001',{...personalProposal(),title:'📋 Weekly review quality@example.com'});
 const inventory=productTextInventory(p.object_data),paths=inventory.map(r=>r.path);
 for(const path of ['object_data.title','object_data.technology.instructions','object_data.technology.result_requirements.0','object_data.technology.cadence.guidance'])assert.ok(paths.includes(path));
 const base=await output(candidate());delete base.technology_sha256;
 const fields=inventory.map(row=>({path:row.path,text_length:Array.from(row.text).length,findings:[]}));
 const title=fields.find(r=>r.path==='object_data.title');title.findings.push({entity_type:'EMAIL_ADDRESS',start:16,end:title.text_length,score:1});
 const raw={...base,product_sha256:p.product_sha256,text_inventory_sha256:await sha256Canonical(inventory),scope:'PRODUCT_IDENTIFYING_TEXT_SCREENING_ONLY',fields,field_count:fields.length,finding_count:1};
 const result=await reviewProductPresidioTextScreening(p,raw);assert.equal(result.finding_count,1);assert.equal(result.export_allowed,false);
 const changed={...p,object_data:{...p.object_data,title:'Changed'}};
 await assert.rejects(reviewProductPresidioTextScreening(changed,raw),{code:'PRESIDIO_RESULT_SOURCE_CHANGED'});
 await assert.rejects(reviewProductPresidioTextScreening(p,{...raw,fields:fields.slice(1)}),{code:'PRESIDIO_RESULT_COVERAGE_INVALID'});
});
if(root){test('actual upstream Presidio scans complete personal and organizational products',async()=>{
 for(const kind of ['personal','d05']){
  const p=JSON.parse(readFileSync(join(root,kind+'-product.json'),'utf8'));
  for(const lang of ['en','ru']){
   const raw=JSON.parse(readFileSync(join(root,kind+'-product-'+lang+'.json'),'utf8'));
   const r=await reviewProductPresidioTextScreening(p,raw);
   assert.equal(r.language,lang);assert.equal(r.scanned_field_count,productTextInventory(p.object_data).length);
   assert.ok(r.fields.some(f=>f.path==='object_data.title'&&f.findings.some(x=>x.entity_type==='EMAIL_ADDRESS')));
   assert.equal(r.export_allowed,false);assert.equal(r.anonymity,'NOT_ESTABLISHED');
  }
 }
});}

import {spawnSync} from 'node:child_process';
import {prepareProductGeneralization,applyProductGeneralization} from '../modules/activity-base-anonymizer/technology-disclosure-generalization.mjs';
if(root){test('actual upstream Presidio drives functional generalization and re-scans the revised complete products',async()=>{
 for(const kind of ['personal','d05']){
  const p=JSON.parse(readFileSync(join(root,kind+'-product.json'),'utf8'));
  const reports=['en','ru'].map(lang=>JSON.parse(readFileSync(join(root,kind+'-product-'+lang+'.json'),'utf8')));
  const plan=await prepareProductGeneralization(p,reports,'en');
  const contact=plan.groups.find(g=>g.value==='quality@example.com'&&g.types.includes('EMAIL_ADDRESS'));
  assert.ok(contact?.suggested_replacement,'Actual Presidio must support the explicit contact replacement');
  assert.equal(contact.blocked_count,0);
  assert.ok(contact.spans.length>=(kind==='personal'?3:1));
  const revision=await applyProductGeneralization(p,reports,{base_product_sha256:plan.base_product_sha256,
   proposal_sha256:plan.proposal_sha256,language:'en',replacements:[{group_id:contact.group_id,replacement:contact.suggested_replacement}]});
  const next=revision.preview;
  assert.notEqual(next.product_sha256,p.product_sha256);
  assert.doesNotMatch(JSON.stringify(next.object_data),/quality@example\.com/);
  if(kind==='d05'){
   assert.deepEqual(next.object_data.technology,p.object_data.technology);
   assert.equal(next.object_data.technology.quality_checks[0].declared_fields.find(f=>f.field==='upper_limit').value,'100.2');
  }else{
   assert.deepEqual(next.object_data.technology.result_requirements,p.object_data.technology.result_requirements);
   assert.match(next.object_data.technology.instructions,/Separate deadlines from preferences/);
  }
  for(const lang of ['en','ru']){
   const checked=spawnSync('python',['tools/activity-presidio-scan.py','--language',lang,'--product'],
    {input:JSON.stringify(next),encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
   assert.equal(checked.status,0,'Original upstream analyzer failed to re-scan');
   const review=await reviewProductPresidioTextScreening(next,JSON.parse(checked.stdout));
   assert.equal(review.scanned_field_count,productTextInventory(next.object_data).length);
   assert.ok(!review.fields.some(f=>f.findings.some(x=>x.entity_type==='EMAIL_ADDRESS')));
   assert.equal(review.anonymity,'NOT_ESTABLISHED');
  }
  console.log('ACTIVITY_ORIGINAL_PRESIDIO_GENERALIZATION_RESCAN_PASS',JSON.stringify({kind,
   changed_fields:revision.summary.changed_fields,changed_occurrences:revision.summary.changed_occurrences,
   old_digest: p.product_sha256,new_digest:next.product_sha256,complete_rescan:true,export_allowed:false}));
 }
});}
