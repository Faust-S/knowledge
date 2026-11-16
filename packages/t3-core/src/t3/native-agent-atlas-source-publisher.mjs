// T3 D6 sender-side composition for the installed ORIGINAL Agent and T2 Host.
// No signer, Kernel, Exchange, ledger, Task Engine, or Store is implemented here.
// Every durable operation is delegated to the installed original owner.
// Do NOT mount this as a browser-selected owner or treat a test port as native.
import {createHash} from "node:crypto";
import {createSubjectKernelBinding} from "./subject-access-binding.mjs";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const HEX=/^[a-f0-9]{64}$/;
const KEYS=["schema","recipientId","signedTaskId","signedTaskRevisionId",
  "signedTaskPackageSha256","taskId","resultId","acceptedDigest","workRef",
  "contextDigest"];
const WORK=["projectId","workId","revision"];
const REF=["workspace_id","object_id","schema_id","revision"];
const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const id=x=>typeof x==="string"&&ID.test(x);
const hex=x=>typeof x==="string"&&HEX.test(x);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const canonical=x=>Array.isArray(x)?"["+x.map(canonical).join(",")+"]":
  object(x)?"{"+Object.keys(x).sort().map(k=>JSON.stringify(k)+":"+canonical(x[k])).join(",")+"}":
  JSON.stringify(x);
const digest=x=>createHash("sha256").update(canonical(x),"utf8").digest("hex");
function deny(code){throw Object.assign(Error(code),{code,outcome:"DENIED"});}
function check(ok,code){if(!ok)deny(code);}
function same(a,b,fields){return object(a)&&object(b)&&fields.every(k=>equal(a[k],b[k]));}
function copy(x){return structuredClone(x);}
function verifyBinding(raw){
  check(object(raw)&&Object.keys(raw).sort().join()=== [...KEYS].sort().join()&&
    raw.schema==="IWXA_AGENT_T3_ORIGINAL_ATLAS_PUBLICATION/1"&&
    raw.recipientId==="iwxa.atlas"&&
    ["signedTaskId","signedTaskRevisionId","taskId","resultId"].every(k=>id(raw[k]))&&
    ["signedTaskPackageSha256","acceptedDigest","contextDigest"].every(k=>hex(raw[k]))&&
    object(raw.workRef)&&Object.keys(raw.workRef).sort().join()===
      [...WORK].sort().join()&&
    id(raw.workRef.projectId)&&id(raw.workRef.workId)&&
    typeof raw.workRef.revision==="string"&&
    /^(0|[1-9][0-9]*)$/.test(raw.workRef.revision)&&
    Number.isSafeInteger(Number(raw.workRef.revision)),
    "T3_D6_ATLAS_ORIGINAL_BINDING_INVALID");
  return copy(raw);
}
function operationFor(binding){return "agent:t3:atlas:"+digest(binding);}
function refOf(input){
  check(object(input)&&REF.slice(0,3).every(k=>id(input[k]))&&
    Number.isSafeInteger(input.revision)&&input.revision>0,
    "T3_D6_ATLAS_ORIGINAL_OBJECT_REF_INVALID");
  return Object.fromEntries(REF.map(k=>[k,input[k]]));
}
function ownerRow(row,binding,operationId){
  check(object(row)&&row.operationId===operationId&&
    same(row,binding,KEYS.filter(k=>k!=="schema"))&&
    row.retrySafe===false,
    "T3_D6_ATLAS_ORIGINAL_LEDGER_BINDING_INVALID");
  if(row.status==="UNISSUED"){
    check(row.originalLedgerVerified===true&&
      row.noPriorDispatchVerified===true&&row.originalReceiptVerified===false,
      "T3_D6_ATLAS_UNISSUED_NOT_PROVED");
  }else if(row.status==="PREPARED"||row.status==="OUTCOME_UNKNOWN"){
    check(row.originalReceiptVerified===false,
      "T3_D6_ATLAS_UNKNOWN_RECEIPT_INVALID");
  }else if(row.status==="COMMITTED"){
    check(row.originalReceiptVerified===true&&hex(row.archiveSha256)&&
      id(row.originalEventId),"T3_D6_ATLAS_COMMITTED_RECEIPT_INVALID");
    refOf(row.sourceObjectRef);
  }else deny("T3_D6_ATLAS_ORIGINAL_LEDGER_STATUS_INVALID");
  return row;
}
function publicationResponse(row,binding){
  return Object.freeze({...copy(binding),operationId:row.operationId,
    status:row.status,retrySafe:false,originalReceiptVerified:
      row.originalReceiptVerified,
    ...(row.status==="UNISSUED"?{
      originalLedgerVerified:true,noPriorDispatchVerified:true,
    }:{}),
    ...(row.status==="COMMITTED"?{
      sourceObjectRef:refOf(row.sourceObjectRef),
      archiveSha256:row.archiveSha256,
    }:{}),
  });
}

