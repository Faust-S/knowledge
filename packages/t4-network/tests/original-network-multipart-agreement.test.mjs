import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign,verify,createCipheriv,createDecipheriv} from 'node:crypto';
import {createT4OriginalHostDispatchTaskBinding} from '../src/network/original-host-dispatch-task-binding.mjs';
import {createT4OriginalHostRecipientDispatcher} from '../src/network/original-host-recipient-dispatcher.mjs';
import {createT4OriginalNetworkHostCursorPort,createT4OriginalNetworkRecipientCursorPort} from '../src/network/original-network-host-cursor.mjs';
import {createT4OriginalRecipientAppliedVerifier} from '../src/network/original-network-subject-apply.mjs';
import {createT4OriginalNetworkSessionPhasePort,requireT4OriginalRetiredAttemptStatus} from '../src/network/original-network-session-phases.mjs';
import {prepareT4OriginalSupersessionControl} from '../src/network/original-network-session-supersession.mjs';
import {readT4OriginalEventWindow} from '../src/network/original-event-window.mjs';
import {verifyT4OriginalAssetDelta} from '../src/network/original-asset-delta.mjs';
import {verifyT4OriginalSourceHeadCausality} from '../src/network/original-network-source-head-proof.mjs';
import {discoverT4OriginalNetworkSessionContent,openT4OriginalNetworkSubjectChange,
  applyT4OriginalNetworkSubjectChange,inspectT4OriginalNetworkRecipientResult,createT4OriginalNetworkAppliedAckBody}
  from '../src/network/original-network-subject-apply.mjs';
import {createT4CandidateUnsignedFrame,signT4CandidateFrame,decodeT4CandidateFrame,
  T4_ORIGINAL_SOURCE_SESSION_EXTENSION as HEAD_EXT,T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION as AGREEMENT_EXT,
  T4_MULTIPART_OPAQUE_EXTENSION as EXT} from '../src/network/standard-network-wire-candidate.mjs';
import {createT4NativeMultipartOffer,createT4NativeMultipartSelection,prepareT4CandidateMultipartOpaqueChunks,
  t4CandidateMultipartChunkSequence,assembleT4CandidateMultipartOpaqueChunks}
  from '../src/network/standard-network-multipart-opaque-chunks.mjs';
import {createT4OriginalSourceSessionHead,readT4OriginalSourceSessionHead,createT4OriginalNetworkPublicationPort,
  createT4OriginalPublicationIndexMigrationStepper}
  from '../src/network/original-network-publication.mjs';
import {readT4OriginalNativeMultipartAgreement as agreement,validateT4OriginalNativeMultipartAgreement as validate,
  createT4OriginalNativeMultipartAgreementReader,createT4OriginalNativeMultipartAgreementBinding,T4OriginalMultipartPeerAgreementUnavailable}
  from '../src/network/original-network-multipart-agreement.mjs';
import {T4_LEGACY_TEST_TECHNICAL_SCHEMA_ID} from '../src/network/original-network-technical-schema.mjs';
import {createT4CandidateFrameTransport} from '../src/network/standard-network-wire-transport.mjs';
import {createT4OriginalNetworkReplayPort} from '../src/network/original-network-replay-checkpoint.mjs';
import {T4TransferError} from '../src/network/webdav-package-transfer.mjs';
import {isT4RecoverablePublicationWakeError} from '../src/network/original-network-publication.mjs';
import {t4NativeFrameIndexKeys} from '../src/network/original-network-frame-address.mjs';
import {discoverT4OriginalSourceSessionAnnouncement} from '../src/network/original-network-source-announcement.mjs';
const sorted=x=>Array.isArray(x)?x.map(sorted):x&&typeof x==='object'?
  Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
const hex=x=>createHash('sha256').update(x).digest('hex'),d=x=>'sha256:'+hex(x);
const identityDigest=(name,x)=>hex('IWXA-T4-ORIGINAL-'+name+'-V1\0'+JSON.stringify(sorted(x)));
const family={workspaceId:'workspace:subject',originalWriteOwnerRef:'owner:1',sourceNodeRef:'node:A',recipientNodeRef:'node:B',scopeRef:'scope:1'};
const key={...family,ownerEpoch:1,sourceEventId:'event:source:2'};
const originalEvents=[
  {event_id:'event:source:1',event_type:'source.object.created',workspace_id:family.workspaceId,object_id:'object:1',revision:1,
    occurred_at:'2026-11-25T00:00:00.000Z',service_id:'kernel:1',payload:{}},
  {event_id:key.sourceEventId,event_type:'source.asset.updated',workspace_id:family.workspaceId,object_id:'object:1',revision:2,
    occurred_at:'2026-11-25T00:00:01.000Z',service_id:'kernel:1',payload:{assetId:'asset:1'}}];
const history={workspaceId:family.workspaceId,originalWriteOwnerRef:family.originalWriteOwnerRef,maxEvents:1,
  authorizeOriginalRead:async()=>true,readOriginalEvents:async()=>structuredClone(originalEvents)};
const before=(await readT4OriginalEventWindow(history)).nextCursor;
const capture=await readT4OriginalEventWindow({...history,cursor:before}),after=capture.nextCursor;
const assetBytes=Buffer.alloc(900000,37);
const asset=verifyT4OriginalAssetDelta({schema:'IWXA_T4_ORIGINAL_ASSET_DELTA_V1',
  workspaceId:family.workspaceId,originalWriteOwnerRef:family.originalWriteOwnerRef,assetId:'asset:1',objectId:'object:1',
  mime:'application/octet-stream',baseRevision:1,sourceRevision:2,sourceEventId:key.sourceEventId,
  sourceEventDigest:capture.window.eventRefs[0].eventDigest,windowDigest:capture.window.windowDigest,
  originalEventType:originalEvents[1].event_type,bytesBase64:assetBytes.toString('base64'),assetBytesSha256:hex(assetBytes),assetSize:assetBytes.length},{enableMultipart:true});
const session={schema:'IWXA_T4_ORIGINAL_NATIVE_CAPTURE_SESSION_V1',...key,sourceRevision:2,sourceEventDigest:asset.delta.sourceEventDigest,
  sourcePrefixDigestBefore:before.sourcePrefixDigest,sourcePrefixDigestAfter:after.sourcePrefixDigest,capturedWindowDigest:asset.delta.windowDigest,
  capturedSha256:asset.sha256,changeKind:'ASSET_PUT',familyRef:'family:t4:'+identityDigest('NATIVE-FAMILY',family),
  sessionRef:'session:t4:'+identityDigest('NATIVE-SESSION',key),changeId:'change:t4:'+identityDigest('NATIVE-CHANGE',key)};
const suite='suite:ed25519',source=session.sourceNodeRef,recipient=session.recipientNodeRef;
const keys=new Map([[source,generateKeyPairSync('ed25519')],[recipient,generateKeyPairSync('ed25519')]]);
const verifyOriginalNodeSignature=async p=>p.signerRef==='key:'+p.sourceNodeRef&&verify(null,p.bytes,keys.get(p.sourceNodeRef).publicKey,p.signature);
const signed=async(node,messageType,sequence,body,criticalExtensions,overrides={})=>signT4CandidateFrame({
  unsignedFrame:createT4CandidateUnsignedFrame({messageType,sequence,body,criticalExtensions,
    messageId:'message:'+node+':'+sequence,sourceNodeRef:node,recipientNodeRef:node===source?recipient:source,
    scopeRef:session.scopeRef,sessionRef:session.sessionRef,ownerEpoch:session.ownerEpoch,cryptoSuite:suite,
    permissionRef:'permission:'+node,signerRef:'key:'+node,...overrides}),
  signOriginalNodeBytes:async p=>sign(null,p.bytes,keys.get(node).privateKey)});
const code=x=>({code:x});
const headBody=createT4OriginalSourceSessionHead({session,sourceCursorBefore:before,sourceCursorAfter:after,offerMultipart:true});
const headBytes=await signed(source,'HEADS',1,headBody,[HEAD_EXT,AGREEMENT_EXT]);
const diffBody={familyRef:session.familyRef,fromHeads:[session.sourcePrefixDigestBefore],
  multipartSelection:createT4NativeMultipartSelection({offer:headBody.multipartOffer,headSha256:hex(headBytes)})};
