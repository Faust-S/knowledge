import {validateT4OriginalNativeCaptureSession,validateT4OriginalReplacementSessionCandidate} from './original-network-publication.mjs';
import {validateT4OriginalProjectedEventWindow,matchesT4OriginalCapturedWindowDigest} from './original-event-window.mjs';
import {validT4NativeOriginalEventRevision} from './standard-network-wire-candidate.mjs';
import {canonical} from '../../../t3-core/src/t3/access/core.mjs';

const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const same=(a,b)=>canonical(a)===canonical(b);
const keys=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k));
const fail=code=>{throw Object.assign(Error(code),{code});};
export const T4_SOURCE_EVENT_WINDOW_REQUEST='IWXA_T4_ORIGINAL_SOURCE_EVENT_WINDOW_REQUEST_V1';
export const T4_SOURCE_EVENT_WINDOW_OWNER_ACTION='t4.network.original.source.owner.read-window';
export const T4_SOURCE_EVENT_WINDOW_PEER_ACTION='t4.network.original.source.peer.read-window';
const RESULT='IWXA_T4_ORIGINAL_SOURCE_EVENT_WINDOW_RESULT_V1';
// One immutable original capture, even when its transport attempt changes.
// No general listEvents, range query, payload read or write authority.
export function createT4OriginalSourceEventWindowRequest({session,sourceCursorBefore,requesterNodeRef,ownerNodeRef,includeOriginalCaptureBinding=false}={}){
  const c=validateT4OriginalNativeCaptureSession(session),before=structuredClone(sourceCursorBefore);
  if(typeof includeOriginalCaptureBinding!=='boolean'||requesterNodeRef!==c.recipientNodeRef||ownerNodeRef!==c.sourceNodeRef||
    !keys(before,['schema','workspaceId','originalWriteOwnerRef','lastEventId','seenEventCount','sourcePrefixDigest','originalPermissionProof'])||
    before.schema!=='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1'||before.workspaceId!==c.workspaceId||before.originalWriteOwnerRef!==c.originalWriteOwnerRef||
    before.sourcePrefixDigest!==c.sourcePrefixDigestBefore||before.originalPermissionProof!==false||!ID(before.lastEventId)||
    before.lastEventId===c.sourceEventId||!Number.isSafeInteger(before.seenEventCount)||before.seenEventCount<1||before.seenEventCount>=Number.MAX_SAFE_INTEGER)
    fail('SOURCE_EVENT_WINDOW_REQUEST_INVALID');
  return Object.freeze({schema:T4_SOURCE_EVENT_WINDOW_REQUEST,session:c,sourceCursorBefore:before,requesterNodeRef,ownerNodeRef,
    originalHistoricalEvidenceOnly:true,originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false,
    ...(includeOriginalCaptureBinding?{includeOriginalCaptureBinding:true}:{})});
}
function exactRequest(raw){const r=createT4OriginalSourceEventWindowRequest(raw);if(!same(r,raw))fail('SOURCE_EVENT_WINDOW_REQUEST_INVALID');return r;}
export function validateT4OriginalSourceEventWindowSnapshot(raw,request){
  const r=exactRequest(request),c=r.session,v=structuredClone(raw);
  if(!keys(v,['schema','request','window','nextCursor','originalOwnerReadOnly','originalCaptureEvidenceVerified','originalEventPayloadReturned','originalSubjectMutationInvoked','liveNetworkAuthorityGranted',
      ...(r.includeOriginalCaptureBinding?['originalCaptureBinding']:[])])||
    v.schema!==RESULT||!same(v.request,r)||v.originalOwnerReadOnly!==true||v.originalCaptureEvidenceVerified!==true||
    v.originalEventPayloadReturned!==false||v.originalSubjectMutationInvoked!==false||v.liveNetworkAuthorityGranted!==false)
    fail('SOURCE_EVENT_WINDOW_RESULT_INVALID');
  const {window:w,nextCursor:a}=validateT4OriginalProjectedEventWindow({workspaceId:c.workspaceId,originalWriteOwnerRef:c.originalWriteOwnerRef,
    cursor:r.sourceCursorBefore,result:{window:v.window,nextCursor:v.nextCursor}});
  if(w.count!==1||w.lastEventId!==c.sourceEventId||w.eventRefs[0].eventDigest!==c.sourceEventDigest||
    !validT4NativeOriginalEventRevision(c.changeKind,c.sourceRevision,w.eventRefs[0].revision)||
    w.sourcePrefixDigestAfter!==c.sourcePrefixDigestAfter||!matchesT4OriginalCapturedWindowDigest(w,c.capturedWindowDigest))
    fail('SOURCE_EVENT_WINDOW_CAPTURE_MISMATCH');
  const binding=r.includeOriginalCaptureBinding?validateCaptureBinding(v.originalCaptureBinding,c):null;
  return Object.freeze({...v,window:w,nextCursor:a,...(binding?{originalCaptureBinding:binding}:{})});
}
export class T4OriginalSourceEventWindowUnavailable extends Error{
  constructor(sessionRef){super('SOURCE_EVENT_WINDOW_OWNER_BUSY');this.code='SOURCE_EVENT_WINDOW_OWNER_BUSY';this.sessionRef=sessionRef;}
}
// Existing ORIGINAL source owner and its capture selector perform all local
// prefix and immutable Outbox checks. Return exactly one projected Event.
export async function readT4OriginalSourceEventWindow({request,technicalWorkspaceId,getMode,readOriginalHostContext,
  authorizeOriginalOwnerHistoryRead,readOriginalCaptureSelection}={}){
  const r=exactRequest(request),c=r.session;
  if(!ID(technicalWorkspaceId)||technicalWorkspaceId===c.workspaceId||
    ![getMode,readOriginalHostContext,authorizeOriginalOwnerHistoryRead,readOriginalCaptureSelection].every(f=>typeof f==='function'))
    fail('SOURCE_EVENT_WINDOW_ORIGINAL_PORTS_REQUIRED');
  async function context(){
    if(getMode()!=='T4_NETWORK')fail('SOURCE_EVENT_WINDOW_MODE_OFF');const ctx=await readOriginalHostContext();
    if(getMode()!=='T4_NETWORK'||ctx?.workspaceId!==technicalWorkspaceId||ctx.originalWriteOwnerRef!==c.originalWriteOwnerRef||
      ctx.nodeRef!==c.sourceNodeRef||ctx.scopeRef!==c.scopeRef||!ID(ctx.hostSessionRef))fail('SOURCE_EVENT_WINDOW_CONTEXT_INVALID');
    return {workspaceId:ctx.workspaceId,originalWriteOwnerRef:ctx.originalWriteOwnerRef,nodeRef:ctx.nodeRef,scopeRef:ctx.scopeRef,hostSessionRef:ctx.hostSessionRef};
  }
  const initial=await context();
  async function guard(){
    if(!same(initial,await context()))fail('SOURCE_EVENT_WINDOW_CONTEXT_CHANGED');
    if(await authorizeOriginalOwnerHistoryRead(Object.freeze({operation:T4_SOURCE_EVENT_WINDOW_OWNER_ACTION,request:structuredClone(r),role:'SOURCE',
      technicalWorkspaceId,originalHostSessionRef:initial.hostSessionRef,originalOwnerReadOnly:true,originalHistoricalEvidenceOnly:true,
      originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false}))!==true)fail('SOURCE_EVENT_WINDOW_AUTHORITY_DENIED');
    if(!same(initial,await context()))fail('SOURCE_EVENT_WINDOW_CONTEXT_CHANGED');
  }
  await guard();const selected=await readOriginalCaptureSelection(structuredClone(r.sourceCursorBefore),{includeOriginalEventWindow:true,
    ...(r.includeOriginalCaptureBinding?{includeOriginalCaptureBinding:true}:{})});await guard();
  if(selected?.schema!=='IWXA_T4_ORIGINAL_NATIVE_CAPTURE_SELECTION_V1'||selected.state!=='ORIGINAL_NATIVE_SESSION_SELECTED'||
    !same(selected.session,c)||!same(selected.sourceCursorBefore,r.sourceCursorBefore)||selected.originalCaptureEvidenceVerified!==true||
    selected.originalSourceOwnerReadVerified!==true||selected.originalSourceCursorAdvanced!==false||selected.originalNetworkPublished!==false||
    selected.originalSubjectMutationInvoked!==false||selected.capturedPlaintextReturned!==false||
    (r.includeOriginalCaptureBinding&&selected.originalCaptureBinding?.sourceHostSessionRef!==initial.hostSessionRef))
    fail('SOURCE_EVENT_WINDOW_CAPTURE_MISMATCH');
  return validateT4OriginalSourceEventWindowSnapshot({schema:RESULT,request:r,window:selected.sourceWindow,nextCursor:selected.sourceCursorAfter,
    originalOwnerReadOnly:true,originalCaptureEvidenceVerified:true,originalEventPayloadReturned:false,originalSubjectMutationInvoked:false,liveNetworkAuthorityGranted:false,
    ...(r.includeOriginalCaptureBinding?{originalCaptureBinding:selected.originalCaptureBinding}:{})},r);
}

