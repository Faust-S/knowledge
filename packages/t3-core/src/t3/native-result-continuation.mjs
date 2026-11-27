// T3 D6: a selected original T2 Object/Result reference can be continued by
// an already-installed native product owner. No Task Engine, Store, protocol,
// signer or second Kernel is created. The recipient owns durable idempotency.
import {createSubjectKernelBinding} from "./subject-access-binding.mjs";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const validId=value=>typeof value==="string"&&ID.test(value);
// Use the exact COMPLETE original D1 signed context, not just the first
// generation's known fields. Additional original signed metadata must not
// silently change while a Human approves delivery. Canonicalize ONLY object
// key order: no IAM, signatures, authority or Store live here.
function identity(value){
  const active=new WeakSet();
  const invalid=()=>deny("T3_D6_SIGNED_CONTEXT_INVALID");
  function canonical(input){
    if(input===null)return "null";
    if(typeof input==="string"||typeof input==="boolean")
      return JSON.stringify(input);
    if(typeof input==="number")
      return Number.isFinite(input)?JSON.stringify(input):invalid();
    if(typeof input!=="object")return invalid();
    if(active.has(input))return invalid();
    active.add(input);
    try{
      if(Array.isArray(input)){
        // Real signed JSON cannot contain sparse or extra-keyed arrays.
        if(Object.keys(input).length!==input.length)return invalid();
        const parts=[];
        for(let i=0;i<input.length;i++){
          if(!Object.hasOwn(input,i))return invalid();
          parts.push(canonical(input[i]));
        }
        return "["+parts.join(",")+"]";
      }
      const proto=Object.getPrototypeOf(input);
      if(proto!==Object.prototype&&proto!==null)return invalid();
      return "{"+Object.keys(input).sort().map(
        key=>JSON.stringify(key)+":"+canonical(input[key])
      ).join(",")+"}";
    }finally{
      active.delete(input);
    }
  }
  if(!value||typeof value!=="object"||Array.isArray(value))
    return invalid();
  return canonical(value);
}
function deny(code){
  throw Object.assign(new Error(code),{code,outcome:"DENIED"});
}
function check(condition,code){if(!condition)deny(code);}
function copy(value,code){
  try{return structuredClone(value);}
  catch{deny(code);}
}
// A native recipient's explicit DENIED is a definite owner decision, not a
// lost receipt. Unclassified transport failures remain OUTCOME_UNKNOWN.
// The installed recipient, not the browser, must establish this outcome.
function rethrowDefiniteNativeRefusal(error){
  if(error?.outcome==="DENIED")throw error;
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

  // Native idempotency survives cold opens in the ORIGINAL recipient. These
  // Host-lifetime guards prevent duplicate human decisions and resends before
  // the recipient can report an uncertain or lost acknowledgement.
  const inFlight=new Set();
  const dispatched=new Set();
  // A trusted port is bound to ONE installed recipient. Switching account
  // while Human Review or native readback awaits cannot retarget a Result.
  const recipientId=nativeOwner.recipientId;
  const recipientUnchanged=()=>check(nativeOwner.recipientId===recipientId,
    "T3_D6_NATIVE_RECIPIENT_CHANGED");
  const active=()=>isHostActive()===true;
  async function withSelectedSource(input,run,expectedContext){
    const expectedIdentity=expectedContext===undefined?null:identity(expectedContext);
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
        recipientUnchanged();
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
      check(expectedIdentity===null||initialIdentity===expectedIdentity,"T3_D6_SIGNED_CONTEXT_MISMATCH");
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
          object.revision===reference.revision&&
          !object.deleted&&object.deleted_at==null,
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
      "T3_D6_REFERENCE_NOT_CLONEABLE"),recipientId:recipientId});
    await unchanged();
    return normalizeInspect(report,reference,recipientId);
  }
  async function observe(reference,operationId,readSource){
    let receipt,readback,nativeReadUnavailable=false;
    try{
      receipt=await nativeOwner.receipt(operationId);
      readback=await nativeOwner.readback(operationId);
    }catch(error){
      rethrowDefiniteNativeRefusal(error);
      nativeReadUnavailable=true;
    }
    // Native receipt outages mean UNKNOWN; revocation of the ORIGINAL
    // signed source is a separate denial and must never be swallowed.
    await readSource();
    if(nativeReadUnavailable||
       !confirmedOwnerReadback(receipt,readback,reference,recipientId,operationId)){
      return Object.freeze({status:"OUTCOME_UNKNOWN",operationId});
    }
    return Object.freeze({status:"OWNER_READBACK_CONFIRMED",operationId,
      recipientId:recipientId,resultRef:receipt.resultRef,
      reference:copy(reference,"T3_D6_REFERENCE_NOT_CLONEABLE")});
  }
  // Only the ORIGINAL installed recipient knows whether a native Result
  // was already committed. Inspect may still say READY after a lost ACK or
  // cold restart; its durable receipt is the final answer, not UI memory.
  async function probePrior(state,operationId){
    await state.unchanged();
    let receipt;
    try{receipt=await nativeOwner.receipt(operationId);}
    catch(error){
      rethrowDefiniteNativeRefusal(error);
      // Only an unavailable native receipt is an uncertain native outcome.
      // A changed Workspace or denied original D1 read must still reject.
      await state.unchanged();
      return Object.freeze({status:"OUTCOME_UNKNOWN",operationId});
    }
    await state.unchanged();
    if(receipt===null||receipt===undefined)return null;
    // An invalid receipt/readback is not permission to dispatch again.
    return observe(state.reference,operationId,state.readSource);
  }
  async function preview(input,expectedContext){
    return withSelectedSource(input,async state=>{
      const plan=await inspect(state);
      const prior=await probePrior(state,plan.operationId);
      // Even a null receipt was an asynchronous original recipient read.
      // Re-observe the signed source before reporting availability.
      await state.readSource();
      const status=inFlight.has(plan.operationId)?"OPERATION_IN_PROGRESS":
        prior!==null||plan.status==="RECOVER_ONLY"||
        dispatched.has(plan.operationId)?"RECOVER_ONLY":"AVAILABLE";
      return Object.freeze({status,
        operationId:plan.operationId,recipientId:recipientId,
        reference:state.reference});
    },expectedContext);
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
          recipientId:recipientId,
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
        // Set before invoking the original native owner: failure may mean
        // that its durable write committed but the acknowledgement was lost.
        dispatched.add(operationId);
        try{
          await nativeOwner.receive({
            operationId,recipientId:recipientId,
            reference:copy(state.reference,"T3_D6_REFERENCE_NOT_CLONEABLE"),
            object:current,
          });
        }catch(error){
          // Recipient switches are definite binding refusals, not native ACK
          // loss. The prior attempted write is still never resent.
          recipientUnchanged();
          // A trusted installed owner can report an explicit, definite
          // refusal (for example, JIT project authorization before its write).
          // Do not disguise that refusal as lost ACK. An arbitrary error code
          // or transport failure is NOT proof that a write did not happen.
          // Keep dispatched set even for DENIED: only original durable owner
          // readback may permit a later independent attempt after cold open.
          rethrowDefiniteNativeRefusal(error);
          // An attempted native write can have committed without its ACK.
          // Do not resend it; the installed recipient owns cold recovery.
          return Object.freeze({status:"OUTCOME_UNKNOWN",operationId,
            reason:typeof error?.code==="string"?error.code:"UNCONFIRMED"});
        }
        // Native readback does not authorize the original signed source.
        // Keep D1 denials outside the uncertain native-write catch above.
        return observe(state.reference,operationId,state.readSource);
      }finally{
        inFlight.delete(operationId);
      }
    });
  }
  async function recover(input,expectedContext){
    return withSelectedSource(input,async state=>{
      const plan=await inspect(state);
      return observe(state.reference,plan.operationId,state.readSource);
    },expectedContext);
  }
  return Object.freeze({preview,continueSelected,recover});
}
