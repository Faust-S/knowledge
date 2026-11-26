import test from 'node:test';
import assert from 'node:assert/strict';
import {readT4OriginalEventWindow} from '../src/network/original-event-window.mjs';
import {createT4OriginalHostCaptureAdapter} from '../src/network/original-host-capture-adapter.mjs';
import {createT4OriginalHostOutboxDispatcher,readT4OriginalNativeCaptureSessionAtCursor}
  from '../src/network/original-host-outbox-dispatcher.mjs';
import {packageSha256} from '../src/network/webdav-package-transfer.mjs';

const ws='original:workspace',owner='original:owner',from='original:object:a',
  to='original:object:b',relationId='original:relation:one';
const err=code=>e=>e?.code===code;
const initialEvent={
  event_id:'event:1',event_type:'business.object.created',
  workspace_id:ws,object_id:from,service_id:'service:original',revision:1,
  occurred_at:'2026-11-22T10:00:00Z',payload:{},
};
function fixture() {
  const events=[structuredClone(initialEvent)],intents=new Map(),
    outbox=new Map(),attempts=new Map(),checkpoints=new Map(),
    remote=new Map();
  let mode='T4_NETWORK',networkWrites=0,loseRemoteAck=false;
  const relations=[];
  const getMode=()=>mode;
  const kernel={
    hasOperation:op=>['t1.putObject','t1.putRelation','t1.getObject',
      't1.listEventsSince'].includes(op),
    putObject:async()=>({}),
    getObject:async()=>({
      object:{object_id:from,workspace_id:ws,revision:1,deleted:false},
      relations:{outgoing:relations.map(row=>structuredClone(row)),incoming:[]},
    }),
    putRelation:async input=>{
      assert.equal(relations.some(row=>row.relation_id===input.relation_id),false);
      const relation={workspace_id:ws,relation_id:input.relation_id,
        from_object_id:from,to_object_id:to,kind:'related'};
      relations.push(relation);
      const event={event_id:'event:'+String(events.length+1),
        event_type:input.event.event_type,
        workspace_id:ws,object_id:from,service_id:'service:original',revision:null,
        occurred_at:'2026-11-22T10:00:'+String(events.length).padStart(2,'0')+'Z',
        idempotency_key:input.event.idempotency_key,
        payload:structuredClone(input.event.payload??{})};
      events.push(event);
      return {relation:structuredClone(relation),event,deduplicated:false};
    },
  };
  const readOriginalEvents=async()=>events;
  const ports={
    originalKernel:kernel,originalWriteOwnerRef:owner,getMode,
    authorizeOriginalRead:async()=>true,authorizeOriginalWrite:async()=>true,
    authorizeNetworkPublish:async()=>true,readOriginalEvents,
    // This fixture stages one subject mutation at a time; it does not
    // demonstrate installed-product cross-process serialization.
    withOriginalSubjectMutation:async(proof,action)=>{
      assert.equal(proof.originalHostMustSerializeAllWorkspaceGraphMutations,true);
      return action();
    },
    persistOriginalIntent:async value=>{
      if(intents.has(value.captureRef))return false;
      intents.set(value.captureRef,structuredClone(value));return true;
    },
    readOriginalIntent:async value=>intents.get(value.captureRef)??null,
    persistOriginalOutbox:async value=>{
      if(outbox.has(value.captureRef))return false;
      outbox.set(value.captureRef,structuredClone(value));return true;
    },
    readOriginalOutbox:async value=>outbox.get(value.captureRef)??null,
  };
  const transport={
    inspectOutcome:async({key,expectedSha256})=>{
      const bytes=remote.get(key);
      if(!bytes)throw Object.assign(new Error('missing'),{code:'REMOTE_NOT_FOUND'});
      assert.equal(packageSha256(bytes),expectedSha256);
      return {state:'EXPECTED_BYTES_PRESENT',key,sha256:expectedSha256};
    },
    putSnapshot:async({key,bytes,expectedSha256,createOnly})=>{
      networkWrites++;
      assert.equal(createOnly,true);
      assert.equal(packageSha256(bytes),expectedSha256);
      if(!remote.has(key))remote.set(key,Buffer.from(bytes));
      if(loseRemoteAck){
        loseRemoteAck=false;
        throw Object.assign(new Error('lost'),{code:'OUTCOME_UNKNOWN'});
      }
      return {state:'PUBLISHED_AND_READ_BACK',key,sha256:expectedSha256};
    },
  };
  let frontier;
  const dispatcherPorts={
    ...ports,transport,workspaceId:ws,originalWriteOwnerRef:owner,
    networkTargetRef:'network:owner:server',
    listOriginalOutbox:async()=>Array.from(outbox.values()),
    readOriginalDeliveryFrontier:async()=>frontier,
    readOriginalDeliveryAttempt:async value=>attempts.get(value.captureRef)??null,
    persistOriginalDeliveryAttempt:async value=>{
      if(attempts.has(value.captureRef))return false;
      attempts.set(value.captureRef,structuredClone(value));return true;
    },
    readOriginalDeliveryCheckpoint:async value=>
      checkpoints.get(value.captureRef)??null,
    persistOriginalDeliveryCheckpoint:async value=>{
      if(checkpoints.has(value.captureRef))return false;
      checkpoints.set(value.captureRef,structuredClone(value));return true;
    },
  };
  return{
    events,outbox,attempts,checkpoints,remote,transport,dispatcherPorts,ports,
    writes:()=>networkWrites,setMode:value=>{mode=value;},
    loseRemoteAck:()=>{loseRemoteAck=true;},
    setFrontier:value=>{frontier=value;},
    async stage(){
      const cursor=(await readT4OriginalEventWindow({
        workspaceId:ws,originalWriteOwnerRef:owner,
        maxEvents:1,authorizeOriginalRead:async()=>true,
        readOriginalEvents,
      })).nextCursor;
      frontier=cursor;
      await createT4OriginalHostCaptureAdapter(ports).putRelation({
        captureRef:'capture:relation:1',sourceCursor:cursor,
        mutationInput:{workspace_id:ws,relation_id:relationId,
          from_object_id:from,to_object_id:to,kind:'related',
          event:{event_type:'business.link.created',payload:{}}},
      });
    },
    async stageSecond(){
      const first=outbox.get('capture:relation:1');
      assert.ok(first);
      await createT4OriginalHostCaptureAdapter(ports).putRelation({
        captureRef:'capture:relation:2',
        sourceCursor:first.sourceCursorAfter,
        mutationInput:{workspace_id:ws,
          relation_id:'original:relation:two',
          from_object_id:from,to_object_id:to,kind:'related',
          event:{event_type:'business.link.created',payload:{purpose:'second'}}},
      });
    },
    dispatcher:()=>createT4OriginalHostOutboxDispatcher(dispatcherPorts),
  };
}
test('dispatcher publishes original captured Relation once and cold rerun skips verified checkpoint',async()=>{
  const f=fixture();await f.stage();
  const first=await f.dispatcher().drain();
  assert.equal(first.newlyVerifiedCount,1);
  assert.equal(first.results[0].state,'PUBLISHED_AND_READ_BACK');
  assert.equal(first.originalRecipientApplied,false);
  assert.equal(f.writes(),1);
  assert.equal(f.attempts.size,1);
  assert.equal(f.checkpoints.size,1);
  const restarted=await f.dispatcher().drain();
  assert.equal(restarted.previouslyVerifiedCount,1);
  assert.equal(f.writes(),1);
  assert.equal(f.outbox.size,1);
});
test('lost remote ACK is recovered by exact remote readback without another PUT',async()=>{
  const f=fixture();await f.stage();f.loseRemoteAck();
  await assert.rejects(f.dispatcher().drain(),err('DISPATCH_REMOTE_OUTCOME_UNKNOWN'));
  assert.equal(f.writes(),1);
  assert.equal(f.checkpoints.size,0);
  assert.equal(f.attempts.size,1);
  const resumed=await f.dispatcher().drain();
  assert.equal(resumed.results[0].state,'REMOTE_READBACK_RECOVERED');
  assert.equal(f.writes(),1);
  assert.equal(f.checkpoints.size,1);
});
test('unknown prior PUT with missing remote data freezes without automatic retry',async()=>{
  const f=fixture();await f.stage();f.loseRemoteAck();
  await assert.rejects(f.dispatcher().drain(),err('DISPATCH_REMOTE_OUTCOME_UNKNOWN'));
  f.remote.clear();
  await assert.rejects(f.dispatcher().drain(),
    err('DISPATCH_PRIOR_NETWORK_ATTEMPT_UNRESOLVED'));
  assert.equal(f.writes(),1);
});
test('missing original Host causal frontier prevents any network writes',async()=>{
  const f=fixture();await f.stage();
  const wrong={...f.outbox.values().next().value.sourceCursorAfter};
  f.setFrontier(wrong);
  await assert.rejects(f.dispatcher().drain(),err('DISPATCH_ORIGINAL_FRONTIER_GAP'));
  assert.equal(f.writes(),0);
});
test('LOCAL_T3 never delivers staged original network outbox',async()=>{
  const f=fixture();await f.stage();f.setMode('LOCAL_T3');
  await assert.rejects(f.dispatcher().drain(),err('DISPATCH_NETWORK_MODE_OFF'));
  assert.equal(f.writes(),0);
});
test('revoked network authority prevents any outbox delivery',async()=>{
  const f=fixture();await f.stage();
  f.dispatcherPorts.authorizeNetworkPublish=async()=>false;
  await assert.rejects(f.dispatcher().drain(),
    err('DISPATCH_ORIGINAL_OR_NETWORK_AUTHORITY_DENIED'));
  assert.equal(f.writes(),0);
});
test('broken source prefix before publish blocks pending delivery',async()=>{
  const f=fixture();await f.stage();
  f.events[1].payload.tampered=true;
  await assert.rejects(f.dispatcher().drain(),error=>
    error?.code==='DISPATCH_REMOTE_INSPECTION_FAILED'&&
    error.details.originalCode==='OUTBOX_ORIGINAL_EVENT_HISTORY_DIVERGED');
  assert.equal(f.writes(),0);
});
test('unchanged source outbox is preserved after a successful dispatch',async()=>{
  const f=fixture();await f.stage();
  const before=structuredClone([...f.outbox.values()]);
  await f.dispatcher().drain({maxEntries:1});
  assert.deepEqual([...f.outbox.values()],before);
});