// Only the metadata already needed by the existing native source verifiers.
// In particular no arbitrary fields from delta.data, asset bytes, preImage,
// extensions, or original Event payload can cross the owner boundary.
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const DIG=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const metadata=Object.freeze({
  OBJECT_PUT:['schemaId','schemaVersion','objectContentDigest'],
  GRAPH_COMMIT:['graphContentDigest','originalTransactionId'],
  ASSET_PUT:['assetBytesSha256'],
  RELATION_PUT:['toObjectId','relationContentDigest'],
  OBJECT_DELETE:['preImageDigest','captureRef'],
  ASSET_DELETE:['preImageDigest','captureRef'],
  RELATION_DELETE:['preImageDigest','captureRef'],
});
function validateCaptureBinding(raw,session){
  const b=structuredClone(raw),fields=metadata[session.changeKind];
  if(!fields||!keys(b,['sourceHostSessionRef','subjectId','objectId',...fields])||
    ![b.sourceHostSessionRef,b.subjectId,b.objectId].every(ID)||
    fields.some(k=>!(k.endsWith('Digest')?DIG(b[k]):k.endsWith('Sha256')?SHA(b[k]):ID(b[k])))||
    (['OBJECT_PUT','GRAPH_COMMIT','OBJECT_DELETE'].includes(session.changeKind)&&b.objectId!==b.subjectId))
    fail('SOURCE_EVENT_WINDOW_CAPTURE_BINDING_INVALID');
  return Object.freeze(b);
}
export function projectT4OriginalSourceCaptureBinding({captured,session,sourceHostSessionRef}={}){
  const c=validateT4OriginalNativeCaptureSession(session),d=captured?.prepared?.delta;
  if(captured?.kind!==c.changeKind||captured.originalIntentEventAndCanonicalBytesVerified!==true||
    captured.capturedWindowDigestVerified!==true||captured.prepared.sha256!==c.capturedSha256||
    d?.sourceEventId!==c.sourceEventId||d.sourceEventDigest!==c.sourceEventDigest||d.windowDigest!==c.capturedWindowDigest)
    fail('SOURCE_EVENT_WINDOW_CAPTURE_BINDING_INVALID');
  return validateCaptureBinding({sourceHostSessionRef,subjectId:captured.subjectId,objectId:captured.objectId,
    ...Object.fromEntries(metadata[c.changeKind].map(k=>[k,d[k]]))},c);
}

