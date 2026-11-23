import {createHash} from 'node:crypto';
import {
  decodeT4CandidateFrame,verifyT4CandidateWireFrame,
} from './standard-network-wire-candidate.mjs';

/**
 * P2.0 experimental native T4 wire carriage over existing HTTPS/WebDAV.
 *
 * The existing transport is used ONLY as an immutable byte delivery port.
 * A ".t4n" file is a signed network frame, never a new business archive.
 * No t2.exportPackage / t2.importCommit, T3 mutation, signer, Store, IAM or
 * session/packet scheduler is created here.
 */
export class T4CandidateFrameTransportError extends Error{
  constructor(code,details={}){
    super(code);this.name='T4CandidateFrameTransportError';
    this.code=code;this.details=Object.freeze({...details});
  }
}
const fail=(code,details)=>{throw new T4CandidateFrameTransportError(code,details)};
const ID=s=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(s);
const SHA=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const frozen=o=>Object.freeze(o);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

export function createT4CandidateFrameTransport({
  wireTransport,getMode,readOriginalHostContext,
  authorizeOriginalHostWire,originalHostNodeRef,originalHostScopeRef,
  verifyOriginalNodeSignature,authorizeOriginalNetwork,
  persistOriginalReplayDecision,
}={}){
  if(wireTransport?.wireKind!=='T4_NETWORK_CANDIDATE'||
    ![wireTransport.putSnapshot,wireTransport.getSnapshot,
      wireTransport.inspectOutcome].every(f=>typeof f==='function')||
    ![getMode,readOriginalHostContext,authorizeOriginalHostWire,
      verifyOriginalNodeSignature,authorizeOriginalNetwork,
      persistOriginalReplayDecision].every(f=>typeof f==='function')||
    !ID(originalHostNodeRef)||!ID(originalHostScopeRef))
    fail('WIRE_ORIGINAL_HOST_NETWORK_PORTS_REQUIRED');
  const mode=()=>{
    if(getMode()!=='T4_NETWORK')
      fail('WIRE_HOST_NETWORK_MODE_OFF');
  };
  async function hostSnapshot(){
    mode();
    const ctx=await readOriginalHostContext();
    if(!ctx||ctx.nodeRef!==originalHostNodeRef||
      ctx.scopeRef!==originalHostScopeRef||
      !ID(ctx.hostSessionRef)||!ID(ctx.originalOwnerRef))
      fail('WIRE_HOST_CONTEXT_INVALID');
    mode();
    return frozen({
      nodeRef:ctx.nodeRef,scopeRef:ctx.scopeRef,
      originalOwnerRef:ctx.originalOwnerRef,
      hostSessionRef:ctx.hostSessionRef,
    });
  }
  async function hostGuard(phase,baseContext,frame,sha256){
    mode();
    const observed=await hostSnapshot();
    if(!Object.keys(baseContext).every(k=>
      observed[k]===baseContext[k]))
      fail('WIRE_HOST_CONTEXT_CHANGED',{
        phase,networkWriteMayHaveCommitted:phase==='after-network',
        automaticRetryAllowed:false,
      });
    const operation='t4.network.frame.'+phase;
    const authorized=await authorizeOriginalHostWire(frozen({
      operation,originalHostNodeRef,originalHostScopeRef,
      originalOwnerRef:baseContext.originalOwnerRef,
      hostSessionRef:baseContext.hostSessionRef,
      sourceNodeRef:frame.sourceNodeRef,
      recipientNodeRef:frame.recipientNodeRef,
      messageType:frame.messageType,frameSha256:sha256,
      originalNetworkHostAuthorityRequired:true,
      networkMetadataCannotGrantOriginalSubjectRights:true,
    }));
    if(authorized!==true)
      fail('WIRE_HOST_NETWORK_AUTHORIZATION_DENIED',{phase});
    mode();
    const post=await hostSnapshot();
    if(!Object.keys(baseContext).every(k=>post[k]===baseContext[k]))
      fail('WIRE_HOST_CONTEXT_CHANGED',{
        phase,automaticRetryAllowed:false,
      });
  }
  async function publishSignedFrame({wireBytes}={}){
    if(!(wireBytes instanceof Uint8Array))
      fail('WIRE_SIGNED_BYTES_REQUIRED');
    // Decode before network access; freeze before any Host/network await.
    const snapshot=new Uint8Array(wireBytes);
    const frame=decodeT4CandidateFrame(snapshot);
    if(frame.sourceNodeRef!==originalHostNodeRef||
      frame.scopeRef!==originalHostScopeRef)
      fail('WIRE_LOCAL_SOURCE_SCOPE_MISMATCH');
    const sha256=hash(snapshot);
    const key=sha256+'.t4n';
    const ctx=await hostSnapshot();
    await hostGuard('publish',ctx,frame,sha256);
    let receipt;
    try{
      receipt=await wireTransport.putSnapshot({
        key,bytes:snapshot,expectedSha256:sha256,createOnly:true,
      });
    }catch(e){
      fail('WIRE_NETWORK_PUBLICATION_OUTCOME_UNKNOWN',{
        originalCode:e?.code??null,
        originalWriteMayHaveCommitted:true,
        automaticRetryAllowed:false,
      });
    }
    await hostGuard('after-network',ctx,frame,sha256);
    if(receipt?.sha256!==sha256||receipt.key!==key||
      !['PUBLISHED_AND_READ_BACK','ALREADY_PRESENT_VERIFIED']
        .includes(receipt.state))
      fail('WIRE_NETWORK_READBACK_NOT_PROVEN',{
        automaticRetryAllowed:false,
      });
    return frozen({
      schema:'IWXA_T4_CANDIDATE_FRAME_PUBLISHED_V1',
      key,sha256,messageType:frame.messageType,
      sourceNodeRef:frame.sourceNodeRef,
      recipientNodeRef:frame.recipientNodeRef,
      originalHostNetworkAuthorizationVerified:true,
      immutableTransportReadback:true,
      frameContainsNoOriginalSubjectWriteGrant:true,
      originalT3ExchangeCalled:false,
      originalBusinessApplied:false,
    });
  }
  async function inspectUnknownPublication({key,expectedSha256}={}){
    if(!SHA(expectedSha256)||key!==expectedSha256+'.t4n')
      fail('WIRE_NETWORK_DIGEST_KEY_REQUIRED');
    const ctx=await hostSnapshot();
    const inspection=await wireTransport.inspectOutcome({key,expectedSha256});
    const result=await wireTransport.getSnapshot({key,expectedSha256});
    const frame=decodeT4CandidateFrame(result.bytes);
    if(frame.sourceNodeRef!==originalHostNodeRef||
      frame.scopeRef!==originalHostScopeRef)
      fail('WIRE_LOCAL_SOURCE_SCOPE_MISMATCH');
    await hostGuard('inspect',ctx,frame,expectedSha256);
    if(inspection?.state!=='EXPECTED_BYTES_PRESENT'||
      inspection.sha256!==expectedSha256)
      fail('WIRE_NETWORK_READBACK_NOT_PROVEN');
    return frozen({
      schema:'IWXA_T4_CANDIDATE_FRAME_PRESENT_V1',
      key,sha256:expectedSha256,exactBytesPresent:true,
      historicalNetworkWriteProven:false,
      sourceBusinessMutationRetried:false,
      originalBusinessApplied:false,
      automaticNetworkRetryAllowed:false,
    });
  }
  async function readAndVerifySignedFrame({
    key,expectedSha256,requiredCryptoSuite,
    supportedCriticalExtensions=[],
  }={}){
    if(!SHA(expectedSha256)||key!==expectedSha256+'.t4n')
      fail('WIRE_NETWORK_DIGEST_KEY_REQUIRED');
    const ctx=await hostSnapshot();
    // Even a confirmed remote response is not an original subject grant.
    const downloaded=await wireTransport.getSnapshot({
      key,expectedSha256,
    });
    const frame=decodeT4CandidateFrame(downloaded.bytes);
    if(frame.recipientNodeRef!==originalHostNodeRef||
      frame.scopeRef!==originalHostScopeRef)
      fail('WIRE_WRONG_RECIPIENT_OR_SCOPE');
    await hostGuard('receive',ctx,frame,expectedSha256);
    const verdict=await verifyT4CandidateWireFrame({
      wireBytes:downloaded.bytes,
      recipientNodeRef:originalHostNodeRef,
      scopeRef:originalHostScopeRef,requiredCryptoSuite,
      supportedCriticalExtensions,verifyOriginalNodeSignature,
      authorizeOriginalNetwork,persistOriginalReplayDecision,
    });
    // A forged or revoked Host session must be rejected even after
    // signature and durable replay CAS succeed.
    await hostGuard('after-network',ctx,frame,expectedSha256);
    return frozen({
      schema:'IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1',
      key,sha256:expectedSha256,
      signedMessageType:verdict.messageType,
      originalSignatureVerified:verdict.originalSignatureVerified,
      originalAccessVerified:verdict.originalAccessVerified,
      originalReplayCheckpointRecorded:
        verdict.originalReplayCheckpointRecorded,
      exactPreviouslyVerifiedReplay:
        verdict.exactPreviouslyVerifiedReplay,
      networkBytesVerified:true,
      originalT3ExchangeCalled:false,
      originalBusinessApplied:false,
      originalSubjectMutationInvoked:false,
      originalResultNotInferredFromNetworkAck:true,
    });
  }
  return frozen({
    schema:'IWXA_T4_CANDIDATE_NETWORK_FRAME_PORT_V1',
    publishSignedFrame,inspectUnknownPublication,
    readAndVerifySignedFrame,
    originalT3ExchangeDependency:false,
    createsSubjectStore:false,createsSubjectIAM:false,
    productionEncryptedChannel:false,
  });
}
