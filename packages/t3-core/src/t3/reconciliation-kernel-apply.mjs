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
const identity=c=>JSON.stringify(["kind","context_id","actor_id","principal_id",
  "role_id","grant_id","organization_id","workspace_id","resource","scope_revision"]
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
  const signedKernel=createSubjectKernelBinding({kernel,access});
  async function selected(){
    check(isHostActive()===true,"T3_HOST_DISPOSED");
    const c=copy(await access.currentContext(),"T3_D3_APPLY_CONTEXT_INVALID");
    // Historical original application-host binding is a corporate product
    // operation; PERSONAL never silently borrows a corporate issuer.
    check(obj(c)&&c.kind==="CORP"&&
      ["context_id","actor_id","principal_id","role_id","grant_id",
        "organization_id","workspace_id","resource"].every(k=>id(c[k]))&&
      c.resource===c.workspace_id&&c.principal_id===c.organization_id&&
      Number.isSafeInteger(c.scope_revision)&&c.scope_revision>0,
      "T3_D3_ORIGINAL_CORPORATE_CONTEXT_REQUIRED");
    return c;
  }
  async function unchanged(c){
    check(identity(await selected())===identity(c),"T3_D3_APPLY_CONTEXT_CHANGED");
  }
  async function applyAccepted({acceptanceId,revisionIds,target}={}){
    check(hex(acceptanceId)&&Array.isArray(revisionIds)&&revisionIds.length>0&&
      revisionIds.length<=32&&revisionIds.every(hex)&&
      new Set(revisionIds).size===revisionIds.length&&obj(target),
      "T3_D3_APPLICATION_SELECTION_REQUIRED");
    const c=await selected(),chosen=copy(target,"T3_D3_APPLICATION_TARGET_INVALID");
    check(chosen.workspaceId===c.workspace_id&&chosen.subjectId===c.organization_id,
      "T3_D3_APPLY_TARGET_OUT_OF_SCOPE");
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
      binding.applicationAuthorized===false&&binding.writeAllowed===false&&
      binding.hostJitRequired===true&&binding.explicitHumanDecisionRequired===true&&
      binding.decisionCheckAtCommit===true&&
      binding.externalContextCoreApplied===false&&
      typeof binding.commitPrecondition==="function"&&
      obj(ctx)&&ctx.operationId===binding.operation.operationId&&
      ctx.payloadDigest===binding.operation.payloadDigest&&
      ctx.organizationId===c.organization_id&&ctx.workspaceId===c.workspace_id&&
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
    check(kernel.hasOperation("t1.commitObjectGraph")&&
      kernel.hasOperation("t1.getObject"),
      "T3_D3_ORIGINAL_KERNEL_GRANT_REQUIRED");
    // Independent, explicit APPLY approval is not the earlier ACCEPT.
    const approval=await confirmSeparateApply({
      acceptanceId,revisionIds:[...revisionIds],target:copy(chosen,"T3_D3_APPLICATION_TARGET_INVALID"),
      effectKey:binding.effectKey,operation:copy(binding.operation,"T3_D3_OPERATION_NOT_CLONEABLE"),
      context:copy(c,"T3_D3_APPLY_CONTEXT_INVALID"),
    });
    check(approval===true,"T3_D3_SEPARATE_HUMAN_APPLY_REQUIRED");
    await unchanged(c);
    // Historical owner checks fresh ledger projection and its own signed
    // human approval. This result is a precondition, NOT the Kernel grant.
    // The original signed KernelFacade performs a second JIT for Graph.
    check(binding.commitPrecondition(ctx)===true,
      "T3_D3_ORIGINAL_APPLICATION_PRECONDITION_DENIED");
    await unchanged(c);
    let enteredKernel=false,receipt;
    try {
      enteredKernel=true;
      receipt=await signedKernel.commitObjectGraph(command);
      const read=await signedKernel.getObject(c.workspace_id,objInput.object_id);
      check(receipt?.workspace_id===c.workspace_id&&
        receipt.object?.workspace_id===c.workspace_id&&
        receipt.object?.object_id===objInput.object_id&&
        id(receipt.event?.event_id)&&receipt.event.workspace_id===c.workspace_id&&
        read?.object?.workspace_id===c.workspace_id&&
        read.object.object_id===objInput.object_id&&
        read.object.revision===receipt.object.revision&&
        read.object.schema_id===objInput.schema_id&&
        JSON.stringify(read.object.data)===JSON.stringify(objInput.data),
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
        kernelWriteReadback:"CONFIRMED",
        reconciliationLedgerSync:"OWNER_FOLLOWUP_REQUIRED",
        externalProductAcceptance:"NOT_ACCEPTED",
      });
    }catch(error){
      if(!enteredKernel)throw error;
      const uncertain=Object.assign(
        new Error("T3_D3_KERNEL_WRITE_MAY_HAVE_COMMITTED"),
        {code:"T3_D3_KERNEL_WRITE_MAY_HAVE_COMMITTED",
          workspace_id:c.workspace_id,object_id:objInput.object_id,
          effectKey:binding.effectKey,
          reason:typeof error?.code==="string"?error.code:"UNCONFIRMED"});
      throw uncertain;
    }
  }
  return Object.freeze({applyAccepted});
}
