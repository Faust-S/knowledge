import test from "node:test";
import assert from "node:assert/strict";
import {createOriginalKernelNativeRelay} from "../../t3-core/src/t3/original-kernel-native-relay.mjs";
import {ORIGINAL_NETWORK_RELAY_METHODS,decodeOriginalNetworkRelayArgs,
  encodeOriginalNetworkRelayResult} from "../../t3-core/src/t3/original-kernel-native-relay-codec.mjs";
const base=["t1.getWorkspace","t1.getObject","t1.listEventsSince","t1.commitObjectGraph"];
const info=operations=>({contract_version:"1.3.0",runtime_version:"0.3.6",
  service_id:"iwxa.workspace.relay",mode:"ready",granted_operations:operations});
// K7 uses the original boolean owner compatibility contract. Later optional
// catalog/history methods require a signed owner and are tested separately.
const signedOnly=new Set(["listEventCommitWindow","listEventObjectCommitWindow","listObjectWindow"]);
const compatibilityMethods=Object.keys(ORIGINAL_NETWORK_RELAY_METHODS).filter(name=>!signedOnly.has(name));
const all=compatibilityMethods.map(name=>ORIGINAL_NETWORK_RELAY_METHODS[name]);
function fixture({operations=all,authorizeOperation=()=>true,onIdleWake,onAttach}={}){
  let context=null,epoch=1,detaches=0;
  const relay=createOriginalKernelNativeRelay({currentEpoch:()=>epoch,onAttach:()=>true,
    networkOwner:{operations,authorizeOperation,onAttach:async ctx=>{
      context=ctx;return onAttach?onAttach(ctx):true;
    },onDetach:()=>{detaches++;},onIdleWake}});
  const attach=(grants=all,version=1)=>relay.exchange({verb:"attach",
    payload:{sessionInfo:info(grants),networkRelayVersion:version}},epoch);
  const exchange=(sessionId,verb,rest={})=>relay.exchange({verb,
    payload:{sessionId,...rest}},epoch);
  return {relay,attach,exchange,get context(){return context;},get detaches(){return detaches;},
    revoke(){epoch++;relay.invalidate();}};
}
test("K7 original D3 remains narrow unless both original native owner and trusted realm opt in",async()=>{
  const legacy=createOriginalKernelNativeRelay({currentEpoch:()=>1,onAttach:()=>true});
  try{
    const s=await legacy.exchange({verb:"attach",payload:{sessionInfo:info(all),networkRelayVersion:1}},1);
    assert.equal(s.networkMethods,undefined);
    assert.equal(legacy.nativeKernel.hasOperation("t1.putObject"),false);
    assert.equal(legacy.nativeKernel.putObject,undefined);
  }finally{legacy.close();}
  for(const [grants,version] of [[base,1],[all,undefined]]){
    const f=fixture();
    try{
      const s=await f.relay.exchange({verb:"attach",payload:{sessionInfo:info(grants),networkRelayVersion:version}},1);
      assert.equal(s.networkMethods,undefined);
      assert.equal(f.context,null);assert.equal(f.relay.attached,true);
    }finally{f.relay.close();}
  }
});
test("K7 exact original operations and binary Asset data traverse the existing JSON relay",async()=>{
  const proofs=[],f=fixture({authorizeOperation:p=>{proofs.push(p);return true;}});
  try{
    const s=await f.attach(),k=f.context.kernel;
    assert.equal(s.networkRelayVersion,1);
    assert.deepEqual(new Set(s.networkMethods),new Set(compatibilityMethods));
    assert.equal(k.hasOperation("t1.putAsset"),true);
    assert.equal(k.hasOperation("t2.importCommit"),false);
    assert.equal(f.relay.nativeKernel.putAsset,undefined);
    const input={workspace_id:"ws",asset_id:"a",object_id:"o",mime:"application/octet-stream",
      bytes:Uint8Array.from([0,1,127,128,255]),base_revision:0};
    const written=k.putAsset(input);
    input.bytes[0]=99;
    const command=await f.exchange(s.sessionId,"next");
    assert.equal(command.method,"putAsset");
    const wire=JSON.parse(JSON.stringify(command.args));
    assert.equal(Object.hasOwn(wire[0],"bytes"),false);
    assert.deepEqual(decodeOriginalNetworkRelayArgs(command.method,wire)[0].bytes,
      Uint8Array.from([0,1,127,128,255]));
    assert.deepEqual(proofs[0].args[0].bytes,Uint8Array.from([0,1,127,128,255]));
    await f.exchange(s.sessionId,"result",{id:command.id,ok:true,result:{asset:{asset_id:"a"}}});
    assert.deepEqual(await written,{asset:{asset_id:"a"}});
    const read=k.getAsset("ws","a"),request=await f.exchange(s.sessionId,"next");
    const original={asset:{asset_id:"a"},bytes:Uint8Array.from([255,0,10])};
    await f.exchange(s.sessionId,"result",{id:request.id,ok:true,
      result:JSON.parse(JSON.stringify(encodeOriginalNetworkRelayResult(request.method,original)))});
    assert.deepEqual(await read,original);
    assert.deepEqual(proofs.map(p=>p.operation),["t1.putAsset","t1.getAsset"]);
  }finally{f.relay.close();}
});
test("K7 original authority denial and stale asynchronous admission cannot enqueue a Kernel mutation",async()=>{
  let release,entered;const waiting=new Promise(r=>{entered=r;});
  const f=fixture({authorizeOperation:async p=>{
    if(p.method==="deleteObject")return false;
    entered();return new Promise(r=>{release=r;});
  }});
  try{
    const s=await f.attach(),k=f.context.kernel;
    await assert.rejects(k.deleteObject({workspace_id:"ws",object_id:"o"}),{code:"T3_ORIGINAL_NETWORK_RELAY_AUTHORITY_DENIED"});
    const pending=k.putObject({workspace_id:"ws",object_id:"o"});
    await waiting;f.revoke();release(true);
    await assert.rejects(pending,{code:"T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED"});
    assert.equal(f.detaches,1);assert.equal(k.hasOperation("t1.putObject"),false);
    await assert.rejects(k.putObject({}),{code:"T3_ORIGINAL_NETWORK_RELAY_NOT_CONNECTED"});
    const next=await f.attach();
    assert.notEqual(s.sessionId,next.sessionId);
  }finally{f.relay.close();}
});
test("K7 original long poll drives one owner wake without deadlock or a second timer",async()=>{
  let wakes=0,finish,done;const finished=new Promise(r=>{done=r;});
  const f=fixture({onIdleWake:async({kernel,isHostActive})=>{
    wakes++;
    assert.equal(isHostActive(),true);
    const result=await kernel.getObject("ws","o");
    assert.equal(result.object.object_id,"o");
    await new Promise(r=>{finish=r;});done();
  }});
  try{
    const s=await f.attach(),command=await f.exchange(s.sessionId,"next");
    assert.equal(command.method,"getObject");assert.equal(wakes,1);
    assert.deepEqual(await f.exchange(s.sessionId,"next"),{kind:"IDLE"});
    await f.exchange(s.sessionId,"result",{id:command.id,ok:true,result:{object:{object_id:"o"}}});
    // No later callback may race the previous owner wake across detach.
    await new Promise(r=>setImmediate(r));
    f.relay.invalidate();
    await assert.rejects(f.attach(),{code:"T3_D3_ORIGINAL_KERNEL_ATTACH_IN_PROGRESS"});
    finish();await finished;await new Promise(r=>setImmediate(r));
    const fresh=await f.attach();
    assert.notEqual(fresh.sessionId,s.sessionId);
    assert.equal(wakes,1);
  }finally{f.relay.close();}
});
test("K7 missing original write reply invalidates old network binding rather than replaying",async()=>{
  const f=fixture();
  try{
    const s=await f.attach(),k=f.context.kernel;
    const write=k.putObject({workspace_id:"ws",object_id:"o"});
    const command=await f.exchange(s.sessionId,"next");
    assert.equal(command.method,"putObject");
    await f.exchange(s.sessionId,"detach");
    await assert.rejects(write,{code:"T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED"});
    await assert.rejects(k.putObject({}),{code:"T3_ORIGINAL_NETWORK_RELAY_NOT_CONNECTED"});
    assert.equal(f.detaches,1);
  }finally{f.relay.close();}
});
test("K7 malformed Asset representation cannot become an original Kernel byte array",()=>{
  for(const value of [{bytesBase64url:"A"},{bytesBase64url:"a==="},
    {bytesBase64url:"AB"},{bytesBase64url:"AA",bytes:[0]},{}])
    assert.throws(()=>decodeOriginalNetworkRelayArgs("putAsset",[value]),
      {code:"T3_ORIGINAL_KERNEL_ASSET_BYTES_INVALID"});
});

