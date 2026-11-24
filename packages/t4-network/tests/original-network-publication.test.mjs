import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign,verify} from 'node:crypto';
import {createT4CandidateUnsignedFrame,signT4CandidateFrame,decodeT4CandidateFrame}
  from '../src/network/standard-network-wire-candidate.mjs';
import {prepareT4CandidateOpaqueChunks}
  from '../src/network/standard-network-opaque-chunks.mjs';
import {createT4CandidateFrameTransport}
  from '../src/network/standard-network-wire-transport.mjs';
import {deriveT4OriginalNativeCaptureSession,createT4OriginalNetworkPublicationPort}
  from '../src/network/original-network-publication.mjs';
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
function fixture(){
  const data=task(),session=deriveT4OriginalNativeCaptureSession(data);
  const objects=new Map(),events=[],remote=new Map();
  let putCalls=0,networkCalls=0,signCalls=0,reads=0,
    loseAction=null,loseNetwork=null,host='host:initial',network=true,allow=true,retryAllowed=true,
    afterNetworkPut=()=>{};
  const kernel={
    hasOperation:op=>['t1.getObject','t1.listEventsSince','t1.putObject'].includes(op),
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
  const mode=()=>network?'T4_NETWORK':'LOCAL_T3';
  const auth=async()=>allow;
  const makeTransport=node=>createT4CandidateFrameTransport({
    wireTransport:transport,originalHostNodeRef:node,originalHostScopeRef:scope,
    getMode:mode,readOriginalHostContext:async()=>({
      nodeRef:node,scopeRef:scope,originalOwnerRef:owner,hostSessionRef:host,
    }),authorizeOriginalHostWire:auth,verifyOriginalNodeSignature:async()=>false,
    authorizeOriginalNetwork:async()=>false,persistOriginalReplayDecision:async()=> 'DENIED',
  });
  function port(node=source){
    return createT4OriginalNetworkPublicationPort({
      session,localNodeRef:node,technicalWorkspaceId:technical,
      originalKernel:kernel,getMode:mode,
      readOriginalHostContext:async()=>({workspaceId:technical,
        originalWriteOwnerRef:owner,nodeRef:node,scopeRef:scope,hostSessionRef:host}),
      authorizeOriginalTechnicalRead:auth,authorizeOriginalTechnicalWrite:auth,
      authorizeOriginalFramePublish:async p=>allow&&
        (p.operation!=='t4.network.publish.retry-missing'||retryAllowed),
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
    counts:()=>({putCalls,networkCalls,signCalls,reads}),
    loseCAS:action=>{loseAction=action;},loseNetwork:where=>{loseNetwork=where;},
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
