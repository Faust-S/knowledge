import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign,verify} from 'node:crypto';
import {createT4CandidateUnsignedFrame,signT4CandidateFrame,decodeT4CandidateFrame}
  from '../src/network/standard-network-wire-candidate.mjs';
import {prepareT4CandidateOpaqueChunks}
  from '../src/network/standard-network-opaque-chunks.mjs';
import {readT4OriginalEventWindow} from '../src/network/original-event-window.mjs';
import {createT4OriginalNetworkSessionPhasePort} from '../src/network/original-network-session-phases.mjs';
import {createT4CandidateFrameTransport}
  from '../src/network/standard-network-wire-transport.mjs';
import {deriveT4OriginalNativeCaptureSession,createT4OriginalNetworkPublicationPort,readT4OriginalPublicationMigrationInventory}
  from '../src/network/original-network-publication.mjs';
import {T4_LEGACY_TEST_TECHNICAL_SCHEMA_ID} from '../src/network/original-network-technical-schema.mjs';
import {createT4OriginalHostDispatchTaskBinding}
  from '../src/network/original-host-dispatch-task-binding.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
const H=x=>'sha256:'+hash(x);
const ws='original:subject:one',technical='original:technical:one',
  owner='original:owner:one',source='node:original:source',
  recipient='node:original:recipient',scope='scope:original',
  suite='X25519_AES256GCM_ED25519',eventId='event:original:two';
