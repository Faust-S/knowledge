import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {randomBytes} from "node:crypto";
import {createOriginalControlHttpHandler}
  from "../src/t3/original-control-http-handler.mjs";
import {createControlLoopbackOwner}
  from "../src/t3/control-loopback-owner.mjs";
import {createSubjectKernelBinding}
  from "../src/t3/subject-access-binding.mjs";
import {createTemporaryOriginalPersonalAuthority}
  from "./support/t3-original-personal-authority.mjs";

async function fixture(){
  const token=randomBytes(32).toString("base64url");
  let origin=null,handle=null,epoch=1;
  const listeners=new Set(),calls=[];
  const authority=createTemporaryOriginalPersonalAuthority({
    workspaceId:"ws:personal",now:Date.now(),
  });
  const server=createServer((req,res)=>{
    if(!handle){res.writeHead(503);res.end();return;}
    void handle(req,res);
  });
  await new Promise((resolve,reject)=>{
    server.once("error",reject);
    server.listen(0,"127.0.0.1",resolve);
  });
  origin="http://127.0.0.1:"+server.address().port;
  handle=createOriginalControlHttpHandler({
    origin,token,
    uiOrigin:"http://127.0.0.1:"+(Number(new URL(origin).port)+1),
    serviceId:"iwxa.workspace.integration",
    currentEpoch:()=>epoch,
    subscribeInvalidation:listener=>{
      listeners.add(listener);
      return ()=>listeners.delete(listener);
    },
    ownerFor:({scope,operation})=>
      scope==="kernel"&&operation==="putObject"?authority.access:null,
  });
  const originFetch=(url,options={})=>fetch(url,{
    ...options,headers:{...options.headers,Origin:origin},
  });
  const browser=createControlLoopbackOwner({origin,token,fetchImpl:originFetch});
  const kernel={
    sessionInfo:{contract_version:"1.3.0",runtime_version:"0.3.6"},
    hasOperation:op=>op==="t1.putObject",
    async putObject(input){
      calls.push(input);
      return {object:{...input,revision:1},
        event:{event_id:"evt:personal:"+calls.length,workspace_id:input.workspace_id}};
    },
  };
  const stopServer=async()=>{
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  };
  return {origin,token,browser,authority,calls,kernel,
    invalidate(){epoch++;for(const listener of [...listeners])listener();},
    async close(){await stopServer();},
  };
}
const command=id=>({workspace_id:"ws:personal",object_id:id,
  schema_id:"iwxa.demo.note",schema_version:"1.0.0",base_revision:0,
  data:{title:"Signed local T3"},extensions:{},
  event:{event_type:"t3.d1.signed",payload:{}}});