const diffBytes=await signed(recipient,'DIFF_REQUEST',1,diffBody,[AGREEMENT_EXT]);
const selector={sourceNodeRef:source,sessionRef:session.sessionRef,ownerEpoch:session.ownerEpoch};
const extensions=[HEAD_EXT,AGREEMENT_EXT,EXT];
async function contentPlan(fill=17,encrypted=null){
  const plan=await prepareT4CandidateMultipartOpaqueChunks({changeId:session.changeId,ownerRef:session.originalWriteOwnerRef,
    sourceContentRef:'asset:1',getMode:()=> 'T4_NETWORK',authorizeOriginalSealedContent:async()=>true,
    readOriginalSealedContent:async()=>({ciphertext:encrypted??Buffer.alloc(524289,fill),encryptionContextRef:'context:1'})});
  const change={changeId:session.changeId,changeKind:'ASSET_PUT',eventRef:session.sourceEventId,
    ownerRef:session.originalWriteOwnerRef,sourceRevision:session.sourceRevision,contentDigest:plan.manifest.contentDigest,
    parents:[session.sourcePrefixDigestBefore],multipartManifest:plan.manifest};
  const frames=[await signed(source,'CHANGE_REF',2,change,[EXT]),
    ...await Promise.all(plan.bodies.map(b=>signed(source,'CHUNK',t4CandidateMultipartChunkSequence(b),b,[EXT])))];
  return {...plan,frames};
}
const payload=await contentPlan();
function fixture(){
  const objects=new Map(),events=[],remote=new Map(),indexes=new Map(),replay=new Map(),selected=new Map();
  let puts=0,gets=0,host='host:1',allow=true,writes=0,lostPut=null,indexWrites=0;
  const kernel={hasOperation:op=>['t1.getObject','t1.listEventsSince','t1.putObject','t1.listObjects'].includes(op),
    async listObjects({workspace_id}){return structuredClone([...objects.values()].map(x=>x.object).filter(o=>o.workspace_id===workspace_id));},
    async getObject(w,id){return structuredClone(objects.get(w+':'+id)??null);},
    async listEventsSince(w){return structuredClone(events.filter(e=>e.workspace_id===w));},
    async putObject(input){
      const k=input.workspace_id+':'+input.object_id;
      if(input.base_revision!==(objects.get(k)?.object.revision??0))throw Object.assign(Error('CAS'),{code:'REVISION_CONFLICT'});
      const object={workspace_id:input.workspace_id,object_id:input.object_id,schema_id:input.schema_id,schema_version:input.schema_version,
        revision:input.base_revision+1,deleted:false,data:structuredClone(input.data),extensions:{}};
      const event={event_id:'event:technical:'+(++writes),workspace_id:input.workspace_id,object_id:input.object_id,
        revision:object.revision,event_type:input.event.event_type,payload:structuredClone(input.event.payload)};
      objects.set(k,{object});events.push(event);return structuredClone({object,event});
    }};
  const idx=(key,frameSha256)=>({schema:'IWXA_T4_NATIVE_FRAME_INDEX_READ_V1',key,frameSha256,
    addressMetadataIsNotSignatureOrAuthority:true,originalBusinessApplied:false});
  const wireTransport={wireKind:'T4_NETWORK_CANDIDATE',nativeFrameIndexVersion:1,
    forOriginalHostLifetime(isHostActive){
      const requireActive=()=>{if(isHostActive()!==true)throw Object.assign(Error('fixture transport lifetime ended'),{code:'FIXTURE_WIRE_LIFETIME_ENDED'});};
      const raw=this;
      return {...raw,...Object.fromEntries(['putSnapshot','getSnapshot','inspectOutcome','getNativeFrameIndex','putNativeFrameIndex'].map(k=>[
        k,async(...args)=>{requireActive();const result=await raw[k](...args);requireActive();return result;}]))};
    },
    async putSnapshot({key,bytes,expectedSha256,createOnly}){
      assert.equal(createOnly,true);assert.equal(hex(bytes),expectedSha256);assert.equal(key,expectedSha256+'.t4n');puts++;
      if(lostPut==='before'){lostPut=null;throw new T4TransferError('NETWORK_UNAVAILABLE');}
      const seen=remote.has(key);if(seen)assert.deepEqual(remote.get(key),bytes);else remote.set(key,new Uint8Array(bytes));
      if(lostPut==='after'){lostPut=null;throw new T4TransferError('OUTCOME_UNKNOWN',{operation:'PUT'});}
      return {key,sha256:expectedSha256,state:seen?'ALREADY_PRESENT_VERIFIED':'PUBLISHED_AND_READ_BACK'};
    },
    async getSnapshot({key,expectedSha256}){gets++;const bytes=remote.get(key);
      if(!bytes)throw new T4TransferError('REMOTE_NOT_FOUND');assert.equal(hex(bytes),expectedSha256);return {bytes:new Uint8Array(bytes)};},
    async inspectOutcome({key,expectedSha256}){await this.getSnapshot({key,expectedSha256});return {state:'EXPECTED_BYTES_PRESENT',key,sha256:expectedSha256};},
    async getNativeFrameIndex({key}){gets++;return indexes.has(key)?idx(key,indexes.get(key)):null;},
    async putNativeFrameIndex({key,frameSha256}){indexWrites++;if(indexes.has(key)&&indexes.get(key)!==frameSha256)
      throw Object.assign(Error('conflict'),{code:'REMOTE_INDEX_SLOT_CONFLICT'});indexes.set(key,frameSha256);return idx(key,frameSha256);}
  };
  const auth=async()=>allow;
  const readAgreement=async node=>selected.get(node)??null;
  const transport=(node,enabled=true,overrides={})=>createT4CandidateFrameTransport({
    wireTransport,getMode:()=> 'T4_NETWORK',readOriginalHostContext:async()=>({nodeRef:node,scopeRef:session.scopeRef,
      originalOwnerRef:session.originalWriteOwnerRef,hostSessionRef:host}),
    originalHostNodeRef:node,originalHostScopeRef:session.scopeRef,authorizeOriginalHostWire:auth,verifyOriginalNodeSignature,
    authorizeOriginalNetwork:auth,persistOriginalReplayDecision:async p=>{
      const k=[node,p.sourceNodeRef,p.sessionRef,p.ownerEpoch,p.sequence].join(':');const prior=replay.get(k);
      if(prior!==undefined)return prior===p.frameDigest?'SEEN_EXACT':'CONFLICT';replay.set(k,p.frameDigest);return 'RECORDED';
    },...(enabled?{enableOriginalMultipartNegotiation:true,readOriginalMultipartAgreement:()=>readAgreement(node)}:{}),...overrides});
  const port=(node,enabled=true,overrides={})=>createT4OriginalNetworkPublicationPort({
    session,localNodeRef:node,technicalWorkspaceId:'workspace:technical:'+node,originalKernel:kernel,getMode:()=> 'T4_NETWORK',
    readOriginalHostContext:async()=>({workspaceId:'workspace:technical:'+node,originalWriteOwnerRef:session.originalWriteOwnerRef,
      nodeRef:node,scopeRef:session.scopeRef,hostSessionRef:host}),authorizeOriginalTechnicalRead:auth,authorizeOriginalTechnicalWrite:auth,
    authorizeOriginalFramePublish:auth,verifyOriginalNodeSignature,frameTransport:transport(node,enabled),
    ...(node===source?{authorizeOriginalSealedPublication:auth,authorizeOriginalMultipartBacking:auth}:{}),
    ...(enabled?{enableOriginalMultipartNegotiation:true,...(node===source?{readOriginalMultipartAgreement:()=>readAgreement(node)}:{})}:{}),
    ...overrides});
  const publish=async(node,type,bytes)=>{
    const p=port(node);await p.prepareSignedBatch({slots:[{sequence:1,messageType:type}],createSignedFrames:async()=>[bytes]});
    await p.publishPreparedFrame({sequence:1});return p;
  };
  async function negotiate(){
    const sp=await publish(source,'HEADS',headBytes);
    const h=await transport(recipient).discoverUniqueSignedFrame({selector:{...selector,messageType:'HEADS',sequence:1},
      requiredCryptoSuite:suite,supportedCriticalExtensions:extensions});
    const rp=await publish(recipient,'DIFF_REQUEST',diffBytes);
    const df=await transport(source).discoverUniqueSignedFrame({selector:{sourceNodeRef:recipient,sessionRef:session.sessionRef,
      ownerEpoch:session.ownerEpoch,messageType:'DIFF_REQUEST',sequence:1},requiredCryptoSuite:suite,supportedCriticalExtensions:extensions});
    const sh=await sp.readOriginalPublishedFrame({sequence:1,includePresentEventAnchor:true});
    const rd=await rp.readOriginalPublishedFrame({sequence:1,includePresentEventAnchor:true});
    const sa=agreement({session,sourceHead:sh,recipientDiff:df.receipt,localRole:'SOURCE',requiredCryptoSuite:suite});
    const ra=agreement({session,sourceHead:h.receipt,recipientDiff:rd,localRole:'RECIPIENT',requiredCryptoSuite:suite});
    selected.set(source,sa);selected.set(recipient,ra);return {sp,rp,sh,rd,hr:h.receipt,dr:df.receipt,sa,ra};
  }
  async function prepare(sp,plan=payload){await sp.prepareOriginalMultipartBacking({wireBytes:plan.frames});return sp.prepareOriginalMultipartPublication();}
  function inject(bytes){const sha=hex(bytes),f=decodeT4CandidateFrame(bytes);remote.set(sha+'.t4n',new Uint8Array(bytes));
    for(const key of t4NativeFrameIndexKeys(f))indexes.set(key,sha);}
  return {objects,events,remote,indexes,replay,selected,transport,port,publish,negotiate,prepare,inject,kernel,get host(){return host;},
    get puts(){return puts;},get gets(){return gets;},get writes(){return writes;},get indexWrites(){return indexWrites;},
    losePut:where=>{lostPut=where;},restart:()=>{host='host:2';},allow:x=>{allow=x;}};
}
test('K145 native offer and selection use existing slot 1, old HEAD bytes remain unchanged when disabled',async()=>{
  assert.deepEqual(headBody.multipartOffer,createT4NativeMultipartOffer());
  assert.deepEqual(readT4OriginalSourceSessionHead({identity:session,body:decodeT4CandidateFrame(headBytes).body,
    sessionRef:session.sessionRef}).session,session);
  assert.equal(decodeT4CandidateFrame(diffBytes).sequence,1);
  const old=createT4OriginalSourceSessionHead({session,sourceCursorBefore:before,sourceCursorAfter:after});
  assert.equal(Object.hasOwn(old,'multipartOffer'),false);
  await assert.rejects(signed(source,'HEADS',1,headBody,[HEAD_EXT]),code('WIRE_FIELDS_INVALID'));
  await assert.rejects(signed(source,'HEADS',1,{...headBody,multipartOffer:{...headBody.multipartOffer,maxParts:15}},[HEAD_EXT,AGREEMENT_EXT]),code('WIRE_NATIVE_MULTIPART_OFFER_INVALID'));
  await assert.rejects(signed(source,'HEADS',1,{...headBody,sourceSession:{...headBody.sourceSession,changeKind:'OBJECT_PUT'}},[HEAD_EXT,AGREEMENT_EXT]),code('WIRE_NATIVE_MULTIPART_OFFER_KIND_INVALID'));
  await assert.rejects(signed(recipient,'DIFF_REQUEST',2,diffBody,[AGREEMENT_EXT]),code('WIRE_NATIVE_MULTIPART_AGREEMENT_SEQUENCE_INVALID'));
});
test('K145 two real signed directions and original publication/replay proofs derive the same exact agreement',async()=>{
  const f=fixture(),{sa,ra,sh,dr}=await f.negotiate();
  assert.deepEqual(sa,ra);assert.equal(sa.originalSubjectAuthorityGranted,false);assert.equal(sa.headSha256,hex(headBytes));
  assert.equal(sa.diffSha256,hex(diffBytes));assert.deepEqual(validate({agreement:sa,session,headSha256:hex(headBytes)}),sa);
  const args={session,sourceHead:sh,recipientDiff:dr,localRole:'SOURCE',requiredCryptoSuite:suite};
  assert.throws(()=>agreement({...args,sourceHead:{...sh,originalPresentEventId:null}}),code('MULTIPART_AGREEMENT_ORIGINAL_PROOF_REQUIRED'));
  assert.throws(()=>agreement({...args,recipientDiff:{...dr,originalReplayCheckpointRecorded:false}}),code('MULTIPART_AGREEMENT_ORIGINAL_PROOF_REQUIRED'));
  assert.throws(()=>agreement({...args,recipientDiff:{...dr,verifiedBody:{...diffBody,multipartSelection:{...diffBody.multipartSelection,headSha256:hex('other')}}}}),code('MULTIPART_AGREEMENT_DIFF_MISMATCH'));
  assert.throws(()=>validate({agreement:{...sa,diffSha256:hex('other')},session}),code('MULTIPART_AGREEMENT_WITNESS_INVALID'));
});
test('K145 root selection binds original agreement and refuses absent or changed agreement before CAS',async()=>{
  const f=fixture(),sp=await f.publish(source,'HEADS',headBytes);
  await assert.rejects(sp.prepareOriginalMultipartBacking({wireBytes:payload.frames}),code('MULTIPART_AGREEMENT_WITNESS_INVALID'));
  assert.equal(f.writes,3);
  const g=fixture(),{sp:p,sa}=await g.negotiate();
  const r=await g.prepare(p);assert.equal(r.originalMultipartAgreementDigest,sa.agreementDigest);
  const reserved=g.events.find(e=>e.payload.action==='MULTIPART_RESERVE');
  assert.equal(reserved.payload.multipartReservation.agreementDigest,sa.agreementDigest);
  g.restart();const restored=await g.port(source).readOriginalMultipartBacking();assert.equal(restored.originalMultipartAgreementDigest,sa.agreementDigest);
  g.selected.delete(source);const count=g.puts;
  await assert.rejects(g.port(source).publishPreparedFrame({sequence:2}),code('MULTIPART_AGREEMENT_WITNESS_INVALID'));assert.equal(g.puts,count);
});
test('K145 old native transport rejects new offer; new source announcement selects exact offer without granting subject rights',async()=>{
  const f=fixture();await f.publish(source,'HEADS',headBytes);
  await assert.rejects(f.transport(recipient,false).discoverSourceSessionHeads({selector:{sourceNodeRef:source,ownerEpoch:1,
    familyRef:session.familyRef,predecessorEventCount:1},requiredCryptoSuite:suite}),code('WIRE_NATIVE_MULTIPART_NEGOTIATION_REQUIRED'));
  const result=await discoverT4OriginalSourceSessionAnnouncement({identity:session,sourceCursorBefore:before,
    frameDiscoveryPort:f.transport(recipient),requiredCryptoSuite:suite,authorizeOriginalDiscovery:async()=>true,enableOriginalMultipartNegotiation:true});
  assert.equal(result.state,'ORIGINAL_NATIVE_SESSION_SELECTED');assert.equal(result.sourceHeadSha256,hex(headBytes));
  assert.deepEqual(result.multipartOffer,headBody.multipartOffer);assert.equal(result.originalCaptureEvidenceVerified,false);
});
test('K146 exact pages expose missing slots, recover in order, and never claim complete original business result',async()=>{
  const f=fixture(),{sp,sa}=await f.negotiate(),r=f.transport(recipient);
  const page=(startSequence=3,limit=64,expectedManifestDigest=null)=>r.discoverOriginalMultipartContentPage({
    selector,requiredCryptoSuite:suite,startSequence,limit,expectedManifestDigest});
  assert.equal((await page()).state,'WAITING_FOR_CHANGE_REF');
  await f.prepare(sp);await sp.publishOriginalMultipartFrames({limit:3});
  const first=await page(3,64);
  assert.equal(first.state,'PAGE_INCOMPLETE');assert.equal(first.receipts.length,2);assert.equal(first.missing.length,62);
  assert.equal(first.originalMultipartAgreementDigest,sa.agreementDigest);assert.equal(first.nextSequence,67);
  assert.equal(first.originalCompleteContentProven,false);
  await sp.publishOriginalMultipartFrames({limit:64});f.restart();
  const a=await page(3,64,first.manifestDigest),b=await page(67,64,first.manifestDigest);
  assert.equal(a.state,'PAGE_COMPLETE');assert.equal(b.state,'PAGE_COMPLETE');assert.equal(b.nextSequence,null);
  assert.equal(a.receipts.length,64);assert.equal(b.receipts.length,1);
  const all=[...a.receipts,...b.receipts].map(x=>x.verifiedBody);
  assert.deepEqual(assembleT4CandidateMultipartOpaqueChunks({manifest:a.change.verifiedBody.multipartManifest,bodies:all}).ciphertext,
    new Uint8Array(524289).fill(17));
  assert.equal(a.originalBusinessApplied,false);assert.equal(b.recipientCursorAdvanced,false);
  await assert.rejects(page(3,64,d('wrong')),code('WIRE_MULTIPART_DISCOVERY_MANIFEST_CHANGED'));
});
test('K146 no multipart CHUNK replay is admitted without original manifest proof or on wrong manifest',async()=>{
  const f=fixture();await f.negotiate();
  f.inject(payload.frames[0]);const other=await contentPlan(91);f.inject(other.frames[1]);
  const r=f.transport(recipient),replayKey=[recipient,source,session.sessionRef,session.ownerEpoch,3].join(':');
  await assert.rejects(r.discoverUniqueSignedFrame({selector:{...selector,messageType:'CHUNK',sequence:3},requiredCryptoSuite:suite,
    supportedCriticalExtensions:extensions}),code('WIRE_MULTIPART_MANIFEST_PROOF_REQUIRED'));
  assert.equal(f.replay.has(replayKey),false);
  await assert.rejects(r.discoverOriginalMultipartContentPage({selector,requiredCryptoSuite:suite,startSequence:3,limit:1}),
    code('MULTIPART_CHUNK_MANIFEST_MISMATCH'));
  assert.equal(f.replay.has(replayKey),false);
  f.inject(payload.frames[1]);const p=await r.discoverOriginalMultipartContentPage({selector,requiredCryptoSuite:suite,startSequence:3,limit:1});
  assert.equal(p.state,'PAGE_COMPLETE');assert.equal(f.replay.has(replayKey),true);
});
test('K146 transport rejects unselected content before original replay and detects changed agreement at replay CAS',async()=>{
  const f=fixture(),{ra}=await f.negotiate();f.inject(payload.frames[0]);f.selected.delete(recipient);
  const replayKey=[recipient,source,session.sessionRef,session.ownerEpoch,2].join(':');
  const request={selector:{...selector,messageType:'CHANGE_REF',sequence:2},requiredCryptoSuite:suite,supportedCriticalExtensions:extensions};
  await assert.rejects(f.transport(recipient).discoverUniqueSignedFrame(request),code('MULTIPART_AGREEMENT_WITNESS_INVALID'));
  assert.equal(f.replay.has(replayKey),false);
  let calls=0;const q=f.transport(recipient,true,{readOriginalMultipartAgreement:async()=>++calls===1?ra:null});
  await assert.rejects(q.discoverUniqueSignedFrame(request),code('MULTIPART_AGREEMENT_WITNESS_INVALID'));
  assert.equal(f.replay.has(replayKey),false);
});