const keys=generateKeyPairSync('ed25519'),peerKeys=generateKeyPairSync('ed25519');
const err=code=>e=>e?.code===code;
function task(){
  const w={lastEventId:eventId,windowDigest:H('captured-window'),
    eventRefs:[{eventDigest:H('source-event')}],
    sourcePrefixDigestBefore:H('before'),sourcePrefixDigestAfter:H('after')};
  return {schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_OUTBOX_TASK_V1',
    state:'ORIGINAL_NATIVE_CAPTURE_READY',workspaceId:ws,originalWriteOwnerRef:owner,
    networkTargetRef:recipient,sourceNodeRef:source,recipientNodeRef:recipient,
    scopeRef:scope,ownerEpoch:2,originalHostFrontierRevision:1,
    sourceCursorBefore:{sourcePrefixDigest:w.sourcePrefixDigestBefore},
    sourceCursorAfter:{sourcePrefixDigest:w.sourcePrefixDigestAfter},
    networkPublished:false,originalRecipientApplied:false,
    sourceCursorAdvanced:false,recipientCursorAdvanced:false,
    originalSubjectMutationInvoked:false,
    capture:{workspaceId:ws,originalWriteOwnerRef:owner,
      sourceEventId:eventId,sourceRevision:2,
      sourceWindow:w,originalIntentEventAndCanonicalBytesVerified:true,
      capturedWindowDigestVerified:true,
      prepared:{sha256:hash('captured'),delta:{sourceEventId:eventId,
        sourceRevision:2,sourceEventDigest:w.eventRefs[0].eventDigest,
        windowDigest:w.windowDigest}}},
  };
}
const headsSlots=[{sequence:1,messageType:'HEADS'}];
function fixture(data=task(),{indexed=false,initialLegacy=false}={}){
  const session=deriveT4OriginalNativeCaptureSession(data);
  const objects=new Map(),events=[],remote=new Map(),replay=new Map(),indexes=new Map();
  let putCalls=0,networkCalls=0,signCalls=0,reads=0,
    loseAction=null,loseNetwork=null,host='host:initial',network=true,allow=true,retryAllowed=true,
    afterNetworkPut=()=>{},indexCalls=0,loseIndex=null,indexRepairAllowed=true,indexMigrationAllowed=true;
  const kernel={
    hasOperation:op=>['t1.getObject','t1.listObjects','t1.listEventsSince','t1.putObject'].includes(op),
    async listObjects(q){return structuredClone([...objects.values()].map(r=>r.object).filter(o=>o.workspace_id===q.workspace_id));},
    async getObject(w,id){reads++;return structuredClone(objects.get(w+':'+id)??null);},
    async listEventsSince(w){return structuredClone(events.filter(e=>e.workspace_id===w));},
    async putObject(input){
      putCalls++;
      const key=input.workspace_id+':'+input.object_id;
      const prior=objects.get(key)?.object;
      if(input.base_revision!==(prior?.revision??0))
        throw Object.assign(Error('CAS'),{code:'REVISION_CONFLICT'});
      const object={workspace_id:input.workspace_id,object_id:input.object_id,
        schema_id:input.schema_id,schema_version:input.schema_version,
        revision:input.base_revision+1,deleted:false,
        data:structuredClone(input.data),extensions:{}};
      const event={event_id:'event:technical:'+putCalls,workspace_id:input.workspace_id,
        object_id:input.object_id,revision:object.revision,event_type:input.event.event_type,
        payload:structuredClone(input.event.payload)};
      objects.set(key,{object});events.push(event);
      if(loseAction===event.payload.action){
        loseAction=null;throw Object.assign(Error('lost T3 response'),{code:'ACK_LOST'});
      }
      return {object,event};
    },
  };
  const transport={
    wireKind:'T4_NETWORK_CANDIDATE',
    forOriginalHostLifetime(isActive){
      const source=this;
      const check=()=>{if(isActive()!==true)throw Object.assign(Error('original Host ended'),{code:'ORIGINAL_HOST_LIFETIME_ENDED'});};
      return {...source,async putSnapshot(args){check();const result=await source.putSnapshot(args);check();return result;},
        async getSnapshot(args){check();const result=await source.getSnapshot(args);check();return result;},
        async inspectOutcome(args){check();const result=await source.inspectOutcome(args);check();return result;}};
    },
    async putSnapshot({key,bytes,expectedSha256,createOnly}){
      networkCalls++;
      assert.equal(createOnly,true);
      assert.equal(key,hash(bytes)+'.t4n');
      assert.equal(expectedSha256,hash(bytes));
      if(loseNetwork==='before'){
        loseNetwork=null;throw Object.assign(Error('offline'),{code:'NETWORK_UNAVAILABLE'});
      }
      const already=remote.has(key);
      if(already)assert.deepEqual(Buffer.from(bytes),remote.get(key));
      else remote.set(key,Buffer.from(bytes));
      afterNetworkPut();
      if(loseNetwork==='after'){
        loseNetwork=null;throw Object.assign(Error('lost remote response'),{code:'OUTCOME_UNKNOWN'});
      }
      return {key,sha256:expectedSha256,state:already?'ALREADY_PRESENT_VERIFIED':'PUBLISHED_AND_READ_BACK'};
    },
    async listNativeFrameAddresses(){
      const addresses=[...remote.keys()].sort().map(key=>({key,sha256:key.slice(0,-4)}));
      return {schema:'IWXA_T4_NATIVE_FRAME_ADDRESS_LIST_V1',addresses,
        listingDigest:hash('IWXA-T4-FRAME-ADDRESS-LIST-V1\0'+JSON.stringify(addresses.map(a=>a.key))),
        collectionEnumerated:true,addressMetadataIsNotSignatureOrAuthority:true,
        originalBusinessApplied:false};
    },
    async getSnapshot({key,expectedSha256}){
      if(!remote.has(key))throw Object.assign(Error('missing'),{code:'REMOTE_NOT_FOUND'});
      const bytes=remote.get(key);
      assert.equal(hash(bytes),expectedSha256);
      return {bytes:new Uint8Array(bytes)};
    },
    async inspectOutcome({key,expectedSha256}){
      await this.getSnapshot({key,expectedSha256});
      return {key,sha256:expectedSha256,state:'EXPECTED_BYTES_PRESENT'};
    },
  };
  if(indexed){
    const indexReceipt=(key,frameSha256)=>({schema:'IWXA_T4_NATIVE_FRAME_INDEX_READ_V1',key,frameSha256,
      addressMetadataIsNotSignatureOrAuthority:true,originalBusinessApplied:false});
    Object.assign(transport,{nativeFrameIndexVersion:initialLegacy?0:1,
      async getNativeFrameIndex({key}){return indexes.has(key)?indexReceipt(key,indexes.get(key)):null;},
      async putNativeFrameIndex({key,frameSha256}){
        indexCalls++;
        if(loseIndex==='before'){loseIndex=null;throw Object.assign(Error('lost index write'),{code:'NETWORK_UNAVAILABLE'});}
        if(indexes.has(key)&&indexes.get(key)!==frameSha256)
          throw Object.assign(Error('index conflict'),{code:'REMOTE_INDEX_SLOT_CONFLICT'});
        indexes.set(key,frameSha256);
        if(loseIndex==='after'){loseIndex=null;throw Object.assign(Error('lost index response'),{code:'OUTCOME_UNKNOWN'});}
        return indexReceipt(key,frameSha256);
      },
    });
  }
  const mode=()=>network?'T4_NETWORK':'LOCAL_T3';
  const auth=async()=>allow;
  const makeTransport=node=>createT4CandidateFrameTransport({
    wireTransport:transport,originalHostNodeRef:node,originalHostScopeRef:scope,
    getMode:mode,readOriginalHostContext:async()=>({
      nodeRef:node,scopeRef:scope,originalOwnerRef:owner,hostSessionRef:host,
    }),authorizeOriginalHostWire:auth,verifyOriginalNodeSignature:async p=>
      p.signerRef===(p.sourceNodeRef===source?'key:source':'key:recipient')&&
      verify(null,Buffer.from(p.bytes),p.sourceNodeRef===source?keys.publicKey:peerKeys.publicKey,
        Buffer.from(p.signature)),
    authorizeOriginalNetwork:auth,persistOriginalReplayDecision:async p=>{
      const key=[node,p.sourceNodeRef,p.sessionRef,p.ownerEpoch,p.sequence].join(':');
      const old=replay.get(key);
      if(old!==undefined)return old===p.frameDigest?'SEEN_EXACT':'CONFLICT';
      replay.set(key,p.frameDigest);return 'RECORDED';
    },
  });
  function port(node=source,identity=session){
    return createT4OriginalNetworkPublicationPort({
      session:identity,localNodeRef:node,technicalWorkspaceId:technical,
      originalKernel:kernel,getMode:mode,
      readOriginalHostContext:async()=>({workspaceId:technical,
        originalWriteOwnerRef:owner,nodeRef:node,scopeRef:scope,hostSessionRef:host}),
      authorizeOriginalTechnicalRead:auth,authorizeOriginalTechnicalWrite:auth,
      authorizeOriginalFramePublish:async p=>allow&&
        (p.operation!=='t4.network.publish.retry-missing'||retryAllowed)&&
        (p.operation!=='t4.network.publish.index.repair'||indexRepairAllowed)&&
        (p.operation!=='t4.network.publish.index.migrate'||indexMigrationAllowed),
      verifyOriginalNodeSignature:async({bytes,signature,signerRef})=>
        signerRef===(node===source?'key:source':'key:recipient')&&
        verify(null,Buffer.from(bytes),node===source?keys.publicKey:peerKeys.publicKey,
          Buffer.from(signature)),
      frameTransport:makeTransport(node),
    });
  }
  async function signed(messageType,sequence,body,node=source,overrides={}){
    signCalls++;
    return signT4CandidateFrame({
      unsignedFrame:createT4CandidateUnsignedFrame({
        messageType,messageId:'message:'+node+':'+sequence,
        sourceNodeRef:node,recipientNodeRef:node===source?recipient:source,
        scopeRef:scope,sessionRef:session.sessionRef,ownerEpoch:2,
        permissionRef:'permission:original',signerRef:node===source?'key:source':'key:recipient',
        sequence,cryptoSuite:suite,body,...overrides,
      }),
      signOriginalNodeBytes:async({bytes})=>sign(null,Buffer.from(bytes),
        node===source?keys.privateKey:peerKeys.privateKey),
    });
  }
  const heads=()=>signed('HEADS',1,{familyRef:session.familyRef,ownerEpoch:2,
    heads:[session.sourcePrefixDigestAfter]});
  const stageHeads=()=>port().prepareSignedBatch({slots:headsSlots,
    createSignedFrames:async()=>[await heads()]});
  async function changeBatch(){
    const chunkPlan=await prepareT4CandidateOpaqueChunks({
      changeId:session.changeId,ownerRef:owner,sourceContentRef:'sealed:original',
      getMode:mode,authorizeOriginalSealedContent:auth,
      readOriginalSealedContent:async()=>({ciphertext:Buffer.from('sealed example content'),
        encryptionContextRef:'sealed:epoch:2'}),chunkBytes:8,
    });
    const frames=[await signed('CHANGE_REF',2,{
      changeId:session.changeId,changeKind:'OBJECT_PUT',eventRef:eventId,
      ownerRef:owner,sourceRevision:2,contentDigest:chunkPlan.contentDigest,
      parents:[session.sourcePrefixDigestBefore],
    })];
    for(const [i,body] of chunkPlan.bodies.entries())
      frames.push(await signed('CHUNK',i+3,body));
    return {frames,slots:frames.map(b=>{const f=decodeT4CandidateFrame(b);
      return {sequence:f.sequence,messageType:f.messageType};})};
  }
  const binding=(overrides={})=>createT4OriginalHostDispatchTaskBinding({
    expectedWorkspaceId:ws,expectedOriginalWriteOwnerRef:owner,
    expectedNetworkTargetRef:recipient,getMode:mode,
    readOriginalHostContext:async()=>({workspaceId:ws,originalWriteOwnerRef:owner,
      networkTargetRef:recipient,hostSessionRef:host}),
    authorizeOriginalHostTask:auth,
    dispatcher:{drain:async()=>{throw Error('legacy route forbidden');},
      prepareNextNativeObject:async()=>structuredClone(data)},
    createOriginalNativePublicationPort:async({session:s})=>{
      assert.deepEqual(s,session);return port();
    },...overrides,
  });
  return {data,session,objects,events,remote,port,heads,stageHeads,changeBatch,signed,binding,
    kernel,mode,auth,makeTransport,replay,indexes,host:()=>host,
    counts:()=>({putCalls,networkCalls,signCalls,reads}),
    loseCAS:action=>{loseAction=action;},loseNetwork:where=>{loseNetwork=where;},
    indexCalls:()=>indexCalls,loseIndex:where=>{loseIndex=where;},
    denyIndexRepair:()=>{indexRepairAllowed=false;},allowIndexRepair:()=>{indexRepairAllowed=true;},
    enableIndexed:()=>{assert.equal(indexed,true);transport.nativeFrameIndexVersion=1;},
    denyIndexMigration:()=>{indexMigrationAllowed=false;},allowIndexMigration:()=>{indexMigrationAllowed=true;},
    restart:()=>{host='host:cold:'+putCalls;},local:()=>{network=false;},
    revoke:()=>{allow=false;},denyRetry:()=>{retryAllowed=false;},
    onNetworkPut:fn=>{afterNetworkPut=fn;}};
}
test('deterministic session binds exact original Event and peer, not process-local randomness',()=>{
  const f=fixture();
  assert.deepEqual(deriveT4OriginalNativeCaptureSession(structuredClone(f.data)),f.session);
  const forged=structuredClone(f.data);forged.capture.prepared.sha256=hash('other bytes');
  const conflict=deriveT4OriginalNativeCaptureSession(forged);
  assert.equal(conflict.sessionRef,f.session.sessionRef);
  assert.notEqual(conflict.capturedSha256,f.session.capturedSha256);
  const other=structuredClone(f.data);other.recipientNodeRef='node:other';
  other.networkTargetRef='node:other';
  assert.notEqual(deriveT4OriginalNativeCaptureSession(other).sessionRef,f.session.sessionRef);
});
test('original Host task durably prepares signed bytes before first HTTPS write, cold task never signs again',async()=>{
  const f=fixture();
  const staged=await f.binding().runNativePublication({slots:headsSlots,publish:false,
    createSignedFrames:async()=>[await f.heads()]});
  assert.equal(staged.preparedBatch.state,'ORIGINAL_SIGNED_BATCH_PREPARED');
  assert.equal(f.counts().putCalls,1);assert.equal(f.counts().networkCalls,0);
  const before=await f.port().inspectOriginalPublication();
  assert.equal(before.frames[0].state,'PREPARED');
  f.restart();
  const sent=await f.binding().runNativePublication({slots:headsSlots,
    createSignedFrames:async()=>{throw Error('must not sign again');}});
  assert.equal(sent.publications[0].state,'PUBLISHED_AND_READ_BACK');
  assert.equal(sent.sourceCursorAdvanced,false);
  assert.equal(f.counts().signCalls,1);assert.equal(f.counts().networkCalls,1);
  assert.equal(f.counts().putCalls,3);
  const after=await f.port().inspectOriginalPublication();
  assert.deepEqual(after.frames[0].wireBytes,before.frames[0].wireBytes);
  assert.equal(after.frames[0].state,'PRESENT');
});
test('lost original PREPARE CAS response recovers existing bytes without resign or remote write',async()=>{
  const f=fixture();f.loseCAS('PREPARE');
  await assert.rejects(f.stageHeads(),err('PUBLICATION_ORIGINAL_CAS_OUTCOME_UNKNOWN'));
  assert.equal(f.counts().putCalls,1);assert.equal(f.counts().networkCalls,0);
  f.restart();
  const p=await f.port().prepareSignedBatch({slots:headsSlots,
    createSignedFrames:async()=>{throw Error('must not sign');}});
  assert.equal(p.state,'ORIGINAL_SIGNED_BATCH_ALREADY_PREPARED');
  assert.equal(f.counts().signCalls,1);assert.equal(f.counts().putCalls,1);
});
test('lost HTTPS response after PUT restores exact bytes by GET and performs no second PUT',async()=>{
  const f=fixture();await f.stageHeads();f.loseNetwork('after');
  await assert.rejects(f.port().publishPreparedFrame({sequence:1}),err('PUBLICATION_NETWORK_OUTCOME_UNKNOWN'));
  assert.equal((await f.port().inspectOriginalPublication()).frames[0].state,'ATTEMPTED');
  f.restart();
  const p=await f.port().publishPreparedFrame({sequence:1});
  assert.equal(p.state,'REMOTE_READBACK_RECOVERED');
  assert.equal(f.counts().networkCalls,1);assert.equal(f.counts().putCalls,3);
  f.restart();
  assert.equal((await f.port().publishPreparedFrame({sequence:1})).state,'ALREADY_PRESENT_VERIFIED');
  assert.equal(f.counts().networkCalls,1);assert.equal(f.counts().putCalls,3);
});
test('lost original ATTEMPT response is not permission to publish until remote absence and original explicit retry',async()=>{
  const f=fixture();await f.stageHeads();f.loseCAS('ATTEMPT');
  await assert.rejects(f.port().publishPreparedFrame({sequence:1}),err('PUBLICATION_ORIGINAL_CAS_OUTCOME_UNKNOWN'));
  assert.equal(f.counts().networkCalls,0);
  f.restart();
  await assert.rejects(f.port().publishPreparedFrame({sequence:1}),
    err('PUBLICATION_PRIOR_NETWORK_OUTCOME_UNRESOLVED'));
  f.denyRetry();
  await assert.rejects(f.port().publishPreparedFrame({sequence:1,retryMissing:true}),
    err('PUBLICATION_ORIGINAL_AUTHORITY_DENIED'));
  assert.equal(f.counts().networkCalls,0);
});
test('verified missing remote frame permits only explicit identical create-only retry',async()=>{
  const f=fixture();await f.stageHeads();
  const saved=(await f.port().inspectOriginalPublication()).frames[0];
  f.loseNetwork('before');
  await assert.rejects(f.port().publishPreparedFrame({sequence:1}),err('PUBLICATION_NETWORK_OUTCOME_UNKNOWN'));
  await assert.rejects(f.port().publishPreparedFrame({sequence:1}),
    err('PUBLICATION_PRIOR_NETWORK_OUTCOME_UNRESOLVED'));
  f.restart();
  const p=await f.port().publishPreparedFrame({sequence:1,retryMissing:true});
  assert.equal(p.key,saved.key);
  assert.deepEqual(f.remote.get(p.key),Buffer.from(saved.wireBytes));
  assert.equal(f.counts().networkCalls,2);assert.equal(f.counts().signCalls,1);
  assert.equal((await f.port().inspectOriginalPublication()).frames[0].attempts,2);
});
test('complete CHANGE_REF and every CHUNK are persisted before first content PUT, no sequence skip',async()=>{
  const f=fixture();await f.stageHeads();
  const b=await f.changeBatch();
  await assert.rejects(f.port().prepareSignedBatch({slots:b.slots.slice(0,1),
    createSignedFrames:async()=>b.frames.slice(0,1)}),
    err('PUBLICATION_COMPLETE_CHANGE_CHUNK_BATCH_REQUIRED'));
  const prepared=await f.port().prepareSignedBatch({slots:b.slots,
    createSignedFrames:async()=>b.frames});
  assert.equal(prepared.frames.length,b.frames.length);
  assert.equal(f.counts().networkCalls,0);
  await assert.rejects(f.port().publishPreparedFrame({sequence:2}),
    err('PUBLICATION_PREDECESSOR_NOT_PRESENT'));
  await f.port().publishPreparedFrame({sequence:1});
  for(const slot of b.slots)await f.port().publishPreparedFrame({sequence:slot.sequence});
  assert.equal(f.counts().networkCalls,b.frames.length+1);
  f.restart();
  const r=await f.port().prepareSignedBatch({slots:b.slots});
  assert.equal(r.state,'ORIGINAL_SIGNED_BATCH_ALREADY_PREPARED');
  assert.deepEqual(r.frames,prepared.frames);
});
test('original Event chain detects tampered saved bytes and stage records',async()=>{
  const f=fixture();await f.stageHeads();
  const object=Array.from(f.objects.values())[0].object;
  object.data.entries[0].wireText+=' ';
  await assert.rejects(f.port().publishPreparedFrame({sequence:1}),
    err('PUBLICATION_ORIGINAL_SIGNED_BYTES_CHANGED'));
  assert.equal(f.counts().networkCalls,0);
  const g=fixture();await g.stageHeads();g.events[0].payload.chainHash=H('tampered');
  await assert.rejects(g.port().inspectOriginalPublication(),
    err('PUBLICATION_ORIGINAL_EVENT_CHAIN_INVALID'));
});
test('different peer or malformed source signature is rejected before original CAS',async()=>{
  const f=fixture();
  const wrong=await f.signed('HEADS',1,{familyRef:f.session.familyRef,ownerEpoch:2,
    heads:[f.session.sourcePrefixDigestAfter]},source,{recipientNodeRef:'node:wrong'});
  await assert.rejects(f.port().prepareSignedBatch({slots:headsSlots,
    createSignedFrames:async()=>[wrong]}),err('PUBLICATION_FRAME_SESSION_MISMATCH'));
  const frame=decodeT4CandidateFrame(await f.heads());
  frame.signatureBase64=Buffer.alloc(64).toString('base64');
  const corrupt=Buffer.from(JSON.stringify(frame),'utf8');
  await assert.rejects(f.port().prepareSignedBatch({slots:headsSlots,
    createSignedFrames:async()=>[corrupt]}),err('WIRE_SOURCE_SIGNATURE_NOT_VERIFIED'));
  assert.equal(f.counts().putCalls,0);assert.equal(f.counts().networkCalls,0);
});
test('recipient publication keeps independent exact signed slot and rejects wrong direction',async()=>{
  const f=fixture(),p=f.port(recipient);
  const slots=[{sequence:1,messageType:'DIFF_REQUEST'}];
  const prepared=await p.prepareSignedBatch({slots,
    createSignedFrames:async()=>[await f.signed('DIFF_REQUEST',1,{
      familyRef:f.session.familyRef,fromHeads:[f.session.sourcePrefixDigestBefore],
    },recipient)]});
  const result=await p.publishPreparedFrame({sequence:1});
  assert.equal(result.sha256,prepared.frames[0].sha256);
  assert.equal((await f.port().inspectOriginalPublication()).revision,0);
  assert.equal((await p.inspectOriginalPublication()).frames[0].state,'PRESENT');
});
test('lost PRESENT CAS response recovers from original Event, no repeated transport or original CAS',async()=>{
  const f=fixture();await f.stageHeads();f.loseCAS('PRESENT');
  await assert.rejects(f.port().publishPreparedFrame({sequence:1}),err('PUBLICATION_ORIGINAL_CAS_OUTCOME_UNKNOWN'));
  f.restart();
  const recovered=await f.port().publishPreparedFrame({sequence:1});
  assert.equal(recovered.state,'ALREADY_PRESENT_VERIFIED');
  assert.equal(f.counts().putCalls,3);assert.equal(f.counts().networkCalls,1);
});
test('LOCAL_T3 and revoked original access never enter publication or Outbox',async()=>{
  const f=fixture();f.local();
  const result=await f.binding().runNativePublication({slots:headsSlots});
  assert.equal(result.originalOutboxRead,false);
  assert.deepEqual(f.counts(),{putCalls:0,networkCalls:0,signCalls:0,reads:0});
  const g=fixture();g.revoke();
  await assert.rejects(g.stageHeads(),err('PUBLICATION_ORIGINAL_AUTHORITY_DENIED'));
  assert.equal(g.counts().networkCalls,0);
});

