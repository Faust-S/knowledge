// T3 D6: a selected original T2 Object/Result reference can be continued by
// an already-installed native product owner. No Task Engine, Store, protocol,
// signer or second Kernel is created. The recipient owns durable idempotency.
import {createSubjectKernelBinding} from "./subject-access-binding.mjs";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const validId=value=>typeof value==="string"&&ID.test(value);
const identity=context=>JSON.stringify(context);
function deny(code){
  throw Object.assign(new Error(code),{code,outcome:"DENIED"});
}
function check(condition,code){if(!condition)deny(code);}
function copy(value,code){
  try{return structuredClone(value);}
  catch{deny(code);}
}
function referenceFrom(input){
  check(input&&typeof input==="object"&&!Array.isArray(input)&&
    validId(input.workspace_id)&&validId(input.object_id)&&
    validId(input.schema_id)&&Number.isSafeInteger(input.revision)&&
    input.revision>0,"T3_D6_SELECTED_REFERENCE_INVALID");
  return Object.freeze({
    workspace_id:input.workspace_id,object_id:input.object_id,
    schema_id:input.schema_id,revision:input.revision,
  });
}
function sameReference(left,right){
  return !!right&&["workspace_id","object_id","schema_id","revision"]
    .every(key=>left[key]===right[key]);
}
function normalizeInspect(value,reference,recipientId){
  check(value&&value.recipientId===recipientId&&
    ["READY","RECOVER_ONLY"].includes(value.status)&&
    validId(value.operationId)&&
    sameReference(reference,value.reference),
    "T3_D6_NATIVE_OWNER_NOT_READY");
  return Object.freeze({operationId:value.operationId,status:value.status});
}
function verifiedDomainProof(proof,owner,reference,operationId,recipientId,resultRef){
  // This predicate validates source/recipient/order identities. The ORIGINAL
  // installed domain owner MUST itself call its canonical Result validator
  // after independent signed Kernel readback; T3 never reimplements it.
  return !!proof&&proof.status==="ORIGINAL_DOMAIN_RESULT_VERIFIED"&&
    proof.ownerId===owner.ownerId&&proof.resultType===owner.resultType&&
    proof.orderRef===owner.orderRef&&proof.resultRef===resultRef&&
    proof.workspaceId===reference.workspace_id&&
    proof.operationId===operationId&&proof.recipientId===recipientId&&
    proof.stage==="final"&&proof.canonicalVerified===true&&
    Number.isSafeInteger(proof.resultRevision)&&proof.resultRevision>0&&
    sameReference(reference,proof.sourceReference);
}
function confirmedOwnerReadback(receipt,readback,reference,recipientId,operationId){
  const matches=value=>value&&value.operationId===operationId&&
    value.recipientId===recipientId&&sameReference(reference,value.reference)&&
    validId(value.resultRef);
  return matches(receipt)&&matches(readback)&&
    receipt.state==="COMMITTED"&&readback.state==="PERSISTED"&&
    receipt.resultRef===readback.resultRef;
}

/** The original signed D1 owner and original Kernel are mandatory. An
 * existing installed native product supplies inspect/receive/receipt/readback;
 * the product must validate its own recipient permission and persist the
 * operationId before acknowledging. The UI cannot supply this native owner. */
