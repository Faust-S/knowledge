import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createOriginalKernelNativeRelay} from '../../t3-core/src/t3/original-kernel-native-relay.mjs';
import {createTemporaryOriginalPersonalAuthority} from '../../t3-core/tests/support/t3-original-personal-authority.mjs';
import {decodeOriginalNetworkRelayArgs,encodeOriginalNetworkRelayResult} from '../../t3-core/src/t3/original-kernel-native-relay-codec.mjs';
const WS='ws:personal:subject',TECH='ws:personal:technical';
const base=['t1.getWorkspace','t1.getObject','t1.listEventsSince','t1.commitObjectGraph'];
const operations=['t1.putObject','t1.getObject','t1.getAsset','t1.putAsset','t1.listEventsSince'];
const info={contract_version:'1.3.0',runtime_version:'0.3.6',service_id:'iwxa.workspace.relay',
  mode:'ready',granted_operations:[...new Set([...base,...operations])]};
function fixture(){
  const local=createTemporaryOriginalPersonalAuthority({workspaceId:WS,operations,clock:Date.now});
  const technical=createTemporaryOriginalPersonalAuthority({workspaceId:TECH,operations:['t1.getObject','t1.putObject','t1.listEventsSince'],clock:Date.now});
  const digests=[];let ctx,epoch=1;
  const relay=createOriginalKernelNativeRelay({currentEpoch:()=>epoch,onAttach:()=>true,
    networkOwner:{operations,onAttach:x=>{ctx=x;return true;},onDetach:()=>{},
      resolveOriginalAccess:p=>{
        const workspace=typeof p.args[0]==='string'?p.args[0]:p.args[0]?.workspace_id;
        const original=workspace===WS?local.access:workspace===TECH?technical.access:null;
        if(!original)return null;
        return {...original,operationDigest:input=>{digests.push(structuredClone(input));return original.operationDigest(input);}};
      }}});
  return {relay,local,technical,digests,get ctx(){return ctx;},
    attach:()=>relay.exchange({verb:'attach',payload:{sessionInfo:info,networkRelayVersion:1}},epoch),
    exchange:(sessionId,verb,rest={})=>relay.exchange({verb,payload:{sessionId,...rest}},epoch),
    invalidate(){epoch++;relay.invalidate();}};
}
test('K10 signed original personal owner binds every relay command and authentic original receipt',async()=>{
  const f=fixture();
  try{
    const s=await f.attach(),k=f.ctx.kernel;
    assert.equal(k.authorityMode,'ORIGINAL_T3_SIGNED');
    const input={workspace_id:WS,object_id:'o:1',data:{title:'exact'},base_revision:0};
    const promise=k.putObject(input);input.data.title='changed';
    const cmd=await f.exchange(s.sessionId,'next');
    assert.equal(cmd.method,'putObject');assert.equal(cmd.args[0].data.title,'exact');
    assert.equal(f.local.proofCount,1);assert.equal(f.technical.proofCount,0);
    const original={object:{workspace_id:WS,object_id:'o:1',revision:1},event:{workspace_id:WS,event_id:'event:1'}};
    await f.exchange(s.sessionId,'result',{id:cmd.id,ok:true,result:original});
    assert.deepEqual(await promise,original);
    const read=k.getObject(TECH,'o:2'),r=await f.exchange(s.sessionId,'next');
    const row={object:{workspace_id:TECH,object_id:'o:2'},relations:{incoming:[],outgoing:[]}};
    await f.exchange(s.sessionId,'result',{id:r.id,ok:true,result:row});
    assert.deepEqual(await read,row);
    assert.equal(f.technical.proofCount,1);
    await assert.rejects(k.getObject('ws:foreign','o:2'),{code:'T3_ORIGINAL_NETWORK_RELAY_AUTHORITY_DENIED'});
    f.local.revoke();
    await assert.rejects(k.putObject(input),{code:'T3_ACCESS_NOT_PERMITTED'});
    assert.equal(f.local.proofCount,2);
    const check=k.getObject(TECH,'o:2'),next=await f.exchange(s.sessionId,'next');
    assert.equal(next.method,'getObject');
    // No write was queued after original signed status revocation.
    await f.exchange(s.sessionId,'result',{id:next.id,ok:true,result:row});
    await check;
  }finally{f.relay.close();}
});
test('K10 signed Asset operation binds exact binary digest while preserving original bytes',async()=>{
  const f=fixture();
  try{
    const s=await f.attach(),k=f.ctx.kernel;
    const bytes=Uint8Array.from([0,255,128,7]);
    const input={workspace_id:WS,object_id:'o:1',asset_id:'a:1',
      mime:'application/octet-stream',base_revision:0,bytes};
    const put=k.putAsset(input);bytes[0]=13;
    const c=await f.exchange(s.sessionId,'next');
    const expected=Uint8Array.from([0,255,128,7]);
    assert.deepEqual(decodeOriginalNetworkRelayArgs(c.method,c.args)[0].bytes,expected);
    assert.deepEqual(f.digests[0].input.bytes,{byte_length:4,
      sha256:createHash('sha256').update(expected).digest('hex')});
    assert.equal(f.digests[0].input.asset_id,'a:1');
    await f.exchange(s.sessionId,'result',{id:c.id,ok:true,
      result:{asset:{workspace_id:WS,asset_id:'a:1',revision:1},event:{workspace_id:WS,event_id:'event:asset'}}});
    await put;
    const get=k.getAsset(WS,'a:1'),r=await f.exchange(s.sessionId,'next');
    const row={asset:{workspace_id:WS,asset_id:'a:1',revision:1},bytes:expected};
    await f.exchange(s.sessionId,'result',{id:r.id,ok:true,result:encodeOriginalNetworkRelayResult(r.method,row)});
    assert.deepEqual(await get,row);
    assert.equal(f.local.proofCount,2);
  }finally{f.relay.close();}
});
test('K10 signed original receipt cannot escape selected Workspace; previous owner cannot execute after detach',async()=>{
  const f=fixture();
  try{
    const s=await f.attach(),k=f.ctx.kernel;
    const r=k.getObject(WS,'o:1'),cmd=await f.exchange(s.sessionId,'next');
    await f.exchange(s.sessionId,'result',{id:cmd.id,ok:true,result:{
      object:{workspace_id:TECH,object_id:'o:1'},relations:{incoming:[],outgoing:[]}}});
    await assert.rejects(r,{code:'T3_KERNEL_SCOPE_RECEIPT_MISMATCH'});
    f.invalidate();
    await assert.rejects(k.putObject({workspace_id:WS,object_id:'o:1'}),{code:'T3_ORIGINAL_NETWORK_RELAY_NOT_CONNECTED'});
  }finally{f.relay.close();}
});
test('K10 original signed owner cannot be combined with a competing boolean authority',()=>{
  assert.throws(()=>createOriginalKernelNativeRelay({currentEpoch:()=>1,onAttach:()=>true,
    networkOwner:{operations,authorizeOperation:()=>true,resolveOriginalAccess:()=>null,
      onAttach:()=>true,onDetach:()=>{}}}),{code:'T3_ORIGINAL_NETWORK_RELAY_OWNER_REQUIRED'});
});

