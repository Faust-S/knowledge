import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createT4OriginalNetworkRecipientCursorPort} from '../src/network/original-network-host-cursor.mjs';
import {deriveT4OriginalNativeCaptureSession} from '../src/network/original-network-publication.mjs';
import {readT4OriginalEventWindow} from '../src/network/original-event-window.mjs';

const H=x=>'sha256:'+createHash('sha256').update(x).digest('hex');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?
  Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const hash=x=>H('IWXA-T4-ORIGINAL-NATIVE-ACK-FRONTIER-V1\0'+JSON.stringify(canonical(x)));
const copy=structuredClone,err=code=>e=>e?.code===code,allow=async()=>true;
const ws='workspace:business',tech='workspace:technical',owner='owner:original',
  source='node:source',recipient='node:recipient',scope='scope:original';
const identity={technicalWorkspaceId:tech,sourceWorkspaceId:ws,originalWriteOwnerRef:owner,
  sourceNodeRef:source,recipientNodeRef:recipient,scopeRef:scope,ownerEpoch:2};
const kinds=['OBJECT_PUT','ASSET_PUT','RELATION_PUT','RELATION_DELETE','ASSET_DELETE',
  'OBJECT_DELETE','GRAPH_COMMIT','GRAPH_COMMIT'];
const revisions=[2,1,null,null,null,3,4,5];
const types={OBJECT_PUT:'iwxa.t4.original-object.synced',ASSET_PUT:'iwxa.t4.original-asset.synced',
  RELATION_PUT:'iwxa.t4.original-relation.synced',RELATION_DELETE:'iwxa.t4.original-relation.deleted',
  ASSET_DELETE:'iwxa.t4.original-asset.deleted',OBJECT_DELETE:'iwxa.t4.original-object.deleted',
  GRAPH_COMMIT:'iwxa.t4.original-graph.synced'};

