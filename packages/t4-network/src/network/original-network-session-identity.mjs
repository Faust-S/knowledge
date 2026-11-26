import {createHash} from 'node:crypto';
import {validT4NativeSubjectRevision,deriveT4OriginalReplacementAttempt,validateT4CandidateReplacementHeadBinding}
  from './standard-network-wire-candidate.mjs';

// The existing original publication identity, shared with backing and
// negotiation. A deterministic session or candidate never grants access.
export class T4OriginalNetworkPublicationError extends Error {
  constructor(code,details={},cause){
    super(code,cause===undefined?undefined:{cause});this.name='T4OriginalNetworkPublicationError';this.code=code;
    this.details=Object.freeze({...details});
  }
}
const fail=(code,details,cause)=>{throw new T4OriginalNetworkPublicationError(code,details,cause);};

const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const DIG=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const sorted=x=>Array.isArray(x)?x.map(sorted):
  x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
const same=(a,b)=>JSON.stringify(sorted(a))===JSON.stringify(sorted(b));
const digest=(domain,x)=>'sha256:'+createHash('sha256')
  .update('IWXA-T4-ORIGINAL-'+domain+'-V1\0').update(JSON.stringify(sorted(x))).digest('hex');
const deepFreeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(deepFreeze);Object.freeze(x);}return x;};
const SESSION='IWXA_T4_ORIGINAL_NATIVE_CAPTURE_SESSION_V1';
export function canonicalSession(input){
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

const REPLACEMENT_SESSION='IWXA_T4_ORIGINAL_REPLACEMENT_SESSION_CANDIDATE_V1';
export function deriveT4OriginalReplacementSessionCandidate({originalCaptureSession,replacement}={}){
  const original=validateT4OriginalNativeCaptureSession(originalCaptureSession);
  const binding=validateT4CandidateReplacementHeadBinding(replacement);
  if(binding.previousSessionRef!==original.sessionRef||binding.changeId!==original.changeId)
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_IDENTITY_INVALID');
  const next=deriveT4OriginalReplacementAttempt(original);
  return deepFreeze({...original,schema:REPLACEMENT_SESSION,sessionRef:next.replacementSessionRef,
    originalCaptureSession:original,replacement:binding});
}
export function validateT4OriginalReplacementSessionCandidate(candidate){
  const exact=deriveT4OriginalReplacementSessionCandidate(candidate);
  if(!same(exact,candidate))fail('PUBLICATION_ORIGINAL_REPLACEMENT_IDENTITY_INVALID');
  return exact;
}

