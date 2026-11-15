import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createTrustedAgeExchange} from "../src/t3/age-protected-exchange.mjs";

// Interface-only fixture. This is NOT an age cryptographic implementation
// or evidence of real issuer keys / two installed recipient products.
function fixture(maxArchiveBytes){
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
    ...(maxArchiveBytes===undefined?{}:{maxArchiveBytes}),
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

test("D7 does not advertise age capabilities when signed D1 has no original workspace read operation",async()=>{
  let decryptCalls=0,sealCalls=0;
  const kernel={hasOperation:()=>false};
  const ageOwner={
    prepareSeal:async()=>{sealCalls++;return null;},
    seal:async()=>{sealCalls++;return null;},
    open:async()=>{decryptCalls++;return null;},
  };
  const signed=createTrustedAgeExchange({
    kernel,accessForRead:async()=>({currentContext:()=>null}),
    ageOwner,confirmRecipients:async()=>true,
    isHostActive:()=>true,
  });
  assert.equal(signed.canSeal,false);
  assert.equal(signed.canOpen,false);
  await assert.rejects(
    signed.seal({workspace_id:"ws:absent",archiveBytes:Uint8Array.of(80,75,3,4,1)}),
    {code:"T3_D7_SIGNED_EXPORT_OWNER_REQUIRED"});
  const ciphertext=Uint8Array.from([
    ...new TextEncoder().encode("age-encryption.org/v1\n"),1,2,3,
  ]);
  await assert.rejects(signed.open({ciphertext}),
    {code:"T3_D7_SIGNED_OWNER_REQUIRED"});
  assert.equal(sealCalls,0);
  assert.equal(decryptCalls,0);
  // The SAME no-grant Kernel must not prevent original installed key custody
  // from opening a locally encrypted backup for separate Kernel importPreview.
  const native=createTrustedAgeExchange({
    kernel,accessForRead:async()=>null,
    ageOwner:{...ageOwner,currentRecipient:async()=>({
      recipientId:"recipient:os",bindingEpoch:"epoch:one",
    })},
    confirmRecipients:async()=>true,isHostActive:()=>true,
  });
  assert.equal(native.canSeal,false);
  assert.equal(native.canOpen,true);
});

test("D7 native age enforces true archive ceiling before crypto or consent",async()=>{
  const regular=fixture();
  assert.equal(regular.port.maxArchiveBytes,32*1024*1024);
  assert.equal(regular.port.maxCiphertextBytes,33*1024*1024);
  const restricted=fixture(8); // Synthetic original ZIP length is 9 bytes.
  assert.equal(restricted.port.maxArchiveBytes,8);
  assert.equal(restricted.port.maxCiphertextBytes,8+1024*1024);
  await assert.rejects(
    restricted.port.seal({workspace_id:"ws:one",archiveBytes:restricted.zip}),
    {code:"T3_D7_NATIVE_AGE_ARCHIVE_LIMIT_EXCEEDED"});
  assert.equal(restricted.sealCalls(),0);
  const ciphertext=Uint8Array.from([
    ...new TextEncoder().encode("age-encryption.org/v1\n"),1,2,3]);
  await assert.rejects(restricted.port.open({ciphertext}),
    {code:"T3_D7_NATIVE_AGE_ARCHIVE_LIMIT_EXCEEDED"});
  const upgraded=fixture(40*1024*1024);
  assert.equal(upgraded.port.maxArchiveBytes,40*1024*1024);
});

test("D7 installed signed isolated Kernel realm can seal for two recipients without exporting D1 Access to UI",async()=>{
  const original=Uint8Array.of(80,75,3,4,1,2,3,4,5);
  const cipher=Uint8Array.from([
    ...new TextEncoder().encode("age-encryption.org/v1\n"),1,2,3]);
  let selected="ws:one",reads=0,seals=0;
  const kernel={
    hasOperation:op=>op==="t1.getWorkspace",
    async getWorkspace(id){
      reads++;
      if(id!==selected)throw Error("ORIGINAL_SIGNED_KERNEL_DENIED");
      return {workspace_id:id,deleted_at:null};
    },
  };
  const ageOwner={
    currentRecipient:async()=>({recipientId:"recipient:installed",
      bindingEpoch:"native:one"}),
    trustedSelectedWorkspace:async()=>({
      kind:"PERSONAL",organization_id:null,
      workspace_id:selected,resource:selected,
    }),
    prepareSeal:async()=>({format:"age-encryption.org/v1",status:"READY",
      recipientIds:["recipient:installed","recipient:independent"]}),
    seal:async({archiveSha256,recipientIds})=>{
      seals++;return {format:"age-encryption.org/v1",
        archiveSha256,recipientIds,ciphertext:cipher};},
    open:async()=>null,
  };
  const port=createTrustedAgeExchange({kernel,ageOwner,
    confirmRecipients:async()=>true,isHostActive:()=>true});
  assert.equal(port.canSeal,true);
  assert.equal(port.canOpen,true);
  const sealed=await port.seal({workspace_id:"ws:one",archiveBytes:original});
  assert.equal(sealed.status,"AGE_PROTECTED_DOWNLOAD_READY");
  assert.equal(seals,1);
  assert.ok(reads>=3,"every original signed Kernel read must be checked");
  selected="ws:other";
  await assert.rejects(port.seal({workspace_id:"ws:one",archiveBytes:original}),
    {code:"T3_D7_SELECTED_WORKSPACE_MISMATCH"});
  assert.equal(seals,1);
  const noSignedData=createTrustedAgeExchange({
    kernel:{...kernel,hasOperation:()=>false},
    ageOwner,confirmRecipients:async()=>true,isHostActive:()=>true,
  });
  assert.equal(noSignedData.canSeal,false);
  await assert.rejects(noSignedData.seal({
    workspace_id:"ws:other",archiveBytes:original,
  }),{code:"T3_D7_SIGNED_EXPORT_OWNER_REQUIRED"});
});

test("D7 direct installed Host binds native preview tokens and blocks duplicate Kernel writes",{
  timeout:8000,
},async()=>{
  const ciphertext=Uint8Array.from([
    ...new TextEncoder().encode("age-encryption.org/v1\n"),1,2,3,
  ]);
  let previews=0,commits=0,cancels=0,releaseCommit,signalStarted;
  const started=new Promise(resolve=>{signalStarted=resolve;});
  const finish=new Promise(resolve=>{releaseCommit=resolve;});
  const recipient={recipientId:"recipient:original",bindingEpoch:"epoch:one"};
  const ageOwner={
    currentRecipient:async()=>({...recipient}),
    previewInOriginalKernel:async()=>({
      status:"KERNEL_PREVIEW_READY",recipientId:recipient.recipientId,
      archiveSha256:"a".repeat(64),
      handle:{preview_token:"tok:direct:"+(++previews),
        package_digest:"digest:direct",semantic_digest:"semantic:direct",
        expires_at:"2099-01-01T00:00:00Z",
        allowed_modes:["new-workspace"],preview:{workspaces:[],objects:[]}},
    }),
    commitInOriginalKernel:async input=>{
      commits++;
      signalStarted();
      await finish;
      return {format:"iwxa.import.receipt",import_id:"import:direct:one",
        package_digest:input.package_digest,
        semantic_digest:"semantic:direct",mode:input.plan.mode};
    },
    cancelInOriginalKernel:async()=>{cancels++;return true;},
  };
  const create=()=>createTrustedAgeExchange({
    ageOwner,isHostActive:()=>true,
  });
  const host=create();
  const plan={mode:"new-workspace",include_workspaces:[]};
  const input={preview_token:"tok:direct:1",
    package_digest:"digest:direct",plan};
  assert.equal(host.canNativeKernelPreview,true);
  await assert.rejects(host.commitInOriginalKernel(input),
    {code:"T3_D7_NATIVE_PREVIEW_BINDING_INVALID"});
  await assert.rejects(host.cancelInOriginalKernel({
    preview_token:input.preview_token,
  }),{code:"T3_D7_NATIVE_PREVIEW_BINDING_INVALID"});
  const firstPreview=await host.previewInOriginalKernel({ciphertext});
  assert.equal(firstPreview.handle.preview_token,input.preview_token);
  await assert.rejects(host.commitInOriginalKernel({
    ...input,package_digest:"digest:tampered",
  }),{code:"T3_D7_NATIVE_PREVIEW_BINDING_INVALID"});
  await assert.rejects(host.commitInOriginalKernel({
    ...input,plan:{mode:"merge"},
  }),{code:"T3_D7_NATIVE_PREVIEW_BINDING_INVALID"});
  const pending=host.commitInOriginalKernel(input);
  await started;
  await assert.rejects(host.cancelInOriginalKernel({
    preview_token:input.preview_token,
  }),{code:"T3_D7_NATIVE_PREVIEW_BINDING_INVALID"});
  releaseCommit();
  assert.equal((await pending).import_id,"import:direct:one");
  await assert.rejects(host.commitInOriginalKernel(input),
    {code:"T3_D7_NATIVE_PREVIEW_BINDING_INVALID"});
  assert.equal(commits,1);
  const cancelPreview=await host.previewInOriginalKernel({ciphertext});
  assert.equal(await host.cancelInOriginalKernel({
    preview_token:cancelPreview.handle.preview_token,
  }),true);
  await assert.rejects(host.commitInOriginalKernel({
    ...input,preview_token:cancelPreview.handle.preview_token,
  }),{code:"T3_D7_NATIVE_PREVIEW_BINDING_INVALID"});
  assert.equal(cancels,1);
  // Reconstructed Host after a cold open cannot replay a pre-restart token.
  const cold=create();
  await assert.rejects(cold.commitInOriginalKernel(input),
    {code:"T3_D7_NATIVE_PREVIEW_BINDING_INVALID"});
  assert.equal(commits,1);
});

test("D7 direct installed recipient can read original Kernel after cold restart without retrying commit",async()=>{
  let readbacks=0,commits=0;
  const original={status:"OWNER_READBACK_CONFIRMED",readbackVerified:true,
    preview_token:"tok:direct",recipientId:"recipient:direct",
    receipt:{format:"iwxa.import.receipt",import_id:"import:readback",
      package_digest:"digest:direct",semantic_digest:"semantic:direct",
      mode:"new-workspace",applied:{workspaces:1}},
  };
  const native={
    currentRecipient:async()=>({recipientId:"recipient:direct",bindingEpoch:"epoch:one"}),
    previewInOriginalKernel:async()=>{throw Error("NO_ZIP");},
    commitInOriginalKernel:async()=>{commits++;throw Error("NO_REPLAY");},
    cancelInOriginalKernel:async()=>true,
    readbackInOriginalKernel:async()=>{readbacks++;return original;},
  };
  const create=()=>createTrustedAgeExchange({ageOwner:native,isHostActive:()=>true});
  const query={preview_token:"tok:direct",package_digest:"digest:direct",
    semantic_digest:"semantic:direct",mode:"new-workspace"};
  const cold=create();
  assert.equal(cold.canNativeKernelReadback,true);
  const read=await cold.readbackInOriginalKernel(query);
  assert.equal(read.status,"OWNER_READBACK_CONFIRMED");
  assert.equal(read.receipt.import_id,"import:readback");
  assert.equal(readbacks,1);
  assert.equal(commits,0);
  native.readbackInOriginalKernel=async()=>({status:"OUTCOME_UNKNOWN"});
  assert.equal((await create().readbackInOriginalKernel(query)).status,"OUTCOME_UNKNOWN");
  native.readbackInOriginalKernel=async()=>({...original,
    preview_token:"tok:other"});
  await assert.rejects(create().readbackInOriginalKernel(query),
    {code:"T3_D7_NATIVE_KERNEL_READBACK_INVALID"});
  native.readbackInOriginalKernel=async()=>({...original,
    receipt:{...original.receipt,semantic_digest:"semantic:unrelated"}});
  await assert.rejects(create().readbackInOriginalKernel(query),
    {code:"T3_D7_NATIVE_KERNEL_READBACK_INVALID"});
  assert.equal(commits,0);
});
