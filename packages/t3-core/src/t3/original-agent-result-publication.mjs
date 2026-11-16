// Original installed T3 Host only. An accepted Agent Result is published via
// the inherited T2 Kernel Object/Event and the EXISTING signed Exchange owner.
// No independent signer, Task Engine, Store, journal, .iwxa writer or HTTP API.
import {createHash} from "node:crypto";
import {createSubjectKernelBinding} from "./subject-access-binding.mjs";

export const ORIGINAL_AGENT_RESULT_SCHEMA="iwxa.t3.agent.accepted-result";
export const ORIGINAL_AGENT_RESULT_EVENT="t3.agent.accepted_result.persisted";
export const ORIGINAL_AGENT_PUBLICATION="IWXA_AGENT_T3_ORIGINAL_ATLAS_PUBLICATION/1";
// Register in the existing T2 service passport; no second schema registry.
export const ORIGINAL_AGENT_RESULT_DECLARATION=Object.freeze({
  schema_version:"1.0.0",preserve_unknown:false,
  json_schema:{
    type:"object",additionalProperties:false,
    required:["schema","operationId","binding","acceptedText","resultTextSha256"],
    properties:{
      schema:{type:"string",const:ORIGINAL_AGENT_PUBLICATION},
      operationId:{type:"string",minLength:1,maxLength:160},
      binding:{type:"object"},
      acceptedText:{type:"string",minLength:1,maxLength:2000000},
      resultTextSha256:{type:"string",pattern:"^[a-f0-9]{64}$"},
    },
  },embedded:{},
});

const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const HASH=/^[a-f0-9]{64}$/;
const KEYS=["schema","recipientId","signedTaskId","signedTaskRevisionId",
  "signedTaskPackageSha256","taskId","resultId","acceptedDigest","workRef",
  "contextDigest"];
const WKEYS=["projectId","workId","revision"];
function deny(code){
  throw Object.assign(new Error(code),{code,outcome:"DENIED"});
}
function check(value,code){if(!value)deny(code);}
function object(value){return value!==null&&typeof value==="object"&&!Array.isArray(value);}
function canonical(value){
  if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
  if(object(value))return "{"+Object.keys(value).sort().map(k=>
    JSON.stringify(k)+":"+canonical(value[k])).join(",")+"}";
  return JSON.stringify(value);
}
function hash(bytes){return createHash("sha256").update(bytes).digest("hex");}
function same(a,b){return canonical(a)===canonical(b);}
function boundBody(value){
  check(object(value)&&Object.keys(value).sort().join()===KEYS.slice().sort().join(),
    "T3_AGENT_PUBLICATION_BINDING_INVALID");
  const work=value.workRef;
  check(object(work)&&Object.keys(work).sort().join()===WKEYS.slice().sort().join()&&
    ID.test(work.projectId??"")&&ID.test(work.workId??"")&&
    typeof work.revision==="string"&&/^(0|[1-9][0-9]*)$/.test(work.revision)&&
    Number.isSafeInteger(Number(work.revision)),
    "T3_AGENT_PUBLICATION_WORK_REF_INVALID");
  check(value.schema===ORIGINAL_AGENT_PUBLICATION&&
    value.recipientId==="iwxa.atlas"&&
    [value.signedTaskId,value.signedTaskRevisionId,value.taskId,value.resultId]
      .every(x=>ID.test(x??""))&&
    [value.signedTaskPackageSha256,value.acceptedDigest,value.contextDigest]
      .every(x=>HASH.test(x??"")),
    "T3_AGENT_PUBLICATION_BINDING_INVALID");
  return structuredClone(value);
}
function operation(body){
  return "agent:t3:atlas:"+hash(Buffer.from(canonical(body),"utf8"));
}
function sourceRef(workspaceId,operationId){
  return Object.freeze({workspace_id:workspaceId,
    object_id:"agent-result:"+hash(Buffer.from(operationId,"utf8")),
    schema_id:ORIGINAL_AGENT_RESULT_SCHEMA,revision:1});
}
function status(body,operationId,state,extra={}){
  return Object.freeze({status:state,operationId,
    recipientId:"iwxa.atlas",retrySafe:false,...structuredClone(body),...extra});
}
function verifyOriginalReceipt(receipt,ref,body,operationId){
  if(!object(receipt))return false;
  return receipt.status==="VERIFIED"&&
    receipt.originalSignatureVerified===true&&
    receipt.originalKernelReadbackVerified===true&&
    receipt.operationId===operationId&&
    same(receipt.sourceObjectRef,ref)&&
    receipt.recipientId==="iwxa.atlas"&&
    receipt.taskId===body.taskId&&
    receipt.resultId===body.resultId&&
    receipt.acceptedDigest===body.acceptedDigest&&
    same(receipt.workRef,body.workRef)&&
    receipt.signedTaskId===body.signedTaskId&&
    receipt.signedTaskRevisionId===body.signedTaskRevisionId&&
    receipt.signedTaskPackageSha256===body.signedTaskPackageSha256&&
    HASH.test(receipt.archiveSha256??"");
}

