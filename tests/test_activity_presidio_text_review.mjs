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
