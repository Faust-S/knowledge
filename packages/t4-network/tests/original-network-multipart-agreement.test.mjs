import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign,verify,createCipheriv,createDecipheriv} from 'node:crypto';
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
import {createT4OriginalSourceSessionHead,readT4OriginalSourceSessionHead,createT4OriginalNetworkPublicationPort}
  from '../src/network/original-network-publication.mjs';
import {readT4OriginalNativeMultipartAgreement as agreement,validateT4OriginalNativeMultipartAgreement as validate}
  from '../src/network/original-network-multipart-agreement.mjs';
import {createT4CandidateFrameTransport} from '../src/network/standard-network-wire-transport.mjs';
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
const assetBytes=Buffer.alloc(450000,37);
const asset=verifyT4OriginalAssetDelta({schema:'IWXA_T4_ORIGINAL_ASSET_DELTA_V1',
  workspaceId:family.workspaceId,originalWriteOwnerRef:family.originalWriteOwnerRef,assetId:'asset:1',objectId:'object:1',
  mime:'application/octet-stream',baseRevision:1,sourceRevision:2,sourceEventId:key.sourceEventId,
  sourceEventDigest:capture.window.eventRefs[0].eventDigest,windowDigest:capture.window.windowDigest,
  originalEventType:originalEvents[1].event_type,bytesBase64:assetBytes.toString('base64'),assetBytesSha256:hex(assetBytes),assetSize:assetBytes.length});
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
  let puts=0,host='host:1',allow=true,writes=0;
  const kernel={hasOperation:op=>['t1.getObject','t1.listEventsSince','t1.putObject'].includes(op),
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
    async putSnapshot({key,bytes,expectedSha256,createOnly}){
      assert.equal(createOnly,true);assert.equal(hex(bytes),expectedSha256);assert.equal(key,expectedSha256+'.t4n');puts++;
      const seen=remote.has(key);if(seen)assert.deepEqual(remote.get(key),bytes);else remote.set(key,new Uint8Array(bytes));
      return {key,sha256:expectedSha256,state:seen?'ALREADY_PRESENT_VERIFIED':'PUBLISHED_AND_READ_BACK'};
    },
    async getSnapshot({key,expectedSha256}){const bytes=remote.get(key);
      if(!bytes)throw Object.assign(Error('missing'),{code:'REMOTE_NOT_FOUND'});assert.equal(hex(bytes),expectedSha256);return {bytes:new Uint8Array(bytes)};},
    async inspectOutcome({key,expectedSha256}){await this.getSnapshot({key,expectedSha256});return {state:'EXPECTED_BYTES_PRESENT',key,sha256:expectedSha256};},
    async getNativeFrameIndex({key}){return indexes.has(key)?idx(key,indexes.get(key)):null;},
    async putNativeFrameIndex({key,frameSha256}){if(indexes.has(key)&&indexes.get(key)!==frameSha256)
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
  return {objects,events,remote,indexes,replay,selected,transport,port,publish,negotiate,prepare,inject,
    get puts(){return puts;},get writes(){return writes;},restart:()=>{host='host:2';},allow:x=>{allow=x;}};
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
    assetBytesSha256:hex(Buffer.alloc(assetBytes.length,21))}):asset;
  const plan=await contentPlan(17,seal(original.bytes));await f.prepare(sp,plan);
  let pending=await sp.publishOriginalMultipartFrames({limit:64});while(pending.remainingFrames>0)pending=await sp.publishOriginalMultipartFrames({limit:64});
  // Explicitly recover from the original publication journal, not a saved in-memory plan.
  await f.port(source).publishOriginalMultipartFrames({limit:64});
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
