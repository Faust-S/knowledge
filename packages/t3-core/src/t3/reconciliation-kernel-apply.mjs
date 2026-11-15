// D3 recipient Host continuation into the ORIGINAL T2 Kernel.
// The original private Reconciliation application-host binding and the domain
// owner must prepare the staged effect and graph. No second Apply engine,
// object schema, Store, issuer, authorization evaluator or review UI lives here.
import {createSubjectKernelBinding} from "./subject-access-binding.mjs";
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const HEX=/^[a-f0-9]{64}$/;
const id=x=>typeof x==="string"&&ID.test(x);
const hex=x=>typeof x==="string"&&HEX.test(x);
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
function deny(code){
  throw Object.assign(new Error(code),{code,outcome:"DENIED"});
}
function check(ok,code){if(!ok)deny(code);}
function copy(value,code){
  try{return structuredClone(value);}
  catch{deny(code);}
}
// Exact target keys required by the original historical application-host
// binding; a workspace alias alone is not a complete recipient scope.
const TARGET_FIELDS=["consumerId","processId","processVersion","purpose",
  "subjectId","workspaceId","dataRootId"];
const identity=c=>JSON.stringify(["kind","context_id","actor_id","principal_id",
  "role_id","grant_id","organization_id","workspace_id","resource",
  "realm_id","audience","purpose","scope_revision"]
  .map(field=>c?.[field]));