test('invalidation during original signing cannot reserve or publish new bytes from a stale Host',async()=>{
  const f=fixture();let active=true;
  const old=f.binding({isHostActive:()=>active});
  await assert.rejects(old.runNativePublication({slots:headsSlots,createSignedFrames:async()=>{
    const bytes=await f.heads();active=false;return [bytes];
  }}),err('HOST_TASK_ORIGINAL_HOST_DISPOSED'));
  assert.equal(f.counts().putCalls,0);assert.equal(f.counts().networkCalls,0);
  active=true;
  await assert.rejects(old.runNativePublication({slots:headsSlots}),err('HOST_TASK_ORIGINAL_HOST_DISPOSED'));
  const fresh=await f.binding({isHostActive:()=>true}).runNativePublication({
    slots:headsSlots,createSignedFrames:async()=>[await f.heads()]});
  assert.equal(fresh.networkPublished,true);
  assert.equal(f.counts().networkCalls,1);
});
test('original Host invalidation after immutable PUT leaves durable attempt, not a confirmed record',async()=>{
  const f=fixture();let active=true;
  await f.stageHeads();
  f.onNetworkPut(()=>{active=false;});
  const old=f.binding({isHostActive:()=>active});
  await assert.rejects(old.runNativePublication({slots:headsSlots}),err('PUBLICATION_NETWORK_OUTCOME_UNKNOWN'));
  const durable=await f.port().inspectOriginalPublication();
  assert.equal(durable.frames[0].state,'ATTEMPTED');
  assert.equal(f.counts().networkCalls,1);
  assert.equal(f.counts().putCalls,2);
  const signCalls=f.counts().signCalls;
  f.restart();f.onNetworkPut(()=>{});
  const fresh=await f.binding({isHostActive:()=>true}).runNativePublication({
    slots:headsSlots,createSignedFrames:async()=>{throw Error('must not sign again');}});
  assert.equal(fresh.publications[0].state,'REMOTE_READBACK_RECOVERED');
  assert.equal(f.counts().networkCalls,1);
  assert.equal(f.counts().signCalls,signCalls);
  assert.equal(f.counts().putCalls,3);
});

