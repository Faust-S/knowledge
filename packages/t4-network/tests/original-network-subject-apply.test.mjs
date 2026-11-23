import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createCipheriv,createDecipheriv,randomBytes}
  from 'node:crypto';
import {verifyT4OriginalObjectDelta}
  from '../src/network/original-object-delta.mjs';
import {openT4OriginalNetworkObjectChange,
  inspectT4OriginalNetworkRecipientResult,
  applyT4OriginalNetworkObjectChange,
  createT4OriginalNetworkAppliedAckBody}
  from '../src/network/original-network-subject-apply.mjs';

const H=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const stable=x=>JSON.stringify(Array.isArray(x)?x.map(stable):x);
const ordered=x=>Array.isArray(x)?x.map(ordered):
  x&&typeof x==='object'?Object.fromEntries(
    Object.entries(x).sort(([a],[b])=>a.localeCompare(b))
      .map(([k,v])=>[k,ordered(v)])):x;
const bytes=x=>Buffer.from(JSON.stringify(ordered(x)));
const error=code=>e=>e?.code===code;

function fixture(){
  const data={title:'T4 native applied to original T3',v:1};
  const delta={
    schema:'IWXA_T4_ORIGINAL_OBJECT_DELTA_V1',
    workspaceId:'workspace:object:one',
    originalWriteOwnerRef:'owner:source:one',
    objectId:'object:one',schemaId:'iwxa.demo.note',schemaVersion:'1.0.0',
    sourceEventId:'event:source:one',
    sourceEventDigest:H('original-event'),windowDigest:H('original-window'),
    originalEventType:'source.changed',
    baseRevision:0,sourceRevision:1,
    data,extensions:{},
    objectContentDigest:H(bytes({schemaId:'iwxa.demo.note',
      schemaVersion:'1.0.0',data,extensions:{}})),
  };
  const exact=verifyT4OriginalObjectDelta(delta);
  const key=randomBytes(32),iv=randomBytes(12);
  const authenticatedPlaintext=exact.bytes;
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from('change:one'));
  const sealed=Buffer.concat([iv,cipher.update(authenticatedPlaintext),
    cipher.final(),cipher.getAuthTag()]);
  const contentDigest=H(sealed);
  const changeId='change:one';
  const body={
    changeId,contentDigest,chunkIndex:0,chunkCount:1,
    ciphertextBase64:sealed.toString('base64'),
    ciphertextSha256:contentDigest,
    encryptionContextRef:'key:original:epoch:2',
  };
  const common={
    schema:'IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1',
    verifiedSourceNodeRef:'node:source',
    verifiedRecipientNodeRef:'node:recipient',
    verifiedScopeRef:'scope:original',
    verifiedSessionRef:'session:one',
    verifiedOwnerEpoch:2,
    verifiedSignerRef:'key:source:ed25519',
    originalSignatureVerified:true,originalAccessVerified:true,
    originalReplayCheckpointRecorded:true,networkBytesVerified:true,
    originalBusinessApplied:false,originalT3ExchangeCalled:false,
  };
  const verifiedChangeRef={
    ...common,signedMessageType:'CHANGE_REF',verifiedSequence:6,
    verifiedBody:{changeId,changeKind:'OBJECT_PUT',
      eventRef:delta.sourceEventId,ownerRef:delta.originalWriteOwnerRef,
      sourceRevision:1,contentDigest,parents:[H('prefix-before')]},
  };
  const verifiedChunks=[{...common,signedMessageType:'CHUNK',
    verifiedSequence:7,verifiedBody:body}];
  const originalSourceHeadProof={
    schema:'IWXA_T4_ORIGINAL_SOURCE_NETWORK_HEAD_PROOF_V1',
    signedHeadMatchesOriginalT3EventPrefix:true,
    signedDiffMatchesOriginalT3Frontier:true,
    originalSourceSubjectIndependentlyRead:true,
    originalSourceEventId:delta.sourceEventId,
    originalEventRevision:1,
    sourceNodeRef:'node:source',recipientNodeRef:'node:recipient',
    scopeRef:'scope:original',sessionRef:'session:one',
    originalEventDigest:delta.sourceEventDigest,
    sourceEventWindowDigest:delta.windowDigest,
    sourcePrefixDigestAfter:H('prefix-after'),
  };
  let network=true,allowed=true,opened=0,writeCount=0;
  const events=[],objects=new Map();
  const originalKernel={
    hasOperation:op=>['t1.getObject','t1.listEventsSince',
      't1.commitObjectGraph'].includes(op),
    getObject:async(w,id)=>structuredClone(objects.get(w+':'+id)??null),
    listEventsSince:async w=>structuredClone(events.filter(e=>e.workspace_id===w)),
    commitObjectGraph:async input=>{
      writeCount++;
      const id=input.workspace_id+':'+input.object.object_id;
      const old=objects.get(id);
      if(input.object.base_revision!==(old?.object?.revision??0))
        throw Object.assign(Error('CONFLICT'),{code:'REVISION_CONFLICT'});
      const object={
        workspace_id:input.workspace_id,object_id:input.object.object_id,
        schema_id:input.object.schema_id,
        schema_version:input.object.schema_version,
        revision:input.object.base_revision+1,deleted:false,
        data:structuredClone(input.object.data),
        extensions:structuredClone(input.object.extensions),
      };
      const event={
        workspace_id:input.workspace_id,object_id:object.object_id,
        event_id:'event:recipient:'+writeCount,
        revision:object.revision,event_type:input.event.event_type,
        payload:structuredClone(input.event.payload),
      };
      events.push(event);objects.set(id,{object});
      return {workspace_id:input.workspace_id,
        transaction_id:'transaction:recipient:'+writeCount,
        object,event};
    },
  };
  const openArgs={
    verifiedChangeRef,verifiedChunks,originalSourceHeadProof,
    encryptionContextRef:body.encryptionContextRef,
    recipientNodeRef:'node:recipient',scopeRef:'scope:original',
    getMode:()=>network?'T4_NETWORK':'LOCAL_T3',
    readOriginalHostContext:async()=>({
      nodeRef:'node:recipient',scopeRef:'scope:original',
      hostSessionRef:'host:one',
      originalWriteOwnerRef:'owner:source:one'}),
    authorizeOriginalSealedOpen:async()=>allowed,
    verifyOriginalSourceBinding:async()=>allowed,
    openOriginalSealedContent:async p=>{
      opened++;
      const input=Buffer.from(p.ciphertext);
      const decipher=createDecipheriv('aes-256-gcm',key,input.subarray(0,12));
      decipher.setAAD(Buffer.from('change:one'));
      decipher.setAuthTag(input.subarray(-16));
      const output=Buffer.concat([decipher.update(input.subarray(12,-16)),
        decipher.final()]);
      return {authenticated:true,plaintext:new Uint8Array(output)};
    },
  };
  const applyArgs=received=>({
    received,originalKernel,getMode:openArgs.getMode,
    authorizeOriginalRead:async()=>allowed,
    authorizeOriginalWrite:async()=>allowed,
    verifyOriginalSourceEvent:async proof=>allowed&&
      proof.sourceEventId===delta.sourceEventId&&
      proof.objectContentDigest===delta.objectContentDigest,
  });
  return {openArgs,applyArgs,originalKernel,delta,events,objects,
    get opened(){return opened;},
    get writes(){return writeCount;},
    revoke(){allowed=false;},local(){network=false;}};
}
test('P2.2-C authenticated native sealed object produces a real original T3 Event and APPLIED_ACK body',async()=>{
  const f=fixture();
  const received=await openT4OriginalNetworkObjectChange(f.openArgs);
  assert.equal(received.originalBusinessApplied,false);
  assert.equal(f.opened,1);
  assert.equal((await inspectT4OriginalNetworkRecipientResult(
    f.applyArgs(received))).state,'NOT_APPLIED');
  const result=await applyT4OriginalNetworkObjectChange(f.applyArgs(received));
  assert.equal(result.originalBusinessApplied,true);
  assert.equal(result.originalCommitInvoked,true);
  assert.equal(f.writes,1);
  assert.equal(f.events.length,1);
  const ack=createT4OriginalNetworkAppliedAckBody({
    received,verifiedResult:result,ackRef:'ack:one'});
  assert.equal(ack.recipientEventRef,f.events[0].event_id);
  assert.equal(ack.recipientRevision,1);
  assert.equal(ack.recipientStateDigest,f.delta.objectContentDigest);
  const afterCold=await inspectT4OriginalNetworkRecipientResult(
    f.applyArgs(received));
  assert.equal(afterCold.state,'APPLIED_VERIFIED');
  assert.equal((await applyT4OriginalNetworkObjectChange(
    f.applyArgs(received))).originalCommitInvoked,false);
  assert.equal(f.writes,1);
});
test('P2.2-C ciphertext mutation fails before Host decryption and business write',async()=>{
  const f=fixture();
  const b=f.openArgs.verifiedChunks[0].verifiedBody;
  const bad={...b,ciphertextBase64:Buffer.from('bad').toString('base64')};
  await assert.rejects(openT4OriginalNetworkObjectChange({
    ...f.openArgs,verifiedChunks:[{
      ...f.openArgs.verifiedChunks[0],verifiedBody:bad}],
  }),error('CHUNK_ASSEMBLY_INTEGRITY_FAILED'));
  assert.equal(f.opened,0);assert.equal(f.writes,0);
});
test('P2.2-C changed source Event binding fails closed before Host decrypt',async()=>{
  const f=fixture();
  await assert.rejects(openT4OriginalNetworkObjectChange({
    ...f.openArgs,originalSourceHeadProof:{
      ...f.openArgs.originalSourceHeadProof,
      originalSourceEventId:'event:forged'},
  }),error('SUBJECT_ORIGINAL_SOURCE_HEAD_NOT_BOUND'));
  assert.equal(f.opened,0);assert.equal(f.writes,0);
});
test('P2.2-C permission removal blocks open, local T3 blocks all network access',async()=>{
  const f=fixture();f.revoke();
  await assert.rejects(openT4OriginalNetworkObjectChange(f.openArgs),
    error('SUBJECT_ORIGINAL_SEALED_OPEN_DENIED'));
  const g=fixture();g.local();
  await assert.rejects(openT4OriginalNetworkObjectChange(g.openArgs),
    error('SUBJECT_NETWORK_MODE_OFF'));
  assert.equal(f.writes+g.writes,0);
});
test('P2.2-C forged APPLIED result cannot create network ACK',async()=>{
  const f=fixture(),received=await openT4OriginalNetworkObjectChange(f.openArgs);
  assert.throws(()=>createT4OriginalNetworkAppliedAckBody({
    received,verifiedResult:{state:'VERIFIED_ACK'},ackRef:'ack:fake',
  }),error('SUBJECT_APPLIED_ACK_REQUIRES_ORIGINAL_RESULT'));
});
test('P2.2-C divergent original recipient revision blocks duplicate business write',async()=>{
  const f=fixture(),received=await openT4OriginalNetworkObjectChange(f.openArgs);
  f.objects.set('workspace:object:one:object:one',{
    object:{workspace_id:'workspace:object:one',object_id:'object:one',
      revision:2,data:{title:'independent'},extensions:{},
      schema_id:'iwxa.demo.note',schema_version:'1.0.0'}});
  await assert.rejects(applyT4OriginalNetworkObjectChange(
    f.applyArgs(received)),error('SUBJECT_RECIPIENT_DIVERGED_WITHOUT_RESULT'));
  assert.equal(f.writes,0);
});