export function createTrustedReconciliationKernelApply({
  admission,kernel,access,stageFromOriginalOwner,
  confirmSeparateApply,isHostActive,
}={}){
  check(admission&&typeof admission.inspectAcceptedApplication==="function"&&
    typeof stageFromOriginalOwner==="function"&&
    typeof confirmSeparateApply==="function"&&
    typeof isHostActive==="function",
    "T3_D3_TRUSTED_APPLICATION_HOST_REQUIRED");
  // Always enforce the EXISTING D1 signed Access owner on BOTH original
  // Kernel commitObjectGraph and getObject. Accepting a caller-supplied
  // "signedKernel" object here would permit an accidental raw-Kernel bypass.
  async function selected(){
    check(isHostActive()===true,"T3_HOST_DISPOSED");
    const c=copy(await access.currentContext(),"T3_D3_APPLY_CONTEXT_INVALID");
    // Historical original application-host binding is a corporate product
    // operation; PERSONAL never silently borrows a corporate issuer.
    check(obj(c)&&c.kind==="CORP"&&
      ["context_id","actor_id","principal_id","role_id","grant_id",
        "organization_id","workspace_id","resource","realm_id","audience",
        "purpose"].every(k=>id(c[k]))&&
      c.resource===c.workspace_id&&c.principal_id===c.organization_id&&
      Number.isSafeInteger(c.scope_revision)&&c.scope_revision>0,
      "T3_D3_ORIGINAL_CORPORATE_CONTEXT_REQUIRED");
    return c;
  }
  async function unchanged(c){
    check(identity(await selected())===identity(c),"T3_D3_APPLY_CONTEXT_CHANGED");
  }
  // Read and validate the ORIGINAL accepted selection and sealed effect once.
  // Recovery and first Apply share precisely the same source/recipient binding.
  async function stagedSelection({acceptanceId,revisionIds,target}={}){
    check(hex(acceptanceId)&&Array.isArray(revisionIds)&&revisionIds.length>0&&
      revisionIds.length<=32&&revisionIds.every(hex)&&
      new Set(revisionIds).size===revisionIds.length&&obj(target),
      "T3_D3_APPLICATION_SELECTION_REQUIRED");
    const c=await selected(),chosen=copy(target,"T3_D3_APPLICATION_TARGET_INVALID");
    check(chosen.workspaceId===c.workspace_id&&chosen.subjectId===c.organization_id,
      "T3_D3_APPLY_TARGET_OUT_OF_SCOPE");
    check(TARGET_FIELDS.every(field=>id(chosen[field])),
      "T3_D3_ORIGINAL_APPLICATION_TARGET_INCOMPLETE");
    // This is the original recipient Reconciliation currentness projection.
    // It is a CANDIDATE, never evidence that ACCEPT has performed a write.
    const candidate=await admission.inspectAcceptedApplication({
      acceptanceId,revisionIds:[...revisionIds],target:chosen,
    });
    await unchanged(c);
    // The private original owner returns its OWN sealed Host binding and the
    // domain owner maps only its accepted material to an original T2 command.
    const prepared=await stageFromOriginalOwner({
      acceptanceId,revisionIds:[...revisionIds],target:copy(chosen,"T3_D3_APPLICATION_TARGET_INVALID"),
      candidate:copy(candidate,"T3_D3_APPLICATION_CANDIDATE_INVALID"),
      context:copy(c,"T3_D3_APPLY_CONTEXT_INVALID"),
    });
    const binding=prepared?.binding,ctx=prepared?.authorizationContext;
    check(binding?.schema==="IWXA_T3_APPLICATION_HOST_BINDING/1"&&
      hex(binding.effectKey)&&binding.operation?.operationId==="effect:"+binding.effectKey&&
      hex(binding.operation.payloadDigest)&&
      binding.operation.resource===c.workspace_id&&
      binding.operation.audience===c.audience&&
      binding.operation.purpose===chosen.purpose&&
      id(binding.operation.action)&&
      ["IWXA_ADMIN_CENTER","IWXA_CONTROL_CENTER"].includes(binding.operation.productId)&&
      Number.isSafeInteger(binding.expectedRevision)&&binding.expectedRevision>=0&&
      binding.applicationAuthorized===false&&binding.writeAllowed===false&&
      binding.hostJitRequired===true&&binding.explicitHumanDecisionRequired===true&&
      binding.decisionCheckAtCommit===true&&
      binding.externalContextCoreApplied===false&&
      typeof binding.commitPrecondition==="function"&&
      obj(ctx)&&ctx.operationId===binding.operation.operationId&&
      ctx.payloadDigest===binding.operation.payloadDigest&&
      ctx.organizationId===c.organization_id&&ctx.workspaceId===c.workspace_id&&
      ctx.dataRootId===chosen.dataRootId&&hex(ctx.storageScopeDigest)&&
      ctx.expectedRevision===binding.expectedRevision&&
      ctx.actorId===c.actor_id&&ctx.principalId===c.principal_id&&
      ctx.roleId===c.role_id&&ctx.grantId===c.grant_id&&hex(ctx.operationDigest),
      "T3_D3_ORIGINAL_SEALED_APPLICATION_REQUIRED");
    const command=copy(prepared.command,"T3_D3_GRAPH_COMMAND_NOT_CLONEABLE");
    const objInput=command?.object,payload=command?.event?.payload;
    check(command?.workspace_id===c.workspace_id&&
      command.idempotency_key===binding.effectKey&&
      obj(objInput)&&id(objInput.object_id)&&id(objInput.schema_id)&&
      id(objInput.schema_version)&&
      Number.isSafeInteger(objInput.base_revision)&&objInput.base_revision>=0&&
      obj(payload)&&payload.reconciliation_acceptance_id===acceptanceId&&
      Array.isArray(payload.reconciliation_revision_ids)&&
      JSON.stringify([...payload.reconciliation_revision_ids].sort())===
        JSON.stringify([...revisionIds].sort()),
      "T3_D3_ORIGINAL_GRAPH_PROVENANCE_REQUIRED");
    return {acceptanceId,revisionIds:[...revisionIds],c,chosen,
      binding,ctx,command,objInput,payload};
  }
  // Original Kernel and Reconciliation own durable state. These Host-lifetime
  // guards prevent concurrent direct callers and another dispatch of an
  // already-entered original graph write. Recovery stays strictly read-only.
  const appliesInFlight=new Set(),appliesDispatched=new Set();
  async function applyAccepted(input={}) {
    const prepared=await stagedSelection(input);
    const effectKey=prepared.binding.effectKey;
    check(!appliesInFlight.has(effectKey),"T3_D3_APPLY_IN_PROGRESS");
    check(!appliesDispatched.has(effectKey),
      "T3_D3_APPLY_ALREADY_DISPATCHED_USE_RECOVERY");
    appliesInFlight.add(effectKey);
    try{return await applyStaged(prepared);}
    finally{appliesInFlight.delete(effectKey);}
  }
  async function applyStaged({
    acceptanceId,revisionIds,c,chosen,binding,ctx,command,objInput,
  }) {
    check(kernel.hasOperation("t1.commitObjectGraph")&&
      kernel.hasOperation("t1.getWorkspace")&&
      kernel.hasOperation("t1.getObject")&&
      kernel.hasOperation("t1.listEventsSince"),
      "T3_D3_ORIGINAL_KERNEL_GRANT_REQUIRED");
    // D1 signed authorization is asynchronous. Revocation of the Host or
    // Reconciliation source during JIT must prevent original writes.
    // Distinguish definite pre-dispatch denials from lost post-write ACKs.
    let kernelWriteEntered=false;
    const signedKernel=createSubjectKernelBinding({
      kernel,access,isHostActive,
      commitObjectGraphPrecondition:()=>binding.commitPrecondition(ctx),
      onCommitObjectGraphDispatch:()=>{
        kernelWriteEntered=true;
        appliesDispatched.add(binding.effectKey);
      },
    });
    // The original T2 graph cannot create its destination Workspace.
    // Check it BEFORE consuming the separate Human APPLY decision. On a
    // fresh install, a missing Workspace must prompt its independent
    // signed creation, not consume a decision or issue a graph write.
    let workspace;
    try { workspace=await signedKernel.getWorkspace(c.workspace_id); }
    catch(error){
      if(error?.code==="WORKSPACE_NOT_FOUND")
        deny("T3_D3_ORIGINAL_WORKSPACE_PROVISION_REQUIRED");
      throw error; // Revocation/permission denial is not missing storage.
    }
    check(workspace!==null,"T3_D3_ORIGINAL_WORKSPACE_PROVISION_REQUIRED");
    check(!workspace.deleted_at,"T3_D3_ORIGINAL_WORKSPACE_DELETED");
    check(workspace.read_only!==true,"T3_D3_ORIGINAL_WORKSPACE_READ_ONLY");
    // On a new Host the volatile no-replay guard is empty. Consult the
    // ORIGINAL durable Kernel Event history BEFORE asking for Human APPLY.
    // A previous effect with this sealed idempotency key must be recovered,
    // not submitted again. An unavailable history cannot be treated as empty.
    const history=await signedKernel.listEventsSince(c.workspace_id);
    check(Array.isArray(history),"T3_D3_ORIGINAL_EVENT_HISTORY_UNAVAILABLE");
    check(!history.some(event=>event?.idempotency_key===binding.effectKey),
      "T3_D3_ORIGINAL_EFFECT_ALREADY_RECORDED_USE_RECOVERY");
    await unchanged(c);
    // Independent, explicit APPLY approval is NOT the preceding ACCEPT.
    // Read-only preflight cannot authorize the original Kernel graph write.
    const approval=await confirmSeparateApply({
      acceptanceId,revisionIds:[...revisionIds],target:copy(chosen,"T3_D3_APPLICATION_TARGET_INVALID"),
      effectKey:binding.effectKey,operation:copy(binding.operation,"T3_D3_OPERATION_NOT_CLONEABLE"),
      context:copy(c,"T3_D3_APPLY_CONTEXT_INVALID"),
    });
    check(approval===true,"T3_D3_SEPARATE_HUMAN_APPLY_REQUIRED");
    await unchanged(c);
    let receipt;
    try {
      receipt=await signedKernel.commitObjectGraph(command);
      // A commit receipt alone is not an independent Event readback.
      // Verify BOTH original T2 Object and Event under fresh signed D1 JIT.
      // Anything missing AFTER dispatch is UNKNOWN, never permission to
      // issue the same commitObjectGraph again.
      const read=await signedKernel.getObject(c.workspace_id,objInput.object_id);
      const events=await signedKernel.listEventsSince(c.workspace_id);
      const expectedRevision=objInput.base_revision+1;
      const sameRevisions=values=>Array.isArray(values)&&
        values.length===revisionIds.length&&values.every(hex)&&
        JSON.stringify([...values].sort())===
          JSON.stringify([...revisionIds].sort());
      const sameEvent=event=>event?.workspace_id===c.workspace_id&&
        id(event.event_id)&&event.event_type===command.event.event_type&&
        event.idempotency_key===binding.effectKey&&
        (event.object_id==null||event.object_id===objInput.object_id)&&
        (event.revision==null||event.revision===expectedRevision)&&
        obj(event.payload)&&
        event.payload.reconciliation_acceptance_id===acceptanceId&&
        sameRevisions(event.payload.reconciliation_revision_ids);
      const verifiedEvents=Array.isArray(events)?
        events.filter(sameEvent):[];
      check(receipt?.workspace_id===c.workspace_id&&
        receipt.object?.workspace_id===c.workspace_id&&
        receipt.object?.object_id===objInput.object_id&&
        receipt.object.revision===expectedRevision&&
        receipt.object.schema_id===objInput.schema_id&&
        sameEvent(receipt.event)&&
        read?.object?.workspace_id===c.workspace_id&&
        read.object.object_id===objInput.object_id&&
        read.object.revision===expectedRevision&&
        read.object.schema_id===objInput.schema_id&&
        read.object.schema_version===objInput.schema_version&&
        JSON.stringify(read.object.data)===JSON.stringify(objInput.data)&&
        verifiedEvents.length===1&&
        verifiedEvents[0].event_id===receipt.event.event_id,
        "T3_D3_ORIGINAL_KERNEL_READBACK_MISMATCH");
      // Recheck accepted source and current authority. Failure AFTER commit
      // remains uncertain, not a reason to retry a non-idempotent command.
      await admission.inspectAcceptedApplication({
        acceptanceId,revisionIds:[...revisionIds],target:chosen,
      });
      await unchanged(c);
      return Object.freeze({
        originalKernelReceipt:copy(receipt,"T3_D3_KERNEL_RECEIPT_INVALID"),
        originalKernelReadback:copy(read,"T3_D3_KERNEL_READBACK_INVALID"),
        originalEventReadback:copy(verifiedEvents[0],"T3_D3_EVENT_READBACK_INVALID"),
        kernelWriteReadback:"CONFIRMED",
        reconciliationLedgerSync:"OWNER_FOLLOWUP_REQUIRED",
        externalProductAcceptance:"NOT_ACCEPTED",
      });
    }catch(error){
      // A definite denial before the original Kernel call cannot be reported
      // as a possibly committed write. After dispatch, NEVER auto-retry.
      if(!kernelWriteEntered)throw error;
      const uncertain=Object.assign(
        new Error("T3_D3_KERNEL_WRITE_MAY_HAVE_COMMITTED"),
        {code:"T3_D3_KERNEL_WRITE_MAY_HAVE_COMMITTED",
          workspace_id:c.workspace_id,object_id:objInput.object_id,
          effectKey:binding.effectKey,
          reason:typeof error?.code==="string"?error.code:"UNCONFIRMED"});
      throw uncertain;
    }
  }
  // A lost Kernel ACK cannot safely trigger another commitObjectGraph.
  // Recover by reading the ORIGINAL Object and Event records under the
  // ORIGINAL signed D1 Access. No new journal, nonce, grant or write is used.
  // The result is CONFIRMED only if the event proves the exact idempotency
  // key, accepted revisions, object and original requested data. A mere
  // same-looking object or an incomplete Event is OUTCOME_UNKNOWN.
  async function recoverApplied(input={}) {
    const {acceptanceId,revisionIds,c,binding,command,objInput}=await stagedSelection(input);
    check(kernel.hasOperation("t1.getObject")&&
      kernel.hasOperation("t1.listEventsSince"),
      "T3_D3_ORIGINAL_KERNEL_HISTORY_REQUIRED");
    await unchanged(c);
    const signedKernel=createSubjectKernelBinding({
      kernel,access,isHostActive,
    });
    // The inherited T2 Kernel reports an absent Object/Workspace through
    // OBJECT_NOT_FOUND / WORKSPACE_NOT_FOUND. After a lost write ACK this is
    // an unconfirmed outcome, not a transport failure and not proof of a
    // safe retry. Denied access, revoked credentials and any other Kernel
    // error MUST still propagate unchanged.
    const missingOriginal=async()=>{
      try{return await signedKernel.getObject(c.workspace_id,objInput.object_id);}
      catch(error){
        if(error?.code==="OBJECT_NOT_FOUND"||
           error?.code==="WORKSPACE_NOT_FOUND")return null;
        throw error;
      }
    };
    const unknown=()=>Object.freeze({
      status:"OUTCOME_UNKNOWN",effectKey:binding.effectKey,
      kernelWriteReadback:"NOT_CONFIRMED",automaticRetryAllowed:false,
    });
    const first=await missingOriginal();
    await unchanged(c);
    if(first===null)return unknown();
    // If the Workspace disappears between the first Object read and its
    // original Event history read, the lost write remains UNKNOWN. A missing
    // history is never proof that the earlier commit did not happen.
    let events;
    try{events=await signedKernel.listEventsSince(c.workspace_id);}
    catch(error){
      if(error?.code==="WORKSPACE_NOT_FOUND")return unknown();
      throw error; // Revoked signed owner, permission denial, and other faults.
    }
    await unchanged(c);
    const second=await missingOriginal();
    await unchanged(c);
    const expectedRevision=objInput.base_revision+1;
    const matchObject=value=>value?.object?.workspace_id===c.workspace_id&&
      value.object.object_id===objInput.object_id&&
      value.object.schema_id===objInput.schema_id&&
      value.object.schema_version===objInput.schema_version&&
      value.object.revision===expectedRevision&&
      JSON.stringify(value.object.data)===JSON.stringify(objInput.data);
    const matching=Array.isArray(events)?events.filter(event=>{
      const provenance=event?.payload;
      return event?.workspace_id===c.workspace_id&&
        event.event_type===command.event.event_type&&
        event.idempotency_key===binding.effectKey&&
        (event.object_id===undefined||event.object_id===objInput.object_id)&&
        (event.revision===undefined||event.revision===expectedRevision)&&
        id(event.event_id)&&obj(provenance)&&
        provenance.reconciliation_acceptance_id===acceptanceId&&
        Array.isArray(provenance.reconciliation_revision_ids)&&
        JSON.stringify([...provenance.reconciliation_revision_ids].sort())===
          JSON.stringify([...revisionIds].sort());
    }):[];
    if(!matchObject(first)||!matchObject(second)||matching.length!==1)
      return unknown();
    return Object.freeze({
      status:"ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED",
      effectKey:binding.effectKey,
      originalKernelReadback:copy(second,"T3_D3_KERNEL_READBACK_INVALID"),
      originalEventReadback:copy(matching[0],"T3_D3_EVENT_READBACK_INVALID"),
      kernelWriteReadback:"CONFIRMED",
      reconciliationLedgerSync:"OWNER_FOLLOWUP_REQUIRED",
      externalProductAcceptance:"NOT_ACCEPTED",
      automaticRetryAllowed:false,
    });
  }
  return Object.freeze({applyAccepted,recoverApplied});
}