test('outbound proof is re-read from original publication and network without fabricating a recipient replay receipt',async()=>{
  const f=fixture();await f.stageHeads();
  await assert.rejects(f.port().readOriginalPublishedFrame({sequence:1}),err('PUBLICATION_OUTBOUND_FRAME_NOT_PRESENT'));
  await f.port().publishPreparedFrame({sequence:1});
  const before=f.counts();f.restart();
  const p=await f.port().readOriginalPublishedFrame({sequence:1});
  assert.equal(p.schema,'IWXA_T4_ORIGINAL_OUTBOUND_FRAME_PROOF_V1');
  assert.equal(p.originalReplayCheckpointRecorded,false);assert.equal(p.remoteReceiptProven,false);
  assert.equal(p.originalT3PublicationEventChainVerified,true);
  assert.equal(p.originalOutboundSignatureVerified,true);
  assert.equal(p.originalOutboundAuthorityVerified,true);
  assert.equal(p.originalImmutableTransportReadbackVerified,true);
  assert.equal(p.verifiedBody.heads[0],f.session.sourcePrefixDigestAfter);
  assert.equal(p.originalBusinessApplied,false);
  assert.equal(f.counts().putCalls,before.putCalls);
  assert.equal(f.counts().networkCalls,before.networkCalls);
  assert.equal(f.counts().signCalls,before.signCalls);
  f.remote.delete(p.key);
  await assert.rejects(f.port().readOriginalPublishedFrame({sequence:1}),err('REMOTE_NOT_FOUND'));
});

