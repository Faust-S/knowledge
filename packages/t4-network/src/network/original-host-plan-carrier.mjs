import {createHash} from 'node:crypto';

/**
 * A T4 plan is carried as a normal original T3 Object in a dedicated
 * original T3 Workspace and through its EXISTING .iwxa Exchange.
 * It is NOT a new archive/format, a signer, an Access decision, or an
 * authorization for the recipient to apply any subject mutation.
 */
export class T4OriginalPlanCarrierError extends Error {
  constructor(code,details={}){
    super(code);this.name='T4OriginalPlanCarrierError';
    this.code=code;this.details=Object.freeze({...details});
  }
}
const fail=(code,details)=>{throw new T4OriginalPlanCarrierError(code,details);};
const SCHEMA='IWXA_T4_ORIGINAL_HOST_PLAN_CARRIER_V1';
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const HEX=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const SHA=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const sorted=x=>Array.isArray(x)?x.map(sorted):
  x&&typeof x==='object'?Object.fromEntries(Object.keys(x)
    .filter(k=>x[k]!==undefined).sort().map(k=>[k,sorted(x[k])])):x;
const canonical=x=>JSON.stringify(sorted(x));
const digest=x=>'sha256:'+createHash('sha256').update(canonical(x)).digest('hex');
const same=(a,b)=>canonical(a)===canonical(b);
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const stable=x=>Object.freeze(x);
const planDigest=p=>digest({frontier:p.initialCursor,
  entries:p.entries,sourceNodeRef:p.sourceNodeRef,
  networkTargetRef:p.networkTargetRef});
function checkPlan(p){
  if(p?.schema!=='IWXA_T4_ORIGINAL_HOST_RECIPIENT_PLAN_V1'||
    ![p.workspaceId,p.originalWriteOwnerRef,p.sourceNodeRef,
      p.networkTargetRef].every(ID)||
    !SHA(p.planDigest)||
    !Array.isArray(p.entries)||p.entries.length<1||p.entries.length>64||
    p.verifiedNetworkPrefixCount!==p.entries.length||
    p.originalHostSourceEventVerified!==true||
    p.originalHostNetworkCheckpointsVerified!==true||
    p.originalT3IsOnlySourceStore!==true||
    p.originalRecipientApplied!==false||
    p.recipientAuthorizationNotDerivedFromSourcePlan!==true||
    planDigest(p)!==p.planDigest)
    fail('PLAN_CARRIER_SOURCE_PLAN_INVALID');
  // A portable plan is read-only metadata. It cannot include T3 secrets,
  // arbitrary executable bindings or a fabricated proof of signature.
  const text=canonical(p);
  if(text.length>500000||
    p.entries.some(e=>!ID(e?.captureRef)||!ID(e?.subjectId)||
      !HEX(e.sha256)||e.key!==e.sha256+'.t4d'||
      !['OBJECT_PUT','ASSET_PUT','RELATION_PUT'].includes(e.kind)||
      e.window?.schema!=='IWXA_T4_ORIGINAL_EVENT_WINDOW_V1'||
      e.window.workspaceId!==p.workspaceId||
      e.window.originalWriteOwnerRef!==p.originalWriteOwnerRef))
    fail('PLAN_CARRIER_PAYLOAD_INVALID');
  return structuredClone(p);
}
const contextFields=['workspaceId','originalWriteOwnerRef','sourceNodeRef',
  'networkTargetRef','hostSessionRef'];
