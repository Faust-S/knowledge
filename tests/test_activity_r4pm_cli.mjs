import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {reviewR4pmResult,compareR4pmReviews,R4PM_RESULT_MAX_BYTES}
 from '../modules/activity-base-anonymizer/r4pm-result-review.mjs';
const script=fileURLToPath(new URL('../tools/activity-r4pm-result-review.mjs',import.meta.url));
const count=n=>({engine:'Rust4PM',version:'0.6.2',operation:'count_ocel',data:n});
function call(input,args=[]){
 const p=spawnSync(process.execPath,[script,...args],{input,encoding:'utf8',maxBuffer:10*1024*1024,timeout:10000});
 assert.ifError(p.error);assert.equal(p.stderr,'');return {code:p.status,value:JSON.parse(p.stdout)};
}
test('one real subprocess returns the exact same review as desktop core',()=>{
 const raw=count(5),r=call(JSON.stringify(raw));
 assert.equal(r.code,0);assert.deepEqual(r.value,reviewR4pmResult(raw));
});
test('a pair returns the exact same comparison as desktop core',()=>{
 const raw=[count(5),count(8)],r=call(JSON.stringify(raw));
 assert.equal(r.code,0);assert.deepEqual(r.value,compareR4pmReviews(...raw.map(reviewR4pmResult)));
});
test('refuses arbitrary args, malformed input, authority injection and wrong pair size',()=>{
 for(const [input,args,code] of [
  ['{}',['PRIVATE_PATH'],'R4PM_CLI_ARGUMENTS_NOT_SUPPORTED'],
  ['PRIVATE_MALFORMED',[],'R4PM_CLI_INVALID_JSON'],
  [JSON.stringify({...count(5),source_authority:'PRIVATE_GRANT'}),[],'R4PM_RESULT_PROFILE_INVALID'],
  ['[]',[],'R4PM_CLI_COMPARISON_PAIR_REQUIRED'],
  [JSON.stringify([count(1),{engine:'Rust4PM',version:'0.6.2',operation:'discover_dfg',data:{activities:{},directly_follows_relations:[],start_activities:[],end_activities:[]}}]),[],'R4PM_COMPARISON_SCOPE_MISMATCH']
 ]){
  const r=call(input,args);assert.equal(r.code,2);assert.equal(r.value.code,code);
  assert.equal(r.value.export_allowed,false);assert.equal(r.value.iwxa_package,null);
  assert.doesNotMatch(JSON.stringify(r.value),/PRIVATE_/);
 }
});
test('bounded stdin and invalid UTF8',()=>{
 const r=call(' '.repeat(R4PM_RESULT_MAX_BYTES+1));assert.equal(r.code,2);assert.equal(r.value.code,'R4PM_CLI_INPUT_LIMIT');
 const u=call(Buffer.from([0xff,0xfe]));assert.equal(u.code,2);assert.equal(u.value.code,'R4PM_CLI_INVALID_JSON');
});
if(process.env.IWXA_R4PM_UPSTREAM_RESULTS){
 test('real pinned upstream DFG files compared through the actual Activity CLI',()=>{
  const dir=process.env.IWXA_R4PM_UPSTREAM_RESULTS;
  const pair=['baseline_dfg','discover_dfg'].map(name=>JSON.parse(readFileSync(join(dir,name+'.json'),'utf8')));
  const r=call(JSON.stringify(pair));assert.equal(r.code,0);
  assert.deepEqual(r.value,compareR4pmReviews(...pair.map(reviewR4pmResult)));
  assert.equal(r.value.graphs[0].transition_differences,3);
  assert.equal(r.value.graphs[0].activity_differences,1);
  assert.equal(r.value.export_allowed,false);
 });
}