test("K7 owner constructs original task bindings using negotiated capabilities before command admission",async()=>{
  let staged=false;
  const f=fixture({onAttach:async({kernel,isHostActive})=>{
    assert.equal(kernel.hasOperation("t1.putObject"),true);
    assert.equal(isHostActive(),false);
    await assert.rejects(kernel.putObject({}),{code:"T3_ORIGINAL_NETWORK_RELAY_NOT_CONNECTED"});
    staged=true;return true;
  }});
  try{
    const s=await f.attach();
    assert.equal(staged,true);assert.equal(f.relay.networkAttached,true);
    assert.equal(f.context.isHostActive(),true);
    await f.exchange(s.sessionId,"detach");
    assert.equal(f.relay.networkAttached,false);
    assert.equal(f.context.kernel.hasOperation("t1.putObject"),false);
  }finally{f.relay.close();}
});
test("K7 failed wake disables only its network owner and does not silently retry",async()=>{
  let wakes=0;
  const f=fixture({onIdleWake:()=>{wakes++;throw Error("uncertain original task");}});
  try{
    const s=await f.attach();
    const poll=f.exchange(s.sessionId,"next");
    await new Promise(r=>setImmediate(r));
    assert.equal(f.relay.networkAttached,false);
    assert.equal(f.relay.attached,true);
    // D3 still wakes the SAME long-poll; failure did not add a retry queue.
    const read=f.relay.nativeKernel.getObject("ws","o");
    const command=await poll;
    assert.equal(command.method,"getObject");
    await f.exchange(s.sessionId,"result",{id:command.id,ok:true,result:null});
    assert.equal(await read,null);assert.equal(wakes,1);assert.equal(f.detaches,1);
  }finally{f.relay.close();}
});

test("K150 compatibility owner cannot opt into the signed-only original history and catalog operations",()=>{
  for(const name of signedOnly){
    const owner={operations:[...all,ORIGINAL_NETWORK_RELAY_METHODS[name]],authorizeOperation:()=>true,onAttach:()=>true,onDetach:()=>{}};
    const code=name==="listObjectWindow"?"T3_ORIGINAL_NETWORK_RELAY_OBJECT_WINDOW_OWNER_REQUIRED":"T3_ORIGINAL_NETWORK_RELAY_COMMIT_HISTORY_OWNER_REQUIRED";
    assert.throws(()=>createOriginalKernelNativeRelay({currentEpoch:()=>1,onAttach:()=>true,networkOwner:owner}),{code});
  }
});