function discoveryArgs(f,overrides={}){
  return {session,frameDiscoveryPort:f.transport(recipient),requiredCryptoSuite:suite,
    authorizeOriginalRecipientSession:async()=>true,requireSourceAnnouncement:true,sourceCursorBefore:before,
    readOriginalMultipartAgreement:async()=>f.selected.get(recipient)??null,...overrides};
}
test('K147 original subject discovery never opens or applies an incomplete multipart set and derives exact missing fragments',async()=>{
  const f=fixture(),{sp}=await f.negotiate(),args=discoveryArgs(f);
  assert.equal((await discoverT4OriginalNetworkSessionContent(args)).state,'WAITING_FOR_CHANGE');
  await f.prepare(sp);await sp.publishOriginalMultipartFrames({limit:3});
  const incomplete=await discoverT4OriginalNetworkSessionContent(args);
  assert.equal(incomplete.state,'WAITING_FOR_CHUNKS');assert.equal(incomplete.missingMultipartChunks.length,63);
  assert.equal(incomplete.missingMultipartChunks.at(-1).partIndex,1);
  assert.equal(incomplete.originalDecryptionInvoked,false);assert.equal(incomplete.originalBusinessApplied,false);
  f.restart();await f.port(source).publishOriginalMultipartFrames({limit:64});
  const complete=await discoverT4OriginalNetworkSessionContent(discoveryArgs(f));
  assert.equal(complete.state,'CONTENT_VERIFIED');assert.equal(complete.verifiedChunks.length,65);
  assert.equal(complete.originalSourceEventAndSubjectNotYetVerified,true);assert.equal(complete.originalDecryptionInvoked,false);
});
test('K147 page metadata cannot fabricate completeness, skip a slot or change signed content',async()=>{
  const f=fixture(),{sp}=await f.negotiate();await f.prepare(sp);await sp.publishOriginalMultipartFrames({limit:3});
  const port=f.transport(recipient),call=port.discoverOriginalMultipartContentPage;
  for(const rewrite of [p=>({...p,nextSequence:null}),p=>({...p,missing:p.missing.slice(1)}),
    p=>({...p,receipts:[p.receipts[0],p.receipts[0]]})]){
    await assert.rejects(discoverT4OriginalNetworkSessionContent(discoveryArgs(f,{frameDiscoveryPort:{...port,
      discoverOriginalMultipartContentPage:async a=>rewrite(await call(a))}})),
      e=>['SUBJECT_MULTIPART_PAGE_INVALID','SUBJECT_MULTIPART_PAGE_SLOT_INVALID'].includes(e.code));
  }
});
const keyBytes=Buffer.alloc(32,93),iv=Buffer.alloc(12,19);
function seal(bytes){
  const cipher=createCipheriv('aes-256-gcm',keyBytes,iv);cipher.setAAD(Buffer.from(session.changeId));
  return Buffer.concat([iv,cipher.update(bytes),cipher.final(),cipher.getAuthTag()]);
}
async function openedFixture({differentCapture=false}={}){
  const f=fixture(),{sp,rd,sa}=await f.negotiate();
  const original= differentCapture?verifyT4OriginalAssetDelta({...asset.delta,bytesBase64:Buffer.alloc(assetBytes.length,21).toString('base64'),
    assetBytesSha256:hex(Buffer.alloc(assetBytes.length,21))},{enableMultipart:true}):asset;
  const plan=await contentPlan(17,seal(original.bytes));await f.prepare(sp,plan);
  let pending=await sp.publishOriginalMultipartFrames({limit:64});
  f.restart();
  for(let i=0;i<16&&pending.remaining>0;i++)pending=await f.port(source).publishOriginalMultipartFrames({limit:64});
  assert.equal(pending.remaining,0);
  const discovered=await discoverT4OriginalNetworkSessionContent(discoveryArgs(f));
  assert.equal(discovered.state,'CONTENT_VERIFIED');
  const headArgs={verifiedHeads:discovered.verifiedHeads,verifiedDiffRequest:rd,verifiedChangeRef:discovered.verifiedChangeRef,
    ...family,sessionRef:session.sessionRef,ownerEpoch:session.ownerEpoch,sourceCursorBefore:before,
    capturedWindowDigest:session.capturedWindowDigest,originalMultipartCaptureSession:session,getMode:()=> 'T4_NETWORK',
    readOriginalHostContext:async()=>({workspaceId:family.workspaceId,originalWriteOwnerRef:family.originalWriteOwnerRef,
      nodeRef:source,scopeRef:family.scopeRef,hostSessionRef:'host:source'}),authorizeOriginalRead:async()=>true,
    readOriginalEvents:history.readOriginalEvents,verifyOriginalSourceSubject:async()=>true};
  const headProof=await verifyT4OriginalSourceHeadCausality(headArgs);
  assert.equal(headProof.originalMultipartAgreementDigest,sa.agreementDigest);
  let opens=0;
  const args={verifiedChangeRef:discovered.verifiedChangeRef,verifiedChunks:discovered.verifiedChunks,originalSourceHeadProof:headProof,
    encryptionContextRef:discovered.encryptionContextRef,recipientNodeRef:recipient,scopeRef:session.scopeRef,getMode:()=> 'T4_NETWORK',
    readOriginalHostContext:async()=>({nodeRef:recipient,scopeRef:session.scopeRef,hostSessionRef:'host:recipient',
      originalWriteOwnerRef:session.originalWriteOwnerRef}),authorizeOriginalSealedOpen:async()=>true,
    verifyOriginalSourceBinding:async()=>true,originalCaptureSession:session,
    readOriginalMultipartAgreement:async()=>f.selected.get(recipient)??null,
    openOriginalSealedContent:async p=>{
      opens++;const raw=Buffer.from(p.ciphertext),decipher=createDecipheriv('aes-256-gcm',keyBytes,raw.subarray(0,12));
      decipher.setAAD(Buffer.from(session.changeId));decipher.setAuthTag(raw.subarray(-16));
      return {authenticated:true,plaintext:new Uint8Array(Buffer.concat([decipher.update(raw.subarray(12,-16)),decipher.final()])),
        originalVaultUsed:true,originalCapturedBytesVerified:true,originalBusinessApplied:false};
    }};
  return {f,args,headArgs,get opens(){return opens;}};
}
test('K147 original HEAD/DIFF causality, complete AES-GCM plaintext, one original Asset mutation and cold result readback',async()=>{
  const t=await openedFixture(),received=await openT4OriginalNetworkSubjectChange(t.args);
  assert.equal(t.opens,1);assert.equal(received.sha256,asset.sha256);assert.equal(received.originalBusinessApplied,false);
  assert.equal(received.originalMultipartAgreementDigest,t.args.originalSourceHeadProof.originalMultipartAgreementDigest);
  let stored={asset:{workspace_id:family.workspaceId,asset_id:'asset:1',object_id:'object:1',mime:asset.delta.mime,revision:1},
    bytes:new Uint8Array([1])},writes=0;const events=[];
  const kernel={hasOperation:op=>['t1.getAsset','t1.getObject','t1.listEventsSince','t1.putAsset'].includes(op),
    async getAsset(){return structuredClone(stored);},
    async getObject(w,id){return {object:{workspace_id:w,object_id:id,revision:1,deleted:false}};},
    async listEventsSince(){return structuredClone(events);},
    async putAsset(input){writes++;assert.equal(input.base_revision,stored.asset.revision);
      stored={asset:{...stored.asset,revision:input.base_revision+1,size:input.bytes.length},bytes:new Uint8Array(input.bytes)};
      const e={event_id:'event:recipient:asset',workspace_id:input.workspace_id,object_id:input.object_id,revision:stored.asset.revision,
        event_type:input.event.event_type,payload:input.event.payload,idempotency_key:input.event.idempotency_key};events.push(e);
      return {asset:stored.asset,event:e};}};
  const a={received,originalKernel:kernel,getMode:()=> 'T4_NETWORK',authorizeOriginalRead:async()=>true,
    authorizeOriginalWrite:async()=>true,verifyOriginalSourceEvent:async()=>true};
  assert.equal((await inspectT4OriginalNetworkRecipientResult(a)).state,'NOT_APPLIED');
  const result=await applyT4OriginalNetworkSubjectChange(a);assert.equal(result.originalBusinessApplied,true);assert.equal(writes,1);
  assert.deepEqual(stored.bytes,new Uint8Array(assetBytes));
  const ack=createT4OriginalNetworkAppliedAckBody({received,verifiedResult:result,ackRef:'ack:asset'});
  assert.equal(ack.recipientEventRef,events[0].event_id);assert.equal(ack.recipientRevision,2);
  assert.equal((await inspectT4OriginalNetworkRecipientResult(a)).state,'APPLIED_VERIFIED');
  assert.equal((await applyT4OriginalNetworkSubjectChange(a)).originalCommitInvoked,false);assert.equal(writes,1);
});
test('K147 incomplete set, missing original agreement and wrong source proof never invoke decryption',async()=>{
  const t=await openedFixture();
  await assert.rejects(openT4OriginalNetworkSubjectChange({...t.args,verifiedChunks:t.args.verifiedChunks.slice(1)}),
    code('MULTIPART_CHUNKS_INCOMPLETE'));
  await assert.rejects(openT4OriginalNetworkSubjectChange({...t.args,readOriginalMultipartAgreement:null}),
    code('SUBJECT_MULTIPART_OPEN_PORT_REQUIRED'));
  await assert.rejects(openT4OriginalNetworkSubjectChange({...t.args,originalSourceHeadProof:{...t.args.originalSourceHeadProof,
    originalMultipartDiffSha256:hex('wrong')}}),code('SUBJECT_MULTIPART_SOURCE_BINDING_MISMATCH'));
  await assert.rejects(verifyT4OriginalSourceHeadCausality({...t.headArgs,originalMultipartCaptureSession:null}),
    code('HEAD_MULTIPART_AGREEMENT_REQUIRED'));
  assert.equal(t.opens,0);
});
test('K147 authenticated encryption cannot substitute another valid original Asset capture',async()=>{
  const t=await openedFixture({differentCapture:true});
  await assert.rejects(openT4OriginalNetworkSubjectChange(t.args),code('SUBJECT_MULTIPART_CAPTURE_MISMATCH'));
  assert.equal(t.opens,1);
});
test('K147 agreement revocation during authenticated open denies received subject proof',async()=>{
  const t=await openedFixture(),open=t.args.openOriginalSealedContent;
  await assert.rejects(openT4OriginalNetworkSubjectChange({...t.args,openOriginalSealedContent:async p=>{
    const result=await open(p);t.f.selected.delete(recipient);return result;
  }}),code('MULTIPART_AGREEMENT_WITNESS_INVALID'));
  assert.equal(t.opens,1);
});

