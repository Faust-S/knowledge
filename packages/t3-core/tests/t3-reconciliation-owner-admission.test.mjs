import test from "node:test";
import assert from "node:assert/strict";
import {createTrustedReconciliationAdmission}
  from "../src/t3/reconciliation-owner-admission.mjs";

// This is a public interface-only test, NOT a second reconciliation
// implementation or evidence of real signed owner/installed product.
const sha="a".repeat(64),previewDigest="b".repeat(64),acceptanceId="c".repeat(64);
function fixture(reviewOverride=null,{reverseContextOrder=false}={}){
  let human=false,revision=1,allowed=true,accepts=0,applies=0,active=true,reviews=0;
  let selectedCalls=0;
  const stored=new Map();
  const ctx=()=>{
    const value={
      kind:"PERSONAL",context_id:"personal",actor_id:"person:owner",
      principal_id:"person:owner",role_id:"role:owner",grant_id:"grant:owner",
      workspace_id:"ws:mine",resource:"ws:mine",scope_revision:revision,
    };
    selectedCalls++;
    return reverseContextOrder&&selectedCalls%2===0
      ?Object.fromEntries(Object.entries(value).reverse()):value;
  };
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
  const makePort=()=>createTrustedReconciliationAdmission({
    reconciler:source,currentContext:ctx,
    recipientForContext:()=>"recipient:owner",
    confirmHumanReview:async input=>{
      reviews++;
      return reviewOverride?reviewOverride(input):human;
    },
    isHostActive:()=>active,
  });
  const port=makePort();
  return {port,source,makePort,setHuman:v=>human=v,setAllowed:v=>allowed=v,
    changeRevision:()=>revision++,setActive:v=>active=v,
    reviews:()=>reviews,counts:()=>({accepts,applies})};
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
  const recovered=await f.port.receipt("op:one",sha);
  assert.equal(recovered.found,true);
  assert.deepEqual(recovered.receipt,accepted.receipt);
  assert.equal(recovered.kernelApplication,
    "NOT_ATTESTED_BY_RECONCILIATION_RECEIPT");
  assert.deepEqual(await f.port.receipt("op:one","f".repeat(64)),{
    found:false,receipt:null,
    kernelApplication:"NOT_ATTESTED_BY_RECONCILIATION_RECEIPT",
  });
  assert.deepEqual(await f.port.receipt("op:missing",sha),{
    found:false,receipt:null,
    kernelApplication:"NOT_ATTESTED_BY_RECONCILIATION_RECEIPT",
  });
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

test("D3 direct Host prevents another ACCEPT after original cold receipt",async()=>{
  const f=fixture();f.setHuman(true);
  const input={packageSha256:sha,previewDigest,operationId:"op:cold",
    decisionBy:"person:owner"};
  const accepted=await f.port.accept(input);
  assert.equal(accepted.acceptanceState,"ACCEPTED");
  const priorReviews=f.reviews();
  await assert.rejects(f.port.accept(input),
    {code:"T3_D3_DECISION_OUTCOME_UNKNOWN_USE_RECEIPT"});
  await assert.rejects(f.makePort().accept(input),
    {code:"T3_D3_DECISION_RECORDED_USE_RECEIPT"});
  assert.equal(f.reviews(),priorReviews);
  assert.deepEqual(f.counts(),{accepts:1,applies:0});
  assert.equal((await f.makePort().receipt("op:cold",sha)).found,true);
});

test("D3 concurrent Human ACCEPT has one review and one original write",async()=>{
  let enter,release;
  const started=new Promise(resolve=>{enter=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture(async()=>{enter();await gate;return true;});
  const input={packageSha256:sha,previewDigest,operationId:"op:race",
    decisionBy:"person:owner"};
  const first=f.port.accept(input);
  await started;
  await assert.rejects(f.port.accept(input),
    {code:"T3_D3_DECISION_IN_PROGRESS"});
  assert.equal(f.reviews(),1);
  assert.deepEqual(f.counts(),{accepts:0,applies:0});
  release();
  assert.equal((await first).acceptanceState,"ACCEPTED");
  assert.deepEqual(f.counts(),{accepts:1,applies:0});
});

test("D3 lost ACCEPT ACK recovers original receipt without another owner call",async()=>{
  const f=fixture();f.setHuman(true);
  const original=f.source.accept;
  f.source.accept=(...args)=>{
    original(...args);
    throw Object.assign(new Error("lost reply"),{code:"ACK_LOST"});
  };
  const input={packageSha256:sha,previewDigest,operationId:"op:lost",
    decisionBy:"person:owner"};
  await assert.rejects(f.port.accept(input),{code:"ACK_LOST"});
  assert.equal((await f.port.receipt("op:lost",sha)).found,true);
  const reviews=f.reviews();
  await assert.rejects(f.port.accept(input),
    {code:"T3_D3_DECISION_OUTCOME_UNKNOWN_USE_RECEIPT"});
  await assert.rejects(f.makePort().accept(input),
    {code:"T3_D3_DECISION_RECORDED_USE_RECEIPT"});
  assert.deepEqual(f.counts(),{accepts:1,applies:0});
  assert.equal(f.reviews(),reviews);
});

test("D3 original receipt refusal is not a permit for new ACCEPT",async()=>{
  const f=fixture();f.setHuman(true);
  f.source.receipt=()=>{throw Object.assign(
    new Error("owner permission"),{code:"PERMISSION_DENIED"});};
  await assert.rejects(f.port.accept({packageSha256:sha,previewDigest,
    operationId:"op:denied",decisionBy:"person:owner"}),{code:"PERMISSION_DENIED"});
  assert.equal(f.reviews(),0);
  assert.deepEqual(f.counts(),{accepts:0,applies:0});
});

test("D3 accepts original receipt and signed context after canonical JSON key reordering",async()=>{
  const f=fixture(null,{reverseContextOrder:true});
  f.setHuman(true);
  const nativeRead=f.source.receipt;
  f.source.receipt=op=>{
    const saved=nativeRead(op);
    return saved==null?saved:Object.fromEntries(
      Object.entries(saved).reverse());
  };
  const input={packageSha256:sha,previewDigest,
    operationId:"op:canonical-order",decisionBy:"person:owner"};
  const accepted=await f.port.accept(input);
  assert.equal(accepted.acceptanceState,"ACCEPTED");
  assert.equal(accepted.kernelApplication,"NOT_APPLIED");
  assert.equal(accepted.receipt.applicationState,"APPLIED");
  assert.equal((await f.makePort().receipt(input.operationId,sha)).found,true);
  assert.deepEqual(f.counts(),{accepts:1,applies:0});
  await assert.rejects(f.port.accept(input),
    {code:"T3_D3_DECISION_OUTCOME_UNKNOWN_USE_RECEIPT"});
  assert.deepEqual(f.counts(),{accepts:1,applies:0});
});

test("D3 ACCEPT preserves a complete 5000-row original receipt after JSON key reordering",async()=>{
  const f=fixture(null,{reverseContextOrder:true});
  f.setHuman(true);
  const originalAccept=f.source.accept;
  const witnesses=Array.from({length:5000},(_,index)=>({index,valid:true}));
  f.source.accept=(...args)=>{
    const received=originalAccept(...args);
    received.ownerEvidence={witnesses};
    return received;
  };
  const originalRead=f.source.receipt;
  f.source.receipt=operationId=>{
    const record=originalRead(operationId);
    return record?Object.fromEntries(Object.entries(record).reverse()):record;
  };
  const accepted=await f.port.accept({packageSha256:sha,previewDigest,
    operationId:"op:large-receipt",decisionBy:"person:owner"});
  assert.equal(accepted.acceptanceState,"ACCEPTED");
  assert.equal(accepted.kernelApplication,"NOT_APPLIED");
  assert.equal(accepted.receipt.ownerEvidence.witnesses.length,5000);
  assert.deepEqual(f.counts(),{accepts:1,applies:0});
  assert.equal((await f.makePort().receipt("op:large-receipt",sha)).found,true);
});

test("D3 detects a changed final witness after native ACCEPT without repeating it",async()=>{
  const f=fixture();
  f.setHuman(true);
  let dispatched=false;
  const witnesses=Array.from({length:5000},(_,index)=>({index,valid:true}));
  const originalAccept=f.source.accept;
  f.source.accept=(...args)=>{
    const receipt=originalAccept(...args);
    receipt.ownerEvidence={witnesses};
    dispatched=true;
    return receipt;
  };
  const originalRead=f.source.receipt;
  f.source.receipt=operationId=>{
    const saved=originalRead(operationId);
    if(!dispatched||!saved)return saved;
    const modified=[...saved.ownerEvidence.witnesses];
    modified[4999]={index:4999,valid:false};
    return {...saved,ownerEvidence:{witnesses:modified}};
  };
  const input={packageSha256:sha,previewDigest,
    operationId:"op:changed-last-witness",decisionBy:"person:owner"};
  await assert.rejects(f.port.accept(input),
    {code:"T3_D3_ORIGINAL_DECISION_READBACK_NOT_CONFIRMED"});
  assert.deepEqual(f.counts(),{accepts:1,applies:0});
  await assert.rejects(f.port.accept(input),
    {code:"T3_D3_DECISION_OUTCOME_UNKNOWN_USE_RECEIPT"});
  assert.deepEqual(f.counts(),{accepts:1,applies:0});
});

test("D3 refuses changed original receipt even when the owner reuses a mutable object",async()=>{
  const f=fixture();
  f.setHuman(true);
  const nativeRead=f.source.receipt;
  f.source.receipt=op=>{
    const saved=nativeRead(op);
    if(saved)saved.applicationState="FORGED_AFTER_DISPATCH";
    return saved;
  };
  const input={packageSha256:sha,previewDigest,
    operationId:"op:mutated-receipt",decisionBy:"person:owner"};
  await assert.rejects(f.port.accept(input),
    {code:"T3_D3_ORIGINAL_DECISION_READBACK_NOT_CONFIRMED"});
  assert.deepEqual(f.counts(),{accepts:1,applies:0},
    "a changed receipt cannot trigger another original ACCEPT or Kernel APPLY");
  await assert.rejects(f.port.accept(input),
    {code:"T3_D3_DECISION_OUTCOME_UNKNOWN_USE_RECEIPT"});
  assert.deepEqual(f.counts(),{accepts:1,applies:0});
});

test("D3 cold original ACCEPT receipt cannot claim an external Kernel APPLY",async()=>{
  const f=fixture();f.setHuman(true);
  const input={packageSha256:sha,previewDigest,
    operationId:"op:receipt-state",decisionBy:"person:owner"};
  assert.equal((await f.port.accept(input)).requiresSeparateApply,true);
  const original=f.source.receipt;
  f.source.receipt=op=>{
    const saved=original(op);
    return saved?{...saved,externalContextCoreApplied:true}:saved;
  };
  await assert.rejects(f.makePort().receipt(input.operationId,sha),
    {code:"T3_D3_ORIGINAL_RECEIPT_STATE_INVALID"});
  assert.deepEqual(f.counts(),{accepts:1,applies:0},
    "a corrupted cold readback does not authorize another ACCEPT or Apply");
});

test("D3 cold original REJECT receipt must remain not applied",async()=>{
  const f=fixture();f.setHuman(true);
  const input={packageSha256:sha,previewDigest,
    operationId:"op:rejected-state",decisionBy:"person:owner",
    reason:"Rejected by the recipient owner"};
  assert.equal((await f.port.reject(input)).acceptanceState,"REJECTED");
  const original=f.source.receipt;
  f.source.receipt=op=>{
    const saved=original(op);
    return saved?{...saved,applicationState:"APPLIED"}:saved;
  };
  await assert.rejects(f.makePort().receipt(input.operationId,sha),
    {code:"T3_D3_ORIGINAL_RECEIPT_STATE_INVALID"});
  assert.deepEqual(f.counts(),{accepts:0,applies:0});
});
