import test from "node:test";
import assert from "node:assert/strict";
import {createTrustedNativeContinuation} from "../src/t3/native-result-continuation.mjs";

// Public contract fixture only: no real native Atlas/Agent/issuer is present.
function fixture(beforeHuman=async()=>{}){
  let revision=2,approved=true,revoked=false,selected=true,dropAck=false,receives=0;
  const workspace={workspace_id:"ws:personal",deleted_at:null};
  const focus={get:()=>selected?workspace:null,subscribe:()=>()=>{}};
  const ref={workspace_id:"ws:personal",object_id:"result:001",
    schema_id:"practice-result",revision:2};
  const context={kind:"PERSONAL",context_id:"ctx:personal",actor_id:"actor:owner",
    principal_id:"actor:owner",role_id:"role:owner",grant_id:"grant:owner",
    realm_id:"realm:local",audience:"service:demo",resource:"ws:personal",
    purpose:"read",workspace_id:"ws:personal",organization_id:null,scope_revision:1};
  const now=()=>new Date().toISOString(),later=()=>new Date(Date.now()+60000).toISOString();
  const access={
    currentContext:()=>context,actionFor:()=> "workspace.read",
    operationDigest:()=> "a".repeat(64),
    authorize:()=>({schema:"IWXA_T3_AUTHORIZATION_DECISION/1",
      allowed:!revoked,outcome:revoked?"DENIED":"PERMITTED",evidenceOnly:true,
      requestDigest:"b".repeat(64),policyDigest:"c".repeat(64),
      statusSequence:1,validUntil:later(),statusObservedAt:now(),
      evaluatedAt:now(),authorityPath:[{grantId:context.grant_id}]}),
    verifyDecisionBinding:()=>true,
  };
  const kernel={sessionInfo:{contract_version:"1.3.0"},
    hasOperation:operation=>operation==="t1.getObject",
    async getObject(ws,id){
      return {object:{...ref,workspace_id:ws,object_id:id,revision,
        schema_id:ref.schema_id,data:{value:42},deleted:false},
        relations:{incoming:[],outgoing:[]}};
    }};
  const commits=new Map();
  const nativeOwner={
    recipientId:"native:atlas",
    inspect:({reference})=>({status:"READY",operationId:"op:stable:001",
      recipientId:"native:atlas",reference}),
    receive:async({operationId,reference})=>{
      receives++;
      commits.set(operationId,{state:"COMMITTED",operationId,
        recipientId:"native:atlas",reference,resultRef:"atlas:work:001"});
      if(dropAck)throw new Error("native reply lost");
    },
    receipt:async operationId=>commits.get(operationId)??null,
    readback:async operationId=>{
      const row=commits.get(operationId);
      return row?{...row,state:"PERSISTED"}:null;
    },
  };
  let confirmations=0;
  const makePort=()=>createTrustedNativeContinuation({
    kernel,accessForRead:async()=>access,currentWorkspace:focus,nativeOwner,
    confirmHuman:async()=>{
      confirmations++;
      await beforeHuman();
      return approved;
    },isHostActive:()=>true,
  });
  const port=makePort();
  return {port,makePort,confirmations:()=>confirmations,
    ref,commits,changeRevision:n=>revision=n,
    setApproved:v=>approved=v,setRevoked:v=>revoked=v,
    setSelected:v=>selected=v,setDropAck:v=>dropAck=v,receives:()=>receives};
}
test("D6 selected signed Result continues to an installed owner with independent readback",async()=>{
  const f=fixture();
  assert.equal((await f.port.preview(f.ref)).status,"AVAILABLE");
  const result=await f.port.continueSelected(f.ref);
  assert.equal(result.status,"OWNER_READBACK_CONFIRMED");
  assert.equal(result.resultRef,"atlas:work:001");
  assert.equal(f.receives(),1);
  assert.equal((await f.port.recover(f.ref)).status,"OWNER_READBACK_CONFIRMED");
  assert.equal(f.receives(),1);
  f.changeRevision(3);
  await assert.rejects(f.port.continueSelected(f.ref),{code:"T3_D6_STALE_OR_MISSING_REFERENCE"});
  f.changeRevision(2);
  f.setRevoked(true);
  await assert.rejects(f.port.continueSelected(f.ref),{code:"T3_ACCESS_NOT_PERMITTED"});
  assert.equal(f.receives(),1);
});
test("D6 denial and lost native ACK never automatically dispatch twice",async()=>{
  const f=fixture();
  f.setApproved(false);
  assert.equal((await f.port.continueSelected(f.ref)).status,"USER_CANCELLED");
  assert.equal(f.receives(),0);
  f.setSelected(false);
  await assert.rejects(f.port.continueSelected(f.ref),
    {code:"T3_D6_SELECTED_WORKSPACE_REQUIRED"});
  f.setSelected(true);
  f.setApproved(true);
  f.setDropAck(true);
  const unknown=await f.port.continueSelected(f.ref);
  assert.equal(unknown.status,"OUTCOME_UNKNOWN");
  assert.equal(f.receives(),1);
  // The original owner may still report READY after the ACK was lost.
  // The same Host must not dispatch its operation a second time.
  assert.equal((await f.port.preview(f.ref)).status,"RECOVER_ONLY");
  assert.equal((await f.port.continueSelected(f.ref)).status,"OUTCOME_UNKNOWN");
  assert.equal(f.receives(),1);
  assert.equal((await f.port.recover(f.ref)).status,"OWNER_READBACK_CONFIRMED");
  assert.equal(f.receives(),1);
});