async function sourceStepFixture(){
  const originalEvents=[1,2].map((revision,i)=>({
    event_id:i?eventId:'event:original:one',workspace_id:ws,service_id:'iwxa.test',
    object_id:'object:one',revision,event_type:'subject.changed',
    occurred_at:'2026-11-23T19:00:0'+revision+'.000Z',payload:{revision},
  }));
  const read=cursor=>readT4OriginalEventWindow({
    workspaceId:ws,originalWriteOwnerRef:owner,cursor,maxEvents:1,
    authorizeOriginalRead:async()=>true,readOriginalEvents:async()=>structuredClone(originalEvents),
  });
  const prior=await read(null),next=await read(prior.nextCursor);
  const data=task(),w=next.window;
  data.sourceCursorBefore=prior.nextCursor;data.sourceCursorAfter=next.nextCursor;
  data.capture.sourceWindow=w;data.capture.captureRef='capture:original:two';
  data.capture.prepared.delta.sourceEventDigest=w.eventRefs[0].eventDigest;
  data.capture.prepared.delta.windowDigest=w.windowDigest;
  const f=fixture(data),session=f.session;
  let sealCalls=0,sourceSignCalls=0,subjectProof=true;
  const phase=()=>createT4OriginalNetworkSessionPhasePort({
    originalKernel:f.kernel,technicalWorkspaceId:technical,originalWriteOwnerRef:owner,
    sourceNodeRef:source,recipientNodeRef:recipient,localNodeRef:source,scopeRef:scope,
    sessionRef:session.sessionRef,changeId:session.changeId,ownerEpoch:session.ownerEpoch,
    getMode:f.mode,readOriginalHostContext:async()=>({workspaceId:technical,
      originalWriteOwnerRef:owner,nodeRef:source,scopeRef:scope,hostSessionRef:f.host()}),
    authorizeOriginalTechnicalRead:f.auth,authorizeOriginalTechnicalWrite:f.auth,
    verifyOriginalPhaseEvidence:async p=>{
      if(p.phase==='INTENT')return p.evidence.evidenceRef===session.sourceEventId&&
        p.evidence.evidenceDigest===session.capturedWindowDigest;
      if(p.phase==='PUBLISHED'){
        const local=await f.port().readOriginalPublishedFrame({sequence:2});
        return p.evidence.evidenceRef===local.key&&p.evidence.evidenceDigest==='sha256:'+local.sha256;
      }
      return false;
    },verifyOriginalRecipientApplied:async()=>false,
  });
  const options={
    createOriginalSourcePhasePort:async()=>phase(),
    frameDiscoveryPort:f.makeTransport(source),requiredCryptoSuite:suite,
    resolveOriginalSigningContext:async()=>({permissionRef:'permission:original',signerRef:'key:source'}),
    signOriginalNodeBytes:async({bytes})=>{sourceSignCalls++;return sign(null,Buffer.from(bytes),keys.privateKey);},
    authorizeOriginalSealedContent:f.auth,
    readOriginalSealedContent:async p=>{
      assert.equal(p.exactCapturedCanonicalBytesRequired,true);
      assert.equal(p.originalCapture.prepared.sha256,session.capturedSha256);
      sealCalls++;
      return {ciphertext:Buffer.from('opaque test sealed content'),encryptionContextRef:'sealed:original:epoch:2'};
    },
    authorizeOriginalRead:f.auth,readOriginalEvents:async()=>structuredClone(originalEvents),
    verifyOriginalSourceSubject:async p=>subjectProof&&p.originalSourceEventId===eventId&&
      p.originalEventDigest===session.sourceEventDigest&&p.originalEventWindowDigest===session.capturedWindowDigest,
  };
  const step=(overrides={})=>f.binding().runNativeSourceStep({...options,...overrides});
  const diff=async(fromHeads=[session.sourcePrefixDigestBefore])=>{
    const bytes=await f.signed('DIFF_REQUEST',1,{familyRef:session.familyRef,fromHeads},recipient);
    await f.makeTransport(recipient).publishSignedFrame({wireBytes:bytes});
  };
  return {...f,phase,options,step,diff,originalEvents,
    sourceCounts:()=>({sealCalls,sourceSignCalls}),denySubject:()=>{subjectProof=false;}};
}
test('one original Host source callback resumes durable INTENT, HEADS, DIFF, content and PUBLISHED without caller addresses or slots',async()=>{
  const f=await sourceStepFixture();
  assert.equal((await f.step()).state,'INTENT_RECORDED');
  assert.equal((await f.phase().inspectOriginalSession()).revision,1);
  assert.deepEqual(f.sourceCounts(),{sealCalls:0,sourceSignCalls:0});
  f.restart();
  assert.equal((await f.step()).state,'HEADS_PRESENT');
  assert.equal((await f.step()).state,'WAITING_FOR_DIFF');
  assert.deepEqual(f.sourceCounts(),{sealCalls:0,sourceSignCalls:1});
  await f.diff();
  assert.equal((await f.step()).state,'CONTENT_PRESENT');
  assert.equal((await f.port().inspectOriginalPublication()).frames.length,3);
  assert.deepEqual(f.sourceCounts(),{sealCalls:1,sourceSignCalls:3});
  f.restart();
  const published=await f.step();
  assert.equal(published.state,'PUBLISHED_RECORDED');
  assert.equal(published.sourceFramesRemoteReceiptProven,false);
  assert.equal((await f.phase().inspectOriginalSession()).revision,2);
  const counts=f.counts();
  assert.equal((await f.step()).state,'WAITING_FOR_ACK');
  assert.equal(f.counts().putCalls,counts.putCalls);
  assert.equal(f.counts().networkCalls,counts.networkCalls);
  assert.deepEqual(f.sourceCounts(),{sealCalls:1,sourceSignCalls:3});
  assert.equal(f.replay.size,1);
});
test('lost source batch response and cold task recover exact content with no second seal or signature',async()=>{
  const f=await sourceStepFixture();await f.step();await f.step();await f.diff();
  f.loseCAS('PREPARE');
  await assert.rejects(f.step(),err('PUBLICATION_ORIGINAL_CAS_OUTCOME_UNKNOWN'));
  const saved=await f.port().inspectOriginalPublication();
  assert.deepEqual(saved.frames.map(x=>x.state),['PRESENT','PREPARED','PREPARED']);
  f.restart();
  const resumed=await f.step();
  assert.equal(resumed.state,'CONTENT_PRESENT');assert.equal(resumed.originalSignedBatchReused,true);
  assert.deepEqual((await f.port().inspectOriginalPublication()).frames.map(x=>x.wireBytes),
    saved.frames.map(x=>x.wireBytes));
  assert.deepEqual(f.sourceCounts(),{sealCalls:1,sourceSignCalls:3});
  assert.equal((await f.step()).state,'PUBLISHED_RECORDED');
});
test('wrong signed DIFF cannot initiate sealing or publication',async()=>{
  const f=await sourceStepFixture();await f.step();await f.step();await f.diff([H('wrong')]);
  await assert.rejects(f.step(),err('HOST_TASK_NATIVE_SOURCE_DIFF_FRONTIER_MISMATCH'));
  assert.deepEqual(f.sourceCounts(),{sealCalls:0,sourceSignCalls:1});
});
test('original source subject proof is still required after all transport frames are present',async()=>{
  const f=await sourceStepFixture();await f.step();await f.step();await f.diff();await f.step();
  f.denySubject();
  await assert.rejects(f.step(),err('HEAD_ORIGINAL_T3_SUBJECT_NOT_PROVEN'));
  assert.equal((await f.phase().inspectOriginalSession()).currentPhase,'INTENT');
});
test('source continuation stops for local T3 and shares original Host mutual exclusion',async()=>{
  const f=await sourceStepFixture();const b=f.binding();
  const p=b.runNativeSourceStep(f.options);
  await assert.rejects(b.runNativePublication({slots:headsSlots}),err('HOST_TASK_OTHER_PROTOCOL_ACTIVE'));
  assert.equal((await p).state,'INTENT_RECORDED');
  f.local();const before=f.counts();
  assert.equal((await f.step()).state,'LOCAL_T3');
  assert.deepEqual(f.counts(),before);
});