test('bounded Host ticks skip verified prefix and advance to next pending dependent event',async()=>{
  const f=fixture();await f.stage();await f.stageSecond();
  const first=await f.dispatcher().drain({maxEntries:1});
  assert.equal(first.newlyVerifiedCount,1);
  assert.equal(first.hasMore,true);
  assert.equal(first.previouslyVerifiedCount,0);
  assert.equal(f.writes(),1);
  const resumed=await f.dispatcher().drain({maxEntries:1});
  assert.equal(resumed.previouslyVerifiedCount,1);
  assert.equal(resumed.newlyVerifiedCount,1);
  assert.equal(resumed.hasMore,false);
  assert.equal(f.writes(),2);
  const idle=await f.dispatcher().drain({maxEntries:1});
  assert.equal(idle.previouslyVerifiedCount,2);
  assert.equal(idle.newlyVerifiedCount,0);
  assert.equal(f.writes(),2);
});
test('dispatcher refuses missing middle source event before writing even when later entry is valid',async()=>{
  const f=fixture();await f.stage();await f.stageSecond();
  f.dispatcherPorts.listOriginalOutbox=async()=>[
    f.outbox.get('capture:relation:2'),
  ];
  await assert.rejects(f.dispatcher().drain({maxEntries:1}),
    err('DISPATCH_ORIGINAL_FRONTIER_GAP'));
  assert.equal(f.writes(),0);
});