test("D6 concurrent continuation uses one human decision and one native write",async()=>{
  let entered,release;
  const humanEntered=new Promise(resolve=>{entered=resolve;});
  const approvalGate=new Promise(resolve=>{release=resolve;});
  let confirmations=0;
  const f=fixture(async()=>{
    confirmations++;
    entered();
    await approvalGate;
  });
  const first=f.port.continueSelected(f.ref);
  await humanEntered;
  assert.equal((await f.port.preview(f.ref)).status,"OPERATION_IN_PROGRESS");
  const repeated=await f.port.continueSelected(f.ref);
  assert.equal(repeated.status,"OPERATION_IN_PROGRESS");
  assert.equal(f.receives(),0);
  assert.equal(confirmations,1);
  release();
  assert.equal((await first).status,"OWNER_READBACK_CONFIRMED");
  assert.equal(f.receives(),1);
  assert.equal((await f.port.preview(f.ref)).status,"RECOVER_ONLY");
  assert.equal((await f.port.recover(f.ref)).status,"OWNER_READBACK_CONFIRMED");
});

test("D6 two cold Host opens recover original native Result despite stale READY inspect",async()=>{
  const f=fixture();
  f.setDropAck(true);
  const first=await f.port.continueSelected(f.ref);
  assert.equal(first.status,"OUTCOME_UNKNOWN");
  assert.equal(f.receives(),1);
  const confirms=f.confirmations();
  // The original installed owner still reports READY; receipt is durable.
  const coldA=f.makePort();
  assert.equal((await coldA.preview(f.ref)).status,"RECOVER_ONLY");
  assert.equal((await coldA.continueSelected(f.ref)).status,
    "OWNER_READBACK_CONFIRMED");
  const coldB=f.makePort();
  assert.equal((await coldB.preview(f.ref)).status,"RECOVER_ONLY");
  assert.equal((await coldB.continueSelected(f.ref)).status,
    "OWNER_READBACK_CONFIRMED");
  assert.equal(f.receives(),1);
  assert.equal(f.confirmations(),confirms);
});
test("D6 incomplete native receipt stays UNKNOWN after cold restart, never redelivered",async()=>{
  const f=fixture();
  f.commits.set("op:stable:001",{state:"COMMITTED",
    operationId:"op:stable:001",recipientId:"native:atlas",
    reference:f.ref,resultRef:"atlas:work:001"});
  const old=f.commits.get("op:stable:001");
  f.commits.set("op:stable:001",{...old,state:"UNCONFIRMED"});
  const cold=f.makePort();
  assert.equal((await cold.preview(f.ref)).status,"RECOVER_ONLY");
  assert.equal((await cold.continueSelected(f.ref)).status,"OUTCOME_UNKNOWN");
  assert.equal(f.receives(),0);
  assert.equal(f.confirmations(),0);
});
