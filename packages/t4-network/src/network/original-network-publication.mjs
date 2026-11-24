import {T4_LEGACY_TEST_TECHNICAL_SCHEMA_ID,requireT4OriginalNetworkTechnicalSchemaId}
  from './original-network-technical-schema.mjs';
import {originalHostLifetimeMode,scopeOriginalHostPort} from './original-host-lifetime.mjs';
import {createHash} from 'node:crypto';
import {decodeT4CandidateFrame,verifyT4CandidateOutboundSignature,
  isT4NativeEventOnlyKind,validT4NativeSubjectRevision,matchesT4NativeSubjectCriticalExtensions,
  T4_ORIGINAL_SOURCE_SESSION_EXTENSION}
  from './standard-network-wire-candidate.mjs';
import {t4OriginalDeletedSubjectRevision} from './original-deletion-delta.mjs';
import {assembleT4CandidateOpaqueChunks}
  from './standard-network-opaque-chunks.mjs';

/*
 * Native outgoing publication belongs to the original T3 Host. A single
 * technical Object per local peer/session holds the immutable signed bytes
 * and CAS state. The original Event chain is the write/readback evidence.
 * No additional Store, queue, scheduler, signer or subject write.
 */
export class T4OriginalNetworkPublicationError extends Error {
  constructor(code,details={}){
    super(code);this.name='T4OriginalNetworkPublicationError';this.code=code;
    this.details=Object.freeze({...details});
  }
}
const fail=(code,details)=>{throw new T4OriginalNetworkPublicationError(code,details);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const DIG=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const sorted=x=>Array.isArray(x)?x.map(sorted):
  x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort()
    .map(k=>[k,sorted(x[k])])):x;
const same=(a,b)=>JSON.stringify(sorted(a))===JSON.stringify(sorted(b));
const hex=x=>createHash('sha256').update(x).digest('hex');
const digest=(domain,x)=>'sha256:'+createHash('sha256')
  .update('IWXA-T4-ORIGINAL-'+domain+'-V1\0')
  .update(JSON.stringify(sorted(x))).digest('hex');
const clone=x=>structuredClone(x);
const deepFreeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(deepFreeze);Object.freeze(x);}return x;};
const SCHEMA='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_V1';
const EVENT='t4.network.original.frame.publication';
const SESSION='IWXA_T4_ORIGINAL_NATIVE_CAPTURE_SESSION_V1';
const MAX_FRAMES=80,MAX_WIRE_BYTES=1024*1024;
const SOURCE_TYPES=new Set(['HELLO','CAPABILITIES','HEADS','CHANGE_REF','CHUNK','RESUME']);
const RECIPIENT_TYPES=new Set(['HELLO','CAPABILITIES','DIFF_REQUEST','CHUNK_REQUEST',
  'RECEIVED_ACK','VERIFIED_ACK','APPLIED_ACK','RESUME']);
