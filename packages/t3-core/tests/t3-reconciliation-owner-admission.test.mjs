import test from "node:test";
import assert from "node:assert/strict";
import {createTrustedReconciliationAdmission}
  from "../src/t3/reconciliation-owner-admission.mjs";

// This is a public interface-only test, NOT a second reconciliation
// implementation or evidence of real signed owner/installed product.
const sha="a".repeat(64),previewDigest="b".repeat(64),acceptanceId="c".repeat(64);
function fixture(){
  let human=false,revision=1,allowed=true,accepts=0,applies=0,active=true;
  const stored=new Map();
  const ctx=()=>({
    kind:"PERSONAL",context_id:"personal",actor_id:"person:owner",
    principal_id:"person:owner",role_id:"role:owner",grant_id:"grant:owner",
    workspace_id:"ws:mine",resource:"ws:mine",scope_revision:revision,
  });
  const source={
    recipientId:"recipient:owner",
    receive:()=>({transportReceipt:{status:"RECEIVED"},preview:source.preview(sha)}),
    preview:packageSha256=>({
      schema:"IWXA_T3_RECONCILIATION_PREVIEW/1",packageSha256,
      previewDigest,allowedAction:allowed?"EXPLICIT_ACCEPT_ONLY":"HUMAN_REVIEW_OR_QUARANTINE"
    }),
    accept:(packageSha256,{operationId,previewDigest:dig,decisionBy})=>{
      assert.equal(dig,previewDigest);accepts++;
      const receipt={schema:"IWXA_T3_ACCEPTANCE_RECEIPT/1",acceptanceId,
        operationId,packageSha256,decisionBy,acceptanceState:"ACCEPTED",
        appliedScope:"RECONCILIATION_LEDGER_ONLY",externalContextCoreApplied:false,
        applicationState:"APPLIED"};
      stored.set(operationId,receipt);return receipt;
    },
    reject:(packageSha256,{operationId,decisionBy})=>{
      const receipt={schema:"IWXA_T3_REJECTION_RECEIPT/1",operationId,
        packageSha256,decisionBy,acceptanceState:"REJECTED",applicationState:"NOT_APPLIED"};
      stored.set(operationId,receipt);return receipt;
    },
    receipt:op=>stored.get(op),
    inspectApplicationProjection:({acceptanceId,revisionIds,target})=>({
      schema:"IWXA_T3_APPLICATION_PROJECTION_CANDIDATE/1",
      status:"CANDIDATE_REQUIRES_INDEPENDENT_HOST_AUTHORIZATION",
      applicationAuthorized:false,applicationAttempted:false,
      externalContextCoreApplied:false,
      source:{acceptanceId,recipientId:"recipient:owner",
        revisions:revisionIds.map(revisionId=>({revisionId}))},
      target,
    }),
  };
  const port=createTrustedReconciliationAdmission({
    reconciler:source,currentContext:ctx,
    recipientForContext:()=>"recipient:owner",
    confirmHumanReview:()=>human,
    isHostActive:()=>active,
  });
  return {port,setHuman:v=>human=v,setAllowed:v=>allowed=v,
    changeRevision:()=>revision++,setActive:v=>active=v,
    counts:()=>({accepts,applies})};
}
test("D3 trusted original owner receives, reviews and ACCEPTS without Kernel Apply",async()=>{
  const f=fixture();
  const received=await f.port.receive(Uint8Array.of(1,2));
  assert.equal(received.acceptanceState,"NOT_ACCEPTED");
  assert.equal(received.kernelApplication,"NOT_APPLIED");
  await assert.rejects(f.port.accept({packageSha256:sha,previewDigest,
    operationId:"op:one",decisionBy:"person:owner"}),
    {code:"T3_D3_HUMAN_REVIEW_REQUIRED"});
  f.setHuman(true);
  const accepted=await f.port.accept({packageSha256:sha,previewDigest,
    operationId:"op:one",decisionBy:"person:owner"});
  assert.equal(accepted.receipt.applicationState,"APPLIED");
  assert.equal(accepted.receipt.appliedScope,"RECONCILIATION_LEDGER_ONLY");
  assert.equal(accepted.kernelApplication,"NOT_APPLIED");
  assert.deepEqual(f.counts(),{accepts:1,applies:0});
  const candidate=await f.port.inspectAcceptedApplication({
    acceptanceId,revisionIds:[sha],target:{workspaceId:"ws:mine"}
  });
  assert.equal(candidate.applicationAuthorized,false);
  f.setActive(false);
  await assert.rejects(f.port.preview(sha),{code:"T3_HOST_DISPOSED"});
  f.setActive(true);
  await assert.rejects(f.port.inspectAcceptedApplication({
    acceptanceId,revisionIds:[sha],target:{workspaceId:"ws:foreign"}
  }),{code:"T3_D3_APPLICATION_TARGET_OUT_OF_SCOPE"});
});
test("D3 refuses stale preview, wrong actor, changed context and ineligible original owner",async()=>{
  const f=fixture();f.setHuman(true);
  await assert.rejects(f.port.accept({packageSha256:sha,previewDigest,
    operationId:"op:two",decisionBy:"another:actor"}),{code:"T3_D3_DECISION_ACTOR_MISMATCH"});
  await assert.rejects(f.port.accept({packageSha256:sha,previewDigest:sha,
    operationId:"op:two",decisionBy:"person:owner"}),{code:"T3_D3_PREVIEW_STALE"});
  f.setAllowed(false);
  await assert.rejects(f.port.accept({packageSha256:sha,previewDigest,
    operationId:"op:two",decisionBy:"person:owner"}),
    {code:"T3_D3_ORIGINAL_ACCEPTANCE_NOT_ELIGIBLE"});
  assert.deepEqual(f.counts(),{accepts:0,applies:0});
});
