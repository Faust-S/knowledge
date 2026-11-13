import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {createT3InstalledSubjectSession,isT3InstalledSubjectSession}
  from "../src/t3/installed-original-control-host.mjs";
import {createOriginalControlHttpHandler}
  from "../src/t3/original-control-http-handler.mjs";

const personal={kind:"PERSONAL",context_id:"context:personal",
  actor_id:"person:operator",principal_id:"person:operator",
  role_id:"role:member",grant_id:"grant:personal",
  realm_id:"realm:iwxa",audience:"host:t3",
  organization_id:null,workspace_id:"ws:personal",
  resource:"ws:personal",purpose:"purpose:work"};
const corporate=id=>({
  ...personal,kind:"CORP",context_id:"context:"+id,
  principal_id:"org:"+id,organization_id:"org:"+id,
  grant_id:"grant:"+id,workspace_id:"ws:"+id,resource:"ws:"+id,
});
const choices=[
  {selectionId:"personal",label:"Личный контур",context:personal},
  {selectionId:"north",label:"North",context:corporate("north")},
  {selectionId:"south",label:"South",context:corporate("south")},
];

test("installed Control subject session requires deliberate choice and invalidates existing original epoch",async()=>{
  let approved=true,changeCount=0;
  const session=createT3InstalledSubjectSession({
    readCandidates:async()=>structuredClone(choices),
    validateSelection:async()=>approved,
  });
  assert.equal(isT3InstalledSubjectSession(session),true);
  assert.equal(isT3InstalledSubjectSession({}),false);
  assert.equal(session.currentEpoch(),1);
  assert.equal(session.currentContext(),null);
  assert.deepEqual((await session.availableContexts()).map(x=>x.selectionId),
    ["personal","north","south"]);
  const listed=await session.availableContexts();
  assert.equal(JSON.stringify(listed).includes("grant:personal"),false);
  const off=session.subscribeInvalidation(()=>{changeCount++;});
  await assert.rejects(session.selectContext({
    selectionId:"north",userConfirmed:false,
  }),{code:"T3_D1_INSTALLED_HOST_SUBJECT_SESSION_USER_CONFIRMATION_REQUIRED"});
  assert.equal(session.currentEpoch(),1);
  await assert.rejects(session.selectContext({
    selectionId:"unknown",userConfirmed:true,
  }),{code:"T3_D1_INSTALLED_HOST_SUBJECT_SESSION_CHOICE_UNAVAILABLE"});
  approved=false;
  await assert.rejects(session.selectContext({
    selectionId:"north",userConfirmed:true,
  }),{code:"T3_D1_INSTALLED_HOST_SUBJECT_SESSION_SELECTION_NOT_VERIFIED"});
  assert.equal(session.currentContext(),null);
  approved=true;
  const p=await session.selectContext({selectionId:"personal",userConfirmed:true});
  assert.equal(p.contextEpoch,2);
  assert.equal(p.kind,"PERSONAL");
  assert.equal(session.currentContext().organization_id,null);
  const external=session.currentContext();
  external.workspace_id="ws:south";
  assert.equal(session.currentContext().workspace_id,"ws:personal");
  const n=await session.selectContext({selectionId:"north",userConfirmed:true});
  assert.equal(n.contextEpoch,3);
  assert.equal(session.currentContext().organization_id,"org:north");
  const s=await session.selectContext({selectionId:"south",userConfirmed:true});
  assert.equal(s.contextEpoch,4);
  assert.equal(session.currentContext().workspace_id,"ws:south");
  assert.equal(changeCount,3);
  session.invalidateSignedState();
  assert.equal(session.currentContext(),null);
  assert.equal(session.currentEpoch(),5);
  assert.equal(changeCount,4);
  off();
  session.close();
  assert.equal(changeCount,4);
  assert.throws(()=>session.currentContext(),
    {code:"T3_D1_INSTALLED_HOST_SUBJECT_SESSION_CLOSED"});
  console.log("T3_D1_THREE_SUBJECT_EXPLICIT_SESSION_PASS",JSON.stringify({
    candidates:3,explicitSelection:true,initiallyNoAuthority:true,
    oldSessionInvalidatedEverySwitch:true,selectedContextNotExposedMutable:true,
    signedStateInvalidationRequiresNewSelection:true,
  }));
});