// Read-side fixture of the existing durable frontier schema, independently
// constructed from actual canonical native session identities and V1 Event
// windows. The full original-Kernel test creates the chain using the actual
// recipient CAS path, including original business writes and signed ACKs.
async function fixture(){
  const sourceEvents=Array.from({length:kinds.length+1},(_,i)=>({
    workspace_id:ws,event_id:'event:source:'+i,event_type:'source.changed',
    object_id:'object:target',revision:i+1,occurred_at:'2026-11-24T00:00:00Z',
    service_id:'service:original',payload:{i}}));
  const window=cursor=>readT4OriginalEventWindow({workspaceId:ws,originalWriteOwnerRef:owner,
    cursor,maxEvents:1,authorizeOriginalRead:allow,readOriginalEvents:async()=>copy(sourceEvents)});
  let before=(await window(null)).nextCursor;
  const baseline={schema:'IWXA_T4_ORIGINAL_RECIPIENT_BASELINE_V1',identity:copy(identity),
    sourceCursor:copy(before),originalBaselineRef:'baseline:original',originalBaselineDigest:H('baseline')};
  const checkpointRef='t4:net:recipientfrontier:'+hash({role:'RECIPIENT',identity}).slice(7);
  let previous=hash({identity,checkpointRef,role:'RECIPIENT',baseline});
  const technical=[],business=[],selections=[],records=[];
  for(let i=0;i<kinds.length;i++){
    const {window:w,nextCursor}=await window(before),kind=kinds[i],revision=revisions[i],
      eventId=w.lastEventId,eventDigest=w.eventRefs[0].eventDigest;
    const delta={sourceEventId:eventId,sourceEventDigest:eventDigest,windowDigest:w.windowDigest,sourceRevision:revision,
      ...(kind==='OBJECT_DELETE'?{kind,preImage:{revision:revision-1}}:{})};
    const session=deriveT4OriginalNativeCaptureSession({
      schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_OUTBOX_TASK_V1',state:'ORIGINAL_NATIVE_CAPTURE_READY',
      workspaceId:ws,originalWriteOwnerRef:owner,sourceNodeRef:source,recipientNodeRef:recipient,
      scopeRef:scope,ownerEpoch:2,networkTargetRef:recipient,networkPublished:false,
      sourceCursorAdvanced:false,originalRecipientApplied:false,sourceCursorBefore:before,sourceCursorAfter:nextCursor,
      capture:{kind,workspaceId:ws,originalWriteOwnerRef:owner,sourceEventId:eventId,sourceRevision:revision,
        originalIntentEventAndCanonicalBytesVerified:true,capturedWindowDigestVerified:true,
        prepared:{sha256:H('captured:'+i).slice(7),delta},sourceWindow:w}});
    const stateDigest=H('state:'+i),event={workspace_id:ws,event_id:'event:recipient:'+i,
      object_id:'object:target',revision,event_type:types[kind],service_id:'service:original',
      occurred_at:'2026-11-24T00:01:00Z',payload:{originalEventId:eventId,originalEventDigest:eventDigest,
        originalWriteOwnerRef:owner,originalDeltaSha256:session.capturedSha256,
        ...(kind==='RELATION_PUT'?{originalRelationDigest:stateDigest}:{originalContentDigest:stateDigest})}};
    business.push(event);
    const raw={session,sourceCursorBefore:copy(before),sourceCursorAfter:copy(nextCursor),
      originalRecipientEventId:event.event_id,originalRecipientEventDigest:hash({role:'RECIPIENT_EVENT',event}),
      originalRecipientEventRevision:revision,originalRecipientRevision:revision,originalRecipientStateDigest:stateDigest,
      originalPhaseRef:'phase:'+i,originalPhaseChainHash:H('phase:'+i),
      originalPublicationRef:'publication:'+i,originalPublicationChainHash:H('publication:'+i),
      signedAppliedAckDigest:H('ack:'+i),previousHash:previous};
    const record={...raw,chainHash:hash({identity,checkpointRef,role:'RECIPIENT',record:raw})};
    records.push(record);previous=record.chainHash;
    technical.push({workspace_id:tech,event_id:'event:technical:'+i,object_id:checkpointRef,
      revision:i+1,event_type:'t4.network.original.host.recipient.frontier',
      payload:{checkpointRef,identity:copy(identity),record:copy(record),chainHash:record.chainHash,action:'ADVANCE'}});
    before=nextCursor;
    selections.push(Object.fromEntries(['sessionRef','changeId','sourceEventId','sourceEventDigest','capturedSha256']
      .map(k=>[k,session[k]])));
  }
  const row={object:{workspace_id:tech,object_id:checkpointRef,schema_id:'iwxa.demo.note',
    schema_version:'1.0.0',revision:records.length,deleted:false,data:{
      schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_RECIPIENT_FRONTIER_V1',title:'Original T3 native recipient frontier',
      identity:copy(identity),baseline:copy(baseline),last:copy(records.at(-1))}}};
  let sessionRef='host:initial',permitted=true,online=true,eventReads=0,objectReads=0;
  const kernel={hasOperation:op=>['t1.getObject','t1.listEventsSince','t1.putObject'].includes(op),
    async getObject(w,id){objectReads++;assert.equal(w,tech);assert.equal(id,checkpointRef);return copy(row);},
    async listEventsSince(w){eventReads++;assert.ok([tech,ws].includes(w));return copy(w===tech?technical:business);},
    async putObject(){assert.fail('historical query must not write');}};
  const port=(overrides={})=>createT4OriginalNetworkRecipientCursorPort({...identity,
    originalKernel:kernel,getMode:()=>online?'T4_NETWORK':'LOCAL_T3',
    readOriginalHostContext:async()=>({workspaceId:tech,originalWriteOwnerRef:owner,
      nodeRef:recipient,scopeRef:scope,hostSessionRef:sessionRef}),
    authorizeOriginalTechnicalRead:allow,authorizeOriginalTechnicalWrite:async()=>false,
    authorizeOriginalRecipientRead:async()=>permitted,
    authorizeOriginalSourceRead:async()=>assert.fail('historical read must not contact source'),
    readOriginalSourceEvents:async()=>assert.fail('historical read must not contact source'),
    readOriginalAdmittedBaseline:async()=>copy(baseline),
    verifyOriginalRecipientBaseline:async p=>p.baseline.originalBaselineDigest===baseline.originalBaselineDigest,
    ...overrides});
  return {port,row,business,technical,selections,records,checkpointRef,kernel,
    counts:()=>({eventReads,objectReads}),restart:()=>{sessionRef='host:cold';},
    revoke:()=>{permitted=false;},local:()=>{online=false;}};
}
test('K24 original committed recipient frontier returns mixed historical results in requested order without current subject reads',async()=>{
  const f=await fixture(),p=f.port(),query=[...f.selections].reverse();
  const first=await p.inspectOriginalCommittedRecipientResults({selections:query});
  assert.equal(first.results.length,8);assert.equal(first.frontierRevision,8);
  assert.equal(new Set(first.results.map(x=>x.session.changeKind)).size,7);
  assert.deepEqual(first.results.map(x=>x.frontierRecordRevision),[8,7,6,5,4,3,2,1]);
  assert.equal(first.currentSubjectStateClaimed,false);assert.equal(first.newAppliedAckPermitted,false);
  assert.equal(first.remoteNetworkReadRequired,false);
  assert.deepEqual(f.counts(),{eventReads:4,objectReads:4});
  for(const [i,proof] of first.results.entries()){
    const r=f.records.at(-1-i);
    assert.equal(proof.originalRecipientEventId,r.originalRecipientEventId);
    assert.equal(proof.originalRecipientStateDigest,r.originalRecipientStateDigest);
    assert.equal(proof.signedAppliedAckDigest,r.signedAppliedAckDigest);
    assert.equal(proof.originalCommittedRecipientResultVerified,true);
    assert.equal(proof.historicalSubjectBytesReconstructed,false);
    assert.equal(proof.currentSubjectReadback,false);
    assert.equal(proof.newAppliedAckPermitted,false);
    assert.equal(Object.hasOwn(proof,'data'),false);
  }
  f.restart();
  assert.deepEqual(await f.port().inspectOriginalCommittedRecipientResults({selections:query}),first);
  assert.deepEqual(f.counts(),{eventReads:8,objectReads:8});
});
test('K24 historical read rejects missing or substituted session, duplicate query, mutated original Event and frontier',async()=>{
  const f=await fixture(),inspect=selections=>f.port().inspectOriginalCommittedRecipientResults({selections});
  const s=f.selections[0];
  await assert.rejects(inspect([{...s,sessionRef:'session:unknown'}]),err('RECIPIENT_CURSOR_HISTORICAL_RESULT_NOT_COMMITTED'));
  await assert.rejects(inspect([{...s,capturedSha256:'0'.repeat(64)}]),err('RECIPIENT_CURSOR_HISTORICAL_SESSION_MISMATCH'));
  await assert.rejects(inspect([s,s]),err('RECIPIENT_CURSOR_HISTORICAL_SELECTION_INVALID'));
  await assert.rejects(inspect([{...s,ownerEpoch:3}]),err('RECIPIENT_CURSOR_HISTORICAL_SELECTION_INVALID'));
  f.business[6].payload.originalContentDigest=H('modified graph');
  await assert.rejects(inspect([s]),err('RECIPIENT_CURSOR_ORIGINAL_RESULT_EVENT_MISMATCH'));
  const g=await fixture();
  g.technical[3].payload.record.signedAppliedAckDigest=H('substituted ack');
  await assert.rejects(g.port().inspectOriginalCommittedRecipientResults({selections:g.selections}),
    err('RECIPIENT_CURSOR_ORIGINAL_EVENT_CHAIN_INVALID'));
});
test('K24 fresh original Event authority and Host lifetime are required on every historical proof read',async()=>{
  const f=await fixture(),p=f.port(),q={selections:f.selections};
  await p.inspectOriginalCommittedRecipientResults(q);
  f.revoke();await assert.rejects(p.inspectOriginalCommittedRecipientResults(q),err('RECIPIENT_CURSOR_ORIGINAL_ACCESS_DENIED'));
  const g=await fixture();let active=true;
  const base=g.port(),scoped=base.forOriginalHostLifetime(()=>active);
  const read=g.kernel.listEventsSince;
  g.kernel.listEventsSince=async w=>{const rows=await read(w);active=false;return rows;};
  await assert.rejects(scoped.inspectOriginalCommittedRecipientResults({selections:g.selections}),
    err('ORIGINAL_HOST_LIFETIME_ENDED'));
  active=true;
  await assert.rejects(scoped.inspectOriginalCommittedRecipientResults({selections:g.selections}),
    err('ORIGINAL_HOST_LIFETIME_ENDED'));
  const h=await fixture();h.local();
  await assert.rejects(h.port().inspectOriginalCommittedRecipientResults({selections:h.selections}),
    err('RECIPIENT_CURSOR_NETWORK_MODE_OFF'));
});