function originalSourceTask(f,{captureProfile=EXT,prepared=asset,sourceCursorPort,
  verifyOriginalRecipientApplied=async()=>false,publicationOptions=()=>({}),transportOptions=()=>({})}={}){
  let seals=0,signatures=0,frontier=1;
  const hostContext=async()=>({workspaceId:session.workspaceId,originalWriteOwnerRef:session.originalWriteOwnerRef,
    networkTargetRef:recipient,hostSessionRef:f.host});
  const task={schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_OUTBOX_TASK_V1',state:'ORIGINAL_NATIVE_CAPTURE_READY',
    ...family,ownerEpoch:session.ownerEpoch,networkTargetRef:recipient,sourceCursorBefore:before,sourceCursorAfter:after,
    originalRecipientApplied:false,sourceCursorAdvanced:false,recipientCursorAdvanced:false,networkPublished:false,originalSubjectMutationInvoked:false,
    capture:{kind:'ASSET_PUT',captureRef:'capture:asset',workspaceId:session.workspaceId,originalWriteOwnerRef:session.originalWriteOwnerRef,
      sourceEventId:session.sourceEventId,sourceRevision:session.sourceRevision,sourceWindow:capture.window,prepared,
      ...(captureProfile===null?{}:{originalAssetCaptureProfile:captureProfile}),originalIntentEventAndCanonicalBytesVerified:true,capturedWindowDigestVerified:true}};
  const phase=()=>createT4OriginalNetworkSessionPhasePort({originalKernel:f.kernel,...session,
    technicalWorkspaceId:'workspace:technical:'+source,localNodeRef:source,getMode:()=> 'T4_NETWORK',
    readOriginalHostContext:async()=>({workspaceId:'workspace:technical:'+source,originalWriteOwnerRef:session.originalWriteOwnerRef,
      nodeRef:source,scopeRef:session.scopeRef,hostSessionRef:f.host}),authorizeOriginalTechnicalRead:async()=>true,
    authorizeOriginalTechnicalWrite:async()=>true,verifyOriginalPhaseEvidence:async()=>true,verifyOriginalRecipientApplied});
  const bind=()=>createT4OriginalHostDispatchTaskBinding({expectedWorkspaceId:session.workspaceId,
    expectedOriginalWriteOwnerRef:session.originalWriteOwnerRef,expectedNetworkTargetRef:recipient,getMode:()=> 'T4_NETWORK',
    readOriginalHostContext:hostContext,authorizeOriginalHostTask:async()=>true,
    dispatcher:{drain:async()=>assert.fail('legacy drain'),prepareNextNativeObject:async()=>({...task,originalHostFrontierRevision:frontier})},
    createOriginalNativePublicationPort:async()=>f.port(source,true,publicationOptions())});
  const options=()=>({enableOriginalMultipartNegotiation:true,announceOriginalSourceSession:true,requiredCryptoSuite:suite,
    sourceCursorPort:sourceCursorPort?.(),createOriginalSourcePhasePort:async()=>phase(),frameDiscoveryPort:f.transport(source,true,transportOptions()),
    resolveOriginalSigningContext:async()=>({permissionRef:'permission:'+source,signerRef:'key:'+source}),
    signOriginalNodeBytes:async p=>{signatures++;return sign(null,p.bytes,keys.get(source).privateKey);},
    authorizeOriginalSealedContent:async()=>true,readOriginalSealedContent:async p=>{
      seals++;assert.equal(p.multipartProfile,EXT);assert.equal(p.originalMultipartAgreementDigest,f.selected.get(source)?.agreementDigest);
      assert.equal(p.exactCapturedCanonicalBytesRequired,true);
      return {ciphertext:seal(asset.bytes),encryptionContextRef:'context:1'};
    },authorizeOriginalRead:async()=>true,readOriginalEvents:history.readOriginalEvents,verifyOriginalSourceSubject:async()=>true});
  return {bind,options,phase,get seals(){return seals;},get signatures(){return signatures;},advanceFrontier:()=>{frontier++;}};
}
const allow=async()=>true,getMode=()=> 'T4_NETWORK';
function originalCursorArgs(f,node,kernel=f.kernel){
  const technicalWorkspaceId='workspace:technical:'+node;
  const identity={technicalWorkspaceId,sourceWorkspaceId:family.workspaceId,
    originalWriteOwnerRef:family.originalWriteOwnerRef,sourceNodeRef:source,recipientNodeRef:recipient,
    scopeRef:family.scopeRef,ownerEpoch:session.ownerEpoch};
  const role=node===source?'SOURCE':'RECIPIENT';
  const baseline={schema:'IWXA_T4_ORIGINAL_'+role+'_BASELINE_V1',identity,
    originalBaselineRef:'baseline:'+role,originalBaselineDigest:d('original admitted '+role+' baseline'),sourceCursor:before};
  return {...identity,originalKernel:kernel,getMode,readOriginalHostContext:async()=>({
    workspaceId:technicalWorkspaceId,originalWriteOwnerRef:family.originalWriteOwnerRef,nodeRef:node,
    scopeRef:family.scopeRef,hostSessionRef:f.host}),authorizeOriginalTechnicalRead:allow,
    authorizeOriginalTechnicalWrite:allow,authorizeOriginalSourceRead:allow,
    readOriginalSourceEvents:history.readOriginalEvents,readOriginalAdmittedBaseline:async()=>structuredClone(baseline),
    ...(role==='SOURCE'?{verifyOriginalSourceBaseline:async p=>JSON.stringify(sorted(p.baseline))===JSON.stringify(sorted(baseline))}:
      {authorizeOriginalRecipientRead:allow,verifyOriginalRecipientBaseline:async p=>JSON.stringify(sorted(p.baseline))===JSON.stringify(sorted(baseline))})};
}
function originalRecipientTask(f){
  const subjectEvents=[];let opens=0,signatures=0,writes=0,lose=false,received=null,admitted=true;
  let stored={asset:{workspace_id:family.workspaceId,asset_id:asset.delta.assetId,object_id:asset.delta.objectId,
    mime:asset.delta.mime,revision:1,size:1},bytes:new Uint8Array([1])};
  const kernel={...f.kernel,hasOperation:op=>f.kernel.hasOperation(op)||['t1.getAsset','t1.putAsset'].includes(op),
    async getObject(w,id){if(w===family.workspaceId&&id===asset.delta.objectId)return {object:{workspace_id:w,object_id:id,revision:1,deleted:false}};
      return f.kernel.getObject(w,id);},
    async listEventsSince(w){return w===family.workspaceId?structuredClone(subjectEvents):f.kernel.listEventsSince(w);},
    async getAsset(w,id){assert.equal(w,family.workspaceId);assert.equal(id,asset.delta.assetId);return structuredClone(stored);},
    async putAsset(input){
      assert.equal(input.workspace_id,family.workspaceId);assert.equal(input.asset_id,asset.delta.assetId);
      assert.equal(input.base_revision,stored.asset.revision);assert.equal(writes,0);
      writes++;stored={asset:{...stored.asset,revision:input.base_revision+1,size:input.bytes.length},bytes:new Uint8Array(input.bytes)};
      const event={event_id:'event:recipient:asset',workspace_id:input.workspace_id,object_id:input.object_id,
        revision:stored.asset.revision,event_type:input.event.event_type,payload:structuredClone(input.event.payload),
        idempotency_key:input.event.idempotency_key,service_id:'service:recipient',occurred_at:'2026-11-26T00:00:00Z'};
      subjectEvents.push(event);
      if(lose){lose=false;throw Object.assign(Error('lost original committed response'),{code:'ACK_LOST'});}
      return {asset:structuredClone(stored.asset),event};
    }};
  const cursor=()=>createT4OriginalNetworkRecipientCursorPort(originalCursorArgs(f,recipient,kernel));
  const phase=()=>createT4OriginalNetworkSessionPhasePort({...originalCursorArgs(f,recipient,kernel),
    ...session,localNodeRef:recipient,recipientApplyIntentRequired:true,verifyOriginalPhaseEvidence:allow,
    verifyOriginalRecipientApplied:received===null?async()=>false:createT4OriginalRecipientAppliedVerifier({
      session,received,originalKernel:kernel,getMode,authorizeOriginalRead:allow})});
  const verifyApplied=async p=>{
    if(received===null)return false;
    const actual=await inspectT4OriginalNetworkRecipientResult({received,originalKernel:kernel,getMode,authorizeOriginalRead:allow});
    return actual.state==='APPLIED_VERIFIED'&&p.originalRecipientEventId===actual.originalRecipientEventId&&
      p.originalRecipientRevision===actual.originalRecipientRevision&&p.originalRecipientStateDigest===actual.originalRecipientStateDigest;
  };
  const bind=()=>createT4OriginalHostRecipientDispatcher({...family,ownerEpoch:session.ownerEpoch,originalKernel:kernel,getMode,
    readOriginalHostContext:async()=>({...family,nodeRef:recipient,hostSessionRef:f.host}),
    authorizeOriginalHostTask:allow,authorizeNetworkReceive:allow,authorizeOriginalRead:allow,authorizeOriginalWrite:allow,
    verifyOriginalSourceEvent:async p=>p.sourceEventId===session.sourceEventId&&p.sourceEventDigest===session.sourceEventDigest&&
      p.originalSubjectDeltaSha256===asset.sha256&&p.assetBytesSha256===asset.delta.assetBytesSha256,
    originalRecipientCursorPort:cursor(),withOriginalSubjectMutation:async(_,action)=>action()});
  const options=()=>({enableOriginalMultipartNegotiation:true,useSignedSourceAnnouncement:true,requiredCryptoSuite:suite,
    frameDiscoveryPort:f.transport(recipient),createOriginalRecipientPublicationPort:async p=>{
      assert.deepEqual(p.session,session);assert.deepEqual(p.originalMultipartOffer,headBody.multipartOffer);
      assert.equal(typeof p.sourceHeadSha256,'string');return f.port(recipient);
    },createOriginalRecipientPhasePort:async p=>{if(p.received!==null)received=structuredClone(p.received);return phase();},
    authorizeOriginalRecipientSession:async p=>admitted&&JSON.stringify(sorted(p.session))===JSON.stringify(sorted(session))&&
      JSON.stringify(sorted(p.sourceCursorBefore))===JSON.stringify(sorted(before)),
    resolveOriginalSigningContext:async()=>({permissionRef:'permission:'+recipient,signerRef:'key:'+recipient}),
    signOriginalNodeBytes:async p=>{signatures++;return sign(null,p.bytes,keys.get(recipient).privateKey);},
    readOriginalSourceHostContext:async()=>({...family,nodeRef:source,hostSessionRef:f.host}),
    authorizeOriginalSourceRead:allow,readOriginalSourceEvents:history.readOriginalEvents,
    verifyOriginalSourceSubject:async p=>p.originalSourceEventId===session.sourceEventId&&p.originalSourceRevision===session.sourceRevision,
    verifyOriginalSourceBinding:async p=>p.originalSourceHeadProof.originalMultipartAgreementDigest===f.selected.get(recipient)?.agreementDigest,
    authorizeOriginalSealedOpen:allow,openOriginalSealedContent:async p=>{
      opens++;assert.equal(p.originalMultipartAgreementDigest,f.selected.get(recipient)?.agreementDigest);
      const raw=Buffer.from(p.ciphertext),decipher=createDecipheriv('aes-256-gcm',keyBytes,raw.subarray(0,12));
      decipher.setAAD(Buffer.from(session.changeId));decipher.setAuthTag(raw.subarray(-16));
      return {authenticated:true,plaintext:new Uint8Array(Buffer.concat([decipher.update(raw.subarray(12,-16)),decipher.final()])),
        originalVaultUsed:true,originalCapturedBytesVerified:true,originalBusinessApplied:false};
    }});
  return {bind,options,phase,cursor,verifyApplied,subjectEvents,get opens(){return opens;},get signatures(){return signatures;},
    get writes(){return writes;},get stored(){return structuredClone(stored);},lose:()=>{lose=true;},admit:value=>{admitted=value;}};
}
async function readFixtureAgreement(f,node){
  const local=f.port(node),remote=node===source?recipient:source,type=node===source?'DIFF_REQUEST':'HEADS';
  const found=await f.transport(node).discoverUniqueSignedFrame({selector:{sourceNodeRef:remote,sessionRef:session.sessionRef,
    ownerEpoch:session.ownerEpoch,messageType:type,sequence:1},requiredCryptoSuite:suite,supportedCriticalExtensions:extensions});
  assert.equal(found.state,'FOUND');
  const published=await local.readOriginalPublishedFrame({sequence:1,includePresentEventAnchor:true});
  return agreement({session,sourceHead:node===source?published:found.receipt,recipientDiff:node===source?found.receipt:published,
    localRole:node===source?'SOURCE':'RECIPIENT',requiredCryptoSuite:suite});
}
for(const scenario of ['compact-regression','historical','warm-index'])test(scenario==='historical'?
  'K160 original retained multipart ACK recovers both source phases after transport loss without live agreement or repeated subject write':
  scenario==='warm-index'?'K162 active original source and recipient repair lost handshake, CHANGE_REF and first/last chunk addresses then complete once':
  'K152 existing SOURCE and RECIPIENT owner tasks negotiate multipart, recover cold, apply once and confirm both original frontiers',async()=>{
  const historical=scenario==='historical',warm=scenario==='warm-index';
  const f=fixture(),r=originalRecipientTask(f),sourceCursor=()=>createT4OriginalNetworkHostCursorPort(originalCursorArgs(f,source));
  const replay=()=>createT4OriginalNetworkReplayPort({...originalCursorArgs(f,source),localNodeRef:source,scopeRef:session.scopeRef});
  let retired=false,historySignatures=0;
  // The fixture has real Ed25519 keys and the original replay CAS. The
  // original registry retirement is modeled here, not installed DB9.
  const verifyHistory=async p=>{
    historySignatures++;
    if(!await verifyOriginalNodeSignature(p))return null;
    return {schema:'IWXA_T4_ORIGINAL_HISTORICAL_SIGNATURE_V1',frameDigest:p.frameDigest,signerRef:p.signerRef,
      direction:p.sourceNodeRef===source?'LOCAL':'PEER',originalKeyCurrentlyActive:!retired,
      originalHistoricalSignatureVerified:true,originalHistoricalAcceptanceProven:false,liveNetworkAuthorityGranted:false,
      trustedSigningTimeProven:false,originalBusinessApplied:false};
  };
  const historyTransport=()=>{const p=replay();return {verifyOriginalHistoricalNodeSignature:verifyHistory,
    verifyOriginalNodeSignature:async proof=>!retired&&verifyOriginalNodeSignature(proof),
    persistOriginalReplayDecision:p.persistOriginalReplayDecision,readOriginalHistoricalReplayEvidence:p.readOriginalHistoricalReplayEvidence,
    readOriginalHistoricalAppliedAckSlot:p.readOriginalHistoricalAppliedAckSlot};};
  const t=originalSourceTask(f,{sourceCursorPort:sourceCursor,verifyOriginalRecipientApplied:r.verifyApplied,
    publicationOptions:()=>historical?{verifyOriginalHistoricalNodeSignature:verifyHistory,
      verifyOriginalNodeSignature:async p=>!retired&&verifyOriginalNodeSignature(p),
      authorizeOriginalMultipartBacking:async()=>!retired,authorizeOriginalSealedPublication:async()=>!retired}: {},
    transportOptions:()=>historical?historyTransport():{}});
  let host=t.bind(),receiver=r.bind();
  assert.equal((await host.runNativeSourceStep(t.options())).state,'INTENT_RECORDED');
  assert.equal((await host.runNativeSourceStep(t.options())).state,'HEADS_PRESENT');
  assert.equal((await host.runNativeSourceStep(t.options())).state,'WAITING_FOR_DIFF');
  assert.equal(t.seals,0);
  assert.equal((await receiver.runNativeOwnerStep(r.options())).state,'DIFF_PRESENT');
  // Test fixture supplies the existing transport agreement port with the
  // same independent live HEAD/DIFF proofs, not an invented grant.
  const sa=await readFixtureAgreement(f,source),ra=await readFixtureAgreement(f,recipient);
  assert.deepEqual(sa,ra);f.selected.set(source,sa);f.selected.set(recipient,ra);
  if(warm){
    const sp=await f.port(source).inspectOriginalPublication(),rp=await f.port(recipient).inspectOriginalPublication();
    const heads=t4NativeFrameIndexKeys(decodeT4CandidateFrame(sp.frames[0].wireBytes)),
      diffs=t4NativeFrameIndexKeys(decodeT4CandidateFrame(rp.frames[0].wireBytes));
    for(const k of [...heads,...diffs])assert.ok(f.indexes.delete(k));
    const physical=f.puts,writes=f.writes,indexWrites=f.indexWrites,n=t.signatures,m=r.signatures;
    assert.equal((await host.runNativeSourceStep(t.options())).state,'WAITING_FOR_DIFF');
    for(const k of heads)assert.equal(f.indexes.get(k),sp.frames[0].sha256);
    for(const k of diffs)assert.equal(f.indexes.has(k),false);
    assert.equal((await receiver.runNativeOwnerStep(r.options())).state,'WAITING_FOR_CHANGE');
    for(const k of diffs)assert.equal(f.indexes.get(k),rp.frames[0].sha256);
    assert.equal(f.indexWrites,indexWrites+heads.length+diffs.length);
    assert.equal(f.puts,physical);assert.equal(f.writes,writes);assert.equal(t.signatures,n);assert.equal(r.signatures,m);
  }
  assert.equal((await receiver.runNativeOwnerStep(r.options())).state,'WAITING_FOR_CHANGE');
  assert.equal(r.opens,0);assert.equal(r.writes,0);
  let step=await host.runNativeSourceStep(t.options());
  assert.equal(step.state,'CONTENT_PARTIAL');assert.equal(step.publications.length,64);
  assert.equal(step.originalMultipartAgreementDigest,sa.agreementDigest);assert.equal(t.seals,1);
  const pending=await receiver.runNativeOwnerStep(r.options());
  assert.equal(pending.state,'WAITING_FOR_CHUNKS');assert.ok(pending.step.missingMultipartChunks.length>0);
  assert.equal(pending.step.originalMultipartAgreementDigest,sa.agreementDigest);assert.equal(r.opens,0);
  assert.deepEqual(await r.cursor().readOriginalVerifiedCursor(),before);
  const n=t.signatures,first=await f.port(source).inspectOriginalPublication();
  assert.equal(first.multipartBackingReserved,true);
  host.dispose();receiver.dispose();f.restart();host=t.bind();receiver=r.bind();
  for(let i=0;i<16&&step.state==='CONTENT_PARTIAL';i++)step=await host.runNativeSourceStep(t.options());
  assert.equal(step.state,'CONTENT_PRESENT');assert.equal(step.remainingFrames,0);
  assert.equal(t.seals,1);assert.equal(t.signatures,n);
  const final=await f.port(source).inspectOriginalPublication();
  assert.equal(final.multipartPlanDigest,first.multipartPlanDigest);
  assert.deepEqual(final.frames.map(x=>x.sha256),first.frames.map(x=>x.sha256));
  assert.equal((await host.runNativeSourceStep(t.options())).state,'PUBLISHED_RECORDED');
  if(warm){
    const selected=[final.frames[1],final.frames[2],final.frames.at(-1)];
    const addresses=selected.map(e=>t4NativeFrameIndexKeys(decodeT4CandidateFrame(e.wireBytes))[0]);
    for(const k of addresses)assert.ok(f.indexes.delete(k));
    const physical=f.puts,writes=f.writes,indices=f.indexWrites;
    const firstWait=await host.runNativeSourceStep(t.options());
    assert.equal(firstWait.state,'WAITING_FOR_ACK');
    assert.equal(firstWait.originalMultipartIndexRecovery.startSequence,3);
    assert.equal(firstWait.originalMultipartIndexRecovery.repairedIndexCount,1);
    assert.equal(f.indexes.get(addresses[0]),selected[0].sha256);
    assert.equal(f.indexes.get(addresses[1]),selected[1].sha256);
    assert.equal(f.indexes.has(addresses[2]),false);
    const waiting=await receiver.runNativeOwnerStep(r.options());
    assert.equal(waiting.state,'WAITING_FOR_CHUNKS');assert.equal(r.opens,0);assert.equal(r.writes,0);
    let next=firstWait.originalMultipartIndexRecovery.nextSequence;
    while(next!==null){
      const repaired=await host.runNativeSourceStep(t.options());
      assert.equal(repaired.state,'WAITING_FOR_ACK');
      assert.equal(repaired.originalMultipartIndexRecovery.startSequence,next);
      next=repaired.originalMultipartIndexRecovery.nextSequence;
    }
    assert.equal(f.indexes.get(addresses[2]),selected[2].sha256);
    assert.equal(f.indexWrites,indices+3);assert.equal(f.puts,physical);assert.equal(f.writes,writes);
    assert.equal(t.signatures,n);assert.equal(t.seals,1);
  }else assert.equal((await host.runNativeSourceStep(t.options())).state,'WAITING_FOR_ACK');
  assert.equal((await t.phase().inspectOriginalSession()).currentPhase,'PUBLISHED');
  assert.equal((await receiver.runNativeOwnerStep(r.options())).state,'RECEIVED_RECORDED');
  assert.equal((await receiver.runNativeOwnerStep(r.options())).state,'VERIFIED_RECORDED');
  assert.equal(r.writes,0);assert.deepEqual(await r.cursor().readOriginalVerifiedCursor(),before);
  r.lose();await assert.rejects(receiver.runNativeOwnerStep(r.options()));
  assert.equal(r.writes,1);assert.deepEqual(await r.cursor().readOriginalVerifiedCursor(),before);
  receiver.dispose();f.restart();receiver=r.bind();
  const done=await receiver.runNativeOwnerStep(r.options());
  assert.equal(done.state,'RECIPIENT_CURSOR_ADVANCED');assert.equal(done.originalRecipientApplied,true);
  assert.equal(done.originalSubjectMutationInvoked,false);assert.equal(done.originalRecipientCursorAdvanced,true);
  assert.deepEqual(await r.cursor().readOriginalVerifiedCursor(),after);assert.equal(r.writes,1);
  assert.deepEqual(r.stored.bytes,new Uint8Array(assetBytes));assert.equal(r.subjectEvents.length,1);
  host.dispose();host=t.bind();
  let ack;
  if(historical){
    const selected={sourceNodeRef:recipient,sessionRef:session.sessionRef,ownerEpoch:session.ownerEpoch,messageType:'APPLIED_ACK',sequence:2};
    const found=await t.options().frameDiscoveryPort.discoverUniqueSignedFrame({selector:selected,requiredCryptoSuite:suite,
      supportedCriticalExtensions:extensions});
    assert.equal(found.state,'FOUND');
    assert.equal((await t.phase().inspectOriginalSession()).currentPhase,'PUBLISHED');
    assert.deepEqual((await sourceCursor().inspectOriginalHostCursor()).originalT3NextCursor,before);
    // Cold source loses all remote content and agreement; accepted ACK is
    // retained in the original replay Object/Event, not the fixture Map.
    const physical=f.puts,reads=f.gets,opens=r.opens,priorWrites=f.writes;
    retired=true;f.selected.clear();f.remote.clear();f.indexes.clear();f.restart();
    host.dispose();host=t.bind();
    const deny=()=>assert.fail('historical recovery called a live content operation');
    const historicOptions=()=>({...t.options(),historicalOnly:true,authorizeOriginalHistoricalCursorRecovery:allow,
      resolveOriginalSigningContext:deny,signOriginalNodeBytes:deny,readOriginalSealedContent:deny,authorizeOriginalSealedContent:deny});
    const proofPort=f.port(source,true,{verifyOriginalHistoricalNodeSignature:verifyHistory,
      authorizeOriginalMultipartBacking:deny,authorizeOriginalSealedPublication:deny,readOriginalMultipartAgreement:deny,
      verifyOriginalNodeSignature:deny});
    const proof=await proofPort.readOriginalHistoricalMultipartPublication();
    assert.equal(proof.originalAllPresentSlotsVerified,true);
    assert.equal(proof.liveNetworkAuthorityGranted,false);
    assert.equal(proof.frames.length,final.frames.length);
    assert.equal(proof.head.historicalSignature.originalKeyCurrentlyActive,false);
    const segment=[...f.objects.entries()].find(([,x])=>x.object.data.recordRole==='multipart-backing-segment');
    assert.ok(segment);
    f.objects.delete(segment[0]);
    await assert.rejects(proofPort.readOriginalHistoricalMultipartPublication(),code('PUBLICATION_MULTIPART_SEGMENT_OBJECT_MISSING'));
    f.objects.set(segment[0],segment[1]);
    await assert.rejects(host.runNativeSourceStep({...historicOptions(),authorizeOriginalHistoricalCursorRecovery:async()=>false}),
      code('CURSOR_ORIGINAL_HISTORICAL_RECOVERY_DENIED'));
    assert.equal(f.writes,priorWrites);
    const confirmed=await host.runNativeSourceStep(historicOptions());
    assert.equal(confirmed.state,'SOURCE_PHASE_HISTORICALLY_CONFIRMED');
    assert.equal(confirmed.sourceCursorAdvanced,false);
    host.dispose();host=t.bind();
    ack=await host.runNativeSourceStep(historicOptions());
    assert.equal(ack.originalHistoricalRecoveryUsed,true);
    assert.equal(f.puts,physical);assert.equal(f.gets,reads);assert.equal(r.opens,opens);
    assert.ok(historySignatures>=4);
  }else ack=await host.runNativeSourceStep(t.options());
  assert.equal(ack.state,'SOURCE_ACK_CONFIRMED');assert.equal(ack.sourceCursorAdvanced,true);
  assert.equal((await t.phase().inspectOriginalSession()).currentPhase,'APPLIED_CONFIRMED');
  assert.deepEqual((await sourceCursor().inspectOriginalHostCursor()).originalT3NextCursor,after);
  assert.equal(t.signatures,n);assert.equal(r.signatures,2);assert.equal(r.writes,1);
  host.dispose();receiver.dispose();
});
test('K152 original recipient must explicitly select signed multipart offer; disabled or unadmitted paths never sign DIFF',async()=>{
  const f=fixture(),r=originalRecipientTask(f),host=r.bind();await f.publish(source,'HEADS',headBytes);
  const disabled=await host.runNativeOwnerStep({...r.options(),enableOriginalMultipartNegotiation:false});
  assert.equal(disabled.state,'WAITING_FOR_HEADS');
  assert.equal(r.signatures,0);assert.equal(r.opens,0);assert.equal(r.writes,0);
  r.admit(false);await assert.rejects(host.runNativeOwnerStep(r.options()),code('RECIPIENT_NATIVE_ORIGINAL_ADMISSION_DENIED'));
  assert.equal(r.signatures,0);assert.equal(r.writes,0);host.dispose();
});
test('K151 original native SOURCE refuses unmarked or disabled large capture before any publication',async()=>{
  for(const [captureProfile,enabled] of [[null,true],[EXT,false]]){
    const f=fixture(),t=originalSourceTask(f,{captureProfile}),host=t.bind();
    await assert.rejects(host.runNativeSourceStep({...t.options(),enableOriginalMultipartNegotiation:enabled}),
      code('HOST_TASK_NATIVE_MULTIPART_CAPTURE_REQUIRED'));
    assert.equal(f.puts,0);assert.equal(f.writes,0);assert.equal(t.seals,0);host.dispose();
  }
});

