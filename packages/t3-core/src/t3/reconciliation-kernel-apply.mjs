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
// The inherited T2 graph persists the entire caller-supplied JSON Event
// payload. Its canonical storage may reorder object keys, so byte-for-byte
// JSON.stringify is not a valid equality check. Extra/mutated provenance
// fields must never be accepted as the original signed application Event.
function sameJson(a,b,activeA=new WeakSet(),activeB=new WeakSet()){
  // Sparse or cyclic input is not a complete original T2 JSON value.
  // Do not silently skip holes or accept a different Event's provenance.
  // Original T2 owns payload size; legitimate large result arrays must not
  // acquire a second artificial 4096-element/32-depth Host restriction.
  if(a===null||b===null)return a===b;
  if(typeof a!==typeof b)return false;
  if(typeof a==="string"||typeof a==="boolean")return a===b;
  if(typeof a==="number")
    return Number.isFinite(a)&&Number.isFinite(b)&&a===b;
  if(typeof a!=="object")return false;
  if(activeA.has(a)||activeB.has(b))return false;
  activeA.add(a);
  activeB.add(b);
  try{
    if(Array.isArray(a)||Array.isArray(b)){
      if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)
        return false;
      for(let i=0;i<a.length;i++){
        if(!Object.hasOwn(a,i)||!Object.hasOwn(b,i)||
           !sameJson(a[i],b[i],activeA,activeB))return false;
      }
      return true;
    }
    const plain=value=>Object.getPrototypeOf(value)===Object.prototype||
      Object.getPrototypeOf(value)===null;
    if(!plain(a)||!plain(b))return false;
    const keys=Object.keys(a);
    return keys.length===Object.keys(b).length&&
      keys.every(key=>Object.hasOwn(b,key)&&
        sameJson(a[key],b[key],activeA,activeB));
  }finally{
    activeA.delete(a);
    activeB.delete(b);
  }
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
  confirmSeparateApply,isHostActive,resolveReceiptWorkspace=null,
}={}){
  check(admission&&typeof admission.inspectAcceptedApplication==="function"&&
    typeof stageFromOriginalOwner==="function"&&
    typeof confirmSeparateApply==="function"&&
    typeof isHostActive==="function"&&
    (resolveReceiptWorkspace===null||typeof resolveReceiptWorkspace==="function"),
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
  // Only the native original Admin owner selects the already provisioned
  // administrative partition. A caller cannot supply a physical destination.
  async function receiptWorkspace(c){
    if(resolveReceiptWorkspace===null)return null;
    const value=await resolveReceiptWorkspace();
    await unchanged(c);
    check(value===null||typeof value==="string"&&
      /^workspace:registry:[a-f0-9]{64}$/.test(value)&&value!==c.workspace_id,
      "T3_D3_ADMIN_RECEIPT_WORKSPACE_INVALID");
    return value;
  }
  function receiptBinding(c,binding,storage,extra={}){
    return createSubjectKernelBinding({kernel,access,isHostActive,...extra,
      applicationReceiptScope:storage===null?null:
        {workspaceId:storage,effectKey:binding.effectKey}});
  }
  async function readAbsentObject(port,workspace,objectId,{missingWorkspace=false}={}){
    try{return await port.getObject(workspace,objectId);}
    catch(error){
      if(error?.code==="OBJECT_NOT_FOUND"||
         missingWorkspace&&error?.code==="WORKSPACE_NOT_FOUND")return null;
      throw error;
    }
  }
  function sameEffect(event,binding,objInput){
    return event?.idempotency_key===binding.effectKey||
      event?.object_id===objInput.object_id;
  }
  async function assertNoPrior(port,c,binding,objInput,strict=false){
    const history=await port.listEventsSince(c.workspace_id);
    check(Array.isArray(history),"T3_D3_ORIGINAL_EVENT_HISTORY_UNAVAILABLE");
    check(!history.some(event=>sameEffect(event,binding,objInput)),
      "T3_D3_ORIGINAL_EFFECT_ALREADY_RECORDED_USE_RECOVERY");
    if(strict)check(await readAbsentObject(port,c.workspace_id,objInput.object_id)===null,
      "T3_D3_ORIGINAL_EFFECT_ALREADY_RECORDED_USE_RECOVERY");
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
      Number.isSafeInteger(objInput.base_revision)&&
      objInput.base_revision===binding.expectedRevision&&
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
    const storage=await receiptWorkspace(c);
    check(resolveReceiptWorkspace===null||storage!==null,
      "T3_D3_ADMIN_RECEIPT_WORKSPACE_REQUIRED");
    const physicalWorkspace=storage??c.workspace_id;
    const businessKernel=receiptBinding(c,binding,null);
    const signedKernel=receiptBinding(c,binding,storage,{
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
    try { workspace=await businessKernel.getWorkspace(c.workspace_id); }
    catch(error){
      if(error?.code==="WORKSPACE_NOT_FOUND")
        deny("T3_D3_ORIGINAL_WORKSPACE_PROVISION_REQUIRED");
      throw error; // Revocation/permission denial is not missing storage.
    }
    check(workspace!==null,"T3_D3_ORIGINAL_WORKSPACE_PROVISION_REQUIRED");
    check(!workspace.deleted_at,"T3_D3_ORIGINAL_WORKSPACE_DELETED");
    check(workspace.read_only!==true,"T3_D3_ORIGINAL_WORKSPACE_READ_ONLY");
    if(storage!==null){
      let admin;
      try{admin=await signedKernel.getWorkspace(c.workspace_id);}
      catch(error){
        if(error?.code==="WORKSPACE_NOT_FOUND")
          deny("T3_D3_ADMIN_RECEIPT_WORKSPACE_REQUIRED");
        throw error;
      }
      check(admin?.workspace_id===storage&&admin.profile==="generic"&&
        admin.deleted_at==null&&admin.read_only!==true,
        "T3_D3_ADMIN_RECEIPT_WORKSPACE_REQUIRED");
    }
    // On a new Host the volatile no-replay guard is empty. Consult the
    // ORIGINAL durable Kernel Event history BEFORE asking for Human APPLY.
    // A previous effect with this sealed idempotency key must be recovered,
    // not submitted again. An unavailable history cannot be treated as empty.
    if(storage!==null)await assertNoPrior(businessKernel,c,binding,objInput,true);
    await assertNoPrior(signedKernel,c,binding,objInput,storage!==null);
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
    // Another original Host can apply this exact sealed effect while the
    // manager reviews the Human APPLY prompt. Re-read durable T2 Event
    // history AFTER consent, not just before it. This is not an alternate
    // journal; the original Kernel remains the sole durable authority.
    if(storage!==null){
      check(await receiptWorkspace(c)===storage,
        "T3_D3_ADMIN_RECEIPT_WORKSPACE_CHANGED");
      await assertNoPrior(businessKernel,c,binding,objInput,true);
    }
    await assertNoPrior(signedKernel,c,binding,objInput,storage!==null);
    await unchanged(c);
    // Kernel's own revision/idempotency semantics remain authoritative for
    // any race after this read and before the final signed JIT dispatch.
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
      const sameEvent=event=>event?.workspace_id===physicalWorkspace&&
        id(event.event_id)&&event.event_type===command.event.event_type&&
        event.idempotency_key===binding.effectKey&&
        event.object_id===objInput.object_id&&
        event.revision===expectedRevision&&
        obj(event.payload)&&
        event.payload.reconciliation_acceptance_id===acceptanceId&&
        sameRevisions(event.payload.reconciliation_revision_ids)&&
        sameJson(event.payload,command.event.payload);
      const verifiedEvents=Array.isArray(events)?
        events.filter(sameEvent):[];
      check(receipt?.workspace_id===physicalWorkspace&&
        receipt.object?.workspace_id===physicalWorkspace&&
        receipt.object?.object_id===objInput.object_id&&
        receipt.object.revision===expectedRevision&&
        receipt.object.schema_id===objInput.schema_id&&
        sameEvent(receipt.event)&&
        read?.object?.workspace_id===physicalWorkspace&&
        read.object.object_id===objInput.object_id&&
        read.object.revision===expectedRevision&&
        read.object.schema_id===objInput.schema_id&&
        read.object.schema_version===objInput.schema_version&&
        sameJson(read.object.data,objInput.data)&&
        verifiedEvents.length===1&&
        verifiedEvents[0].event_id===receipt.event.event_id,
        "T3_D3_ORIGINAL_KERNEL_READBACK_MISMATCH");
      if(storage!==null){
        check(await receiptWorkspace(c)===storage,
          "T3_D3_ADMIN_RECEIPT_WORKSPACE_CHANGED");
        await assertNoPrior(businessKernel,c,binding,objInput,true);
      }
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
          workspace_id:physicalWorkspace,object_id:objInput.object_id,
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
    const unknown=()=>Object.freeze({
      status:"OUTCOME_UNKNOWN",effectKey:binding.effectKey,
      kernelWriteReadback:"NOT_CONFIRMED",automaticRetryAllowed:false,
    });
    const storage=await receiptWorkspace(c);
    // Recovery reads both the historical business location and the private
    // receipt partition. A duplicate or inconsistent placement is not
    // successful recovery. Never migrate, delete or repeat the effect.
    const recoverAt=async(physicalWorkspace,partition,checkPresence)=>{
    const signedKernel=receiptBinding(c,binding,partition);
    const missingOriginal=()=>readAbsentObject(signedKernel,c.workspace_id,
      objInput.object_id,{missingWorkspace:true});
    const first=await missingOriginal();
    await unchanged(c);
    if(first===null&&!checkPresence)return {present:false,result:unknown()};
    let events;
    try{events=await signedKernel.listEventsSince(c.workspace_id);}
    catch(error){
      if(error?.code==="WORKSPACE_NOT_FOUND")return {present:first!==null,result:unknown()};
      throw error;
    }
    await unchanged(c);
    const second=await missingOriginal();
    await unchanged(c);
    const evidence=Array.isArray(events)?
      events.filter(event=>sameEffect(event,binding,objInput)):[];
    const present=first!==null||second!==null||evidence.length>0;
    const expectedRevision=objInput.base_revision+1;
    const matchObject=value=>value?.object?.workspace_id===physicalWorkspace&&
      value.object.object_id===objInput.object_id&&
      value.object.schema_id===objInput.schema_id&&
      value.object.schema_version===objInput.schema_version&&
      value.object.revision===expectedRevision&&
      sameJson(value.object.data,objInput.data);
    const matching=Array.isArray(events)?events.filter(event=>{
      const provenance=event?.payload;
      return event?.workspace_id===physicalWorkspace&&
        event.event_type===command.event.event_type&&
        event.idempotency_key===binding.effectKey&&
        event.object_id===objInput.object_id&&
        event.revision===expectedRevision&&
        id(event.event_id)&&obj(provenance)&&
        provenance.reconciliation_acceptance_id===acceptanceId&&
        Array.isArray(provenance.reconciliation_revision_ids)&&
        JSON.stringify([...provenance.reconciliation_revision_ids].sort())===
          JSON.stringify([...revisionIds].sort())&&
        sameJson(provenance,command.event.payload);
    }):[];
    if(!matchObject(first)||!matchObject(second)||matching.length!==1||
       evidence.length!==1)
      return {present,result:unknown()};
    return {present:true,result:Object.freeze({
      status:"ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED",
      effectKey:binding.effectKey,
      originalKernelReadback:copy(second,"T3_D3_KERNEL_READBACK_INVALID"),
      originalEventReadback:copy(matching[0],"T3_D3_EVENT_READBACK_INVALID"),
      kernelWriteReadback:"CONFIRMED",
      reconciliationLedgerSync:"OWNER_FOLLOWUP_REQUIRED",
      externalProductAcceptance:"NOT_ACCEPTED",
      automaticRetryAllowed:false,
    })};
    };
    const legacy=await recoverAt(c.workspace_id,null,storage!==null);
    if(storage===null)return legacy.result;
    const separate=await recoverAt(storage,storage,true);
    check(await receiptWorkspace(c)===storage,"T3_D3_ADMIN_RECEIPT_WORKSPACE_CHANGED");
    if(legacy.present&&separate.present)return unknown();
    return separate.present?separate.result:legacy.result;
  }
  return Object.freeze({applyAccepted,recoverApplied});
}