test('original Host invalidation after legacy immutable PUT leaves original attempt and recovers via a fresh Host',async()=>{
  const f=fixture();await f.stage();let active=true;
  const put=f.transport.putSnapshot;
  f.transport.putSnapshot=async input=>{
    const result=await put(input);active=false;return result;
  };
  const dispatcher=f.dispatcher();
  await assert.rejects(dispatcher.drain({isHostActive:()=>active}),e=>[
    'DISPATCH_REMOTE_OUTCOME_UNKNOWN','ORIGINAL_HOST_LIFETIME_ENDED',
  ].includes(e?.code));
  assert.equal(f.writes(),1);assert.equal(f.attempts.size,1);assert.equal(f.checkpoints.size,0);
  f.transport.putSnapshot=put;
  const result=await f.dispatcher().drain({isHostActive:()=>true});
  assert.equal(result.results[0].state,'REMOTE_READBACK_RECOVERED');
  assert.equal(f.writes(),1);assert.equal(f.checkpoints.size,1);
});
test('capture adapter retained after original Host invalidation cannot invoke original local or network mutation',async()=>{
  const f=fixture();let active=true;
  const old=createT4OriginalHostCaptureAdapter({...f.ports,isHostActive:()=>active});
  active=false;
  await assert.rejects(old.putObject({}),err('ORIGINAL_HOST_CAPTURE_DISPOSED'));
  f.setMode('LOCAL_T3');active=true;
  await assert.rejects(old.putObject({mutationInput:{workspace_id:ws,object_id:from}}),
    err('ORIGINAL_HOST_CAPTURE_DISPOSED'));
  assert.equal(f.events.length,1);assert.equal(f.outbox.size,0);
});

