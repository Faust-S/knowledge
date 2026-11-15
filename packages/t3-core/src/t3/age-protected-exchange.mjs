// D7: only an installed, trusted age owner protects the original .iwxa bytes.
// Never create a second Exchange, cryptography, key custody, signer, or IAM.
// A Publisher product licence does NOT authorize access to workspace data.
import {createSubjectKernelBinding} from "./subject-access-binding.mjs";
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const HEX=/^[a-f0-9]{64}$/;
const TAG=new TextEncoder().encode("age-encryption.org/v1\n");
const MAX=200*1024*1024; // Original T2 Exchange remains unchanged.
const DEFAULT_NATIVE_AGE_MAX=32*1024*1024; // Existing original age CLI.
const AGE_ENVELOPE_ALLOWANCE=1024*1024;
const id=x=>typeof x==="string"&&ID.test(x);
function deny(code){throw Object.assign(new Error(code),{code,outcome:"DENIED"});}
function ensure(v,code){if(!v)deny(code);}
function take(value,limit,code){
  ensure(value instanceof Uint8Array&&value.byteLength>0&&value.byteLength<=limit,code);
  return Uint8Array.from(value);
}
function ageHeader(raw){return raw.length>TAG.length&&TAG.every((b,i)=>raw[i]===b);}
function zipHeader(raw){
  return raw.length>3&&raw[0]===0x50&&raw[1]===0x4b&&
    ((raw[2]===3&&raw[3]===4)||(raw[2]===5&&raw[3]===6)||
      (raw[2]===7&&raw[3]===8));
}
async function sha256(raw){
  ensure(typeof globalThis.crypto?.subtle?.digest==="function","T3_D7_SHA256_UNAVAILABLE");
  const digest=new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256",raw));
  return Array.from(digest,b=>b.toString(16).padStart(2,"0")).join("");
}
function recipientList(value){
  ensure(Array.isArray(value)&&value.length>=2&&value.length<=16&&
    value.every(id)&&new Set(value).size===value.length,
    "T3_D7_TWO_TRUSTED_RECIPIENTS_REQUIRED");
  return Object.freeze([...value]);
}
function sameList(a,b){return Array.isArray(b)&&b.length===a.length&&
  a.every((id,i)=>b[i]===id);}
/** Only a trusted installed Host may supply native age functions, original
 * key custody, and its OS-bound recipient identity. Never obtain a recipient
 * from the downloaded .iwxa.age or UI. Encryption always requires original
 * signed D1 Workspace read; opening for a FIRST install may use the verified
 * native currentRecipient() without any existing Workspace or D1 data grant.
 * The plaintext still goes through original Kernel importPreview/Commit in
 * Exchange with separate human action. These adapter tests do not qualify
 * a real native age implementation. */
