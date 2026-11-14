import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createTrustedReconciliationKernelApply}
  from "../src/t3/reconciliation-kernel-apply.mjs";

// Contract-only owner. This is NOT a private original Reconciler, signed JIT,
// installed native owner, or a replacement for the G4 product qualification.
const accepted="a".repeat(64),rev="b".repeat(64),effect="c".repeat(64);
test("separate original-owner Apply uses the inherited Kernel graph and readback once",async()=>{
  let approves=false,active=true,commits=0;
  let sourceCurrent=true,revokeDuringJit=false,stopHostDuringJit=false;
  let changePurposeDuringHumanApply=false;
  let signedJitCount=0,preconditionCount=0;
  const context={kind:"CORP",context_id:"ctx:a",actor_id:"person:a",
    principal_id:"org:a",organization_id:"org:a",role_id:"role:admin",
    grant_id:"grant:a",realm_id:"realm:a",audience:"host:t3",
    purpose:"result.apply",resource:"ws:a",workspace_id:"ws:a",scope_revision:1};
  const command={workspace_id:"ws:a",idempotency_key:effect,
    object:{object_id:"result:one",schema_id:"iwxa.result.native",
      schema_version:"1.0.0",base_revision:0,data:{text:"reviewed"}},
    event:{event_type:"native.result.applied",payload:{
      reconciliation_acceptance_id:accepted,
      reconciliation_revision_ids:[rev]}}};
  const binding={
    schema:"IWXA_T3_APPLICATION_HOST_BINDING/1",effectKey:effect,
    operation:{operationId:"effect:"+effect,payloadDigest:"d".repeat(64),
      resource:"ws:a",productId:"IWXA_ADMIN_CENTER",audience:"host:t3",
      purpose:"result.apply",action:"object.write"},expectedRevision:0,
    applicationAuthorized:false,writeAllowed:false,
    hostJitRequired:true,explicitHumanDecisionRequired:true,
    decisionCheckAtCommit:true,externalContextCoreApplied:false,
    commitPrecondition:()=>{preconditionCount++;return sourceCurrent&&signedJitCount>0;},
  };
  let written=null;
  const hash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const access={
    currentContext:()=>context,
    actionFor:operation=>operation==="t1.commitObjectGraph"?"object.write":"object.read",
    operationDigest:hash,
    authorize:request=>{
      signedJitCount++;
      if(revokeDuringJit&&request.action==="object.write")sourceCurrent=false;
      if(stopHostDuringJit&&request.action==="object.write")active=false;
      return ({
      schema:"IWXA_T3_ORGANIZATION_OPERATION_DECISION/1",
      allowed:true,outcome:"PERMITTED",evidenceOnly:true,
      requestDigest:hash(request),policyDigest:hash("policy"),
      operationDigest:hash("operation"),evidenceDigest:hash("evidence"),
      productionActivation:false,doesNotTransferData:true,
      doesNotAcceptCorporateCopy:true,organizationId:context.organization_id,
      workspaceId:context.workspace_id,grantId:request.grantId,
      statusSequence:1,validUntil:new Date(Date.now()+60000).toISOString(),
      });
    },
    verifyDecisionBinding:(request,decision)=>decision.requestDigest===hash(request),
  };
  const port=createTrustedReconciliationKernelApply({
    admission:{inspectAcceptedApplication:async()=>({
      schema:"IWXA_T3_APPLICATION_PROJECTION_CANDIDATE/1",
      status:"CANDIDATE_REQUIRES_INDEPENDENT_HOST_AUTHORIZATION",
      applicationAuthorized:false,
    })},
    kernel:{
      sessionInfo:{contract_version:"1.3.0"},
      hasOperation:()=>true,
      commitObjectGraph:async input=>{commits++;written=input;return {
        workspace_id:"ws:a",object:{workspace_id:"ws:a",object_id:"result:one",
          revision:1,schema_id:"iwxa.result.native"},relations_put:[],event:{
          event_id:"evt:a",workspace_id:"ws:a"}};},
      getObject:async()=>({object:{workspace_id:"ws:a",object_id:"result:one",
        revision:1,schema_id:"iwxa.result.native",data:{text:"reviewed"}},
        relations:{incoming:[],outgoing:[]}}),
    },
    access,
    stageFromOriginalOwner:()=>({binding,command,authorizationContext:{
      operationId:"effect:"+effect,payloadDigest:"d".repeat(64),
      organizationId:"org:a",workspaceId:"ws:a",dataRootId:"root:a",
      storageScopeDigest:"f".repeat(64),expectedRevision:0,
      actorId:"person:a",principalId:"org:a",roleId:"role:admin",
      grantId:"grant:a",operationDigest:"e".repeat(64)}}),
    confirmSeparateApply:()=>{
      if(changePurposeDuringHumanApply)context.purpose="changed-purpose";
      return approves;
    },isHostActive:()=>active,
  });
  const selection={acceptanceId:accepted,revisionIds:[rev],
    target:{workspaceId:"ws:a",subjectId:"org:a",dataRootId:"root:a",
      consumerId:"consumer:a",processId:"process:a",
      processVersion:"1.0.0",purpose:"result.apply"}};
  await assert.rejects(port.applyAccepted({...selection,target:{
    ...selection.target,dataRootId:null}}),
    {code:"T3_D3_ORIGINAL_APPLICATION_TARGET_INCOMPLETE"});
  await assert.rejects(port.applyAccepted(selection),
    {code:"T3_D3_SEPARATE_HUMAN_APPLY_REQUIRED"});
  assert.equal(commits,0);
  approves=true;
  const result=await port.applyAccepted(selection);
  assert.equal(result.kernelWriteReadback,"CONFIRMED");
  assert.equal(result.externalProductAcceptance,"NOT_ACCEPTED");
  assert.equal(written.idempotency_key,effect);
  assert.equal(commits,1);
  // A human approval is bound to the exact signed purpose/audience/realm,
  // even if the selected organization, actor and Workspace do not change.
  changePurposeDuringHumanApply=true;
  await assert.rejects(port.applyAccepted(selection),
    {code:"T3_D3_APPLY_CONTEXT_CHANGED"});
  assert.equal(commits,1);
  context.purpose="result.apply";
  changePurposeDuringHumanApply=false;
  // Revoke the accepted source DURING the signed authorization callback.
  // The last original Reconciliation check must reject before Kernel writes.
  sourceCurrent=true;
  revokeDuringJit=true;
  await assert.rejects(port.applyAccepted(selection),
    {code:"T3_D3_ORIGINAL_APPLICATION_PRECONDITION_DENIED"});
  assert.equal(commits,1);
  assert.ok(preconditionCount>=2);
  // A signed owner may revoke the Host while authorize() is pending.
  // This denial occurs BEFORE the original Kernel dispatch, so must not
  // be mislabeled as a lost post-write acknowledgement.
  revokeDuringJit=false;
  sourceCurrent=true;
  stopHostDuringJit=true;
  await assert.rejects(port.applyAccepted(selection),{code:"T3_HOST_DISPOSED"});
  assert.equal(commits,1);
  active=false;
  await assert.rejects(port.applyAccepted(selection),{code:"T3_HOST_DISPOSED"});
  assert.equal(commits,1);
});