function selectionPorts(f,cursor,overrides={}){
  const sourceNodeRef='node:original:source',recipientNodeRef='node:original:recipient',scopeRef='scope:original';
  return {...f.dispatcherPorts,sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch:2,
    networkTargetRef:recipientNodeRef,sourceCursorBefore:cursor,
    readOriginalHostContext:async()=>({workspaceId:ws,originalWriteOwnerRef:owner,nodeRef:sourceNodeRef,
      scopeRef,hostSessionRef:'host:original:source'}),
    authorizeOriginalSessionSelection:async p=>p.readOnly===true&&p.originalSourceOwnerRequired===true&&
      p.recipientNodeRef===recipientNodeRef&&p.sourceCursorBefore.sourcePrefixDigest===cursor.sourcePrefixDigest,
    authorizeOriginalWrite:async()=>{throw Error('read-only owner selection cannot request original write');},
    ...overrides};
}
test('K5 source owner resolves exact historical captures from an admitted recipient cursor, without source ACK frontier or plaintext return',async()=>{
  const f=fixture();await f.stage();await f.stageSecond();
  const first=f.outbox.get('capture:relation:1'),second=f.outbox.get('capture:relation:2');
  const before=structuredClone([...f.outbox.values()]);
  const a=await readT4OriginalNativeCaptureSessionAtCursor(selectionPorts(f,first.sourceCursorBefore));
  assert.equal(a.state,'ORIGINAL_NATIVE_SESSION_SELECTED');
  assert.equal(a.originalCaptureEvidenceVerified,true);
  assert.equal(a.session.sourceEventId,first.sourceEventId);
  assert.equal(a.session.sourceRevision,null);assert.equal(a.session.changeKind,'RELATION_PUT');
  assert.equal(a.session.capturedSha256,first.sha256);
  assert.deepEqual(a.sourceCursorAfter,first.sourceCursorAfter);
  assert.equal(a.capturedPlaintextReturned,false);assert.equal(a.capture,undefined);assert.equal(a.prepared,undefined);
  const b=await readT4OriginalNativeCaptureSessionAtCursor(selectionPorts(f,a.sourceCursorAfter));
  assert.equal(b.session.sourceEventId,second.sourceEventId);
  assert.notEqual(b.session.sessionRef,a.session.sessionRef);
  const c=await readT4OriginalNativeCaptureSessionAtCursor(selectionPorts(f,b.sourceCursorAfter));
  assert.equal(c.state,'NO_NEXT_ORIGINAL_EVENT');assert.equal(c.session,null);
  assert.deepEqual(c.sourceCursorAfter,b.sourceCursorAfter);
  assert.deepEqual([...f.outbox.values()],before);assert.equal(f.writes(),0);assert.equal(f.attempts.size,0);
});
test('K5 source owner refuses an unadmitted cursor or missing middle original capture without selecting a later one',async()=>{
  const f=fixture();await f.stage();await f.stageSecond();
  const cursor=f.outbox.get('capture:relation:1').sourceCursorBefore;
  await assert.rejects(readT4OriginalNativeCaptureSessionAtCursor(selectionPorts(f,cursor,{
    authorizeOriginalSessionSelection:async()=>false})),err('DISPATCH_NATIVE_SELECTION_ORIGINAL_AUTHORITY_DENIED'));
  f.outbox.delete('capture:relation:1');
  await assert.rejects(readT4OriginalNativeCaptureSessionAtCursor(selectionPorts(f,cursor)),
    err('DISPATCH_NATIVE_NEXT_ORIGINAL_CAPTURE_NOT_UNIQUE'));
  assert.equal(f.writes(),0);
});
test('K5 original source owner invalidation during selection prevents stale metadata admission',async()=>{
  const f=fixture();await f.stage();let active=true,reads=0;
  const cursor=f.outbox.get('capture:relation:1').sourceCursorBefore;
  await assert.rejects(readT4OriginalNativeCaptureSessionAtCursor(selectionPorts(f,cursor,{
    isHostActive:()=>active,authorizeOriginalSessionSelection:async()=>{active=false;return true;},
    readOriginalEvents:async()=>{reads++;return f.events;},
  })),err('DISPATCH_NATIVE_SELECTION_HOST_DISPOSED'));
  assert.equal(reads,0);assert.equal(f.writes(),0);
});

