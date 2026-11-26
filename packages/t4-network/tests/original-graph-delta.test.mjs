import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign,verify} from 'node:crypto';
import {createT4OriginalHostCaptureAdapter} from '../src/network/original-host-capture-adapter.mjs';
import {createT4OriginalHostCaptureLedgerPort} from '../src/network/original-host-capture-ledger.mjs';
import {readT4OriginalEventWindow} from '../src/network/original-event-window.mjs';
import {readT4OriginalHostCapturedSubject,verifyT4OriginalHostCapturedSubjectSource,publishT4OriginalHostOutbox}
  from '../src/network/original-host-outbox-delivery.mjs';
import {readT4OriginalNativeCaptureSessionAtCursor} from '../src/network/original-host-outbox-dispatcher.mjs';
import {decodeT4OriginalGraphDeltaBytes,verifyT4OriginalGraphDelta,applyT4OriginalGraphDelta,
  captureT4OriginalGraphMutation,reconcileT4OriginalGraphMutation,inspectT4OriginalGraphResult}
  from '../src/network/original-graph-delta.mjs';
import {createT4OriginalNetworkSessionPhasePort} from '../src/network/original-network-session-phases.mjs';
import {applyT4OriginalNetworkSubjectWithDurableIntent,applyT4OriginalNetworkSubjectChange,
  inspectT4OriginalNetworkRecipientResult,createT4OriginalNetworkAppliedAckBody}
  from '../src/network/original-network-subject-apply.mjs';
import {T4_ATOMIC_GRAPH_EXTENSION,createT4CandidateUnsignedFrame,signT4CandidateFrame,
  decodeT4CandidateFrame,verifyT4CandidateWireFrame,matchesT4NativeSubjectCriticalExtensions,t4NativeSubjectCriticalExtensions}
  from '../src/network/standard-network-wire-candidate.mjs';
const ws='ws:k21:business',owner='owner:k21',source='node:k21:source',recipient='node:k21:recipient',
  scopeRef='scope:k21',target='o:k21:target',a='o:k21:a',b='o:k21:b',old='r:k21:old',fresh='r:k21:new';
const allow=async()=>true,clone=x=>structuredClone(x),H=x=>'sha256:'+createHash('sha256').update(x).digest('hex');
const mode=()=> 'T4_NETWORK';
const err=code=>({code});
const rel=(id,from,to,kind)=>({relation_id:id,from_object_id:from,to_object_id:to,kind});
function store(name){
  const objects=new Map(),relations=new Map(),events=[],replays=new Map();let seq=0,graphWrites=0,graphInvocations=0,lose=false;
  const objectKey=(w,id)=>w+':'+id;
  const event=(p,id,revision,extra={})=>({event_id:'event:k21:'+name+':'+(++seq),
    workspace_id:p.workspace_id,object_id:id,revision,event_type:p.event.event_type,
    service_id:'service:k21',occurred_at:new Date(Date.UTC(2026,10,24,0,0,seq)).toISOString(),
    // Original EventRecord from the native Kernel includes optional fields
    // with undefined values, including on ordinary historical putObject.
    // JSON transport may omit the same fields on the next read.
    causation_id:undefined,correlation_id:undefined,idempotency_key:undefined,
    payload:clone(p.event.payload??{}),...extra});
  function save(w,input){
    const key=objectKey(w,input.object_id),prior=objects.get(key);
    if(input.base_revision!==undefined&&input.base_revision!==(prior?.revision??0))throw Error('revision');
    const result={workspace_id:w,object_id:input.object_id,schema_id:input.schema_id,
      schema_version:input.schema_version,revision:(prior?.revision??0)+1,deleted:false,
      data:clone(input.data),extensions:{...prior?.extensions,...input.extensions}};
    objects.set(key,result);return result;
  }
  const kernel={hasOperation:()=>true,sessionInfo:{service_id:'service:k21'},
    async getObject(w,id){const object=objects.get(objectKey(w,id));if(!object)return null;
      const rows=[...relations.values()].filter(r=>r.workspace_id===w);
      return clone({object,relations:{incoming:rows.filter(r=>r.to_object_id===id),
        outgoing:rows.filter(r=>r.from_object_id===id)}});},
    async listObjects(q){return clone([...objects.values()].filter(o=>o.workspace_id===q.workspace_id&&
      (q.include_deleted===true||!o.deleted)));},
    async listEventsSince(w){return clone(events.filter(e=>e.workspace_id===w));},
    async putObject(p){const object=save(p.workspace_id,p),ev=event(p,p.object_id,object.revision);
      events.push(ev);return clone({object,event:ev});},
    async commitObjectGraph(p){
      graphInvocations++;
      const key=p.workspace_id+':'+p.idempotency_key,prior=replays.get(key);
      if(prior){assert.deepEqual(p,prior.input);return clone({...prior.receipt,deduplicated:true});}
      for(const r of p.relation_puts??[])assert.ok(!relations.has(r.relation_id));
      for(const r of p.relation_deletes??[])assert.ok(relations.has(r.relation_id));
      const object=save(p.workspace_id,p.object),transaction_id='tx:k21:'+name+':'+(graphWrites+1);
      graphWrites++;
      const puts=(p.relation_puts??[]).map(r=>({...r,workspace_id:p.workspace_id,created_by_service:'service:k21'}));
      const deletes=(p.relation_deletes??[]).map(r=>r.relation_id);
      for(const r of puts)relations.set(r.relation_id,r);
      for(const id of deletes)relations.delete(id);
      const ev=event(p,object.object_id,object.revision,{correlation_id:transaction_id,idempotency_key:p.idempotency_key});
      events.push(ev);
      const receipt={transaction_id,workspace_id:p.workspace_id,object,event:ev,relations_put:puts,
        relation_ids_deleted:deletes,deduplicated:false};
      replays.set(key,{input:clone(p),receipt:clone(receipt)});
      if(lose){lose=false;throw Object.assign(Error('original response lost'),{code:'ACK_LOST'});}
      return clone(receipt);
    }};
  return {kernel,objects,relations,events,loseAck(){lose=true},get graphWrites(){return graphWrites},get graphInvocations(){return graphInvocations}};
}
async function seeded(name){
  const f=store(name);
  for(const id of [target,a,b])await f.kernel.putObject({workspace_id:ws,object_id:id,
    schema_id:'iwxa.demo.note',schema_version:'1.0.0',base_revision:0,
    data:{title:id},extensions:{preserved:'original'},event:{event_type:'business.baseline'}});
  f.relations.set(old,{...rel(old,a,b,'old dependency'),workspace_id:ws,created_by_service:'service:k21'});
  return f;
}
const input=(revision=1)=>({workspace_id:ws,idempotency_key:'original graph '+revision,
  object:{object_id:target,schema_id:'iwxa.demo.note',schema_version:'1.0.0',base_revision:revision,
    data:{title:'Graph '+revision},extensions:{added:revision}},
  relation_puts:[rel(revision===1?fresh:'r:k21:second',target,b,'new dependency')],
  relation_deletes:[{relation_id:revision===1?old:fresh}],
  event:{event_type:'business.graph.changed',payload:{revision}}});