function contextValid(context,scope,carrierWorkspaceId){
  return context&&contextFields.every(k=>ID(context[k]))&&
    context.workspaceId===carrierWorkspaceId&&
    context.originalWriteOwnerRef===scope.originalWriteOwnerRef&&
    context.sourceNodeRef===scope.sourceNodeRef&&
    context.networkTargetRef===scope.networkTargetRef;
}
const snapshotContext=async(port,scope,carrierWorkspaceId)=>{
  const ctx=await port();
  if(!contextValid(ctx,scope,carrierWorkspaceId))
    fail('PLAN_CARRIER_ORIGINAL_HOST_CONTEXT_MISMATCH');
  return stable({...ctx});
};
async function recheck(port,scope,carrierWorkspaceId,initial){
  const after=await snapshotContext(port,scope,carrierWorkspaceId);
  if(!contextFields.every(k=>after[k]===initial[k]))
    fail('PLAN_CARRIER_ORIGINAL_HOST_CONTEXT_CHANGED',{
      originalWriteMayHaveCommitted:true,automaticRetryAllowed:false,
    });
}
const requireOriginalKernel=(kernel,operations)=>{
  if(typeof kernel?.hasOperation!=='function'||
    operations.some(op=>kernel.hasOperation(op)!==true||
      typeof kernel[op.slice(3)]!=='function'))
    fail('PLAN_CARRIER_ORIGINAL_T3_KERNEL_REQUIRED');
};
const guard=async(getMode,authorize,scope,step)=>{
  if(getMode()!=='T4_NETWORK')
    fail('PLAN_CARRIER_NETWORK_MODE_OFF');
  if(await authorize(stable({operation:step==='write'?
    't1.putObject':'t1.getObject',
    purpose:'original-t3.exchange-plan-carrier',
    carrierWorkspaceId:scope.carrierWorkspaceId,
    originalWriteOwnerRef:scope.originalWriteOwnerRef,
    sourceNodeRef:scope.sourceNodeRef,networkTargetRef:scope.networkTargetRef,
    originalT3AccessDecisionRequired:true,
    noNetworkDerivedAuthority:true}))!==true)
    fail('PLAN_CARRIER_ORIGINAL_HOST_AUTHORITY_DENIED',{step});
  if(getMode()!=='T4_NETWORK')
    fail('PLAN_CARRIER_NETWORK_MODE_OFF');
};
function carrierFromPlan(plan,carrierWorkspaceId,carrierObjectId){
  const p=checkPlan(plan);
  const value={
    schema:SCHEMA,title:'Original T3 exchange plan',
    sourceWorkspaceId:p.workspaceId,
    carrierWorkspaceId,carrierObjectId,
    originalWriteOwnerRef:p.originalWriteOwnerRef,
    sourceNodeRef:p.sourceNodeRef,networkTargetRef:p.networkTargetRef,
    sourcePlanDigest:p.planDigest,plan:p,
    networkReceiptIsNotBusinessResult:true,
    sourceAuthorizationNotProvidedByCarrier:true,
    recipientAuthorizationNotProvidedByCarrier:true,
    signedSourceProvenanceNotProven:true,
  };
  if(canonical(value).length>650000)
    fail('PLAN_CARRIER_DATA_LIMIT');
  return value;
}
function verifyCarrierRecord(record,scope,plan=null){
  const obj=record?.object,data=obj?.data;
  if(obj?.workspace_id!==scope.carrierWorkspaceId||
    obj.object_id!==scope.carrierObjectId||
    obj.schema_id!=='iwxa.demo.note'||
    obj.schema_version!=='1.0.0'||
    obj.deleted===true||
    !Number.isSafeInteger(obj.revision)||obj.revision<1||
    !data||data.schema!==SCHEMA||
    data.carrierWorkspaceId!==scope.sourceCarrierWorkspaceId&&
      data.carrierWorkspaceId!==scope.carrierWorkspaceId||
    data.carrierObjectId!==scope.carrierObjectId||
    data.sourceWorkspaceId!==scope.sourceWorkspaceId||
    data.originalWriteOwnerRef!==scope.originalWriteOwnerRef||
    data.sourceNodeRef!==scope.sourceNodeRef||
    data.networkTargetRef!==scope.networkTargetRef||
    data.sourceAuthorizationNotProvidedByCarrier!==true||
    data.recipientAuthorizationNotProvidedByCarrier!==true||
    data.signedSourceProvenanceNotProven!==true||
    data.networkReceiptIsNotBusinessResult!==true)
    fail('PLAN_CARRIER_ORIGINAL_T3_OBJECT_SCOPE_MISMATCH');
  checkPlan(data.plan);
  if(data.plan.workspaceId!==scope.sourceWorkspaceId||
    data.plan.originalWriteOwnerRef!==scope.originalWriteOwnerRef||
    data.plan.sourceNodeRef!==scope.sourceNodeRef||
    data.plan.networkTargetRef!==scope.networkTargetRef||
    data.sourcePlanDigest!==data.plan.planDigest||
    (plan!==null&&!same(plan,data.plan)))
    fail('PLAN_CARRIER_ORIGINAL_SOURCE_PLAN_MISMATCH');
  return {record:obj,plan:structuredClone(data.plan)};
}
export async function persistT4OriginalHostPlanCarrier({
  plan,carrierWorkspaceId,carrierObjectId,originalKernel,
  getMode,readOriginalHostContext,authorizeOriginalRead,
  authorizeOriginalWrite,
}={}){
  if(![carrierWorkspaceId,carrierObjectId].every(ID)||
    ![getMode,readOriginalHostContext,authorizeOriginalRead,
      authorizeOriginalWrite].every(f=>typeof f==='function'))
    fail('PLAN_CARRIER_ORIGINAL_SOURCE_PORTS_REQUIRED');
  requireOriginalKernel(originalKernel,['t1.putObject','t1.getObject',
    't1.listEventsSince']);
  const p=checkPlan(plan);
  const scope={...p,carrierWorkspaceId,carrierObjectId};
  const ctx=await snapshotContext(readOriginalHostContext,p,
    carrierWorkspaceId);
  await guard(getMode,authorizeOriginalRead,scope,'read');
  const existing=await originalKernel.getObject(carrierWorkspaceId,
    carrierObjectId);
  if(existing!==null&&existing!==undefined)
    fail('PLAN_CARRIER_ALREADY_EXISTS_NO_OVERWRITE');
  await guard(getMode,authorizeOriginalWrite,scope,'write');
  const data=carrierFromPlan(p,carrierWorkspaceId,carrierObjectId);
  const input={workspace_id:carrierWorkspaceId,object_id:carrierObjectId,
    schema_id:'iwxa.demo.note',schema_version:'1.0.0',
    data,extensions:{},base_revision:0,
    event:{event_type:'t4.original.host.plan.carried',
      payload:{sourcePlanDigest:p.planDigest,
        sourceWorkspaceId:p.workspaceId,networkTargetRef:p.networkTargetRef,
        carrierWorkspaceId,carrierObjectId}},
  };
  let receipt;
  try{receipt=await originalKernel.putObject(input);}
  catch(error){
    fail('PLAN_CARRIER_ORIGINAL_T3_WRITE_OUTCOME_UNKNOWN',{
      originalCode:error?.code??null,originalWriteMayHaveCommitted:true,
      automaticRetryAllowed:false,
    });
  }
  await recheck(readOriginalHostContext,p,carrierWorkspaceId,ctx);
  await guard(getMode,authorizeOriginalRead,scope,'read');
  const readback=await originalKernel.getObject(carrierWorkspaceId,
    carrierObjectId);
  const checked=verifyCarrierRecord(readback,{
    ...scope,sourceWorkspaceId:p.workspaceId,
  },p);
  if(checked.record.revision!==1||
    receipt?.object?.revision!==1||
    receipt?.event?.event_type!=='t4.original.host.plan.carried'||
    !ID(receipt.event.event_id))
    fail('PLAN_CARRIER_ORIGINAL_T3_WRITE_RECEIPT_INVALID');
  const events=await originalKernel.listEventsSince(carrierWorkspaceId);
  // Released T3 0.3.6 does NOT persist putObject's optional
  // idempotency_key on this route. Correlate its REAL Event by the exact
  // receipt Event ID, object scope, revision and uniquely bound payload,
  // never synthesize a missing idempotency key or replay putObject.
  const matches=events?.filter(e=>e.event_id===receipt.event.event_id&&
    e.event_type===input.event.event_type&&
    e.workspace_id===carrierWorkspaceId&&
    e.object_id===carrierObjectId&&e.revision===1&&
    e.payload?.sourcePlanDigest===p.planDigest&&
    e.payload?.sourceWorkspaceId===p.workspaceId&&
    e.payload?.networkTargetRef===p.networkTargetRef&&
    e.payload?.carrierWorkspaceId===carrierWorkspaceId&&
    e.payload?.carrierObjectId===carrierObjectId);
  if(matches?.length!==1)
    fail('PLAN_CARRIER_ORIGINAL_T3_EVENT_NOT_PROVEN');
  await recheck(readOriginalHostContext,p,carrierWorkspaceId,ctx);
  return stable({
    schema:'IWXA_T4_ORIGINAL_HOST_PLAN_CARRIER_STORED_V1',
    carrierWorkspaceId,carrierObjectId,sourceWorkspaceId:p.workspaceId,
    originalWriteOwnerRef:p.originalWriteOwnerRef,
    networkTargetRef:p.networkTargetRef,
    sourcePlanDigest:p.planDigest,originalT3EventId:receipt.event.event_id,
    originalT3ObjectRevision:1,
    originalT3ObjectAndEventReadback:true,
    requiresOriginalT3ExchangeExport:true,
    signedSourceProvenanceNotProven:true,
    recipientBusinessApplicationAuthorized:false,
    originalT3OnlyStore:true,
  });
}
export async function inspectT4OriginalHostImportedPlanCarrier({
  carrierWorkspaceId,sourceCarrierWorkspaceId,carrierObjectId,
  sourceWorkspaceId,originalWriteOwnerRef,networkTargetRef,sourceNodeRef,
  originalKernel,originalImportReceipt,expectedPackageDigest,
  expectedSourcePlanDigest,readOriginalHostContext,getMode,
  authorizeOriginalRead,readOriginalImportReceipt,
}={}){
  const scope={carrierWorkspaceId,sourceCarrierWorkspaceId,
    carrierObjectId,sourceWorkspaceId,
    originalWriteOwnerRef,networkTargetRef,sourceNodeRef};
  if(![carrierWorkspaceId,sourceCarrierWorkspaceId,
    carrierObjectId,sourceWorkspaceId,originalWriteOwnerRef,
    networkTargetRef,sourceNodeRef].every(ID)||
    ![readOriginalHostContext,getMode,authorizeOriginalRead,
      readOriginalImportReceipt].every(f=>typeof f==='function')||
    !SHA(expectedSourcePlanDigest)||
    typeof expectedPackageDigest!=='string'||!expectedPackageDigest.length)
    fail('PLAN_CARRIER_ORIGINAL_RECIPIENT_PORTS_REQUIRED');
  requireOriginalKernel(originalKernel,['t1.getObject']);
  const ctx=await snapshotContext(readOriginalHostContext,scope,
    carrierWorkspaceId);
  const receipt=originalImportReceipt;
  if(receipt?.format!=='iwxa.import.receipt'||
    receipt.cancelled===true||
    receipt.package_digest!==expectedPackageDigest||
    !ID(receipt.import_id)||!Number.isFinite(Date.parse(receipt.committed_at))||
    !['full','selective','merge'].includes(receipt.mode)||
    !Number.isSafeInteger(receipt.applied?.objects_inserted)||
    receipt.applied.objects_inserted<1||
    !Array.isArray(receipt.skipped_conflicts)||
    receipt.skipped_conflicts.length!==0)
    fail('PLAN_CARRIER_ORIGINAL_EXCHANGE_COMMIT_REQUIRED');
  if(sourceCarrierWorkspaceId!==carrierWorkspaceId){
    if(receipt.mode!=='merge')
      fail('PLAN_CARRIER_ORIGINAL_IMPORT_WORKSPACE_MAP_INVALID');
    const map=receipt.workspace_id_map;
    if(map&&Object.keys(map).length>0&&
      (Object.keys(map).length!==1||
        map[sourceCarrierWorkspaceId]!==carrierWorkspaceId))
      fail('PLAN_CARRIER_ORIGINAL_IMPORT_WORKSPACE_MAP_INVALID');
  }else if(receipt.mode==='merge') {
    fail('PLAN_CARRIER_ORIGINAL_IMPORT_WORKSPACE_MAP_INVALID');
  }
  // An imported Object is not evidence that the original Kernel's
  // importCommit receipt survived. The Host must persist that ORIGINAL
  // receipt in the ORIGINAL recipient T3 technical Workspace and expose
  // a fresh read of it. A caller-supplied receipt alone is insufficient.
  const readReceipt=async()=>{
    await guard(getMode,authorizeOriginalRead,scope,'read');
    const stored=await readOriginalImportReceipt(stable({
      carrierWorkspaceId,carrierObjectId,importId:receipt.import_id,
      packageDigest:expectedPackageDigest,
      originalT3ReceiptReadRequired:true,
    }));
    if(!same(stored,receipt))
      fail('PLAN_CARRIER_ORIGINAL_IMPORT_RECEIPT_NOT_DURABLE');
  };
  await readReceipt();
  await guard(getMode,authorizeOriginalRead,scope,'read');
  const first=await originalKernel.getObject(carrierWorkspaceId,
    carrierObjectId);
  const {record,plan}=verifyCarrierRecord(first,scope);
  if(plan.planDigest!==expectedSourcePlanDigest)
    fail('PLAN_CARRIER_ORIGINAL_IMPORTED_DIGEST_MISMATCH');
  await guard(getMode,authorizeOriginalRead,scope,'read');
  const second=await originalKernel.getObject(carrierWorkspaceId,
    carrierObjectId);
  const verified=verifyCarrierRecord(second,scope,plan);
  if(verified.record.revision!==record.revision)
    fail('PLAN_CARRIER_ORIGINAL_IMPORTED_OBJECT_CHANGED');
  await readReceipt();
  await recheck(readOriginalHostContext,scope,carrierWorkspaceId,ctx);
  return stable({
    schema:'IWXA_T4_ORIGINAL_HOST_IMPORTED_PLAN_INSPECTION_V1',
    carrierWorkspaceId,carrierObjectId,sourceWorkspaceId,
    originalWriteOwnerRef,sourceNodeRef,networkTargetRef,
    sourcePlanDigest:plan.planDigest,plan,
    originalT3ImportId:receipt.import_id,
    originalT3ImportPackageDigest:receipt.package_digest,
    originalT3ImportCommitVerified:true,
    originalT3ImportReceiptDurableReadback:true,
    originalT3ObjectReadbackVerified:true,
    originalT3SelectedContextUnchanged:true,
    originalT3OnlyStore:true,
    originalT3ExchangeOnly:true,
    recipientBusinessApplicationAuthorized:false,
    signedSourceProvenanceNotProven:true,
    mayInvokeRecipientDispatcher:false,
  });
}

