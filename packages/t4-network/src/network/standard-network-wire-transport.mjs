import {createHash} from 'node:crypto';
import {originalHostLifetimeMode,scopeOriginalHostPort} from './original-host-lifetime.mjs';
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
const deepFreeze=o=>{
  if(o&&typeof o==='object'){
    for(const val of Object.values(o))deepFreeze(val);
    Object.freeze(o);
  }
  return o;
};
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
  async function hostGuard(phase,baseContext,frame,sha256,selector=null){
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
      sourceNodeRef:frame?.sourceNodeRef??selector?.sourceNodeRef,
      recipientNodeRef:frame?.recipientNodeRef??originalHostNodeRef,
      messageType:frame?.messageType??selector?.messageType,frameSha256:sha256,
      ...(selector?{discoverySelector:selector,collectionReadOnly:true}:{}),
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
    mode();
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
    mode();
    const result=await wireTransport.getSnapshot({key,expectedSha256});
    mode();
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
    const downloaded=await wireTransport.getSnapshot({key,expectedSha256});
    mode();
    return verifyDownloaded({ctx,key,expectedSha256,downloaded,requiredCryptoSuite,supportedCriticalExtensions});
  }
  async function verifyDownloaded({ctx,key,expectedSha256,downloaded,requiredCryptoSuite,supportedCriticalExtensions}){
    mode();
    if(!(downloaded?.bytes instanceof Uint8Array)||hash(downloaded.bytes)!==expectedSha256)
      fail('WIRE_NETWORK_READBACK_NOT_PROVEN');
    const frame=decodeT4CandidateFrame(downloaded.bytes);
    if(frame.recipientNodeRef!==originalHostNodeRef||
      frame.scopeRef!==originalHostScopeRef)
      fail('WIRE_WRONG_RECIPIENT_OR_SCOPE');
    await hostGuard('receive',ctx,frame,expectedSha256);
    // Every independently awaited authority callback is tied to the same
    // original Host lifetime, including the durable replay CAS.
    const live=fn=>async proof=>{
      mode();
      const result=await fn(proof);
      mode();return result;
    };
    const verdict=await verifyT4CandidateWireFrame({
      wireBytes:downloaded.bytes,
      recipientNodeRef:originalHostNodeRef,
      scopeRef:originalHostScopeRef,requiredCryptoSuite,
      supportedCriticalExtensions,
      verifyOriginalNodeSignature:live(verifyOriginalNodeSignature),
      authorizeOriginalNetwork:live(authorizeOriginalNetwork),
      persistOriginalReplayDecision:live(persistOriginalReplayDecision),
    });
    // A forged or revoked Host session must be rejected even after
    // signature and durable replay CAS succeed.
    await hostGuard('after-network',ctx,frame,expectedSha256);
    return frozen({
      schema:'IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1',
      key,sha256:expectedSha256,
      signedMessageType:verdict.messageType,
      verifiedMessageId:frame.messageId,
      verifiedSourceNodeRef:frame.sourceNodeRef,
      verifiedRecipientNodeRef:frame.recipientNodeRef,
      verifiedScopeRef:frame.scopeRef,
      verifiedSessionRef:frame.sessionRef,
      verifiedSequence:frame.sequence,verifiedOwnerEpoch:frame.ownerEpoch,
      verifiedCryptoSuite:frame.cryptoSuite,
      verifiedSignerRef:frame.signerRef,
      verifiedCriticalExtensions:Object.freeze([...frame.criticalExtensions]),
      verifiedBody:deepFreeze(structuredClone(frame.body)),
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

  /**
   * One bounded discovery page, driven by the existing Host task. The
   * continuation is an advisory transport enumeration, NOT a source cursor.
   * A changed listing restarts the sweep, so a later low-hash frame is not
   * silently skipped. Only exact peer/session/epoch/type matches reach
   * signature, original Access and replay CAS. No application occurs here.
   */
  async function discoverAndVerifySignedFrames({selector,continuation=null,
    maxCandidates=64,requiredCryptoSuite,supportedCriticalExtensions=[]}={}){
    if(typeof wireTransport.listNativeFrameAddresses!=='function')
      fail('WIRE_FRAME_DISCOVERY_PORT_REQUIRED');
    if(!selector||typeof selector!=='object'||Array.isArray(selector)||
      Object.keys(selector).some(k=>!['sourceNodeRef','ownerEpoch','sessionRef','messageType','sequence'].includes(k))||
      !ID(selector.sourceNodeRef)||selector.sourceNodeRef===originalHostNodeRef||
      !Number.isSafeInteger(selector.ownerEpoch)||selector.ownerEpoch<1||
      !['HEADS','DIFF_REQUEST','CHANGE_REF','CHUNK','APPLIED_ACK','HELLO','CAPABILITIES',
        'CHUNK_REQUEST','RECEIVED_ACK','VERIFIED_ACK','RESUME'].includes(selector.messageType)||
      (selector.sessionRef!==undefined&&!ID(selector.sessionRef))||
      (selector.sessionRef===undefined&&selector.messageType!=='HEADS')||
      (selector.sequence!==undefined&&(!Number.isSafeInteger(selector.sequence)||selector.sequence<1))||
      !Number.isSafeInteger(maxCandidates)||maxCandidates<1||maxCandidates>128||
      !ID(requiredCryptoSuite)||!Array.isArray(supportedCriticalExtensions)||
      supportedCriticalExtensions.length>16||!supportedCriticalExtensions.every(ID)||
      new Set(supportedCriticalExtensions).size!==supportedCriticalExtensions.length)
      fail('WIRE_DISCOVERY_SELECTOR_INVALID');
    const selected=frozen({...selector}),extensions=Object.freeze([...supportedCriticalExtensions]);
    const selectorDigest=hash(Buffer.from(JSON.stringify({
      originalHostNodeRef,originalHostScopeRef,
      sourceNodeRef:selected.sourceNodeRef,ownerEpoch:selected.ownerEpoch,
      sessionRef:selected.sessionRef??null,messageType:selected.messageType,
      sequence:selected.sequence??null,requiredCryptoSuite,extensions
    }),'utf8'));
    if(continuation!==null&&(!SHA(continuation?.listingDigest)||!SHA(continuation?.selectorDigest)||
      continuation.selectorDigest!==selectorDigest||
      typeof continuation.afterKey!=='string'||!(/^[a-f0-9]{64}\.t4n$/).test(continuation.afterKey)))
      fail('WIRE_DISCOVERY_CONTINUATION_INVALID');
    const after=continuation===null?null:frozen({...continuation});
    const ctx=await hostSnapshot();
    await hostGuard('discover',ctx,null,null,selected);
    const list=await wireTransport.listNativeFrameAddresses();
    mode();
    await hostGuard('discover-readback',ctx,null,null,selected);
    if(list?.schema!=='IWXA_T4_NATIVE_FRAME_ADDRESS_LIST_V1'||list.collectionEnumerated!==true||
      list.addressMetadataIsNotSignatureOrAuthority!==true||list.originalBusinessApplied!==false||
      !SHA(list.listingDigest)||!Array.isArray(list.addresses)||list.addresses.length>8192||
      list.addresses.some((a,i)=>!SHA(a?.sha256)||a.key!==a.sha256+'.t4n'||
        (i>0&&a.key<=list.addresses[i-1].key)))
      fail('WIRE_DISCOVERY_ADDRESS_LIST_INVALID');
    const addresses=list.addresses.map(a=>frozen({key:a.key,sha256:a.sha256}));
    const listingDigest=list.listingDigest;
    const actual=createHash('sha256').update('IWXA-T4-FRAME-ADDRESS-LIST-V1\0')
      .update(JSON.stringify(addresses.map(a=>a.key))).digest('hex');
    if(actual!==listingDigest)fail('WIRE_DISCOVERY_ADDRESS_LIST_INVALID');
    if(after&&after.listingDigest!==listingDigest)
      return frozen({schema:'IWXA_T4_FRAME_DISCOVERY_PAGE_V1',state:'RESTART_SCAN',
        listingDigest,candidatesExamined:0,receipts:Object.freeze([]),continuation:null,
        listingExhausted:false,originalBusinessApplied:false,sourceCursorAdvanced:false,
        createsStore:false,createsScheduler:false});
    const start=after?addresses.findIndex(a=>a.key===after.afterKey)+1:0;
    if(after&&start===0)fail('WIRE_DISCOVERY_CONTINUATION_INVALID');
    const page=addresses.slice(start,start+maxCandidates),receipts=[];
    let ignoredCount=0;
    for(const address of page){
      await hostGuard('discover-candidate',ctx,null,address.sha256,selected);
      const downloaded=await wireTransport.getSnapshot({key:address.key,expectedSha256:address.sha256});
      mode();
      if(!(downloaded?.bytes instanceof Uint8Array)||hash(downloaded.bytes)!==address.sha256)
        fail('WIRE_DISCOVERY_CANDIDATE_DIGEST_MISMATCH');
      // Copy before any further await. Never persist replay on an unrelated
      // frame just because its filename occurs in a readable collection.
      const bytes=new Uint8Array(downloaded.bytes);
      const f=decodeT4CandidateFrame(bytes);
      if(f.sourceNodeRef!==selected.sourceNodeRef||f.recipientNodeRef!==originalHostNodeRef||
        f.scopeRef!==originalHostScopeRef||f.ownerEpoch!==selected.ownerEpoch||
        f.messageType!==selected.messageType||(selected.sessionRef!==undefined&&f.sessionRef!==selected.sessionRef)||
        (selected.sequence!==undefined&&f.sequence!==selected.sequence)){
        ignoredCount++;continue;
      }
      const result=await verifyDownloaded({ctx,key:address.key,expectedSha256:address.sha256,
        downloaded:{bytes},requiredCryptoSuite,supportedCriticalExtensions:extensions});
      receipts.push(result);
    }
    await hostGuard('discover-complete',ctx,null,null,selected);
    const exhausted=start+page.length===addresses.length;
    return frozen({schema:'IWXA_T4_FRAME_DISCOVERY_PAGE_V1',state:'VERIFIED_PAGE',
      listingDigest,candidatesExamined:page.length,ignoredCount,receipts:Object.freeze(receipts),
      listingExhausted:exhausted,continuation:exhausted?null:frozen({
        listingDigest,selectorDigest,afterKey:page.at(-1).key}),
      // A completed enumeration is a point-in-time observation, never a
      // proof that a peer has no future changes or that its result exists.
      mustRescanOnNextOriginalHostWake:true,originalBusinessApplied:false,
      sourceCursorAdvanced:false,createsStore:false,createsScheduler:false});
  }
  // Resolve one exact protocol slot without a caller supplying its address.
  // Scan the entire bounded listing; never select a first/last hash as a
  // winner. A changed enumeration is not a proof of absence or uniqueness.
  async function discoverUniqueSignedFrame({selector,requiredCryptoSuite,
    supportedCriticalExtensions=[]}={}){
    if(!ID(selector?.sessionRef)||!Number.isSafeInteger(selector.sequence)||
      selector.sequence<1)fail('WIRE_DISCOVERY_EXACT_SLOT_REQUIRED');
    const selected=frozen({...selector}),extensions=Object.freeze([...supportedCriticalExtensions]);
    const initial=await hostSnapshot();
    let continuation=null,receipt=null,pages=0,candidatesExamined=0;
    const finish=(state,value)=>frozen({
      schema:'IWXA_T4_FRAME_DISCOVERY_EXACT_SLOT_V1',state,receipt:value,
      pages,candidatesExamined,originalBusinessApplied:false,sourceCursorAdvanced:false,
      originalTransportScanOnly:true,
    });
    do{
      await hostGuard('discover-slot',initial,null,null,selected);
      const page=await discoverAndVerifySignedFrames({selector:selected,continuation,
        requiredCryptoSuite,supportedCriticalExtensions:extensions,maxCandidates:128});
      await hostGuard('discover-slot-readback',initial,null,null,selected);
      pages++;candidatesExamined+=page.candidatesExamined;
      if(page.state==='RESTART_SCAN')return finish('RESTART_SCAN',null);
      if(pages>64||candidatesExamined>8192)fail('WIRE_DISCOVERY_SWEEP_LIMIT');
      for(const found of page.receipts){
        if(receipt!==null)fail('WIRE_DISCOVERY_EXACT_SLOT_NOT_UNIQUE');
        receipt=found;
      }
      continuation=page.continuation;
    }while(continuation!==null);
    return finish(receipt?'FOUND':'NOT_FOUND',receipt);
  }
  return frozen({
    schema:'IWXA_T4_CANDIDATE_NETWORK_FRAME_PORT_V1',
    publishSignedFrame,inspectUnknownPublication,
    readAndVerifySignedFrame,discoverAndVerifySignedFrames,discoverUniqueSignedFrame,
    forOriginalHostLifetime:isHostActive=>createT4CandidateFrameTransport({
      wireTransport:scopeOriginalHostPort(wireTransport,isHostActive,['wireKind'],
        'WIRE_ORIGINAL_TRANSPORT_LIFETIME_REQUIRED'),
      getMode:originalHostLifetimeMode(getMode,isHostActive),
      readOriginalHostContext,authorizeOriginalHostWire,
      originalHostNodeRef,originalHostScopeRef,verifyOriginalNodeSignature,
      authorizeOriginalNetwork,persistOriginalReplayDecision,
    }),
    originalT3ExchangeDependency:false,
    createsSubjectStore:false,createsSubjectIAM:false,
    productionEncryptedChannel:false,
  });
}