test('K152 new recipient profile does not add an offer or change legacy DIFF bytes for a compact signed announcement',async()=>{
  const f=fixture(),r=originalRecipientTask(f),host=r.bind();
  const legacy=createT4OriginalSourceSessionHead({session,sourceCursorBefore:before,sourceCursorAfter:after});
  await f.publish(source,'HEADS',await signed(source,'HEADS',1,legacy,[HEAD_EXT]));
  const options={...r.options(),createOriginalRecipientPublicationPort:async proof=>{
    assert.equal(proof.originalMultipartOffer,undefined);return f.port(recipient,false);
  }};
  const result=await host.runNativeOwnerStep(options);
  assert.equal(result.state,'DIFF_PRESENT');assert.equal(result.step.originalMultipartAgreementDigest,undefined);
  const diff=decodeT4CandidateFrame((await f.port(recipient,false).inspectOriginalPublication()).frames[0].wireBytes);
  assert.deepEqual(diff.criticalExtensions,[]);assert.deepEqual(diff.body,{familyRef:session.familyRef,fromHeads:[session.sourcePrefixDigestBefore]});
  assert.equal(r.signatures,1);assert.equal(r.writes,0);assert.equal(r.opens,0);host.dispose();
});

test('K153 original cold migration reconciles multipart indexes in bounded pages without new frame or Kernel writes',async()=>{
  const f=fixture(),{sp}=await f.negotiate();await f.prepare(sp);
  let wake=await sp.publishOriginalMultipartFrames();while(wake.remaining)wake=await sp.publishOriginalMultipartFrames();
  const saved=await sp.inspectOriginalPublication(),count=saved.frames.length;
  assert.ok(count>64);
  const lost=[saved.frames[2],saved.frames.at(-1)];
  const addresses=lost.map(x=>t4NativeFrameIndexKeys(decodeT4CandidateFrame(x.wireBytes))[0]);
  addresses.forEach(k=>assert.ok(f.indexes.delete(k)));
  f.restart();
  const cold=f.port(source),beforeWrites=f.writes,beforePuts=f.puts;
  const root=await cold.inspectOriginalPublication({metadataOnly:true});
  assert.equal(root.originalMultipartRootMetadataOnly,true);
  assert.equal(root.frames.length,count);assert.ok(root.frames[0].wireBytes instanceof Uint8Array);
  assert.ok(root.frames.slice(1).every(x=>x.wireBytes===undefined));
  const migrate=createT4OriginalPublicationIndexMigrationStepper({
    ...session,sourceWorkspaceId:session.workspaceId,technicalWorkspaceId:'workspace:technical:'+source,localNodeRef:source,
    technicalSchemaId:T4_LEGACY_TEST_TECHNICAL_SCHEMA_ID,
    originalKernel:f.kernel,getMode:()=> 'T4_NETWORK',readOriginalHostContext:async()=>({
      workspaceId:'workspace:technical:'+source,originalWriteOwnerRef:session.originalWriteOwnerRef,nodeRef:source,
      scopeRef:session.scopeRef,hostSessionRef:f.host}),authorizeOriginalTechnicalRead:async()=>true,
    createOriginalPublicationPort:async({session:s})=>{assert.deepEqual(s,session);return f.port(source);}
  });
  const head=await migrate();
  assert.equal(head.state,'NETWORK_INDEX_MIGRATION_PROGRESS');assert.equal(head.verifiedMigratedFrameCount,1);
  assert.equal(head.pendingPublicationCount,1);assert.equal(f.indexes.has(addresses[0]),false);
  const first=await migrate();
  assert.equal(first.state,'NETWORK_INDEX_MIGRATION_PROGRESS');assert.equal(first.verifiedMigratedFrameCount,65);
  assert.equal(first.pendingPublicationCount,1);
  assert.equal(f.indexes.get(addresses[0]),lost[0].sha256);assert.equal(f.indexes.has(addresses[1]),false);
  const last=await migrate();
  assert.equal(last.state,'NETWORK_INDEX_MIGRATION_COMPLETE');assert.equal(last.verifiedMigratedFrameCount,count);
  assert.equal(last.pendingPublicationCount,0);assert.equal(f.indexes.get(addresses[1]),lost[1].sha256);
  assert.equal(await migrate(),null);assert.equal(f.writes,beforeWrites);assert.equal(f.puts,beforePuts);
  assert.deepEqual(await cold.inspectOriginalPublication(),saved);
});

