import {createHash} from 'node:crypto';
import {isT4RecoverableWebDavError} from './webdav-package-transfer.mjs';
import {originalHostLifetimeMode,scopeOriginalHostPort} from './original-host-lifetime.mjs';
import {
  decodeT4CandidateFrame,verifyT4CandidateWireFrame,verifyT4CandidateHistoricalReceivedFrame,T4_ORIGINAL_SOURCE_SESSION_EXTENSION,
  T4_REPLACEMENT_SOURCE_SESSION_EXTENSION,
} from './standard-network-wire-candidate.mjs';
import {t4NativeSessionFrameIndexKey,t4NativeSourceHeadIndexKey,t4NativeReplacementHeadIndexKey,t4NativeFrameIndexKeys}
  from './original-network-frame-address.mjs';

/**
 * P2.0 experimental native T4 wire carriage over existing HTTPS/WebDAV.
 *
 * The existing transport is used ONLY as an immutable byte delivery port.
 * A ".t4n" file is a signed network frame, never a new business archive.
 * No t2.exportPackage / t2.importCommit, T3 mutation, signer, Store, IAM or
 * session/packet scheduler is created here.
 */
export class T4CandidateFrameTransportError extends Error{
  constructor(code,details={},cause){
    super(code,cause===undefined?undefined:{cause});this.name='T4CandidateFrameTransportError';
    this.code=code;this.details=Object.freeze({...details});
  }
}
const fail=(code,details,cause)=>{throw new T4CandidateFrameTransportError(code,details,cause)};
export const isT4RecoverableFrameTransportError=error=>isT4RecoverableWebDavError(error)||
  (error instanceof T4CandidateFrameTransportError&&error.code==='WIRE_NETWORK_PUBLICATION_OUTCOME_UNKNOWN'&&
    isT4RecoverableWebDavError(error.cause));
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
  persistOriginalReplayDecision,verifyOriginalHistoricalNodeSignature=null,readOriginalHistoricalReplayEvidence=null,
  readOriginalHistoricalAppliedAckSlot=null,
}={}){
  if(wireTransport?.wireKind!=='T4_NETWORK_CANDIDATE'||
    ![wireTransport.putSnapshot,wireTransport.getSnapshot,
      wireTransport.inspectOutcome].every(f=>typeof f==='function')||
    ![getMode,readOriginalHostContext,authorizeOriginalHostWire,
      verifyOriginalNodeSignature,authorizeOriginalNetwork,
      persistOriginalReplayDecision].every(f=>typeof f==='function')||
    !ID(originalHostNodeRef)||!ID(originalHostScopeRef))
    fail('WIRE_ORIGINAL_HOST_NETWORK_PORTS_REQUIRED');
  const historical=verifyOriginalHistoricalNodeSignature!==null||readOriginalHistoricalReplayEvidence!==null;
  if(historical&&![verifyOriginalHistoricalNodeSignature,readOriginalHistoricalReplayEvidence].every(f=>typeof f==='function'))
    fail('WIRE_ORIGINAL_HISTORICAL_PORTS_REQUIRED');
  const historicalAck=readOriginalHistoricalAppliedAckSlot!==null;
  if(historicalAck&&(!historical||typeof readOriginalHistoricalAppliedAckSlot!=='function'))
    fail('WIRE_ORIGINAL_HISTORICAL_PORTS_REQUIRED');
  const indexed=wireTransport.nativeFrameIndexVersion===1;
  if((wireTransport.nativeFrameIndexVersion!==undefined&&![0,1].includes(wireTransport.nativeFrameIndexVersion))||
    (indexed&&![wireTransport.getNativeFrameIndex,wireTransport.putNativeFrameIndex].every(f=>typeof f==='function')))
    fail('WIRE_NATIVE_INDEX_PROFILE_INVALID');
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
  function checkIndexRead(value,key){
    if(value?.schema!=='IWXA_T4_NATIVE_FRAME_INDEX_READ_V1'||value.key!==key||!SHA(value.frameSha256)||
      value.addressMetadataIsNotSignatureOrAuthority!==true||value.originalBusinessApplied!==false)
      fail('WIRE_NATIVE_INDEX_READ_INVALID');
    return value.frameSha256;
  }
  function requireWriteGuard(check){
    if(check!==null&&typeof check!=='function')fail('WIRE_ORIGINAL_CONTENT_WRITE_GUARD_INVALID');
  }
  async function beforeWrite(check){
    if(check!==null&&await check()!==true)fail('WIRE_ORIGINAL_CONTENT_WRITE_DENIED');
    mode();
  }
  async function ensureIndexes(ctx,frame,sha256,repair,check=null){
    if(!indexed)return;
    const missing=[];
    // Inspect every deterministic slot before changing any address. A
    // pre-existing competing HEADS must not create a second session pointer
    // as a side effect of attempting to repair the source announcement.
    for(const key of t4NativeFrameIndexKeys(frame)){
      await hostGuard('index-read',ctx,frame,sha256);
      const found=await wireTransport.getNativeFrameIndex({key});
      if(found===null)missing.push(key);
      else if(checkIndexRead(found,key)!==sha256)fail('WIRE_NATIVE_INDEX_SLOT_CONFLICT');
      await hostGuard('index-readback',ctx,frame,sha256);
    }
    if(missing.length&&!repair)fail('WIRE_NATIVE_INDEX_MISSING');
    for(const key of missing){
      await hostGuard('index-publish',ctx,frame,sha256);
      if(check!==null)await beforeWrite(check);
      const written=await wireTransport.putNativeFrameIndex({key,frameSha256:sha256});
      if(checkIndexRead(written,key)!==sha256)fail('WIRE_NATIVE_INDEX_SLOT_CONFLICT');
      await hostGuard('index-readback',ctx,frame,sha256);
    }
  }
  async function publishSignedFrame({wireBytes,beforeNetworkWrite=null}={}){
    requireWriteGuard(beforeNetworkWrite);
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
    if(beforeNetworkWrite!==null)await beforeWrite(beforeNetworkWrite);
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
      },e);
    }
    await hostGuard('after-network',ctx,frame,sha256);
    if(receipt?.sha256!==sha256||receipt.key!==key||
      !['PUBLISHED_AND_READ_BACK','ALREADY_PRESENT_VERIFIED']
        .includes(receipt.state))
      fail('WIRE_NETWORK_READBACK_NOT_PROVEN',{
        automaticRetryAllowed:false,
      });
    try{await ensureIndexes(ctx,frame,sha256,true,beforeNetworkWrite);}
    catch(error){fail('WIRE_NETWORK_PUBLICATION_OUTCOME_UNKNOWN',{
      originalCode:error?.code??null,originalWriteMayHaveCommitted:true,
      exactFrameReadbackVerified:true,automaticRetryAllowed:false},error);}
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
  async function inspectUnknownPublication({key,expectedSha256,repairMissingFrameIndex=false,beforeNetworkWrite=null}={}){
    requireWriteGuard(beforeNetworkWrite);
    if(typeof repairMissingFrameIndex!=='boolean'||!SHA(expectedSha256)||key!==expectedSha256+'.t4n')
      fail('WIRE_NETWORK_DIGEST_KEY_REQUIRED');
    const ctx=await hostSnapshot();
    const inspection=await wireTransport.inspectOutcome({key,expectedSha256});
    mode();
    const result=await wireTransport.getSnapshot({key,expectedSha256});
    mode();
    if(!(result?.bytes instanceof Uint8Array)||hash(result.bytes)!==expectedSha256)
      fail('WIRE_NETWORK_READBACK_NOT_PROVEN');
    const frame=decodeT4CandidateFrame(result.bytes);
    if(frame.sourceNodeRef!==originalHostNodeRef||
      frame.scopeRef!==originalHostScopeRef)
      fail('WIRE_LOCAL_SOURCE_SCOPE_MISMATCH');
    await hostGuard('inspect',ctx,frame,expectedSha256);
    if(inspection?.state!=='EXPECTED_BYTES_PRESENT'||
      inspection.sha256!==expectedSha256)
      fail('WIRE_NETWORK_READBACK_NOT_PROVEN');
    await ensureIndexes(ctx,frame,expectedSha256,repairMissingFrameIndex,beforeNetworkWrite);
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
  async function readOriginalHistoricalReceivedFrame({key,expectedSha256,requiredCryptoSuite,supportedCriticalExtensions=[]}={}){
    if(!historical||!SHA(expectedSha256)||key!==expectedSha256+'.t4n')fail('WIRE_ORIGINAL_HISTORICAL_PORTS_REQUIRED');
    const ctx=await hostSnapshot();
    const result=await wireTransport.getSnapshot({key,expectedSha256});
    mode();
    return verifyHistoricalBytes({ctx,key,expectedSha256,bytes:result?.bytes,requiredCryptoSuite,supportedCriticalExtensions});
  }
  async function verifyHistoricalBytes({ctx,key,expectedSha256,bytes,requiredCryptoSuite,supportedCriticalExtensions}){
    mode();
    if(!(bytes instanceof Uint8Array)||hash(bytes)!==expectedSha256)
      fail('WIRE_NETWORK_READBACK_NOT_PROVEN');
    const raw=new Uint8Array(bytes),frame=decodeT4CandidateFrame(raw);
    if(frame.recipientNodeRef!==originalHostNodeRef||frame.scopeRef!==originalHostScopeRef)
      fail('WIRE_WRONG_RECIPIENT_OR_SCOPE');
    await hostGuard('history-read',ctx,frame,expectedSha256);
    const live=fn=>async proof=>{mode();const value=await fn(proof);mode();return value;};
    const verdict=await verifyT4CandidateHistoricalReceivedFrame({wireBytes:raw,localNodeRef:originalHostNodeRef,
      scopeRef:originalHostScopeRef,requiredCryptoSuite,supportedCriticalExtensions,
      verifyOriginalHistoricalNodeSignature:live(verifyOriginalHistoricalNodeSignature),
      readOriginalHistoricalReplayEvidence:live(readOriginalHistoricalReplayEvidence)});
    await hostGuard('history-readback',ctx,frame,expectedSha256);
    if(verdict.wireSha256!==expectedSha256||verdict.key!==key)fail('WIRE_NETWORK_READBACK_NOT_PROVEN');
    return deepFreeze(structuredClone(verdict));
  }
  // A source looks up only its already accepted APPLIED_ACK slot. A
  // missing original checkpoint is NOT an invitation to accept old bytes.
  // Newly retained ACKs need no remote read. Pre-retention records can be
  // verified by exact phase key or one native immutable index lookup.
  async function readOriginalHistoricalAppliedAck({selector,requiredCryptoSuite,supportedCriticalExtensions=[],
    expectedSha256=null}={}){
    if(!historicalAck||!ID(requiredCryptoSuite)||!selector||
      Object.keys(selector).some(k=>!['sourceNodeRef','sessionRef','ownerEpoch'].includes(k))||
      !ID(selector.sourceNodeRef)||selector.sourceNodeRef===originalHostNodeRef||!ID(selector.sessionRef)||
      !Number.isSafeInteger(selector.ownerEpoch)||selector.ownerEpoch<1||
      !Array.isArray(supportedCriticalExtensions)||supportedCriticalExtensions.length>16||
      !supportedCriticalExtensions.every(ID)||new Set(supportedCriticalExtensions).size!==supportedCriticalExtensions.length||
      (expectedSha256!==null&&!SHA(expectedSha256)))
      fail('WIRE_HISTORICAL_ACK_SLOT_INVALID');
    const exactSelector=Object.freeze({sourceNodeRef:selector.sourceNodeRef,sessionRef:selector.sessionRef,
      ownerEpoch:selector.ownerEpoch,messageType:'APPLIED_ACK',sequence:2});
    const extensions=Object.freeze([...supportedCriticalExtensions]),ctx=await hostSnapshot();
    await hostGuard('history-slot-read',ctx,null,expectedSha256,exactSelector);
    const query=Object.freeze({sourceNodeRef:exactSelector.sourceNodeRef,recipientNodeRef:originalHostNodeRef,
      scopeRef:originalHostScopeRef,sessionRef:exactSelector.sessionRef,ownerEpoch:exactSelector.ownerEpoch,
      sequence:2,operation:'t4.network.receive.APPLIED_ACK',originalHistoricalEvidenceOnly:true});
    const slot=await readOriginalHistoricalAppliedAckSlot(query);
    await hostGuard('history-slot-readback',ctx,null,expectedSha256,exactSelector);
    if(slot===null)return null;
    const slotFields=['sourceNodeRef','recipientNodeRef','scopeRef','sessionRef','ownerEpoch','sequence','operation'];
    if(slot?.schema!=='IWXA_T4_ORIGINAL_HISTORICAL_REPLAY_EVIDENCE_V1'||
      !slotFields.every(k=>slot[k]===query[k])||!ID(slot.checkpointRef)||!ID(slot.originalReplayEventId)||
      !ID(slot.signerRef)||!ID(slot.permissionRef)||!/^sha256:[a-f0-9]{64}$/.test(slot.frameDigest??'')||
      slot.originalReplayCheckpointRecorded!==true||slot.originalHistoricalEvidenceOnly!==true||
      slot.liveNetworkAuthorityGranted!==false||slot.originalBusinessApplied!==false)
      fail('WIRE_HISTORICAL_ACK_SLOT_NOT_PROVEN');
    let sha256,bytes;
    if(slot.retainedAppliedAckBase64!==undefined||slot.wireSha256!==undefined){
      if(!SHA(slot.wireSha256)||typeof slot.retainedAppliedAckBase64!=='string'||
        slot.retainedAppliedAckBase64.length>43692)
        fail('WIRE_HISTORICAL_ACK_RETAINED_BYTES_INVALID');
      sha256=slot.wireSha256;bytes=Buffer.from(slot.retainedAppliedAckBase64,'base64');
      if(bytes.toString('base64')!==slot.retainedAppliedAckBase64||hash(bytes)!==sha256)
        fail('WIRE_HISTORICAL_ACK_RETAINED_BYTES_INVALID');
    }else{
      // Legacy original checkpoints did not retain wire bytes. No
      // migration write, collection listing or live replay CAS is allowed.
      sha256=expectedSha256;
      if(sha256===null){
        if(!indexed)fail('WIRE_HISTORICAL_ACK_BYTES_UNAVAILABLE');
        const key=t4NativeSessionFrameIndexKey({...exactSelector,recipientNodeRef:originalHostNodeRef,scopeRef:originalHostScopeRef});
        await hostGuard('index-discover',ctx,null,null,exactSelector);
        const pointer=await wireTransport.getNativeFrameIndex({key});
        await hostGuard('index-discover-readback',ctx,null,null,exactSelector);
        if(pointer===null)fail('WIRE_HISTORICAL_ACK_BYTES_UNAVAILABLE');
        sha256=checkIndexRead(pointer,key);
      }
      await hostGuard('history-legacy-read',ctx,null,sha256,exactSelector);
      const downloaded=await wireTransport.getSnapshot({key:sha256+'.t4n',expectedSha256:sha256});
      bytes=downloaded?.bytes;mode();
    }
    if(expectedSha256!==null&&expectedSha256!==sha256)fail('WIRE_HISTORICAL_ACK_SLOT_CONFLICT');
    const verdict=await verifyHistoricalBytes({ctx,key:sha256+'.t4n',expectedSha256:sha256,bytes,
      requiredCryptoSuite,supportedCriticalExtensions:extensions});
    if(!slotFields.every(k=>verdict[k]===query[k])||
      verdict.frameDigest!==slot.frameDigest||verdict.signerRef!==slot.signerRef||
      verdict.permissionRef!==slot.permissionRef||verdict.originalReplayCheckpointRef!==slot.checkpointRef||
      verdict.originalReplayEventId!==slot.originalReplayEventId)
      fail('WIRE_HISTORICAL_ACK_SLOT_CONFLICT');
    await hostGuard('history-slot-verified',ctx,null,sha256,exactSelector);
    return verdict;
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
        'CHUNK_REQUEST','RECEIVED_ACK','VERIFIED_ACK','RESUME','ATTEMPT_RETIRE_REQUEST','ATTEMPT_RETIRED_ACK','SESSION_CONTENT'].includes(selector.messageType)||
      (selector.messageType==='SESSION_CONTENT'&&(!ID(selector.sessionRef)||selector.sequence!==undefined))||
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
        (selected.messageType==='SESSION_CONTENT'? !['HEADS','CHANGE_REF','CHUNK'].includes(f.messageType):
          f.messageType!==selected.messageType)||(selected.sessionRef!==undefined&&f.sessionRef!==selected.sessionRef)||
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
  // One bounded, stable address sweep for an exact slot or the source's
  // complete session content. SESSION_CONTENT is a discovery selector,
  // never a new wire message type or a grant to read original subjects.
  async function sweep({selector,requiredCryptoSuite,supportedCriticalExtensions=[]},max,duplicateCode,
    slotIdentity=r=>r.verifiedSequence){
    const selected=frozen({...selector}),extensions=Object.freeze([...supportedCriticalExtensions]);
    const initial=await hostSnapshot();
    let continuation=null,pages=0,candidatesExamined=0,listingDigest=null;
    const receipts=[],sequences=new Set();
    const finish=state=>frozen({state,receipts:Object.freeze(state==='RESTART_SCAN'?[]:
      receipts.sort((a,b)=>a.verifiedSequence-b.verifiedSequence)),
      pages,candidatesExamined,listingDigest,originalBusinessApplied:false,
      sourceCursorAdvanced:false,originalTransportScanOnly:true});
    do{
      await hostGuard('discover-slot',initial,null,null,selected);
      const page=await discoverAndVerifySignedFrames({selector:selected,continuation,
        requiredCryptoSuite,supportedCriticalExtensions:extensions,maxCandidates:128});
      await hostGuard('discover-slot-readback',initial,null,null,selected);
      pages++;candidatesExamined+=page.candidatesExamined;listingDigest=page.listingDigest;
      if(page.state==='RESTART_SCAN')return finish('RESTART_SCAN');
      if(pages>64||candidatesExamined>8192)fail('WIRE_DISCOVERY_SWEEP_LIMIT');
      for(const found of page.receipts){
        const slot=slotIdentity(found);
        if(sequences.has(slot)||receipts.length>=max)fail(duplicateCode);
        sequences.add(slot);receipts.push(found);
      }
      continuation=page.continuation;
    }while(continuation!==null);
    return finish(receipts.length?'FOUND':'NOT_FOUND');
  }
  async function indexedRead({selector,requiredCryptoSuite,supportedCriticalExtensions=[],head=false,replacementHead=false},ctx){
    if(!selector||!ID(selector.sourceNodeRef)||selector.sourceNodeRef===originalHostNodeRef||
      !Number.isSafeInteger(selector.ownerEpoch)||selector.ownerEpoch<1||!ID(requiredCryptoSuite)||
      !Array.isArray(supportedCriticalExtensions)||supportedCriticalExtensions.length>16||
      !supportedCriticalExtensions.every(ID)||new Set(supportedCriticalExtensions).size!==supportedCriticalExtensions.length)
      fail('WIRE_DISCOVERY_SELECTOR_INVALID');
    const peer={...selector,recipientNodeRef:originalHostNodeRef,scopeRef:originalHostScopeRef};
    const key=replacementHead?t4NativeReplacementHeadIndexKey(peer):head?t4NativeSourceHeadIndexKey(peer):t4NativeSessionFrameIndexKey(peer);
    await hostGuard('index-discover',ctx,null,null,selector);
    const pointer=await wireTransport.getNativeFrameIndex({key});
    await hostGuard('index-discover-readback',ctx,null,null,selector);
    if(pointer===null)return null;
    const sha256=checkIndexRead(pointer,key),frameKey=sha256+'.t4n';
    const downloaded=await wireTransport.getSnapshot({key:frameKey,expectedSha256:sha256});
    mode();
    if(!(downloaded?.bytes instanceof Uint8Array)||hash(downloaded.bytes)!==sha256)
      fail('WIRE_NATIVE_INDEX_TARGET_MISMATCH');
    const bytes=new Uint8Array(downloaded.bytes),frame=decodeT4CandidateFrame(bytes);
    if(frame.sourceNodeRef!==selector.sourceNodeRef||frame.recipientNodeRef!==originalHostNodeRef||
      frame.scopeRef!==originalHostScopeRef||frame.ownerEpoch!==selector.ownerEpoch||
      (replacementHead?(frame.messageType!=='HEADS'||frame.sequence!==1||
        !frame.criticalExtensions.includes(T4_REPLACEMENT_SOURCE_SESSION_EXTENSION)||
        frame.body.replacement?.previousSessionRef!==selector.previousSessionRef||
        frame.sessionRef!==selector.sessionRef||frame.body.replacement?.changeId!==selector.changeId):
        head?(frame.messageType!=='HEADS'||frame.sequence!==1||
        !frame.criticalExtensions.includes(T4_ORIGINAL_SOURCE_SESSION_EXTENSION)||
        frame.body.familyRef!==selector.familyRef||frame.body.sourceSession?.predecessorEventCount!==selector.predecessorEventCount):
        (frame.sessionRef!==selector.sessionRef||frame.sequence!==selector.sequence||frame.messageType!==selector.messageType))||
      !t4NativeFrameIndexKeys(frame).includes(key))fail('WIRE_NATIVE_INDEX_TARGET_MISMATCH');
    return verifyDownloaded({ctx,key:frameKey,expectedSha256:sha256,downloaded:{bytes},
      requiredCryptoSuite,supportedCriticalExtensions});
  }
  const indexedResult=(receipts,lookups)=>frozen({state:receipts.length?'FOUND':'NOT_FOUND',
    receipts:frozen(receipts),pages:0,candidatesExamined:lookups,listingDigest:null,
    indexedLookup:true,indexIsNotHistoryCompletenessProof:true,
    originalBusinessApplied:false,sourceCursorAdvanced:false,originalTransportScanOnly:true});
  async function discoverUniqueSignedFrame({selector,requiredCryptoSuite,
    supportedCriticalExtensions=[]}={}){
    if(!ID(selector?.sessionRef)||!Number.isSafeInteger(selector.sequence)||
      selector.sequence<1)fail('WIRE_DISCOVERY_EXACT_SLOT_REQUIRED');
    if(indexed){
      if(Object.keys(selector).some(k=>!['sourceNodeRef','ownerEpoch','sessionRef','messageType','sequence'].includes(k))||
        !['HEADS','DIFF_REQUEST','CHANGE_REF','CHUNK','APPLIED_ACK','HELLO','CAPABILITIES','CHUNK_REQUEST','RECEIVED_ACK','VERIFIED_ACK','RESUME','ATTEMPT_RETIRE_REQUEST','ATTEMPT_RETIRED_ACK'].includes(selector.messageType))
        fail('WIRE_DISCOVERY_SELECTOR_INVALID');
      const input=Object.freeze({...selector});
      const extensions=Array.isArray(supportedCriticalExtensions)?Object.freeze([...supportedCriticalExtensions]):supportedCriticalExtensions;
      const receipt=await indexedRead({selector:input,requiredCryptoSuite,supportedCriticalExtensions:extensions},await hostSnapshot());
      const {receipts,listingDigest,...result}=indexedResult(receipt?[receipt]:[],1);
      return frozen({schema:'IWXA_T4_FRAME_DISCOVERY_EXACT_SLOT_V1',...result,receipt});
    }
    const {receipts,listingDigest,...r}=await sweep({selector,requiredCryptoSuite,
      supportedCriticalExtensions},1,'WIRE_DISCOVERY_EXACT_SLOT_NOT_UNIQUE');
    return frozen({schema:'IWXA_T4_FRAME_DISCOVERY_EXACT_SLOT_V1',...r,receipt:receipts[0]??null});
  }
  async function discoverSessionContent({selector,requiredCryptoSuite,
    supportedCriticalExtensions=[]}={}){
    if(!selector||Object.keys(selector).some(k=>!['sourceNodeRef','ownerEpoch','sessionRef'].includes(k))||
      !ID(selector.sessionRef))fail('WIRE_DISCOVERY_SESSION_REQUIRED');
    if(indexed){
      const input=Object.freeze({...selector});
      const extensions=Array.isArray(supportedCriticalExtensions)?Object.freeze([...supportedCriticalExtensions]):supportedCriticalExtensions;
      const ctx=await hostSnapshot(),receipts=[];let lookups=0;
      const get=async(messageType,sequence)=>{lookups++;
        const frame=await indexedRead({selector:{...input,messageType,sequence},requiredCryptoSuite,supportedCriticalExtensions:extensions},ctx);
        if(frame)receipts.push(frame);return frame;};
      const head=await get('HEADS',1);
      if(head&&await get('CHANGE_REF',2)){
        const first=await get('CHUNK',3);
        if(first){const count=first.verifiedBody.chunkCount;
          if(!Number.isSafeInteger(count)||count<1||count>64||first.verifiedBody.chunkIndex!==0)
            fail('WIRE_NATIVE_INDEX_TARGET_MISMATCH');
          for(let n=1;n<count;n++)await get('CHUNK',n+3);
        }
      }
      return frozen({schema:'IWXA_T4_FRAME_DISCOVERY_SESSION_CONTENT_V1',...indexedResult(receipts,lookups),
        createsStore:false,createsScheduler:false});
    }
    const r=await sweep({selector:{...selector,messageType:'SESSION_CONTENT'},requiredCryptoSuite,
      supportedCriticalExtensions},66,'WIRE_DISCOVERY_SESSION_SLOT_CONFLICT');
    return frozen({schema:'IWXA_T4_FRAME_DISCOVERY_SESSION_CONTENT_V1',...r,
      createsStore:false,createsScheduler:false});
  }
  async function discoverSourceSessionHeads({selector,requiredCryptoSuite}={}){
    if(indexed){
      if(!selector||Object.keys(selector).some(k=>!['sourceNodeRef','ownerEpoch','familyRef','predecessorEventCount'].includes(k)))
        fail('WIRE_DISCOVERY_SOURCE_ANNOUNCEMENT_SELECTOR_INVALID');
      const found=await indexedRead({selector:{...selector,messageType:'HEADS'},requiredCryptoSuite,head:true,
        supportedCriticalExtensions:[T4_ORIGINAL_SOURCE_SESSION_EXTENSION]},await hostSnapshot());
      return frozen({schema:'IWXA_T4_FRAME_DISCOVERY_SOURCE_HEADS_V1',...indexedResult(found?[found]:[],1),
        createsStore:false,createsScheduler:false});
    }
    if(!selector||Object.keys(selector).some(k=>!['sourceNodeRef','ownerEpoch'].includes(k)))
      fail('WIRE_DISCOVERY_SOURCE_ANNOUNCEMENT_SELECTOR_INVALID');
    const r=await sweep({selector:{...selector,messageType:'HEADS',sequence:1},requiredCryptoSuite,
      supportedCriticalExtensions:[T4_ORIGINAL_SOURCE_SESSION_EXTENSION]},8192,
      'WIRE_DISCOVERY_SOURCE_ANNOUNCEMENT_SLOT_CONFLICT',f=>f.verifiedSessionRef);
    return frozen({schema:'IWXA_T4_FRAME_DISCOVERY_SOURCE_HEADS_V1',...r,
      createsStore:false,createsScheduler:false});
  }
  // Exact successor discovery is available only on the indexed profile.
  // It performs one immutable lookup and normal live signature/Access/
  // replay verification. No scan and no permission to apply.
  async function discoverReplacementSourceHead({selector,requiredCryptoSuite}={}){
    if(!indexed||!selector||Object.keys(selector).sort().join(',')!==
      'changeId,ownerEpoch,previousSessionRef,sessionRef,sourceNodeRef'||
      ![selector.previousSessionRef,selector.sessionRef,selector.changeId].every(ID)||
      selector.previousSessionRef===selector.sessionRef)
      fail('WIRE_DISCOVERY_REPLACEMENT_HEAD_SELECTOR_INVALID');
    const selected=Object.freeze({...selector,messageType:'HEADS',sequence:1});
    const found=await indexedRead({selector:selected,requiredCryptoSuite,replacementHead:true,
      supportedCriticalExtensions:[T4_REPLACEMENT_SOURCE_SESSION_EXTENSION]},await hostSnapshot());
    return frozen({schema:'IWXA_T4_FRAME_DISCOVERY_REPLACEMENT_HEAD_V1',...indexedResult(found?[found]:[],1),
      createsStore:false,createsScheduler:false,originalNewAttemptAdmissionStillRequired:true});
  }
  return frozen({
    schema:'IWXA_T4_CANDIDATE_NETWORK_FRAME_PORT_V1',nativeFrameIndexVersion:indexed?1:0,
    publishSignedFrame,inspectUnknownPublication,
    ...(historical?{readOriginalHistoricalReceivedFrame}:{}),
    ...(historicalAck?{readOriginalHistoricalAppliedAck}:{}),
    readAndVerifySignedFrame,discoverAndVerifySignedFrames,discoverUniqueSignedFrame,discoverSessionContent,
    discoverSourceSessionHeads,discoverReplacementSourceHead,
    forOriginalHostLifetime:isHostActive=>createT4CandidateFrameTransport({
      wireTransport:scopeOriginalHostPort(wireTransport,isHostActive,['wireKind','nativeFrameIndexVersion'],
        'WIRE_ORIGINAL_TRANSPORT_LIFETIME_REQUIRED'),
      getMode:originalHostLifetimeMode(getMode,isHostActive),
      readOriginalHostContext,authorizeOriginalHostWire,
      originalHostNodeRef,originalHostScopeRef,verifyOriginalNodeSignature,
      authorizeOriginalNetwork,persistOriginalReplayDecision,
      verifyOriginalHistoricalNodeSignature,readOriginalHistoricalReplayEvidence,readOriginalHistoricalAppliedAckSlot,
    }),
    originalT3ExchangeDependency:false,
    createsSubjectStore:false,createsSubjectIAM:false,
    productionEncryptedChannel:false,
  });
}
