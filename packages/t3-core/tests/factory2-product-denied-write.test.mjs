import test from 'node:test';
import assert from 'node:assert/strict';
import {denyWrite,validateWitnessContract} from '../src/factory2/products/domain-completion/independent-browser-witness.mjs';
async function probe(fn) {
  globalThis.IWXA={connect:async()=>({granted_operations:['t1.getObject'],t1:{putObject:fn}})};
  try {return await denyWrite({evaluate:async fn=>fn({serviceId:'reader',workspaceId:'ws',schemaId:'schema'})},{serviceId:'reader',workspaceId:'ws',schemaId:'schema'});}
  finally{delete globalThis.IWXA;}
}
test('permission denial is independently witnessed',async()=>{assert.equal(await probe(async()=>{throw Object.assign(new Error('permission denied'),{code:'PERMISSION_DENIED'})}),true);});
test('missing method or broken runtime never counts as denied permission',async()=>{
  await assert.rejects(()=>probe(undefined),/DENY_OPERATION_SURFACE_MISSING/);
  await assert.rejects(()=>probe(async()=>{throw new TypeError('connection unavailable')}),/DENIED_WRITE_WRONG_FAILURE/);
});
test('unexpected schema error cannot masquerade as permission denial',async()=>{
  await assert.rejects(()=>probe(async()=>{throw Object.assign(new Error('bad data'),{code:'SCHEMA_INVALID'})}),/DENIED_WRITE_WRONG_FAILURE/);
});
test('an unauthorized write that succeeds fails qualification',async()=>{await assert.rejects(()=>probe(async()=>({object_id:'written'})),/UNAUTHORIZED_WRITE_SUCCEEDED/);});
test('missing browser family journey fails closed before browser launch',()=>{
  assert.throws(()=>validateWitnessContract({witness:{previewOrigin:'LOOPBACK_TLS',runner:'T2_PLAYWRIGHT_KERNEL_READBACK',journeys:[{serviceId:'svc',route:'/',family:null,readServiceId:'svc',actions:[{type:'click',selector:'#open'}]}]}},{persistentFamilies:['family'],serviceIds:['svc'],routes:['/']}),/FAMILY_WITNESS_INVALID/);
});