test('K153 multipart index repair cannot recreate a missing PRESENT frame or bypass the original agreement',async()=>{
  const f=fixture(),{sp}=await f.negotiate();await f.prepare(sp);await sp.publishOriginalMultipartFrames({limit:2});
  const saved=await sp.inspectOriginalPublication(),frame=saved.frames[2],address=t4NativeFrameIndexKeys(decodeT4CandidateFrame(frame.wireBytes))[0];
  const writes=f.writes,puts=f.puts;
  await assert.rejects(sp.reconcileOriginalPublishedFrameIndexes({sequences:[4]}),code('PUBLICATION_INDEX_MIGRATION_PRESENT_REQUIRED'));
  f.indexes.delete(address);f.remote.delete(frame.key);
  await assert.rejects(sp.reconcileOriginalPublishedFrameIndexes({sequences:[3]}),
    error=>error.code==='PUBLICATION_INDEX_MIGRATION_OUTCOME_UNKNOWN'&&error.details.originalCode==='REMOTE_NOT_FOUND');
  assert.equal(f.indexes.has(address),false);assert.equal(f.remote.has(frame.key),false);
  f.remote.set(frame.key,new Uint8Array(frame.wireBytes));f.selected.delete(source);
  const root=await sp.inspectOriginalPublication({metadataOnly:true});
  assert.equal(root.originalMultipartRootMetadataOnly,true);
  await assert.rejects(sp.reconcileOriginalPublishedFrameIndexes({sequences:[3]}),code('MULTIPART_AGREEMENT_WITNESS_INVALID'));
  assert.equal(f.indexes.has(address),false);assert.equal(f.writes,writes);assert.equal(f.puts,puts);
});

test('K154 live agreement reader binds exact original local publication, peer receipt and Host lifetime without a selected witness cache',async()=>{
  const f=fixture(),{sp,rp,sa,ra}=await f.negotiate();f.selected.clear();
  let binding=true,localReads=0,peerReads=0;
  const readers=new Map();
  for(const node of [source,recipient]){
    const host=f.host,port=node===source?sp:rp,wire=f.transport(node);
    readers.set(node,createT4OriginalNativeMultipartAgreementReader({session,
      localRole:node===source?'SOURCE':'RECIPIENT',requiredCryptoSuite:suite,originalHostSessionRef:host,
      technicalWorkspaceId:'workspace:technical:'+node,expectedHeadSha256:sa.headSha256,
      assertOriginalOwnerBinding:async()=>binding&&f.host===host,
      readOriginalPublishedFrame:async p=>{localReads++;return port.readOriginalPublishedFrame(p);},
      discoverUniqueSignedFrame:async p=>{peerReads++;return wire.discoverUniqueSignedFrame(p);}
    }));
  }
  const request={session,originalMultipartAgreementDigest:sa.agreementDigest,originalSubjectAuthorityGranted:false};
  assert.deepEqual(await readers.get(source)(request),sa);assert.deepEqual(await readers.get(recipient)(request),ra);
  const wireProof={purpose:'inspect',originalHostNodeRef:source,originalHostScopeRef:session.scopeRef,
    originalHostSessionRef:f.host,sourceNodeRef:source,recipientNodeRef:recipient,
    sessionRef:session.sessionRef,changeId:session.changeId,scopeRef:session.scopeRef,ownerEpoch:session.ownerEpoch,cryptoSuite:suite,
    messageType:'CHUNK',originalSignedHeadAndDiffProofRequired:true,originalSubjectAuthorityGranted:false};
  assert.deepEqual(await readers.get(source)(wireProof),sa);
  assert.deepEqual(await readers.get(source)({...wireProof,sourceNodeRef:recipient,recipientNodeRef:source,messageType:'CHUNK_REQUEST'}),sa);
  assert.equal(localReads,4);assert.equal(peerReads,4);
  await assert.rejects(readers.get(source)({...wireProof,sessionRef:'session:other'}),code('MULTIPART_AGREEMENT_READER_SESSION_MISMATCH'));
  await assert.rejects(readers.get(source)({...request,session:{...session,capturedSha256:hex('other')}}),code('MULTIPART_AGREEMENT_READER_SESSION_MISMATCH'));
  await assert.rejects(readers.get(source)({...request,originalSubjectAuthorityGranted:true}),code('MULTIPART_AGREEMENT_READER_REQUEST_INVALID'));
  assert.equal(localReads,4);assert.equal(peerReads,4);
  await assert.rejects(readers.get(source)({...request,originalMultipartAgreementDigest:d('other')}),code('MULTIPART_AGREEMENT_READER_PROOF_CHANGED'));
  assert.equal(localReads,5);assert.equal(peerReads,5);
  binding=false;
  await assert.rejects(readers.get(source)(request),code('MULTIPART_AGREEMENT_READER_ORIGINAL_BINDING_CHANGED'));
  assert.equal(localReads,5);
  binding=true;f.restart();
  await assert.rejects(readers.get(source)(request),code('MULTIPART_AGREEMENT_READER_ORIGINAL_BINDING_CHANGED'));
});
test('K154 live agreement reader does not accept a missing or revoked exact signed peer proof',async()=>{
  const f=fixture(),{sp,sa}=await f.negotiate();f.selected.clear();
  const read=createT4OriginalNativeMultipartAgreementReader({session,localRole:'SOURCE',requiredCryptoSuite:suite,
    originalHostSessionRef:f.host,technicalWorkspaceId:'workspace:technical:'+source,
    assertOriginalOwnerBinding:async()=>true,readOriginalPublishedFrame:p=>sp.readOriginalPublishedFrame(p),
    discoverUniqueSignedFrame:p=>f.transport(source).discoverUniqueSignedFrame(p)});
  const request={session,originalSubjectAuthorityGranted:false};
  assert.deepEqual(await read(request),sa);
  const address=t4NativeFrameIndexKeys(decodeT4CandidateFrame(diffBytes))[0];
  assert.ok(f.indexes.delete(address));
  await assert.rejects(read(request),code('MULTIPART_AGREEMENT_READER_PEER_PROOF_REQUIRED'));
  f.indexes.set(address,hex(diffBytes));f.allow(false);
  await assert.rejects(read(request),error=>typeof error?.code==='string'&&error.code.includes('AUTHORIZATION_DENIED')||
    error?.code==='PUBLICATION_ORIGINAL_AUTHORITY_DENIED');
});