test('K23 durable ATTEMPTED record repairs missing index with exact saved frame and original authorization',async()=>{
  const f=fixture(task(),{indexed:true});
  await f.stageHeads();
  const saved=(await f.port().inspectOriginalPublication()).frames[0];
  f.loseIndex('before');
  await assert.rejects(f.port().publishPreparedFrame({sequence:1}),err('PUBLICATION_NETWORK_OUTCOME_UNKNOWN'));
  assert.equal(f.counts().networkCalls,1);assert.equal(f.indexCalls(),1);assert.equal(f.indexes.size,0);
  assert.equal((await f.port().inspectOriginalPublication()).frames[0].state,'ATTEMPTED');
  f.restart();f.denyIndexRepair();
  await assert.rejects(f.port().publishPreparedFrame({sequence:1}),err('PUBLICATION_PRIOR_NETWORK_OUTCOME_UNRESOLVED'));
  assert.equal(f.indexCalls(),1);assert.equal(f.counts().putCalls,2);
  f.allowIndexRepair();
  const recovered=await f.port().publishPreparedFrame({sequence:1});
  assert.equal(recovered.state,'REMOTE_READBACK_RECOVERED');
  assert.equal(f.indexCalls(),2);assert.equal(f.indexes.size,1);
  assert.equal(f.counts().networkCalls,1);assert.equal(f.counts().signCalls,1);
  assert.equal(f.counts().putCalls,3);
  const present=(await f.port().inspectOriginalPublication()).frames[0];
  assert.equal(present.state,'PRESENT');assert.equal(present.attempts,1);
  assert.deepEqual(present.wireBytes,saved.wireBytes);
  f.restart();
  assert.equal((await f.port().publishPreparedFrame({sequence:1})).state,'ALREADY_PRESENT_VERIFIED');
  assert.equal(f.indexCalls(),2);assert.equal(f.counts().networkCalls,1);
  assert.equal(f.counts().putCalls,3);
});