function canonicalSession(input){
  const {workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,
    scopeRef,ownerEpoch,sourceEventId,sourceRevision,sourceEventDigest,
    sourcePrefixDigestBefore,sourcePrefixDigestAfter,capturedWindowDigest,
    capturedSha256,changeKind}=input??{};
  if(![workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,
    scopeRef,sourceEventId].every(ID)||sourceNodeRef===recipientNodeRef||
    !Number.isSafeInteger(ownerEpoch)||ownerEpoch<1||
    !validT4NativeSubjectRevision(changeKind,sourceRevision)||
    ![sourceEventDigest,sourcePrefixDigestBefore,sourcePrefixDigestAfter,
      capturedWindowDigest].every(DIG)||!SHA(capturedSha256))
    fail('PUBLICATION_ORIGINAL_CAPTURE_IDENTITY_INVALID');
  const family={workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef};
  // Same original event and peer epoch selects the same session even after
  // a cold process. Conflicting bytes for that identity must not select a
  // different session. The durable record binds the remaining digests.
  const key={...family,ownerEpoch,sourceEventId};
  return Object.freeze({schema:SESSION,...family,ownerEpoch,
    sourceEventId,sourceRevision,sourceEventDigest,sourcePrefixDigestBefore,
    sourcePrefixDigestAfter,capturedWindowDigest,capturedSha256,changeKind,
    familyRef:'family:t4:'+digest('NATIVE-FAMILY',family).slice(7),
    sessionRef:'session:t4:'+digest('NATIVE-SESSION',key).slice(7),
    changeId:'change:t4:'+digest('NATIVE-CHANGE',key).slice(7),
  });
}
// Shared canonical validation, also used by the original recipient task.
// A canonical session is an identity, NOT original permission or receipt.
export function validateT4OriginalNativeCaptureSession(session){
  const canonical=canonicalSession(session);
  if(!same(canonical,session))fail('PUBLICATION_ORIGINAL_CAPTURE_IDENTITY_INVALID');
  return canonical;
}
export function deriveT4OriginalNativeCaptureSession(task){
  const c=task?.capture,w=c?.sourceWindow,d=c?.prepared?.delta;
  if(task?.schema!=='IWXA_T4_ORIGINAL_HOST_NATIVE_OUTBOX_TASK_V1'||
    task.state!=='ORIGINAL_NATIVE_CAPTURE_READY'||
    task.networkPublished!==false||task.sourceCursorAdvanced!==false||
    task.originalRecipientApplied!==false||
    task.networkTargetRef!==task.recipientNodeRef||
    c?.originalIntentEventAndCanonicalBytesVerified!==true||
    c.capturedWindowDigestVerified!==true||
    c.workspaceId!==task.workspaceId||
    c.originalWriteOwnerRef!==task.originalWriteOwnerRef||
    c.sourceEventId!==d?.sourceEventId||
    c.sourceRevision!==(c.kind==='OBJECT_DELETE'&&d?.kind==='OBJECT_DELETE'?
      t4OriginalDeletedSubjectRevision(d):isT4NativeEventOnlyKind(c.kind??'OBJECT_PUT')?null:d?.sourceRevision)||
    !w||w.lastEventId!==c.sourceEventId||
    d.sourceEventDigest!==w.eventRefs?.[0]?.eventDigest||
    d.windowDigest!==w.windowDigest||
    task.sourceCursorBefore?.sourcePrefixDigest!==w.sourcePrefixDigestBefore||
    task.sourceCursorAfter?.sourcePrefixDigest!==w.sourcePrefixDigestAfter)
    fail('PUBLICATION_ORIGINAL_CAPTURE_TASK_REQUIRED');
  return canonicalSession({...task,sourceEventId:c.sourceEventId,
    sourceRevision:c.sourceRevision,sourceEventDigest:d.sourceEventDigest,
    sourcePrefixDigestBefore:w.sourcePrefixDigestBefore,
    sourcePrefixDigestAfter:w.sourcePrefixDigestAfter,
    capturedWindowDigest:w.windowDigest,capturedSha256:c.prepared.sha256,
    changeKind:c.kind??'OBJECT_PUT'});
}
const sourceCursor=(identity,lastEventId,seenEventCount,sourcePrefixDigest)=>Object.freeze({
  schema:'IWXA_T4_ORIGINAL_EVENT_CURSOR_V1',workspaceId:identity.workspaceId,
  originalWriteOwnerRef:identity.originalWriteOwnerRef,lastEventId,seenEventCount,
  sourcePrefixDigest,originalPermissionProof:false,
});
export function originalSourceSessionFamilyRef(identity){
  const {workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef}=identity??{};
  if(![workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef].every(ID)||
    sourceNodeRef===recipientNodeRef)fail('PUBLICATION_ORIGINAL_CAPTURE_IDENTITY_INVALID');
  return 'family:t4:'+digest('NATIVE-FAMILY',{workspaceId,originalWriteOwnerRef,
    sourceNodeRef,recipientNodeRef,scopeRef}).slice(7);
}
export function createT4OriginalSourceSessionHead({session,sourceCursorBefore,sourceCursorAfter}={}){
  const s=validateT4OriginalNativeCaptureSession(session),before=sourceCursorBefore;
  if(!ID(before?.lastEventId)||!Number.isSafeInteger(before.seenEventCount)||
    before.seenEventCount<1||before.seenEventCount>=Number.MAX_SAFE_INTEGER||
    before.lastEventId===s.sourceEventId||s.sourcePrefixDigestBefore===s.sourcePrefixDigestAfter||
    !same(before,sourceCursor(s,before.lastEventId,before.seenEventCount,s.sourcePrefixDigestBefore))||
    !same(sourceCursorAfter,sourceCursor(s,s.sourceEventId,before.seenEventCount+1,s.sourcePrefixDigestAfter)))
    fail('PUBLICATION_ORIGINAL_SOURCE_ANNOUNCEMENT_CURSOR_INVALID');
  return deepFreeze({familyRef:s.familyRef,ownerEpoch:s.ownerEpoch,heads:[s.sourcePrefixDigestAfter],
    sourceSession:{predecessorEventId:before.lastEventId,predecessorEventCount:before.seenEventCount,
      predecessorPrefixDigest:s.sourcePrefixDigestBefore,sourceEventId:s.sourceEventId,
      sourceEventDigest:s.sourceEventDigest,sourceRevision:s.sourceRevision,changeKind:s.changeKind,
      capturedWindowDigest:s.capturedWindowDigest,capturedSha256:s.capturedSha256}});
}
// This reconstructs a deterministic session from signed metadata and LOCAL
// peer configuration. It does not prove that the remote Kernel has the event.
export function readT4OriginalSourceSessionHead({identity,body,sessionRef,sourceCursorBefore=null,
  expectedSession=null}={}){
  const a=body?.sourceSession;
  const s=canonicalSession({...identity,sourceEventId:a?.sourceEventId,sourceRevision:a?.sourceRevision,
    sourceEventDigest:a?.sourceEventDigest,sourcePrefixDigestBefore:a?.predecessorPrefixDigest,
    sourcePrefixDigestAfter:body?.heads?.[0],capturedWindowDigest:a?.capturedWindowDigest,
    capturedSha256:a?.capturedSha256,changeKind:a?.changeKind});
  const before=sourceCursor(s,a.predecessorEventId,a.predecessorEventCount,s.sourcePrefixDigestBefore);
  const after=sourceCursor(s,s.sourceEventId,a.predecessorEventCount+1,s.sourcePrefixDigestAfter);
  const expected=createT4OriginalSourceSessionHead({session:s,sourceCursorBefore:before,sourceCursorAfter:after});
  if(!same(body,expected)||s.sessionRef!==sessionRef||
    (sourceCursorBefore!==null&&!same(before,sourceCursorBefore))||
    (expectedSession!==null&&!same(s,expectedSession)))
    fail('PUBLICATION_ORIGINAL_SOURCE_ANNOUNCEMENT_MISMATCH');
  return deepFreeze({session:s,sourceCursorBefore:before,sourceCursorAfter:after});
}
function descriptor(entry){
  return {sequence:entry.sequence,messageType:entry.messageType,sha256:entry.sha256};
}
function initialEntry(frame,wireText){
  return {sequence:frame.sequence,messageType:frame.messageType,
    sha256:hex(Buffer.from(wireText,'utf8')),wireText,state:'PREPARED',attempts:0};
}
function slotList(slots,types){
  if(!Array.isArray(slots)||!slots.length||slots.length>MAX_FRAMES||
    slots.some((v,i)=>!v||!Number.isSafeInteger(v.sequence)||
      v.sequence<1||v.sequence>MAX_FRAMES||!types.has(v.messageType)||
      (i>0&&v.sequence!==slots[i-1].sequence+1)))
    fail('PUBLICATION_SLOT_BATCH_INVALID');
  return slots.map(v=>({sequence:v.sequence,messageType:v.messageType}));
}

