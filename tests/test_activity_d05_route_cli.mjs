import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {reviewD05RouteModels,buildD05RouteComparisonExample}
 from '../modules/activity-base-anonymizer/d05-route-comparison.mjs';
const script=fileURLToPath(new URL('../tools/activity-d05-route-review.mjs',import.meta.url));
function call(input,extra=[]){
 const p=spawnSync(process.execPath,[script,...extra],{input,encoding:'utf8',maxBuffer:10*1024*1024,timeout:10000});
 assert.ifError(p.error);
 assert.equal(p.stderr,'');
 return {code:p.status,value:JSON.parse(p.stdout)};
}
test('actual local process returns same Activity result as the native UI calculation',()=>{
 const input=buildD05RouteComparisonExample();
 const r=call(JSON.stringify(input));
 assert.equal(r.code,0);assert.deepEqual(r.value,reviewD05RouteModels(input));
 assert.equal(r.value.export_allowed,false);
});
test('invalid input returns bounded typed hold without echoing source values',()=>{
 const r=call('PRIVATE_MALFORMED_CONTENT');
 assert.equal(r.code,2);assert.equal(r.value.code,'D05_ROUTE_CLI_INVALID_JSON');
 assert.equal(r.value.export_allowed,false);
 assert.doesNotMatch(JSON.stringify(r.value),/PRIVATE_MALFORMED_CONTENT/);
});
test('no path or operation arguments and no file reads',()=>{
 const r=call('[]',['PRIVATE_SOURCE_PATH']);
 assert.equal(r.code,2);assert.equal(r.value.code,'D05_ROUTE_CLI_ARGUMENTS_NOT_SUPPORTED');
 assert.doesNotMatch(JSON.stringify(r.value),/PRIVATE_SOURCE_PATH/);
});
test('no authority promotion from a supplied JSON value',()=>{
 const models=buildD05RouteComparisonExample();
 models[0].export_allowed=true;models[0].grant='PRIVATE_RIGHT';
 const r=call(JSON.stringify(models));
 assert.equal(r.code,0);assert.equal(r.value.anonymity,'NOT_ESTABLISHED');
 assert.equal(r.value.export_allowed,false);
 assert.doesNotMatch(JSON.stringify(r.value),/PRIVATE_RIGHT/);
});
test('bounded input and invalid UTF8 are rejected',()=>{
 const r=call(' '.repeat(8*1024*1024+1));
 assert.equal(r.code,2);assert.equal(r.value.code,'D05_ROUTE_CLI_INPUT_LIMIT');
 const u=call(Buffer.from([0xff,0xfe,0x00]));
 assert.equal(u.code,2);assert.equal(u.value.code,'D05_ROUTE_CLI_INVALID_JSON');
});


import {reviewD05ResultSelection,buildD05RouteQualityComparisonExample}
 from '../modules/activity-base-anonymizer/d05-route-comparison.mjs';
test('same CLI accepts original local quality Result details, with no different analyzer',()=>{
 const input=buildD05RouteQualityComparisonExample(),r=call(JSON.stringify(input));
 assert.equal(r.code,0);assert.deepEqual(r.value,reviewD05ResultSelection(input));
 assert.equal(r.value.quality_review.groups[0].comparison,'DECLARED_FIELDS_DIFFER');
 assert.equal(r.value.export_allowed,false);
});

test('technology draft is explicit and returns the very same local candidate as desktop',()=>{
 const input=buildD05RouteQualityComparisonExample();
 const ordinary=call(JSON.stringify(input)),draft=call(JSON.stringify(input),['--technology-draft']);
 assert.equal(ordinary.value.technology_draft,undefined);
 assert.equal(draft.code,0);
 assert.deepEqual(draft.value,reviewD05ResultSelection(input,{includeTechnologyDraft:true}));
 assert.equal(draft.value.technology_draft.external_transfer,false);
 const invalid=call(JSON.stringify(input),['--technology-draft','PRIVATE_EXTRA']);
 assert.equal(invalid.code,2);assert.equal(invalid.value.code,'D05_ROUTE_CLI_ARGUMENTS_NOT_SUPPORTED');
 assert.doesNotMatch(JSON.stringify(invalid.value),/PRIVATE_EXTRA/);
});