test("simultaneous trusted selections cannot commit a delayed stale selection",async()=>{
  let permitNorth;
  const session=createT3InstalledSubjectSession({
    readCandidates:async()=>structuredClone(choices),
    validateSelection:async ctx=>ctx.organization_id==="org:north"
      ?await new Promise(ok=>{permitNorth=ok;}):true,
  });
  const previous=session.selectContext({
    selectionId:"north",userConfirmed:true,
  });
  while(typeof permitNorth!=="function")
    await new Promise(ok=>setImmediate(ok));
  const latest=await session.selectContext({
    selectionId:"south",userConfirmed:true,
  });
  permitNorth(true);
  await assert.rejects(previous,
    {code:"T3_D1_INSTALLED_HOST_SUBJECT_SESSION_SELECTION_SUPERSEDED"});
  assert.equal(latest.kind,"CORP");
  assert.equal(session.currentContext().organization_id,"org:south");
  assert.equal(session.currentEpoch(),2);
  session.close();
});

test("original Control HTTP rejects a stale browser context epoch after explicit native subject switch",async()=>{
  const session=createT3InstalledSubjectSession({
    readCandidates:async()=>structuredClone(choices),
    validateSelection:async()=>true,
  });
  const server=createServer((request,response)=>{
    void handler(request,response).catch(()=>{
      response.writeHead(503);response.end();
    });
  });
  let handler;
  await new Promise((ok,bad)=>{
    server.once("error",bad);
    server.listen(0,"127.0.0.1",ok);
  });
  const origin="http://127.0.0.1:"+server.address().port;
  const token="A".repeat(48);
  const signedOwner={
    currentContext:session.currentContext,
    actionFor:()=>{throw Error("not authorized in transport test");},
    operationDigest:()=>{throw Error("not authorized in transport test");},
    authorize:()=>{throw Error("not authorized in transport test");},
    verifyDecisionBinding:()=>false,
  };
  handler=createOriginalControlHttpHandler({
    origin,token,
    currentEpoch:session.currentEpoch,
    subscribeInvalidation:session.subscribeInvalidation,
    ownerFor:()=>session.currentContext()===null?null:signedOwner,
  });
  const request=async(epoch,verb="select")=>{
    const response=await fetch(origin+"/api/t3/owner",{
      method:"POST",headers:{
        Authorization:"Bearer "+token,Origin:origin,
        "Content-Type":"application/json",
        "X-IWXA-Context-Epoch":String(epoch),
      },
      body:JSON.stringify({scope:"kernel",operation:"putObject",verb}),
    });
    return {status:response.status,body:await response.json()};
  };
  try{
    const empty=await request(1);
    assert.equal(empty.status,200);
    assert.equal(empty.body.available,false);
    const p=await session.selectContext({
      selectionId:"personal",userConfirmed:true,
    });
    assert.equal((await request(p.contextEpoch)).body.available,true);
    const response=await fetch(origin+"/api/t3/owner-events",{
      headers:{Authorization:"Bearer "+token,Accept:"text/event-stream"},
    });
    assert.equal(response.status,200);
    const reader=response.body.getReader();
    const first=await reader.read();
    assert.match(new TextDecoder().decode(first.value),/event: ready/);
    const n=await session.selectContext({
      selectionId:"north",userConfirmed:true,
    });
    const notice=await reader.read();
    assert.match(new TextDecoder().decode(notice.value),/event: invalidated/);
    const stale=await request(p.contextEpoch,"context");
    assert.equal(stale.status,403);
    assert.equal(stale.body.error,"STALE_CONTEXT_OPERATION");
    assert.equal((await request(n.contextEpoch,"context")).body.context.organization_id,
      "org:north");
    session.invalidateSignedState();
    assert.equal((await request(session.currentEpoch())).body.available,false);
    await reader.cancel();
    console.log("T3_D1_THREE_SUBJECT_ORIGINAL_CONTROL_EPOCH_SSE_PASS");
  }finally{
    session.close();
    server.closeAllConnections();
    await new Promise(ok=>server.close(()=>ok()));
  }
});
