import test from "node:test";
import assert from "node:assert/strict";
import {createTrustedReconciliationKernelApply}
  from "../src/t3/reconciliation-kernel-apply.mjs";

// Contract-only owner. This is NOT a private original Reconciler, signed JIT,
// installed native owner, or a replacement for the G4 product qualification.
const accepted="a".repeat(64),rev="b".repeat(64),effect="c".repeat(64);
test("separate original-owner Apply uses the inherited Kernel graph and readback once",async()=>{
  let approves=false,active=true,commits=0;
  const context={kind:"CORP",context_id:"ctx:a",actor_id:"person:a",
    principal_id:"org:a",organization_id:"org:a",role_id:"role:admin",
    grant_id:"grant:a",resource:"ws:a",workspace_id:"ws:a",scope_revision:1};
  const command={workspace_id:"ws:a",idempotency_key:effect,
    object:{object_id:"result:one",schema_id:"iwxa.result.native",
      schema_version:"1.0.0",base_revision:0,data:{text:"reviewed"}},
    event:{event_type:"native.result.applied",payload:{
      reconciliation_acceptance_id:accepted,
      reconciliation_revision_ids:[rev]}}};
  const binding={
    schema:"IWXA_T3_APPLICATION_HOST_BINDING/1",effectKey:effect,
    operation:{operationId:"effect:"+effect,payloadDigest:"d".repeat(64),
      resource:"ws:a"},applicationAuthorized:false,writeAllowed:false,
    hostJitRequired:true,explicitHumanDecisionRequired:true,
    decisionCheckAtCommit:true,externalContextCoreApplied:false,
    commitPrecondition:()=>true,
  };
  let written=null;
  const port=createTrustedReconciliationKernelApply({
    admission:{inspectAcceptedApplication:async()=>({
      schema:"IWXA_T3_APPLICATION_PROJECTION_CANDIDATE/1",
      status:"CANDIDATE_REQUIRES_INDEPENDENT_HOST_AUTHORIZATION",
      applicationAuthorized:false,
    })},
    signedKernel:{hasOperation:()=>true,
      commitObjectGraph:async input=>{commits++;written=input;return {
        workspace_id:"ws:a",object:{workspace_id:"ws:a",object_id:"result:one",
          revision:1,schema_id:"iwxa.result.native"},event:{
          event_id:"evt:a",workspace_id:"ws:a"}};},
      getObject:async()=>({object:{workspace_id:"ws:a",object_id:"result:one",
        revision:1,schema_id:"iwxa.result.native",data:{text:"reviewed"}}})},
    currentContext:()=>context,
    stageFromOriginalOwner:()=>({binding,command,authorizationContext:{
      operationId:"effect:"+effect,payloadDigest:"d".repeat(64),
      organizationId:"org:a",workspaceId:"ws:a",actorId:"person:a",
      principalId:"org:a",roleId:"role:admin",grantId:"grant:a",
      operationDigest:"e".repeat(64)}}),
    confirmSeparateApply:()=>approves,isHostActive:()=>active,
  });
  const selection={acceptanceId:accepted,revisionIds:[rev],
    target:{workspaceId:"ws:a",subjectId:"org:a"}};
  await assert.rejects(port.applyAccepted(selection),
    {code:"T3_D3_SEPARATE_HUMAN_APPLY_REQUIRED"});
  assert.equal(commits,0);
  approves=true;
  const result=await port.applyAccepted(selection);
  assert.equal(result.kernelWriteReadback,"CONFIRMED");
  assert.equal(result.externalProductAcceptance,"NOT_ACCEPTED");
  assert.equal(written.idempotency_key,effect);
  assert.equal(commits,1);
  active=false;
  await assert.rejects(port.applyAccepted(selection),{code:"T3_HOST_DISPOSED"});
  assert.equal(commits,1);
});
