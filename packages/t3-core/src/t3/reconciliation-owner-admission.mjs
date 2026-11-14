// D3 trusted Host adapter to the EXISTING recipient-owned Reconciliation.
// Not a parser, ledger, signer, grant issuer, Result writer or Apply engine.
// The actual OfflinePackageReconciler remains with its authorized product owner.
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const HEX=/^[a-f0-9]{64}$/;
function fail(code){
  throw Object.assign(new Error(code),{code,outcome:"DENIED"});
}
function check(ok,code){if(!ok)fail(code);}
function key(value){return typeof value==="string"&&ID.test(value);}
function hex(value){return typeof value==="string"&&HEX.test(value);}
function snapshot(value,code){
  try{return structuredClone(value);}
  catch{fail(code);}
}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}

export function createTrustedReconciliationAdmission({
  reconciler,currentContext,recipientForContext,confirmHumanReview,
  isHostActive,
}={}){
  check(reconciler&&["receive","preview","accept","reject","receipt",
    "inspectApplicationProjection"].every(name=>typeof reconciler[name]==="function")&&
    key(reconciler.recipientId),"T3_D3_ORIGINAL_RECONCILER_REQUIRED");
  check(typeof currentContext==="function"&&
    typeof recipientForContext==="function"&&
    typeof confirmHumanReview==="function"&&
    typeof isHostActive==="function",
    "T3_D3_TRUSTED_OWNER_REQUIRED");

  async function selected(){
    check(isHostActive()===true,"T3_HOST_DISPOSED");
    const context=snapshot(await currentContext(),"T3_D3_CONTEXT_NOT_CLONEABLE");
    check(context&&["PERSONAL","CORP"].includes(context.kind)&&
      ["context_id","actor_id","principal_id","role_id","grant_id",
        "workspace_id","resource"].every(field=>key(context[field]))&&
      context.resource===context.workspace_id&&
      Number.isSafeInteger(context.scope_revision)&&context.scope_revision>0,
      "T3_D3_SIGNED_CONTEXT_REQUIRED");
    const recipient=await recipientForContext(snapshot(context,"T3_D3_CONTEXT_NOT_CLONEABLE"));
    check(isHostActive()===true,"T3_HOST_DISPOSED");
    check(key(recipient)&&recipient===reconciler.recipientId,
      "T3_D3_SELECTED_RECIPIENT_MISMATCH");
    return {context,recipient};
  }
  async function recheck(initial){
    const current=await selected();
    check(same(current,initial),"T3_D3_SELECTED_CONTEXT_CHANGED");
  }
  function checkedPreview(value,packageSha256){
    check(value?.schema==="IWXA_T3_RECONCILIATION_PREVIEW/1"&&
      value.packageSha256===packageSha256&&hex(value.previewDigest)&&
      typeof value.allowedAction==="string",
      "T3_D3_ORIGINAL_PREVIEW_INVALID");
    return value;
  }
  async function preview(packageSha256){
    check(hex(packageSha256),"T3_D3_PACKAGE_DIGEST_REQUIRED");
    const initial=await selected();
    const result=checkedPreview(await reconciler.preview(packageSha256),packageSha256);
    await recheck(initial);
    return snapshot(result,"T3_D3_PREVIEW_NOT_CLONEABLE");
  }
  async function receive(bytes){
    check(bytes instanceof Uint8Array&&bytes.byteLength>0&&
      bytes.byteLength<=200*1024*1024,"T3_D3_ORIGINAL_IWXA_BYTES_REQUIRED");
    const immutable=snapshot(bytes,"T3_D3_CARRIER_NOT_CLONEABLE");
    const initial=await selected();
    // Owner validates the actual signed carrier and stores it in its OWN
    // reconciliation ledger. A transport receipt is never ACCEPT or APPLY.
    const received=await reconciler.receive(immutable);
    const digest=received?.preview?.packageSha256;
    check(hex(digest),"T3_D3_ORIGINAL_RECEIVE_INVALID");
    const fresh=checkedPreview(await reconciler.preview(digest),digest);
    check(fresh.previewDigest===received.preview.previewDigest,
      "T3_D3_PREVIEW_CHANGED_DURING_RECEIVE");
    await recheck(initial);
    return Object.freeze({
      transportReceipt:snapshot(received.transportReceipt,"T3_D3_TRANSPORT_RECEIPT_INVALID"),
      preview:snapshot(fresh,"T3_D3_PREVIEW_NOT_CLONEABLE"),
      acceptanceState:"NOT_ACCEPTED",
      kernelApplication:"NOT_APPLIED",
    });
  }
  async function decide(kind,{packageSha256,previewDigest,operationId,
    decisionBy,reason}={}){
    check(hex(packageSha256)&&hex(previewDigest)&&key(operationId)&&
      key(decisionBy)&&(kind!=="REJECT"||
        (typeof reason==="string"&&reason.trim().length>0&&reason.length<=1000)),
      "T3_D3_EXPLICIT_DECISION_REQUIRED");
    const initial=await selected();
    check(initial.context.actor_id===decisionBy,"T3_D3_DECISION_ACTOR_MISMATCH");
    const latest=checkedPreview(await reconciler.preview(packageSha256),packageSha256);
    check(latest.previewDigest===previewDigest,
      "T3_D3_PREVIEW_STALE");
    if(kind==="ACCEPT")check(latest.allowedAction==="EXPLICIT_ACCEPT_ONLY",
      "T3_D3_ORIGINAL_ACCEPTANCE_NOT_ELIGIBLE");
    // The trusted product's HUMAN reviewer must independently approve this
    // exact choice. Incoming carrier fields and transport ACKs do not count.
    const reviewed=await confirmHumanReview(Object.freeze({
      decision:kind,packageSha256,previewDigest,operationId,decisionBy,
      ...(kind==="REJECT"?{reason}:{}),
      context:snapshot(initial.context,"T3_D3_CONTEXT_NOT_CLONEABLE"),
      preview:snapshot(latest,"T3_D3_PREVIEW_NOT_CLONEABLE"),
    }));
    check(reviewed===true,"T3_D3_HUMAN_REVIEW_REQUIRED");
    await recheck(initial);
    // The original owner re-evaluates signed source status, revision,
    // acceptance grant and its own locked ledger at the decision JIT.
    const receipt=kind==="ACCEPT"
      ?await reconciler.accept(packageSha256,{operationId,previewDigest,decisionBy})
      :await reconciler.reject(packageSha256,{operationId,previewDigest,decisionBy,reason});
    // After entering the owner this decision MAY already be committed.
    // Never retry automatically on an exception or an uncertain readback.
    const freshReceipt=await reconciler.receipt(operationId);
    check(receipt&&freshReceipt&&same(receipt,freshReceipt)&&
      receipt.packageSha256===packageSha256&&receipt.operationId===operationId&&
      receipt.decisionBy===decisionBy,
      "T3_D3_ORIGINAL_DECISION_READBACK_NOT_CONFIRMED");
    if(kind==="ACCEPT"){
      check(receipt.schema==="IWXA_T3_ACCEPTANCE_RECEIPT/1"&&
        receipt.acceptanceState==="ACCEPTED"&&
        receipt.appliedScope==="RECONCILIATION_LEDGER_ONLY"&&
        receipt.externalContextCoreApplied===false,
        "T3_D3_ACCEPTED_NOT_ORIGINAL_KERNEL_APPLICATION");
    }else check(receipt.schema==="IWXA_T3_REJECTION_RECEIPT/1"&&
      receipt.acceptanceState==="REJECTED"&&
      receipt.applicationState==="NOT_APPLIED",
      "T3_D3_REJECTION_RECEIPT_INVALID");
    await recheck(initial);
    return Object.freeze({
      receipt:snapshot(freshReceipt,"T3_D3_ORIGINAL_RECEIPT_NOT_CLONEABLE"),
      acceptanceState:kind==="ACCEPT"?"ACCEPTED":"REJECTED",
      kernelApplication:"NOT_APPLIED",
      requiresSeparateApply:kind==="ACCEPT",
    });
  }
  async function inspectAcceptedApplication({acceptanceId,revisionIds,target}={}){
    check(hex(acceptanceId)&&Array.isArray(revisionIds)&&
      revisionIds.length>0&&revisionIds.length<=32&&
      revisionIds.every(hex)&&new Set(revisionIds).size===revisionIds.length&&
      target&&typeof target==="object"&&!Array.isArray(target),
      "T3_D3_APPLICATION_SELECTION_REQUIRED");
    const initial=await selected();
    check(target.workspaceId===initial.context.workspace_id,
      "T3_D3_APPLICATION_TARGET_OUT_OF_SCOPE");
    const candidate=await reconciler.inspectApplicationProjection({
      acceptanceId,revisionIds:[...revisionIds],target:snapshot(target,"T3_D3_TARGET_NOT_CLONEABLE")
    });
    check(candidate?.schema==="IWXA_T3_APPLICATION_PROJECTION_CANDIDATE/1"&&
      candidate.status==="CANDIDATE_REQUIRES_INDEPENDENT_HOST_AUTHORIZATION"&&
      candidate.applicationAuthorized===false&&
      candidate.applicationAttempted===false&&
      candidate.externalContextCoreApplied===false&&
      candidate.target?.workspaceId===initial.context.workspace_id&&
      candidate.source?.acceptanceId===acceptanceId,
      "T3_D3_ORIGINAL_APPLICATION_NOT_CURRENT");
    await recheck(initial);
    return snapshot(candidate,"T3_D3_CANDIDATE_NOT_CLONEABLE");
  }
  return Object.freeze({
    receive,preview,
    accept:input=>decide("ACCEPT",input),
    reject:input=>decide("REJECT",input),
    inspectAcceptedApplication,
  });
}