test('K74 original relay history read shares one command slot with D3 and native wake and discards a revoked lifetime',async()=>{
  const technical=createTemporaryOriginalPersonalAuthority({workspaceId:TECH,operations:['t1.getObject'],clock:Date.now});
  let ctx,epoch=1,wakes=0,reads=0,hold,entered;
  const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
  hold=gate();entered=gate();
  const owner={operations:['t1.getObject'],onAttach:p=>{ctx=p;return true;},onDetach:()=>{},
    resolveOriginalAccess:p=>p.args[0]===TECH?technical.access:null,
    originalSignedReplacementHistoryBound:true,
    async readOriginalReplacementOwnerHistory(input){
      reads++;entered.resolve();await hold.promise;
      return {exact:input,object:await ctx.kernel.getObject(TECH,'o:history')};
    },onIdleWake:()=>{wakes++;}};
  assert.throws(()=>createOriginalKernelNativeRelay({currentEpoch:()=>1,onAttach:()=>true,networkOwner:{...owner,originalSignedReplacementHistoryBound:false}}),
    {code:'T3_ORIGINAL_REPLACEMENT_HISTORY_OWNER_REQUIRED'});
  const relay=createOriginalKernelNativeRelay({currentEpoch:()=>epoch,onAttach:()=>true,networkOwner:owner});
  const input={request:{sessionRef:'session:test'},peerContext:{nodeRef:'peer:test'}};
  try{
    assert.equal(await relay.readOriginalReplacementOwnerHistory(input),null);
    const s=await relay.exchange({verb:'attach',payload:{sessionInfo:info,networkRelayVersion:1}},epoch);
    const exchange=(verb,rest={})=>relay.exchange({verb,payload:{sessionId:s.sessionId,...rest}},epoch);
    const reading=relay.readOriginalReplacementOwnerHistory(input);input.request.sessionRef='session:changed';
    await entered.promise;
    assert.equal(await relay.readOriginalReplacementOwnerHistory(input),null);
    await assert.rejects(async()=>relay.nativeKernel.getObject(WS,'o:busy'),{code:'T3_D3_ORIGINAL_KERNEL_OPERATION_IN_PROGRESS'});
    // The existing browser poll must service the history read, not start a
    // competing wake or expose history as another exchange verb.
    hold.resolve();const cmd=await exchange('next');assert.equal(cmd.method,'getObject');assert.equal(wakes,0);
    const row={object:{workspace_id:TECH,object_id:'o:history'},relations:{incoming:[],outgoing:[]}};
    await exchange('result',{id:cmd.id,ok:true,result:row});
    const read=await reading;assert.equal(read.exact.request.sessionRef,'session:test');assert.deepEqual(read.object,row);
    assert.equal(reads,1);assert.equal(technical.proofCount,1);
    hold=gate();entered=gate();const pending=relay.readOriginalReplacementOwnerHistory(input);await entered.promise;
    epoch++;relay.invalidate();hold.resolve();await assert.rejects(pending);
    assert.equal(await relay.readOriginalReplacementOwnerHistory(input),null);assert.equal(technical.proofCount,1);
  }finally{relay.close();}
});