test('K97 authenticated original owner projects exactly one captured Event without copying history or payload',async()=>{
  const {createT4OriginalSourceEventWindowRequest,readT4OriginalSourceEventWindow,T4_SOURCE_EVENT_WINDOW_OWNER_ACTION}=await import('../src/network/original-source-event-window.mjs');
  const {createT4OriginalReplacementHistoryClient,createT4OriginalReplacementHistoryServer}=await import('../src/network/original-replacement-owner-history-carrier.mjs');
  const f=fixture();await f.stage();await f.stageSecond();
  const before=f.outbox.get('capture:relation:1').sourceCursorBefore,params=selectionPorts(f,before);
  const selected=await readT4OriginalNativeCaptureSessionAtCursor(params);
  const {session}=selected,{sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch}=session;
  const request=createT4OriginalSourceEventWindowRequest({session,sourceCursorBefore:before,requesterNodeRef:recipientNodeRef,ownerNodeRef:sourceNodeRef});
  const tech='original:technical:workspace';let auth=true,confidential=true,busy=false,corrupt=false,reads=0,guards=0;
  const read=async({request:r,peerContext})=>{
    assert.equal(peerContext.nodeRef,recipientNodeRef);
    if(busy)return null;
    const v=await readT4OriginalSourceEventWindow({request:r,technicalWorkspaceId:tech,getMode:params.getMode,
      readOriginalHostContext:async()=>({workspaceId:tech,originalWriteOwnerRef:owner,nodeRef:sourceNodeRef,scopeRef,hostSessionRef:'host:source:original'}),
      authorizeOriginalOwnerHistoryRead:async p=>{guards++;return auth&&p.operation===T4_SOURCE_EVENT_WINDOW_OWNER_ACTION&&p.originalOwnerReadOnly===true;},
      readOriginalCaptureSelection:async(cursor,options)=>{reads++;return readT4OriginalNativeCaptureSessionAtCursor({...selectionPorts(f,cursor),...options});}});
    if(corrupt){const bad=structuredClone(v);bad.window.eventRefs[0].payload={secret:'no'};return bad;}return v;
  };
  const common={scopeRef,ownerEpoch,workspaceId:ws,originalWriteOwnerRef:owner,getMode:params.getMode};
  const peer=nodeRef=>async()=>({nodeRef,scopeRef,ownerEpoch,originalPeerSessionRef:'peer:live',contextEpoch:1,originalPeerAuthenticated:true,originalConfidentialChannelVerified:confidential});
  const server=createT4OriginalReplacementHistoryServer({...common,localNodeRef:sourceNodeRef,peerNodeRef:recipientNodeRef,readOriginalPeerContext:peer(recipientNodeRef),readOriginalReplacementOwnerHistory:read});
  const client=createT4OriginalReplacementHistoryClient({...common,localNodeRef:recipientNodeRef,peerNodeRef:sourceNodeRef,readOriginalPeerContext:peer(sourceNodeRef),invokeOriginalPeerHistory:p=>server(p.requestBytes)});
  const result=await client(request);
  assert.equal(result.window.count,1);assert.equal(result.window.hasMore,true);
  assert.equal(result.window.eventRefs[0].eventDigest,session.sourceEventDigest);assert.deepEqual(result.nextCursor,selected.sourceCursorAfter);
  assert.equal(result.originalEventPayloadReturned,false);assert.equal(result.window.eventRefs[0].payload,undefined);
  assert.equal(result.capture,undefined);assert.equal(result.originalSubjectMutationInvoked,false);assert.equal(reads,1);assert.equal(guards,2);
  busy=true;assert.equal(await client(request),null);busy=false;
  auth=false;await assert.rejects(client(request),err('SOURCE_EVENT_WINDOW_AUTHORITY_DENIED'));assert.equal(reads,1);auth=true;
  confidential=false;await assert.rejects(client(request),err('REPLACEMENT_HISTORY_CARRIER_PEER_UNBOUND'));assert.equal(reads,1);confidential=true;
  corrupt=true;await assert.rejects(client(request),err('ORIGINAL_PROJECTED_EVENT_WINDOW_INVALID'));corrupt=false;
  const later=await readT4OriginalNativeCaptureSessionAtCursor(selectionPorts(f,selected.sourceCursorAfter));
  assert.throws(()=>createT4OriginalSourceEventWindowRequest({session:later.session,sourceCursorBefore:before,requesterNodeRef:recipientNodeRef,ownerNodeRef:sourceNodeRef}),err('SOURCE_EVENT_WINDOW_REQUEST_INVALID'));
  assert.equal(f.writes(),0);assert.equal(f.attempts.size,0);
});


