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
