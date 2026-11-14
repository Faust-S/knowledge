// D7: only an installed, trusted age owner protects the original .iwxa bytes.
// Never create a second Exchange, cryptography, key custody, signer, or IAM.
// A Publisher product licence does NOT authorize access to workspace data.
import {createSubjectKernelBinding} from "./subject-access-binding.mjs";
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const HEX=/^[a-f0-9]{64}$/;
const TAG=new TextEncoder().encode("age-encryption.org/v1\n");
const MAX=200*1024*1024;
const MAX_AGE=MAX+1024*1024;
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
  const signedReader=kernel&&typeof kernel.hasOperation==="function"&&
    typeof accessForRead==="function";
  const nativeRecipient=typeof ageOwner?.currentRecipient==="function";
  const canSeal=Boolean(signedReader&&
    typeof ageOwner?.prepareSeal==="function"&&
    typeof ageOwner?.seal==="function"&&typeof confirmRecipients==="function");
  ensure(ageOwner&&typeof ageOwner.open==="function"&&
    (nativeRecipient||signedReader)&&typeof isHostActive==="function",
    "T3_D7_TRUSTED_AGE_OWNER_REQUIRED");
  const live=()=>ensure(isHostActive()===true,"T3_HOST_DISPOSED");
  async function selectedWorkspace(workspace_id){
    live();
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
    const original=take(archiveBytes,MAX,"T3_D7_ORIGINAL_IWXA_REQUIRED");
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
    const ciphertext=take(result.ciphertext,MAX_AGE,"T3_D7_AGE_CIPHERTEXT_INVALID");
    ensure(ageHeader(ciphertext),"T3_D7_AGE_CIPHERTEXT_INVALID");
    await access.read();
    return Object.freeze({status:"AGE_PROTECTED_DOWNLOAD_READY",
      format:"age-encryption.org/v1",archiveSha256,
      recipientIds,ciphertext,savedToDevice:false,recipientImported:false});
  }
  async function open({ciphertext}={}){
    const encrypted=take(ciphertext,MAX_AGE,"T3_D7_AGE_CIPHERTEXT_INVALID");
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
    const archiveBytes=take(native.archiveBytes,MAX,"T3_D7_AGE_PLAINTEXT_INVALID");
    ensure(zipHeader(archiveBytes),"T3_D7_AGE_PLAINTEXT_INVALID");
    ensure(await sha256(archiveBytes)===native.archiveSha256,
      "T3_D7_AGE_PLAINTEXT_DIGEST_MISMATCH");
    await read();
    return Object.freeze({status:"AGE_OPENED_NOT_IMPORTED",
      recipientId:native.recipientId,archiveSha256:native.archiveSha256,
      archiveBytes,kernelPreviewed:false,accepted:false});
  }
  return Object.freeze({seal,open,canSeal,canOpen:true});
}