test('K101 original capture binding projects only the independently captured subject metadata',async()=>{
  const {createT4OriginalSourceEventWindowRequest,readT4OriginalSourceEventWindow,createT4OriginalSourceCaptureVerifier}=await import('../src/network/original-source-event-window.mjs');
  const f=fixture();await f.stage();await f.stageSecond();
  const before=f.outbox.get('capture:relation:1').sourceCursorBefore,params=selectionPorts(f,before);
  const selected=await readT4OriginalNativeCaptureSessionAtCursor(params),session=selected.session;
  const {sourceNodeRef,recipientNodeRef,scopeRef}=session;
  const tech='original:technical:workspace';let ref='host:original:source';
  const readOriginalSourceCaptureSnapshot=async request=>readT4OriginalSourceEventWindow({request,technicalWorkspaceId:tech,getMode:params.getMode,
    readOriginalHostContext:async()=>({workspaceId:tech,originalWriteOwnerRef:owner,nodeRef:sourceNodeRef,scopeRef,hostSessionRef:ref}),
    authorizeOriginalOwnerHistoryRead:async()=>true,
    readOriginalCaptureSelection:(cursor,options)=>readT4OriginalNativeCaptureSessionAtCursor({...selectionPorts(f,cursor),...options,
      readOriginalHostContext:async()=>({workspaceId:ws,originalWriteOwnerRef:owner,nodeRef:sourceNodeRef,scopeRef,hostSessionRef:ref})})});
  const request=createT4OriginalSourceEventWindowRequest({session,sourceCursorBefore:before,requesterNodeRef:recipientNodeRef,ownerNodeRef:sourceNodeRef,includeOriginalCaptureBinding:true});
  const v=await readOriginalSourceCaptureSnapshot(request),b=v.originalCaptureBinding;
  assert.deepEqual(Object.keys(b).sort(),['objectId','relationContentDigest','sourceHostSessionRef','subjectId','toObjectId']);
  assert.equal(b.subjectId,relationId);assert.equal(b.objectId,from);assert.equal(b.toObjectId,to);
  assert.equal(b.sourceHostSessionRef,ref);
  const verifier=createT4OriginalSourceCaptureVerifier({session,sourceCursorBefore:before,readOriginalSourceCaptureSnapshot,getMode:params.getMode});
  const proof={operation:'t4.original-relation-source.verify',workspaceId:ws,originalWriteOwnerRef:owner,sourceEventId:session.sourceEventId,
    sourceEventDigest:session.sourceEventDigest,windowDigest:session.capturedWindowDigest,networkEnvelopeIsNotSignedEvidence:true,
    relationId,fromObjectId:from,toObjectId:to,relationContentDigest:b.relationContentDigest,originalSubjectKind:session.changeKind,
    originalSubjectId:relationId,originalSubjectDeltaSha256:session.capturedSha256};
  const h={schema:'IWXA_T4_ORIGINAL_SOURCE_NETWORK_HEAD_PROOF_V1',signedHeadMatchesOriginalT3EventPrefix:true,signedDiffMatchesOriginalT3Frontier:true,
    originalSourceSubjectIndependentlyRead:true,originalBusinessApplied:false,originalT3ExchangeUsed:false,
    workspaceId:ws,originalWriteOwnerRef:owner,sourceNodeRef,recipientNodeRef,scopeRef,sessionRef:session.sessionRef,ownerEpoch:session.ownerEpoch,
    changeId:session.changeId,changeKind:session.changeKind,originalSourceEventId:session.sourceEventId,originalEventDigest:session.sourceEventDigest,
    originalSourceRevision:session.sourceRevision,sourceEventWindowDigest:session.capturedWindowDigest,sourcePrefixDigestBefore:session.sourcePrefixDigestBefore,
    sourcePrefixDigestAfter:session.sourcePrefixDigestAfter,originalCapturedRevisionProofRequired:true,ciphertextContentDigest:'sha256:'+'0'.repeat(64)};
  const binding={operation:'t4.network.original.sealed.open',sourceNodeRef,recipientNodeRef,scopeRef,sessionRef:session.sessionRef,
    changeId:session.changeId,changeKind:session.changeKind,sourceEventId:session.sourceEventId,ownerRef:owner,originalEventDigest:session.sourceEventDigest,
    sourcePrefixDigestAfter:session.sourcePrefixDigestAfter,contentDigest:h.ciphertextContentDigest,originalSourceHeadProof:h,
    originalT3SourceSubjectEventAndContentReadbackRequired:true,originalWorkspaceId:ws,originalSourceRevision:session.sourceRevision,
    originalSourceEventDigest:session.sourceEventDigest,originalEventWindowDigest:session.capturedWindowDigest,originalSubjectKind:session.changeKind,
    originalSubjectId:relationId,originalSubjectDeltaSha256:session.capturedSha256};
  assert.equal(await verifier.verifyOriginalSourceEvent(proof),false);
  assert.equal(await verifier.verifyOriginalSourceBinding(binding),true);
  assert.equal(await verifier.verifyOriginalSourceEvent(proof),true);
  assert.equal(await verifier.verifyOriginalSourceEvent({...proof,toObjectId:'object:forged'}),false);
  ref='host:original:restarted';await assert.rejects(verifier.verifyOriginalSourceBinding(binding),err('SOURCE_CAPTURE_VERIFIER_OWNER_CHANGED'));
  assert.equal(await verifier.verifyOriginalSourceEvent(proof),false);
  assert.equal(f.writes(),0);
});