export function createT4OriginalNetworkPublicationPort({
  technicalSchemaId=T4_LEGACY_TEST_TECHNICAL_SCHEMA_ID,
  session,localNodeRef,technicalWorkspaceId,originalKernel,getMode,
  readOriginalHostContext,authorizeOriginalTechnicalRead,
  authorizeOriginalTechnicalWrite,authorizeOriginalFramePublish,
  verifyOriginalNodeSignature,frameTransport,
}={}){
  requireT4OriginalNetworkTechnicalSchemaId(technicalSchemaId);
  const identity=canonicalSession(session);
  if(!same(identity,session)||
    ![identity.sourceNodeRef,identity.recipientNodeRef].includes(localNodeRef)||
    !ID(technicalWorkspaceId)||
    ![getMode,readOriginalHostContext,authorizeOriginalTechnicalRead,
      authorizeOriginalTechnicalWrite,authorizeOriginalFramePublish,
      verifyOriginalNodeSignature].every(f=>typeof f==='function')||
    !['publishSignedFrame','inspectUnknownPublication'].every(
      op=>typeof frameTransport?.[op]==='function')||
    !['t1.getObject','t1.listEventsSince','t1.putObject'].every(
      op=>originalKernel?.hasOperation?.(op)===true)||
    !['getObject','listEventsSince','putObject'].every(
      op=>typeof originalKernel[op]==='function'))
    fail('PUBLICATION_ORIGINAL_HOST_PORTS_REQUIRED');
  const source=localNodeRef===identity.sourceNodeRef;
  const remoteNodeRef=source?identity.recipientNodeRef:identity.sourceNodeRef;
  const types=source?SOURCE_TYPES:RECIPIENT_TYPES;
  const recordIdentity={session:identity,localNodeRef,technicalWorkspaceId};
  const checkpointRef='t4:net:publish:'+digest('PUBLICATION-KEY',{
    sessionRef:identity.sessionRef,localNodeRef,technicalWorkspaceId,
  }).slice(7);
  const genesis=digest('PUBLICATION-CHAIN',{recordIdentity,checkpointRef});
  const mode=()=>{
    if(getMode()!=='T4_NETWORK')fail('PUBLICATION_NETWORK_MODE_OFF');
  };
  async function context(){
    mode();
    const v=await readOriginalHostContext();
    if(v?.workspaceId!==technicalWorkspaceId||
      v.originalWriteOwnerRef!==identity.originalWriteOwnerRef||
      v.nodeRef!==localNodeRef||v.scopeRef!==identity.scopeRef||
      !ID(v.hostSessionRef))fail('PUBLICATION_ORIGINAL_HOST_CONTEXT_INVALID');
    mode();
    return {workspaceId:v.workspaceId,originalWriteOwnerRef:v.originalWriteOwnerRef,
      nodeRef:v.nodeRef,scopeRef:v.scopeRef,hostSessionRef:v.hostSessionRef};
  }
  async function guard(ctx,operation,purpose,frame=null){
    if(!same(await context(),ctx))
      fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED',{automaticRetryAllowed:false});
    const signedFrame=frame===null?null:frameFor(frame);
    const proof=Object.freeze({operation,purpose,checkpointRef,
      technicalWorkspaceId,originalWriteOwnerRef:identity.originalWriteOwnerRef,
      localNodeRef,remoteNodeRef,scopeRef:identity.scopeRef,
      sessionRef:identity.sessionRef,changeId:identity.changeId,
      ownerEpoch:identity.ownerEpoch,sourceEventId:identity.sourceEventId,
      frameSequence:frame?.sequence??null,frameSha256:frame?.sha256??null,
      signerRef:signedFrame?.signerRef??null,
      permissionRef:signedFrame?.permissionRef??null,
      frameMessageType:signedFrame?.messageType??null,
      originalHostAuthorityRequired:true,networkReceiptIsNotBusinessResult:true});
    const allowed=operation==='t1.putObject'?authorizeOriginalTechnicalWrite:
      operation.startsWith('t1.')?authorizeOriginalTechnicalRead:
        authorizeOriginalFramePublish;
    if(await allowed(proof)!==true)
      fail('PUBLICATION_ORIGINAL_AUTHORITY_DENIED',{operation,purpose});
    if(!same(await context(),ctx))
      fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED',{automaticRetryAllowed:false});
  }
  function frameFor(entry){
    if(typeof entry?.wireText!=='string'||!SHA(entry.sha256)||
      hex(Buffer.from(entry.wireText,'utf8'))!==entry.sha256)
      fail('PUBLICATION_ORIGINAL_SIGNED_BYTES_CHANGED');
    const frame=decodeT4CandidateFrame(Buffer.from(entry.wireText,'utf8'));
    if(frame.sequence!==entry.sequence||frame.messageType!==entry.messageType||
      frame.sourceNodeRef!==localNodeRef||frame.recipientNodeRef!==remoteNodeRef||
      frame.scopeRef!==identity.scopeRef||frame.sessionRef!==identity.sessionRef||
      frame.ownerEpoch!==identity.ownerEpoch||!types.has(frame.messageType))
      fail('PUBLICATION_FRAME_SESSION_MISMATCH');
    const b=frame.body;
    if(frame.messageType==='HEADS'&&frame.criticalExtensions.includes(T4_ORIGINAL_SOURCE_SESSION_EXTENSION))
      readT4OriginalSourceSessionHead({identity,body:b,sessionRef:frame.sessionRef,expectedSession:identity});
    if((['CHANGE_REF','APPLIED_ACK'].includes(frame.messageType)&&
        !matchesT4NativeSubjectCriticalExtensions(identity.changeKind,
          frame.criticalExtensions))||
      (frame.messageType==='APPLIED_ACK'&&b.recipientRevision!==identity.sourceRevision)||
      (b.changeId!==undefined&&b.changeId!==identity.changeId)||
      (b.familyRef!==undefined&&b.familyRef!==identity.familyRef)||
      (frame.messageType==='HEADS'&&
        (!same(b.heads,[identity.sourcePrefixDigestAfter])||b.ownerEpoch!==identity.ownerEpoch))||
      (frame.messageType==='DIFF_REQUEST'&&
        !same(b.fromHeads,[identity.sourcePrefixDigestBefore]))||
      (frame.messageType==='CHANGE_REF'&&
        (b.eventRef!==identity.sourceEventId||b.changeKind!==identity.changeKind||
         b.ownerRef!==identity.originalWriteOwnerRef||
         b.sourceRevision!==identity.sourceRevision||
         !same(b.parents,[identity.sourcePrefixDigestBefore]))))
      fail('PUBLICATION_FRAME_ORIGINAL_CHANGE_MISMATCH');
    return frame;
  }
  async function verifyFrame(ctx,entry,purpose){
    const frame=frameFor(entry);
    await guard(ctx,'t4.network.publish.'+frame.messageType,purpose,entry);
    await verifyT4CandidateOutboundSignature({
      wireBytes:Buffer.from(entry.wireText,'utf8'),verifyOriginalNodeSignature,
    });
    await guard(ctx,'t4.network.publish.'+frame.messageType,purpose,entry);
    return frame;
  }
  function verifyBatch(entries){
    const frames=entries.map(frameFor);
    const changes=frames.filter(f=>f.messageType==='CHANGE_REF');
    const chunks=frames.filter(f=>f.messageType==='CHUNK');
    if(changes.length||chunks.length){
      // Seal the complete immutable content batch before CHANGE_REF PUT.
      // A process may not create fresh ciphertext for an already reserved
      // CHANGE_REF sequence after a lost response.
      if(changes.length!==1||frames[0]!==changes[0]||
        chunks.length!==frames.length-1||!chunks.length||
        chunks.some((f,i)=>f.body.chunkIndex!==i))
        fail('PUBLICATION_COMPLETE_CHANGE_CHUNK_BATCH_REQUIRED');
      assembleT4CandidateOpaqueChunks({
        bodies:chunks.map(f=>f.body),expectedChangeId:identity.changeId,
        expectedContentDigest:changes[0].body.contentDigest,
        expectedEncryptionContextRef:chunks[0].body.encryptionContextRef,
      });
    }
  }
  function verifySessionEntries(entries){
    const once=new Set(['HELLO','CAPABILITIES','HEADS','DIFF_REQUEST',
      'CHANGE_REF','RECEIVED_ACK','VERIFIED_ACK','APPLIED_ACK']);
    const seen=new Set(),messageIds=new Set();
    for(const e of entries){
      const frame=frameFor(e);
      if(messageIds.has(frame.messageId)||
        (once.has(frame.messageType)&&seen.has(frame.messageType)))
        fail('PUBLICATION_SESSION_FRAME_ALREADY_RESERVED');
      messageIds.add(frame.messageId);seen.add(frame.messageType);
    }
    if(source&&seen.has('CHANGE_REF')&&!seen.has('HEADS'))
      fail('PUBLICATION_SESSION_HEADS_REQUIRED');
  }
  function eventRecord(revision,previousHash,action,slots){
    const data={checkpointRef,revision,previousHash,action,slots};
    return {...data,chainHash:digest('PUBLICATION-CHAIN',{recordIdentity,...data})};
  }
  function advance(states,event){
    const {action,slots}=event;
    if(!Array.isArray(slots)||!slots.length||slots.length>MAX_FRAMES)
      fail('PUBLICATION_ORIGINAL_EVENT_CHAIN_INVALID');
    if(action==='PREPARE'){
      for(const s of slots){
        if(s?.sequence!==states.length+1||!types.has(s.messageType)||
          !SHA(s.sha256)||!same(s,{sequence:s.sequence,messageType:s.messageType,sha256:s.sha256}))
          fail('PUBLICATION_ORIGINAL_EVENT_CHAIN_INVALID');
        states.push({...s,state:'PREPARED',attempts:0});
      }
      return;
    }
    if(slots.length!==1)fail('PUBLICATION_ORIGINAL_EVENT_CHAIN_INVALID');
    const s=slots[0],at=states[s?.sequence-1];
    if(!at||!same(s,descriptor(at))||
      states.slice(0,s.sequence-1).some(v=>v.state!=='PRESENT'))
      fail('PUBLICATION_ORIGINAL_EVENT_CHAIN_INVALID');
    if(action==='ATTEMPT'&&at.state==='PREPARED'){
      at.state='ATTEMPTED';at.attempts=1;
    }else if(action==='RETRY'&&at.state==='ATTEMPTED'&&at.attempts<16){
      at.attempts++;
    }else if(action==='PRESENT'&&at.state==='ATTEMPTED'){
      at.state='PRESENT';
    }else fail('PUBLICATION_ORIGINAL_EVENT_CHAIN_INVALID');
  }
  async function read(ctx){
    await guard(ctx,'t1.getObject','read-publication');
    const row=await originalKernel.getObject(technicalWorkspaceId,checkpointRef);
    await guard(ctx,'t1.listEventsSince','read-publication-events');
    const all=await originalKernel.listEventsSince(technicalWorkspaceId);
    mode();
    if(!Array.isArray(all)||all.length>100000)
      fail('PUBLICATION_ORIGINAL_EVENT_STREAM_INVALID');
    const events=all.filter(e=>e?.workspace_id===technicalWorkspaceId&&
      e.object_id===checkpointRef);
    if(row===null){
      if(events.length)fail('PUBLICATION_ORIGINAL_OBJECT_MISSING');
      await guard(ctx,'t1.getObject','empty-readback');
      if(await originalKernel.getObject(technicalWorkspaceId,checkpointRef)!==null)
        fail('PUBLICATION_ORIGINAL_CHECKPOINT_CHANGED');
      mode();
      return {entries:[],revision:0,chainHash:genesis};
    }
    const o=row?.object,d=o?.data;
    if(o?.workspace_id!==technicalWorkspaceId||o.object_id!==checkpointRef||
      o.schema_id!==technicalSchemaId||o.schema_version!=='1.0.0'||o.deleted===true||
      d?.schema!==SCHEMA||d.checkpointRef!==checkpointRef||
      !same(d.identity,recordIdentity)||!Array.isArray(d.entries)||
      !d.entries.length||d.entries.length>MAX_FRAMES||
      !Number.isSafeInteger(o.revision)||o.revision<1||
      o.revision!==events.length||events.length>MAX_FRAMES*18)
      fail('PUBLICATION_ORIGINAL_CHECKPOINT_INVALID');
    let previous=genesis;
    const states=[],ids=new Set();
    for(let i=0;i<events.length;i++){
      const ev=events[i],p=ev.payload;
      if(ev.event_type!==EVENT||ev.revision!==i+1||!ID(ev.event_id)||
        ids.has(ev.event_id)||!p||
        !same(p,eventRecord(i+1,previous,p.action,p.slots)))
        fail('PUBLICATION_ORIGINAL_EVENT_CHAIN_INVALID');
      advance(states,p);previous=p.chainHash;ids.add(ev.event_id);
    }
    if(previous!==d.chainHash||states.length!==d.entries.length||
      !same(states,d.entries.map(({wireText,...metadata})=>metadata)))
      fail('PUBLICATION_ORIGINAL_EVENT_CHAIN_INVALID');
    let total=0;
    for(const entry of d.entries){
      frameFor(entry);total+=Buffer.byteLength(entry.wireText,'utf8');
    }
    if(total>MAX_WIRE_BYTES)fail('PUBLICATION_SIGNED_BYTES_LIMIT');
    verifySessionEntries(d.entries);
    // Original PREPARE events are also the exact batch boundaries.
    for(const ev of events.filter(e=>e.payload.action==='PREPARE')){
      const slots=ev.payload.slots;
      verifyBatch(d.entries.slice(slots[0].sequence-1,slots.at(-1).sequence));
    }
    await guard(ctx,'t1.getObject','publication-double-read');
    const after=await originalKernel.getObject(technicalWorkspaceId,checkpointRef);
    if(!same(after?.object,o))
      fail('PUBLICATION_ORIGINAL_CHECKPOINT_CHANGED');
    mode();
    return {entries:clone(d.entries),revision:o.revision,chainHash:previous};
  }
  async function commit(ctx,current,action,entries,slots){
    const revision=current.revision+1;
    const event=eventRecord(revision,current.chainHash,action,slots);
    const input={workspace_id:technicalWorkspaceId,object_id:checkpointRef,
      schema_id:technicalSchemaId,schema_version:'1.0.0',base_revision:current.revision,
      data:{schema:SCHEMA,title:'Original T3 native publication',
        checkpointRef,identity:clone(recordIdentity),entries:clone(entries),
        chainHash:event.chainHash},extensions:{},
      event:{event_type:EVENT,payload:event}};
    await guard(ctx,'t1.putObject',action);
    try{
      const receipt=await originalKernel.putObject(input);
      if(receipt?.object?.object_id!==checkpointRef||
        receipt.object.revision!==revision||receipt?.event?.event_type!==EVENT||
        !ID(receipt?.event?.event_id))throw Object.assign(Error('bad original receipt'),{code:'INVALID_RECEIPT'});
      const stored=await read(ctx);
      if(stored.revision!==revision||stored.chainHash!==event.chainHash||
        !same(stored.entries,entries))
        throw Object.assign(Error('original CAS readback diverged'),{code:'READBACK_DIVERGED'});
      return stored;
    }catch(error){
      fail('PUBLICATION_ORIGINAL_CAS_OUTCOME_UNKNOWN',{
        action,originalCode:error?.code??null,originalWriteMayHaveCommitted:true,
        automaticRetryAllowed:false,readOriginalObjectAndEventBeforeFurtherAction:true,
      });
    }
  }
  function result(entry,state,revision){
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_RESULT_V1',
      sessionRef:identity.sessionRef,changeId:identity.changeId,checkpointRef,
      sequence:entry.sequence,messageType:entry.messageType,
      key:entry.sha256+'.t4n',sha256:entry.sha256,state,
      originalPublicationRevision:revision,
      immutableTransportReadback:true,originalBusinessApplied:false,
      originalT3ExchangeCalled:false,sourceCursorAdvanced:false,
      recipientCursorAdvanced:false,originalSubjectMutationInvoked:false,
    });
  }
  async function inspectOriginalPublication(){
    const ctx=await context(),current=await read(ctx);
    return Object.freeze({schema:SCHEMA,session:identity,checkpointRef,
      revision:current.revision,chainHash:current.chainHash,
      frames:current.entries.map(e=>Object.freeze({...descriptor(e),
        state:e.state,attempts:e.attempts,key:e.sha256+'.t4n',
        // Exact original signed bytes; no re-signing/re-sealing on recovery.
        wireBytes:new Uint8Array(Buffer.from(e.wireText,'utf8'))})),
      originalT3EventChainVerified:current.revision>0,
      originalBusinessApplied:false,sourceCursorAdvanced:false,
    });
  }
  // Local outbound proof is deliberately NOT a received-frame receipt.
  // The source can reconstruct its own signed frame from the one original
  // publication ledger and immutable remote readback after a cold restart.
  // This proves neither receipt nor application by the other peer.
  async function readOriginalPublishedFrame({sequence}={}){
    if(!Number.isSafeInteger(sequence)||sequence<1||sequence>MAX_FRAMES)
      fail('PUBLICATION_SEQUENCE_INVALID');
    const ctx=await context(),current=await read(ctx),entry=current.entries[sequence-1];
    if(entry?.state!=='PRESENT')fail('PUBLICATION_OUTBOUND_FRAME_NOT_PRESENT');
    const frame=await verifyFrame(ctx,entry,'outbound-proof');
    const key=entry.sha256+'.t4n';
    await guard(ctx,'t4.network.publish.'+frame.messageType,'outbound-proof-network-readback',entry);
    const network=await frameTransport.inspectUnknownPublication({key,expectedSha256:entry.sha256});
    if(network?.schema!=='IWXA_T4_CANDIDATE_FRAME_PRESENT_V1'||network.key!==key||
      network.sha256!==entry.sha256||network.exactBytesPresent!==true||network.originalBusinessApplied!==false)
      fail('PUBLICATION_NETWORK_READBACK_NOT_PROVEN');
    await verifyFrame(ctx,entry,'outbound-proof-after-network');
    const after=await read(ctx);
    if(after.revision!==current.revision||after.chainHash!==current.chainHash||
      !same(after.entries[sequence-1],entry))fail('PUBLICATION_ORIGINAL_CHECKPOINT_CHANGED');
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_OUTBOUND_FRAME_PROOF_V1',
      key,sha256:entry.sha256,checkpointRef,originalPublicationRevision:current.revision,
      originalPublicationChainHash:current.chainHash,
      signedMessageType:frame.messageType,verifiedMessageId:frame.messageId,
      verifiedSourceNodeRef:frame.sourceNodeRef,verifiedRecipientNodeRef:frame.recipientNodeRef,
      verifiedScopeRef:frame.scopeRef,verifiedSessionRef:frame.sessionRef,
      verifiedSequence:frame.sequence,verifiedOwnerEpoch:frame.ownerEpoch,
      verifiedCryptoSuite:frame.cryptoSuite,verifiedSignerRef:frame.signerRef,
      verifiedCriticalExtensions:Object.freeze([...frame.criticalExtensions]),
      verifiedBody:deepFreeze(clone(frame.body)),
      originalT3PublicationEventChainVerified:true,originalOutboundSignatureVerified:true,
      originalOutboundAuthorityVerified:true,originalImmutableTransportReadbackVerified:true,
      originalReplayCheckpointRecorded:false,remoteReceiptProven:false,
      networkBytesVerified:true,originalBusinessApplied:false,originalT3ExchangeCalled:false});
  }
  async function prepareSignedBatch({slots,createSignedFrames}={}){
    const requested=slotList(slots,types),ctx=await context();
    const current=await read(ctx),start=requested[0].sequence;
    if(start<=current.entries.length){
      const exact=current.entries.slice(start-1,start-1+requested.length);
      if(exact.length!==requested.length||!same(requested,exact.map(
        ({sequence,messageType})=>({sequence,messageType}))))
        fail('PUBLICATION_RESERVED_SEQUENCE_CONFLICT');
      verifyBatch(exact);
      for(const e of exact)await verifyFrame(ctx,e,'recover-prepared');
      return Object.freeze({state:'ORIGINAL_SIGNED_BATCH_ALREADY_PREPARED',
        sessionRef:identity.sessionRef,checkpointRef,
        frames:exact.map(descriptor),originalT3EventChainVerified:true,
        networkPublished:false,originalBusinessApplied:false});
    }
    if(start!==current.entries.length+1||
      current.entries.length+requested.length>MAX_FRAMES||
      typeof createSignedFrames!=='function')
      fail('PUBLICATION_NEW_BATCH_NOT_CONTIGUOUS');
    await guard(ctx,'t4.network.publish.prepare','prepare-signed-batch');
    const produced=await createSignedFrames(Object.freeze({
      session:identity,slots:clone(requested),checkpointRef,
      originalHostSignerAndSealerRequired:true,
    }));
    if(!Array.isArray(produced)||produced.length!==requested.length)
      fail('PUBLICATION_SIGNED_BATCH_INVALID');
    const snapshots=produced.map(bytes=>{
      if(!(bytes instanceof Uint8Array))fail('PUBLICATION_SIGNED_BATCH_INVALID');
      return Buffer.from(bytes);
    });
    const appended=[];
    for(const [i,copy] of snapshots.entries()){
      const frame=decodeT4CandidateFrame(copy);
      if(frame.sequence!==requested[i].sequence||
        frame.messageType!==requested[i].messageType)
        fail('PUBLICATION_SIGNED_BATCH_INVALID');
      const entry=initialEntry(frame,copy.toString('utf8'));
      await verifyFrame(ctx,entry,'prepare-signed-frame');
      appended.push(entry);
    }
    verifyBatch(appended);
    const entries=[...current.entries,...appended];
    verifySessionEntries(entries);
    if(entries.reduce((s,e)=>s+Buffer.byteLength(e.wireText,'utf8'),0)>MAX_WIRE_BYTES)
      fail('PUBLICATION_SIGNED_BYTES_LIMIT');
    await commit(ctx,current,'PREPARE',entries,appended.map(descriptor));
    return Object.freeze({state:'ORIGINAL_SIGNED_BATCH_PREPARED',
      sessionRef:identity.sessionRef,checkpointRef,
      frames:appended.map(descriptor),originalT3EventChainVerified:true,
      networkPublished:false,originalBusinessApplied:false});
  }
  async function publishPreparedFrame({sequence,retryMissing=false}={}){
    if(!Number.isSafeInteger(sequence)||sequence<1||
      typeof retryMissing!=='boolean')fail('PUBLICATION_SEQUENCE_INVALID');
    const ctx=await context();
    let current=await read(ctx),entry=current.entries[sequence-1];
    if(!entry||current.entries.slice(0,sequence-1).some(e=>e.state!=='PRESENT'))
      fail('PUBLICATION_PREDECESSOR_NOT_PRESENT');
    await verifyFrame(ctx,entry,'publish-prepared');
    const address={key:entry.sha256+'.t4n',expectedSha256:entry.sha256};
    let newAttempt=entry.state==='PREPARED',recovered=false;
    if(!newAttempt){
      try{
        const seen=await frameTransport.inspectUnknownPublication(address);
        if(seen?.schema!=='IWXA_T4_CANDIDATE_FRAME_PRESENT_V1'||
          seen.key!==address.key||seen.sha256!==entry.sha256||
          seen.exactBytesPresent!==true||seen.originalBusinessApplied!==false)
          fail('PUBLICATION_NETWORK_READBACK_INVALID');
        recovered=true;
      }catch(error){
        // No blind retry. An explicit original Host decision can authorize
        // an identical immutable PUT only after a 404 readback.
        if(error?.code!=='REMOTE_NOT_FOUND'||entry.state!=='ATTEMPTED'||
          retryMissing!==true||entry.attempts>=16)
          fail('PUBLICATION_PRIOR_NETWORK_OUTCOME_UNRESOLVED',{
            originalCode:error?.code??null,sequence,
            automaticRetryAllowed:false,exactSignedBytesRetained:true,
          });
        await guard(ctx,'t4.network.publish.retry-missing','explicit-identical-retry',entry);
        newAttempt=true;
      }
    }
    if(entry.state==='PRESENT'&&recovered){
      await verifyFrame(ctx,entry,'confirmed-remote-readback');
      return result(entry,'ALREADY_PRESENT_VERIFIED',current.revision);
    }
    if(newAttempt){
      const entries=clone(current.entries),at=entries[sequence-1];
      const action=entry.state==='PREPARED'?'ATTEMPT':'RETRY';
      at.state='ATTEMPTED';at.attempts++;
      current=await commit(ctx,current,action,entries,[descriptor(entry)]);
      entry=current.entries[sequence-1];
      try{
        await verifyFrame(ctx,entry,'before-network');
        const receipt=await frameTransport.publishSignedFrame({
          wireBytes:new Uint8Array(Buffer.from(entry.wireText,'utf8')),
        });
        if(receipt?.schema!=='IWXA_T4_CANDIDATE_FRAME_PUBLISHED_V1'||
          receipt.key!==address.key||receipt.sha256!==entry.sha256||
          receipt.immutableTransportReadback!==true||
          receipt.originalBusinessApplied!==false)
          fail('PUBLICATION_NETWORK_READBACK_INVALID');
        await verifyFrame(ctx,entry,'after-network');
      }catch(error){
        fail('PUBLICATION_NETWORK_OUTCOME_UNKNOWN',{
          originalCode:error?.code??null,sequence,
          automaticRetryAllowed:false,exactSignedBytesRetained:true,
        });
      }
    }
    await verifyFrame(ctx,entry,'confirm-present');
    const entries=clone(current.entries);entries[sequence-1].state='PRESENT';
    const saved=await commit(ctx,current,'PRESENT',entries,[descriptor(entry)]);
    return result(entry,recovered?'REMOTE_READBACK_RECOVERED':
      'PUBLISHED_AND_READ_BACK',saved.revision);
  }
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1',
    session:identity,checkpointRef,inspectOriginalPublication,
    prepareSignedBatch,publishPreparedFrame,readOriginalPublishedFrame,
    forOriginalHostLifetime:isHostActive=>createT4OriginalNetworkPublicationPort({
      technicalSchemaId,
      session:identity,localNodeRef,technicalWorkspaceId,originalKernel,
      getMode:originalHostLifetimeMode(getMode,isHostActive),
      readOriginalHostContext,authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite,
      authorizeOriginalFramePublish,verifyOriginalNodeSignature,
      frameTransport:scopeOriginalHostPort(frameTransport,isHostActive,
        ['schema','originalT3ExchangeDependency','createsSubjectStore','createsSubjectIAM'],
        'PUBLICATION_ORIGINAL_WIRE_LIFETIME_REQUIRED'),
    }),
    originalT3OnlyStore:true,createsScheduler:false,createsTaskEngine:false});
}