test('K155 original wake binding reads both exact published proofs without a witness cache and clears on wake completion',async()=>{
  const f=fixture(),{sp,rp,sa,ra}=await f.negotiate();f.selected.clear();
  let wake=true;
  const request={session,originalSubjectAuthorityGranted:false,originalMultipartAgreementDigest:sa.agreementDigest};
  for(const [node,port,expected] of [[source,sp,sa],[recipient,rp,ra]]){
    const binding=createT4OriginalNativeMultipartAgreementBinding({
      localRole:node===source?'SOURCE':'RECIPIENT',requiredCryptoSuite:suite,
      originalHostSessionRef:f.host,technicalWorkspaceId:'workspace:technical:'+node,
      isOriginalWakeActive:()=>wake,assertOriginalOwnerBinding:async()=>true,
      discoverUniqueSignedFrame:p=>f.transport(node).discoverUniqueSignedFrame(p)});
    await assert.rejects(binding.readOriginalMultipartAgreement(request),code('MULTIPART_AGREEMENT_BINDING_WAKE_ENDED'));
    assert.throws(()=>binding.bindOriginalPublication({session:{...session,capturedSha256:hex('other')},publication:port}),
      code('MULTIPART_AGREEMENT_BINDING_PUBLICATION_REQUIRED'));
    binding.bindOriginalPublication({session,publication:port,expectedHeadSha256:expected.headSha256});
    assert.deepEqual(await binding.readOriginalMultipartAgreement(request),expected);
    binding.clearOriginalPublication();
    await assert.rejects(binding.readOriginalMultipartAgreement(request),code('MULTIPART_AGREEMENT_BINDING_WAKE_ENDED'));
    binding.bindOriginalPublication({session,publication:port});
    wake=false;
    await assert.rejects(binding.readOriginalMultipartAgreement(request),code('MULTIPART_AGREEMENT_BINDING_WAKE_ENDED'));
    wake=true;binding.clearOriginalPublication();
  }
});
test('K155 clearing the original wake selection during an asynchronous binding check invalidates the in-flight proof',async()=>{
  const f=fixture(),{sp}=await f.negotiate();f.selected.clear();
  let entered,release;
  const pending=new Promise(resolve=>{entered=resolve;}),wait=new Promise(resolve=>{release=resolve;});
  const binding=createT4OriginalNativeMultipartAgreementBinding({
    localRole:'SOURCE',requiredCryptoSuite:suite,originalHostSessionRef:f.host,
    technicalWorkspaceId:'workspace:technical:'+source,isOriginalWakeActive:()=>true,
    assertOriginalOwnerBinding:async()=>{entered();await wait;return true;},
    discoverUniqueSignedFrame:p=>f.transport(source).discoverUniqueSignedFrame(p)});
  binding.bindOriginalPublication({session,publication:sp});
  const work=binding.readOriginalMultipartAgreement({session,originalSubjectAuthorityGranted:false});
  const denied=assert.rejects(work,code('MULTIPART_AGREEMENT_BINDING_WAKE_ENDED'));
  await pending;binding.clearOriginalPublication();release();await denied;
});

test('K157 cold native migration repairs HEADS before reading multipart backing and waits for independently restored DIFF',async()=>{
  const f=fixture(),{sp,rp}=await f.negotiate();
  await f.prepare(sp);await sp.publishOriginalMultipartFrames({limit:4});
  const saved=await sp.inspectOriginalPublication(),firstChunk=saved.frames[2],recipientSaved=await rp.inspectOriginalPublication();
  const headKeys=t4NativeFrameIndexKeys(decodeT4CandidateFrame(saved.frames[0].wireBytes)),
    diffKeys=t4NativeFrameIndexKeys(decodeT4CandidateFrame(recipientSaved.frames[0].wireBytes)),
    chunkKey=t4NativeFrameIndexKeys(decodeT4CandidateFrame(firstChunk.wireBytes))[0];
  for(const k of [...headKeys,...diffKeys,chunkKey])assert.ok(f.indexes.delete(k));
  const writes=f.writes,puts=f.puts;
  f.selected.clear();f.restart();
  function migration(node){
    const technicalWorkspaceId='workspace:technical:'+node;
    let wire;
    const binding=createT4OriginalNativeMultipartAgreementBinding({
      localRole:node===source?'SOURCE':'RECIPIENT',requiredCryptoSuite:suite,
      originalHostSessionRef:f.host,technicalWorkspaceId,isOriginalWakeActive:()=>true,
      assertOriginalOwnerBinding:async()=>true,discoverUniqueSignedFrame:p=>wire.discoverUniqueSignedFrame(p)});
    wire=f.transport(node,true,{readOriginalMultipartAgreement:binding.readOriginalMultipartAgreement});
    const step=createT4OriginalPublicationIndexMigrationStepper({...session,sourceWorkspaceId:session.workspaceId,
      technicalWorkspaceId,localNodeRef:node,technicalSchemaId:T4_LEGACY_TEST_TECHNICAL_SCHEMA_ID,
      originalKernel:f.kernel,getMode:()=> 'T4_NETWORK',readOriginalHostContext:async()=>({
        workspaceId:technicalWorkspaceId,originalWriteOwnerRef:session.originalWriteOwnerRef,nodeRef:node,
        scopeRef:session.scopeRef,hostSessionRef:f.host}),authorizeOriginalTechnicalRead:async()=>true,
      createOriginalPublicationPort:async({session:s})=>{
        assert.deepEqual(s,session);
        const port=f.port(node,true,{frameTransport:wire,...(node===source?
          {readOriginalMultipartAgreement:binding.readOriginalMultipartAgreement}:{})});
        binding.bindOriginalPublication({session:s,publication:port});return port;
      }});
    return async()=>{try{return await step();}finally{binding.clearOriginalPublication();}};
  }
  const sourceStep=migration(source),recipientStep=migration(recipient);
  const head=await sourceStep();
  assert.equal(head.state,'NETWORK_INDEX_MIGRATION_PROGRESS');assert.equal(head.verifiedMigratedFrameCount,1);
  for(const k of headKeys)assert.equal(f.indexes.get(k),saved.frames[0].sha256);
  assert.equal(f.indexes.has(chunkKey),false);
  await assert.rejects(sourceStep(),e=>e instanceof T4OriginalMultipartPeerAgreementUnavailable&&e.sessionRef===session.sessionRef);
  assert.equal(f.indexes.has(chunkKey),false);
  for(const k of diffKeys)assert.equal(f.indexes.has(k),false);
  assert.equal((await recipientStep()).state,'NETWORK_INDEX_MIGRATION_COMPLETE');
  for(const k of diffKeys)assert.equal(f.indexes.get(k),recipientSaved.frames[0].sha256);
  const done=await sourceStep();
  assert.equal(done.state,'NETWORK_INDEX_MIGRATION_COMPLETE');
  assert.equal(done.verifiedMigratedFrameCount,saved.frames.filter(x=>x.state==='PRESENT').length);
  assert.equal(f.indexes.get(chunkKey),firstChunk.sha256);
  assert.equal(f.writes,writes);assert.equal(f.puts,puts);
});

test('K161 exact original multipart ATTEMPTED recovery refuses competing index before raw PUT and resumes saved bytes after explicit grant',async()=>{
  const f=fixture(),{sp}=await f.negotiate();await f.prepare(sp);
  await sp.publishOriginalMultipartFrames({limit:1});
  const saved=(await sp.inspectOriginalPublication()).frames[2],address=t4NativeFrameIndexKeys(decodeT4CandidateFrame(saved.wireBytes))[0];
  f.losePut('before');
  await assert.rejects(sp.publishOriginalMultipartFrames({limit:1}),e=>e?.code==='PUBLICATION_NETWORK_OUTCOME_UNKNOWN'&&isT4RecoverablePublicationWakeError(e));
  assert.equal(f.remote.has(saved.key),false);
  f.restart();const p=f.port(source),attempt=(await p.inspectOriginalPublication()).frames[2];
  assert.equal(attempt.state,'ATTEMPTED');assert.equal(attempt.attempts,1);
  assert.deepEqual(attempt.wireBytes,saved.wireBytes);
  const before=f.puts,indices=f.indexWrites;
  await assert.rejects(p.publishOriginalMultipartFrames({limit:1}),e=>e?.code==='PUBLICATION_PRIOR_NETWORK_OUTCOME_UNRESOLVED'&&isT4RecoverablePublicationWakeError(e));
  assert.equal(f.puts,before);
  const denied=f.port(source,true,{authorizeOriginalFramePublish:async proof=>proof.operation!=='t4.network.publish.retry-missing'});
  await assert.rejects(denied.publishOriginalMultipartFrames({limit:1,retryMissing:true}),code('PUBLICATION_ORIGINAL_AUTHORITY_DENIED'));
  assert.equal(f.puts,before);
  f.indexes.set(address,hex('competing signed slot'));
  await assert.rejects(p.publishOriginalMultipartFrames({limit:1,retryMissing:true}),e=>
    e?.code==='PUBLICATION_NETWORK_OUTCOME_UNKNOWN'&&e.details.originalCode==='WIRE_NATIVE_INDEX_SLOT_CONFLICT'&&!isT4RecoverablePublicationWakeError(e));
  assert.equal(f.puts,before);assert.equal(f.indexWrites,indices);assert.equal(f.remote.has(saved.key),false);
  // The original immutable carrier operator removes the invalid pointer;
  // no repair/retry path itself may overwrite a competing address.
  f.indexes.delete(address);
  const repaired=await p.publishOriginalMultipartFrames({limit:1,retryMissing:true});
  assert.equal(repaired.frames[0].sha256,saved.sha256);
  assert.equal(f.puts,before+1);assert.deepEqual(f.remote.get(saved.key),saved.wireBytes);
  assert.equal(f.indexes.get(address),saved.sha256);
  const confirmed=(await p.inspectOriginalPublication()).frames[2];
  assert.equal(confirmed.state,'PRESENT');assert.equal(confirmed.attempts,3);
  assert.deepEqual(confirmed.wireBytes,saved.wireBytes);
});
test('K161 multipart lost raw PUT response recovers only original missing index and never sends signed bytes twice',async()=>{
  const f=fixture(),{sp}=await f.negotiate();await f.prepare(sp);
  await sp.publishOriginalMultipartFrames({limit:1});
  const saved=(await sp.inspectOriginalPublication()).frames[2],address=t4NativeFrameIndexKeys(decodeT4CandidateFrame(saved.wireBytes))[0];
  f.losePut('after');
  await assert.rejects(sp.publishOriginalMultipartFrames({limit:1}),e=>e?.code==='PUBLICATION_NETWORK_OUTCOME_UNKNOWN'&&isT4RecoverablePublicationWakeError(e));
  assert.deepEqual(f.remote.get(saved.key),saved.wireBytes);assert.equal(f.indexes.has(address),false);
  const before=f.puts,indices=f.indexWrites;f.restart();
  const recovered=await f.port(source).publishOriginalMultipartFrames({limit:1});
  assert.equal(recovered.frames[0].state,'REMOTE_READBACK_RECOVERED');
  assert.equal(f.puts,before);assert.equal(f.indexWrites,indices+1);assert.equal(f.indexes.get(address),saved.sha256);
  const confirmed=(await f.port(source).inspectOriginalPublication()).frames[2];
  assert.equal(confirmed.state,'PRESENT');assert.equal(confirmed.attempts,1);
});