test('K23 durable recovery observes already committed index without repeating index or frame write',async()=>{
  const f=fixture(task(),{indexed:true});await f.stageHeads();
  f.loseIndex('after');
  await assert.rejects(f.port().publishPreparedFrame({sequence:1}),err('PUBLICATION_NETWORK_OUTCOME_UNKNOWN'));
  assert.equal(f.indexes.size,1);
  f.restart();
  assert.equal((await f.port().publishPreparedFrame({sequence:1})).state,'REMOTE_READBACK_RECOVERED');
  assert.equal(f.indexCalls(),1);assert.equal(f.counts().networkCalls,1);
  assert.equal(f.counts().signCalls,1);assert.equal(f.counts().putCalls,3);
});


test('K25 migrate exact already PRESENT legacy frames to indexed transport without another publication, signature or original CAS',async()=>{
  const f=fixture(task(),{indexed:true,initialLegacy:true});
  await f.stageHeads();await f.port().publishPreparedFrame({sequence:1});
  const before=await f.port().inspectOriginalPublication();
  assert.equal(f.indexes.size,0);
  await assert.rejects(f.port().reconcileOriginalPublishedFrameIndexes({sequences:[1]}),
    err('PUBLICATION_NATIVE_INDEX_PROFILE_REQUIRED'));
  f.restart();f.enableIndexed();
  await assert.rejects(f.port().readOriginalPublishedFrame({sequence:1}),err('WIRE_NATIVE_INDEX_MISSING'));
  assert.equal(f.indexCalls(),0);
  f.denyIndexMigration();
  await assert.rejects(f.port().reconcileOriginalPublishedFrameIndexes({sequences:[1]}),
    err('PUBLICATION_ORIGINAL_AUTHORITY_DENIED'));
  assert.equal(f.indexCalls(),0);
  f.allowIndexMigration();
  const migrated=await f.port().reconcileOriginalPublishedFrameIndexes({sequences:[1]});
  assert.equal(migrated.state,'ORIGINAL_PRESENT_FRAME_INDEXES_VERIFIED');
  assert.equal(migrated.originalPublicationRevision,before.revision);
  assert.equal(migrated.originalPublicationChainHash,before.chainHash);
  assert.equal(migrated.frames[0].sha256,before.frames[0].sha256);
  assert.equal(migrated.frames[0].nativeSessionIndexVerified,true);
  assert.equal(migrated.frames[0].sourceAnnouncementIndexVerified,false);
  assert.equal(migrated.originalFramePutInvoked,false);assert.equal(migrated.originalSigningInvoked,false);
  assert.equal(f.indexCalls(),1);assert.equal(f.indexes.size,1);
  assert.equal(f.counts().networkCalls,1);assert.equal(f.counts().signCalls,1);assert.equal(f.counts().putCalls,3);
  assert.deepEqual(await f.port().inspectOriginalPublication(),before);
  assert.equal((await f.port().readOriginalPublishedFrame({sequence:1})).sha256,before.frames[0].sha256);
  f.restart();
  assert.deepEqual(await f.port().reconcileOriginalPublishedFrameIndexes({sequences:[1]}),migrated);
  assert.equal(f.indexCalls(),1);assert.equal(f.counts().networkCalls,1);
});
test('K25 whole requested migration batch must already be PRESENT; unknown address response is read back on an explicit new call',async()=>{
  const f=fixture(task(),{indexed:true,initialLegacy:true});
  await f.stageHeads();await f.port().publishPreparedFrame({sequence:1});
  const batch=await f.changeBatch();
  await f.port().prepareSignedBatch({slots:batch.slots,createSignedFrames:async()=>batch.frames});
  f.enableIndexed();
  await assert.rejects(f.port().reconcileOriginalPublishedFrameIndexes({sequences:[1,2]}),
    err('PUBLICATION_INDEX_MIGRATION_PRESENT_REQUIRED'));
  await assert.rejects(f.port().reconcileOriginalPublishedFrameIndexes({sequences:[1,1]}),
    err('PUBLICATION_INDEX_MIGRATION_SEQUENCE_INVALID'));
  assert.equal(f.indexCalls(),0);
  const before=await f.port().inspectOriginalPublication();
  f.loseIndex('after');
  await assert.rejects(f.port().reconcileOriginalPublishedFrameIndexes({sequences:[1]}),
    e=>e?.code==='PUBLICATION_INDEX_MIGRATION_OUTCOME_UNKNOWN'&&e.details.automaticRetryAllowed===false);
  assert.equal(f.indexes.size,1);
  f.restart();
  assert.equal((await f.port().reconcileOriginalPublishedFrameIndexes({sequences:[1]})).state,
    'ORIGINAL_PRESENT_FRAME_INDEXES_VERIFIED');
  assert.equal(f.indexCalls(),1);assert.equal(f.counts().networkCalls,1);
  assert.deepEqual(await f.port().inspectOriginalPublication(),before);
});