test('K116 real signed native relay negotiates optional commit history and authenticates its exact page',async()=>{
 const op='t1.listEventCommitWindow',read='t1.listEventsSince',digestInputs=[];
 const local=createTemporaryOriginalPersonalAuthority({workspaceId:WS,operations:[op,read],clock:Date.now});
 let ctx;
 const owner={operations:[op,read],onAttach:p=>{ctx=p;return true;},onDetach:()=>{},
   resolveOriginalAccess:p=>p.args[0]===WS?{...local.access,operationDigest:input=>{
     digestInputs.push(structuredClone(input));return local.access.operationDigest(input);}}:null};
 const relay=createOriginalKernelNativeRelay({currentEpoch:()=>1,onAttach:()=>true,networkOwner:owner});
 const exchange=(verb,payload={})=>relay.exchange({verb,payload},1);
 try{
   const s=await exchange('attach',{sessionInfo:{...info,granted_operations:[...info.granted_operations,op]},networkRelayVersion:1});
   assert.ok(s.networkMethods.includes('listEventCommitWindow'));
   assert.equal(ctx.kernel.hasOperation(op),true);
   const readPage=ctx.kernel.listEventCommitWindow(WS,'event:old',1);
   const cmd=await exchange('next',{sessionId:s.sessionId});
   assert.equal(cmd.method,'listEventCommitWindow');
   assert.deepEqual(cmd.args,[WS,'event:old',1]);
   assert.equal(digestInputs[0].operation,op);
   assert.deepEqual(digestInputs[0].input,{workspace_id:WS,after_event_id:'event:old',limit:1});
   const page={entries:[{event:{workspace_id:WS,event_id:'event:new'},legacy_history:false}],
     next_after_event_id:'event:new',has_more:false,order:'LOCAL_TRANSACTION_COMMIT_ORDER',legacy_history_causal_proven:false};
   await exchange('result',{sessionId:s.sessionId,id:cmd.id,ok:true,result:page});
   assert.deepEqual(await readPage,page);
   await assert.rejects(ctx.kernel.listEventCommitWindow(TECH,null,1),{code:'T3_ORIGINAL_NETWORK_RELAY_AUTHORITY_DENIED'});
   local.revoke();
   await assert.rejects(ctx.kernel.listEventCommitWindow(WS,null,1),{code:'T3_ACCESS_NOT_PERMITTED'});
 }finally{relay.close();local.closeOriginalVault();}
});
test('K116 legacy native session retains D3 without falsely admitting commit-history network owner',async()=>{
 const op='t1.listEventCommitWindow',read='t1.listEventsSince';
 let attached=0;
 const relay=createOriginalKernelNativeRelay({currentEpoch:()=>1,onAttach:()=>true,networkOwner:{
   operations:[op,read],resolveOriginalAccess:()=>null,onAttach:()=>{attached++;return true;},onDetach:()=>{}}});
 try{
   const result=await relay.exchange({verb:'attach',payload:{sessionInfo:info,networkRelayVersion:1}},1);
   assert.equal(result.networkRelayVersion,undefined);
   assert.equal(result.networkMethods,undefined);
   assert.equal(attached,0);
   assert.equal(relay.nativeKernel.hasOperation(read),true);
 }finally{relay.close();}
});
test('K116 optional commit history cannot be installed by an unsigned relay or without original history grant',()=>{
 const op='t1.listEventCommitWindow',read='t1.listEventsSince';
 for(const owner of [
   {operations:[op,read],authorizeOperation:()=>true},
   {operations:[op],resolveOriginalAccess:()=>null},
 ])assert.throws(()=>createOriginalKernelNativeRelay({currentEpoch:()=>1,onAttach:()=>true,
   networkOwner:{...owner,onAttach:()=>true,onDetach:()=>{}}}),
   {code:'T3_ORIGINAL_NETWORK_RELAY_COMMIT_HISTORY_OWNER_REQUIRED'});
});

