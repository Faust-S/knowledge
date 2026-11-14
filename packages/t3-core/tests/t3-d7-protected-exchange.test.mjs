import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createTrustedAgeExchange} from "../src/t3/age-protected-exchange.mjs";

// Interface-only fixture. This is NOT an age cryptographic implementation
// or evidence of real issuer keys / two installed recipient products.
function fixture(){
  let active=true,permitted=true,consent=true,revision=1,sealCalls=0;
  const zip=Uint8Array.of(0x50,0x4b,3,4,1,2,3,4,5);
  const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
  const header=new TextEncoder().encode("age-encryption.org/v1\n");
  const context={kind:"PERSONAL",context_id:"ctx:person",
    actor_id:"person:owner",principal_id:"person:owner",
    role_id:"role:owner",grant_id:"grant:owner",realm_id:"realm:local",
    audience:"service:example",resource:"ws:one",purpose:"read",
    workspace_id:"ws:one",organization_id:null,scope_revision:revision};
  const now=()=>new Date().toISOString();
  const access={
    currentContext:()=>({...context,scope_revision:revision}),
    actionFor:()=> "workspace.read",operationDigest:()=> "a".repeat(64),
    authorize:()=>({schema:"IWXA_T3_AUTHORIZATION_DECISION/1",
      allowed:permitted,outcome:permitted?"PERMITTED":"DENIED",
      evidenceOnly:true,requestDigest:"b".repeat(64),policyDigest:"c".repeat(64),
      statusSequence:1,validUntil:new Date(Date.now()+60_000).toISOString(),
      evaluatedAt:now(),statusObservedAt:now(),
      authorityPath:[{grantId:"grant:owner"}]}),
    verifyDecisionBinding:()=>true,
  };
  const kernel={
    sessionInfo:{contract_version:"1.3.0"},
    hasOperation:op=>op==="t1.getWorkspace",
    getWorkspace:async workspace_id=>({workspace_id,deleted_at:null}),
  };
  const ageOwner={
    prepareSeal:()=>({status:"READY",format:"age-encryption.org/v1",
      recipientIds:["native:recipient:A","native:recipient:B"]}),
    seal:({archiveBytes,archiveSha256,recipientIds})=>{
      sealCalls++;
      return {format:"age-encryption.org/v1",archiveSha256,recipientIds,
        ciphertext:Uint8Array.from([...header,...archiveBytes])};
    },
    open:()=>({format:"age-encryption.org/v1",status:"OPENED_VERIFIED",
      verified:true,recipientId:"native:recipient:A",
      archiveSha256:sha(zip),archiveBytes:zip}),
  };
  const port=createTrustedAgeExchange({kernel,
    accessForRead:async()=>access,ageOwner,
    confirmRecipients:async()=>consent,isHostActive:()=>active});
  return {port,zip,ageOwner,sealCalls:()=>sealCalls,
    revoke:()=>{permitted=false;},
    denyConsent:()=>{consent=false;},
    changeContext:()=>{revision++;},
    dispose:()=>{active=false;}};
}
test("D7 preserves selected original .iwxa bytes for two native recipients",async()=>{
  const f=fixture();
  const protectedResult=await f.port.seal({
    workspace_id:"ws:one",archiveBytes:f.zip});
  assert.equal(protectedResult.status,"AGE_PROTECTED_DOWNLOAD_READY");
  assert.deepEqual(protectedResult.recipientIds,[
    "native:recipient:A","native:recipient:B"]);
  assert.equal(protectedResult.savedToDevice,false);
  assert.equal(protectedResult.recipientImported,false);
  const opened=await f.port.open({ciphertext:protectedResult.ciphertext});
  assert.equal(opened.status,"AGE_OPENED_NOT_IMPORTED");
  assert.equal(opened.kernelPreviewed,false);
  assert.equal(opened.accepted,false);
  assert.deepEqual(opened.archiveBytes,f.zip);
  assert.equal(f.sealCalls(),1);
});
test("D7 denies revoked rights, changed context, missing consent and unverified age",async()=>{
  const f=fixture();
  f.denyConsent();
  await assert.rejects(f.port.seal({workspace_id:"ws:one",archiveBytes:f.zip}),
    {code:"T3_D7_HUMAN_RECIPIENT_CONFIRMATION_REQUIRED"});
  assert.equal(f.sealCalls(),0);
  f.ageOwner.prepareSeal=()=>{
    f.changeContext();
    return {status:"READY",format:"age-encryption.org/v1",
      recipientIds:["native:recipient:A","native:recipient:B"]};
  };
  await assert.rejects(f.port.seal({workspace_id:"ws:one",archiveBytes:f.zip}),
    {code:"T3_D7_SIGNED_CONTEXT_CHANGED"});
  f.revoke();
  const encrypted=Uint8Array.from([
    ...new TextEncoder().encode("age-encryption.org/v1\n"),1,2,3]);
  await assert.rejects(f.port.open({ciphertext:encrypted}),
    {code:"T3_ACCESS_NOT_PERMITTED"});
  f.dispose();
  await assert.rejects(f.port.seal({workspace_id:"ws:one",archiveBytes:f.zip}),
    {code:"T3_HOST_DISPOSED"});
});