function migrationInventory(f,overrides={}){
  return readT4OriginalPublicationMigrationInventory({technicalSchemaId:T4_LEGACY_TEST_TECHNICAL_SCHEMA_ID,
    technicalWorkspaceId:technical,sourceWorkspaceId:ws,originalWriteOwnerRef:owner,
    sourceNodeRef:source,recipientNodeRef:recipient,scopeRef:scope,ownerEpoch:2,
    localNodeRef:source,originalKernel:f.kernel,getMode:f.mode,
    readOriginalHostContext:async()=>({workspaceId:technical,originalWriteOwnerRef:owner,
      nodeRef:source,scopeRef:scope,hostSessionRef:f.host()}),
    authorizeOriginalTechnicalRead:f.auth,...overrides});
}
test('K30 original migration inventory binds local owner and peer epoch, including historical sessions but not foreign records',async()=>{
  const f=fixture(task(),{indexed:true,initialLegacy:true});
  await f.stageHeads();await f.port().publishPreparedFrame({sequence:1});
  const another=structuredClone(f.data);
  another.capture.sourceEventId='event:original:three';
  another.capture.sourceWindow.lastEventId=another.capture.sourceEventId;
  another.capture.prepared.delta.sourceEventId=another.capture.sourceEventId;
  const later=deriveT4OriginalNativeCaptureSession(another);
  const oldEpoch=deriveT4OriginalNativeCaptureSession({...f.data,ownerEpoch:1});
  for(const session of [later,oldEpoch]){
    const p=f.port(source,session);
    await p.prepareSignedBatch({slots:headsSlots,createSignedFrames:async()=>[
      await f.signed('HEADS',1,{familyRef:session.familyRef,ownerEpoch:session.ownerEpoch,
        heads:[session.sourcePrefixDigestAfter]},source,{sessionRef:session.sessionRef,ownerEpoch:session.ownerEpoch})
    ]});
    await p.publishPreparedFrame({sequence:1});
  }
  const recipientPort=f.port(recipient);
  await recipientPort.prepareSignedBatch({slots:[{sequence:1,messageType:'DIFF_REQUEST'}],
    createSignedFrames:async()=>[await f.signed('DIFF_REQUEST',1,
      {familyRef:f.session.familyRef,fromHeads:[f.session.sourcePrefixDigestBefore]},recipient)]});
  await recipientPort.publishPreparedFrame({sequence:1});
  const before=f.counts(),calls=[];
  const result=await migrationInventory(f,{authorizeOriginalTechnicalRead:async p=>{calls.push(p.operation);return true;}});
  assert.deepEqual(new Set(result.records.map(r=>r.session.sessionRef)),new Set([f.session.sessionRef,later.sessionRef]));
  assert.ok(result.records.every(r=>r.revision===3));
  assert.equal(result.originalCatalogAndEventCorrespondenceVerified,true);
  assert.equal(result.originalPublicationChainsVerified,false);
  assert.equal(result.originalAuthorityGranted,false);
  assert.deepEqual(calls,['t1.listObjects','t1.listObjects','t1.listEventsSince','t1.listEventsSince']);
  assert.deepEqual(f.counts(),before);
  assert.equal(f.indexes.size,0);
});
test('K30 original migration inventory rejects missing catalog row, missing Event and denied read',async()=>{
  const f=fixture();await f.stageHeads();await f.port().publishPreparedFrame({sequence:1});
  const [key,row]=[...f.objects][0],before=f.counts();
  f.objects.delete(key);
  await assert.rejects(migrationInventory(f),err('PUBLICATION_MIGRATION_ORIGINAL_EVENT_NOT_PROVEN'));
  f.objects.set(key,row);
  const e=f.events.pop();
  await assert.rejects(migrationInventory(f),err('PUBLICATION_MIGRATION_ORIGINAL_EVENT_NOT_PROVEN'));
  f.events.push(e);
  let eventReads=0;const list=f.kernel.listEventsSince;
  f.kernel.listEventsSince=async(...args)=>{eventReads++;return list(...args);};
  await assert.rejects(migrationInventory(f,{authorizeOriginalTechnicalRead:async p=>p.operation!=='t1.listEventsSince'}),
    err('PUBLICATION_ORIGINAL_AUTHORITY_DENIED'));
  assert.equal(eventReads,0);assert.deepEqual(f.counts(),before);
});

test('K30 final migration inventory binds full original Object and Event evidence even at unchanged revision and terminal hash',async()=>{
  const f=fixture();await f.stageHeads();await f.port().publishPreparedFrame({sequence:1});
  const before=await migrationInventory(f),record=before.records[0];
  assert.match(record.originalObjectDigest,/^sha256:[0-9a-f]{64}$/);
  assert.match(record.originalEventStreamDigest,/^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(await migrationInventory(f),before);
  const [key,row]=[...f.objects][0];
  f.objects.set(key,{...row,object:{...row.object,data:{...row.object.data,title:'changed without revision'}}});
  const objectChanged=(await migrationInventory(f)).records[0];
  assert.equal(objectChanged.revision,record.revision);assert.equal(objectChanged.chainHash,record.chainHash);
  assert.notEqual(objectChanged.originalObjectDigest,record.originalObjectDigest);
  assert.equal(objectChanged.originalEventStreamDigest,record.originalEventStreamDigest);
  f.objects.set(key,row);
  const event=f.events[0];f.events[0]={...event,event_id:'event:replacement'};
  const eventChanged=(await migrationInventory(f)).records[0];
  assert.equal(eventChanged.revision,record.revision);assert.equal(eventChanged.chainHash,record.chainHash);
  assert.equal(eventChanged.originalObjectDigest,record.originalObjectDigest);
  assert.notEqual(eventChanged.originalEventStreamDigest,record.originalEventStreamDigest);
  f.events[0]=event;assert.deepEqual(await migrationInventory(f),before);
});