test('K91 migration reads only committed original recipient publications, never treats an absent result as applied',async()=>{
  const f=await fixture(),p=f.port(),missing={...f.selections[0],sessionRef:'session:not-committed'};
  const query=[f.selections[7],missing,f.selections[0]];
  const result=await p.inspectOriginalCommittedRecipientResults({selections:query,allowUncommitted:true});
  assert.equal(result.uncommittedSelectionsOmitted,true);
  assert.deepEqual(result.results.map(x=>x.session.sessionRef),[query[0].sessionRef,query[2].sessionRef]);
  assert.equal(result.frontierRevision,8);
  assert.equal(result.newAppliedAckPermitted,false);
  assert.equal(result.originalRecipientCursorAdvanced,false);
  assert.deepEqual(f.counts(),{eventReads:4,objectReads:4});
  await assert.rejects(p.inspectOriginalCommittedRecipientResults({selections:query}),err('RECIPIENT_CURSOR_HISTORICAL_RESULT_NOT_COMMITTED'));
  await assert.rejects(p.inspectOriginalCommittedRecipientResults({selections:[{...f.selections[0],capturedSha256:'0'.repeat(64)}],allowUncommitted:true}),
    err('RECIPIENT_CURSOR_HISTORICAL_SESSION_MISMATCH'));
  const empty=await p.inspectOriginalCommittedRecipientResults({selections:[missing],allowUncommitted:true});
  assert.deepEqual(empty.results,[]);
  f.revoke();
  await assert.rejects(p.inspectOriginalCommittedRecipientResults({selections:query,allowUncommitted:true}),err('RECIPIENT_CURSOR_ORIGINAL_ACCESS_DENIED'));
});