async function fixture({prepareSource=()=>{}}={}){
  const f=await seeded('source'),technicalWorkspaceId='ws:k21:source:technical';
  await prepareSource(f);
  const cursor=(await readT4OriginalEventWindow({workspaceId:ws,originalWriteOwnerRef:owner,
    authorizeOriginalRead:allow,readOriginalEvents:()=>f.kernel.listEventsSince(ws)})).nextCursor;
  const ledger=createT4OriginalHostCaptureLedgerPort({originalKernel:f.kernel,technicalWorkspaceId,sourceWorkspaceId:ws,
    originalWriteOwnerRef:owner,getMode:mode,readOriginalHostContext:async()=>({workspaceId:technicalWorkspaceId,
      originalWriteOwnerRef:owner,hostSessionRef:'host:k21:ledger'}),
    authorizeOriginalTechnicalRead:allow,authorizeOriginalTechnicalWrite:allow});
  const common={...ledger,workspaceId:ws,originalWriteOwnerRef:owner,getMode:mode,originalKernel:f.kernel,
    authorizeOriginalRead:allow,authorizeOriginalWrite:allow,authorizeNetworkPublish:allow,
    readOriginalEvents:()=>f.kernel.listEventsSince(ws)};
  let held=false,entries=0;
  const host=(overrides={})=>createT4OriginalHostCaptureAdapter({...common,
    readOriginalAdmittedBaseline:async()=>{assert.equal(held,true);return {
      schema:'IWXA_T4_ORIGINAL_SOURCE_BASELINE_V1',identity:{sourceWorkspaceId:ws,originalWriteOwnerRef:owner},
      originalBaselineRef:'baseline:k21',originalBaselineDigest:H('baseline'),sourceCursor:cursor};},
    authorizeOriginalCaptureRecovery:allow,withOriginalSubjectMutation:async(proof,action)=>{
      assert.equal(held,false);assert.equal(proof.originalHostMustSerializeAllWorkspaceGraphMutations,true);
      held=true;entries++;try{return await action();}finally{held=false;}
    },...overrides});
  const read=(captureRef)=>readT4OriginalHostCapturedSubject({...common,kind:'GRAPH_COMMIT',subjectId:target,captureRef});
  const capture=async()=>{const h=host();const r=await h.commitObjectGraph({mutationInput:input(),captureRef:'capture:k21:one'});
    h.dispose();return r;};
  return {...f,ledger,common,cursor,host,read,capture,get graphWrites(){return f.graphWrites},
    get graphInvocations(){return f.graphInvocations},get entries(){return entries}};
}
async function recipientFixture(captured,{loseAck=false}={}){
  const f=await seeded('recipient'),d=captured.prepared.delta,technicalWorkspaceId='ws:k21:recipient:technical';
  const received={schema:'IWXA_T4_ORIGINAL_NETWORK_SUBJECT_RECEIVED_V1',changeKind:'GRAPH_COMMIT',
    originalSubjectId:target,originalSourceRevision:d.sourceRevision,originalSourceEventAndSubjectVerified:true,
    changeId:'change:k21',contentDigest:H('ciphertext'),sourceNodeRef:source,recipientNodeRef:recipient,
    scopeRef,sessionRef:'session:k21',encryptionContextRef:'key:k21',ownerEpoch:1,
    sourceChangeFrameKey:'a'.repeat(64)+'.t4n',originalEventDigest:d.sourceEventDigest,
    sourcePrefixDigestAfter:captured.sourceWindow.sourcePrefixDigestAfter,
    originalStateDigest:d.graphContentDigest,delta:clone(d),sha256:captured.prepared.sha256,key:captured.prepared.key,
    originalHostAuthenticatedOpen:true,originalRecipientSubjectPermissionGranted:false,originalT3ExchangeCalled:false};
  const phase=()=>createT4OriginalNetworkSessionPhasePort({originalKernel:f.kernel,technicalWorkspaceId,
    originalWriteOwnerRef:owner,sourceNodeRef:source,recipientNodeRef:recipient,localNodeRef:recipient,
    scopeRef,sessionRef:received.sessionRef,changeId:received.changeId,ownerEpoch:1,changeKind:'GRAPH_COMMIT',
    recipientApplyIntentRequired:true,getMode:mode,readOriginalHostContext:async()=>({
      workspaceId:technicalWorkspaceId,originalWriteOwnerRef:owner,nodeRef:recipient,scopeRef,hostSessionRef:'host:k21:recipient'}),
    authorizeOriginalTechnicalRead:allow,authorizeOriginalTechnicalWrite:allow,verifyOriginalPhaseEvidence:allow,
    verifyOriginalRecipientApplied:allow});
  const port=phase();
  await port.advanceOriginalSessionPhase({phase:'RECEIVED',evidence:{evidenceRef:'frame:k21:chunk',evidenceDigest:H('chunk')}});
  await port.advanceOriginalSessionPhase({phase:'VERIFIED',evidence:{evidenceRef:received.sourceChangeFrameKey,evidenceDigest:d.graphContentDigest}});
  let held=false,entries=0;
  const args=()=>({received,originalKernel:f.kernel,getMode:mode,authorizeOriginalRead:allow,
    authorizeOriginalWrite:allow,verifyOriginalSourceEvent:async p=>p.kind==='GRAPH_COMMIT'&&
      p.wireSha256===received.sha256&&p.graphContentDigest===d.graphContentDigest,
    recipientPhasePort:phase(),withOriginalSubjectMutation:async(proof,action)=>{
      assert.equal(proof.originalHostMustSerializeAllWorkspaceGraphMutations,true);assert.equal(held,false);
      held=true;entries++;try{return await action();}finally{held=false;}
    }});
  if(loseAck)f.loseAck();
  return {...f,args,phase,received,get graphWrites(){return f.graphWrites},
    get graphInvocations(){return f.graphInvocations},get entries(){return entries}};
}
test('K21 one original graph transaction captures Object, relation creation and unrelated relation deletion; historical Outbox survives next graph',async()=>{
  const f=await fixture(),one=await f.capture();
  assert.equal(f.graphWrites,1);
  assert.equal(one.originalReceipt.transaction_id,one.originalReceipt.event.correlation_id);
  assert.equal(one.originalReceipt.event.idempotency_key,input().idempotency_key);
  assert.equal(one.capture.window.count,1);
  assert.deepEqual(one.capture.prepared.delta.relationDeletes,[rel(old,a,b,'old dependency')]);
  assert.deepEqual(one.capture.prepared.delta.extensions,{added:1,preserved:'original'});
  const cold=f.host(),two=await cold.commitObjectGraph({mutationInput:input(2),captureRef:'capture:k21:two'});
  assert.equal(f.graphWrites,2);assert.equal(two.capture.nextCursor.seenEventCount,f.cursor.seenEventCount+2);
  assert.equal((await f.ledger.listOriginalPendingIntents({workspaceId:ws,originalWriteOwnerRef:owner})).length,0);
  const history=await f.read('capture:k21:one');
  assert.equal(history.laterSourceEventsExist,true);assert.equal(history.currentObjectReadOrUsedAsHistoricalBytes,false);
  assert.equal(history.prepared.sha256,one.capture.prepared.sha256);
  assert.equal(history.prepared.delta.graphContentDigest,one.capture.prepared.delta.graphContentDigest);
  const selected=await readT4OriginalNativeCaptureSessionAtCursor({...f.common,sourceNodeRef:source,
    recipientNodeRef:recipient,networkTargetRef:recipient,scopeRef,ownerEpoch:1,sourceCursorBefore:f.cursor,
    readOriginalHostContext:async()=>({workspaceId:ws,originalWriteOwnerRef:owner,nodeRef:source,scopeRef,
      hostSessionRef:'host:k21:source'}),authorizeOriginalSessionSelection:allow});
  assert.equal(selected.session.changeKind,'GRAPH_COMMIT');assert.equal(selected.session.capturedSha256,history.prepared.sha256);
  assert.equal(selected.sourceCursorAfter.seenEventCount,f.cursor.seenEventCount+1);
  await assert.rejects(publishT4OriginalHostOutbox({...f.common,kind:'GRAPH_COMMIT',subjectId:target,
    captureRef:'capture:k21:one'}),err('OUTBOX_GRAPH_REQUIRES_NATIVE_NETWORK'));
});
test('K21 lost original graph receipt is reconciled through original Event and all relation postconditions, never repeated',async()=>{
  const f=await fixture(),h=f.host();f.loseAck();
  await assert.rejects(h.commitObjectGraph({mutationInput:input(),captureRef:'capture:k21:lost'}),err('GRAPH_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  assert.equal(f.graphWrites,1);
  assert.equal((await f.ledger.listOriginalPendingIntents({workspaceId:ws,originalWriteOwnerRef:owner}))[0].kind,'GRAPH_COMMIT');
  const cold=f.host();
  await assert.rejects(cold.commitObjectGraph({mutationInput:input(2),captureRef:'capture:k21:blocked'}),
    err('CAPTURE_FRONTIER_ORIGINAL_INTENT_UNRESOLVED'));
  const recovered=await cold.reconcileNextOriginalCapture({workspaceId:ws});
  assert.equal(recovered.state,'ORIGINAL_CAPTURE_RECONCILED');assert.equal(recovered.kind,'GRAPH_COMMIT');
  assert.equal(recovered.originalMutationRetried,false);assert.equal(f.graphWrites,1);
  const exact=await f.read('capture:k21:lost');
  assert.equal(exact.prepared.delta.originalTransactionId,'tx:k21:source:1');
  await cold.commitObjectGraph({mutationInput:input(2),captureRef:'capture:k21:after'});
  assert.equal(f.graphWrites,2);
});
test('K21 exact source capture denies duplicate relation, missing deletion and already-used idempotency before new Intent',async()=>{
  const f=await fixture(),h=f.host();
  await assert.rejects(h.commitObjectGraph({mutationInput:{...input(),relation_puts:[rel(old,target,b,'x')]},
    captureRef:'capture:k21:duplicate'}),err('GRAPH_DUPLICATE_RELATION'));
  await assert.rejects(h.commitObjectGraph({mutationInput:{...input(),relation_deletes:[{relation_id:'r:missing'}]},
    captureRef:'capture:k21:missing'}),err('GRAPH_ORIGINAL_PREIMAGE_CONFLICT'));
  assert.equal(f.graphWrites,0);
  await f.capture();
  await assert.rejects(h.commitObjectGraph({mutationInput:input(),captureRef:'capture:k21:duplicate-command'}),
    err('GRAPH_ORIGINAL_IDEMPOTENCY_ALREADY_USED'));
  assert.equal(f.graphWrites,1);
  assert.equal((await f.ledger.listOriginalPendingIntents({workspaceId:ws,originalWriteOwnerRef:owner})).length,0);
});
test('K21 graph source proof binds exact canonical deletion and creation bytes, not just the Object',async()=>{
  const f=await fixture();await f.capture();
  const c=await f.read('capture:k21:one'),d=c.prepared.delta,w=c.sourceWindow;
  const proof={originalSourceEventId:d.sourceEventId,originalWriteOwnerRef:owner,originalEventDigest:d.sourceEventDigest,
    sourcePrefixDigestAfter:w.sourcePrefixDigestAfter,originalSourceHeadProof:{originalCapturedRevisionProofRequired:true,
      changeKind:'GRAPH_COMMIT',workspaceId:ws,originalSourceRevision:2,originalEventRevision:2,
      sourceEventWindowDigest:d.windowDigest,sourcePrefixDigestBefore:w.sourcePrefixDigestBefore,
      sourcePrefixDigestAfter:w.sourcePrefixDigestAfter},
    originalT3SourceSubjectEventAndContentReadbackRequired:true,originalSubjectKind:'GRAPH_COMMIT',
    originalSubjectId:target,originalWorkspaceId:ws,originalSourceRevision:2,
    originalSubjectDeltaSha256:c.prepared.sha256,originalSourceEventDigest:d.sourceEventDigest,originalEventWindowDigest:d.windowDigest};
  const p={...f.common,kind:'GRAPH_COMMIT',captureRef:c.captureRef,subjectId:target};
  assert.equal(await verifyT4OriginalHostCapturedSubjectSource(p,proof),true);
  assert.equal(await verifyT4OriginalHostCapturedSubjectSource(p,{...proof,originalSubjectDeltaSha256:'0'.repeat(64)}),false);
  assert.deepEqual(decodeT4OriginalGraphDeltaBytes(c.prepared.bytes).delta,d);
  assert.throws(()=>verifyT4OriginalGraphDelta({...d,relationPuts:[]}),err('GRAPH_DELTA_CONTENT_MISMATCH'));
  assert.throws(()=>decodeT4OriginalGraphDeltaBytes(Buffer.from(JSON.stringify(d,null,1))),err('GRAPH_DELTA_NOT_CANONICAL'));
});
test('K21 graph recipient applies one original atomic transaction under durable intent; lost ACK recovers without writing twice',async()=>{
  const sourceStore=await fixture();await sourceStore.capture();
  const f=await recipientFixture(await sourceStore.read('capture:k21:one'),{loseAck:true});
  await assert.rejects(applyT4OriginalNetworkSubjectChange(f.args()),err('SUBJECT_NATIVE_GRAPH_REQUIRES_DURABLE_APPLY_INTENT'));
  const noBoundary=f.args();delete noBoundary.withOriginalSubjectMutation;
  await assert.rejects(applyT4OriginalNetworkSubjectWithDurableIntent(noBoundary),err('SUBJECT_NATIVE_GRAPH_ORIGINAL_MUTATION_BOUNDARY_REQUIRED'));
  await assert.rejects(applyT4OriginalNetworkSubjectWithDurableIntent(f.args()),err('SUBJECT_ORIGINAL_APPLY_OUTCOME_UNKNOWN'));
  assert.equal(f.graphWrites,1);assert.equal((await f.phase().inspectOriginalSession()).currentPhase,'APPLY_INTENT');
  const recovered=await applyT4OriginalNetworkSubjectWithDurableIntent(f.args());
  assert.equal(recovered.status,'ALREADY_APPLIED_FROM_ORIGINAL_T3');assert.equal(recovered.originalCommitInvoked,false);
  assert.equal(recovered.actualOriginalT3GraphReadback,true);assert.equal(f.graphWrites,1);
  assert.equal(f.relations.has(old),false);assert.equal(f.relations.get(fresh).from_object_id,target);
  const ack=createT4OriginalNetworkAppliedAckBody({received:f.received,verifiedResult:recovered,ackRef:'ack:k21'});
  assert.equal(ack.recipientStateDigest,f.received.originalStateDigest);assert.equal(ack.recipientRevision,2);
  assert.throws(()=>createT4OriginalNetworkAppliedAckBody({received:f.received,verifiedResult:{...recovered,
    actualOriginalT3GraphReadback:false},ackRef:'ack:k21'}),err('SUBJECT_APPLIED_ACK_REQUIRES_ORIGINAL_RESULT'));
  // A changed relation cannot be hidden behind an unchanged Object/Event.
  f.relations.get(fresh).kind='corrupted dependency';
  await assert.rejects(inspectT4OriginalNetworkRecipientResult(f.args()),err('GRAPH_ORIGINAL_READBACK_MISMATCH'));
});
test('K21 recipient detects relation preimage conflict even when object base revision and content are correct',async()=>{
  const s=await fixture();await s.capture();
  const f=await recipientFixture(await s.read('capture:k21:one'));
  f.relations.get(old).to_object_id=target;
  await assert.rejects(applyT4OriginalNetworkSubjectWithDurableIntent(f.args()),err('GRAPH_ORIGINAL_PREIMAGE_CONFLICT'));
  assert.equal(f.graphWrites,0);assert.equal((await f.phase().inspectOriginalSession()).currentPhase,'VERIFIED');
});
test('K21 GRAPH_COMMIT is an explicit critical protocol capability, not a legacy object change',async()=>{
  const body={changeId:'change:k21',changeKind:'GRAPH_COMMIT',eventRef:'event:k21',ownerRef:owner,
    sourceRevision:2,contentDigest:H('cipher'),parents:[H('parent')]};
  const fields={messageType:'CHANGE_REF',sequence:1,messageId:'message:k21',sourceNodeRef:source,
    recipientNodeRef:recipient,sessionRef:'session:k21',scopeRef,ownerEpoch:1,permissionRef:'permission:k21',
    signerRef:'key:k21',cryptoSuite:'X25519_AES256GCM_ED25519',body};
  assert.throws(()=>createT4CandidateUnsignedFrame({...fields,criticalExtensions:[]}),err('WIRE_CHANGE_REF_INVALID'));
  const extensions=t4NativeSubjectCriticalExtensions('GRAPH_COMMIT');
  assert.deepEqual(extensions,[T4_ATOMIC_GRAPH_EXTENSION]);
  assert.equal(matchesT4NativeSubjectCriticalExtensions('OBJECT_PUT',extensions),false);
  const keys=generateKeyPairSync('ed25519');
  const wire=await signT4CandidateFrame({unsignedFrame:createT4CandidateUnsignedFrame({...fields,criticalExtensions:extensions}),
    signOriginalNodeBytes:async({bytes})=>sign(null,Buffer.from(bytes),keys.privateKey)});
  assert.equal(decodeT4CandidateFrame(wire).body.changeKind,'GRAPH_COMMIT');
  assert.deepEqual(decodeT4CandidateFrame(wire).criticalExtensions,extensions);
  let checks=0,records=0;
  const ports={wireBytes:wire,recipientNodeRef:recipient,scopeRef,requiredCryptoSuite:fields.cryptoSuite,
    verifyOriginalNodeSignature:async({bytes,signature})=>{checks++;return verify(null,Buffer.from(bytes),keys.publicKey,Buffer.from(signature));},
    authorizeOriginalNetwork:allow,persistOriginalReplayDecision:async()=>{records++;return 'RECORDED';}};
  await assert.rejects(verifyT4CandidateWireFrame({...ports,supportedCriticalExtensions:[]}),err('WIRE_UNSUPPORTED_CRITICAL_EXTENSION'));
  assert.equal(checks,0);assert.equal(records,0);
  const verdict=await verifyT4CandidateWireFrame({...ports,supportedCriticalExtensions:extensions});
  assert.equal(verdict.originalSignatureVerified,true);assert.equal(verdict.originalBusinessApplied,false);
  assert.equal(checks,1);assert.equal(records,1);
});

test('K21 graph rejects a one-sided original relation view before any mutation',async()=>{
  const f=await fixture(),get=f.kernel.getObject;
  f.kernel.getObject=async(w,id)=>{
    const row=await get(w,id);
    if(w===ws&&id===b&&row)row.relations.incoming=row.relations.incoming.filter(r=>r.relation_id!==old);
    return row;
  };
  await assert.rejects(f.host().commitObjectGraph({mutationInput:input(),captureRef:'capture:k21:one-sided'}),
    err('GRAPH_ORIGINAL_RELATION_ENDPOINT_MISMATCH'));
  assert.equal(f.graphWrites,0);
  assert.equal((await f.ledger.listOriginalPendingIntents({workspaceId:ws,originalWriteOwnerRef:owner})).length,0);
});
test('K21 graph recipient does not acknowledge an incomplete original relation endpoint view',async()=>{
  const sourceStore=await fixture();await sourceStore.capture();
  const f=await recipientFixture(await sourceStore.read('capture:k21:one'));
  await applyT4OriginalNetworkSubjectWithDurableIntent(f.args());
  const get=f.kernel.getObject;
  f.kernel.getObject=async(w,id)=>{
    const row=await get(w,id);
    if(w===ws&&id===b&&row)row.relations.incoming=row.relations.incoming.filter(r=>r.relation_id!==fresh);
    return row;
  };
  await assert.rejects(inspectT4OriginalNetworkRecipientResult(f.args()),err('GRAPH_ORIGINAL_RELATION_ENDPOINT_MISMATCH'));
  assert.equal(f.graphWrites,1);
});

test('K21 committed original graph is reconciled from its historical immutable Outbox and exact native replay returns the original receipt',async()=>{
  const f=await fixture(),first=await f.capture(),h=f.host();
  await h.commitObjectGraph({mutationInput:input(2),captureRef:'capture:k21:two'});
  const recovered=await h.reconcileGraphMutation({workspaceId:ws,objectId:target,captureRef:'capture:k21:one'});
  assert.equal(recovered.historicalOutboxVerified,true);
  assert.equal(recovered.originalReceipt,null);assert.equal(recovered.originalMutationRetried,false);
  assert.equal(recovered.prepared.sha256,first.capture.prepared.sha256);
  const before=f.events.length;
  const replay=await h.commitObjectGraph({mutationInput:input(),captureRef:'capture:k21:one'});
  assert.equal(replay.originalReceipt.deduplicated,true);
  assert.equal(replay.originalReceipt.transaction_id,first.originalReceipt.transaction_id);
  assert.equal(replay.capture.originalDeduplicatedReceiptVerified,true);
  assert.equal(replay.capture.prepared.sha256,first.capture.prepared.sha256);
  assert.equal(f.graphWrites,2);assert.equal(f.graphInvocations,3);assert.equal(f.events.length,before);
  await assert.rejects(h.commitObjectGraph({mutationInput:{...input(),event:{event_type:'business.changed',payload:{}}},
    captureRef:'capture:k21:one'}),err('GRAPH_IDEMPOTENCY_PAYLOAD_MISMATCH'));
  assert.equal(f.graphInvocations,3);assert.equal(f.events.length,before);
});

test('K21 original EventRecord optional fields may be omitted on one read and undefined on another; strict wire still rejects non-JSON subject data',async()=>{
  const f=await fixture(),read=f.kernel.listEventsSince;
  let n=0;
  f.kernel.listEventsSince=async w=>{
    const rows=await read(w);
    return ++n%2===0?JSON.parse(JSON.stringify(rows)):rows;
  };
  const first=await f.capture();
  assert.equal(first.capture.originalT3OutboxVerified,true);
  assert.equal(f.graphWrites,1);
  const bad=input(2);bad.object.data.unserializable=undefined;
  await assert.rejects(f.host().commitObjectGraph({mutationInput:bad,captureRef:'capture:k21:bad-json'}),
    err('OBJECT_DELTA_NON_JSON'));
  assert.equal(f.graphWrites,1);
  assert.equal((await f.read('capture:k21:one')).prepared.sha256,first.capture.prepared.sha256);
  const receiver=await recipientFixture(await f.read('capture:k21:one'));
  const received=await applyT4OriginalNetworkSubjectWithDurableIntent(receiver.args());
  assert.equal(received.originalBusinessApplied,true);assert.equal(received.actualOriginalT3GraphReadback,true);
  assert.equal(received.status,'APPLIED_BY_ORIGINAL_T3');assert.equal(received.originalCommitInvoked,true);
  assert.equal(receiver.graphWrites,1);
});

test('K22 automatic graph frontier uses verified paired original inventory instead of per-capture full ledger rereads',async()=>{
  const f=await fixture();
  await f.capture();
  const original=f.ledger.readOriginalCaptureInventory;let passes=0;
  const h=f.host({readOriginalCaptureInventory:async q=>{passes++;return original(q);},
    listOriginalOutbox:async()=>assert.fail('legacy full inventory route'),
    listOriginalPendingIntents:async()=>assert.fail('legacy pending route')});
  const result=await h.commitObjectGraph({mutationInput:input(2),captureRef:'capture:k22:two'});
  assert.equal(result.capture.originalT3OutboxVerified,true);assert.equal(passes,2);assert.equal(f.graphWrites,2);
});

function k120Pages(f){
  return {readOriginalEvents:async()=>assert.fail('legacy full source history used'),originalCommitPageSize:2,
    withOriginalHistoryReadBoundary:async(_proof,run)=>run(),
    readOriginalCommitPage:async({workspaceId,afterEventId,limit})=>{
      assert.equal(workspaceId,ws);
      const rows=f.events.filter(e=>e.workspace_id===ws);
      const start=afterEventId===null?0:rows.findIndex(e=>e.event_id===afterEventId)+1;
      if(afterEventId!==null)assert.ok(start>0);
      const entries=rows.slice(start,start+limit).map(event=>({event,legacy_history:false}));
      return {entries,next_after_event_id:entries.at(-1)?.event.event_id??afterEventId,
        has_more:start+entries.length<rows.length,order:'LOCAL_TRANSACTION_COMMIT_ORDER',legacy_history_causal_proven:false};
    }};
}
test('K120 bounded graph capture, historical recovery and native replay preserve one original transaction per key',async()=>{
  const f=await fixture({prepareSource:f=>{
    f.events[0].service_id='service:other';f.events[0].idempotency_key=input().idempotency_key;
  }});
  const pages=k120Pages(f),h=f.host(pages);
  const first=await h.commitObjectGraph({mutationInput:input(),captureRef:'capture:k120:one'});
  const second=await h.commitObjectGraph({mutationInput:input(2),captureRef:'capture:k120:two'});
  assert.equal(second.capture.originalT3OutboxVerified,true);
  const recovered=await h.reconcileGraphMutation({workspaceId:ws,objectId:target,captureRef:'capture:k120:one'});
  assert.equal(recovered.historicalOutboxVerified,true);assert.equal(recovered.prepared.sha256,first.capture.prepared.sha256);
  const published=await readT4OriginalHostCapturedSubject({...f.common,...pages,kind:'GRAPH_COMMIT',subjectId:target,captureRef:'capture:k120:one'});
  assert.equal(published.prepared.sha256,first.capture.prepared.sha256);
  const before=f.events.length;
  const replay=await h.commitObjectGraph({mutationInput:input(),captureRef:'capture:k120:one'});
  assert.equal(replay.originalReceipt.deduplicated,true);assert.equal(f.events.length,before);
  assert.equal(f.graphWrites,2);assert.equal(f.graphInvocations,3);
});
test('K120 bounded graph lost reply recovers exactly once and duplicated service key invalidates historical proof',async()=>{
  const f=await fixture(),pages=k120Pages(f),h=f.host(pages),captureRef='capture:k120:lost';
  f.loseAck();
  await assert.rejects(h.commitObjectGraph({mutationInput:input(),captureRef}),err('GRAPH_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  const recovered=await h.reconcileGraphMutation({workspaceId:ws,objectId:target,captureRef});
  assert.equal(recovered.originalT3OutboxVerified,true);assert.equal(recovered.originalMutationRetried,false);
  await f.kernel.putObject({workspace_id:ws,object_id:a,schema_id:'iwxa.demo.note',schema_version:'1.0.0',
    base_revision:1,data:{title:'another original operation'},event:{event_type:'business.changed'}});
  f.events.at(-1).idempotency_key=input().idempotency_key;
  await assert.rejects(h.reconcileGraphMutation({workspaceId:ws,objectId:target,captureRef}),err('GRAPH_SOURCE_EVENT_NOT_PROVEN'));
  await assert.rejects(readT4OriginalHostCapturedSubject({...f.common,...pages,kind:'GRAPH_COMMIT',subjectId:target,captureRef}),
    err('OUTBOX_ORIGINAL_EVENT_NOT_AUTHENTICATED'));
  assert.equal(f.graphWrites,1);assert.equal(f.graphInvocations,1);
});
test('K120 original graph preflight refuses capture trace reuse before original Intent or business mutation',async()=>{
  const f=await fixture({prepareSource:f=>{f.events[0].payload.iwxa_t4_capture_ref='capture:k120:used';}});
  await assert.rejects(f.host(k120Pages(f)).commitObjectGraph({mutationInput:input(),captureRef:'capture:k120:used'}),
    err('GRAPH_SOURCE_EVENT_NOT_PROVEN'));
  assert.equal(f.graphWrites,0);assert.equal(f.graphInvocations,0);
  assert.equal((await f.ledger.listOriginalPendingIntents({workspaceId:ws,originalWriteOwnerRef:owner})).length,0);
});

function k138Catalog(f,{extra=0,pageSize=256}={}){
  const ids=[];
  for(let i=0;i<extra;i++){
    const id='o:k21:catalog:'+String(i).padStart(6,'0');
    f.objects.set(ws+':'+id,{workspace_id:ws,object_id:id,schema_id:'iwxa.demo.note',
      schema_version:'1.0.0',revision:1,deleted:false,data:{i},extensions:{}});
    ids.push(id);
  }
  let held=false,scans=0;const pages=[],grants=new Set(['t1.getObject','t1.listObjects','t1.listObjectWindow','t1.listEventsSince','t1.commitObjectGraph']);
  const read=f.kernel.listObjects,get=f.kernel.getObject;
  f.kernel.hasOperation=op=>grants.has(op);
  f.kernel.listObjects=async q=>{if(q.workspace_id===ws)assert.fail('legacy whole graph catalog forbidden');return read(q);};
  f.kernel.getObject=async(w,id)=>{assert.ok(held);return get(w,id);};
  let catalog=[];
  f.kernel.listObjectWindow=async q=>{
    assert.equal(held,true);assert.equal(q.workspace_id,ws);assert.equal(q.include_deleted,false);
    if(q.after_object_id===null){scans++;catalog=[...f.objects.values()].filter(o=>o.workspace_id===ws&&!o.deleted)
      .sort((a,b)=>a.object_id<b.object_id?-1:a.object_id>b.object_id?1:0);}
    const start=q.after_object_id===null?0:catalog.findIndex(o=>o.object_id===q.after_object_id)+1;
    assert.ok(q.after_object_id===null||start>0);const entries=clone(catalog.slice(start,start+q.limit));pages.push(q);
    return {entries,next_after_object_id:entries.at(-1)?.object_id??q.after_object_id,
      has_more:start+entries.length<catalog.length,order:'WORKSPACE_OBJECT_ID_ASC'};
  };
  const withBoundary=async(proof,action)=>{const prior=held;held=true;try{return await action();}finally{held=prior;}};
  const originalGraphCatalog={pageSize,withOriginalCatalogReadBoundary:async(proof,action)=>{
    assert.equal(proof.operation,'t1.listObjects');assert.equal(proof.workspaceId,ws);assert.equal(proof.originalWriteOwnerRef,owner);
    assert.equal(proof.kind,'GRAPH_COMMIT');assert.equal(proof.originalWorkspaceGraphMutationExclusionRequired,true);
    return withBoundary(proof,action);
  },readOriginalObjectPage:q=>f.kernel.listObjectWindow(q)};
  return {originalGraphCatalog,withBoundary,pages,grants,ids,scans:()=>scans};
}
async function k138Source(extra=0){
  const f=await seeded('source'),catalog=k138Catalog(f,{extra});
  const cursor=(await readT4OriginalEventWindow({workspaceId:ws,originalWriteOwnerRef:owner,
    authorizeOriginalRead:allow,readOriginalEvents:()=>f.kernel.listEventsSince(ws)})).nextCursor;
  let intent=null,outbox=null;
  const ports={workspaceId:ws,originalWriteOwnerRef:owner,captureRef:'capture:k138:one',subjectId:target,
    mutationInput:input(),sourceCursor:cursor,originalKernel:f.kernel,getMode:mode,
    authorizeOriginalRead:allow,authorizeOriginalWrite:allow,readOriginalEvents:()=>f.kernel.listEventsSince(ws),
    originalGraphCatalog:catalog.originalGraphCatalog,readOriginalIntent:async()=>clone(intent),readOriginalOutbox:async()=>clone(outbox),
    persistOriginalIntent:async x=>{intent=clone(x);return true;},persistOriginalOutbox:async x=>{outbox=clone(x);return true;}};
  const run=(overrides={})=>catalog.withBoundary({},()=>captureT4OriginalGraphMutation({...ports,...overrides}));
  const reconcile=()=>catalog.withBoundary({},()=>reconcileT4OriginalGraphMutation(ports));
  return {f,catalog,ports,run,reconcile,intent:()=>intent,outbox:()=>outbox};
}
async function k138Recipient(source,extra=0){
  const f=await seeded('recipient'),catalog=k138Catalog(f,{extra});
  const received=source.prepared;
  const ports={received,originalKernel:f.kernel,getMode:mode,authorizeOriginalRead:allow,authorizeOriginalWrite:allow,
    verifyOriginalSourceEvent:allow,nativeNetworkEvidence:true,originalGraphCatalog:catalog.originalGraphCatalog,
    withOriginalSubjectMutation:catalog.withBoundary};
  return {f,catalog,ports,apply:()=>applyT4OriginalGraphDelta(ports),inspect:()=>inspectT4OriginalGraphResult(ports)};
}
test('K138 source and recipient atomically create and delete relations with 4100 catalog Objects without legacy listObjects',async()=>{
  const source=await k138Source(4097),captured=await source.run();
  assert.equal(source.f.graphWrites,1);assert.equal(source.f.graphInvocations,1);
  assert.equal(captured.originalT3OutboxVerified,true);
  assert.deepEqual(captured.prepared.delta.relationDeletes,[rel(old,a,b,'old dependency')]);
  assert.equal(source.catalog.scans(),3);assert.equal(source.catalog.pages.length,3*17);
  const recipient=await k138Recipient(captured,4097),applied=await recipient.apply();
  assert.equal(applied.originalRecipientApplied,true);assert.equal(recipient.f.graphWrites,1);
  assert.equal(recipient.f.relations.has(old),false);assert.equal(recipient.f.relations.has(fresh),true);
  assert.equal((await recipient.inspect()).state,'APPLIED_VERIFIED');
  assert.equal(recipient.catalog.pages.length,3*17);
});
test('K138 original lost graph reply reconciles once through paged catalog and original Event',async()=>{
  const source=await k138Source();source.f.loseAck();
  await assert.rejects(source.run(),err('GRAPH_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  assert.equal(source.f.graphWrites,1);assert.ok(source.intent());assert.equal(source.outbox(),null);
  const recovered=await source.reconcile();assert.equal(recovered.originalT3OutboxVerified,true);
  assert.equal(recovered.originalMutationRetried,false);assert.equal(source.f.graphInvocations,1);
  const recipient=await k138Recipient(recovered);recipient.f.loseAck();
  await assert.rejects(recipient.apply(),err('GRAPH_RECIPIENT_WRITE_OUTCOME_UNKNOWN'));
  assert.equal((await recipient.inspect()).state,'APPLIED_VERIFIED');assert.equal(recipient.f.graphInvocations,1);
});
test('K138 paged graph rejects one-sided relation and duplicate relation scope before original Intent',async()=>{
  for(const variant of ['one-sided','duplicate']){
    const s=await k138Source(),get=s.f.kernel.getObject;
    s.f.kernel.getObject=async(w,id)=>{const row=await get(w,id);
      if(w===ws&&id===b&&variant==='one-sided')row.relations.incoming=[];
      if(w===ws&&id===a&&variant==='duplicate')row.relations.outgoing.push(clone(row.relations.outgoing[0]));
      return row;};
    await assert.rejects(s.run(),err(variant==='one-sided'?'GRAPH_ORIGINAL_RELATION_ENDPOINT_MISMATCH':'GRAPH_ORIGINAL_RELATION_SCOPE_MISMATCH'));
    assert.equal(s.intent(),null);assert.equal(s.f.graphWrites,0);
  }
});
test('K138 catalog row differs from exact original Object or omits primary Object',async()=>{
  for(const variant of ['changed','missing']){
    const s=await k138Source(),read=s.f.kernel.listObjectWindow;
    s.f.kernel.listObjectWindow=async q=>{
      const page=await read(q);
      if(variant==='changed')page.entries.find(r=>r.object_id===target).revision++;
      else{page.entries=page.entries.filter(r=>r.object_id!==target);page.next_after_object_id=page.entries.at(-1)?.object_id??q.after_object_id;}
      return page;
    };
    await assert.rejects(s.run(),err('GRAPH_ORIGINAL_CATALOG_CHANGED'));
    assert.equal(s.intent(),null);assert.equal(s.f.graphWrites,0);
  }
});
test('K138 both original catalog grants and exact Object read remain required throughout scan',async()=>{
  for(const op of ['t1.listObjects','t1.listObjectWindow','t1.getObject']){
    const s=await k138Source(),read=s.f.kernel.listObjectWindow;
    s.f.kernel.listObjectWindow=async q=>{const page=await read(q);s.catalog.grants.delete(op);return page;};
    await assert.rejects(s.run(),err(op==='t1.getObject'?'GRAPH_ORIGINAL_READ_DENIED':'ORIGINAL_OBJECT_CATALOG_READ_DENIED'));
    assert.equal(s.intent(),null);assert.equal(s.f.graphWrites,0);
  }
});
test('K138 incomplete, substituted or escaped original catalog boundary never authorizes graph write',async()=>{
  const s=await k138Source(),cat=s.catalog.originalGraphCatalog;
  await assert.rejects(s.run({originalGraphCatalog:{}}),err('GRAPH_ORIGINAL_CATALOG_BOUNDARY_REQUIRED'));
  let escaped;
  await assert.rejects(s.run({originalGraphCatalog:{...cat,withOriginalCatalogReadBoundary:async(p,action)=>{escaped=action;return {};}}}),
    err('GRAPH_ORIGINAL_CATALOG_BOUNDARY_INVALID'));
  await assert.rejects(escaped(),err('GRAPH_ORIGINAL_CATALOG_BOUNDARY_INVALID'));
  await assert.rejects(s.run({originalGraphCatalog:{...cat,withOriginalCatalogReadBoundary:async(p,action)=>({...await cat.withOriginalCatalogReadBoundary(p,action)})}}),
    err('GRAPH_ORIGINAL_CATALOG_BOUNDARY_INVALID'));
  assert.equal(s.intent(),null);assert.equal(s.f.graphWrites,0);
});
test('K138 recipient will not acknowledge a one-sided readback or stale catalog after original graph apply',async()=>{
  const s=await k138Source(),c=await s.run(),r=await k138Recipient(c);await r.apply();
  const get=r.f.kernel.getObject;r.f.kernel.getObject=async(w,id)=>{
    const row=await get(w,id);if(w===ws&&id===b)row.relations.incoming=[];return row;};
  await assert.rejects(r.inspect(),err('GRAPH_ORIGINAL_RELATION_ENDPOINT_MISMATCH'));
  assert.equal(r.f.graphWrites,1);
});
