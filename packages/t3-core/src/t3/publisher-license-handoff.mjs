// T3 D7: Publisher licence/status reception through the ORIGINAL installed
// holder. Never implement an issuer, signed status engine, trust catalogue,
// private key store, archive parser or second Exchange in this browser port.
// Product licence / entitlement is NOT signed D1 data access authority.
import {createSubjectKernelBinding} from "./subject-access-binding.mjs";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const HEX=/^[0-9a-f]{64}$/;
const MAX=4*1024*1024;
const validId=x=>typeof x==="string"&&ID.test(x);
function deny(code){throw Object.assign(new Error(code),{code,outcome:"DENIED"});}
function requireValue(ok,code){if(!ok)deny(code);}
function zip(raw){return raw[0]===0x50&&raw[1]===0x4b&&raw[2]===3&&raw[3]===4;}
function archiveBytes(value){
  requireValue(value instanceof Uint8Array&&value.byteLength>=4&&
    value.byteLength<=MAX&&zip(value),"T3_D7_PUBLISHER_IWXA_REQUIRED");
  return Uint8Array.from(value);
}
async function hash(raw){
  requireValue(typeof globalThis.crypto?.subtle?.digest==="function",
    "T3_D7_PUBLISHER_SHA256_UNAVAILABLE");
  const digest=new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256",raw));
  return [...digest].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function kindOf(value){
  requireValue(value==="LICENSE"||value==="STATUS",
    "T3_D7_PUBLISHER_KIND_INVALID");
  return value;
}
function matching(v,expected,fields){
  return v&&fields.every(k=>v[k]===expected[k]);
}
/** A Host supplies the existing original native holder, whose preview verifies
 * signed Publisher identity against pinned PUBLIC trust, holder binding and
 * original .iwxa carrier. apply() performs the ORIGINAL durable holder
 * import/admit/status mutation. statusReadback is a FRESH original durable
 * read, not a transport ACK or a React state cache. */
export function createTrustedPublisherHandoff({
  kernel,accessForRead,nativeHolder,confirmHuman,isHostActive,
}={}){
  requireValue(kernel&&typeof kernel.hasOperation==="function"&&
    typeof accessForRead==="function"&&nativeHolder&&
    ["subjectForContext","inspect","apply","receipt","statusReadback"]
      .every(m=>typeof nativeHolder[m]==="function")&&
    typeof confirmHuman==="function"&&typeof isHostActive==="function",
    "T3_D7_ORIGINAL_HOLDER_REQUIRED");
  const uncertain=new Set(); // volatile no-repeat guard, not a Store
  const active=()=>requireValue(isHostActive()===true,"T3_HOST_DISPOSED");
  async function bind(){
    active();
    const access=await accessForRead("t1.getWorkspace");
    active();
    requireValue(access&&typeof access.currentContext==="function",
      "T3_D7_SIGNED_OWNER_REQUIRED");
    const context=await access.currentContext();
    requireValue(context&&validId(context.workspace_id)&&
      context.resource===context.workspace_id,
      "T3_D7_SELECTED_WORKSPACE_REQUIRED");
    const contextIdentity=JSON.stringify(context);
    const current=async()=>{
      active();
      requireValue(JSON.stringify(await access.currentContext())===contextIdentity,
        "T3_D7_SIGNED_CONTEXT_CHANGED");
      active();
    };
    const signed=createSubjectKernelBinding({
      kernel,access,isHostActive:()=>isHostActive()===true,
    });
    const read=async()=>{
      await current();
      const workspace=await signed.getWorkspace(context.workspace_id);
      await current();
      requireValue(workspace?.workspace_id===context.workspace_id&&
        !workspace.deleted_at,"T3_D7_ORIGINAL_WORKSPACE_UNAVAILABLE");
    };
    await read();
    const subject=await nativeHolder.subjectForContext(context);
    await current();
    requireValue(subject&&validId(subject.holderId)&&
      validId(subject.recipientId)&&
      ["PERSON","ORGANIZATION"].includes(subject.subjectType),
      "T3_D7_ORIGINAL_HOLDER_UNBOUND");
    return {context,subject,read,current};
  }
  async function checkedInspection(input,binding){
    const kind=kindOf(input.kind),bytes=archiveBytes(input.archiveBytes);
    const packageSha256=await hash(bytes);
    await binding.current();
    const inspected=await nativeHolder.inspect({
      kind,archiveBytes:bytes,
      packageSha256,context:binding.context,subject:binding.subject,
    });
    await binding.current();
    const expected={kind,packageSha256,holderId:binding.subject.holderId,
      recipientId:binding.subject.recipientId};
    requireValue(matching(inspected,expected,["kind","packageSha256",
      "holderId","recipientId"])&&
      inspected.publisherSignatureVerified===true&&
      inspected.pinnedPublisherTrusted===true&&
      validId(inspected.publisherId)&&validId(inspected.issuerAuthorityId)&&
      validId(inspected.operationId)&&HEX.test(inspected.previewDigest??"")&&
      ["READY","RECOVER_ONLY"].includes(inspected.stage),
      "T3_D7_PUBLISHER_ORIGINAL_INSPECTION_REQUIRED");
    if(kind==="LICENSE"){
      requireValue(validId(inspected.licenseId),
        "T3_D7_PUBLISHER_LICENSE_REFERENCE_REQUIRED");
    }else{
      requireValue(Number.isSafeInteger(inspected.sequence)&&
        inspected.sequence>=1&&["ACTIVE","SUSPENDED","REVOKED","SUPERSEDED"]
          .includes(inspected.targetStatus),
        "T3_D7_PUBLISHER_SIGNED_STATUS_REQUIRED");
    }
    return {kind,bytes,inspected:Object.freeze({...inspected})};
  }
  function summary(row){
    return Object.freeze({
      status:row.stage==="READY"?"VERIFIED_PENDING_CONSENT":"RECOVER_ONLY",
      kind:row.kind,packageSha256:row.packageSha256,
      previewDigest:row.previewDigest,holderId:row.holderId,
      recipientId:row.recipientId,operationId:row.operationId,
      issuerAuthorityId:row.issuerAuthorityId,publisherId:row.publisherId,
      licenseId:row.licenseId??null,sequence:row.sequence??null,
      targetStatus:row.targetStatus??null,
      dataAccessAuthorized:false,entitlementActivated:false,
    });
  }
  async function observe(row,binding){
    const query={kind:row.kind,operationId:row.operationId,
      packageSha256:row.packageSha256,
      holderId:row.holderId,recipientId:row.recipientId};
    const receipt=await nativeHolder.receipt(query);
    const current=await nativeHolder.statusReadback(query);
    await binding.read();
    const matches=r=>matching(r,query,["kind","operationId",
      "packageSha256","holderId","recipientId"]);
    if(!matches(receipt)||!matches(current)||
       receipt.state!=="COMMITTED"||current.persisted!==true||
       !validId(current.issuerAuthorityId)||
       current.issuerAuthorityId!==row.issuerAuthorityId||
       (row.kind==="LICENSE"&&current.licenseId!==row.licenseId)||
       (row.kind==="STATUS"&&(!Number.isSafeInteger(current.sequence)||
         current.sequence<row.sequence||
         current.targetStatus!==row.targetStatus)))
      return Object.freeze({status:"OUTCOME_UNKNOWN",
        kind:row.kind,operationId:row.operationId});
    return Object.freeze({status:"ORIGINAL_HOLDER_READBACK_CONFIRMED",
      kind:row.kind,operationId:row.operationId,
      packageSha256:row.packageSha256,holderId:row.holderId,
      issuerAuthorityId:row.issuerAuthorityId,
      licenseId:current.licenseId??null,
      sequence:current.sequence??null,targetStatus:current.targetStatus??null,
      entitlementActivated:false,dataAccessAuthorized:false});
  }
  async function preview(input){
    const binding=await bind();
    const {inspected}=await checkedInspection(input,binding);
    await binding.read();
    return summary(inspected);
  }
  async function admit(input){
    const binding=await bind();
    const {bytes,inspected:row}=await checkedInspection(input,binding);
    requireValue(HEX.test(input.previewDigest??"")&&
      row.previewDigest===input.previewDigest,
      "T3_D7_PUBLISHER_PREVIEW_CHANGED");
    if(row.stage==="RECOVER_ONLY"||uncertain.has(row.operationId))
      return Object.freeze({status:"OUTCOME_UNKNOWN",
        kind:row.kind,operationId:row.operationId});
    const approved=await confirmHuman(summary(row));
    await binding.current();
    if(approved!==true)return Object.freeze({status:"USER_CANCELLED",kind:row.kind});
    // Native receipt may be lost even after the original holder committed.
    // Never call apply twice. Re-check owner inspection & signed read after
    // human approval, then mark this operation before the only dispatch.
    await binding.read();
    const fresh=(await checkedInspection({kind:row.kind,archiveBytes:bytes},
      binding)).inspected;
    requireValue(fresh.operationId===row.operationId&&
      fresh.previewDigest===row.previewDigest&&fresh.stage==="READY",
      "T3_D7_PUBLISHER_PREVIEW_CHANGED");
    uncertain.add(row.operationId);
    try{
      await nativeHolder.apply({
        kind:row.kind,archiveBytes:bytes,
        operationId:row.operationId,packageSha256:row.packageSha256,
        previewDigest:row.previewDigest,
        subject:binding.subject,context:binding.context,
      });
      return await observe(row,binding);
    }catch{
      return Object.freeze({status:"OUTCOME_UNKNOWN",
        kind:row.kind,operationId:row.operationId});
    }
  }
  async function recover(input){
    const binding=await bind();
    const {inspected}=await checkedInspection(input,binding);
    try{return await observe(inspected,binding);}
    catch{return Object.freeze({status:"OUTCOME_UNKNOWN",
      kind:inspected.kind,operationId:inspected.operationId});}
  }
  return Object.freeze({preview,admit,recover});
}