test('K162 healthy address pages do not reread selected backing; exact conflicts, denied migration, missing raw bytes and retired authority fail closed',async()=>{
  const f=fixture(),{sp}=await f.negotiate();await f.prepare(sp);
  let wake=await sp.publishOriginalMultipartFrames();while(wake.remaining)wake=await sp.publishOriginalMultipartFrames();
  const saved=await sp.inspectOriginalPublication(),a=saved.frames[2],b=saved.frames[3];
  const ka=t4NativeFrameIndexKeys(decodeT4CandidateFrame(a.wireBytes))[0],kb=t4NativeFrameIndexKeys(decodeT4CandidateFrame(b.wireBytes))[0];
  const deny=()=>assert.fail('healthy metadata page must not reconstruct or authorize content');
  const probe=f.port(source,true,{authorizeOriginalMultipartBacking:deny,authorizeOriginalSealedPublication:deny,
    readOriginalMultipartAgreement:deny,verifyOriginalNodeSignature:deny});
  const physical=f.puts,writes=f.writes,indices=f.indexWrites;
  const healthy=await probe.reconcileOriginalMultipartIndexPage({startSequence:3,limit:32});
  assert.equal(healthy.checkedFrameCount,32);assert.equal(healthy.repairedIndexCount,0);
  assert.equal(healthy.healthyIndexIsNotContentReadback,true);
  f.indexes.delete(ka);f.indexes.set(kb,hex('conflict'));
  await assert.rejects(sp.reconcileOriginalMultipartIndexPage({startSequence:3,limit:2}),code('WIRE_NATIVE_INDEX_SLOT_CONFLICT'));
  assert.equal(f.indexes.has(ka),false);assert.equal(f.indexWrites,indices);
  f.indexes.set(kb,b.sha256);
  const denied=f.port(source,true,{authorizeOriginalFramePublish:async p=>p.operation!=='t4.network.publish.index.migrate'});
  await assert.rejects(denied.reconcileOriginalMultipartIndexPage({startSequence:3,limit:2}),code('PUBLICATION_ORIGINAL_AUTHORITY_DENIED'));
  assert.equal(f.indexes.has(ka),false);
  f.remote.delete(a.key);
  await assert.rejects(sp.reconcileOriginalMultipartIndexPage({startSequence:3,limit:2}),
    e=>e?.code==='PUBLICATION_INDEX_MIGRATION_OUTCOME_UNKNOWN'&&e.details.originalCode==='REMOTE_NOT_FOUND');
  assert.equal(f.indexes.has(ka),false);assert.equal(f.remote.has(a.key),false);
  f.remote.set(a.key,a.wireBytes);f.selected.delete(source);
  await assert.rejects(sp.reconcileOriginalMultipartIndexPage({startSequence:3,limit:2}),code('MULTIPART_AGREEMENT_WITNESS_INVALID'));
  assert.equal(f.indexes.has(ka),false);
  assert.equal(f.puts,physical);assert.equal(f.writes,writes);assert.equal(f.indexWrites,indices);
});
test('K163 original terminal retirement between bounded migration wakes restarts inventory without repairing retired content',async()=>{
  const f=fixture(),{sp}=await f.negotiate();await f.prepare(sp);
  await sp.publishOriginalMultipartFrames({limit:4});
  const saved=await sp.inspectOriginalPublication(),slot=saved.frames[2],index=t4NativeFrameIndexKeys(decodeT4CandidateFrame(slot.wireBytes))[0];
  const phase=createT4OriginalNetworkSessionPhasePort({...session,technicalWorkspaceId:'workspace:technical:'+source,
    localNodeRef:source,originalKernel:f.kernel,getMode,
    readOriginalHostContext:async()=>({workspaceId:'workspace:technical:'+source,originalWriteOwnerRef:session.originalWriteOwnerRef,
      nodeRef:source,scopeRef:session.scopeRef,hostSessionRef:f.host}),authorizeOriginalTechnicalRead:allow,
    authorizeOriginalTechnicalWrite:allow,verifyOriginalPhaseEvidence:allow,verifyOriginalRecipientApplied:async()=>false,
    authorizeOriginalSourceSupersession:allow});
  const inspect=async({session:s})=>{
    const status=await phase.inspectOriginalRetiredAttempt();
    return status===null?null:{...requireT4OriginalRetiredAttemptStatus(status,s,'SOURCE',phase.checkpointRef),
      sessionRef:s.sessionRef,changeId:s.changeId,role:'SOURCE'};
  };
  const migrate=createT4OriginalPublicationIndexMigrationStepper({...session,sourceWorkspaceId:session.workspaceId,
    technicalWorkspaceId:'workspace:technical:'+source,localNodeRef:source,technicalSchemaId:T4_LEGACY_TEST_TECHNICAL_SCHEMA_ID,
    originalKernel:f.kernel,getMode,readOriginalHostContext:async()=>({workspaceId:'workspace:technical:'+source,
      originalWriteOwnerRef:session.originalWriteOwnerRef,nodeRef:source,scopeRef:session.scopeRef,hostSessionRef:f.host}),
    authorizeOriginalTechnicalRead:allow,inspectOriginalRetiredAttempt:inspect,createOriginalPublicationPort:async()=>f.port(source)});
  const first=await migrate();assert.equal(first.state,'NETWORK_INDEX_MIGRATION_PROGRESS');
  assert.equal(first.verifiedMigratedFrameCount,1);
  const initial=await phase.inspectOriginalSession();
  const plan=prepareT4OriginalSupersessionControl({session,expectedPhaseRevision:0,
    expectedPhaseChainHash:d('recipient genesis'),decisionRef:'decision:k163',requestRef:'request:k163'});
  const retired=await phase.recordOriginalSourceSupersession({expectedRevision:initial.revision,expectedChainHash:initial.chainHash,
    retirementAckDigest:d('retirement ack fixture'),retirement:{...plan.claim.body,
      retirementCheckpointRef:'t4:net:session:recipient-fixture',retirementRevision:1,
      retirementChainHash:d('recipient retired'),retirementEventId:'event:k163:retired'}});
  f.indexes.delete(index);f.selected.clear();
  const physical=f.puts,writes=f.writes,indices=f.indexWrites,reads=f.gets;
  const restart=await migrate();assert.equal(restart.originalRetirementRestartRequired,true);
  assert.equal(restart.originalSupersessionEventId,retired.originalSupersessionEventId);
  const done=await migrate();assert.equal(done.state,'NETWORK_INDEX_MIGRATION_COMPLETE');
  assert.equal(done.skippedRetiredPublicationCount,1);assert.equal(done.verifiedMigratedFrameCount,0);
  assert.equal(f.indexes.has(index),false);assert.equal(f.puts,physical);assert.equal(f.writes,writes);
  assert.equal(f.indexWrites,indices);assert.equal(f.gets,reads);
});

import {deriveT4OriginalReplacementSessionCandidate,createT4OriginalReplacementSourceHead,readT4OriginalReplacementSourceHead}
  from '../src/network/original-network-publication.mjs';
import {T4_REPLACEMENT_SOURCE_SESSION_EXTENSION as REPL_EXT,verifyT4CandidateOutboundSignature}
  from '../src/network/standard-network-wire-candidate.mjs';
import {createT4OriginalMultipartBacking,readT4OriginalMultipartBacking,
  validateT4OriginalMultipartBackingPlan,verifyT4OriginalMultipartBackingSignatures}
  from '../src/network/original-network-publication-multipart-backing.mjs';

async function replacementMultipartFixture(){
  // Terminal phase records are modeled here. This test deliberately verifies
  // candidate structure and signatures, not owner admission or terminal CAS.
  const replacement={previousSessionRef:session.sessionRef,changeId:session.changeId,
    decisionDigest:d('replacement decision'),sourcePhaseRef:'phase:source',
    sourcePhaseEventId:'event:source:retired',sourcePhaseRevision:2,sourcePhaseChainHash:d('source retired'),
    recipientPhaseRef:'phase:recipient',recipientPhaseEventId:'event:recipient:retired',
    recipientPhaseRevision:1,recipientPhaseChainHash:d('recipient retired')};
  const candidate=deriveT4OriginalReplacementSessionCandidate({originalCaptureSession:session,replacement});
  const body=createT4OriginalReplacementSourceHead({candidate,sourceCursorBefore:before,sourceCursorAfter:after,offerMultipart:true});
  const head=await signed(source,'HEADS',1,body,[REPL_EXT,AGREEMENT_EXT],{sessionRef:candidate.sessionRef});
  const selection={familyRef:candidate.familyRef,fromHeads:[candidate.sourcePrefixDigestBefore],
    multipartSelection:createT4NativeMultipartSelection({offer:body.multipartOffer,headSha256:hex(head)})};
  const diff=await signed(recipient,'DIFF_REQUEST',1,selection,[AGREEMENT_EXT],{sessionRef:candidate.sessionRef});
  return {candidate,replacement,body,head,diff,selection};
}
test('K164 replacement HEAD and exact DIFF negotiate only for the signed successor identity',async()=>{
  const {candidate,replacement,body,head,diff,selection}=await replacementMultipartFixture();
  assert.notEqual(candidate.sessionRef,session.sessionRef);
  assert.equal(candidate.changeId,session.changeId);
  const read=readT4OriginalReplacementSourceHead({identity:session,body:decodeT4CandidateFrame(head).body,
    sessionRef:candidate.sessionRef,sourceCursorBefore:before,expectedCandidate:candidate});
  assert.deepEqual(read.candidate,candidate);
  assert.deepEqual(read.multipartOffer,createT4NativeMultipartOffer());
  assert.equal(read.liveNetworkAuthorityGranted,false);
  assert.equal(read.originalNewAttemptAdmissionStillRequired,true);
  const compact=createT4OriginalReplacementSourceHead({candidate,sourceCursorBefore:before,sourceCursorAfter:after});
  assert.equal(Object.hasOwn(compact,'multipartOffer'),false);
  assert.deepEqual(readT4OriginalReplacementSourceHead({identity:session,body:compact,sessionRef:candidate.sessionRef}).candidate,candidate);
  await assert.rejects(signed(source,'HEADS',1,body,[REPL_EXT,AGREEMENT_EXT]),code('WIRE_REPLACEMENT_HEAD_IDENTITY_MISMATCH'));
  await assert.rejects(signed(source,'HEADS',1,body,[HEAD_EXT,REPL_EXT,AGREEMENT_EXT],{sessionRef:candidate.sessionRef}));
  const f=fixture();
  f.inject(head);f.inject(diff);
  const discover=(node,type,remote)=>f.transport(node).discoverUniqueSignedFrame({
    selector:{sourceNodeRef:remote,sessionRef:candidate.sessionRef,ownerEpoch:candidate.ownerEpoch,messageType:type,sequence:1},
    requiredCryptoSuite:suite,supportedCriticalExtensions:[REPL_EXT,AGREEMENT_EXT]});
  const h=await discover(recipient,'HEADS',source),df=await discover(source,'DIFF_REQUEST',recipient);
  assert.equal(h.state,'FOUND');assert.equal(df.state,'FOUND');
  // The receiver proofs above come from the actual wire trust path. The
  // PRESENT anchors below are fixtures, not claimed original owner writes.
  const outbound=async(p,bytes,node)=>{
    const signature=await verifyT4CandidateOutboundSignature({wireBytes:bytes,verifyOriginalNodeSignature});
    assert.equal(signature.originalSignatureVerified,true);
    return {...p,schema:'IWXA_T4_ORIGINAL_OUTBOUND_FRAME_PROOF_V1',
      originalT3PublicationEventChainVerified:true,originalOutboundSignatureVerified:true,
      originalOutboundAuthorityVerified:true,originalImmutableTransportReadbackVerified:true,
      checkpointRef:'checkpoint:'+node,originalPresentEventId:'event:present:'+node,
      originalPresentRevision:3,originalPresentChainHash:d(node),remoteReceiptProven:false};
  };
  const sh=await outbound(h.receipt,head,source),rd=await outbound(df.receipt,diff,recipient);
  const a=agreement({session:candidate,sourceHead:sh,recipientDiff:df.receipt,localRole:'SOURCE',requiredCryptoSuite:suite});
  const r=agreement({session:candidate,sourceHead:h.receipt,recipientDiff:rd,localRole:'RECIPIENT',requiredCryptoSuite:suite});
  assert.deepEqual(a,r);assert.equal(a.originalSubjectAuthorityGranted,false);
  assert.deepEqual(validate({agreement:a,session:candidate,headSha256:hex(head)}),a);
  assert.throws(()=>validate({agreement:a,session}),code('MULTIPART_AGREEMENT_SESSION_MISMATCH'));
  const other=deriveT4OriginalReplacementSessionCandidate({originalCaptureSession:session,
    replacement:{...replacement,sourcePhaseEventId:'event:source:different'}});
  assert.throws(()=>agreement({session:other,sourceHead:sh,recipientDiff:df.receipt,localRole:'SOURCE',requiredCryptoSuite:suite}),
    code('MULTIPART_AGREEMENT_HEAD_MISMATCH'));
  assert.throws(()=>agreement({session:candidate,sourceHead:sh,recipientDiff:{...df.receipt,
    verifiedBody:{...selection,multipartSelection:createT4NativeMultipartSelection({offer:body.multipartOffer,headSha256:hex(headBytes)})}},
    localRole:'SOURCE',requiredCryptoSuite:suite}),code('MULTIPART_AGREEMENT_DIFF_MISMATCH'));
  assert.equal(f.puts,0);assert.equal(f.writes,0);
});
test('K164 replacement multipart backing is bound to its exact successor HEAD and never grants publication',async()=>{
  const {candidate,replacement,head}=await replacementMultipartFixture();
  const technicalWorkspaceId='workspace:technical:'+source;
  const checkpointRef='t4:net:publish:'+identityDigest('PUBLICATION-KEY',{sessionRef:candidate.sessionRef,localNodeRef:source,technicalWorkspaceId});
  const input={session:candidate,technicalWorkspaceId,checkpointRef,
    rootAnchor:{revision:3,chainHash:d('root'),presentEventId:'event:replacement:head',headSha256:hex(head)},headWireBytes:head};
  const wireBytes=await Promise.all(payload.frames.map(w=>{const frame=decodeT4CandidateFrame(w);
    return signed(source,frame.messageType,frame.sequence,frame.body,[EXT],{sessionRef:candidate.sessionRef});}));
  const backing=createT4OriginalMultipartBacking({...input,wireBytes});
  assert.equal(backing.originalRootReservationRequired,true);
  assert.equal(backing.originalPublicationStateCreated,false);
  assert.equal(backing.originalBusinessApplied,false);
  assert.deepEqual(validateT4OriginalMultipartBackingPlan({...input,plan:backing.plan}),backing.plan);
  const proof=await verifyT4OriginalMultipartBackingSignatures({...input,plan:backing.plan,segments:backing.segments,verifyOriginalNodeSignature});
  assert.deepEqual(proof.wireBytes.map(hex),wireBytes.map(hex));
  assert.equal(proof.originalObjectEventReadbackVerified,false);
  assert.equal(proof.originalPublicationStateCreated,false);
  const other=deriveT4OriginalReplacementSessionCandidate({originalCaptureSession:session,
    replacement:{...replacement,recipientPhaseEventId:'event:recipient:different'}});
  assert.throws(()=>readT4OriginalMultipartBacking({...input,session:other,plan:backing.plan,segments:backing.segments}),
    code('MULTIPART_BACKING_HEAD_MISMATCH'));
  assert.throws(()=>createT4OriginalMultipartBacking({...input,wireBytes:payload.frames}),code('MULTIPART_BACKING_ROUTE_MISMATCH'));
  const compact=createT4OriginalReplacementSourceHead({candidate,sourceCursorBefore:before,sourceCursorAfter:after});
  const compactHead=await signed(source,'HEADS',1,compact,[REPL_EXT],{sessionRef:candidate.sessionRef});
  assert.throws(()=>createT4OriginalMultipartBacking({...input,headWireBytes:compactHead,
    rootAnchor:{...input.rootAnchor,headSha256:hex(compactHead)},wireBytes}),code('MULTIPART_BACKING_HEAD_MISMATCH'));
});
