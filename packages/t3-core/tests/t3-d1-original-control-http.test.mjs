import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {randomBytes,createHash} from "node:crypto";
import {createOriginalControlHttpHandler}
  from "../src/t3/original-control-http-handler.mjs";
import {createControlLoopbackOwner}
  from "../src/t3/control-loopback-owner.mjs";
import {createSubjectKernelBinding}
  from "../src/t3/subject-access-binding.mjs";
import {createTemporaryOriginalPersonalAuthority}
  from "./support/t3-original-personal-authority.mjs";

async function fixture({reconciliationPortFor=null,nativeD7PortFor=null,
  nativeD6PortFor=null}={}){
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
    reconciliationPortFor,nativeD7PortFor,nativeD6PortFor,
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
test("D3 original Control selects KernelFacade names while independent signed D1 application JIT remains authoritative",{
  timeout:12000,
},async()=>{
  const token=randomBytes(32).toString("base64url");
  let epoch=901,applicationRevision=41,handler=null,reads=0,proofs=0;
  let selectedEpoch=null,selectedRevision=null;
  const issuedDigests=new Map();
  const invalidators=new Set();
  const owner=({scope,operation})=>{
    // Exactly the installed Admin selector, NOT an incoming raw t1.* grant.
    if(scope!=="kernel"||!["getObject","listEventsSince"].includes(operation))
      return null;
    // Original installed D1 owner is pinned to its Control epoch across
    // distinct HTTP requests, not silently re-created on every POST.
    if(selectedEpoch!==epoch){
      selectedEpoch=epoch;selectedRevision=applicationRevision;
      issuedDigests.clear();
    }
    const exactMethod="t1."+operation;
    const digests=issuedDigests.get(operation)??new Set();
    issuedDigests.set(operation,digests);
    const captured=selectedRevision;
    const current=()=> {
      if(captured!==applicationRevision)
        throw Object.assign(Error("T3_D3_SIGNED_KERNEL_OWNER_OR_CONTEXT_CHANGED"),
          {code:"T3_D3_SIGNED_KERNEL_OWNER_OR_CONTEXT_CHANGED"});
      return {kind:"CORP",context_id:"admin-application:one",
        actor_id:"person:reviewer",principal_id:"org:one",role_id:"role:reviewer",
        grant_id:"grant:application",organization_id:"org:one",
        workspace_id:"workspace:one",resource:"workspace:one",
        realm_id:"realm:one",audience:"audience:one",
        purpose:"application",scope_revision:captured};
    };
    let last=null;
    return {
      async currentContext(){reads++;return current();},
      async actionFor(method){
        current();
        if(method!==exactMethod)
          throw Object.assign(Error("T3_D3_KERNEL_OPERATION_NOT_GRANTED"),
            {code:"T3_D3_KERNEL_OPERATION_NOT_GRANTED"});
        return "application.apply";
      },
      async operationDigest({operation:method,input,context}){
        current();
        if(method!==exactMethod)
          throw Object.assign(Error("T3_D3_CONTROL_READ_ONLY_OPERATION_REQUIRED"),
            {code:"T3_D3_CONTROL_READ_ONLY_OPERATION_REQUIRED"});
        const digest=createHash("sha256")
          .update(JSON.stringify({method,input,context})).digest("hex");
        digests.add(digest);
        return digest;
      },
      async authorize(request){
        current();
        if(!digests.has(request?.operationDigest))
          throw Object.assign(Error("T3_D3_CONTROL_READ_ONLY_AUTHORIZATION_REQUIRED"),
            {code:"T3_D3_CONTROL_READ_ONLY_AUTHORIZATION_REQUIRED"});
        digests.delete(request.operationDigest);
        proofs++;
        last={request,decision:{allowed:true,action:"application.apply"}};
        return last.decision;
      },
      verifyDecisionBinding(request,decision){
        current();
        return last?.request===request&&last?.decision===decision;
      },
    };
  };
  const server=createServer((req,res)=>{void handler(req,res);});
  await new Promise((ok,bad)=>{
    server.once("error",bad);server.listen(0,"127.0.0.1",ok);
  });
  const origin="http://127.0.0.1:"+server.address().port;
  handler=createOriginalControlHttpHandler({
    origin,token,currentEpoch:()=>epoch,
    subscribeInvalidation:cb=>{
      invalidators.add(cb);return ()=>invalidators.delete(cb);
    },
    ownerFor:owner,
  });
  const client=createControlLoopbackOwner({origin,token,
    fetchImpl:(url,opts={})=>fetch(url,{
      ...opts,headers:{...opts.headers,Origin:origin},
    }),
  });
  const stop=client.subscribeSignedAccessInvalidation(()=>{});
  try{
    assert.equal(await client.signedKernelAccess("t1.getObject"),null,
      "HTTP must not resolve raw t1.* as a KernelFacade selector");
    assert.equal(await client.signedKernelAccess("putObject"),null,
      "ACCEPT never implies generic Object write");
    const read=await client.signedKernelAccess("getObject");
    const history=await client.signedKernelAccess("listEventsSince");
    assert.ok(read&&history);
    assert.equal(await client.signedKernelAccess("commitObjectGraph"),null,
      "raw browser commit must never bypass separate Human APPLY");
    const context=await read.currentContext();
    assert.equal(context.grant_id,"grant:application");
    assert.equal(context.scope_revision,41);
    assert.notEqual(epoch,context.scope_revision,
      "actual Host epoch and signed application scope remain independent");
    assert.equal(await read.actionFor("t1.getObject"),"application.apply");
    assert.equal(await history.actionFor("t1.listEventsSince"),"application.apply");
    await assert.rejects(read.actionFor("t1.commitObjectGraph"),
      {code:"T3_D3_KERNEL_OPERATION_NOT_GRANTED"});
    await assert.rejects(read.actionFor("t1.putObject"),
      {code:"T3_D3_KERNEL_OPERATION_NOT_GRANTED"});
    const digest=await read.operationDigest({
      operation:"t1.getObject",input:{workspace_id:"workspace:one"},context,
    });
    assert.match(digest,/^[a-f0-9]{64}$/);
    const request={action:"application.apply",grantId:"grant:application",
      resource:"workspace:one",operationDigest:digest};
    const decision=await read.authorize(request);
    assert.equal(read.verifyDecisionBinding(request,decision),true);
    assert.equal(proofs,1);
    assert.ok(reads>=1);
    // A private signed Task changes its ORIGINAL scope while the Control
    // transport epoch is unchanged. The old JIT owner must fail closed.
    applicationRevision++;
    await assert.rejects(read.currentContext(),
      {code:"T3_D3_SIGNED_KERNEL_OWNER_OR_CONTEXT_CHANGED"});
    // A separate Host invalidation revokes all previously selected ports.
    epoch++;
    for(const invalidate of invalidators)invalidate();
    await assert.rejects(read.actionFor("t1.getObject"),
      {code:"STALE_CONTEXT_OPERATION"});
  }finally{stop();server.closeAllConnections();
    await new Promise(ok=>server.close(ok));}
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
    // Never allow a second unsigned AppShell on the trusted Kernel origin.
    // Exchange/Lifecycle/Studio are separately built T2 entry points.
    for(const entry of ["/","/workspace/","/workspace/index.html",
      "/workspace/exchange/","/workspace/exchange/index.html",
      "/workspace/lifecycle/","/workspace/studio/",
      "/workspace/isolated-signed-workspace.html"]){
      const response=await fetch(f.origin+entry);
      assert.equal(response.status,403,"must deny raw signed-origin route "+entry);
      assert.equal((await response.json()).error,"T3_D1_RAW_T2_WORKSPACE_DISABLED");
    }
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


test("installed Admin D3 Browser Control is read-only even if native Kernel Apply becomes available",{
  timeout:12000,
},async()=>{
  // The private Admin owner gives Control a narrow projection of the
  // SAME Reconciliation. It never grants browser Accept/Reject or APPLY.
  let signedReceipts=0,nativeDispatch=0;
  const denied=code=>Object.assign(Error(code),{code});
  const browserPort=Object.freeze({
    receive:async()=>({status:"RECEIVED_NOT_APPLIED"}),
    preview:async()=>({status:"VERIFIED"}),
    receipt:async()=>{signedReceipts++;return {found:false};},
    inspectAcceptedApplication:async()=>({status:"CANDIDATE_REQUIRES_INDEPENDENT_HOST_AUTHORIZATION"}),
    accept:async()=>{throw denied("T3_D3_NATIVE_HUMAN_REVIEW_REQUIRED");},
    reject:async()=>{throw denied("T3_D3_NATIVE_HUMAN_REVIEW_REQUIRED");},
  });
  const f=await fixture({reconciliationPortFor:()=>browserPort});
  const stop=f.browser.subscribeSignedAccessInvalidation(()=>{});
  try{
    assert.deepEqual(await f.browser.reconciliationRequest("available"),
      {available:true,applyAvailable:false,recoverAvailable:false});
    const token={operationId:"d3:test",packageSha256:"a".repeat(64)};
    assert.equal((await f.browser.reconciliationRequest("receipt",token)).found,false);
    assert.equal(signedReceipts,1);
    await assert.rejects(f.browser.reconciliationRequest("accept",{
      operationId:"d3:browser-attempt",packageSha256:"b".repeat(64),
      previewDigest:"c".repeat(64),
    }),{code:"T3_D3_NATIVE_HUMAN_REVIEW_REQUIRED"});
    await assert.rejects(f.browser.reconciliationRequest("reject",{
      operationId:"d3:browser-reject",packageSha256:"b".repeat(64),
      previewDigest:"c".repeat(64),reason:"Browser cannot be a native review",
    }),{code:"T3_D3_NATIVE_HUMAN_REVIEW_REQUIRED"});
    await assert.rejects(f.browser.reconciliationRequest("applyAccepted",{
      acceptanceId:"a".repeat(64),revisionIds:["b".repeat(64)],
      target:{consumerId:"IWXA_ADMIN_CENTER"},
    }),{code:"T3_D3_ORIGINAL_APPLY_OWNER_REQUIRED"});
    await assert.rejects(f.browser.reconciliationRequest("recoverApplied",{
      acceptanceId:"a".repeat(64),revisionIds:["b".repeat(64)],
      target:{consumerId:"IWXA_ADMIN_CENTER"},
    }),{code:"T3_D3_ORIGINAL_APPLY_RECOVERY_UNAVAILABLE"});
    assert.equal(nativeDispatch,0,
      "only a separate installed Center native action can dispatch APPLY");
  }finally{stop();await f.close();}
});
test("original native D3 recipient uses the existing signed Control HTTP and isolated carrier",{
  timeout:12000
},async()=>{
  // Transport qualification only: a synthetic port verifies wire continuity.
  // Genuine native OfflinePackageReconciler, Human Review and Kernel are
  // supplied by the installed product, never by this HTTP regression.
  const events=[];
  const originalPort={
    receive:async bytes=>{
      events.push({kind:"receive",bytes:[...bytes]});
      return {transportReceipt:{state:"RECEIVED"},acceptanceState:"NOT_ACCEPTED"};
    },
    receipt:async (operationId,packageSha256)=>{
      events.push({kind:"receipt",operationId,packageSha256});
      return {found:true,receipt:{operationId,packageSha256,acceptanceState:"ACCEPTED"},
        kernelApplication:"NOT_ATTESTED_BY_RECONCILIATION_RECEIPT"};
    },
    preview:async digest=>{
      events.push({kind:"preview",digest});
      return {packageSha256:digest,allowedAction:"EXPLICIT_ACCEPT_ONLY"};
    },
    accept:async payload=>{
      events.push({kind:"accept",payload});
      // Original recipient may commit its ACCEPT but lose the subsequent
      // durable receipt readback; the browser must never replay that write.
      if(payload.operationId==="review:uncertain")
        throw Object.assign(new Error("ORIGINAL_ACK_LOST"),{
          code:"T3_D3_ORIGINAL_DECISION_READBACK_NOT_CONFIRMED"});
      return {acceptanceState:"ACCEPTED",kernelApplication:"NOT_APPLIED"};
    },
    reject:async payload=>{
      events.push({kind:"reject",payload});
      return {acceptanceState:"REJECTED",kernelApplication:"NOT_APPLIED"};
    },
    inspectAcceptedApplication:async payload=>{
      events.push({kind:"inspect",payload});
      return {status:"CANDIDATE_REQUIRES_INDEPENDENT_HOST_AUTHORIZATION"};
    },
    applyAccepted:async payload=>{
      events.push({kind:"apply",payload});
      return {kernelWriteReadback:"OWNER_UNCONFIRMED"};
    },
    recoverApplied:async payload=>{
      events.push({kind:"recover-apply",payload});
      return {status:"ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED",
        kernelWriteReadback:"CONFIRMED",automaticRetryAllowed:false};
    },
  };
  const f=await fixture({reconciliationPortFor:()=>originalPort});
  const stop=f.browser.subscribeSignedAccessInvalidation(()=>{});
  try{
    // A real native D3-only reviewer has separate ACCEPTANCE authority.
    // No implicit signed Workspace READ is issued, but its authenticated
    // Reconciliation port must remain available in the same trusted session.
    assert.equal(await f.browser.signedKernelAccess("getWorkspace"),null);
    assert.deepEqual(await f.browser.reconciliationRequest("available"),
      {available:true,applyAvailable:true,recoverAvailable:true});
    const archive=Uint8Array.from([0,1,2,3,251,253,254,255]);
    const incoming=await f.browser.reconciliationRequest("receive",{bytes:archive});
    assert.equal(incoming.acceptanceState,"NOT_ACCEPTED");
    assert.deepEqual(events[0],{kind:"receive",bytes:[...archive]});
    const digest="b".repeat(64);
    assert.equal((await f.browser.reconciliationRequest("preview",
      {packageSha256:digest})).packageSha256,digest);
    const accepted=await f.browser.reconciliationRequest("accept",{
      packageSha256:digest,previewDigest:"c".repeat(64),
      operationId:"review:one",decisionBy:"actor:one",
    });
    assert.equal(accepted.kernelApplication,"NOT_APPLIED");
    assert.equal(events.filter(e=>e.kind==="apply").length,0);
    const recovered=await f.browser.reconciliationRequest("receipt",{
      operationId:"review:one",packageSha256:digest,
    });
    assert.equal(recovered.receipt.operationId,"review:one");
    assert.equal(recovered.kernelApplication,
      "NOT_ATTESTED_BY_RECONCILIATION_RECEIPT");
    assert.equal(events.filter(e=>e.kind==="accept").length,1);
    // The Control, not only a React button, blocks a second original
    // Reconciliation dispatch for the same decision operation ID.
    await assert.rejects(f.browser.reconciliationRequest("accept",{
      packageSha256:digest,previewDigest:"c".repeat(64),
      operationId:"review:one",decisionBy:"actor:one",
    }),{code:"T3_D3_OWNER_REQUEST_OUTCOME_UNKNOWN"});
    await assert.rejects(f.browser.reconciliationRequest("reject",{
      packageSha256:digest,previewDigest:"c".repeat(64),
      operationId:"review:one",decisionBy:"actor:one",
    }),{code:"T3_D3_OWNER_REQUEST_OUTCOME_UNKNOWN"});
    assert.equal(events.filter(e=>e.kind==="accept").length,1);
    assert.equal(events.filter(e=>e.kind==="reject").length,0);
    await assert.rejects(f.browser.reconciliationRequest("accept",{
      packageSha256:digest,previewDigest:"c".repeat(64),
      operationId:"review:uncertain",decisionBy:"actor:one",
    }),{code:"T3_D3_OWNER_REQUEST_OUTCOME_UNKNOWN"});
    const afterLostAck=await f.browser.reconciliationRequest("receipt",{
      operationId:"review:uncertain",packageSha256:digest,
    });
    assert.equal(afterLostAck.found,true);
    assert.equal(afterLostAck.receipt.operationId,"review:uncertain");
    assert.equal(events.filter(e=>e.kind==="accept").length,2,
      "no automatic ACCEPT replay after readback failure");
    await assert.rejects(f.browser.reconciliationRequest("accept",{
      packageSha256:digest,previewDigest:"c".repeat(64),
      operationId:"review:uncertain",decisionBy:"actor:one",
    }),{code:"T3_D3_OWNER_REQUEST_OUTCOME_UNKNOWN"});
    assert.equal(events.filter(e=>e.kind==="accept").length,2);
    const d3Target={consumerId:"IWXA_ADMIN_CENTER",
      processId:"process:one",processVersion:"1.0.0",
      purpose:"result.apply",subjectId:"org:one",
      workspaceId:"ws:personal",dataRootId:"root:one"};
    const apply=await f.browser.reconciliationRequest("applyAccepted",{
      acceptanceId:"a".repeat(64),revisionIds:[digest],target:d3Target,
    });
    assert.equal(apply.kernelWriteReadback,"OWNER_UNCONFIRMED");
    const recoveredApply=await f.browser.reconciliationRequest("recoverApplied",{
      acceptanceId:"a".repeat(64),revisionIds:[digest],target:d3Target,
    });
    assert.equal(recoveredApply.status,"ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED");
    assert.equal(recoveredApply.automaticRetryAllowed,false);
    assert.equal(events.filter(e=>e.kind==="apply").length,1,
      "read-only recovery must not call original APPLY a second time");
    await assert.rejects(f.browser.reconciliationRequest("applyAccepted",{
      acceptanceId:"a".repeat(64),revisionIds:[digest],target:d3Target,
    }),{code:"T3_D3_OWNER_REQUEST_OUTCOME_UNKNOWN"});
    assert.equal(events.filter(e=>e.kind==="apply").length,1);
    assert.equal(events.filter(e=>e.kind==="recover-apply").length,1);
    // Ordinary untrusted pages cannot invoke native Reconciliation even
    // with the bearer unless they originate at the pinned Kernel origin.
    const forged=await fetch(f.origin+"/api/t3/reconciliation",{
      method:"POST",headers:{Authorization:"Bearer "+f.token,
        Origin:"https://untrusted.example","Content-Type":"application/json",
        "X-IWXA-Context-Epoch":"1"},
      body:JSON.stringify({verb:"preview",payload:{packageSha256:digest}}),
    });
    assert.equal(forged.status,403);
    assert.equal(events.filter(e=>e.kind==="preview").length,1);
    const stale=await fetch(f.origin+"/api/t3/reconciliation",{
      method:"POST",headers:{Authorization:"Bearer "+f.token,
        Origin:f.origin,"Content-Type":"application/json",
        "X-IWXA-Context-Epoch":"0"},
      body:JSON.stringify({verb:"preview",payload:{packageSha256:digest}}),
    });
    assert.equal(stale.status,403);
    assert.equal(events.filter(e=>e.kind==="preview").length,1);
    console.log("T3_D3_ORIGINAL_NATIVE_RECIPIENT_CONTROL_CARRIER_PASS");
  }finally{stop();await f.close();}
});


test("original D3 accepts a real-size carrier above the former 16 MiB limit",{
  timeout:45000,
},async()=>{
  const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
  const bytes=Buffer.alloc(16*1024*1024+1,0x5a);
  let received=0;
  const port={
    receive:async raw=>{
      received=raw.byteLength;
      assert.equal(createHash("sha256").update(raw).digest("hex"),
        createHash("sha256").update(bytes).digest("hex"));
      return {transportReceipt:{packageSha256:sha(raw)},
        acceptanceState:"NOT_ACCEPTED",kernelApplication:"NOT_APPLIED"};
    },
    preview:async()=>null,receipt:async()=>null,
    accept:async()=>null,reject:async()=>null,
    inspectAcceptedApplication:async()=>null,
  };
  const f=await fixture({reconciliationPortFor:()=>port});
  const stop=f.browser.subscribeSignedAccessInvalidation(()=>{});
  try{
    const answer=await f.browser.reconciliationRequest("receive",{bytes});
    assert.equal(answer.transportReceipt.packageSha256,sha(bytes));
    assert.equal(received,bytes.byteLength);
  }finally{stop();await f.close();}
});

test("D7 signed native age/Publisher roundtrip stays on original Control and never exposes custody",{
  timeout:12000,
},async()=>{
  const archive=Uint8Array.from([80,75,3,4,1,2,3,4,5,6]);
  const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
  const originalAge=Uint8Array.from([
    ...new TextEncoder().encode("age-encryption.org/v1\n"),9,8,7,6,
  ]);
  const subject={holderId:"holder:installed",recipientId:"recipient:installed",
    subjectType:"PERSON",bindingEpoch:"epoch:installed:one"};
  let ageSealCount=0,ageOpenCount=0,applyCount=0,exportApprovals=0;
  let actualRecipients=["recipient:installed","recipient:independent"];
  const saved=new Map();
  const nativeD7PortFor=async()=>({
    ageOwner:{
      maxArchiveBytes:32*1024*1024,
      currentRecipient:async()=>({recipientId:"recipient:installed",
        bindingEpoch:"epoch:installed:one",privateKey:"NEVER_TO_WEB"}),
      prepareSeal:async input=>({
        format:"age-encryption.org/v1",status:"READY",
        recipientIds:[...actualRecipients],
        suppliedWorkspace:input.workspaceId,
      }),
      seal:async input=>{ageSealCount++;
        assert.deepEqual([...input.archiveBytes],[...archive]);
        return {format:"age-encryption.org/v1",archiveSha256:sha(archive),
          recipientIds:input.recipientIds,ciphertext:originalAge};},
      open:async input=>{ageOpenCount++;
        assert.deepEqual([...input.ciphertext],[...originalAge]);
        assert.equal(input.recipientId,"recipient:installed");
        return {format:"age-encryption.org/v1",status:"OPENED_VERIFIED",
          verified:true,recipientId:input.recipientId,
          archiveSha256:sha(archive),archiveBytes:archive,
          nativeIdentity:"NEVER_TO_WEB"};},
    },
    authorizeAgeSeal:async args=>{
      exportApprovals++;
      assert.equal(args.workspaceId,"ws:personal");
      assert.equal(args.archiveSha256,sha(archive));
      return true;
    },
    publisherHolder:{
      currentSubject:async()=>({...subject,privateCredential:"NEVER_TO_WEB"}),
      inspect:async input=>({
        kind:input.kind,packageSha256:input.packageSha256,
        previewDigest:"a".repeat(64),holderId:subject.holderId,
        recipientId:subject.recipientId,
        publisherId:"publisher:original",issuerAuthorityId:"issuer:original",
        operationId:"op:license",licenseId:"license:one",stage:"READY",
        publisherSignatureVerified:true,pinnedPublisherTrusted:true,
        secretSigner:"NEVER_TO_WEB",
      }),
      apply:async input=>{applyCount++;
        saved.set(input.operationId,{kind:input.kind,
          operationId:input.operationId,packageSha256:input.packageSha256,
          holderId:subject.holderId,recipientId:subject.recipientId,
          issuerAuthorityId:"issuer:original",licenseId:"license:one",
          state:"COMMITTED"});},
      receipt:async query=>saved.get(query.operationId)??null,
      statusReadback:async query=>{
        const record=saved.get(query.operationId);
        return record?{...record,persisted:true,statusSequenceFloor:7,
          privateStatusVault:"NEVER_TO_WEB"}:null;},
    },
    confirmPublisherApply:async()=>true,
  });
  const f=await fixture({nativeD7PortFor});
  const unsubscribe=f.browser.subscribeSignedAccessInvalidation(()=>{});
  try{
    const available=await f.browser.nativeD7Request("available");
    assert.deepEqual(available,{ageOpen:true,ageSeal:true,
      ageNativeImport:false,ageNativeReadback:false,
      publisher:true,maxArchiveBytes:32*1024*1024});
    const recipient=await f.browser.nativeD7Request("age.currentRecipient");
    assert.deepEqual(recipient,{recipientId:"recipient:installed",
      bindingEpoch:"epoch:installed:one"});
    const encrypted=await f.browser.nativeD7Request("age.seal",{
      archiveBytes:archive,archiveSha256:sha(archive),
      recipientIds:["recipient:installed","recipient:independent"],
      workspaceId:"ws:personal",
    });
    assert.deepEqual([...encrypted.ciphertext],[...originalAge]);
    assert.equal(exportApprovals,1);
    assert.equal(ageSealCount,1);
    // Original native age and the existing D7 port both support 2..16
    // distinct trusted recipients, not just the two qualification roots.
    actualRecipients=["recipient:installed","recipient:independent",
      "recipient:third"];
    const multi=await f.browser.nativeD7Request("age.seal",{
      archiveBytes:archive,archiveSha256:sha(archive),
      recipientIds:["recipient:installed","recipient:independent",
        "recipient:third"],workspaceId:"ws:personal",
    });
    assert.equal(multi.recipientIds.length,3);
    assert.equal(ageSealCount,2);
    // A client cannot silently substitute an older or different recipient
    // list even when its source Workspace grant is valid.
    await assert.rejects(f.browser.nativeD7Request("age.seal",{
      archiveBytes:archive,archiveSha256:sha(archive),
      recipientIds:["recipient:installed","recipient:independent"],
      workspaceId:"ws:personal",
    }),{code:"T3_D7_NATIVE_RECIPIENT_PLAN_CHANGED"});
    assert.equal(ageSealCount,2);
    assert.equal(exportApprovals,2);
    const opened=await f.browser.nativeD7Request("age.open",{
      ciphertext:originalAge,recipientId:"recipient:installed",
    });
    assert.deepEqual([...opened.archiveBytes],[...archive]);
    assert.equal(ageOpenCount,1);
    assert.equal(Object.hasOwn(opened,"nativeIdentity"),false);
    const nativeSubject=await f.browser.nativeD7Request("publisher.currentSubject");
    assert.deepEqual(nativeSubject,subject);
    const inspected=await f.browser.nativeD7Request("publisher.inspect",{
      kind:"LICENSE",archiveBytes:archive,packageSha256:sha(archive),
      subject:nativeSubject,
    });
    assert.equal(inspected.publisherSignatureVerified,true);
    assert.equal(Object.hasOwn(inspected,"secretSigner"),false);
    await f.browser.nativeD7Request("publisher.apply",{
      kind:"LICENSE",archiveBytes:archive,packageSha256:sha(archive),
      previewDigest:"a".repeat(64),operationId:"op:license",
      subject:nativeSubject,
    });
    const query={kind:"LICENSE",operationId:"op:license",
      packageSha256:sha(archive),holderId:subject.holderId,
      recipientId:subject.recipientId};
    const receipt=await f.browser.nativeD7Request("publisher.receipt",query);
    const readback=await f.browser.nativeD7Request("publisher.statusReadback",query);
    assert.equal(receipt.state,"COMMITTED");
    assert.equal(readback.persisted,true);
    assert.equal(Object.hasOwn(readback,"privateStatusVault"),false);
    assert.equal(applyCount,1);
    // A duplicated native HTTP request or cold-open retry cannot apply
    // the same original operationId again, even after the UI is replaced.
    const duplicate=await f.browser.nativeD7Request("publisher.apply",{
      kind:"LICENSE",archiveBytes:archive,packageSha256:sha(archive),
      previewDigest:"a".repeat(64),operationId:"op:license",
      subject:nativeSubject,
    });
    assert.equal(duplicate.acknowledged,true);
    assert.equal(duplicate.recovered,true);
    assert.equal(applyCount,1);
    await assert.rejects(f.browser.nativeD7Request("publisher.apply",{
      kind:"LICENSE",archiveBytes:archive,packageSha256:sha(archive),
      previewDigest:"b".repeat(64),operationId:"op:license",
      subject:nativeSubject,
    }),{code:"T3_D7_NATIVE_OUTCOME_UNKNOWN"});
    assert.equal(applyCount,1);
    await assert.rejects(f.browser.nativeD7Request("publisher.receipt",{
      ...query,holderId:"holder:someone-else",
    }),{code:"T3_D7_ORIGINAL_NATIVE_HOLDER_CHANGED"});
    // Untrusted windows have neither the kernel-origin Origin nor the SSE
    // session, even if an attacker knows the public local HTTP address.
    const forged=await fetch(f.origin+"/api/t3/native-d7",{
      method:"POST",headers:{Authorization:"Bearer "+f.token,
        Origin:"http://127.0.0.1:3333","Content-Type":"application/json",
        "X-IWXA-Context-Epoch":"1"},
      body:JSON.stringify({verb:"publisher.currentSubject",payload:{}}),
    });
    assert.equal(forged.status,403);
    const stale=await fetch(f.origin+"/api/t3/native-d7",{
      method:"POST",headers:{Authorization:"Bearer "+f.token,
        Origin:f.origin,"Content-Type":"application/json",
        "X-IWXA-Context-Epoch":"0"},
      body:JSON.stringify({verb:"publisher.currentSubject",payload:{}}),
    });
    assert.equal(stale.status,403);
  }finally{unsubscribe();await f.close();}
});

test("D7 native age refuses decrypted bytes if installed recipient changes mid-open",async()=>{
  const ciphertext=Uint8Array.from([
    ...new TextEncoder().encode("age-encryption.org/v1\n"),1,2,3,4]);
  let identityEpoch="epoch:first";
  const owner=()=>({ageOwner:{
    currentRecipient:async()=>({
      recipientId:"recipient:installed",bindingEpoch:identityEpoch}),
    open:async()=>{identityEpoch="epoch:changed";
      return {format:"age-encryption.org/v1",status:"OPENED_VERIFIED",
        verified:true,recipientId:"recipient:installed",
        archiveSha256:"a".repeat(64),
        archiveBytes:Uint8Array.of(80,75,3,4,1,2,3,4)};
    },
  }});
  const f=await fixture({nativeD7PortFor:owner});
  const stop=f.browser.subscribeSignedAccessInvalidation(()=>{});
  try{
    const available=await f.browser.nativeD7Request("available");
    assert.equal(available.ageOpen,true);
    assert.equal(available.publisher,false);
    await assert.rejects(f.browser.nativeD7Request("age.open",{
      ciphertext,recipientId:"recipient:installed",
    }),{code:"T3_D7_ORIGINAL_NATIVE_RECIPIENT_CHANGED"});
  }finally{stop();await f.close();}
});

test("D6 original Control connects installed signed Result port without sending source Object",async()=>{
  const reference={workspace_id:"ws:personal",object_id:"result:001",
    schema_id:"original-result",revision:3};
  let writes=0;
  let recorded=false;
  // Transport-only fixture: the real installed product must supply a port
  // built with createTrustedNativeContinuation and original signed Kernel.
  const nativeD6PortFor=async()=>({
    preview:async input=>({status:recorded?"RECOVER_ONLY":"AVAILABLE",
      operationId:"op:native:one",recipientId:"recipient:atlas",reference:input}),
    continueSelected:async input=>{
      writes++;
      recorded=true;
      return {status:"OWNER_READBACK_CONFIRMED",operationId:"op:native:one",
        recipientId:"recipient:atlas",resultRef:"result:atlas:one",reference:input,
        internalCredential:"NEVER_TO_UI",sourceObject:{secret:"NEVER_TO_UI"}};
    },
    recover:async input=>({status:recorded?"OWNER_READBACK_CONFIRMED":"OUTCOME_UNKNOWN",
      operationId:"op:native:one",recipientId:"recipient:atlas",
      resultRef:recorded?"result:atlas:one":undefined,reference:input}),
  });
  const f=await fixture({nativeD6PortFor});
  const stop=f.browser.subscribeSignedAccessInvalidation(()=>{});
  try{
    assert.deepEqual(await f.browser.nativeD6Request("available",{}),
      {available:true});
    const preview=await f.browser.nativeD6Request("preview",{reference});
    assert.equal(preview.status,"AVAILABLE");
    assert.deepEqual(preview.reference,reference);
    const delivered=await f.browser.nativeD6Request("continueSelected",{reference});
    assert.equal(delivered.status,"OWNER_READBACK_CONFIRMED");
    assert.equal(delivered.resultRef,"result:atlas:one");
    assert.equal(Object.hasOwn(delivered,"internalCredential"),false);
    assert.equal(Object.hasOwn(delivered,"sourceObject"),false);
    assert.equal(writes,1);
    assert.equal((await f.browser.nativeD6Request("recover",{reference})).status,
      "OWNER_READBACK_CONFIRMED");
    // A second direct HTTP call must NOT dispatch a second native write,
    // even if the installed factory reconstructs a fresh D6 port each time.
    const second=await f.browser.nativeD6Request("continueSelected",{reference});
    assert.equal(second.status,"OUTCOME_UNKNOWN");
    assert.equal(writes,1);
    await assert.rejects(f.browser.nativeD6Request("preview",{
      reference:{...reference,revision:0},
    }),{code:"T3_D6_SELECTED_REFERENCE_INVALID"});
    // The mutating verb conservatively maps even a validation failure to
    // UNKNOWN; it never tells the browser to replay a possible native write.
    await assert.rejects(f.browser.nativeD6Request("continueSelected",{
      reference:{...reference,revision:0},
    }),{code:"T3_D6_NATIVE_OUTCOME_UNKNOWN"});
    assert.equal(writes,1);
    const forged=await fetch(f.origin+"/api/t3/native-d6",{
      method:"POST",headers:{Authorization:"Bearer "+f.token,
        Origin:"http://127.0.0.1:3000","Content-Type":"application/json",
        "X-IWXA-Context-Epoch":"1"},
      body:JSON.stringify({verb:"preview",payload:{reference}}),
    });
    assert.equal(forged.status,403);
  }finally{stop();await f.close();}
});

test("D7 installed age verifies and previews original Kernel without returning decrypted .iwxa to WebView",async()=>{
  const cipher=Uint8Array.from([
    ...new TextEncoder().encode("age-encryption.org/v1\n"),1,2,3,4]);
  const archiveSha256="c".repeat(64);
  let opened=0,imports=0,cancels=0,receiptSemantic="sem:one";
  let signalCommitStarted,releaseCommit,signalCancelStarted,releaseCancel;
  const commitStarted=new Promise(resolve=>{signalCommitStarted=resolve;});
  const commitMayFinish=new Promise(resolve=>{releaseCommit=resolve;});
  const cancelStarted=new Promise(resolve=>{signalCancelStarted=resolve;});
  const cancelMayFinish=new Promise(resolve=>{releaseCancel=resolve;});
  const nativeD7PortFor=async()=>({ageOwner:{
    currentRecipient:async()=>({recipientId:"recipient:installed",
      bindingEpoch:"epoch:installed:one",privateKey:"NEVER_TO_WEB"}),
    // A real installed native owner keeps the decrypted .iwxa behind its
    // original Kernel; there is NO raw open() API in the public port.
    previewInOriginalKernel:async input=>{
      opened++;
      assert.equal(input.recipientId,"recipient:installed");
      assert.deepEqual([...input.ciphertext],[...cipher]);
      return {status:"KERNEL_PREVIEW_READY",
        recipientId:"recipient:installed",archiveSha256,
        archiveBytes:Uint8Array.of(80,75,3,4),
        privateKey:"NOT_FOR_UI",
        handle:{preview_token:opened===1?"tok:native:one":
          opened===2?"tok:native:unused":
          opened===3?"tok:native:cancel-first":"tok:native:semantic:wrong",
          package_digest:"digest:one",
          semantic_digest:"sem:one",expires_at:"2099-01-01T00:00:00Z",
          allowed_modes:["new-workspace"],
          preview:{workspaces:[],objects:[],warnings:[]},
          originalPrivateArchive:"NOT_FOR_UI"},
      };
    },
    commitInOriginalKernel:async input=>{
      imports++;
      signalCommitStarted();
      await commitMayFinish;
      return {
      import_id:"import:native:one",format:"iwxa.import.receipt",
      format_version:"1.0",package_digest:input.package_digest,
      semantic_digest:receiptSemantic,mode:input.plan.mode,
      conflict_policy:"fail",committed_at:"2026-11-15T00:00:00Z",
      applied:{workspaces:1,objects_inserted:0,objects_updated:0,
        objects_skipped:0,events:0,relations:0,assets:0,
        schemas_inserted:0,schemas_reused:0,schemas_rejected:0},
      skipped_conflicts:[],workspace_id_map:{},
      excluded_by_permission:{workspaces:0,objects:0,events:0,
        relations:0,assets:0},
      };
    },
    cancelInOriginalKernel:async input=>{
      if(input.preview_token==="tok:native:cancel-first"){
        cancels++;
        signalCancelStarted();
        await cancelMayFinish;
      }
      return true;
    },
  },authorizeAgeImportCommit:async()=>true});
  const f=await fixture({nativeD7PortFor});
  const stop=f.browser.subscribeSignedAccessInvalidation(()=>{});
  try{
    const availability=await f.browser.nativeD7Request("available");
    assert.equal(availability.ageNativeImport,true);
    assert.equal(availability.ageNativeReadback,false);
    assert.equal(availability.ageOpen,true,"native import available without raw open");
    await assert.rejects(f.browser.nativeD7Request("age.open",{
      ciphertext:cipher,recipientId:"recipient:installed",
    }),{code:"T3_D7_NATIVE_PLAINTEXT_PRIVATE"});
    const result=await f.browser.nativeD7Request("age.previewImport",{ciphertext:cipher});
    assert.equal(result.status,"KERNEL_PREVIEW_READY");
    assert.equal(result.handle.preview_token,"tok:native:one");
    assert.equal(result.archiveSha256,archiveSha256);
    const plan={mode:"new-workspace",include_workspaces:[]};
    const request={preview_token:result.handle.preview_token,
      package_digest:result.handle.package_digest,plan};
    // The native Control must not commit or cancel original Kernel tokens
    // that were never issued through its verified age preview.
    await assert.rejects(f.browser.nativeD7Request("age.commitImport",{
      ...request,preview_token:"tok:plain:foreign",
    }),{code:"T3_D7_NATIVE_OUTCOME_UNKNOWN"});
    await assert.rejects(f.browser.nativeD7Request("age.cancelImport",{
      preview_token:"tok:plain:foreign",
    }),{code:"T3_D7_NATIVE_OUTCOME_UNKNOWN"});
    await assert.rejects(f.browser.nativeD7Request("age.commitImport",{
      ...request,package_digest:"digest:tampered",
    }),{code:"T3_D7_NATIVE_OUTCOME_UNKNOWN"});
    await assert.rejects(f.browser.nativeD7Request("age.commitImport",{
      ...request,plan:{...plan,mode:"merge"},
    }),{code:"T3_D7_NATIVE_OUTCOME_UNKNOWN"});
    assert.equal(imports,0);
    const first=f.browser.nativeD7Request("age.commitImport",request);
    await commitStarted;
    // Even when the installed product reconstructs its native owner for
    // every HTTP request, a second native write and a racing cancel cannot
    // pass while the first original Kernel commit is pending.
    await assert.rejects(f.browser.nativeD7Request("age.commitImport",request),
      {code:"T3_D7_NATIVE_OUTCOME_UNKNOWN"});
    await assert.rejects(f.browser.nativeD7Request("age.cancelImport",{
      preview_token:result.handle.preview_token,
    }),{code:"T3_D7_NATIVE_OUTCOME_UNKNOWN"});
    assert.equal(imports,1);
    releaseCommit();
    const committed=await first;
    assert.equal(committed.format,"iwxa.import.receipt");
    assert.equal(committed.import_id,"import:native:one");
    assert.equal(committed.package_digest,"digest:one");
    // A lost ACK would otherwise permit a second write. After original
    // commit, only an independent original Kernel readback can establish
    // the outcome; this Control never re-dispatches that preview token.
    await assert.rejects(f.browser.nativeD7Request("age.commitImport",request),
      {code:"T3_D7_NATIVE_OUTCOME_UNKNOWN"});
    assert.equal(imports,1);
    const unused=await f.browser.nativeD7Request("age.previewImport",{
      ciphertext:cipher,
    });
    assert.equal(unused.handle.preview_token,"tok:native:unused");
    const cancelled=await f.browser.nativeD7Request("age.cancelImport",{
      preview_token:unused.handle.preview_token,
    });
    assert.equal(cancelled.cancelled,true);
    // Cancellation started FIRST must exclude a racing native commit.
    // Otherwise the original Kernel can cancel and then import the same
    // preview during the first cancellation's pending acknowledgement.
    const pending=await f.browser.nativeD7Request("age.previewImport",{
      ciphertext:cipher,
    });
    assert.equal(pending.handle.preview_token,"tok:native:cancel-first");
    const cancelFirst=f.browser.nativeD7Request("age.cancelImport",{
      preview_token:pending.handle.preview_token,
    });
    await cancelStarted;
    const afterCancelRequest={...request,preview_token:"tok:native:cancel-first"};
    await assert.rejects(f.browser.nativeD7Request("age.commitImport",
      afterCancelRequest),{code:"T3_D7_NATIVE_OUTCOME_UNKNOWN"});
    assert.equal(imports,1);
    releaseCancel();
    assert.deepEqual(await cancelFirst,{cancelled:true});
    assert.equal(cancels,1);
    await assert.rejects(f.browser.nativeD7Request("age.commitImport",
      afterCancelRequest),{code:"T3_D7_NATIVE_OUTCOME_UNKNOWN"});
    await assert.rejects(f.browser.nativeD7Request("age.cancelImport",{
      preview_token:"tok:native:cancel-first",
    }),{code:"T3_D7_NATIVE_OUTCOME_UNKNOWN"});
    assert.equal(imports,1);
    // A native receipt with the right package digest but the WRONG semantic
    // digest is not confirmation of the originally verified age preview.
    const semanticPreview=await f.browser.nativeD7Request("age.previewImport",{
      ciphertext:cipher,
    });
    assert.equal(semanticPreview.handle.preview_token,"tok:native:semantic:wrong");
    receiptSemantic="sem:unrelated";
    const semanticRequest={...request,
      preview_token:semanticPreview.handle.preview_token};
    await assert.rejects(f.browser.nativeD7Request("age.commitImport",
      semanticRequest),{code:"T3_D7_NATIVE_OUTCOME_UNKNOWN"});
    await assert.rejects(f.browser.nativeD7Request("age.commitImport",
      semanticRequest),{code:"T3_D7_NATIVE_OUTCOME_UNKNOWN"});
    assert.equal(imports,2,"only one original Kernel call per native token");
    assert.equal(Object.hasOwn(result,"archiveBytes"),false);
    assert.equal(Object.hasOwn(result,"privateKey"),false);
    assert.equal(Object.hasOwn(result.handle,"originalPrivateArchive"),false);
    assert.equal(opened,4);
  }finally{stop();await f.close();}
});

// The encrypted age carrier can be larger than the 32 MiB original ZIP.
// Its base64url POST exceeds both the default strictJson 32 MiB and the
// D3 plaintext carrier budget. Confirm that the ORIGINAL installed owner
// actually receives it, not merely that HTTP accepts the content length.
test("D7 installed native age preview accepts bounded >32 MiB encrypted carrier",async()=>{
  const largeCipher=new Uint8Array(32*1024*1024+64*1024);
  largeCipher.set(new TextEncoder().encode("age-encryption.org/v1\n"));
  let previewCalls=0;
  const nativeD7PortFor=async()=>({ageOwner:{
    currentRecipient:async()=>({recipientId:"recipient:installed",
      bindingEpoch:"epoch:installed:one"}),
    previewInOriginalKernel:async({ciphertext,recipientId})=>{
      previewCalls++;
      assert.equal(recipientId,"recipient:installed");
      assert.equal(ciphertext.length,largeCipher.length);
      return {status:"KERNEL_PREVIEW_READY",recipientId,
        archiveSha256:"a".repeat(64),
        handle:{preview_token:"tok:large:one",package_digest:"digest:large",
          semantic_digest:"sem:large",expires_at:"2099-01-01T00:00:00Z",
          allowed_modes:["new-workspace"],preview:{workspaces:[],objects:[],
            warnings:[]}},
      };
    },
    commitInOriginalKernel:async()=>{throw Error("NEVER_COMMIT");},
    cancelInOriginalKernel:async()=>true,
  },authorizeAgeImportCommit:async()=>false});
  const f=await fixture({nativeD7PortFor});
  const stop=f.browser.subscribeSignedAccessInvalidation(()=>{});
  try{
    const result=await f.browser.nativeD7Request("age.previewImport",{
      ciphertext:largeCipher,
    });
    assert.equal(result.status,"KERNEL_PREVIEW_READY");
    assert.equal(result.handle.preview_token,"tok:large:one");
    assert.equal(previewCalls,1);
  }finally{stop();await f.close();}
});

test("D7 independent installed Kernel readback resolves lost import ACK without another ZIP or commit",async()=>{
  let reads=0,commits=0,epoch="epoch:installed:one";
  const receipt={
    import_id:"import:native:persisted",format:"iwxa.import.receipt",
    format_version:"1.0",package_digest:"digest:persisted",
    semantic_digest:"semantic:persisted",mode:"new-workspace",
    conflict_policy:"fail",committed_at:"2026-11-15T00:00:00Z",
    applied:{workspaces:1,objects_inserted:1,objects_updated:0,
      objects_skipped:0,events:0,relations:0,assets:0,
      schemas_inserted:0,schemas_reused:0,schemas_rejected:0},
    workspace_id_map:{"ws:source":"ws:restored"},
    skipped_conflicts:[],excluded_by_permission:{},
  };
  const nativeD7PortFor=async()=>({ageOwner:{
    currentRecipient:async()=>({recipientId:"recipient:installed",
      bindingEpoch:epoch}),
    previewInOriginalKernel:async()=>{throw Error("ZIP_NOT_REQUESTED");},
    commitInOriginalKernel:async()=>{commits++;throw Error("NO_REIMPORT");},
    cancelInOriginalKernel:async()=>true,
    readbackInOriginalKernel:async input=>{
      reads++;
      assert.equal(input.recipientId,"recipient:installed");
      if(input.preview_token!=="tok:persisted"||
        input.package_digest!==receipt.package_digest||
        input.semantic_digest!==receipt.semantic_digest)return {status:"OUTCOME_UNKNOWN"};
      return {status:"OWNER_READBACK_CONFIRMED",readbackVerified:true,
        preview_token:input.preview_token,
        recipientId:"recipient:installed",receipt,
        sensitiveCredential:"NEVER_TO_WEB"};
    },
  },authorizeAgeImportCommit:async()=>false});
  const create=()=>fixture({nativeD7PortFor});
  const query={preview_token:"tok:persisted",
    package_digest:receipt.package_digest,
    semantic_digest:receipt.semantic_digest,mode:"new-workspace"};
  const f=await create();const stop=f.browser.subscribeSignedAccessInvalidation(()=>{});
  try{
    assert.equal((await f.browser.nativeD7Request("available")).ageNativeReadback,true);
    const found=await f.browser.nativeD7Request("age.readbackImport",query);
    assert.equal(found.status,"OWNER_READBACK_CONFIRMED");
    assert.equal(found.receipt.import_id,receipt.import_id);
    assert.equal(Object.hasOwn(found,"sensitiveCredential"),false);
    assert.equal((await f.browser.nativeD7Request("age.readbackImport",{
      ...query,semantic_digest:"semantic:unknown",
    })).status,"OUTCOME_UNKNOWN");
    assert.equal(reads,2);assert.equal(commits,0);
  }finally{stop();await f.close();}
  // New Control process has NO preview claim. The original installed
  // recipient still resolves persisted evidence without importCommit.
  const cold=await create();const stopCold=cold.browser.subscribeSignedAccessInvalidation(()=>{});
  try{
    const result=await cold.browser.nativeD7Request("age.readbackImport",query);
    assert.equal(result.status,"OWNER_READBACK_CONFIRMED");
    assert.equal(result.receipt.package_digest,receipt.package_digest);
    assert.equal(reads,3);assert.equal(commits,0);
  }finally{stopCold();await cold.close();}
});

test("D3 two racing original Apply calls cannot dispatch twice when native port is reconstructed",{
  timeout:12000,
},async()=>{
  let entered=0,finish,signal;
  const ready=new Promise(resolve=>{signal=resolve;});
  const release=new Promise(resolve=>{finish=resolve;});
  const portFor=()=>({
    receive:async()=>({}),preview:async()=>({}),receipt:async()=>({}),
    accept:async()=>({}),reject:async()=>({}),
    inspectAcceptedApplication:async()=>({}),
    applyAccepted:async()=>{
      entered++;signal();
      await release;
      return {kernelWriteReadback:"CONFIRMED"};
    },
    recoverApplied:async()=>({status:"OUTCOME_UNKNOWN",automaticRetryAllowed:false}),
  });
  const f=await fixture({reconciliationPortFor:portFor});
  const stop=f.browser.subscribeSignedAccessInvalidation(()=>{});
  const payload={acceptanceId:"a".repeat(64),revisionIds:["b".repeat(64)],
    target:{consumerId:"IWXA_ADMIN_CENTER",processId:"process:one",
      processVersion:"1.0.0",purpose:"result.apply",
      subjectId:"org:one",workspaceId:"ws:one",dataRootId:"root:one"}};
  try{
    const first=f.browser.reconciliationRequest("applyAccepted",payload);
    await ready;
    await assert.rejects(f.browser.reconciliationRequest("applyAccepted",payload),
      {code:"T3_D3_OWNER_REQUEST_OUTCOME_UNKNOWN"});
    assert.equal(entered,1,"only one original native Kernel Apply dispatched");
    finish();
    assert.equal((await first).kernelWriteReadback,"CONFIRMED");
    await assert.rejects(f.browser.reconciliationRequest("applyAccepted",payload),
      {code:"T3_D3_OWNER_REQUEST_OUTCOME_UNKNOWN"});
    assert.equal(entered,1);
    assert.equal((await f.browser.reconciliationRequest("recoverApplied",payload))
      .status,"OUTCOME_UNKNOWN","recovery remains an independent read-only owner call");
    assert.equal(entered,1);
    // A fresh signed context/HTTP client on the SAME Host must not turn
    // the earlier Apply into a second original Kernel dispatch.
    f.invalidate();
    const fresh=createControlLoopbackOwner({
      origin:f.origin,token:f.token,
      fetchImpl:(url,options={})=>fetch(url,{
        ...options,headers:{...options.headers,Origin:f.origin},
      }),
    });
    // Original T3 forbids even a READ before the fresh trusted client has
    // attached to its invalidation SSE. Qualify the actual new Host generation.
    const stopFresh=fresh.subscribeSignedAccessInvalidation(()=>{});
    try{
      await assert.rejects(fresh.reconciliationRequest("applyAccepted",payload),
        {code:"T3_D3_OWNER_REQUEST_OUTCOME_UNKNOWN"});
      assert.equal(entered,1,"epoch rotation cannot redispatch the same Apply");
    }finally{stopFresh();}
  }finally{finish();stop();await f.close();}
});