test('K124 native signed relay carries exact original Object history scope and rejects foreign receipts',async()=>{
 const op='t1.listEventObjectCommitWindow',read='t1.listEventsSince',object='object:technical',digestInputs=[];
 const local=createTemporaryOriginalPersonalAuthority({workspaceId:TECH,operations:[op,read],clock:Date.now});
 let ctx;
 const relay=createOriginalKernelNativeRelay({currentEpoch:()=>1,onAttach:()=>true,networkOwner:{
   operations:[op,read],onAttach:p=>{ctx=p;return true;},onDetach:()=>{},
   resolveOriginalAccess:p=>p.args[0]===TECH?{...local.access,operationDigest:input=>{
     digestInputs.push(input);return local.access.operationDigest(input);}}:null}});
 const exchange=(verb,payload)=>relay.exchange({verb,payload},1);
 try{
   const s=await exchange('attach',{sessionInfo:{...info,granted_operations:[...info.granted_operations,op]},networkRelayVersion:1});
   assert.ok(s.networkMethods.includes('listEventObjectCommitWindow'));
   assert.equal(ctx.kernel.hasOperation(op),true);
   const task=ctx.kernel.listEventObjectCommitWindow(TECH,object,null,1);
   const cmd=await exchange('next',{sessionId:s.sessionId});
   assert.equal(cmd.method,'listEventObjectCommitWindow');
   assert.deepEqual(cmd.args,[TECH,object,null,1]);
   assert.deepEqual(digestInputs[0].input,{workspace_id:TECH,object_id:object,after_event_id:null,limit:1});
   const page={entries:[{event:{workspace_id:TECH,object_id:'object:foreign',event_id:'event:new'},legacy_history:false}],
     next_after_event_id:'event:new',has_more:false,order:'LOCAL_TRANSACTION_COMMIT_ORDER',legacy_history_causal_proven:false};
   const denied=assert.rejects(task,{code:'T3_KERNEL_EVENT_OBJECT_SCOPE_MISMATCH'});
   await exchange('result',{sessionId:s.sessionId,id:cmd.id,ok:true,result:page});
   await denied;
   await assert.rejects(ctx.kernel.listEventObjectCommitWindow(WS,object,null,1),{code:'T3_ORIGINAL_NETWORK_RELAY_AUTHORITY_DENIED'});
 }finally{relay.close();local.closeOriginalVault();}
});