test('K103 exact recipient Result and ACK are read from one committed frontier record through the existing owner carrier',async()=>{
  const {createT4OriginalRecipientResultRequest,readT4OriginalRecipientResult,createT4OriginalRemoteRecipientAppliedVerifier,
    validateT4OriginalRecipientResultSnapshot,T4_RECIPIENT_RESULT_OWNER_ACTION}=await import('../src/network/original-recipient-result-read.mjs');
  const {createT4OriginalReplacementHistoryClient,createT4OriginalReplacementHistoryServer}=await import('../src/network/original-replacement-owner-history-carrier.mjs');
  const f=await fixture(),p=f.port(),getMode=()=> 'T4_NETWORK';
  let host='host:k103:recipient',allowed=true,reads=0,guardCalls=0,busy=false;
  const readOriginalHostContext=async()=>({workspaceId:tech,originalWriteOwnerRef:owner,nodeRef:recipient,scopeRef:scope,hostSessionRef:host});
  const reader=request=>readT4OriginalRecipientResult({request,technicalWorkspaceId:tech,getMode,readOriginalHostContext,originalCursorPort:p,
    authorizeOriginalOwnerHistoryRead:async proof=>{guardCalls++;return allowed&&proof.operation===T4_RECIPIENT_RESULT_OWNER_ACTION&&proof.originalOwnerReadOnly===true;}});
  const common={workspaceId:ws,originalWriteOwnerRef:owner,scopeRef:scope,ownerEpoch:2,getMode};
  const peer=nodeRef=>async()=>({nodeRef,scopeRef:scope,ownerEpoch:2,originalPeerSessionRef:'peer:k103:authenticated',contextEpoch:1,
    originalPeerAuthenticated:true,originalConfidentialChannelVerified:true});
  const server=createT4OriginalReplacementHistoryServer({...common,localNodeRef:recipient,peerNodeRef:source,readOriginalPeerContext:peer(source),
    readOriginalReplacementOwnerHistory:async({request,peerContext})=>{assert.equal(peerContext.nodeRef,source);reads++;return busy?null:reader(request);}});
  const client=createT4OriginalReplacementHistoryClient({...common,localNodeRef:source,peerNodeRef:recipient,readOriginalPeerContext:peer(recipient),
    invokeOriginalPeerHistory:({requestBytes})=>server(requestBytes)});
  // Every supported subject kind, including null revision and a historical
  // result superseded by a subsequent graph revision. No current bytes used.
  for(const record of f.records){
    const c=record.session,request=createT4OriginalRecipientResultRequest({session:c,requesterNodeRef:source,ownerNodeRef:recipient});
    const v=await client(request);
    assert.equal(v.originalEventPayloadReturned,false);assert.equal(v.currentSubjectStateClaimed,false);
    assert.equal(v.result.signedAppliedAckDigest,record.signedAppliedAckDigest);assert.equal(v.result.originalRecipientEventId,record.originalRecipientEventId);
    assert.equal(v.result.originalRecipientRevision,c.sourceRevision);assert.equal(v.result.session,undefined);assert.equal(v.result.payload,undefined);
  }
  const r=f.records[0],c=r.session,request=createT4OriginalRecipientResultRequest({session:c,requesterNodeRef:source,ownerNodeRef:recipient});
  const verifier=createT4OriginalRemoteRecipientAppliedVerifier({session:c,getMode,readOriginalRecipientResult:client});
  const proof={operation:'t4.original.network.session.applied.verify',checkpointRef:'phase:source:k103',sessionRef:c.sessionRef,
    changeId:c.changeId,changeKind:c.changeKind,sourceNodeRef:source,recipientNodeRef:recipient,localNodeRef:source,scopeRef:scope,ownerEpoch:2,
    originalRecipientEventId:r.originalRecipientEventId,originalRecipientRevision:r.originalRecipientRevision,originalRecipientStateDigest:r.originalRecipientStateDigest,
    evidenceDigest:r.signedAppliedAckDigest,evidenceRef:r.signedAppliedAckDigest.slice(7)+'.t4n',
    originalRecipientEventAndStateReadbackRequired:true,signedAppliedAckAloneIsInsufficient:true};
  assert.equal(await verifier(proof),true);
  const forged=H('forged ack');assert.equal(await verifier({...proof,evidenceDigest:forged,evidenceRef:forged.slice(7)+'.t4n'}),false);
  assert.equal(await verifier({...proof,originalRecipientEventId:'event:forged'}),false);
  assert.equal(await verifier({...proof,sessionRef:'session:foreign'}),false);
  busy=true;await assert.rejects(verifier(proof),err('RECIPIENT_RESULT_OWNER_NOT_READY'));busy=false;
  allowed=false;await assert.rejects(verifier(proof),err('RECIPIENT_RESULT_AUTHORITY_DENIED'));allowed=true;
  const valid=await client(request);assert.throws(()=>validateT4OriginalRecipientResultSnapshot({...valid,result:{...valid.result,payload:{secret:true}}},request),err('RECIPIENT_RESULT_EVIDENCE_INVALID'));
  assert.throws(()=>createT4OriginalRecipientResultRequest({session:c,requesterNodeRef:recipient,ownerNodeRef:source}),err('RECIPIENT_RESULT_REQUEST_INVALID'));
  const g=await fixture(),last=g.records.at(-1);g.technical.pop();g.business.pop();g.row.object.revision--;g.row.object.data.last=copy(g.records.at(-2));
  const absent=createT4OriginalRecipientResultRequest({session:last.session,requesterNodeRef:source,ownerNodeRef:recipient});
  assert.equal(await readT4OriginalRecipientResult({request:absent,technicalWorkspaceId:tech,getMode,readOriginalHostContext,
    originalCursorPort:g.port(),authorizeOriginalOwnerHistoryRead:allow}),null);
  // Drive the real ordinary source phase port with the exact same bounded
  // owner reader. The local Kernel fixture implements Object/Event CAS;
  // a committed ACK must not become a second write after lost peer readback.
  const {createT4OriginalNetworkSessionPhasePort}=await import('../src/network/original-network-session-phases.mjs');
  let sourceRow=null,sourceHost='host:k103:source',losePeerAfterWrite=false;
  const sourceEvents=[];
  const sourceKernel={hasOperation:op=>['t1.getObject','t1.listEventsSince','t1.putObject'].includes(op),
    async getObject(w,id){assert.equal(w,tech);if(sourceRow)assert.equal(id,sourceRow.object_id);return sourceRow?{object:copy(sourceRow)}:null;},
    async listEventsSince(w){assert.equal(w,tech);return copy(sourceEvents);},
    async putObject(input){assert.equal(input.base_revision,sourceRow?.revision??0);
      const {workspace_id,object_id,schema_id,schema_version,data,extensions}=input;
      sourceRow={workspace_id,object_id,schema_id,schema_version,data:copy(data),extensions,revision:input.base_revision+1,deleted:false};
      const event={workspace_id,object_id,revision:sourceRow.revision,event_id:'event:k103:phase:'+sourceRow.revision,
        event_type:input.event.event_type,payload:copy(input.event.payload)};
      sourceEvents.push(event);if(losePeerAfterWrite)busy=true;return {object:copy(sourceRow),event:copy(event)};}};
  const sourcePhase=()=>createT4OriginalNetworkSessionPhasePort({...identity,originalKernel:sourceKernel,localNodeRef:source,
    sessionRef:c.sessionRef,changeId:c.changeId,changeKind:c.changeKind,getMode,
    readOriginalHostContext:async()=>({workspaceId:tech,originalWriteOwnerRef:owner,nodeRef:source,scopeRef:scope,hostSessionRef:sourceHost}),
    authorizeOriginalTechnicalRead:allow,authorizeOriginalTechnicalWrite:allow,verifyOriginalPhaseEvidence:allow,
    verifyOriginalRecipientApplied:verifier});
  const phase=sourcePhase();
  await phase.advanceOriginalSessionPhase({phase:'INTENT',evidence:{evidenceRef:c.sourceEventId,evidenceDigest:c.capturedWindowDigest}});
  await phase.advanceOriginalSessionPhase({phase:'PUBLISHED',evidence:{evidenceRef:'publication:k103',evidenceDigest:H('published')}});
  const appliedEvidence=Object.fromEntries(['evidenceRef','evidenceDigest','originalRecipientEventId','originalRecipientRevision','originalRecipientStateDigest'].map(k=>[k,proof[k]]));
  const advance=()=>phase.advanceOriginalSessionPhase({phase:'APPLIED_CONFIRMED',evidence:appliedEvidence});
  busy=true;await assert.rejects(advance(),err('RECIPIENT_RESULT_OWNER_NOT_READY'));
  assert.equal(sourceEvents.length,2);assert.equal((await phase.inspectOriginalSession()).currentPhase,'PUBLISHED');
  busy=false;losePeerAfterWrite=true;await assert.rejects(advance(),err('RECIPIENT_RESULT_OWNER_NOT_READY'));
  assert.equal(sourceEvents.length,3);
  busy=false;losePeerAfterWrite=false;sourceHost='host:k103:source:cold';
  const cold=sourcePhase();assert.equal((await cold.inspectOriginalSession()).currentPhase,'APPLIED_CONFIRMED');
  const recovered=await cold.advanceOriginalSessionPhase({phase:'APPLIED_CONFIRMED',evidence:appliedEvidence});
  assert.equal(recovered.status,'ALREADY_CONFIRMED');assert.equal(sourceEvents.length,3);
  f.revoke();await assert.rejects(verifier(proof),err('RECIPIENT_CURSOR_ORIGINAL_ACCESS_DENIED'));
  assert.ok(reads>=13);assert.ok(guardCalls>=20);
});

