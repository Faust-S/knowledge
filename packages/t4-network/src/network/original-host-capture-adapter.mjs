import {originalHostLifetimeMode} from './original-host-lifetime.mjs';
import {readT4OriginalEventWindow} from './original-event-window.mjs';
import {readT4OriginalHostCaptureFrontier} from './original-host-capture-frontier.mjs';
import {runT4OriginalSubjectMutationBoundary} from './original-deletion-delta.mjs';
import {captureT4OriginalObjectMutation} from './original-object-mutation-capture.mjs';
import {captureT4OriginalGraphMutation,reconcileT4OriginalGraphMutation} from './original-graph-delta.mjs';
import {reconcileT4OriginalMutationIntent} from './original-object-intent-recovery.mjs';
import {captureT4OriginalHostSubjectMutation,
  reconcileT4OriginalHostSubjectMutation,captureT4OriginalHostSubjectDeletion,
  reconcileT4OriginalHostSubjectDeletion} from './original-host-subject-capture.mjs';

export class T4OriginalHostCaptureAdapterError extends Error{
  constructor(code){super(code);this.name='T4OriginalHostCaptureAdapterError';this.code=code;}
}
const fail=code=>{throw new T4OriginalHostCaptureAdapterError(code);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);

export function createT4OriginalHostCaptureAdapter({
  originalKernel,originalWriteOwnerRef,getMode,
  authorizeOriginalRead,authorizeOriginalWrite,readOriginalEvents,
  readOriginalCommitPage,withOriginalHistoryReadBoundary,originalCommitPageSize=256,
  persistOriginalIntent,readOriginalIntent,
  persistOriginalOutbox,readOriginalOutbox,withOriginalSubjectMutation,readOriginalDependencyCoverage,
  listOriginalPendingIntents,authorizeOriginalCaptureRecovery,
  readOriginalAdmittedBaseline,listOriginalOutbox,resolveOriginalRelationOwner,readOriginalCaptureInventory,
  isHostActive=()=>true,
}={}){
  if(typeof getMode!=='function'||
    typeof originalKernel?.hasOperation!=='function'||
    originalKernel.hasOperation('t1.putObject')!==true||
    typeof originalKernel.putObject!=='function')
    fail('ORIGINAL_HOST_T3_WRITE_PORT_REQUIRED');
  const paged=readOriginalCommitPage!==undefined||withOriginalHistoryReadBoundary!==undefined;
  if(paged&&(![readOriginalCommitPage,withOriginalHistoryReadBoundary].every(f=>typeof f==='function')||
    !Number.isSafeInteger(originalCommitPageSize)||originalCommitPageSize<1||originalCommitPageSize>1024))
    fail('ORIGINAL_HOST_CAPTURE_COMMIT_HISTORY_PORTS_REQUIRED');
  let disposed=false;
  const guardedMode=originalHostLifetimeMode(getMode,()=>!disposed&&isHostActive()===true,
    'ORIGINAL_HOST_CAPTURE_DISPOSED');
  const mode=()=>{
    const m=guardedMode();
    if(m!=='LOCAL_T3'&&m!=='T4_NETWORK')
      fail('ORIGINAL_HOST_CAPTURE_MODE_UNKNOWN');
    return m;
  };
  const hostCapturePorts=()=>({
    originalKernel,originalWriteOwnerRef,getMode:mode,
    authorizeOriginalRead,authorizeOriginalWrite,readOriginalEvents,
    ...(paged?{readOriginalCommitPage,withOriginalHistoryReadBoundary,originalCommitPageSize}:{}),
    persistOriginalIntent,readOriginalIntent,
    persistOriginalOutbox,readOriginalOutbox,withOriginalSubjectMutation,readOriginalDependencyCoverage,
  });
  const requiredOriginalHostCapturePorts=()=>{
    if(!ID(originalWriteOwnerRef)||
      [authorizeOriginalRead,authorizeOriginalWrite,readOriginalEvents,
        persistOriginalIntent,readOriginalIntent,persistOriginalOutbox,
        readOriginalOutbox].some(f=>typeof f!=='function'))
      fail('ORIGINAL_HOST_T4_CAPTURE_PORTS_REQUIRED');
  };
  // Native Host composition supplies its existing admitted baseline and
  // ledger. Old explicit-cursor adapters remain available for existing tests
  // and manual routes; an automatic route cannot skip a pending capture.
  async function selectCaptureCursor(proof,supplied){
    if(readOriginalAdmittedBaseline!==undefined){
      const {sourceCursor}=await readT4OriginalHostCaptureFrontier({
        ...hostCapturePorts(),workspaceId:proof.workspaceId,
        readOriginalAdmittedBaseline,listOriginalOutbox,listOriginalPendingIntents,readOriginalCaptureInventory,
      });
      if(supplied!==undefined&&supplied!==null&&
        (supplied.lastEventId!==sourceCursor.lastEventId||
         supplied.sourcePrefixDigest!==sourceCursor.sourcePrefixDigest||
         supplied.seenEventCount!==sourceCursor.seenEventCount||
         supplied.workspaceId!==sourceCursor.workspaceId||
         supplied.originalWriteOwnerRef!==sourceCursor.originalWriteOwnerRef))
        fail('ORIGINAL_HOST_CAPTURE_SOURCE_CURSOR_STALE');
      return sourceCursor;
    }
    if(supplied?.schema!=='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1'||
      supplied.workspaceId!==proof.workspaceId||supplied.originalWriteOwnerRef!==originalWriteOwnerRef)
      fail('ORIGINAL_HOST_CAPTURE_SOURCE_CURSOR_REQUIRED');
    return supplied;
  }
  // Use the original Host's workspace-wide mutation executor, not a new
  // T4 lock. Validate the capture position inside that boundary before
  // creating an Intent or invoking the subject operation. The network ACK
  // cursor is not a valid substitute for the current capture cursor.
  async function serializePut(kind,operation,subjectId,{mutationInput,sourceCursor,captureRef},capture){
    if(typeof withOriginalSubjectMutation!=='function')
      fail('ORIGINAL_HOST_CAPTURE_MUTATION_BOUNDARY_REQUIRED');
    const workspaceId=mutationInput.workspace_id;
    // Snapshot before entering an asynchronous Host boundary. A caller
    // retaining an Asset byte array cannot change the admitted operation.
    const exact=structuredClone(mutationInput),supplied=structuredClone(sourceCursor);
    const proof=Object.freeze({kind,operation,workspaceId,subjectId,captureRef,originalWriteOwnerRef,
      originalHostMustSerializeSubjectMutations:true,
      originalHostMustSerializeAllWorkspaceGraphMutations:true,
      originalMutationRecoveryOnly:false,networkIsNotOriginalGrant:true});
    const result=await runT4OriginalSubjectMutationBoundary(withOriginalSubjectMutation,proof,async()=>{
      if(mode()!=='T4_NETWORK')fail('ORIGINAL_HOST_CAPTURE_MODE_CHANGED');
      const cursor=await selectCaptureCursor(proof,supplied);
      const {window}=await readT4OriginalEventWindow({
        workspaceId,originalWriteOwnerRef,cursor,maxEvents:1,
        authorizeOriginalRead:async guard=>{
          if(mode()!=='T4_NETWORK')fail('ORIGINAL_HOST_CAPTURE_MODE_CHANGED');
          const allowed=await authorizeOriginalRead({...proof,...guard});
          if(mode()!=='T4_NETWORK')fail('ORIGINAL_HOST_CAPTURE_MODE_CHANGED');
          return allowed;
        },
        ...(paged?{readOriginalCommitPage,withOriginalHistoryReadBoundary,pageSize:originalCommitPageSize}:{readOriginalEvents}),
      });
      if(window.count!==0)fail('ORIGINAL_HOST_CAPTURE_SOURCE_CURSOR_STALE');
      if(mode()!=='T4_NETWORK')fail('ORIGINAL_HOST_CAPTURE_MODE_CHANGED');
      return capture(exact,cursor);
    });
    if(mode()!=='T4_NETWORK')fail('ORIGINAL_HOST_CAPTURE_MODE_CHANGED');
    return result;
  }
  async function deleteSubject(kind,{mutationInput,sourceCursor,captureRef,fromObjectId}={}){
    const operation=kind==='ASSET_DELETE'?'deleteAsset':kind==='OBJECT_DELETE'?'deleteObject':'deleteRelation';
    if(originalKernel.hasOperation('t1.'+operation)!==true||
      typeof originalKernel[operation]!=='function')
      fail('ORIGINAL_HOST_T3_DELETE_SUBJECT_PORT_REQUIRED');
    if(!mutationInput||typeof mutationInput!=='object')
      fail('ORIGINAL_HOST_MUTATION_REQUIRED');
    if(mode()==='LOCAL_T3'){
      const originalReceipt=await originalKernel[operation](mutationInput);
      mode();
      return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_SUBJECT_DELETE_RESULT_V1',
        subjectKind:kind,t4Mode:'LOCAL_T3',originalReceipt,capture:null,
        originalT3OperationUsed:true,originalHostUnchanged:true,networkPublished:false});
    }
    requiredOriginalHostCapturePorts();
    if(!ID(captureRef)||!ID(mutationInput.workspace_id))
      fail('ORIGINAL_HOST_T4_MUTATION_SCOPE_REQUIRED');
    const exact=structuredClone(mutationInput),supplied=structuredClone(sourceCursor);
    const capture=await captureT4OriginalHostSubjectDeletion({...hostCapturePorts(),
      kind,workspaceId:exact.workspace_id,mutationInput:exact,sourceCursor:supplied,captureRef,fromObjectId,
      ...(resolveOriginalRelationOwner===undefined?{}:{resolveOriginalRelationOwner}),
      ...(readOriginalAdmittedBaseline===undefined?{}:{
        resolveOriginalCaptureCursor:proof=>selectCaptureCursor(proof,supplied),
      })});
    mode();
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_SUBJECT_DELETE_RESULT_V1',
      subjectKind:kind,t4Mode:'T4_NETWORK',originalReceipt:capture.originalReceipt,capture,
      originalT3OperationUsed:true,originalHostUnchanged:true,networkPublished:false});
  }
  async function reconcileDeletion(kind,{captureRef,workspaceId,subjectId}={}){
    if(mode()!=='T4_NETWORK')fail('ORIGINAL_HOST_RECOVERY_REQUIRES_T4');
    requiredOriginalHostCapturePorts();
    if(![captureRef,workspaceId,subjectId].every(ID))
      fail('ORIGINAL_HOST_T4_MUTATION_SCOPE_REQUIRED');
    return reconcileT4OriginalHostSubjectDeletion({...hostCapturePorts(),
      kind,captureRef,workspaceId,subjectId});
  }
  // One recovery step for an existing original Host task. The immutable
  // Intent inventory is not a retry queue. Only a proven original Event and
  // current subject readback may produce a missing Outbox; no subject
  // mutation or fabricated original operation receipt is ever returned.
  async function reconcileNextOriginalCapture({workspaceId,expectedOriginalSourceEventId=null}={}){
    if(mode()!=='T4_NETWORK')fail('ORIGINAL_HOST_RECOVERY_REQUIRES_T4');
    requiredOriginalHostCapturePorts();
    if(!ID(workspaceId)||(expectedOriginalSourceEventId!==null&&!ID(expectedOriginalSourceEventId))||
      typeof listOriginalPendingIntents!=='function'||
      typeof authorizeOriginalCaptureRecovery!=='function'||typeof withOriginalSubjectMutation!=='function')
      fail('ORIGINAL_HOST_CAPTURE_RECOVERY_PORTS_REQUIRED');
    const query=Object.freeze({workspaceId,originalWriteOwnerRef});
    const result=(state,extra={})=>Object.freeze({
      schema:'IWXA_T4_ORIGINAL_HOST_CAPTURE_RECOVERY_STEP_V1',state,...query,
      originalSubjectMutationInvoked:false,originalMutationRetried:false,
      originalOperationReceiptRecreated:false,sourceCursorAdvanced:false,
      networkPublished:false,createsScheduler:false,createsStore:false,...extra});
    const operations={OBJECT_PUT:'t1.putObject',ASSET_PUT:'t1.putAsset',RELATION_PUT:'t1.putRelation',
      OBJECT_DELETE:'t1.deleteObject',ASSET_DELETE:'t1.deleteAsset',RELATION_DELETE:'t1.deleteRelation',
      GRAPH_COMMIT:'t1.commitObjectGraph'};
    const readPending=async()=>{
      mode();
      const rows=await listOriginalPendingIntents(query);mode();
      if(!Array.isArray(rows)||rows.length>4096||new Set(rows.map(r=>r?.captureRef)).size!==rows.length||
        rows.some(r=>r?.workspaceId!==workspaceId||r.originalWriteOwnerRef!==originalWriteOwnerRef||
          !Object.hasOwn(operations,r.kind)||!ID(r.captureRef)||!ID(r.subjectId)||!ID(r.originalIntentEventId)||
          !/^sha256:[a-f0-9]{64}$/.test(r.originalIntentRecordDigest)||
          r.state!=='ORIGINAL_MUTATION_OUTCOME_REQUIRES_RECONCILIATION'||
          r.automaticSubjectMutationAllowed!==false))
        fail('ORIGINAL_HOST_CAPTURE_RECOVERY_INVENTORY_INVALID');
      return rows;
    };
    const rows=await readPending();
    if(rows.length===0)return result('NO_PENDING_ORIGINAL_CAPTURE',{pendingCaptureCount:0});
    // The original Host must resolve any violation of its single-writer
    // capture boundary explicitly. Do not choose an intent by timestamp.
    if(rows.length!==1)return result('ORIGINAL_CAPTURE_RECONCILIATION_AMBIGUOUS',{
      pendingCaptureCount:rows.length});
    const pending=structuredClone(rows[0]);
    const {captureRef,kind,subjectId}=pending,operation=operations[kind];
    const boundary=Object.freeze({...query,captureRef,kind,subjectId,operation,
      originalHostMustSerializeSubjectMutations:true,
      originalHostMustSerializeAllWorkspaceGraphMutations:true,
      originalMutationRecoveryOnly:true,networkIsNotOriginalGrant:true});
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    // This check runs INSIDE the original Host's exclusion boundary.
    // It does not infer any business outcome from absence of an Event.
    async function inspect(){
      mode();
      const current=await readPending();
      if(current.length!==1||!same(current[0],pending))
        fail('ORIGINAL_HOST_CAPTURE_RECOVERY_INVENTORY_CHANGED');
      const permission=Object.freeze({...boundary,originalIntentEventId:pending.originalIntentEventId,
        originalIntentRecordDigest:pending.originalIntentRecordDigest});
      if(await authorizeOriginalCaptureRecovery(permission)!==true||
        await authorizeOriginalRead({...query,captureRef,operation:'t1.listEventsSince'})!==true||
        await authorizeOriginalWrite(boundary)!==true)
        fail('ORIGINAL_HOST_CAPTURE_RECOVERY_DENIED');
      mode();
      const intent=await readOriginalIntent({...query,captureRef,kind,subjectId});
      const schema=kind==='OBJECT_PUT'?'IWXA_T4_ORIGINAL_OBJECT_MUTATION_INTENT_V1':
        kind.endsWith('_DELETE')?'IWXA_T4_ORIGINAL_PRE_DELETE_CAPTURE_V1':
          'IWXA_T4_ORIGINAL_SUBJECT_MUTATION_INTENT_V1';
      if(intent?.schema!==schema||intent.captureRef!==captureRef||intent.workspaceId!==workspaceId||
        intent.originalWriteOwnerRef!==originalWriteOwnerRef||
        (kind!=='OBJECT_PUT'&&intent.kind!==kind))
        fail('ORIGINAL_HOST_CAPTURE_RECOVERY_INVENTORY_CHANGED');
      const key=kind.endsWith('_DELETE')?intent.sourceEvent?.idempotency_key:intent.idempotencyKey;
      if(kind==='GRAPH_COMMIT'?(typeof key!=='string'||key.length<1||key.length>256):
        kind!=='OBJECT_PUT'&&!ID(key))fail('ORIGINAL_HOST_CAPTURE_RECOVERY_INTENT_INVALID');
      const stream=await readOriginalEvents({...query,captureRef,operation:'t1.listEventsSince'});
      mode();
      if(!Array.isArray(stream)||stream.length>100000||stream.some(e=>e?.workspace_id!==workspaceId))
        fail('ORIGINAL_HOST_CAPTURE_RECOVERY_EVENT_STREAM_INVALID');
      const matches=stream.filter(e=>kind==='OBJECT_PUT'||kind==='GRAPH_COMMIT'?e?.payload?.iwxa_t4_capture_ref===captureRef:
        kind==='OBJECT_DELETE'?e?.payload?.iwxa_t4_object_delete_intent===key:e?.idempotency_key===key);
      if(matches.length>1)fail('ORIGINAL_HOST_CAPTURE_RECOVERY_EVENT_AMBIGUOUS');
      if(matches.length===1&&!ID(matches[0].event_id))fail('ORIGINAL_HOST_CAPTURE_RECOVERY_EVENT_STREAM_INVALID');
      if(await authorizeOriginalCaptureRecovery(permission)!==true||
        await authorizeOriginalRead({...query,captureRef,operation:'t1.listEventsSince'})!==true)
        fail('ORIGINAL_HOST_CAPTURE_RECOVERY_DENIED');
      mode();
      const eventId=matches[0]?.event_id??null;
      if(expectedOriginalSourceEventId!==null&&eventId!==expectedOriginalSourceEventId)
        fail('ORIGINAL_HOST_CAPTURE_RECOVERY_SOURCE_EVENT_MISMATCH');
      return eventId;
    }
    let recovered,eventId;
    const waiting=()=>result('WAITING_FOR_ORIGINAL_EVENT',{captureRef,kind,subjectId,pendingCaptureCount:1,
      originalT3OutboxVerified:false});
    if(kind.endsWith('_DELETE')){
      // Deletion recovery already enters the same original mutation
      // boundary. Extend its proof and recheck the inventory there; do
      // not acquire another lock or nest a second mutation executor.
      const noEvent=Error('NO_ORIGINAL_EVENT_FOR_CAPTURE');
      try{
        recovered=await reconcileT4OriginalHostSubjectDeletion({...hostCapturePorts(),
          ...query,captureRef,kind,subjectId,
          withOriginalSubjectMutation:(proof,action)=>withOriginalSubjectMutation(
            Object.freeze({...proof,originalHostMustSerializeAllWorkspaceGraphMutations:true,
              originalMutationRecoveryOnly:true}),async()=>{
                eventId=await inspect();if(eventId===null)throw noEvent;
                return action();
              })});
      }catch(e){if(e===noEvent)return waiting();throw e;}
    }else{
      const step=await runT4OriginalSubjectMutationBoundary(withOriginalSubjectMutation,boundary,async()=>{
        eventId=await inspect();if(eventId===null)return waiting();
        return kind==='OBJECT_PUT'?reconcileT4OriginalMutationIntent({...hostCapturePorts(),
          ...query,captureRef,objectId:subjectId}):kind==='GRAPH_COMMIT'?
          reconcileT4OriginalGraphMutation({...hostCapturePorts(),...query,captureRef,subjectId}):
          reconcileT4OriginalHostSubjectMutation({...hostCapturePorts(),
          ...query,captureRef,kind,subjectId});
      });
      if(step.state==='WAITING_FOR_ORIGINAL_EVENT')return step;
      recovered=step;
    }
    mode();
    if(recovered?.captureRef!==captureRef||recovered.originalT3OutboxVerified!==true||
      recovered.originalMutationRetried!==false||recovered.originalOperationReceiptRecreated!==false||
      recovered.sourceCursorAdvanced!==false||recovered.networkPublished!==false||
      recovered.recipientApplied!==false||recovered.window?.lastEventId!==eventId)
      fail('ORIGINAL_HOST_CAPTURE_RECOVERY_RESULT_INVALID');
    return result('ORIGINAL_CAPTURE_RECONCILED',{captureRef,kind,subjectId,originalSourceEventId:eventId,
      originalT3OutboxVerified:true});
  }
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_HOST_CAPTURE_ADAPTER_V1',
    t3OriginalSessionIsSovereign:true,
    createsIndependentHost:false,createsIndependentStore:false,
    createsIndependentTaskEngine:false,
    dispose(){disposed=true;},
    reconcileNextOriginalCapture,
    async putObject({mutationInput,sourceCursor,captureRef}={}){
      if(mode()==='LOCAL_T3'){
        if(!mutationInput||typeof mutationInput!=='object')
          fail('ORIGINAL_HOST_MUTATION_REQUIRED');
        const originalReceipt=await originalKernel.putObject(mutationInput);
      mode();
        return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_PUT_RESULT_V1',
          t4Mode:'LOCAL_T3',originalReceipt,
          originalT3OperationUsed:true,originalHostUnchanged:true,
          capture:null,networkPublished:false});
      }
      requiredOriginalHostCapturePorts();
      if(!ID(captureRef)||!mutationInput||
        !ID(mutationInput.workspace_id)||!ID(mutationInput.object_id))
        fail('ORIGINAL_HOST_T4_MUTATION_SCOPE_REQUIRED');
      const captured=await serializePut('OBJECT_PUT','t1.putObject',mutationInput.object_id,
        {mutationInput,sourceCursor,captureRef},(exact,cursor)=>captureT4OriginalObjectMutation({
          ...hostCapturePorts(),workspaceId:exact.workspace_id,
          objectId:exact.object_id,captureRef,sourceCursor:cursor,mutationInput:exact,
        }));
      mode();
      return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_PUT_RESULT_V1',
        t4Mode:'T4_NETWORK',originalReceipt:captured.originalT3Receipt,
        originalT3OperationUsed:true,originalHostUnchanged:true,
        capture:captured,networkPublished:false});
    },
    async commitObjectGraph({mutationInput,sourceCursor,captureRef}={}){
      if(originalKernel.hasOperation('t1.commitObjectGraph')!==true||
        typeof originalKernel.commitObjectGraph!=='function')
        fail('ORIGINAL_HOST_T3_GRAPH_PORT_REQUIRED');
      if(!mutationInput||typeof mutationInput!=='object')fail('ORIGINAL_HOST_MUTATION_REQUIRED');
      if(mode()==='LOCAL_T3'){
        const originalReceipt=await originalKernel.commitObjectGraph(mutationInput);mode();
        return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_GRAPH_RESULT_V1',
          t4Mode:'LOCAL_T3',originalReceipt,originalHostUnchanged:true,capture:null,
          originalT3OperationUsed:true,networkPublished:false});
      }
      requiredOriginalHostCapturePorts();
      if(!ID(captureRef)||!ID(mutationInput.workspace_id)||!ID(mutationInput.object?.object_id))
        fail('ORIGINAL_HOST_T4_MUTATION_SCOPE_REQUIRED');
      const capture=await serializePut('GRAPH_COMMIT','t1.commitObjectGraph',mutationInput.object.object_id,
        {mutationInput,sourceCursor,captureRef},(exact,cursor)=>captureT4OriginalGraphMutation({
          ...hostCapturePorts(),workspaceId:exact.workspace_id,captureRef,sourceCursor:cursor,mutationInput:exact,
        }));
      mode();
      return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_GRAPH_RESULT_V1',
        t4Mode:'T4_NETWORK',subjectKind:'GRAPH_COMMIT',originalReceipt:capture.originalReceipt,
        originalT3OperationUsed:true,originalHostUnchanged:true,capture,networkPublished:false});
    },
    async reconcileGraphMutation({captureRef,workspaceId,objectId}={}){
      if(mode()!=='T4_NETWORK')fail('ORIGINAL_HOST_RECOVERY_REQUIRES_T4');
      requiredOriginalHostCapturePorts();
      if(![captureRef,workspaceId,objectId].every(ID))fail('ORIGINAL_HOST_T4_MUTATION_SCOPE_REQUIRED');
      return runT4OriginalSubjectMutationBoundary(withOriginalSubjectMutation,Object.freeze({
        workspaceId,originalWriteOwnerRef,captureRef,subjectId:objectId,kind:'GRAPH_COMMIT',
        operation:'t1.commitObjectGraph',originalMutationRecoveryOnly:true,
        originalHostMustSerializeSubjectMutations:true,originalHostMustSerializeAllWorkspaceGraphMutations:true,
        networkIsNotOriginalGrant:true}),()=>reconcileT4OriginalGraphMutation({
          ...hostCapturePorts(),captureRef,workspaceId,subjectId:objectId}));
    },
    async putAsset({mutationInput,sourceCursor,captureRef}={}){
      if(originalKernel.hasOperation('t1.putAsset')!==true||
        typeof originalKernel.putAsset!=='function')
        fail('ORIGINAL_HOST_T3_ASSET_PORT_REQUIRED');
      if(mode()==='LOCAL_T3'){
        if(!mutationInput||typeof mutationInput!=='object')
          fail('ORIGINAL_HOST_MUTATION_REQUIRED');
        const originalReceipt=await originalKernel.putAsset(mutationInput);
      mode();
        return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_SUBJECT_PUT_RESULT_V1',
          subjectKind:'ASSET_PUT',t4Mode:'LOCAL_T3',originalReceipt,
          capture:null,originalT3OperationUsed:true,originalHostUnchanged:true,
          networkPublished:false});
      }
      requiredOriginalHostCapturePorts();
      if(!ID(captureRef)||!ID(mutationInput?.workspace_id)||
        !ID(mutationInput?.asset_id))
        fail('ORIGINAL_HOST_T4_MUTATION_SCOPE_REQUIRED');
      const capture=await serializePut('ASSET_PUT','t1.putAsset',mutationInput.asset_id,
        {mutationInput,sourceCursor,captureRef},(exact,cursor)=>captureT4OriginalHostSubjectMutation({
          ...hostCapturePorts(),kind:'ASSET_PUT',
          workspaceId:exact.workspace_id,captureRef,sourceCursor:cursor,
          mutationInput:exact,
        }));
      mode();
      return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_SUBJECT_PUT_RESULT_V1',
        subjectKind:'ASSET_PUT',t4Mode:'T4_NETWORK',capture,
        originalReceipt:capture.originalReceipt,
        originalT3OperationUsed:true,originalHostUnchanged:true,
        networkPublished:false});
    },
    async putRelation({mutationInput,sourceCursor,captureRef}={}){
      if(originalKernel.hasOperation('t1.putRelation')!==true||
        typeof originalKernel.putRelation!=='function')
        fail('ORIGINAL_HOST_T3_RELATION_PORT_REQUIRED');
      if(mode()==='LOCAL_T3'){
        if(!mutationInput||typeof mutationInput!=='object')
          fail('ORIGINAL_HOST_MUTATION_REQUIRED');
        const originalReceipt=await originalKernel.putRelation(mutationInput);
      mode();
        return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_SUBJECT_PUT_RESULT_V1',
          subjectKind:'RELATION_PUT',t4Mode:'LOCAL_T3',originalReceipt,
          capture:null,originalT3OperationUsed:true,originalHostUnchanged:true,
          networkPublished:false});
      }
      requiredOriginalHostCapturePorts();
      if(!ID(captureRef)||!ID(mutationInput?.workspace_id)||
        !ID(mutationInput?.relation_id))
        fail('ORIGINAL_HOST_T4_MUTATION_SCOPE_REQUIRED');
      const capture=await serializePut('RELATION_PUT','t1.putRelation',mutationInput.relation_id,
        {mutationInput,sourceCursor,captureRef},(exact,cursor)=>captureT4OriginalHostSubjectMutation({
          ...hostCapturePorts(),kind:'RELATION_PUT',
          workspaceId:exact.workspace_id,captureRef,sourceCursor:cursor,
          mutationInput:exact,
        }));
      mode();
      return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_SUBJECT_PUT_RESULT_V1',
        subjectKind:'RELATION_PUT',t4Mode:'T4_NETWORK',capture,
        originalReceipt:capture.originalReceipt,
        originalT3OperationUsed:true,originalHostUnchanged:true,
        networkPublished:false});
    },
    deleteAsset:options=>deleteSubject('ASSET_DELETE',options),
    deleteRelation:options=>deleteSubject('RELATION_DELETE',options),
    reconcileAssetDeletion:({captureRef,workspaceId,assetId}={})=>
      reconcileDeletion('ASSET_DELETE',{captureRef,workspaceId,subjectId:assetId}),
    reconcileRelationDeletion:({captureRef,workspaceId,relationId}={})=>
      reconcileDeletion('RELATION_DELETE',{captureRef,workspaceId,subjectId:relationId}),
    async deleteObject({mutationInput,sourceCursor,captureRef}={}){
      if(originalKernel.hasOperation('t1.deleteObject')!==true||
        typeof originalKernel.deleteObject!=='function')
        fail('ORIGINAL_HOST_T3_DELETE_OBJECT_PORT_REQUIRED');
      if(mode()==='LOCAL_T3'){
        if(!mutationInput||typeof mutationInput!=='object')
          fail('ORIGINAL_HOST_MUTATION_REQUIRED');
        const originalReceipt=await originalKernel.deleteObject(mutationInput);
      mode();
        return Object.freeze({
          schema:'IWXA_T4_ORIGINAL_HOST_OBJECT_DELETE_RESULT_V1',
          t4Mode:'LOCAL_T3',originalReceipt,originalT3OperationUsed:true,
          originalHostUnchanged:true,capture:null,networkPublished:false,
        });
      }
      if(typeof readOriginalDependencyCoverage!=='function'||
        typeof withOriginalSubjectMutation!=='function')
        fail('ORIGINAL_HOST_T4_OBJECT_DELETE_NOT_QUALIFIED');
      return deleteSubject('OBJECT_DELETE',{mutationInput,sourceCursor,captureRef});
    },
    reconcileObjectDeletion:({captureRef,workspaceId,objectId}={})=>
      reconcileDeletion('OBJECT_DELETE',{captureRef,workspaceId,subjectId:objectId}),
    async reconcileAssetMutation({captureRef,workspaceId,assetId}={}){
      if(mode()!=='T4_NETWORK')fail('ORIGINAL_HOST_RECOVERY_REQUIRES_T4');
      requiredOriginalHostCapturePorts();
      if(![captureRef,workspaceId,assetId].every(ID))
        fail('ORIGINAL_HOST_T4_MUTATION_SCOPE_REQUIRED');
      return reconcileT4OriginalHostSubjectMutation({
        ...hostCapturePorts(),kind:'ASSET_PUT',captureRef,workspaceId,
        subjectId:assetId,
      });
    },
    async reconcileRelationMutation({captureRef,workspaceId,relationId}={}){
      if(mode()!=='T4_NETWORK')fail('ORIGINAL_HOST_RECOVERY_REQUIRES_T4');
      requiredOriginalHostCapturePorts();
      if(![captureRef,workspaceId,relationId].every(ID))
        fail('ORIGINAL_HOST_T4_MUTATION_SCOPE_REQUIRED');
      return reconcileT4OriginalHostSubjectMutation({
        ...hostCapturePorts(),kind:'RELATION_PUT',captureRef,workspaceId,
        subjectId:relationId,
      });
    },
    async reconcileObjectMutation({
      captureRef,workspaceId,objectId,
    }={}){
      if(mode()!=='T4_NETWORK')fail('ORIGINAL_HOST_RECOVERY_REQUIRES_T4');
      requiredOriginalHostCapturePorts();
      if(![captureRef,workspaceId,objectId].every(ID))
        fail('ORIGINAL_HOST_T4_MUTATION_SCOPE_REQUIRED');
      return reconcileT4OriginalMutationIntent({
        ...hostCapturePorts(),captureRef,workspaceId,objectId,
      });
    },
  });
}
