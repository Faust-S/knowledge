import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildSyntheticOcel2Example,reviewExternalOcDfg} from '../modules/activity-base-anonymizer/ocel2-evidence.mjs';
const path=fileURLToPath(new URL('../tools/activity-ocdfg-review.mjs',import.meta.url));
function call(input,args=[]){
 const run=spawnSync(process.execPath,[path,...args],{input,encoding:'utf8',maxBuffer:10*1024*1024,timeout:10000});
 assert.ifError(run.error);assert.equal(run.stderr,'');
 const data=JSON.parse(run.stdout);return {status:run.status,data};
}
async function sample(){
 const {ocel2}=await buildSyntheticOcel2Example();
 const ocdfg={object_type_to_dfg:{
 order:{activities:{registered:3,allocated:3,completed:3},start_activities:{registered:3},end_activities:{completed:3},directly_follows_relations:[[['registered','allocated'],3],[['allocated','completed'],3]]},
 resource:{activities:{allocated:3},start_activities:{allocated:3},end_activities:{allocated:3},directly_follows_relations:[]}
 }};
 return {ocel2,ocdfg};
}
test('local tool invocation uses the very same Activity review operation',async()=>{
 const args=await sample();
 const actual=call(JSON.stringify(args));
 assert.equal(actual.status,0);
 assert.deepEqual(actual.data,await reviewExternalOcDfg(args.ocel2,args.ocdfg));
 assert.equal(actual.data.export_allowed,false);
});
test('ambiguous timestamps return HOLD and do not expose the asserted external graph',async()=>{
 const args=await sample();args.ocel2.events[1].time=args.ocel2.events[0].time;
 const actual=call(JSON.stringify(args));
 assert.equal(actual.status,2);assert.equal(actual.data.status,'HOLD_AMBIGUOUS_ORDER');
 assert.deepEqual(actual.data.object_views.find(x=>x.object_type==='order').transitions,[]);
});
test('rejects arbitrary file arguments, invalid JSON, oversized input and raw error disclosure',()=>{
 for(const [value,args,code] of [
 ['{}',['PRIVATE_PATH'],'OCDFG_CLI_ARGUMENTS_NOT_SUPPORTED'],
 ['private_text',''.split(''),'OCDFG_CLI_INVALID_JSON'],
 [JSON.stringify({path:'PRIVATE_PATH'}),[],'OCDFG_CLI_INPUT_SHAPE'],
 [' '.repeat(8*1024*1024+1),[],'OCDFG_CLI_INPUT_LIMIT']
 ]){
  const actual=call(value,args);
  assert.equal(actual.status,2);assert.equal(actual.data.code,code);assert.equal(actual.data.export_allowed,false);
  assert.equal(JSON.stringify(actual.data).includes('PRIVATE_PATH'),false);
 }
});