test('K130 original native signed relay carries one catalog query and refuses a foreign receipt',async()=>{
 const op='t1.listObjectWindow',read='t1.listObjects',digestInputs=[];
 const local=createTemporaryOriginalPersonalAuthority({workspaceId:TECH,operations:[op,read],clock:Date.now});
 const query={workspace_id:TECH,include_deleted:true,after_object_id:'obj:0',limit:1};
 let ctx;
 const relay=createOriginalKernelNativeRelay({currentEpoch:()=>1,onAttach:()=>true,networkOwner:{
   operations:[op,read],onAttach:p=>{ctx=p;return true;},onDetach:()=>{},
   resolveOriginalAccess:p=>p.args[0]?.workspace_id===TECH?{...local.access,operationDigest:input=>{
     digestInputs.push(structuredClone(input));return local.access.operationDigest(input);}}:null}});
 const exchange=(verb,payload)=>relay.exchange({verb,payload},1);
 try{
   const s=await exchange('attach',{sessionInfo:{...info,granted_operations:[...info.granted_operations,op,read]},networkRelayVersion:1});
   assert.ok(s.networkMethods.includes('listObjectWindow'));assert.equal(ctx.kernel.hasOperation(op),true);
   const task=ctx.kernel.listObjectWindow(query),cmd=await exchange('next',{sessionId:s.sessionId});
   assert.equal(cmd.method,'listObjectWindow');assert.deepEqual(cmd.args,[query]);assert.deepEqual(digestInputs[0].input,query);
   const page={entries:[{workspace_id:WS,object_id:'obj:1',schema_id:'demo.allowed'}],
     next_after_object_id:'obj:1',has_more:false,order:'WORKSPACE_OBJECT_ID_ASC'};
   const denied=assert.rejects(task,{code:'T3_KERNEL_LIST_SCOPE_MISMATCH'});
   await exchange('result',{sessionId:s.sessionId,id:cmd.id,ok:true,result:page});await denied;
   await assert.rejects(ctx.kernel.listObjectWindow({...query,workspace_id:WS}),{code:'T3_ORIGINAL_NETWORK_RELAY_AUTHORITY_DENIED'});
 }finally{relay.close();local.closeOriginalVault();}
});
test('K130 original catalog relay requires signed owner and original listObjects permission',()=>{
 const op='t1.listObjectWindow',read='t1.listObjects';
 for(const owner of [{operations:[op,read],authorizeOperation:()=>true},{operations:[op],resolveOriginalAccess:()=>null}]){
   assert.throws(()=>createOriginalKernelNativeRelay({currentEpoch:()=>1,onAttach:()=>true,
     networkOwner:{...owner,onAttach:()=>true,onDetach:()=>{}}}),
     {code:'T3_ORIGINAL_NETWORK_RELAY_OBJECT_WINDOW_OWNER_REQUIRED'});
 }
});
