// T3 D7: Publisher licence/status reception through the ORIGINAL installed
// holder. Never implement an issuer, signed status engine, trust catalogue,
// private key store, archive parser or second Exchange in this browser port.
// Product licence / entitlement is NOT signed D1 data access authority.
import {createSubjectKernelBinding} from "./subject-access-binding.mjs";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const HEX=/^[0-9a-f]{64}$/;
const MAX=4*1024*1024;
const STATUS_MODES=new Set(["FULL_HOLDER_SNAPSHOT","SELECTIVE_DELTA","TOMBSTONE_EVENT"]);
const STATUS_STATES=new Set(["ACTIVE","SUSPENDED","REVOKED","SUPERSEDED"]);
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
// This is a display/receipt binding over the ORIGINAL signed /2 status,
// not a replacement for the original Publisher signature/status validator.
// The original payload permits 0..4096 changes; a full holder snapshot
// can carry zero entries and thus close all previous nonterminal entries.
function checkedStatus(row){
  const scope=row.scope,entries=row.entries;
  requireValue(row.statusSchema==="IWXA_T3_LICENSE_STATUS/2"&&
    HEX.test(row.statusPayloadDigest??"")&&
    Number.isSafeInteger(row.sequence)&&row.sequence>=1&&
    scope&&STATUS_MODES.has(scope.mode)&&
    (scope.lineageId===null||validId(scope.lineageId))&&
    Array.isArray(scope.licenseIds)&&scope.licenseIds.length<=4096&&
    scope.licenseIds.every(validId)&&
    new Set(scope.licenseIds).size===scope.licenseIds.length&&
    Array.isArray(entries)&&entries.length<=4096,
    "T3_D7_PUBLISHER_SIGNED_STATUS_REQUIRED");
  const full=scope.mode==="FULL_HOLDER_SNAPSHOT";
  requireValue(full
    ? scope.lineageId===null&&scope.licenseIds.length===0
    : (scope.lineageId!==null)!==(scope.licenseIds.length>0),
    "T3_D7_PUBLISHER_STATUS_SCOPE_INVALID");
  const selected=new Set(scope.licenseIds),seen=new Set();
  for(const entry of entries){
    requireValue(entry&&validId(entry.licenseId)&&validId(entry.lineageId)&&
      validId(entry.evidenceRef)&&STATUS_STATES.has(entry.state)&&
      typeof entry.effectiveAt==="string"&&
      !Number.isNaN(Date.parse(entry.effectiveAt))&&
      !seen.has(entry.licenseId)&&
      (scope.lineageId===null||entry.lineageId===scope.lineageId)&&
      (!selected.size||selected.has(entry.licenseId))&&
      (scope.mode!=="TOMBSTONE_EVENT"||
        entry.state==="REVOKED"||entry.state==="SUPERSEDED"),
      "T3_D7_PUBLISHER_STATUS_ENTRY_INVALID");
    seen.add(entry.licenseId);
  }
  if(selected.size)requireValue(seen.size===selected.size,
    "T3_D7_PUBLISHER_STATUS_SCOPE_INCOMPLETE");
  // Copy only signed, verified public status descriptors across the UI
  // boundary; do not expose private key/material or native runtime state.
  return Object.freeze({
    statusPayloadDigest:row.statusPayloadDigest,
    statusScope:Object.freeze({mode:scope.mode,lineageId:scope.lineageId,
      licenseIds:Object.freeze([...scope.licenseIds])}),
    statusEntries:Object.freeze(entries.map(e=>Object.freeze({
      licenseId:e.licenseId,lineageId:e.lineageId,state:e.state,
      effectiveAt:e.effectiveAt,evidenceRef:e.evidenceRef,
    }))),
  });
}
function opKey(row){
  return JSON.stringify([row.kind,row.recipientId,row.holderId,
    row.operationId,row.packageSha256]);
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
  const inFlight=new Set(); // claim before human confirmation; no parallel APPLY
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
    const status=kind==="STATUS"?checkedStatus(inspected):null;
    if(kind==="LICENSE")
      requireValue(validId(inspected.licenseId),
        "T3_D7_PUBLISHER_LICENSE_REFERENCE_REQUIRED");
    return {kind,bytes,inspected:Object.freeze({
      ...inspected, statusScope:status?.statusScope??null,
      statusEntries:status?.statusEntries??null,
      statusPayloadDigest:status?.statusPayloadDigest??null,
    })};
  }
  function summary(row){
    return Object.freeze({
      status:row.stage==="READY"?"VERIFIED_PENDING_CONSENT":"RECOVER_ONLY",
      kind:row.kind,packageSha256:row.packageSha256,
      previewDigest:row.previewDigest,holderId:row.holderId,
      recipientId:row.recipientId,operationId:row.operationId,
      issuerAuthorityId:row.issuerAuthorityId,publisherId:row.publisherId,
      licenseId:row.licenseId??null,sequence:row.sequence??null,
      statusScope:row.statusScope??null,statusEntries:row.statusEntries??null,
      statusPayloadDigest:row.statusPayloadDigest??null,
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
       (row.kind==="STATUS"&&(
         receipt.sequence!==row.sequence||
         receipt.statusPayloadDigest!==row.statusPayloadDigest||
         current.sequence!==row.sequence||
         current.statusPayloadDigest!==row.statusPayloadDigest||
         !Number.isSafeInteger(current.statusSequenceFloor)||
         current.statusSequenceFloor<row.sequence)))
      return Object.freeze({status:"OUTCOME_UNKNOWN",
        kind:row.kind,operationId:row.operationId});
    return Object.freeze({status:"ORIGINAL_HOLDER_READBACK_CONFIRMED",
      kind:row.kind,operationId:row.operationId,
      packageSha256:row.packageSha256,holderId:row.holderId,
      issuerAuthorityId:row.issuerAuthorityId,
      licenseId:current.licenseId??null,
      sequence:current.sequence??null,
      statusScope:row.statusScope??null,statusEntries:row.statusEntries??null,
      statusPayloadDigest:row.statusPayloadDigest??null,
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
    const key=opKey(row);
    if(row.stage==="RECOVER_ONLY"||uncertain.has(key))
      return Object.freeze({status:"OUTCOME_UNKNOWN",
        kind:row.kind,operationId:row.operationId});
    // A second direct Host call can race while human consent is open.
    // Do not issue two confirmations or native writes for the same receipt.
    if(inFlight.has(key))
      return Object.freeze({status:"OPERATION_IN_PROGRESS",
        kind:row.kind,operationId:row.operationId});
    inFlight.add(key);
    try {
      const approved=await confirmHuman(summary(row));
      await binding.current();
      if(approved!==true)
        return Object.freeze({status:"USER_CANCELLED",kind:row.kind});
      await binding.read();
      const fresh=(await checkedInspection({kind:row.kind,archiveBytes:bytes},
        binding)).inspected;
      requireValue(fresh.operationId===row.operationId&&
        fresh.previewDigest===row.previewDigest&&fresh.stage==="READY"&&
        (row.kind!=="STATUS"||
          (fresh.statusPayloadDigest===row.statusPayloadDigest&&
            fresh.sequence===row.sequence)),
        "T3_D7_PUBLISHER_PREVIEW_CHANGED");
      // Lost native ACK may hide committed bytes. Mark before the ONLY write.
      uncertain.add(key);
      try {
        await nativeHolder.apply({
          kind:row.kind,archiveBytes:bytes,
          operationId:row.operationId,packageSha256:row.packageSha256,
          previewDigest:row.previewDigest,
          subject:binding.subject,context:binding.context,
        });
        return await observe(row,binding);
      }catch {
        return Object.freeze({status:"OUTCOME_UNKNOWN",
          kind:row.kind,operationId:row.operationId});
      }
    }finally {
      inFlight.delete(key);
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