function pagedRecipientFixture(f,unrelated=0){
  const pages=[],read=f.kernel.listEventsSince,has=f.kernel.hasOperation;
  for(let i=0;i<unrelated;i++)f.business.push({workspace_id:ws,event_id:'event:unrelated:'+i,payload:{i}});
  let held=false;
  f.kernel.hasOperation=op=>op==='t1.listEventCommitWindow'||has(op);
  f.kernel.listEventsSince=async w=>{assert.equal(w,tech);return read(w);};
  f.kernel.listEventCommitWindow=async(w,after,limit)=>{
    assert.equal(w,ws);assert.ok(held);pages.push({after,limit});
    const index=after===null?-1:f.business.findIndex(e=>e.event_id===after);
    assert.ok(after===null||index>=0);
    const entries=f.business.slice(index+1,index+1+limit).map(event=>({event,legacy_history:false}));
    return {entries,next_after_event_id:entries.at(-1)?.event.event_id??after,
      has_more:index+1+entries.length<f.business.length,order:'LOCAL_TRANSACTION_COMMIT_ORDER',legacy_history_causal_proven:false};
  };
  const options={
    readOriginalRecipientCommitPage:p=>f.kernel.listEventCommitWindow(p.workspaceId,p.afterEventId,p.limit),
    withOriginalRecipientHistoryReadBoundary:async(p,action)=>{
      assert.equal(p.workspaceId,ws);assert.equal(p.originalWriteOwnerRef,owner);assert.equal(p.originalHistoryExclusionRequired,true);
      assert.equal(held,false);held=true;try{return await action();}finally{held=false;}
    },recipientCommitPageSize:1024};
  return {pages,options,port:overrides=>f.port({...options,...overrides})};
}
test('K135 recipient frontier recovers exact original receipts across 100000 unrelated Events with unchanged evidence',async()=>{
  const f=await fixture(),q={selections:f.selections},expected=await f.port().inspectOriginalCommittedRecipientResults(q),paged=pagedRecipientFixture(f,100001);
  f.restart();assert.deepEqual(await paged.port().inspectOriginalCommittedRecipientResults(q),expected);
  assert.equal(paged.pages.length,196);assert.equal(f.counts().eventReads,6);
  const victim=f.business[0].event_id;f.business[0].event_id='event:lost';
  await assert.rejects(paged.port().inspectOriginalCommittedRecipientResults(q),err('RECIPIENT_CURSOR_ORIGINAL_RESULT_EVENT_MISMATCH'));
  f.business[0].event_id=victim;f.business.push({...f.business.at(-1)});
  await assert.rejects(paged.port().inspectOriginalCommittedRecipientResults(q),err('TECHNICAL_COMMIT_HISTORY_PAGE_INVALID'));
});
test('K135 recipient commit reader denies incomplete ports, revoked commit permission and lost Host lifetime',async()=>{
  const f=await fixture(),paged=pagedRecipientFixture(f),q={selections:f.selections};
  assert.throws(()=>f.port({readOriginalRecipientCommitPage:paged.options.readOriginalRecipientCommitPage}),err('RECIPIENT_CURSOR_ORIGINAL_COMMIT_HISTORY_PORTS_REQUIRED'));
  await assert.rejects(paged.port({authorizeOriginalRecipientRead:async p=>p.operation!=='t1.listEventCommitWindow'}).inspectOriginalCommittedRecipientResults(q),err('RECIPIENT_CURSOR_ORIGINAL_ACCESS_DENIED'));
  let active=true;
  const scoped=paged.port().forOriginalHostLifetime(()=>active),page=f.kernel.listEventCommitWindow;
  f.kernel.listEventCommitWindow=async(...args)=>{const v=await page(...args);active=false;return v;};
  await assert.rejects(scoped.inspectOriginalCommittedRecipientResults(q),err('ORIGINAL_HOST_LIFETIME_ENDED'));
  active=true;await assert.rejects(scoped.inspectOriginalCommittedRecipientResults(q),err('ORIGINAL_HOST_LIFETIME_ENDED'));
});