/**
 * The installed original T3 Host injects its actual T2 KernelFacade,
 * its selected D1 signed owner for each Kernel operation, the original Agent
 * Core accepted source, and its existing signed Exchange publisher/receipt.
 * Never construct these ports from UI-supplied JSON.
 *
 * This publication Workspace must be provisioned and authorized by the
 * original issuer as an isolated Workspace for ONE accepted Result. Ordinary
 * T2 exportPackage cannot safely select one object out of a mixed Workspace.
 * The original T2 service passport must declare ORIGINAL_AGENT_RESULT_SCHEMA.
 */
export function createTrustedOriginalAgentResultPublication({
  kernel,publicationWorkspaceId,accessForOperation,acceptedSource,
  originalExchange,authorizeRecipient,confirmHumanDisclosure,
  isHostActive,
}={}){
  check(ID.test(publicationWorkspaceId??"")&&
    kernel?.sessionInfo?.contract_version==="1.3.0"&&
    ["t1.getObject","t1.listObjects","t1.listEventsSince","t1.putObject",
      "t2.exportPreview","t2.exportPackage"].every(op=>kernel.hasOperation?.(op))&&
    typeof accessForOperation==="function"&&
    typeof acceptedSource?.readAcceptedContent==="function"&&
    typeof acceptedSource?.currentOriginalContext==="function"&&
    typeof originalExchange?.publishSignedFromOriginal==="function"&&
    typeof originalExchange?.readVerifiedReceipt==="function"&&
    typeof authorizeRecipient==="function"&&
    typeof confirmHumanDisclosure==="function"&&
    typeof isHostActive==="function",
    "T3_AGENT_ORIGINAL_INSTALLED_OWNER_REQUIRED");
  const attempted=new Set(),inFlight=new Set();
  const live=()=>check(isHostActive()===true,"T3_AGENT_ORIGINAL_HOST_DISPOSED");
  async function signed(op){
    live();
    const access=await accessForOperation(op,publicationWorkspaceId);
    live();
    check(access&&typeof access.currentContext==="function",
      "T3_AGENT_ORIGINAL_SIGNED_ACCESS_REQUIRED");
    const context=await access.currentContext();
    check(context?.workspace_id===publicationWorkspaceId&&
      context.resource===publicationWorkspaceId,
      "T3_AGENT_ORIGINAL_SIGNED_WORKSPACE_CHANGED");
    return createSubjectKernelBinding({kernel,access,isHostActive});
  }
  async function kernelRead(operationId,body){
    const ref=sourceRef(publicationWorkspaceId,operationId);
    const reader=await signed("t1.getObject");
    const saved=await reader.getObject(ref.workspace_id,ref.object_id);
    const events=await reader.listEventsSince(ref.workspace_id);
    live();
    const matching=events.filter(e=>e.event_type===ORIGINAL_AGENT_RESULT_EVENT&&
      e.object_id===ref.object_id);
    if(saved===null){
      // A complete original Kernel Object/Event absence is the only evidence
      // admitted before first dispatch; a plain 404 is never sufficient.
      if(matching.length) return {ref,state:"OUTCOME_UNKNOWN"};
      return {ref,state:"UNISSUED"};
    }
    const record=saved?.object;
    check(record?.schema_id===ref.schema_id&&record.revision===1&&
      record.deleted!==true&&record.deleted_at==null&&
      record.workspace_id===ref.workspace_id&&record.object_id===ref.object_id&&
      record.data?.schema===ORIGINAL_AGENT_PUBLICATION&&
      record.data?.operationId===operationId&&
      same(record.data?.binding,body)&&
      typeof record.data?.acceptedText==="string"&&
      HASH.test(record.data?.resultTextSha256??"")&&
      hash(Buffer.from(record.data.acceptedText,"utf8"))===record.data.resultTextSha256,
      "T3_AGENT_ORIGINAL_KERNEL_RESULT_CHANGED");
    check(matching.length===1&&matching[0].revision===1&&
      matching[0].payload?.operationId===operationId&&
      matching[0].payload?.bindingDigest===hash(Buffer.from(canonical(body))),
      "T3_AGENT_ORIGINAL_KERNEL_EVENT_CHANGED");
    return {ref,state:"PERSISTED"};
  }
  async function readPublication(operationId,input){
    const body=boundBody(input);
    check(operationId===operation(body),"T3_AGENT_ORIGINAL_OPERATION_BINDING_INVALID");
    const {ref,state}=await kernelRead(operationId,body);
    if(state==="UNISSUED"){
      // The original Kernel's complete scoped event history is the durable
      // absence proof; the same Object ID is CAS-protected with base_revision=0.
      return status(body,operationId,"UNISSUED",{
        originalLedgerVerified:true,noPriorDispatchVerified:true,
        originalReceiptVerified:false});
    }
    if(state!=="PERSISTED")
      return status(body,operationId,"OUTCOME_UNKNOWN",{originalReceiptVerified:false});
    let receipt;
    try{
      receipt=await originalExchange.readVerifiedReceipt({
        operationId,recipientId:"iwxa.atlas",sourceObjectRef:ref,
        binding:structuredClone(body),
      });
    }catch(e){
      if(e?.outcome==="DENIED")throw e;
      return status(body,operationId,"OUTCOME_UNKNOWN",{originalReceiptVerified:false});
    }
    live();
    if(verifyOriginalReceipt(receipt,ref,body,operationId))
      return status(body,operationId,"COMMITTED",{
        originalReceiptVerified:true,sourceObjectRef:ref,
        archiveSha256:receipt.archiveSha256});
    if(receipt?.status==="NOT_FOUND_CONFIRMED"&&
      receipt.operationId===operationId&&
      receipt.recipientId==="iwxa.atlas"&&
      receipt.originalLedgerVerified===true)
      return status(body,operationId,"PREPARED",{originalReceiptVerified:false});
    return status(body,operationId,"OUTCOME_UNKNOWN",{originalReceiptVerified:false});
  }
  async function publishAccepted(input){
    const {operationId,...rawBody}=input??{};
    const body=boundBody(rawBody);
    check(operationId===operation(body),"T3_AGENT_ORIGINAL_OPERATION_BINDING_INVALID");
    if(inFlight.has(operationId))
      return status(body,operationId,"OUTCOME_UNKNOWN",{originalReceiptVerified:false});
    inFlight.add(operationId);
    try{
      const prior=await readPublication(operationId,body);
      if(prior.status==="COMMITTED")return prior;
      if(prior.status!=="UNISSUED"||attempted.has(operationId))
        return status(body,operationId,"OUTCOME_UNKNOWN",{originalReceiptVerified:false});
      // The accepted content is independently read from the real installed
      // Agent Core, never from an Archive, UI, Atlas or caller-authored text.
      const accepted=await acceptedSource.readAcceptedContent(structuredClone(body));
      live();
      check(accepted?.status==="HUMAN_ACCEPTED_DRAFT"&&
        accepted.readOnly===true&&accepted.acceptedDigest===body.acceptedDigest&&
        accepted.taskId===body.taskId&&accepted.resultId===body.resultId&&
        same(accepted.workRef,body.workRef)&&
        accepted.signedTaskId===body.signedTaskId&&
        accepted.signedTaskRevisionId===body.signedTaskRevisionId&&
        accepted.signedTaskPackageSha256===body.signedTaskPackageSha256&&
        typeof accepted.resultText==="string"&&
        accepted.resultText.length>0&&accepted.resultText.length<=2000000&&
        hash(Buffer.from(accepted.resultText,"utf8"))===
          accepted.resultTextSha256,
        "T3_AGENT_ORIGINAL_ACCEPTED_RESULT_UNVERIFIED");
      const grant=await authorizeRecipient({
        operationId,recipientId:"iwxa.atlas",
        workspaceId:publicationWorkspaceId,action:"package.export",
        binding:structuredClone(body),
      });
      live();
      check(grant?.allowed===true&&grant.rightClass==="DATA"&&
        grant.action==="package.export"&&
        grant.operationId===operationId&&
        grant.recipientId==="iwxa.atlas"&&
        grant.workspaceId===publicationWorkspaceId,
        "T3_AGENT_ORIGINAL_ATLAS_EXPORT_NOT_AUTHORIZED");
      const consent=await confirmHumanDisclosure({
        operationId,recipientId:"iwxa.atlas",
        taskId:body.taskId,resultId:body.resultId,
        acceptedDigest:body.acceptedDigest,workRef:structuredClone(body.workRef),
      });
      live();
      if(consent!==true)return status(body,operationId,"USER_CANCELLED",{
        originalReceiptVerified:false});
      if((await readPublication(operationId,body)).status!=="UNISSUED")
        return status(body,operationId,"OUTCOME_UNKNOWN",{originalReceiptVerified:false});
      const ref=sourceRef(publicationWorkspaceId,operationId);
      const writer=await signed("t1.putObject");
      attempted.add(operationId); // Before ANY native write or lost ACK.
      try{
        await writer.putObject({
          workspace_id:ref.workspace_id,object_id:ref.object_id,
          base_revision:0,schema_id:ORIGINAL_AGENT_RESULT_SCHEMA,
          schema_version:"1.0.0",
          data:{schema:ORIGINAL_AGENT_PUBLICATION,
            operationId,binding:structuredClone(body),
            acceptedText:accepted.resultText,
            resultTextSha256:accepted.resultTextSha256},
          extensions:{},
          event:{event_type:ORIGINAL_AGENT_RESULT_EVENT,payload:{
            operationId,bindingDigest:hash(Buffer.from(canonical(body))) }},
        });
      }catch(error){
        if(error?.outcome==="DENIED")throw error;
        return status(body,operationId,"OUTCOME_UNKNOWN",{originalReceiptVerified:false});
      }
      // The original Kernel is the ONLY persistent source. The original
      // Exchange must sign and record its independently recoverable receipt.
      const state=await kernelRead(operationId,body);
      if(state.state!=="PERSISTED")
        return status(body,operationId,"OUTCOME_UNKNOWN",{originalReceiptVerified:false});
      // A service-level export preview may silently exclude protected
      // objects. Check the whole ORIGINAL Kernel Workspace before export:
      // no unrelated result, task, document or asset may be disclosed.
      const allObjects=await (await signed("t1.listObjects")).listObjects({
        workspace_id:publicationWorkspaceId});
      check(allObjects.length===1&&
        allObjects[0].object_id===ref.object_id&&
        allObjects[0].schema_id===ORIGINAL_AGENT_RESULT_SCHEMA&&
        allObjects[0].revision===1,
        "T3_AGENT_ORIGINAL_EXPORT_WORKSPACE_NOT_ISOLATED");
      const exporter=await signed("t2.exportPackage");
      // T2 export is WORKSPACE/SCHEMA scoped, not a single-object picker.
      // This dedicated Workspace must contain precisely one accepted Result;
      // history, assets and relations are explicitly excluded from disclosure.
      const options={workspaces:[publicationWorkspaceId],
        include_history:false,include_assets:false,include_relations:false,
        include_schemas:true};
      const preview=await exporter.exportPreview(options);
      check(preview?.counts?.objects===1&&
        preview.counts.events===0&&preview.counts.assets===0&&
        preview.counts.relations===0&&
        Array.isArray(preview.workspaces)&&preview.workspaces.length===1&&
        preview.workspaces[0]===publicationWorkspaceId,
        "T3_AGENT_ORIGINAL_EXPORT_ISOLATION_REQUIRED");
      const artifact=await exporter.exportPackage(options);
      check(artifact?.validation?.ok===true&&
        typeof artifact.filename==="string"&&
        artifact.filename.endsWith(".iwxa")&&
        artifact.bytes instanceof Uint8Array&&
        artifact.manifest?.workspaces?.length===1&&
        artifact.manifest.workspaces[0]===publicationWorkspaceId&&
        artifact.manifest.counts?.objects===1&&
        artifact.manifest.counts?.events===0&&
        artifact.manifest.counts?.assets===0&&
        artifact.manifest.counts?.relations===0&&
        artifact.package_digest===artifact.manifest.package_digest,
        "T3_AGENT_ORIGINAL_IWXA_EXPORT_INVALID");
      const archiveSha256=hash(artifact.bytes);
      try{
        await originalExchange.publishSignedFromOriginal({
          operationId,recipientId:"iwxa.atlas",sourceObjectRef:ref,
          binding:structuredClone(body),archiveBytes:artifact.bytes,
          archiveSha256,packageDigest:artifact.package_digest,
        });
      }catch(error){
        if(error?.outcome==="DENIED")throw error;
        return status(body,operationId,"OUTCOME_UNKNOWN",{originalReceiptVerified:false});
      }
      // Bare success from signer/transport is insufficient. Read back the
      // original signed Exchange receipt and source Kernel after dispatch.
      const readback=await readPublication(operationId,body);
      check(readback.status!=="COMMITTED"||
        readback.archiveSha256===archiveSha256,
        "T3_AGENT_ORIGINAL_ARCHIVE_RECEIPT_CHANGED");
      return readback;
    }finally{inFlight.delete(operationId);}
  }
  async function readPublished(ref){
    check(object(ref)&&ref.workspace_id===publicationWorkspaceId&&
      ref.schema_id===ORIGINAL_AGENT_RESULT_SCHEMA&&ref.revision===1&&
      ID.test(ref.object_id??""),"T3_AGENT_ORIGINAL_SOURCE_REF_INVALID");
    const r=await (await signed("t1.getObject")).getObject(ref.workspace_id,ref.object_id);
    check(r?.object?.data?.schema===ORIGINAL_AGENT_PUBLICATION,
      "T3_AGENT_ORIGINAL_SOURCE_NOT_FOUND");
    const body=boundBody(r.object.data.binding),operationId=r.object.data.operationId;
    check(same(ref,sourceRef(publicationWorkspaceId,operationId)),
      "T3_AGENT_ORIGINAL_SOURCE_REF_CHANGED");
    const state=await readPublication(operationId,body);
    check(state.status==="COMMITTED","T3_AGENT_ORIGINAL_SOURCE_NOT_VERIFIED");
    return Object.freeze({status:"VERIFIED",recipientId:"iwxa.atlas",
      sourceObjectRef:sourceRef(publicationWorkspaceId,operationId),
      archiveSha256:state.archiveSha256,...structuredClone(body)});
  }
  async function readPublishedFor(workRef,accepted,originalTask){
    // A trusted Agent Core provides its current signed context and acceptance.
    // A browser cannot select an alternate contextDigest or operation ID.
    check(object(workRef)&&object(accepted)&&object(originalTask),
      "T3_AGENT_ORIGINAL_SELECTION_INVALID");
    const context=await acceptedSource.currentOriginalContext();
    const body=boundBody({
      schema:ORIGINAL_AGENT_PUBLICATION,recipientId:"iwxa.atlas",
      signedTaskId:accepted.signedTaskId,
      signedTaskRevisionId:accepted.signedTaskRevisionId,
      signedTaskPackageSha256:accepted.signedTaskPackageSha256,
      taskId:accepted.taskId,resultId:accepted.resultId,
      acceptedDigest:accepted.acceptedDigest,workRef,
      contextDigest:context?.contextDigest,
    });
    check(body.signedTaskId===originalTask.taskId&&
      body.signedTaskRevisionId===originalTask.taskRevisionId&&
      body.signedTaskPackageSha256===originalTask.packageSha256,
      "T3_AGENT_ORIGINAL_SIGNED_TASK_CHANGED");
    const result=await readPublication(operation(body),body);
    check(result.status==="COMMITTED","T3_AGENT_ORIGINAL_PUBLICATION_NOT_VERIFIED");
    return readPublished(result.sourceObjectRef);
  }
  async function readReceipt(ref,taskId,resultId,archiveSha256,recipientId){
    check(recipientId==="iwxa.atlas"&&HASH.test(archiveSha256??""),
      "T3_AGENT_ORIGINAL_RECEIPT_BINDING_INVALID");
    const row=await readPublished(ref);
    check(row.taskId===taskId&&row.resultId===resultId&&
      row.archiveSha256===archiveSha256,
      "T3_AGENT_ORIGINAL_RECEIPT_BINDING_CHANGED");
    const body=boundBody(Object.fromEntries(KEYS.map(k=>[k,row[k]])));
    const operationId=operation(body);
    const original=await originalExchange.readVerifiedReceipt({
      operationId,recipientId,sourceObjectRef:row.sourceObjectRef,
      binding:body,
    });
    check(verifyOriginalReceipt(original,row.sourceObjectRef,body,operationId),
      "T3_AGENT_ORIGINAL_EXCHANGE_RECEIPT_UNVERIFIED");
    return original;
  }
  async function readLatestForWork(projectId,workId){
    check(ID.test(projectId??"")&&ID.test(workId??""),
      "T3_AGENT_ORIGINAL_WORK_REF_INVALID");
    const rows=await (await signed("t1.listObjects")).listObjects({
      workspace_id:publicationWorkspaceId,schema_id:ORIGINAL_AGENT_RESULT_SCHEMA});
    // This ONE-publication Workspace is never silently advanced to another
    // Task/Work revision; cold recovery is exact and recipient-owned.
    check(rows.length<=1,"T3_AGENT_ORIGINAL_WORK_SOURCE_AMBIGUOUS");
    const row=rows[0];
    if(!row||row.data?.binding?.workRef?.projectId!==projectId||
      row.data?.binding?.workRef?.workId!==workId)
      return {status:"UNKNOWN_ORIGINAL_WORK"};
    await readPublished({workspace_id:publicationWorkspaceId,object_id:row.object_id,
      schema_id:row.schema_id,revision:row.revision});
    return {status:"VERIFIED_ORIGINAL_WORK",revision:row.data.binding.workRef.revision};
  }
  // snake_case is the exact existing Agent 0.6 original_t3_source_owner port.
  return Object.freeze({
    read_publication:readPublication,publish_accepted:publishAccepted,
    read_published_for:readPublishedFor,read_published:readPublished,
    read_receipt:readReceipt,read_latest_for_work:readLatestForWork,
  });
}