// One wake, one immutable capture identity. Every actual peer read obtains
// fresh signed owner/peer authority. Retain only its small verified metadata
// for comparison during THIS wake, never a cached grant or plaintext delta.
export function createT4OriginalSourceCaptureVerifier({session,sourceCursorBefore,readOriginalSourceCaptureSnapshot,getMode}={}){
  const c=session?.originalCaptureSession?validateT4OriginalReplacementSessionCandidate(session):validateT4OriginalNativeCaptureSession(session);
  const root=c.originalCaptureSession??c,request=createT4OriginalSourceEventWindowRequest({session:root,sourceCursorBefore,
    requesterNodeRef:c.recipientNodeRef,ownerNodeRef:c.sourceNodeRef,includeOriginalCaptureBinding:true});
  if(typeof readOriginalSourceCaptureSnapshot!=='function'||typeof getMode!=='function')fail('SOURCE_CAPTURE_VERIFIER_PORTS_REQUIRED');
  let prior=null,contentVerified=false;
  const mode=()=>{if(getMode()!=='T4_NETWORK')fail('SOURCE_EVENT_WINDOW_MODE_OFF');};
  async function read(){
    mode();contentVerified=false;const raw=await readOriginalSourceCaptureSnapshot(structuredClone(request));mode();
    if(raw===null)throw new T4OriginalSourceEventWindowUnavailable(c.sessionRef);
    const result=validateT4OriginalSourceEventWindowSnapshot(raw,request);
    if(prior!==null&&(!same(prior.originalCaptureBinding,result.originalCaptureBinding)||
      !same(prior.nextCursor,result.nextCursor)))fail('SOURCE_CAPTURE_VERIFIER_OWNER_CHANGED');
    prior=result;return result;
  }
  function head(p){
    return p?.schema==='IWXA_T4_ORIGINAL_SOURCE_NETWORK_HEAD_PROOF_V1'&&p.originalCapturedRevisionProofRequired===true&&
      p.signedHeadMatchesOriginalT3EventPrefix===true&&p.signedDiffMatchesOriginalT3Frontier===true&&p.originalSourceSubjectIndependentlyRead===true&&
      p.originalBusinessApplied===false&&p.originalT3ExchangeUsed===false&&p.workspaceId===c.workspaceId&&
      p.originalWriteOwnerRef===c.originalWriteOwnerRef&&p.sourceNodeRef===c.sourceNodeRef&&p.recipientNodeRef===c.recipientNodeRef&&
      p.scopeRef===c.scopeRef&&p.sessionRef===c.sessionRef&&p.ownerEpoch===c.ownerEpoch&&p.changeId===c.changeId&&
      p.changeKind===c.changeKind&&p.originalSourceEventId===c.sourceEventId&&p.originalEventDigest===c.sourceEventDigest&&
      p.originalSourceRevision===c.sourceRevision&&p.sourceEventWindowDigest===c.capturedWindowDigest&&
      p.sourcePrefixDigestBefore===c.sourcePrefixDigestBefore&&p.sourcePrefixDigestAfter===c.sourcePrefixDigestAfter;
  }
  return Object.freeze({
    // Context is the actual source Host reference proved by the first owner
    // read. Every subsequent owner read checks that reference again; the
    // enclosing recipient guard checks the local original lifetime/Access.
    async readOriginalSourceHostContext(){
      mode();const v=prior??await read();return Object.freeze({workspaceId:c.workspaceId,originalWriteOwnerRef:c.originalWriteOwnerRef,
        nodeRef:c.sourceNodeRef,scopeRef:c.scopeRef,hostSessionRef:v.originalCaptureBinding.sourceHostSessionRef});
    },
    async readOriginalSourceWindow(){const {window,nextCursor}=await read();return {window,nextCursor};},
    async verifyOriginalSourceSubject(p){
      const v=await read(),e=v.window.eventRefs[0];
      return p?.operation==='t4.network.verify.original.subject'&&p.originalT3SubjectAndEventReadbackRequired===true&&
        p.originalCapturedRevisionReadbackRequired===true&&p.workspaceId===c.workspaceId&&p.originalWriteOwnerRef===c.originalWriteOwnerRef&&
        p.sourceNodeRef===c.sourceNodeRef&&p.recipientNodeRef===c.recipientNodeRef&&p.changeId===c.changeId&&p.changeKind===c.changeKind&&
        p.originalSourceEventId===c.sourceEventId&&p.originalEventDigest===c.sourceEventDigest&&p.originalEventType===e.eventType&&
        p.originalObjectId===e.objectId&&p.originalEventRevision===e.revision&&p.originalSourceRevision===c.sourceRevision&&
        p.originalBeforePrefixDigest===c.sourcePrefixDigestBefore&&p.originalAfterPrefixDigest===c.sourcePrefixDigestAfter&&p.originalEventWindowDigest===c.capturedWindowDigest;
    },
    async verifyOriginalSourceBinding(p){
      contentVerified=false;const v=await read(),b=v.originalCaptureBinding,h=p?.originalSourceHeadProof;
      if(!head(h)||p.operation!=='t4.network.original.sealed.open'||p.sourceNodeRef!==c.sourceNodeRef||p.recipientNodeRef!==c.recipientNodeRef||
        p.scopeRef!==c.scopeRef||p.sessionRef!==c.sessionRef||p.changeId!==c.changeId||p.changeKind!==c.changeKind||
        p.sourceEventId!==c.sourceEventId||p.ownerRef!==c.originalWriteOwnerRef||p.originalEventDigest!==c.sourceEventDigest||
        p.sourcePrefixDigestAfter!==c.sourcePrefixDigestAfter||p.contentDigest!==h.ciphertextContentDigest)return false;
      if(p.originalT3SourceEventAndSubjectReadRequired===true)return p.originalT3SourceObjectEventAndContentReadbackRequired===undefined&&p.originalT3SourceSubjectEventAndContentReadbackRequired===undefined;
      if(p.originalWorkspaceId!==c.workspaceId||p.originalSourceRevision!==c.sourceRevision||p.originalSourceEventDigest!==c.sourceEventDigest||
        p.originalEventWindowDigest!==c.capturedWindowDigest)return false;
      contentVerified=p.originalSubjectDeltaSha256===c.capturedSha256&&(c.changeKind==='OBJECT_PUT'?p.originalT3SourceObjectEventAndContentReadbackRequired===true&&p.originalObjectId===b.subjectId&&
        p.originalSchemaId===b.schemaId&&p.originalSchemaVersion===b.schemaVersion&&p.originalObjectContentDigest===b.objectContentDigest:
        p.originalT3SourceSubjectEventAndContentReadbackRequired===true&&p.originalSubjectKind===c.changeKind&&p.originalSubjectId===b.subjectId);
      return contentVerified;
    },
    async verifyOriginalSourceEvent(p){
      // This is a previously authenticated immutable capture witness, NOT a
      // cached Access grant. Do not perform network I/O inside APPLY_INTENT:
      // a busy owner at that boundary could strand an unexecuted mutation.
      // The existing local write authority and Host mutation fence run at
      // each invocation, and a subsequent cursor commit rereads the owner.
      mode();if(!contentVerified||prior===null)return false;
      const v=prior,b=v.originalCaptureBinding,e=v.window.eventRefs[0];
      if(p?.workspaceId!==c.workspaceId||p.originalWriteOwnerRef!==c.originalWriteOwnerRef||p.sourceEventId!==c.sourceEventId||
        p.sourceEventDigest!==c.sourceEventDigest||p.windowDigest!==c.capturedWindowDigest||p.networkEnvelopeIsNotSignedEvidence!==true)return false;
      switch(c.changeKind){
        case 'OBJECT_PUT':return p.operation==='t4.original-source-event.verify'&&p.objectId===b.subjectId&&p.originalEventType===e.eventType&&
          p.sourceRevision===c.sourceRevision&&p.objectContentDigest===b.objectContentDigest&&p.wireSha256===c.capturedSha256;
        case 'GRAPH_COMMIT':return p.operation==='t4.original-source-event.verify'&&p.kind===c.changeKind&&p.subjectKind===c.changeKind&&
          p.objectId===b.subjectId&&p.subjectId===b.subjectId&&p.originalEventType===e.eventType&&p.sourceRevision===c.sourceRevision&&
          p.graphContentDigest===b.graphContentDigest&&p.originalGraphTransactionId===b.originalTransactionId&&p.wireSha256===c.capturedSha256;
        case 'ASSET_PUT':return p.operation==='t4.original-asset-source.verify'&&p.assetId===b.subjectId&&p.objectId===b.objectId&&p.sourceRevision===c.sourceRevision&&
          p.assetBytesSha256===b.assetBytesSha256&&p.originalSubjectKind===c.changeKind&&p.originalSubjectId===b.subjectId&&p.originalSubjectDeltaSha256===c.capturedSha256;
        case 'RELATION_PUT':return p.operation==='t4.original-relation-source.verify'&&p.relationId===b.subjectId&&p.fromObjectId===b.objectId&&p.toObjectId===b.toObjectId&&
          p.relationContentDigest===b.relationContentDigest&&p.originalSubjectKind===c.changeKind&&p.originalSubjectId===b.subjectId&&p.originalSubjectDeltaSha256===c.capturedSha256;
        default:return p.operation==='t4.original-delete.source-verify'&&p.kind===c.changeKind&&p.subjectId===b.subjectId&&p.originalEventType===e.eventType&&
          p.preImageDigest===b.preImageDigest&&p.captureRef===b.captureRef&&p.originalSubjectDeltaSha256===c.capturedSha256&&
          (p.originalObjectId===undefined||p.originalObjectId===b.objectId)&&
          (p.expectedOriginalIdempotencyKey===undefined||p.expectedOriginalIdempotencyKey==='t4-delete-'+c.capturedSha256);
      }
    }
  });
}
