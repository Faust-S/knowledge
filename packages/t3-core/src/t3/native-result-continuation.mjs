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
  isHostActive,
}={}){
  check(kernel&&typeof kernel.hasOperation==="function"&&
    typeof accessForRead==="function"&&
    typeof currentWorkspace?.get==="function"&&
    typeof currentWorkspace?.subscribe==="function"&&
    nativeOwner&&validId(nativeOwner.recipientId)&&
    ["inspect","receive","receipt","readback"]
      .every(method=>typeof nativeOwner[method]==="function")&&
    typeof confirmHuman==="function"&&typeof isHostActive==="function",
    "T3_D6_TRUSTED_HOST_OWNER_REQUIRED");

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
    return Object.freeze({status:"OWNER_READBACK_CONFIRMED",operationId,
      recipientId:nativeOwner.recipientId,resultRef:receipt.resultRef,
      reference:copy(reference,"T3_D6_REFERENCE_NOT_CLONEABLE")});
  }
  async function preview(input){
    return withSelectedSource(input,async state=>{
      const plan=await inspect(state);
      return Object.freeze({status:plan.status==="READY"?"AVAILABLE":"RECOVER_ONLY",
        operationId:plan.operationId,recipientId:nativeOwner.recipientId,
        reference:state.reference});
    });
  }
  async function continueSelected(input){
    return withSelectedSource(input,async state=>{
      const plan=await inspect(state);
      if(plan.status==="RECOVER_ONLY")
        return Object.freeze({status:"OUTCOME_UNKNOWN",operationId:plan.operationId});
      const approval=await confirmHuman({
        recipientId:nativeOwner.recipientId,
        operationId:plan.operationId,reference:copy(state.reference,
          "T3_D6_REFERENCE_NOT_CLONEABLE"),
      });
      await state.unchanged();
      if(approval!==true)return Object.freeze({status:"USER_CANCELLED"});
      // The reference may have advanced while a human reviewed the proposal.
      // Repeat ORIGINAL signed Kernel readback before the only native write.
      const current=await state.readSource();
      await state.unchanged();
      let dispatched=false;
      try{
        dispatched=true;
        await nativeOwner.receive({
          operationId:plan.operationId,recipientId:nativeOwner.recipientId,
          reference:copy(state.reference,"T3_D6_REFERENCE_NOT_CLONEABLE"),
          object:current,
        });
        return await observe(state.reference,plan.operationId,state.readSource);
      }catch(error){
        if(!dispatched)throw error;
        // A lost native ACK may hide a committed write. Never resend here;
        // a cold-opened Host can call recover() with the same selected ref.
        return Object.freeze({status:"OUTCOME_UNKNOWN",operationId:plan.operationId,
          reason:typeof error?.code==="string"?error.code:"UNCONFIRMED"});
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
