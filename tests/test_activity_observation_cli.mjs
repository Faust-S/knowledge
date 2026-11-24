import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {sha256Canonical} from '../modules/activity-base-anonymizer/engine.mjs';
import {buildD05RouteQualityComparisonExample,reviewD05ResultSelection,prepareD05DisclosureCandidate}
 from '../modules/activity-base-anonymizer/d05-route-comparison.mjs';
const script=fileURLToPath(new URL('../tools/activity-observation-request.mjs',import.meta.url));
const review=reviewD05ResultSelection(buildD05RouteQualityComparisonExample(),{includeTechnologyDraft:true});
const candidate=prepareD05DisclosureCandidate(review,review.groups[0].id,1,{
 purpose:'Cut and inspect',inputs:'Sheet metal',outputs:'Part',applicability:'Drawing',
 adaptation_guidance:'Recalculate for recipient',local_context_guidance:'Use approved drawing'
},{});
const cohort={profile:'ACTIVITY_DP_AGGREGATE_V1',observation_unit:'ORGANIZATION',source_kind:'DECLARED_MODEL',
 metric:'CONTRIBUTING_ORGANIZATIONS',public_bound:1,epsilon_milli:500,rows:[{unit_id:'orgA',value:1}]};
function invoke(args,input){
 const result=spawnSync(process.execPath,[script,...args],{input:JSON.stringify(input),encoding:'utf8',timeout:10000});
 assert.equal(result.stderr,'');
 return {status:result.status,text:result.stdout,value:JSON.parse(result.stdout)};
}
test('CLI emits exact prepared request bytes and verifies matching original result envelope',async()=>{
 const p=invoke(['--prepare'],{candidate,cohort});
 assert.equal(p.status,0);
 assert.equal(p.value.technology_sha256,await sha256Canonical(candidate.technology));
 const raw={status:'LOCAL_OPENDP_AGGREGATE_PREVIEW',engine:'OpenDP',version:'0.16.0',
 scope:'ONE_DECLARED_ORGANIZATION_CONTRIBUTION',input_sha256:createHash('sha256').update(p.text).digest('hex'),
 technology_sha256:p.value.technology_sha256,observation_unit:'ORGANIZATION',source_kind:'DECLARED_MODEL',
 source_authority:'UNVERIFIED_DECLARED_COHORT',anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null,
 metric:cohort.metric,public_bound:1,epsilon_milli:500,adjacency:'ADD_OR_REMOVE_ONE_ROW',delta:0,
 privacy_map_at_one:.5,scale:2,noisy_value:4,budget_accounting:'NOT_PERFORMED'};
 const r=invoke(['--review'],{candidate,request_text:p.text,result:raw});
 assert.equal(r.status,0);assert.equal(r.value.kind,'opendp');assert.equal(r.value.export_allowed,false);
 assert.ok(!('rows' in r.value));
 const stale=invoke(['--review'],{candidate,request_text:p.text+' ',result:raw});
 assert.equal(stale.status,2);assert.equal(stale.value.code,'OBSERVATION_REQUEST_CHANGED');
});
test('CLI rejects paths, unsupported arguments, and forged input',()=>{
 const path=invoke(['--prepare','C:/private/path'],{candidate,cohort});
 assert.equal(path.status,2);assert.equal(path.value.code,'OBSERVATION_CLI_ARGUMENTS_INVALID');
 const fake=invoke(['--prepare'],{candidate,cohort:{...cohort,technology_sha256:'a'.repeat(64)}});
 assert.equal(fake.status,2);assert.equal(fake.value.code,'OBSERVATION_PREPARATION_PROFILE_INVALID');
});
