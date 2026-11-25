import {validateT4OriginalNativeCaptureSession} from './original-network-publication.mjs';
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
export function createT4OriginalSourceEventWindowRequest({session,sourceCursorBefore,requesterNodeRef,ownerNodeRef}={}){
  const c=validateT4OriginalNativeCaptureSession(session),before=structuredClone(sourceCursorBefore);
  if(requesterNodeRef!==c.recipientNodeRef||ownerNodeRef!==c.sourceNodeRef||
    !keys(before,['schema','workspaceId','originalWriteOwnerRef','lastEventId','seenEventCount','sourcePrefixDigest','originalPermissionProof'])||
    before.schema!=='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1'||before.workspaceId!==c.workspaceId||before.originalWriteOwnerRef!==c.originalWriteOwnerRef||
    before.sourcePrefixDigest!==c.sourcePrefixDigestBefore||before.originalPermissionProof!==false||!ID(before.lastEventId)||
    before.lastEventId===c.sourceEventId||!Number.isSafeInteger(before.seenEventCount)||before.seenEventCount<1||before.seenEventCount>=Number.MAX_SAFE_INTEGER)
    fail('SOURCE_EVENT_WINDOW_REQUEST_INVALID');
  return Object.freeze({schema:T4_SOURCE_EVENT_WINDOW_REQUEST,session:c,sourceCursorBefore:before,requesterNodeRef,ownerNodeRef,
    originalHistoricalEvidenceOnly:true,originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false});
}
function exactRequest(raw){const r=createT4OriginalSourceEventWindowRequest(raw);if(!same(r,raw))fail('SOURCE_EVENT_WINDOW_REQUEST_INVALID');return r;}
export function validateT4OriginalSourceEventWindowSnapshot(raw,request){
  const r=exactRequest(request),c=r.session,v=structuredClone(raw);
  if(!keys(v,['schema','request','window','nextCursor','originalOwnerReadOnly','originalCaptureEvidenceVerified','originalEventPayloadReturned','originalSubjectMutationInvoked','liveNetworkAuthorityGranted'])||
    v.schema!==RESULT||!same(v.request,r)||v.originalOwnerReadOnly!==true||v.originalCaptureEvidenceVerified!==true||
    v.originalEventPayloadReturned!==false||v.originalSubjectMutationInvoked!==false||v.liveNetworkAuthorityGranted!==false)
    fail('SOURCE_EVENT_WINDOW_RESULT_INVALID');
  const {window:w,nextCursor:a}=validateT4OriginalProjectedEventWindow({workspaceId:c.workspaceId,originalWriteOwnerRef:c.originalWriteOwnerRef,
    cursor:r.sourceCursorBefore,result:{window:v.window,nextCursor:v.nextCursor}});
  if(w.count!==1||w.lastEventId!==c.sourceEventId||w.eventRefs[0].eventDigest!==c.sourceEventDigest||
    !validT4NativeOriginalEventRevision(c.changeKind,c.sourceRevision,w.eventRefs[0].revision)||
    w.sourcePrefixDigestAfter!==c.sourcePrefixDigestAfter||!matchesT4OriginalCapturedWindowDigest(w,c.capturedWindowDigest))
    fail('SOURCE_EVENT_WINDOW_CAPTURE_MISMATCH');
  return Object.freeze({...v,window:w,nextCursor:a});
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
  await guard();const selected=await readOriginalCaptureSelection(structuredClone(r.sourceCursorBefore),{includeOriginalEventWindow:true});await guard();
  if(selected?.schema!=='IWXA_T4_ORIGINAL_NATIVE_CAPTURE_SELECTION_V1'||selected.state!=='ORIGINAL_NATIVE_SESSION_SELECTED'||
    !same(selected.session,c)||!same(selected.sourceCursorBefore,r.sourceCursorBefore)||selected.originalCaptureEvidenceVerified!==true||
    selected.originalSourceOwnerReadVerified!==true||selected.originalSourceCursorAdvanced!==false||selected.originalNetworkPublished!==false||
    selected.originalSubjectMutationInvoked!==false||selected.capturedPlaintextReturned!==false)
    fail('SOURCE_EVENT_WINDOW_CAPTURE_MISMATCH');
  return validateT4OriginalSourceEventWindowSnapshot({schema:RESULT,request:r,window:selected.sourceWindow,nextCursor:selected.sourceCursorAfter,
    originalOwnerReadOnly:true,originalCaptureEvidenceVerified:true,originalEventPayloadReturned:false,originalSubjectMutationInvoked:false,liveNetworkAuthorityGranted:false},r);
}
