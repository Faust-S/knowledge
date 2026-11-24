import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {sha256Canonical} from '../modules/activity-base-anonymizer/engine.mjs';
import {reviewObservationResult} from '../modules/activity-base-anonymizer/observation-review.mjs';
import {buildD05RouteQualityComparisonExample,reviewD05ResultSelection,prepareD05DisclosureCandidate}
 from '../modules/activity-base-anonymizer/d05-route-comparison.mjs';
function candidate(){
 const r=reviewD05ResultSelection(buildD05RouteQualityComparisonExample(),{includeTechnologyDraft:true});
 return prepareD05DisclosureCandidate(r,r.groups[0].id,1,{
  purpose:'Cut and inspect',inputs:'Sheet metal',outputs:'Part',applicability:'Drawing',
  adaptation_guidance:'Recalculate for recipient',local_context_guidance:'Use approved drawing',
 },{});
}
const enc=r=>new TextEncoder().encode(JSON.stringify(r)+'\n');
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(kind='arx'){
 const c=candidate(),technology_sha256=await sha256Canonical(c.technology);
 const common={technology_sha256,observation_unit:'ORGANIZATION',source_kind:'DECLARED_MODEL'};
 const request=kind==='arx'?{...common,profile:'ACTIVITY_ARX_COHORT_V1',k:2,
  columns:[{key:'machine_class',hierarchy:[['a','laser'],['b','laser'],['c','mill'],['d','mill']],max_level:1}],
  rows:[...'abcd'].map((v,i)=>({unit_id:'org'+i,values:[v]}))}:
  {...common,profile:'ACTIVITY_DP_AGGREGATE_V1',metric:'ACCEPTED_ORDER_COUNT',public_bound:20,epsilon_milli:500,
   rows:[0,2,12,50].map((v,i)=>({unit_id:'org'+i,value:v}))};
 const bytes=enc(request);
 const base={...common,input_sha256:hash(bytes),source_authority:'UNVERIFIED_DECLARED_COHORT',anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null};
 const raw=kind==='arx'?{...base,status:'LOCAL_ARX_COHORT_REVIEW',engine:'ARX',version:'3.9.2',
  scope:'DECLARED_QUASI_IDENTIFIER_SAMPLE_ONLY',row_count:4,k:2,suppression_limit:0,before_highest_sample_risk:1,
  after_highest_sample_risk:.5,result_available:true,levels:[{key:'machine_class',level:1,max_level:1}]}:
  {...base,status:'LOCAL_OPENDP_AGGREGATE_PREVIEW',engine:'OpenDP',version:'0.16.0',scope:'ONE_DECLARED_ORGANIZATION_CONTRIBUTION',
   metric:request.metric,public_bound:20,epsilon_milli:500,adjacency:'ADD_OR_REMOVE_ONE_ROW',delta:0,privacy_map_at_one:.5,
   scale:40,noisy_value:-3,budget_accounting:'NOT_PERFORMED'};
 return {c,request,bytes,raw};
}
test('ARX pairs exact request and current technology without carrying any unit values',async()=>{
 const {c,bytes,raw}=await fixture();const before=JSON.stringify(c);
 const result=await reviewObservationResult(c,bytes,raw);
 assert.equal(result.kind,'arx');assert.equal(result.after_highest_sample_risk,.5);assert.equal(result.export_allowed,false);
 assert.equal(result.source_authority,'UNVERIFIED_DECLARED_COHORT_AND_LOCAL_TOOL_OUTPUT');
 assert.equal(JSON.stringify(c),before);assert.ok(!JSON.stringify(result).includes('org0'));
});
test('ARX no-solution remains visible and does not assert anonymity',async()=>{
 const {c,bytes,raw}=await fixture();
 Object.assign(raw,{result_available:false,after_highest_sample_risk:null,levels:[]});
 const result=await reviewObservationResult(c,bytes,raw);
 assert.equal(result.result_available,false);assert.equal(result.anonymity,'NOT_ESTABLISHED');
});
test('reject stale candidate or even whitespace change of request bytes',async()=>{
 const {c,bytes,raw}=await fixture();const altered=structuredClone(c);
 altered.technology.terms.purpose='Another revision';
 await assert.rejects(()=>reviewObservationResult(altered,bytes,raw),{code:'OBSERVATION_TECHNOLOGY_CHANGED'});
 await assert.rejects(()=>reviewObservationResult(c,new TextEncoder().encode(new TextDecoder().decode(bytes)+' '),raw),{code:'OBSERVATION_REQUEST_CHANGED'});
});
test('reject mismatching ARX bound, claimed suppression or bad levels',async()=>{
 const {c,bytes,raw}=await fixture();
 for(const patch of [{after_highest_sample_risk:.6},{suppression_limit:.01},{levels:[{key:'machine_class',level:2,max_level:1}]},{row_count:5}]){
  await assert.rejects(()=>reviewObservationResult(c,bytes,{...raw,...patch}),{code:'ARX_RESULT_INVALID'});
 }
});
test('duplicate declared organization rejected even with matching exact digest',async()=>{
 const {c,request,raw}=await fixture();request.rows[1].unit_id=request.rows[0].unit_id;
 const bytes=enc(request);raw.input_sha256=hash(bytes);
 await assert.rejects(()=>reviewObservationResult(c,bytes,raw),{code:'OBSERVATION_UNIT_INVALID'});
});
test('OpenDP local preview preserves noise, no exact count, no accounting claim',async()=>{
 const {c,bytes,raw}=await fixture('opendp');const result=await reviewObservationResult(c,bytes,raw);
 assert.equal(result.kind,'opendp');assert.equal(result.noisy_value,-3);assert.equal(result.budget_accounting,'NOT_PERFORMED');
 assert.equal(result.export_allowed,false);assert.ok(!('row_count' in result));
});
test('reject false DP guarantee, undersized scale, accounting and exact statistics',async()=>{
 const {c,bytes,raw}=await fixture('opendp');
 for(const patch of [{privacy_map_at_one:.51},{scale:39},{budget_accounting:'APPROVED'},{delta:.1},{metric:'TOTAL_OPERATION_MINUTES'}]){
  await assert.rejects(()=>reviewObservationResult(c,bytes,{...raw,...patch}),{code:'OPENDP_RESULT_INVALID'});
 }
 await assert.rejects(()=>reviewObservationResult(c,bytes,{...raw,row_count:4}),{code:'OBSERVATION_RESULT_PROFILE_INVALID'});
});
test('do not accept technical tolerance as a statistical release metric',async()=>{
 const {c,request,raw}=await fixture('opendp');request.metric='QUALITY_TOLERANCE';const bytes=enc(request);
 raw.input_sha256=hash(bytes);raw.metric=request.metric;
 await assert.rejects(()=>reviewObservationResult(c,bytes,raw),{code:'OPENDP_POLICY_INVALID'});
});
test('reject fabricated authorization and added raw rows',async()=>{
 const {c,bytes,raw}=await fixture();
 for(const patch of [{export_allowed:true},{anonymity:'ESTABLISHED'},{rows:[]}])
  await assert.rejects(()=>reviewObservationResult(c,bytes,{...raw,...patch}),{code:'OBSERVATION_RESULT_PROFILE_INVALID'});
});
test('consume exact genuine engine output when upstream witness provided',{skip:!process.env.IWXA_OBSERVATION_UPSTREAM_DIR},async()=>{
 const root=process.env.IWXA_OBSERVATION_UPSTREAM_DIR,kind=process.env.IWXA_OBSERVATION_UPSTREAM_KIND;
 const {c}=await fixture(kind);
 const bytes=readFileSync(join(root,'request.json'));
 const raw=JSON.parse(readFileSync(join(root,'result.json'),'utf8'));
 const result=await reviewObservationResult(c,bytes,raw);
 assert.equal(result.kind,kind);assert.equal(result.export_allowed,false);
 if(kind==='arx'){assert.equal(result.result_available,true);assert.equal(result.after_highest_sample_risk,.5);}
 else assert.ok(result.privacy_map_at_one<=.5);
});