/**
 * Lost source putObject ACK recovery. Original T3 putObject on this route
 * does not persist the optional idempotency_key; the recovery MUST match
 * the one exact original Event and the original stored preimage instead.
 * This method never calls putObject or fabricates its transaction receipt.
 */
export async function reconcileT4OriginalHostPlanCarrier({
  plan,carrierWorkspaceId,carrierObjectId,originalKernel,
  getMode,readOriginalHostContext,authorizeOriginalRead,
}={}){
  if(![carrierWorkspaceId,carrierObjectId].every(ID)||
    ![getMode,readOriginalHostContext,authorizeOriginalRead]
      .every(f=>typeof f==='function'))
    fail('PLAN_CARRIER_ORIGINAL_SOURCE_PORTS_REQUIRED');
  requireOriginalKernel(originalKernel,['t1.getObject','t1.listEventsSince']);
  const p=checkPlan(plan);
  const scope={...p,carrierWorkspaceId,carrierObjectId,
    sourceWorkspaceId:p.workspaceId};
  const context=await snapshotContext(readOriginalHostContext,p,
    carrierWorkspaceId);
  await guard(getMode,authorizeOriginalRead,scope,'read');
  const first=await originalKernel.getObject(carrierWorkspaceId,
    carrierObjectId);
  const {record}=verifyCarrierRecord(first,scope,p);
  if(record.revision!==1)
    fail('PLAN_CARRIER_ORIGINAL_SOURCE_REVISION_CHANGED');
  await guard(getMode,authorizeOriginalRead,scope,'read');
  const rows=await originalKernel.listEventsSince(carrierWorkspaceId);
  if(!Array.isArray(rows)||rows.length>100000)
    fail('PLAN_CARRIER_ORIGINAL_T3_EVENT_LIST_INVALID');
  const matching=rows.filter(e=>
    ID(e?.event_id)&&e.event_type==='t4.original.host.plan.carried'&&
    e.workspace_id===carrierWorkspaceId&&
    e.object_id===carrierObjectId&&e.revision===1&&
    e.payload?.sourcePlanDigest===p.planDigest&&
    e.payload?.sourceWorkspaceId===p.workspaceId&&
    e.payload?.carrierWorkspaceId===carrierWorkspaceId&&
    e.payload?.carrierObjectId===carrierObjectId&&
    e.payload?.networkTargetRef===p.networkTargetRef);
  if(matching.length!==1)
    fail('PLAN_CARRIER_ORIGINAL_T3_EVENT_NOT_PROVEN');
  await guard(getMode,authorizeOriginalRead,scope,'read');
  const second=await originalKernel.getObject(carrierWorkspaceId,
    carrierObjectId);
  const checked=verifyCarrierRecord(second,scope,p);
  if(checked.record.revision!==record.revision)
    fail('PLAN_CARRIER_ORIGINAL_SOURCE_REVISION_CHANGED');
  await recheck(readOriginalHostContext,p,carrierWorkspaceId,context);
  return stable({
    schema:'IWXA_T4_ORIGINAL_HOST_PLAN_CARRIER_RECONCILED_V1',
    carrierWorkspaceId,carrierObjectId,
    sourceWorkspaceId:p.workspaceId,
    originalWriteOwnerRef:p.originalWriteOwnerRef,
    sourcePlanDigest:p.planDigest,
    originalT3EventId:matching[0].event_id,
    originalT3ObjectAndEventReadback:true,
    originalT3WriteAlreadyCommitted:true,
    originalT3WriteRetried:false,
    originalReceiptRecreated:false,
    originalT3OnlyStore:true,
    signedSourceProvenanceNotProven:true,
    recipientBusinessApplicationAuthorized:false,
    requiresOriginalT3ExchangeExport:true,
  });
}
