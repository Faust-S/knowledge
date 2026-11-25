import {validateT4OriginalNativeCaptureSession} from './original-network-publication.mjs';
import {canonical} from '../../../t3-core/src/t3/access/core.mjs';

const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const DIG=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const same=(a,b)=>canonical(a)===canonical(b);
const keys=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k));
const fail=code=>{throw Object.assign(Error(code),{code});};
export const T4_RECIPIENT_RESULT_REQUEST='IWXA_T4_ORIGINAL_RECIPIENT_RESULT_REQUEST_V1';
export const T4_RECIPIENT_RESULT_OWNER_ACTION='t4.network.original.recipient.owner.read-result';
export const T4_RECIPIENT_RESULT_PEER_ACTION='t4.network.original.recipient.peer.read-result';
const RESULT='IWXA_T4_ORIGINAL_RECIPIENT_RESULT_READ_V1';
const fields=['frontierRecordRevision','frontierRecordChainHash','originalRecipientEventId','originalRecipientEventDigest',
  'originalRecipientRevision','originalRecipientStateDigest','originalPhaseRef','originalPhaseChainHash','originalPublicationRef',
  'originalPublicationChainHash','signedAppliedAckDigest'];

// Ordinary captures only: a successor needs its separate pre-frontier
// terminal evidence, since its recipient cursor follows source confirmation.
export function createT4OriginalRecipientResultRequest({session,requesterNodeRef,ownerNodeRef}={}){
  const c=validateT4OriginalNativeCaptureSession(session);
  if(requesterNodeRef!==c.sourceNodeRef||ownerNodeRef!==c.recipientNodeRef)fail('RECIPIENT_RESULT_REQUEST_INVALID');
  return Object.freeze({schema:T4_RECIPIENT_RESULT_REQUEST,session:c,requesterNodeRef,ownerNodeRef,
    originalHistoricalEvidenceOnly:true,originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false});
}
function exact(raw){const r=createT4OriginalRecipientResultRequest(raw);if(!same(r,raw))fail('RECIPIENT_RESULT_REQUEST_INVALID');return r;}
export function validateT4OriginalRecipientResultSnapshot(raw,request){
  const r=exact(request),c=r.session,v=structuredClone(raw);
  if(!keys(v,['schema','request','result','originalOwnerReadOnly','originalCommittedRecipientResultVerified',
    'historicalStateFromOriginalFrontier','currentSubjectStateClaimed','originalEventPayloadReturned','originalSubjectMutationInvoked','liveNetworkAuthorityGranted'])||
    v.schema!==RESULT||!same(v.request,r)||v.originalOwnerReadOnly!==true||v.originalCommittedRecipientResultVerified!==true||
    v.historicalStateFromOriginalFrontier!==true||v.currentSubjectStateClaimed!==false||v.originalEventPayloadReturned!==false||
    v.originalSubjectMutationInvoked!==false||v.liveNetworkAuthorityGranted!==false)
    fail('RECIPIENT_RESULT_SNAPSHOT_INVALID');
  const b=v.result;
  if(!keys(b,fields)||!Number.isSafeInteger(b.frontierRecordRevision)||b.frontierRecordRevision<1||
    ![b.originalRecipientEventId,b.originalPhaseRef,b.originalPublicationRef].every(ID)||
    ![b.frontierRecordChainHash,b.originalRecipientEventDigest,b.originalRecipientStateDigest,b.originalPhaseChainHash,b.originalPublicationChainHash,b.signedAppliedAckDigest].every(DIG)||
    b.originalRecipientRevision!==c.sourceRevision)
    fail('RECIPIENT_RESULT_EVIDENCE_INVALID');
  return Object.freeze({...v,result:Object.freeze(b)});
}
export class T4OriginalRecipientResultUnavailable extends Error{
  constructor(sessionRef){super('RECIPIENT_RESULT_OWNER_NOT_READY');this.code='RECIPIENT_RESULT_OWNER_NOT_READY';this.sessionRef=sessionRef;}
}