test('K151 exact original source selection uses scoped Event lookup instead of broad capture inventory and never falls back on denial',async()=>{
  const f=fixture();await f.stage();await f.stageSecond();
  const first=f.outbox.get('capture:relation:1');
  const args=selectionPorts(f,first.sourceCursorBefore);
  let selected=0;
  const result=await readT4OriginalNativeCaptureSessionAtCursor({...args,
    listOriginalOutbox:async()=>assert.fail('unscoped outbox inventory'),
    listOriginalOutboxForSourceEvent:async q=>{
      selected++;assert.equal(q.sourceEventId,first.sourceEventId);
      assert.equal(q.workspaceId,ws);assert.equal(q.originalWriteOwnerRef,owner);return [first];
    }});
  assert.equal(result.state,'ORIGINAL_NATIVE_SESSION_SELECTED');assert.equal(selected,1);
  assert.equal(result.session.sourceEventId,first.sourceEventId);assert.equal(result.session.capturedSha256,first.sha256);
  await assert.rejects(readT4OriginalNativeCaptureSessionAtCursor({...args,
    listOriginalOutbox:async()=>assert.fail('fallback to unscoped inventory'),
    listOriginalOutboxForSourceEvent:async()=>{throw Object.assign(Error('selected denial'),{code:'SELECTED_DENIED'});}
  }),{code:'SELECTED_DENIED'});
  assert.equal(f.writes(),0);
});
