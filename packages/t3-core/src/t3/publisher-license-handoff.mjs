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
// A signed native holder's definite refusal is NOT a lost read-only ACK.
// Keep this limited to original owner denial codes, never infer successful
// application from a transport response or use the error as retry permission.
const ORIGINAL_HOLDER_DENIALS=new Set([
  "PERMISSION_DENIED","CAPABILITY_DENIED","T3_ACCESS_NOT_PERMITTED",
  "PERSON_OWNER_ACTION_DENIED","PRODUCT_OWNER_HOST_ACTION_DENIED",
  "PERSON_STATUS_ROLLBACK_DENIED","PERSON_STATUS_REVOKE_RESURRECTION_DENIED",
  "PERSON_STATUS_EQUIVOCATION_DENIED",
]);
function rethrowOriginalHolderRefusal(error){
  if(error?.outcome==="DENIED"||ORIGINAL_HOLDER_DENIALS.has(error?.code))
    throw error;
}
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
function checkedStatus(row,subject){
  if(row.statusSchema==="IWXA_T3_PRODUCT_LICENSE_STATUS/2"){
    // The ORIGINAL PERSON issuer signs a different /2 payload than the
    // holder-wide status contract. Keep the families distinct, not renamed.
    requireValue(subject?.subjectType==="PERSON"&&
      row.personId===subject.holderId&&validId(row.personId)&&
      validId(row.licenseId)&&
      ["IWXA_ATLAS","IWXA_PERSONAL_AGENT"].includes(row.productId)&&
      ["ACTIVE","SUSPENDED","REVOKED"].includes(row.statusState)&&
      Number.isSafeInteger(row.sequence)&&row.sequence>=1&&
      HEX.test(row.statusPayloadDigest??"")&&
      typeof row.statusValidUntil==="string"&&
      Number.isFinite(Date.parse(row.statusValidUntil))&&
      row.scope===undefined&&row.entries===undefined,
      "T3_D7_PERSON_ORIGINAL_SIGNED_STATUS_REQUIRED");
    return Object.freeze({statusPayloadDigest:row.statusPayloadDigest,
      statusScope:null,statusEntries:null,
      statusFamily:"PERSON_PRODUCT_STATUS/2",
      productId:row.productId,statusState:row.statusState});
  }
  if(row.statusSchema==="IWXA_T3_PRODUCT_LICENSE_STATUS/3"){
    // Corporate product STATUS is the ORIGINAL T3 /3 family and is separate
    // from the legacy TEST /1, PERSON /2 and generic holder STATUS /2.
    // Native holder inspection must have already verified exact signed bytes,
    // pinned publisher trust, organization recipient, sequence and floor.
    requireValue(subject?.subjectType==="ORGANIZATION"&&
      row.organizationId===subject.recipientId&&
      validId(row.organizationId)&&validId(row.licenseId)&&
      row.productId==="IWXA_ADMIN_CENTER"&&
      ["ACTIVE","SUSPENDED","REVOKED"].includes(row.statusState)&&
      Number.isSafeInteger(row.sequence)&&row.sequence>=1&&
      HEX.test(row.statusPayloadDigest??"")&&
      typeof row.statusValidUntil==="string"&&
      Number.isFinite(Date.parse(row.statusValidUntil))&&
      row.scope===undefined&&row.entries===undefined,
      "T3_D7_CORPORATE_ORIGINAL_SIGNED_STATUS_REQUIRED");
    return Object.freeze({statusPayloadDigest:row.statusPayloadDigest,
      statusScope:null,statusEntries:null,
      statusFamily:"CORPORATE_PRODUCT_STATUS/3",
      productId:row.productId,statusState:row.statusState});
  }
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
 * read, not a transport ACK or a React state cache.
 *
 * Publisher activation is NOT workspace.read: a freshly installed Agent,
 * Atlas, etc. must receive its own native licence BEFORE a T2 Workspace or
 * signed D1 workspace grant exists. Trusted native currentSubject() proves
 * the already-installed holder independently of data access. A legacy
 * subjectForContext() owner continues to require original signed T2 reads.
 * Neither mode can authorize reading data using a Publisher entitlement. */
export function createTrustedPublisherHandoff({
  kernel,accessForRead,nativeHolder,confirmHuman,isHostActive,
}={}){
  // Only a compiled, trusted installed Host may inject nativeHolder.
  // It MUST obtain the current native holder from its existing subject
  // authority, not from the .iwxa package or a user-controlled form.
  const nativeSubject=typeof nativeHolder?.currentSubject==="function";
  const signedSubject=typeof nativeHolder?.subjectForContext==="function"&&
    kernel&&typeof kernel.hasOperation==="function"&&
    typeof accessForRead==="function";
  requireValue(nativeHolder&&
    ["inspect","apply","receipt","statusReadback"]
      .every(m=>typeof nativeHolder[m]==="function")&&
    (nativeSubject||signedSubject)&&
    typeof confirmHuman==="function"&&typeof isHostActive==="function",
    "T3_D7_ORIGINAL_HOLDER_REQUIRED");
  const uncertain=new Set(); // volatile no-repeat guard, not a Store
  const inFlight=new Set(); // claim before human confirmation; no parallel APPLY
  const active=()=>requireValue(isHostActive()===true,"T3_HOST_DISPOSED");
  async function bind(){
    active();
    if(nativeSubject){
      const snapshot=async()=>{
        active();
        const value=await nativeHolder.currentSubject();
        active();
        requireValue(value&&validId(value.holderId)&&
          validId(value.recipientId)&&
          ["PERSON","ORGANIZATION"].includes(value.subjectType)&&
          validId(value.bindingEpoch),
          "T3_D7_ORIGINAL_NATIVE_HOLDER_UNBOUND");
        // Keep only native holder identity and generation, never its private
        // credential or state, and do not accept a UI-selected subject.
        return Object.freeze({
          holderId:value.holderId,recipientId:value.recipientId,
          subjectType:value.subjectType,bindingEpoch:value.bindingEpoch,
        });
      };
      const subject=await snapshot();
      const fingerprint=JSON.stringify(subject);
      const current=async()=>{
        const latest=await snapshot();
        requireValue(JSON.stringify(latest)===fingerprint,
          "T3_D7_ORIGINAL_NATIVE_HOLDER_CHANGED");
      };
      await current();
      // No Kernel data access is needed to install, renew or revoke a
      // product licence. Only native original durable holder readback can
      // establish whether the signed Publisher operation took effect.
      return {context:null,subject,read:current,current};
    }
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
    const status=kind==="STATUS"?checkedStatus(inspected,binding.subject):null;
    if(kind==="LICENSE")
      requireValue(validId(inspected.licenseId),
        "T3_D7_PUBLISHER_LICENSE_REFERENCE_REQUIRED");
    return {kind,bytes,inspected:Object.freeze({
      ...inspected, statusScope:status?.statusScope??null,
      statusEntries:status?.statusEntries??null,
      statusPayloadDigest:status?.statusPayloadDigest??null,
      ...(status?.statusFamily?{statusFamily:status.statusFamily,
        productId:status.productId,statusState:status.statusState}:{}),
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
      ...(row.statusFamily?{statusFamily:row.statusFamily,
        productId:row.productId,statusState:row.statusState}:{}),
      dataAccessAuthorized:false,entitlementActivated:false,
    });
  }
  async function observe(row,binding){
    const query={kind:row.kind,operationId:row.operationId,
      packageSha256:row.packageSha256,
      holderId:row.holderId,recipientId:row.recipientId};
    let receipt,current,nativeUnavailable=false;
    try{
      receipt=await nativeHolder.receipt(query);
      current=await nativeHolder.statusReadback(query);
    }catch(error){
      await binding.current();
      rethrowOriginalHolderRefusal(error);
      nativeUnavailable=true;
    }
    // A missing ORIGINAL holder readback is uncertain, but original signed
    // authorization failures must still reach the caller as denials.
    await binding.read();
    const matches=r=>matching(r,query,["kind","operationId",
      "packageSha256","holderId","recipientId"]);
    if(nativeUnavailable||!matches(receipt)||!matches(current)||
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
      ...(row.statusFamily?{statusFamily:row.statusFamily,
        productId:row.productId,statusState:row.statusState}:{}),
      entitlementActivated:false,dataAccessAuthorized:false});
  }
  async function preview(input){
    const binding=await bind();
    const {inspected}=await checkedInspection(input,binding);
    await binding.read();
    const key=opKey(inspected);
    // A lost native ACK may leave the original holder reporting READY.
    // Show recovery or in-progress, never another Human APPLY.
    const describe=status=>Object.freeze({...summary(inspected),status});
    if(inFlight.has(key))return describe("OPERATION_IN_PROGRESS");
    if(uncertain.has(key)||inspected.stage==="RECOVER_ONLY")
      return describe("RECOVER_ONLY");
    const query={kind:inspected.kind,operationId:inspected.operationId,
      packageSha256:inspected.packageSha256,holderId:inspected.holderId,
      recipientId:inspected.recipientId};
    let prior,unavailable=false;
    try{prior=await nativeHolder.receipt(query);}
    catch(error){
      await binding.current();
      rethrowOriginalHolderRefusal(error);
      unavailable=true;
    }
    // Signed context change is a denial, not a native receipt outage.
    await binding.current();
    if(unavailable||(prior!==null&&prior!==undefined))
      return describe("RECOVER_ONLY");
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
    const query={kind:row.kind,operationId:row.operationId,
      packageSha256:row.packageSha256,
      holderId:row.holderId,recipientId:row.recipientId};
    inFlight.add(key);
    try {
      // Cold Host memory may be empty while the recipient already committed.
      // Ask the original durable owner BEFORE showing Human consent again.
      let earlier;
      try{earlier=await nativeHolder.receipt(query);}
      catch(error){
        await binding.current();
        rethrowOriginalHolderRefusal(error);
        return Object.freeze({status:"OUTCOME_UNKNOWN",
          kind:row.kind,operationId:row.operationId});
      }
      await binding.current();
      if(earlier!==null&&earlier!==undefined)
        return observe(row,binding);
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
      // Cold-opened installed holders may still report READY even when an
      // earlier native Apply committed but its acknowledgement was lost.
      // The ORIGINAL durable receipt is authoritative; never dispatch that
      // same operationId twice, even if a volatile guard was reset.
      let prior;
      try{prior=await nativeHolder.receipt(query);}
      catch(error){
        await binding.current();
        rethrowOriginalHolderRefusal(error);
        return Object.freeze({status:"OUTCOME_UNKNOWN",
          kind:row.kind,operationId:row.operationId});
      }
      await binding.current();
      if(prior!==null&&prior!==undefined)
        return observe(row,binding);
      // Lost native ACK may hide committed bytes. Mark before the ONLY write.
      uncertain.add(key);
      try {
        await nativeHolder.apply({
          kind:row.kind,archiveBytes:bytes,
          operationId:row.operationId,packageSha256:row.packageSha256,
          previewDigest:row.previewDigest,
          subject:binding.subject,context:binding.context,
        });
      }catch {
        return Object.freeze({status:"OUTCOME_UNKNOWN",
          kind:row.kind,operationId:row.operationId});
      }
      // The original holder may have persisted successfully while signed
      // access changed. A D1 denial during readback must remain a denial,
      // not masquerade as an ambiguous native APPLY acknowledgement.
      return observe(row,binding);
    }finally {
      inFlight.delete(key);
    }
  }
  async function recover(input){
    const binding=await bind();
    const {inspected}=await checkedInspection(input,binding);
    return observe(inspected,binding);
  }
  return Object.freeze({preview,admit,recover});
}