test("D7 installed recipient restores .iwxa.age BEFORE a Workspace and signed D1 access",async()=>{
  const zip=Uint8Array.of(80,75,3,4,1,2,3,4,5);
  const sha=createHash("sha256").update(zip).digest("hex");
  const ciphertext=Uint8Array.from([
    ...new TextEncoder().encode("age-encryption.org/v1\n"),1,2,3]);
  let opens=0;
  const ageOwner={
    currentRecipient:async()=>({
      recipientId:"recipient:installed:A",bindingEpoch:"os-login:1",
    }),
    open:async input=>{
      opens++;
      assert.equal(input.recipientId,"recipient:installed:A");
      assert.equal(input.selectedWorkspaceId,undefined);
      return {format:"age-encryption.org/v1",status:"OPENED_VERIFIED",
        verified:true,recipientId:"recipient:installed:A",
        archiveSha256:sha,archiveBytes:zip};
    },
  };
  const create=()=>createTrustedAgeExchange({
    ageOwner,isHostActive:()=>true,
    // No original Kernel, selected Workspace, signed access or encryption owner.
  });
  const port=create();
  assert.equal(port.canSeal,false);
  assert.equal(port.canOpen,true);
  const opened=await port.open({ciphertext});
  assert.equal(opened.status,"AGE_OPENED_NOT_IMPORTED");
  assert.equal(opened.kernelPreviewed,false);
  assert.equal(opened.accepted,false);
  assert.deepEqual(opened.archiveBytes,zip);
  assert.equal(opens,1);
  await assert.rejects(port.seal({workspace_id:"ws:none",archiveBytes:zip}),
    {code:"T3_D7_SIGNED_EXPORT_OWNER_REQUIRED"});
  const cold=create();
  const recovered=await cold.open({ciphertext});
  assert.deepEqual(recovered.archiveBytes,zip);
  assert.equal(opens,2);
});
test("D7 native age blocks switched/incorrect recipient before returning plaintext",async()=>{
  const zip=Uint8Array.of(80,75,3,4,1,2,3,4,5);
  const sha=createHash("sha256").update(zip).digest("hex");
  const ciphertext=Uint8Array.from([
    ...new TextEncoder().encode("age-encryption.org/v1\n"),1,2,3]);
  let epoch="os-login:1",recipientId="recipient:installed:A";
  const ageOwner={
    currentRecipient:async()=>({recipientId,bindingEpoch:epoch}),
    open:async()=>({
      format:"age-encryption.org/v1",status:"OPENED_VERIFIED",
      verified:true,recipientId:"recipient:installed:A",
      archiveSha256:sha,archiveBytes:zip,
    }),
  };
  const port=createTrustedAgeExchange({ageOwner,isHostActive:()=>true});
  epoch="os-login:2";
  // A new call pins the new epoch. Change it WHILE the owner unlocks.
  ageOwner.open=async()=>{
    epoch="os-login:3";
    return {format:"age-encryption.org/v1",status:"OPENED_VERIFIED",
      verified:true,recipientId:"recipient:installed:A",
      archiveSha256:sha,archiveBytes:zip};
  };
  await assert.rejects(port.open({ciphertext}),
    {code:"T3_D7_ORIGINAL_NATIVE_RECIPIENT_CHANGED"});
  ageOwner.open=async()=>({
    format:"age-encryption.org/v1",status:"OPENED_VERIFIED",
    verified:true,recipientId:"recipient:installed:B",
    archiveSha256:sha,archiveBytes:zip,
  });
  await assert.rejects(port.open({ciphertext}),
    {code:"T3_D7_AGE_RECIPIENT_VERIFICATION_REQUIRED"});
  recipientId=""; 
  await assert.rejects(port.open({ciphertext}),
    {code:"T3_D7_ORIGINAL_NATIVE_RECIPIENT_REQUIRED"});
});