export function createTrustedNativeContinuation({
  kernel,accessForRead,currentWorkspace,nativeOwner,confirmHuman,
  resultOwner=null,sourceCurrent=null,isHostActive,
}={}){
  check(kernel&&typeof kernel.hasOperation==="function"&&
    typeof accessForRead==="function"&&
    typeof currentWorkspace?.get==="function"&&
    typeof currentWorkspace?.subscribe==="function"&&
    nativeOwner&&validId(nativeOwner.recipientId)&&
    ["inspect","receive","receipt","readback"]
      .every(method=>typeof nativeOwner[method]==="function")&&
    typeof confirmHuman==="function"&&typeof isHostActive==="function"&&
    (sourceCurrent===null||typeof sourceCurrent==="function")&&
    (resultOwner===null||
      (validId(resultOwner.ownerId)&&validId(resultOwner.resultType)&&
       validId(resultOwner.orderRef)&&
       typeof resultOwner.verifySaved==="function")),
    "T3_D6_TRUSTED_HOST_OWNER_REQUIRED");

  // Native idempotency survives cold opens in the ORIGINAL recipient. These
  // Host-lifetime guards prevent duplicate human decisions and resends before
  // the recipient can report an uncertain or lost acknowledgement.
  const inFlight=new Set();
  const dispatched=new Set();
  const active=()=>isHostActive()===true;
  async function withSelectedSource(input,run){
    const reference=referenceFrom(input);
    check(active(),"T3_HOST_DISPOSED");
    const selected=currentWorkspace.get();
    check(selected&&selected.workspace_id===reference.workspace_id&&
      !selected.deleted_at,"T3_D6_SELECTED_WORKSPACE_REQUIRED");
    let selectionChanged=false;
    const unsubscribe=currentWorkspace.subscribe(()=>{selectionChanged=true;});
    try{
      const live=()=>{
        check(active(),"T3_HOST_DISPOSED");
        check(!selectionChanged&&currentWorkspace.get()===selected,
          "T3_D6_WORKSPACE_CHANGED");
      };
      live();
      const access=await accessForRead("t1.getObject");
      live();
      check(access&&typeof access.currentContext==="function",
        "T3_D6_SIGNED_OWNER_REQUIRED");
      const context=copy(await access.currentContext(),
        "T3_D6_SIGNED_CONTEXT_INVALID");
      check(context?.workspace_id===reference.workspace_id&&
        context.resource===reference.workspace_id,
        "T3_D6_SIGNED_WORKSPACE_MISMATCH");
      const initialIdentity=identity(context);
      const unchanged=async()=>{
        live();
        check(identity(await access.currentContext())===initialIdentity,
          "T3_D6_SIGNED_CONTEXT_CHANGED");
        live();
      };
      const signed=createSubjectKernelBinding({
        kernel,access,isHostActive:()=>active()&&!selectionChanged&&
          currentWorkspace.get()===selected,
      });
      const readSource=async()=>{
        await unchanged();
        const result=await signed.getObject(reference.workspace_id,reference.object_id);
        await unchanged();
        const object=result?.object;
        check(object?.workspace_id===reference.workspace_id&&
          object.object_id===reference.object_id&&
          object.schema_id===reference.schema_id&&
          object.revision===reference.revision&&!object.deleted,
          "T3_D6_STALE_OR_MISSING_REFERENCE");
        return copy(object,"T3_D6_ORIGINAL_OBJECT_NOT_CLONEABLE");
      };
      const object=await readSource();
      return await run({reference,object,unchanged,readSource});
    }finally{
      unsubscribe();
    }
  }
  async function inspect(nativeOwnerInput){
    const {reference,unchanged}=nativeOwnerInput;
    await unchanged();
    const report=await nativeOwner.inspect({reference:copy(reference,
      "T3_D6_REFERENCE_NOT_CLONEABLE"),recipientId:nativeOwner.recipientId});
    await unchanged();
    return normalizeInspect(report,reference,nativeOwner.recipientId);
  }
  async function observe(reference,operationId,readSource){
    const receipt=await nativeOwner.receipt(operationId);
    const readback=await nativeOwner.readback(operationId);
    // A native transport ACK is not evidence of persisted Result. Re-check
    // the ORIGINAL signed source after the native owner readback as well.
    await readSource();
    if(!confirmedOwnerReadback(receipt,readback,reference,nativeOwner.recipientId,operationId)){
      return Object.freeze({status:"OUTCOME_UNKNOWN",operationId});
    }
    if(resultOwner!==null){
      // The native workflow/ERP owner only confirms its OWN durable action.
      // For CehoVod, the independent original domain owner must read its
      // saved plan-fact-analysis and call verifyStoredFinalPlanFact. Do not
      // promote an n8n/HTTP ACK or an unverified resultRef to a domain Result.
      let proof=null;
      try{
        proof=await resultOwner.verifySaved({
          resultRef:receipt.resultRef,operationId,
          recipientId:nativeOwner.recipientId,
          sourceReference:copy(reference,"T3_D6_REFERENCE_NOT_CLONEABLE"),
        });
      }catch{
        // A missing/unavailable domain owner is never a reason to retry
        // the already-confirmed EXTERNAL native action.
      }
      // Independent signed Kernel readback also detects revisions changing
      // while the domain owner verified the referenced Result.
      await readSource();
      if(!verifiedDomainProof(proof,resultOwner,reference,operationId,
          nativeOwner.recipientId,receipt.resultRef)){
        return Object.freeze({status:"DOMAIN_RESULT_UNVERIFIED",operationId,
          recipientId:nativeOwner.recipientId,resultRef:receipt.resultRef,
          owner_action_confirmed:true,domain_result_confirmed:false,
          can_retry:false,reason:"CANONICAL_DOMAIN_READBACK_REQUIRED"});
      }
      return Object.freeze({status:"DOMAIN_RESULT_READBACK_CONFIRMED",operationId,
        recipientId:nativeOwner.recipientId,resultRef:receipt.resultRef,
        resultOwnerId:resultOwner.ownerId,orderRef:resultOwner.orderRef,
        resultRevision:proof.resultRevision,owner_action_confirmed:true,
        domain_result_confirmed:true,
        reference:copy(reference,"T3_D6_REFERENCE_NOT_CLONEABLE")});
    }
    return Object.freeze({status:"OWNER_READBACK_CONFIRMED",operationId,
      recipientId:nativeOwner.recipientId,resultRef:receipt.resultRef,
      reference:copy(reference,"T3_D6_REFERENCE_NOT_CLONEABLE")});
  }
  // Only the ORIGINAL installed recipient knows whether a native Result
  // was already committed. Inspect may still say READY after a lost ACK or
  // cold restart; its durable receipt is the final answer, not UI memory.
  async function probePrior(state,operationId){
    try{
      await state.unchanged();
      const receipt=await nativeOwner.receipt(operationId);
      await state.unchanged();
      if(receipt===null||receipt===undefined)return null;
      // A receipt with mismatched reference/recipient or missing readback is
      // not permission to dispatch again. Treat it as an unknown outcome.
      return await observe(state.reference,operationId,state.readSource);
    }catch{
      // Unable to determine whether the ORIGINAL native write committed.
      // Returning OUTCOME_UNKNOWN prevents an accidental retry.
      return Object.freeze({status:"OUTCOME_UNKNOWN",operationId});
    }
  }
  async function preflightExternalSource(state){
    if(sourceCurrent===null)return;
    // Reuse existing external-process-link.prepareContinuation(). It does
    // fresh ERP readExact and signed ORIGINAL Kernel readback; cached
    // readSaved is never authority to dispatch a native action.
    await state.unchanged();
    let fresh=null;
    try{
      fresh=await sourceCurrent(copy(state.reference,
        "T3_D6_REFERENCE_NOT_CLONEABLE"));
    }catch{
      // An unavailable ERP account or a changed source is a pre-dispatch
      // refusal, never OUTCOME_UNKNOWN and never a reason to retry a write.
      deny("T3_D6_EXTERNAL_SOURCE_NOT_CURRENT");
    }
    await state.unchanged();
    check(sameReference(state.reference,fresh)&&
      fresh!==null&&typeof fresh==="object"&&!Array.isArray(fresh)&&
      Object.keys(fresh).length===4&&
      ["workspace_id","object_id","schema_id","revision"]
        .every(key=>Object.hasOwn(fresh,key)),
      "T3_D6_EXTERNAL_SOURCE_NOT_CURRENT");
    await state.readSource();
  }
  async function preview(input){
    return withSelectedSource(input,async state=>{
      const plan=await inspect(state);
      const prior=await probePrior(state,plan.operationId);
      const status=inFlight.has(plan.operationId)?"OPERATION_IN_PROGRESS":
        prior!==null||plan.status==="RECOVER_ONLY"||
        dispatched.has(plan.operationId)?"RECOVER_ONLY":"AVAILABLE";
      return Object.freeze({status,
        operationId:plan.operationId,recipientId:nativeOwner.recipientId,
        reference:state.reference});
    });
  }
  async function continueSelected(input){
    return withSelectedSource(input,async state=>{
      const plan=await inspect(state);
      const operationId=plan.operationId;
      if(inFlight.has(operationId))
        return Object.freeze({status:"OPERATION_IN_PROGRESS",operationId});
      if(plan.status==="RECOVER_ONLY"||dispatched.has(operationId))
        return Object.freeze({status:"OUTCOME_UNKNOWN",operationId});
      // Claim before asynchronous human confirmation, not just before
      // receive(). Otherwise two clicks can authorize the SAME native write.
      inFlight.add(operationId);
      try{
        const prior=await probePrior(state,operationId);
        if(prior!==null)return prior;
        const approval=await confirmHuman({
          recipientId:nativeOwner.recipientId,
          operationId,reference:copy(state.reference,
            "T3_D6_REFERENCE_NOT_CLONEABLE"),
        });
        await state.unchanged();
        if(approval!==true)return Object.freeze({status:"USER_CANCELLED"});
        // The reference may have advanced while a human reviewed the proposal.
        // Repeat ORIGINAL signed Kernel readback before the only native write.
        const current=await state.readSource();
        await state.unchanged();
        // An independent native process could have committed during Human
        // confirmation. One final durable read before dispatch protects the
        // installed product even when this Host has never seen the Result.
        const committedDuringConsent=await probePrior(state,operationId);
        if(committedDuringConsent!==null)return committedDuringConsent;
        // ERP source may change DURING Human Review, while T2 revision is
        // unchanged. Reconfirm before the only external native dispatch.
        await preflightExternalSource(state);
        // Set before invoking the original native owner: failure may mean
        // that its durable write committed but the acknowledgement was lost.
        dispatched.add(operationId);
        try{
          await nativeOwner.receive({
            operationId,recipientId:nativeOwner.recipientId,
            reference:copy(state.reference,"T3_D6_REFERENCE_NOT_CLONEABLE"),
            object:current,
          });
          return await observe(state.reference,operationId,state.readSource);
        }catch(error){
          // No retry: the original owner receipt/readback is the only
          // authority to recover an uncertain native Result after cold open.
          return Object.freeze({status:"OUTCOME_UNKNOWN",operationId,
            reason:typeof error?.code==="string"?error.code:"UNCONFIRMED"});
        }
      }finally{
        inFlight.delete(operationId);
      }
    });
  }
  async function recover(input){
    return withSelectedSource(input,async state=>{
      const plan=await inspect(state);
      try{
        return await observe(state.reference,plan.operationId,state.readSource);
      }catch{
        return Object.freeze({status:"OUTCOME_UNKNOWN",operationId:plan.operationId});
      }
    });
  }
  return Object.freeze({preview,continueSelected,recover});
}
