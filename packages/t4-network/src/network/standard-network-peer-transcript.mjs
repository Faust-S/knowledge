import {assembleT4CandidateOpaqueChunks} from './standard-network-opaque-chunks.mjs';
import {T4_CANDIDATE_VERSION,isT4NativeSubjectKind,validT4NativeSubjectRevision,
  matchesT4NativeSubjectCriticalExtensions} from './standard-network-wire-candidate.mjs';

/**
 * P2.2 candidate: bounded, READ-ONLY validation of a fully received signed
 * two-node transcript. Every input MUST be an immutable result of the
 * existing readAndVerifySignedFrame port (signature, original Access and
 * original durable replay CAS have already run). The transcript never
 * creates a scheduler, signer, IAM, Store or business Result.
 */
export class T4CandidatePeerTranscriptError extends Error{
  constructor(code){super(code);this.code=code;this.name='T4CandidatePeerTranscriptError';}
}
const fail=code=>{throw new T4CandidatePeerTranscriptError(code);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const HASH=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const STEP=(from,type)=>Object.freeze({from,type});
const BASIS=[
  STEP('SOURCE','HELLO'),STEP('RECIPIENT','HELLO'),
  STEP('SOURCE','CAPABILITIES'),STEP('RECIPIENT','CAPABILITIES'),
  STEP('SOURCE','HEADS'),STEP('RECIPIENT','DIFF_REQUEST'),
  STEP('SOURCE','CHANGE_REF'),
];
export function validateT4CandidatePeerTranscript({
  receipts,sourceNodeRef,recipientNodeRef,scopeRef,sessionRef,
  familyRef,originalWriteOwnerRef,expectedChangeId,
  expectedEncryptionContextRef,ownerEpoch,requiredCryptoSuite,
  requiredVersion=T4_CANDIDATE_VERSION,
}={}){
  if(![sourceNodeRef,recipientNodeRef,scopeRef,sessionRef,
    familyRef,originalWriteOwnerRef,expectedChangeId,
    expectedEncryptionContextRef,requiredCryptoSuite,requiredVersion]
    .every(ID)||sourceNodeRef===recipientNodeRef||
    !Number.isSafeInteger(ownerEpoch)||ownerEpoch<1||
    !Array.isArray(receipts)||receipts.length<11||
    receipts.length>137)
    fail('PEER_TRANSCRIPT_INPUT_INVALID');
  const req=receipts[7];
  const chunks=req?.verifiedBody?.chunkCount;
  if(req?.signedMessageType!=='CHUNK_REQUEST'||
    !Number.isSafeInteger(chunks)||chunks<1||chunks>64)
    fail('PEER_TRANSCRIPT_CHUNK_WINDOW_INVALID');
  const expected=[...BASIS];
  for(let i=0;i<chunks;i++){
    expected.push(STEP('RECIPIENT','CHUNK_REQUEST'));
    expected.push(STEP('SOURCE','CHUNK'));
  }
  expected.push(STEP('RECIPIENT','RECEIVED_ACK'));
  expected.push(STEP('RECIPIENT','VERIFIED_ACK'));
  if(receipts.length!==expected.length)
    fail('PEER_TRANSCRIPT_INCOMPLETE_OR_UNEXPECTED_STAGE');
  const seq={SOURCE:0,RECIPIENT:0};
  const body=[];
  for(let i=0;i<expected.length;i++){
    const message=receipts[i],step=expected[i];
    if(!message||message.schema!==
      'IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1'||
      message.signedMessageType!==step.type||
      message.verifiedSourceNodeRef!==
        (step.from==='SOURCE'?sourceNodeRef:recipientNodeRef)||
      message.verifiedRecipientNodeRef!==
        (step.from==='SOURCE'?recipientNodeRef:sourceNodeRef)||
      message.verifiedSessionRef!==sessionRef||
      message.verifiedScopeRef!==scopeRef||
      message.verifiedOwnerEpoch!==ownerEpoch||
      message.verifiedCryptoSuite!==requiredCryptoSuite||
      !ID(message.verifiedMessageId)||
      !ID(message.verifiedSignerRef)||
      message.verifiedSequence!==++seq[step.from]||
      message.originalSignatureVerified!==true||
      message.originalAccessVerified!==true||
      message.originalReplayCheckpointRecorded!==true||
      message.networkBytesVerified!==true||
      message.exactPreviouslyVerifiedReplay!==false||
      message.originalBusinessApplied!==false||
      message.originalT3ExchangeCalled!==false||
      !message.verifiedBody||typeof message.verifiedBody!=='object')
      fail('PEER_TRANSCRIPT_STAGE_OR_TRUST_INVALID');
    body.push(message.verifiedBody);
  }
  // Both parties independently advertise this EXACT protocol/suite;
  // an arbitrary cloud or a signed advertisement is not an Access grant.
  for(let i=0;i<4;i++){
    const ad=body[i];
    if(!Array.isArray(ad.supportedVersions)||
      !ad.supportedVersions.includes(requiredVersion)||
      !Array.isArray(ad.supportedCryptoSuites)||
      !ad.supportedCryptoSuites.includes(requiredCryptoSuite))
      fail('PEER_TRANSCRIPT_NEGOTIATION_DOWNGRADE');
  }
  const heads=body[4],diff=body[5],change=body[6];
  if(heads.familyRef!==familyRef||
    heads.ownerEpoch!==ownerEpoch||
    !Array.isArray(heads.heads)||
    !heads.heads.every(HASH)||
    diff.familyRef!==familyRef||
    !Array.isArray(diff.fromHeads)||
    !diff.fromHeads.every(HASH)||
    change.changeId!==expectedChangeId||
    change.ownerRef!==originalWriteOwnerRef||
    !isT4NativeSubjectKind(change.changeKind)||
    !validT4NativeSubjectRevision(change.changeKind,change.sourceRevision)||
    !matchesT4NativeSubjectCriticalExtensions(change.changeKind,
      receipts[6].verifiedCriticalExtensions)||
    !HASH(change.contentDigest)||
    !Array.isArray(change.parents)||
    !change.parents.every(HASH))
    fail('PEER_TRANSCRIPT_ORIGINAL_CHANGE_SCOPE_INVALID');
  const pieces=[];
  for(let i=0;i<chunks;i++){
    const request=body[7+i*2],chunk=body[8+i*2];
    if(request.changeId!==expectedChangeId||
      request.contentDigest!==change.contentDigest||
      request.chunkIndex!==i||request.chunkCount!==chunks||
      chunk.changeId!==expectedChangeId||
      chunk.contentDigest!==change.contentDigest||
      chunk.chunkIndex!==i||chunk.chunkCount!==chunks||
      chunk.encryptionContextRef!==expectedEncryptionContextRef)
      fail('PEER_TRANSCRIPT_CHUNK_CAUSAL_MISMATCH');
    pieces.push(chunk);
  }
  // Recompute *every* ciphertext chunk digest and the full ciphertext
  // digest; the signer is not allowed to replace encrypted content after
  // the receiver requested it.
  const assembled=assembleT4CandidateOpaqueChunks({
    bodies:pieces,expectedChangeId,
    expectedContentDigest:change.contentDigest,
    expectedEncryptionContextRef,
  });
  const received=body[7+chunks*2],
    verified=body[8+chunks*2];
  for(const ack of [received,verified]){
    if(ack.changeId!==expectedChangeId||
      ack.contentDigest!==change.contentDigest||
      !ID(ack.ackRef))
      fail('PEER_TRANSCRIPT_ACK_MISMATCH');
  }
  if(received.ackRef===verified.ackRef)
    fail('PEER_TRANSCRIPT_ACK_REUSED');
  return Object.freeze({
    schema:'IWXA_T4_CANDIDATE_PEER_TRANSCRIPT_CHECK_V1',
    sessionRef,sourceNodeRef,recipientNodeRef,scopeRef,
    originalWriteOwnerRef,ownerEpoch,changeId:expectedChangeId,
    changeKind:change.changeKind,
    originalSourceRevision:change.sourceRevision,
    signedFrameCount:expected.length,
    verifiedEncryptedChunkCount:chunks,
    ciphertextDigest:change.contentDigest,
    ciphertextByteLength:assembled.ciphertext.byteLength,
    signedNegotiationAndSequenceVerified:true,
    signedReceivedAndVerifiedAckPresent:true,
    originalSourceEventHistoryIndependentlyProven:false,
    durableOriginalSessionPhaseCheckpointProven:false,
    originalTransportReplayCheckpointVerified:true,
    producerOriginalBusinessMutationInvoked:false,
    recipientOriginalBusinessMutationInvoked:false,
    originalBusinessApplied:false,
    originalT3ExchangeRequired:false,
    productionE2EEKeyManagementProven:false,
    createsScheduler:false,createsStore:false,
  });
}