/**
 * Original owner port for Agent InstalledOriginalAgentResultOwner.
 *
 * originalLedger is the already-installed T3 Reconciliation authority:
 * read, reserve, finalize, findByObject, findByWork, findLatestWork.
 * originalExchange is the existing signed T2 Exchange/recipient authority:
 * publishSelectedResult, verifySelectedResult (checks the stored archive
 * bytes, original signature, original source Object and exact iwxa.atlas).
 * acceptedSource reads accepted Result through the *installed* Agent Core;
 * prepareOriginalGraph prepares the existing Kernel's registered schema.
 *
 * These native providers are mandatory and NEVER supplied by a UI request.
 * In particular, an absent ledger row is NOT proof of UNISSUED.
 */
export function createTrustedAgentAtlasSourcePublisher({
  kernel,access,originalLedger,originalExchange,acceptedSource,
  originalEmployee,prepareOriginalGraph,confirmDisclosure,isHostActive,
}={}){
  check(kernel?.hasOperation&&kernel?.sessionInfo?.contract_version==="1.3.0"&&
    access?.currentContext&&typeof isHostActive==="function"&&
    typeof confirmDisclosure==="function"&&
    typeof prepareOriginalGraph==="function"&&
    ["read","reserve","finalize","findByObject","findByWork","findLatestWork"]
      .every(m=>typeof originalLedger?.[m]==="function")&&
    ["publishSelectedResult","verifySelectedResult"]
      .every(m=>typeof originalExchange?.[m]==="function")&&
    typeof acceptedSource?.readAccepted==="function"&&
    ["verifySignedTask","authorizeAtlasExport"]
      .every(m=>typeof originalEmployee?.[m]==="function"),
    "T3_D6_INSTALLED_ORIGINAL_PUBLISHER_REQUIRED");
  const inFlight=new Set(),attempted=new Set();
  const active=()=>check(isHostActive()===true,"T3_D6_ORIGINAL_HOST_DISPOSED");
  async function current(binding){
    active();
    const c=await access.currentContext();
    check(object(c)&&c.kind==="CORP"&&id(c.workspace_id)&&
      c.resource===c.workspace_id&&
      c.organization_id===c.principal_id,
      "T3_D6_ORIGINAL_EMPLOYEE_SCOPE_REQUIRED");
    const verified=await originalEmployee.verifySignedTask(copy(binding),copy(c));
    check(verified===true,"T3_D6_ORIGINAL_SIGNED_TASK_REQUIRED");
    active();
    return c;
  }
  async function signedFor(binding){
    const c=await current(binding);
    const signed=createSubjectKernelBinding({kernel,access,isHostActive});
    return {c,signed};
  }
  async function verifyCommitted(row,binding){
    const ref=refOf(row.sourceObjectRef);
    const {c,signed}=await signedFor(binding);
    check(ref.workspace_id===c.workspace_id,
      "T3_D6_ORIGINAL_SOURCE_WORKSPACE_CHANGED");
    const read=await signed.getObject(ref.workspace_id,ref.object_id);
    const events=await signed.listEventsSince(ref.workspace_id);
    const effectKey=row.operationId.slice("agent:t3:atlas:".length);
    check(read?.object?.workspace_id===ref.workspace_id&&
      same(read.object,ref,REF)&&
      read.object.deleted!==true&&read.object.deleted_at==null&&
      object(read.object.data)&&
      read.object.data.taskId===binding.taskId&&
      read.object.data.resultId===binding.resultId&&
      read.object.data.acceptedDigest===binding.acceptedDigest&&
      read.object.data.signedTaskId===binding.signedTaskId&&
      read.object.data.signedTaskRevisionId===binding.signedTaskRevisionId&&
      read.object.data.signedTaskPackageSha256===binding.signedTaskPackageSha256&&
      read.object.data.contextDigest===binding.contextDigest&&
      same(read.object.data.workRef,binding.workRef,WORK)&&
      Array.isArray(events)&&events.filter(e=>
        e?.idempotency_key===effectKey&&
        e?.event_id===row.originalEventId&&
        e?.object_id===ref.object_id&&
        e?.revision===ref.revision&&
        e?.workspace_id===ref.workspace_id).length===1,
      "T3_D6_ORIGINAL_KERNEL_READBACK_MISMATCH");
    const archive=await originalExchange.verifySelectedResult({
      operationId:row.operationId,binding:copy(binding),
      sourceObjectRef:copy(ref),archiveSha256:row.archiveSha256,
    });
    check(archive?.status==="VERIFIED"&&
      archive.recipientId==="iwxa.atlas"&&
      archive.archiveSha256===row.archiveSha256&&
      archive.taskId===binding.taskId&&archive.resultId===binding.resultId&&
      same(archive.sourceObjectRef,ref,REF)&&
      archive.originalSignatureVerified===true&&
      archive.archiveBytesVerified===true&&
      archive.originalManifestVerified===true&&
      archive.disclosureScope==="ORIGINAL_RESULT_ONLY"&&
      same(archive.selectedSourceObjectRef,ref,REF),
      "T3_D6_ORIGINAL_EXCHANGE_READBACK_MISMATCH");
    await current(binding);
    return {ref,archive};
  }
  async function readRow(operationId,binding){
    const input=verifyBinding(binding);
    check(operationId===operationFor(input),
      "T3_D6_ORIGINAL_OPERATION_ID_INVALID");
    await current(input);
    // The installed original ledger MUST distinguish absent, prepared,
    // possibly committed, and committed-with-original-receipts.
    const row=ownerRow(await originalLedger.read(operationId,copy(input)),
      input,operationId);
    if(row.status==="COMMITTED")await verifyCommitted(row,input);
    return {row,binding:input};
  }
  async function read_publication(operationId,binding){
    const r=await readRow(operationId,binding);
    return publicationResponse(r.row,r.binding);
  }
  async function publish_accepted(raw){
    check(object(raw)&&has(raw,"operationId"),
      "T3_D6_ORIGINAL_PUBLICATION_REQUEST_INVALID");
    const {operationId,...body}=raw;
    const binding=verifyBinding(body);
    const known=await readRow(operationId,binding);
    if(known.row.status==="COMMITTED")return publicationResponse(known.row,binding);
    if(known.row.status!=="UNISSUED"||attempted.has(operationId))
      return publicationResponse({...known.row,status:"OUTCOME_UNKNOWN",
        originalReceiptVerified:false},binding);
    check(!inFlight.has(operationId),
      "T3_D6_ORIGINAL_PUBLICATION_IN_PROGRESS");
    inFlight.add(operationId);
    try{
      // JIT employee rights must name the Atlas recipient. A corporate
      // organization export grant is NOT automatically transferable.
      const {c,signed}=await signedFor(binding);
      check(await originalEmployee.authorizeAtlasExport(copy(binding),copy(c))===true,
        "T3_D6_ATLAS_EXPORT_NOT_AUTHORIZED");
      const accepted=await acceptedSource.readAccepted(copy(binding));
      check(accepted?.acceptanceKind==="HUMAN_ACCEPTED_DRAFT"&&
        accepted.readOnly===true&&
        same(accepted,binding,["taskId","resultId","acceptedDigest",
          "signedTaskId","signedTaskRevisionId","signedTaskPackageSha256"])&&
        same(accepted.workRef,binding.workRef,WORK),
        "T3_D6_ORIGINAL_AGENT_ACCEPTANCE_CHANGED");
      const human=await confirmDisclosure({
        recipientId:"iwxa.atlas",operationId,workRef:copy(binding.workRef),
        taskId:binding.taskId,resultId:binding.resultId,
        acceptedDigest:binding.acceptedDigest,
      });
      check(human===true,"T3_D6_ORIGINAL_HUMAN_DISCLOSURE_REQUIRED");
      await current(binding);
      check(await originalEmployee.authorizeAtlasExport(copy(binding),copy(c))===true,
        "T3_D6_ATLAS_EXPORT_NOT_AUTHORIZED");
      const second=await acceptedSource.readAccepted(copy(binding));
      check(equal(second,accepted),"T3_D6_ORIGINAL_AGENT_ACCEPTANCE_CHANGED");
      const pre=await readRow(operationId,binding);
      if(pre.row.status!=="UNISSUED")
        return publicationResponse({...pre.row,status:"OUTCOME_UNKNOWN",
          originalReceiptVerified:false},binding);
      const command=await prepareOriginalGraph({
        operationId,binding:copy(binding),accepted:copy(accepted),
        workspace_id:c.workspace_id,
      });
      const obj=command?.object;
      const key=operationId.slice("agent:t3:atlas:".length);
      check(command?.workspace_id===c.workspace_id&&
        command.idempotency_key===key&&
        // Original T2 commitObjectGraph scopes the command by its TOP
        // LEVEL workspace_id. Its object input need not repeat that key.
        object(obj)&&
        (obj.workspace_id===undefined||obj.workspace_id===c.workspace_id)&&
        id(obj.object_id)&&id(obj.schema_id)&&id(obj.schema_version)&&
        Number.isSafeInteger(obj.base_revision)&&obj.base_revision===0&&
        object(obj.data)&&
        obj.data.taskId===binding.taskId&&
        obj.data.resultId===binding.resultId&&
        obj.data.acceptedDigest===binding.acceptedDigest&&
        obj.data.signedTaskId===binding.signedTaskId&&
        obj.data.signedTaskRevisionId===binding.signedTaskRevisionId&&
        obj.data.signedTaskPackageSha256===binding.signedTaskPackageSha256&&
        obj.data.contextDigest===binding.contextDigest&&
        same(obj.data.workRef,binding.workRef,WORK)&&
        object(command.event)&&id(command.event.event_type),
        "T3_D6_ORIGINAL_GRAPH_PROVENANCE_INVALID");
      // Reserve in the ORIGINAL durable ledger before ANY Kernel write.
      // If this reservation's ACK is lost, never dispatch or retry.
      attempted.add(operationId);
      let reserved;
      try{reserved=await originalLedger.reserve(operationId,copy(binding));}
      catch{return {status:"OUTCOME_UNKNOWN",operationId,retrySafe:false};}
      ownerRow(reserved,binding,operationId);
      if(reserved.status!=="PREPARED")
        return {status:"OUTCOME_UNKNOWN",operationId,retrySafe:false};
      // All post-reservation exceptions are outcome-unknown: Kernel may
      // have committed, or original Exchange may have exported the archive.
      try{
        const written=await signed.commitObjectGraph(command);
        const ref=refOf(written?.object);
        check(ref.workspace_id===c.workspace_id&&
          ref.object_id===obj.object_id&&
          ref.schema_id===obj.schema_id&&ref.revision===1&&
          id(written?.event?.event_id),
          "T3_D6_ORIGINAL_KERNEL_WRITE_UNVERIFIED");
        // The original Kernel receipt is only an ACK. Check the committed
        // Object/Event before asking the original Exchange to sign or export.
        const observed=await signed.getObject(ref.workspace_id,ref.object_id);
        const history=await signed.listEventsSince(ref.workspace_id);
        check(same(observed?.object,ref,REF)&&
          observed.object.deleted!==true&&observed.object.deleted_at==null&&
          observed.object.data.taskId===binding.taskId&&
          observed.object.data.resultId===binding.resultId&&
          observed.object.data.acceptedDigest===binding.acceptedDigest&&
          observed.object.data.signedTaskId===binding.signedTaskId&&
          observed.object.data.signedTaskRevisionId===binding.signedTaskRevisionId&&
          observed.object.data.signedTaskPackageSha256===binding.signedTaskPackageSha256&&
          observed.object.data.contextDigest===binding.contextDigest&&
          same(observed.object.data.workRef,binding.workRef,WORK)&&
          Array.isArray(history)&&history.filter(event=>
            event?.event_id===written.event.event_id&&
            event.idempotency_key===key&&
            event.workspace_id===ref.workspace_id&&
            event.object_id===ref.object_id&&event.revision===ref.revision
          ).length===1,
          "T3_D6_ORIGINAL_KERNEL_WRITE_UNVERIFIED");
        const exported=await originalExchange.publishSelectedResult({
          operationId,binding:copy(binding),sourceObjectRef:copy(ref),
          // The original Exchange must use the original signed .iwxa
          // and its exact recipient grant, never serialize Agent preview.
        });
        check(exported?.recipientId==="iwxa.atlas"&&
          hex(exported.archiveSha256),
          "T3_D6_ORIGINAL_EXCHANGE_EXPORT_UNVERIFIED");
        // The old organization-addressed interop.result.v2 is NOT a
        // verified Atlas transfer. Check actual stored bytes, signature and
        // recipient against the original owner BEFORE finalizing the ledger.
        const archiveProof=await originalExchange.verifySelectedResult({
          operationId,binding:copy(binding),sourceObjectRef:copy(ref),
          archiveSha256:exported.archiveSha256,
        });
        check(archiveProof?.status==="VERIFIED"&&
          archiveProof.recipientId==="iwxa.atlas"&&
          archiveProof.archiveSha256===exported.archiveSha256&&
          archiveProof.taskId===binding.taskId&&
          archiveProof.resultId===binding.resultId&&
          same(archiveProof.sourceObjectRef,ref,REF)&&
          archiveProof.originalSignatureVerified===true&&
          archiveProof.archiveBytesVerified===true&&
          archiveProof.originalManifestVerified===true&&
          archiveProof.disclosureScope==="ORIGINAL_RESULT_ONLY"&&
          same(archiveProof.selectedSourceObjectRef,ref,REF),
          "T3_D6_ORIGINAL_EXCHANGE_EXPORT_UNVERIFIED");
        await originalLedger.finalize({
          operationId,binding:copy(binding),sourceObjectRef:ref,
          archiveSha256:exported.archiveSha256,
          originalEventId:written.event.event_id,
        });
      }catch{return {status:"OUTCOME_UNKNOWN",operationId,retrySafe:false};}
      return read_publication(operationId,binding);
    }finally{inFlight.delete(operationId);}
  }
  async function verifiedByRow(row){
    check(object(row)&&object(row.binding),
      "T3_D6_ORIGINAL_LEDGER_LOOKUP_MISSING");
    const verified=await readRow(row.operationId,row.binding);
    check(verified.row.status==="COMMITTED",
      "T3_D6_ORIGINAL_PUBLISHED_SOURCE_NOT_COMMITTED");
    return verified;
  }
  function publishedFields(row,binding){
    return {status:"VERIFIED",recipientId:"iwxa.atlas",
      sourceObjectRef:refOf(row.sourceObjectRef),
      archiveSha256:row.archiveSha256,...copy(Object.fromEntries(
        ["taskId","resultId","acceptedDigest","workRef","signedTaskId",
          "signedTaskRevisionId","signedTaskPackageSha256"]
          .map(k=>[k,binding[k]])))};
  }
  async function read_published_for(workRef,accepted,originalTask){
    const row=await originalLedger.findByWork(copy(workRef),copy(accepted),
      copy(originalTask));
    const r=await verifiedByRow(row);
    check(same(r.binding.workRef,workRef,WORK)&&
      same(r.binding,accepted,["taskId","resultId","acceptedDigest",
        "signedTaskId","signedTaskRevisionId","signedTaskPackageSha256"]),
      "T3_D6_ORIGINAL_PUBLISHED_WORK_MISMATCH");
    return publishedFields(r.row,r.binding);
  }
  async function read_published(reference){
    const ref=refOf(reference);
    const r=await verifiedByRow(await originalLedger.findByObject(copy(ref)));
    check(same(r.row.sourceObjectRef,ref,REF),
      "T3_D6_ORIGINAL_PUBLISHED_REF_MISMATCH");
    return publishedFields(r.row,r.binding);
  }
  async function read_receipt(sourceObjectRef,taskId,resultId,archiveSha256,
    recipientId){
    check(recipientId==="iwxa.atlas"&&hex(archiveSha256),
      "T3_D6_ORIGINAL_EXCHANGE_REQUEST_INVALID");
    const ref=refOf(sourceObjectRef);
    const r=await verifiedByRow(await originalLedger.findByObject(copy(ref)));
    check(same(r.row.sourceObjectRef,ref,REF)&&
      r.binding.taskId===taskId&&r.binding.resultId===resultId&&
      r.row.archiveSha256===archiveSha256,
      "T3_D6_ORIGINAL_EXCHANGE_RECEIPT_MISMATCH");
    // Return an ORIGINAL signed Exchange attestation, not a synthetic
    // VERIFIED flag manufactured by this public wrapper.
    const original=await originalExchange.verifySelectedResult({
      operationId:r.row.operationId,binding:copy(r.binding),
      sourceObjectRef:copy(ref),archiveSha256,
    });
    check(original?.status==="VERIFIED"&&
      original.recipientId==="iwxa.atlas"&&
      original.archiveSha256===archiveSha256&&
      original.taskId===taskId&&original.resultId===resultId&&
      same(original.sourceObjectRef,ref,REF)&&
      same(original.selectedSourceObjectRef,ref,REF)&&
      original.originalSignatureVerified===true&&
      original.archiveBytesVerified===true&&
      original.originalManifestVerified===true&&
      original.disclosureScope==="ORIGINAL_RESULT_ONLY",
      "T3_D6_ORIGINAL_EXCHANGE_RECEIPT_UNVERIFIED");
    return Object.freeze({status:"VERIFIED",recipientId:"iwxa.atlas",
      taskId,resultId,archiveSha256,
      selectedSourceObjectRef:refOf(ref),
      originalSignatureVerified:true,archiveBytesVerified:true,
      originalManifestVerified:true,disclosureScope:"ORIGINAL_RESULT_ONLY"});
  }
  async function read_latest_for_work(projectId,workId){
    check(id(projectId)&&id(workId),
      "T3_D6_ORIGINAL_WORK_REQUEST_INVALID");
    const r=await verifiedByRow(
      await originalLedger.findLatestWork(projectId,workId));
    check(r.binding.workRef.projectId===projectId&&
      r.binding.workRef.workId===workId,
      "T3_D6_ORIGINAL_WORK_LOOKUP_MISMATCH");
    return {status:"VERIFIED_ORIGINAL_WORK",
      revision:r.binding.workRef.revision};
  }
  return Object.freeze({read_publication,publish_accepted,
    read_published_for,read_published,read_receipt,read_latest_for_work});
}