// Project one exact committed record, using the same original recipient
// cursor reader that verifies every actual Result Event and chain at K24.
// Never call the source from here or infer a Result from a signed frame.
export async function readT4OriginalRecipientResult({request,technicalWorkspaceId,getMode,readOriginalHostContext,
  authorizeOriginalOwnerHistoryRead,originalCursorPort}={}){
  const r=exact(request),c=r.session;
  if(!ID(technicalWorkspaceId)||technicalWorkspaceId===c.workspaceId||
    ![getMode,readOriginalHostContext,authorizeOriginalOwnerHistoryRead].every(f=>typeof f==='function')||
    originalCursorPort?.schema!=='IWXA_T4_ORIGINAL_HOST_NATIVE_RECIPIENT_CURSOR_PORT_V1'||originalCursorPort.originalT3OnlyStore!==true||
    originalCursorPort.identity?.technicalWorkspaceId!==technicalWorkspaceId||originalCursorPort.identity?.sourceWorkspaceId!==c.workspaceId||
    !['originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch'].every(k=>originalCursorPort.identity[k]===c[k])||
    typeof originalCursorPort.inspectOriginalCommittedRecipientResults!=='function')fail('RECIPIENT_RESULT_ORIGINAL_PORT_REQUIRED');
  async function context(){
    if(getMode()!=='T4_NETWORK')fail('RECIPIENT_RESULT_MODE_OFF');const ctx=await readOriginalHostContext();
    if(getMode()!=='T4_NETWORK'||ctx?.workspaceId!==technicalWorkspaceId||ctx.originalWriteOwnerRef!==c.originalWriteOwnerRef||
      ctx.nodeRef!==c.recipientNodeRef||ctx.scopeRef!==c.scopeRef||!ID(ctx.hostSessionRef))fail('RECIPIENT_RESULT_CONTEXT_INVALID');
    return {workspaceId:ctx.workspaceId,originalWriteOwnerRef:ctx.originalWriteOwnerRef,nodeRef:ctx.nodeRef,scopeRef:ctx.scopeRef,hostSessionRef:ctx.hostSessionRef};
  }
  const initial=await context();
  async function guard(){
    if(!same(initial,await context()))fail('RECIPIENT_RESULT_CONTEXT_CHANGED');
    if(await authorizeOriginalOwnerHistoryRead(Object.freeze({operation:T4_RECIPIENT_RESULT_OWNER_ACTION,request:structuredClone(r),role:'RECIPIENT',
      technicalWorkspaceId,originalHostSessionRef:initial.hostSessionRef,originalOwnerReadOnly:true,originalHistoricalEvidenceOnly:true,
      originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false}))!==true)fail('RECIPIENT_RESULT_AUTHORITY_DENIED');
    if(!same(initial,await context()))fail('RECIPIENT_RESULT_CONTEXT_CHANGED');
  }
  const selection=Object.fromEntries(['sessionRef','changeId','sourceEventId','sourceEventDigest','capturedSha256'].map(k=>[k,c[k]]));
  await guard();const proof=await originalCursorPort.inspectOriginalCommittedRecipientResults({selections:[selection],allowUncommitted:true});await guard();
  if(proof?.schema!=='IWXA_T4_ORIGINAL_COMMITTED_RECIPIENT_RESULTS_V1'||proof.technicalWorkspaceId!==technicalWorkspaceId||
    proof.sourceWorkspaceId!==c.workspaceId||!['originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch'].every(k=>proof[k]===c[k])||
    proof.checkpointRef!==originalCursorPort.checkpointRef||proof.originalT3OnlyStore!==true||proof.uncommittedSelectionsOmitted!==true||
    proof.originalSubjectMutationInvoked!==false||proof.originalRecipientCursorAdvanced!==false||proof.remoteNetworkReadRequired!==false||
    proof.newAppliedAckPermitted!==false||proof.historicalReceiptFabricated!==false||proof.currentSubjectStateClaimed!==false||
    !Number.isSafeInteger(proof.frontierRevision)||proof.frontierRevision<0||!DIG(proof.frontierChainHash)||
    !Array.isArray(proof.results)||proof.results.length>1)
    fail('RECIPIENT_RESULT_ORIGINAL_FRONTIER_INVALID');
  if(proof.results.length===0)return null;
  const b=proof.results[0];
  if(proof.originalT3EventChainVerified!==true||b.frontierRecordRevision>proof.frontierRevision||!same(b.session,c)||
    b.originalT3EventReadback!==true||b.originalCommittedRecipientResultVerified!==true||b.historicalStateFromOriginalFrontier!==true||
    b.historicalSubjectBytesReconstructed!==false||b.currentSubjectReadback!==false||b.originalBusinessAppliedAtCommit!==true||b.newAppliedAckPermitted!==false||
    b.sourceCursorBefore?.sourcePrefixDigest!==c.sourcePrefixDigestBefore||b.sourceCursorAfter?.sourcePrefixDigest!==c.sourcePrefixDigestAfter||
    b.sourceCursorAfter?.lastEventId!==c.sourceEventId)
    fail('RECIPIENT_RESULT_ORIGINAL_FRONTIER_INVALID');
  return validateT4OriginalRecipientResultSnapshot({schema:RESULT,request:r,result:Object.fromEntries(fields.map(k=>[k,b[k]])),
    originalOwnerReadOnly:true,originalCommittedRecipientResultVerified:true,historicalStateFromOriginalFrontier:true,
    currentSubjectStateClaimed:false,originalEventPayloadReturned:false,originalSubjectMutationInvoked:false,liveNetworkAuthorityGranted:false},r);
}

