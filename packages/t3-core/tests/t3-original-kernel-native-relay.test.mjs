import test from 'node:test';
import assert from 'node:assert/strict';
import {createOriginalKernelNativeRelay} from '../src/t3/original-kernel-native-relay.mjs';

const GRANTS=['t1.commitObjectGraph','t1.getWorkspace','t1.getObject','t1.listEventsSince'];
const session=(ops=GRANTS)=>({
  contract_version:'1.3.0',runtime_version:'0.3.6',service_id:'iwxa.workspace.integration',
  mode:'full',granted_operations:[...ops]
});
const make=()=>{
  let epoch=9;
  let signedKernel=null;
  const relay=createOriginalKernelNativeRelay({
    currentEpoch:()=>epoch,
    onAttach:kernel=>{signedKernel=kernel;return true},
    timeoutMs:1000,idleLeaseMs:30000,
  });
  return {relay,kernel:()=>signedKernel,epoch:()=>epoch,setEpoch:n=>epoch=n};
};
async function roundtrip(relay,sessionId,promise,method,args,result){
 const command=await relay.exchange({verb:'next',payload:{sessionId}},9);
 assert.equal(command.kind,'COMMAND');
 assert.equal(command.method,method);
 assert.deepEqual(command.args,args);
 await relay.exchange({verb:'result',payload:{
   sessionId,id:command.id,ok:true,result,
 }},9);
 assert.deepEqual(await promise,result);
}
test('D2 listObjects is transported by the original Kernel, not recreated in native',async t=>{
 const ctx=make();t.after(()=>ctx.relay.close());
 const connected=await ctx.relay.exchange({verb:'attach',payload:{
   sessionInfo:session([...GRANTS,'t1.listObjects'])
 }},9);
 assert.ok(connected.sessionId);
 const original=ctx.kernel();
 assert.equal(original.sessionInfo.contract_version,'1.3.0');
 assert.equal(original.hasOperation('t1.listObjects'),true);
 const query={workspace_id:'workspace:org',include_deleted:true};
 const result=[{object_id:'object:one',workspace_id:'workspace:org',revision:1}];
 await roundtrip(ctx.relay,connected.sessionId,original.listObjects(query),
   'listObjects',[query],result);
 assert.equal(typeof original.putObject,'undefined');
 assert.equal(typeof original.deleteObject,'undefined');
});
test('D3 attach stays compatible and does not implicitly grant D2 enumeration',async t=>{
 const ctx=make();t.after(()=>ctx.relay.close());
 await ctx.relay.exchange({verb:'attach',payload:{sessionInfo:session()}},9);
 assert.equal(ctx.kernel().hasOperation('t1.listObjects'),false);
 assert.throws(()=>ctx.kernel().listObjects({workspace_id:'workspace:org'}),
   /T3_D3_ORIGINAL_KERNEL_NOT_CONNECTED/);
 // Original signed D3 Apply/read operations remain available independently.
 assert.equal(ctx.kernel().hasOperation('t1.getWorkspace'),true);
 assert.equal(ctx.kernel().hasOperation('t1.commitObjectGraph'),true);
});
test('D2 in-flight read is refused on owner invalidation or epoch change',async t=>{
 const ctx=make();t.after(()=>ctx.relay.close());
 const connected=await ctx.relay.exchange({verb:'attach',payload:{
   sessionInfo:session([...GRANTS,'t1.listObjects'])
 }},9);
 const request=ctx.kernel().listObjects({workspace_id:'workspace:org'});
 const command=await ctx.relay.exchange({verb:'next',payload:{sessionId:connected.sessionId}},9);
 assert.equal(command.method,'listObjects');
 ctx.relay.invalidate();
 await assert.rejects(request,/T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED/);
 assert.throws(()=>ctx.kernel().listObjects({workspace_id:'workspace:org'}),
   /T3_D3_ORIGINAL_KERNEL_NOT_CONNECTED/);
});
test('foreign original Kernel scopes and missing grants cannot be listed',async t=>{
 const ctx=make();t.after(()=>ctx.relay.close());
 await assert.rejects(ctx.relay.exchange({verb:'attach',payload:{
  sessionInfo:session(['t1.getWorkspace','t1.getObject','t1.listEventsSince','t1.listObjects'])
 }},9),/T3_D3_ORIGINAL_KERNEL_OPERATIONS_REQUIRED/);
});