export function createTrustedAgeExchange({kernel,accessForRead,ageOwner,
  confirmRecipients,isHostActive}={}){
  // Historical native age accepts 32 MiB, while original plaintext T2
  // Exchange continues to accept 200 MiB. A newer trusted installed owner
  // may explicitly advertise its independently qualified actual capacity.
  const maxArchiveBytes=ageOwner?.maxArchiveBytes??DEFAULT_NATIVE_AGE_MAX;
  ensure(Number.isSafeInteger(maxArchiveBytes)&&maxArchiveBytes>=4&&
    maxArchiveBytes<=MAX,"T3_D7_NATIVE_AGE_LIMIT_INVALID");
  const maxCiphertextBytes=maxArchiveBytes+AGE_ENVELOPE_ALLOWANCE;
  const signedReader=kernel&&typeof kernel.hasOperation==="function"&&
    typeof accessForRead==="function";
  // The installed split-origin AppShell already owns a SIGNED original
  // KernelFacade in its separate trusted realm. It cannot and must not
  // expose the native D1 Access proof to the UI. Instead, the same pinned
  // realm supplies its already-existing selectedWorkspaceContext and JIT
  // Kernel.getWorkspace. This does not authorize unsigned T2 reads.
  const isolatedReader=kernel&&typeof kernel.hasOperation==="function"&&
    typeof kernel.getWorkspace==="function"&&
    typeof ageOwner?.trustedSelectedWorkspace==="function";
  // A signed port does not itself grant t1.getWorkspace. On fresh native
  // installs or revoked/scoped sessions there may be no original T2 read
  // capability: do not advertise Export/age seal until it truly exists.
  // A native recipient may still OPEN and return bytes to an independently
  // authorized original Kernel importPreview.
  const signedWorkspaceRead=Boolean((signedReader||isolatedReader)&&
    kernel.hasOperation("t1.getWorkspace"));
  const nativeRecipient=typeof ageOwner?.currentRecipient==="function";
  const nativeKernelPreview=nativeRecipient&&
    typeof ageOwner?.previewInOriginalKernel==="function"&&
    typeof ageOwner?.commitInOriginalKernel==="function"&&
    typeof ageOwner?.cancelInOriginalKernel==="function";
  const nativeKernelReadback=Boolean(nativeKernelPreview&&
    typeof ageOwner?.readbackInOriginalKernel==="function");
  const rawOpen=typeof ageOwner?.open==="function";
  const canSeal=Boolean(signedWorkspaceRead&&
    typeof ageOwner?.prepareSeal==="function"&&
    typeof ageOwner?.seal==="function"&&typeof confirmRecipients==="function");
  const canOpen=Boolean(nativeKernelPreview||
    (rawOpen&&(nativeRecipient||
      (signedReader&&kernel.hasOperation("t1.getWorkspace")))));
  ensure(ageOwner&&(rawOpen||nativeKernelPreview||
    (typeof ageOwner.prepareSeal==="function"&&
      typeof ageOwner.seal==="function"))&&
    (nativeRecipient||signedReader)&&typeof isHostActive==="function",
    "T3_D7_TRUSTED_AGE_OWNER_REQUIRED");
  const live=()=>ensure(isHostActive()===true,"T3_HOST_DISPOSED");
  // Direct installed Host usage must have the SAME one-dispatch guarantees
  // as signed Control HTTP. These bounded claims die with the Host; they are
  // NOT a new Kernel journal or a substitute for recipient cold readback.
  const nativePreviewClaims=new Map(),nativeInFlight=new Set(),nativeDispatched=new Set();
  const previewKey=(r,token)=>JSON.stringify([r.recipientId,r.bindingEpoch,token]);
  const claimFor=key=>{
    const claim=nativePreviewClaims.get(key);
    if(claim&&claim.expiresAt<=Date.now()){
      nativePreviewClaims.delete(key);return null;
    }
    return claim??null;
  };
  async function currentNativeRecipient(){
    live();
    const r=await ageOwner.currentRecipient();
    live();
    ensure(r&&id(r.recipientId)&&id(r.bindingEpoch),
      "T3_D7_ORIGINAL_NATIVE_RECIPIENT_REQUIRED");
    return {recipientId:r.recipientId,bindingEpoch:r.bindingEpoch};
  }
  async function selectedWorkspace(workspace_id){
    live();
    if(isolatedReader&&!signedReader){
      // Every read is executed by the ORIGINAL signed Kernel facade over
      // the pinned MessagePort, not by a new authorization proxy.
      const selection=async()=>{
        live();
        const context=await ageOwner.trustedSelectedWorkspace();
        live();
        ensure(context&&["CORP","PERSONAL"].includes(context.kind)&&
          id(context.workspace_id)&&context.resource===context.workspace_id&&
          (context.kind!=="PERSONAL"||context.organization_id===null),
          "T3_D7_SELECTED_WORKSPACE_MISMATCH");
        return context;
      };
      const selected=await selection();
      ensure(selected.workspace_id===workspace_id,
        "T3_D7_SELECTED_WORKSPACE_MISMATCH");
      const identity=JSON.stringify(selected);
      const unchanged=async()=>{
        ensure(identity===JSON.stringify(await selection()),
          "T3_D7_SIGNED_CONTEXT_CHANGED");
        live();
      };
      const read=async()=>{
        await unchanged();
        const workspace=await kernel.getWorkspace(workspace_id);
        await unchanged();
        ensure(workspace&&workspace.workspace_id===workspace_id&&
          !workspace.deleted_at,"T3_D7_WORKSPACE_UNAVAILABLE");
      };
      await read();
      return Object.freeze({unchanged,read});
    }
    ensure(signedReader,"T3_D7_SIGNED_OWNER_REQUIRED");
    const access=await accessForRead("t1.getWorkspace");
    live();
    ensure(access&&typeof access.currentContext==="function",
      "T3_D7_SIGNED_OWNER_REQUIRED");
    const context=await access.currentContext();
    ensure(context&&id(context.workspace_id)&&context.workspace_id===workspace_id&&
      context.resource===workspace_id,"T3_D7_SELECTED_WORKSPACE_MISMATCH");
    const identity=JSON.stringify(context);
    const unchanged=async()=>{
      live();
      ensure(identity===JSON.stringify(await access.currentContext()),
        "T3_D7_SIGNED_CONTEXT_CHANGED");
      live();
    };
    const signed=createSubjectKernelBinding({kernel,access,isHostActive});
    const read=async()=>{
      await unchanged();
      const workspace=await signed.getWorkspace(workspace_id);
      await unchanged();
      ensure(workspace&&workspace.workspace_id===workspace_id&&!workspace.deleted_at,
        "T3_D7_WORKSPACE_UNAVAILABLE");
    };
    await read();
    return Object.freeze({unchanged,read});
  }
  async function seal({workspace_id,archiveBytes}={}){
    live();
    ensure(canSeal,"T3_D7_SIGNED_EXPORT_OWNER_REQUIRED");
    ensure(id(workspace_id),"T3_D7_SELECTED_WORKSPACE_REQUIRED");
    ensure(archiveBytes instanceof Uint8Array&&archiveBytes.byteLength>0,
      "T3_D7_ORIGINAL_IWXA_REQUIRED");
    ensure(archiveBytes.byteLength<=maxArchiveBytes,
      "T3_D7_NATIVE_AGE_ARCHIVE_LIMIT_EXCEEDED");
    const original=take(archiveBytes,maxArchiveBytes,"T3_D7_ORIGINAL_IWXA_REQUIRED");
    ensure(zipHeader(original),"T3_D7_ORIGINAL_IWXA_REQUIRED");
    const access=await selectedWorkspace(workspace_id);
    const archiveSha256=await sha256(original);
    const plan=await ageOwner.prepareSeal({workspaceId:workspace_id,
      archiveSha256,archiveSize:original.length});
    await access.unchanged();
    ensure(plan?.format==="age-encryption.org/v1"&&plan?.status==="READY",
      "T3_D7_AGE_RECIPIENT_STATUS_NOT_READY");
    const recipientIds=recipientList(plan.recipientIds);
    const consent=await confirmRecipients({workspaceId:workspace_id,
      recipientIds:[...recipientIds],archiveSha256,archiveSize:original.length});
    await access.unchanged();
    ensure(consent===true,"T3_D7_HUMAN_RECIPIENT_CONFIRMATION_REQUIRED");
    await access.read();
    const result=await ageOwner.seal({archiveBytes:original,
      archiveSha256,recipientIds:[...recipientIds],workspaceId:workspace_id});
    await access.unchanged();
    ensure(result?.format==="age-encryption.org/v1"&&
      result.archiveSha256===archiveSha256&&sameList(recipientIds,result.recipientIds),
      "T3_D7_AGE_OWNER_RECEIPT_MISMATCH");
    ensure(result.ciphertext instanceof Uint8Array,
      "T3_D7_AGE_CIPHERTEXT_INVALID");
    ensure(result.ciphertext.byteLength<=maxCiphertextBytes,
      "T3_D7_NATIVE_AGE_CIPHERTEXT_LIMIT_EXCEEDED");
    const ciphertext=take(result.ciphertext,maxCiphertextBytes,
      "T3_D7_AGE_CIPHERTEXT_INVALID");
    ensure(ageHeader(ciphertext),"T3_D7_AGE_CIPHERTEXT_INVALID");
    await access.read();
    return Object.freeze({status:"AGE_PROTECTED_DOWNLOAD_READY",
      format:"age-encryption.org/v1",archiveSha256,
      recipientIds,ciphertext,savedToDevice:false,recipientImported:false});
  }
  // A native owner can decrypt and call the ORIGINAL Kernel.importPreview
  // behind its installed trust boundary; only the canonical preview token
  // may leave this boundary. Its token is subsequently used by the normal
  // human-confirmed T2 Exchange importCommit/importCancel.
  async function previewInOriginalKernel({ciphertext}={}){
    live();
    ensure(nativeKernelPreview,"T3_D7_NATIVE_KERNEL_PREVIEW_UNAVAILABLE");
    const encrypted=take(ciphertext,maxCiphertextBytes,"T3_D7_AGE_CIPHERTEXT_INVALID");
    ensure(ageHeader(encrypted),"T3_D7_AGE_CIPHERTEXT_INVALID");
    const recipient=await currentNativeRecipient();
    const result=await ageOwner.previewInOriginalKernel({
      ciphertext:encrypted,recipientId:recipient.recipientId,
    });
    ensure(JSON.stringify(await currentNativeRecipient())===JSON.stringify(recipient),
      "T3_D7_ORIGINAL_NATIVE_RECIPIENT_CHANGED");
    const h=result?.handle;
    ensure(result?.status==="KERNEL_PREVIEW_READY"&&
      result.recipientId===recipient.recipientId&&
      HEX.test(result.archiveSha256??"")&&h&&id(h.preview_token)&&
      typeof h.package_digest==="string"&&
      typeof h.semantic_digest==="string"&&
      typeof h.expires_at==="string"&&
      Number.isFinite(Date.parse(h.expires_at))&&Date.parse(h.expires_at)>Date.now()&&
      Array.isArray(h.allowed_modes)&&h.allowed_modes.length>0&&
      h.preview&&typeof h.preview==="object"&&!Array.isArray(h.preview),
      "T3_D7_ORIGINAL_KERNEL_PREVIEW_INVALID");
    for(const [key,claim] of nativePreviewClaims)
      if(claim.expiresAt<=Date.now())nativePreviewClaims.delete(key);
    const key=previewKey(recipient,h.preview_token);
    ensure(!nativePreviewClaims.has(key)&&!nativeDispatched.has(key)&&
      nativePreviewClaims.size<256,"T3_D7_NATIVE_PREVIEW_BINDING_INVALID");
    nativePreviewClaims.set(key,Object.freeze({
      packageDigest:h.package_digest,semanticDigest:h.semantic_digest,
      allowedModes:Object.freeze([...h.allowed_modes]),
      expiresAt:Date.parse(h.expires_at),
    }));
    const handle=Object.freeze(Object.fromEntries([
      "preview_token","package_digest","semantic_digest",
      "expires_at","allowed_modes","preview"
    ].map(key=>[key,h[key]])));
    return Object.freeze({status:"KERNEL_PREVIEW_READY",
      recipientId:recipient.recipientId,archiveSha256:result.archiveSha256,
      handle});
  }
  // Native age preview tokens belong to the ORIGINAL installed Kernel.
  // Commit/cancel MUST use that same owner, not an unrelated UI Kernel.
  async function commitInOriginalKernel({preview_token,package_digest,plan}={}){
    live();
    ensure(nativeKernelPreview,"T3_D7_NATIVE_KERNEL_COMMIT_UNAVAILABLE");
    ensure(id(preview_token)&&typeof package_digest==="string"&&
      package_digest.length>0&&plan&&typeof plan==="object"&&
      !Array.isArray(plan)&&typeof plan.mode==="string",
      "T3_D7_NATIVE_KERNEL_COMMIT_REQUEST_INVALID");
    const recipient=await currentNativeRecipient();
    const key=previewKey(recipient,preview_token);
    const claim=claimFor(key);
    ensure(claim&&claim.packageDigest===package_digest&&
      claim.allowedModes.includes(plan.mode),"T3_D7_NATIVE_PREVIEW_BINDING_INVALID");
    ensure(!nativeInFlight.has(key)&&!nativeDispatched.has(key),
      "T3_D7_NATIVE_OUTCOME_UNKNOWN");
    nativeInFlight.add(key);
    try{
      ensure(JSON.stringify(await currentNativeRecipient())===JSON.stringify(recipient),
        "T3_D7_NATIVE_OUTCOME_UNKNOWN");
      // A failed ACK cannot authorize the same original Kernel write again.
      nativePreviewClaims.delete(key);
      nativeDispatched.add(key);
      let receipt;
      try{
        receipt=await ageOwner.commitInOriginalKernel({
          preview_token,package_digest,plan,recipientId:recipient.recipientId,
        });
      }catch{deny("T3_D7_NATIVE_OUTCOME_UNKNOWN");}
      try{
        ensure(JSON.stringify(await currentNativeRecipient())===JSON.stringify(recipient)&&
          receipt?.format==="iwxa.import.receipt"&&
          receipt.package_digest===package_digest&&
          receipt.semantic_digest===claim.semanticDigest&&
          receipt.mode===plan.mode,
          "T3_D7_NATIVE_OUTCOME_UNKNOWN");
      }catch{deny("T3_D7_NATIVE_OUTCOME_UNKNOWN");}
      return receipt;
    }finally{
      nativeInFlight.delete(key);
    }
  }
  async function cancelInOriginalKernel({preview_token}={}){
    live();
    ensure(nativeKernelPreview,"T3_D7_NATIVE_KERNEL_CANCEL_UNAVAILABLE");
    ensure(id(preview_token),"T3_D7_NATIVE_KERNEL_CANCEL_REQUEST_INVALID");
    const recipient=await currentNativeRecipient();
    const key=previewKey(recipient,preview_token);
    ensure(claimFor(key),"T3_D7_NATIVE_PREVIEW_BINDING_INVALID");
    ensure(!nativeInFlight.has(key)&&!nativeDispatched.has(key),
      "T3_D7_NATIVE_OUTCOME_UNKNOWN");
    nativeInFlight.add(key);
    try{
      ensure(JSON.stringify(await currentNativeRecipient())===JSON.stringify(recipient),
        "T3_D7_NATIVE_OUTCOME_UNKNOWN");
      nativePreviewClaims.delete(key);
      nativeDispatched.add(key);
      let cancelled;
      try{
        cancelled=await ageOwner.cancelInOriginalKernel({
          preview_token,recipientId:recipient.recipientId,
        });
      }catch{deny("T3_D7_NATIVE_OUTCOME_UNKNOWN");}
      try{
        ensure(JSON.stringify(await currentNativeRecipient())===JSON.stringify(recipient),
          "T3_D7_NATIVE_OUTCOME_UNKNOWN");
      }catch{deny("T3_D7_NATIVE_OUTCOME_UNKNOWN");}
      return cancelled===true;
    }finally{
      nativeInFlight.delete(key);
    }
  }
  // Independent read-only recovery, including after a cold Host restart.
  // NO preview claim or new importCommit is required here: the trusted
  // installed recipient must resolve an ORIGINAL persisted Kernel receipt
  // and independently read its own Store. The public port never fabricates
  // a receipt when that native evidence is absent.
  async function readbackInOriginalKernel({preview_token,package_digest,
    semantic_digest,mode}={}){
    live();
    ensure(nativeKernelReadback,"T3_D7_NATIVE_KERNEL_READBACK_UNAVAILABLE");
    ensure(id(preview_token)&&id(package_digest)&&id(semantic_digest)&&
      ["full","selective","merge","new-workspace","cancel"].includes(mode),
      "T3_D7_NATIVE_READBACK_REQUEST_INVALID");
    const recipient=await currentNativeRecipient();
    const observed=await ageOwner.readbackInOriginalKernel({
      recipientId:recipient.recipientId,
      preview_token,package_digest,semantic_digest,mode,
    });
    ensure(JSON.stringify(await currentNativeRecipient())===
      JSON.stringify(recipient),"T3_D7_ORIGINAL_NATIVE_RECIPIENT_CHANGED");
    if(observed===null||observed===undefined||
       observed.status==="OUTCOME_UNKNOWN")
      return Object.freeze({status:"OUTCOME_UNKNOWN"});
    const receipt=observed.receipt;
    ensure(observed.status==="OWNER_READBACK_CONFIRMED"&&
      observed.readbackVerified===true&&
      // Repeated imports of identical .iwxa may share both digests.
      // A readback is evidence for THIS lost-ACK operation only when
      // the installed recipient binds it to the exact original preview.
      observed.preview_token===preview_token&&
      observed.recipientId===recipient.recipientId&&
      receipt?.format==="iwxa.import.receipt"&&
      id(receipt.import_id)&&
      receipt.package_digest===package_digest&&
      receipt.semantic_digest===semantic_digest&&
      receipt.mode===mode&&receipt.cancelled!==true&&
      receipt.applied&&typeof receipt.applied==="object"&&
      !Array.isArray(receipt.applied),
      "T3_D7_NATIVE_KERNEL_READBACK_INVALID");
    const fields=["import_id","format","format_version","package_digest",
      "semantic_digest","mode","conflict_policy","committed_at","applied",
      "skipped_conflicts","workspace_id_map","excluded_by_permission","cancelled"];
    const safe=Object.fromEntries(fields.filter(key=>Object.hasOwn(receipt,key))
      .map(key=>[key,receipt[key]]));
    return Object.freeze({status:"OWNER_READBACK_CONFIRMED",
      recipientId:recipient.recipientId,
      receipt:Object.freeze(safe)});
  }
  async function open({ciphertext}={}){
    ensure(rawOpen,"T3_D7_NATIVE_PLAINTEXT_PRIVATE");
    live();
    ensure(canOpen,"T3_D7_SIGNED_OWNER_REQUIRED");
    ensure(ciphertext instanceof Uint8Array&&ciphertext.byteLength>0,
      "T3_D7_AGE_CIPHERTEXT_INVALID");
    ensure(ciphertext.byteLength<=maxCiphertextBytes,
      "T3_D7_NATIVE_AGE_CIPHERTEXT_LIMIT_EXCEEDED");
    const encrypted=take(ciphertext,maxCiphertextBytes,
      "T3_D7_AGE_CIPHERTEXT_INVALID");
    ensure(ageHeader(encrypted),"T3_D7_AGE_CIPHERTEXT_INVALID");
    live();
    let nativeInput,unchanged,read;
    let recipientId=null;
    if(nativeRecipient){
      // Restore on a clean installation: the ORIGINAL installed native key
      // owner proves which local recipient is active, independent of a
      // Workspace or a Publisher licence. Its auth generation is pinned
      // across the asynchronous private-key operation.
      const recipient=async()=>{
        live();
        const current=await ageOwner.currentRecipient();
        live();
        ensure(current&&id(current.recipientId)&&id(current.bindingEpoch),
          "T3_D7_ORIGINAL_NATIVE_RECIPIENT_REQUIRED");
        return Object.freeze({
          recipientId:current.recipientId,bindingEpoch:current.bindingEpoch,
        });
      };
      const original=await recipient();
      recipientId=original.recipientId;
      const fingerprint=JSON.stringify(original);
      unchanged=async()=>{
        const latest=await recipient();
        ensure(JSON.stringify(latest)===fingerprint,
          "T3_D7_ORIGINAL_NATIVE_RECIPIENT_CHANGED");
      };
      read=unchanged;
      nativeInput={ciphertext:encrypted,recipientId};
    }else{
      // Preserve the legacy signed Workspace-bound owner unchanged.
      ensure(signedReader,"T3_D7_SIGNED_OWNER_REQUIRED");
      const owner=await accessForRead("t1.getWorkspace");
      live();
      const context=await owner?.currentContext();
      ensure(context&&id(context.workspace_id)&&
        context.resource===context.workspace_id,
        "T3_D7_SELECTED_WORKSPACE_REQUIRED");
      const signed=await selectedWorkspace(context.workspace_id);
      unchanged=signed.unchanged;
      read=signed.read;
      nativeInput={ciphertext:encrypted,
        selectedWorkspaceId:context.workspace_id};
    }
    // Decrypt never imports a package or grants data access. The native
    // owner verifies the real age envelope and controls its private key.
    const native=await ageOwner.open(nativeInput);
    await unchanged();
    ensure(native?.format==="age-encryption.org/v1"&&
      native.status==="OPENED_VERIFIED"&&native.verified===true&&
      id(native.recipientId)&&
      (recipientId===null||native.recipientId===recipientId)&&
      HEX.test(native.archiveSha256??""),
      "T3_D7_AGE_RECIPIENT_VERIFICATION_REQUIRED");
    ensure(native.archiveBytes instanceof Uint8Array,
      "T3_D7_AGE_PLAINTEXT_INVALID");
    ensure(native.archiveBytes.byteLength<=maxArchiveBytes,
      "T3_D7_NATIVE_AGE_ARCHIVE_LIMIT_EXCEEDED");
    const archiveBytes=take(native.archiveBytes,maxArchiveBytes,
      "T3_D7_AGE_PLAINTEXT_INVALID");
    ensure(zipHeader(archiveBytes),"T3_D7_AGE_PLAINTEXT_INVALID");
    ensure(await sha256(archiveBytes)===native.archiveSha256,
      "T3_D7_AGE_PLAINTEXT_DIGEST_MISMATCH");
    await read();
    return Object.freeze({status:"AGE_OPENED_NOT_IMPORTED",
      recipientId:native.recipientId,archiveSha256:native.archiveSha256,
      archiveBytes,kernelPreviewed:false,accepted:false});
  }
  return Object.freeze({seal,open,previewInOriginalKernel,
    commitInOriginalKernel,cancelInOriginalKernel,readbackInOriginalKernel,
    canSeal,canOpen,canNativeKernelPreview:Boolean(nativeKernelPreview),
    canNativeKernelReadback:nativeKernelReadback,
    maxArchiveBytes,maxCiphertextBytes});
}