test("existing Control HTTP protocol executes original Ed25519 PERSONAL proof and blocks revocation",{
  timeout:12000
},async()=>{
  const f=await fixture();
  const invalidated=new Promise(resolve=>f.resolveInvalidated=resolve);
  const stop=f.browser.subscribeSignedAccessInvalidation(
    ()=>f.resolveInvalidated());
  try{
    const port=await f.browser.signedKernelAccess("putObject");
    assert.ok(port);
    const bound=createSubjectKernelBinding({kernel:f.kernel,access:port});
    const receipt=await bound.putObject(command("object:first"));
    assert.equal(receipt.object.object_id,"object:first");
    assert.equal(f.calls.length,1);
    assert.equal(f.authority.proofCount,1);
    assert.equal(f.authority.registryReads,1);
    f.authority.revoke();
    await assert.rejects(bound.putObject(command("object:revoked")),
      {code:"T3_ACCESS_NOT_PERMITTED"});
    assert.equal(f.calls.length,1,"revoked signed status must not reach Kernel");
    f.invalidate();
    await Promise.race([invalidated,new Promise((_,reject)=>
      setTimeout(()=>reject(Error("CONTROL_INVALIDATION_NOT_DELIVERED")),2000))]);
    await assert.rejects(port.currentContext(),{code:"STALE_CONTEXT_OPERATION"});
    assert.equal(f.calls.length,1);
  }finally{stop();await f.close();}
});
test("installed Host Control route denies missing token, forged Origin and stale epoch",async()=>{
  const f=await fixture();
  try{
    const launch=await fetch(f.origin+"/workspace/t3-signed-ui.json");
    assert.equal(launch.status,200);
    const pinned=await launch.json();
    assert.equal(pinned.schema,"IWXA_T3_SIGNED_WORKSPACE_LAUNCH/1");
    assert.equal(pinned.kernel_origin,f.origin);
    assert.notEqual(pinned.ui_origin,f.origin);
    const trusted=await (await fetch(f.origin+"/workspace/t3-kernel-realm.json")).json();
    assert.equal(trusted.ui_origin,pinned.ui_origin);
    assert.equal(trusted.service_id,pinned.service_id);
    const missing=await fetch(f.origin+"/api/t3/context-epoch");
    assert.equal(missing.status,401);
    const bad=await fetch(f.origin+"/api/t3/owner",{
      method:"POST",headers:{
        Authorization:"Bearer "+f.token,Origin:"https://attacker.example",
        "Content-Type":"application/json","X-IWXA-Context-Epoch":"1",
      },body:JSON.stringify({scope:"kernel",operation:"putObject",verb:"select"}),
    });
    assert.equal(bad.status,403);
    const stale=await fetch(f.origin+"/api/t3/owner",{
      method:"POST",headers:{
        Authorization:"Bearer "+f.token,Origin:f.origin,
        "Content-Type":"application/json","X-IWXA-Context-Epoch":"0",
      },body:JSON.stringify({scope:"kernel",operation:"putObject",verb:"select"}),
    });
    assert.equal(stale.status,403);
    assert.equal((await stale.json()).error,"STALE_CONTEXT_OPERATION");
    const denied=await fetch(f.origin+"/api/t3/owner",{
      method:"POST",headers:{
        Authorization:"Bearer "+f.token,Origin:f.origin,
        "Content-Type":"application/json","X-IWXA-Context-Epoch":"1",
      },body:JSON.stringify({scope:"kernel",operation:"other",verb:"select"}),
    });
    assert.deepEqual(await denied.json(),{available:false,contextEpoch:1});
    assert.equal(f.calls.length,0);
  }finally{await f.close();}
});

test("original Control denies an in-flight GET when the signed Host rotates its bearer",{
  timeout:10000,
},async()=>{
  const first=randomBytes(32).toString("base64url");
  const second=randomBytes(32).toString("base64url");
  let active=first,resolveSuspended,waitOnce=true;
  let handler=null;
  const server=createServer((request,response)=>{
    void handler(request,response);
  });
  await new Promise((ok,bad)=>{
    server.once("error",bad);server.listen(0,"127.0.0.1",ok);
  });
  const origin="http://127.0.0.1:"+server.address().port;
  handler=createOriginalControlHttpHandler({
    origin,token:first,readToken:()=>active,
    currentEpoch:async()=>{
      if(waitOnce){
        waitOnce=false;
        return await new Promise(ok=>{resolveSuspended=ok;});
      }
      return 2;
    },
    subscribeInvalidation:()=>()=>{},
    ownerFor:()=>null,
  });
  const get=async bearer=>fetch(origin+"/api/t3/context-epoch",{
    headers:{Authorization:"Bearer "+bearer},
  });
  try{
    const pending=get(first);
    while(typeof resolveSuspended!=="function")
      await new Promise(ok=>setImmediate(ok));
    // The old client passed its first token check, but cannot read the
    // newly selected subject's epoch after awaiting original Host state.
    active=second;
    resolveSuspended(1);
    const stale=await pending;
    assert.equal(stale.status,403);
    assert.equal((await stale.json()).error,"T3_D1_CONTROL_SESSION_ROTATED");
    assert.equal((await get(first)).status,401);
    const fresh=await get(second);
    assert.equal(fresh.status,200);
    assert.equal((await fresh.json()).contextEpoch,2);
    console.log("T3_D1_ORIGINAL_CONTROL_INFLIGHT_BEARER_ROTATION_PASS");
  }finally{
    server.closeAllConnections();
    await new Promise(ok=>server.close(()=>ok()));
  }
});