// The source phase must match the exact accepted ACK and original Result.
// Missing or busy owner is a typed wait, not a negative proof or a retry.
export function createT4OriginalRemoteRecipientAppliedVerifier({session,getMode,readOriginalRecipientResult}={}){
  const c=validateT4OriginalNativeCaptureSession(session),request=createT4OriginalRecipientResultRequest({session:c,requesterNodeRef:c.sourceNodeRef,ownerNodeRef:c.recipientNodeRef});
  if(![getMode,readOriginalRecipientResult].every(f=>typeof f==='function'))fail('RECIPIENT_RESULT_ORIGINAL_PORT_REQUIRED');
  return async p=>{
    if(getMode()!=='T4_NETWORK'||p?.operation!=='t4.original.network.session.applied.verify'||
      !['sourceNodeRef','recipientNodeRef','scopeRef','sessionRef','changeId','ownerEpoch','changeKind'].every(k=>p[k]===c[k])||
      p.localNodeRef!==c.sourceNodeRef||p.originalRecipientEventAndStateReadbackRequired!==true||p.signedAppliedAckAloneIsInsufficient!==true||
      !ID(p.originalRecipientEventId)||p.originalRecipientRevision!==c.sourceRevision||!DIG(p.originalRecipientStateDigest)||
      !DIG(p.evidenceDigest)||p.evidenceRef!==p.evidenceDigest.slice(7)+'.t4n')return false;
    const raw=await readOriginalRecipientResult(structuredClone(request));
    if(getMode()!=='T4_NETWORK')fail('RECIPIENT_RESULT_MODE_OFF');
    if(raw===null)throw new T4OriginalRecipientResultUnavailable(c.sessionRef);
    const {result:b}=validateT4OriginalRecipientResultSnapshot(raw,request);
    return b.originalRecipientEventId===p.originalRecipientEventId&&b.originalRecipientRevision===p.originalRecipientRevision&&
      b.originalRecipientStateDigest===p.originalRecipientStateDigest&&b.signedAppliedAckDigest===p.evidenceDigest;
  };
}
