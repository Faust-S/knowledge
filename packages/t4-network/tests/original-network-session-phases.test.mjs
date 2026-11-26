import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,verify,createHash} from 'node:crypto';
import {deriveT4OriginalNativeCaptureSession,createT4OriginalNetworkPublicationPort,validateT4OriginalNativeCaptureSession,
  validateT4OriginalReplacementSessionCandidate,createT4OriginalSourceSessionHead,
  createT4OriginalReplacementSourceHead,readT4OriginalReplacementSourceHead} from '../src/network/original-network-publication.mjs';
import {t4NativeSourceHeadIndexKey,t4NativeReplacementHeadIndexKey,t4NativeSessionFrameIndexKey}
  from '../src/network/original-network-frame-address.mjs';
import {createT4CandidateFrameTransport} from '../src/network/standard-network-wire-transport.mjs';
import {discoverT4OriginalNetworkSessionContent} from '../src/network/original-network-subject-apply.mjs';
import {prepareT4OriginalObjectDelta} from '../src/network/original-object-delta.mjs';
import {createT4OriginalHostRecipientDispatcher} from '../src/network/original-host-recipient-dispatcher.mjs';
import {createT4OriginalNetworkReplayPort} from '../src/network/original-network-replay-checkpoint.mjs';
import {readT4OriginalEventWindow} from '../src/network/original-event-window.mjs';
import {createT4OriginalReplacementOwnerHistoryRequest,readT4OriginalReplacementOwnerHistory,completeT4OriginalReplacementHostCursor,deferT4OriginalReplacementHistoryWake}
  from '../src/network/original-network-replacement-owner-history.mjs';
import {encodeT4OriginalReplacementHistoryRequest,decodeT4OriginalReplacementHistoryRequest,
  encodeT4OriginalReplacementHistoryResponse,decodeT4OriginalReplacementHistoryResponse,
  createT4OriginalReplacementHistoryClient,createT4OriginalReplacementHistoryServer}
  from '../src/network/original-replacement-owner-history-carrier.mjs';
import {createT4OriginalNetworkHostCursorPort,createT4OriginalNetworkRecipientCursorPort} from '../src/network/original-network-host-cursor.mjs';
import {recoverT4OriginalReplacementTerminalCursorEvidence,recoverT4OriginalHistoricallyConfirmedSourceCursor} from '../src/network/original-network-source-cursor.mjs';
import {createT4CandidateUnsignedFrame,signT4CandidateFrame,T4_ORIGINAL_SOURCE_SESSION_EXTENSION,
  T4_REPLACEMENT_SOURCE_SESSION_EXTENSION,decodeT4CandidateFrame} from '../src/network/standard-network-wire-candidate.mjs';
import {prepareT4OriginalSupersessionControl,signT4OriginalSupersessionRequest,
  retireT4OriginalRecipientAttemptFromControl,verifyT4OriginalRecipientRetirementAck,recordT4OriginalSourceSupersession,
  publishT4OriginalRecipientRetirementAck,recoverT4OriginalReplacementEligibility,
  publishT4OriginalReplacementSourceHead,discoverT4OriginalReplacementSourceHead,admitT4OriginalReplacementSourcePhase,
  readT4OriginalReplacementRecipientAdmission,publishT4OriginalReplacementRecipientDiff,
  discoverT4OriginalReplacementRecipientDiff,publishT4OriginalReplacementSourceContent,confirmT4OriginalReplacementSourcePublication,
  readT4OriginalReplacementSourceAckEvidence,confirmT4OriginalReplacementSourceAcknowledgement,advanceT4OriginalReplacementSourceAck}
  from '../src/network/original-network-session-supersession.mjs';
import {createT4OriginalNetworkSessionPhasePort,createT4OriginalReplacementHistoricalPhasePort,readT4OriginalLocalReplacementSelection,deriveT4OriginalReplacementAttempt} from
  '../src/network/original-network-session-phases.mjs';

const workspace='t4:network:technical:session',
  owner='original:owner:one',sourceNodeRef='node:source',
  recipientNodeRef='node:recipient',scopeRef='scope:opaque',
  changeId='change:seven',sessionRef='session:one',
  H='sha256:'+'a'.repeat(64),B='sha256:'+'b'.repeat(64);
const evidence=(label,phase)=>['APPLIED','APPLIED_CONFIRMED'].includes(phase)?{
  evidenceRef:label,evidenceDigest:H,
  originalRecipientEventId:'event:original:applied:7',
  originalRecipientRevision:7,originalRecipientStateDigest:B,
}:{evidenceRef:label,evidenceDigest:H};
const isCode=c=>e=>e?.code===c;
function fakeKernel(){
  const objects=new Map(),events=[];
  let calls=0,reads=0,loseReply=false,denyRead=false;
  return{
    objects,events,
    get calls(){return calls;},get reads(){return reads;},
    loseNextReply(){loseReply=true;},setDenyRead(v){denyRead=v;},
    kernel:{
      hasOperation:op=>['t1.getObject','t1.putObject','t1.listEventsSince','t1.listObjects']
        .includes(op),
      async listObjects({workspace_id}){return structuredClone([...objects.values()].map(r=>r.object).filter(o=>o.workspace_id===workspace_id));},
      async getObject(w,id){
        reads++;
        if(denyRead)throw Error('denied kernel read');
        return structuredClone(objects.get(w+':'+id)??null);
      },
      async listEventsSince(w){
        return structuredClone(events.filter(e=>e.workspace_id===w));
      },
      async putObject(input){
        calls++;
        const id=input.workspace_id+':'+input.object_id;
        const current=objects.get(id)?.object??null;
        const last=current?.revision??0;
        if(input.base_revision!==last)
          throw Object.assign(Error('ORIGINAL_CAS_CONFLICT'),
            {code:'REVISION_CONFLICT'});
        const revision=last+1;
        const object={
          workspace_id:input.workspace_id,object_id:input.object_id,
          schema_id:input.schema_id,
          schema_version:input.schema_version,
          revision,deleted:false,
          data:structuredClone(input.data),extensions:{},
        };
        const event={
          event_id:'event:original:network:phase:'+calls,
          workspace_id:input.workspace_id,object_id:input.object_id,
          revision,event_type:input.event.event_type,
          payload:structuredClone(input.event.payload),
        };
        objects.set(id,{object,relations:{outgoing:[],incoming:[]}});
        events.push(event);
        if(loseReply){loseReply=false;throw Object.assign(
          Error('Original T3 wrote but ACK lost'),{code:'ACK_LOST'});
        }
        return{object,event};
      },
    },
  };
}
function fixture(localNodeRef=sourceNodeRef,kernel=fakeKernel()){
  let network=true,allowRead=true,allowWrite=true,
    phaseEvidence=true,applied=false,
    hostSessionRef='host:session:one';
  const base={
    originalKernel:kernel.kernel,
    technicalWorkspaceId:workspace,
    originalWriteOwnerRef:owner,sourceNodeRef,recipientNodeRef,
    localNodeRef,scopeRef,sessionRef,changeId,ownerEpoch:2,
    getMode:()=>network?'T4_NETWORK':'LOCAL_T3',
    readOriginalHostContext:async()=>({
      workspaceId:workspace,originalWriteOwnerRef:owner,
      nodeRef:localNodeRef,scopeRef,hostSessionRef,
    }),
    authorizeOriginalTechnicalRead:async proof=>allowRead&&
      proof.originalT3HostAuthorityRequired===true&&
      ['t1.getObject','t1.listEventsSince'].includes(proof.operation),
    authorizeOriginalTechnicalWrite:async proof=>allowWrite&&
      proof.originalT3HostAuthorityRequired===true&&
      proof.operation==='t1.putObject',
    verifyOriginalPhaseEvidence:async p=>phaseEvidence&&
      p.originalVerifiedWitnessRequired===true&&
      p.evidence.evidenceDigest===H,
    verifyOriginalRecipientApplied:async p=>applied&&
      p.originalRecipientEventAndStateReadbackRequired===true&&
      p.originalRecipientEventId==='event:original:applied:7'&&
      p.originalRecipientRevision===7&&
      p.originalRecipientStateDigest===B,
  };
  return{base,kernel,create:()=>createT4OriginalNetworkSessionPhasePort(base),
    local:()=>{network=false;},revokeRead:()=>{allowRead=false;},
    revokeWrite:()=>{allowWrite=false;},
    denyEvidence:()=>{phaseEvidence=false;},
    allowApplied:()=>{applied=true;},
    restart:()=>{hostSessionRef='host:session:after-cold';},
  };
}
test('source intent and publication are CAS versions in one ORIGINAL T3 technical Object',async()=>{
  const f=fixture(),port=f.create();
  const intent=await port.advanceOriginalSessionPhase({
    phase:'INTENT',evidence:evidence('original:event:seven'),
  });
  assert.equal(intent.revision,1);
  assert.equal(intent.originalBusinessApplied,false);
  const delivered=await port.advanceOriginalSessionPhase({
    phase:'PUBLISHED',evidence:evidence('original:network:readback'),
  });
  assert.equal(delivered.revision,2);
  assert.equal(f.kernel.objects.size,1);
  assert.equal(f.kernel.events.length,2);
  assert.equal(f.kernel.calls,2);
  assert.equal((await port.inspectOriginalSession()).currentPhase,'PUBLISHED');
  assert.equal((await port.inspectOriginalSession()).originalBusinessApplied,false);
  const repeated=await port.advanceOriginalSessionPhase({
    phase:'PUBLISHED',evidence:evidence('original:network:readback'),
  });
  assert.equal(repeated.status,'ALREADY_CONFIRMED');
  assert.equal(repeated.historicalReceiptFabricated,false);
  assert.equal(f.kernel.calls,2);
});
test('lost original T3 network INTENT response is recovered by read, not a retry',async()=>{
  const f=fixture(),port=f.create();f.kernel.loseNextReply();
  await assert.rejects(port.advanceOriginalSessionPhase({
    phase:'INTENT',evidence:evidence('original:event:seven'),
  }),error=>error.code==='PHASE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'&&
    error.details.automaticRetryAllowed===false);
  assert.equal(f.kernel.calls,1);
  f.restart();
  const recovered=f.create();
  const status=await recovered.inspectOriginalSession();
  assert.equal(status.currentPhase,'INTENT');
  const same=await recovered.advanceOriginalSessionPhase({
    phase:'INTENT',evidence:evidence('original:event:seven'),
  });
  assert.equal(same.status,'ALREADY_CONFIRMED');
  assert.equal(f.kernel.calls,1);
});
test('original recipient phases cannot skip or turn VERIFIED_ACK into APPLIED',async()=>{
  const f=fixture(recipientNodeRef),port=f.create();
  await assert.rejects(port.advanceOriginalSessionPhase({
    phase:'VERIFIED',evidence:evidence('signed:verified:ack'),
  }),isCode('PHASE_PREDECESSOR_NOT_PROVEN'));
  await port.advanceOriginalSessionPhase({
    phase:'RECEIVED',evidence:evidence('signed:received:ack'),
  });
  await port.advanceOriginalSessionPhase({
    phase:'VERIFIED',evidence:evidence('signed:verified:ack'),
  });
  await assert.rejects(port.advanceOriginalSessionPhase({
    phase:'APPLIED',evidence:evidence('signed:applied:ack','APPLIED'),
  }),isCode('PHASE_ORIGINAL_APPLIED_NOT_PROVEN'));
  assert.equal(f.kernel.calls,2);
  f.allowApplied();
  await port.advanceOriginalSessionPhase({
    phase:'APPLIED',evidence:evidence('original:recipient:result','APPLIED'),
  });
  assert.equal(f.kernel.calls,3);
  assert.equal((await port.inspectOriginalSession()).originalBusinessApplied,true);
  f.restart();
  assert.equal((await f.create().inspectOriginalSession()).currentPhase,
    'APPLIED');
});
test('tampering original T3 Event chain is denied after cold restart',async()=>{
  const f=fixture(),port=f.create();
  await port.advanceOriginalSessionPhase({
    phase:'INTENT',evidence:evidence('original:event:seven'),
  });
  f.kernel.events[0].payload.chainHash=H;
  f.restart();
  await assert.rejects(f.create().inspectOriginalSession(),
    isCode('PHASE_ORIGINAL_EVENT_CHAIN_MISMATCH'));
  assert.equal(f.kernel.calls,1);
});
test('tampering original T3 history cannot rewrite a past intent',async()=>{
  const f=fixture(),port=f.create();
  await port.advanceOriginalSessionPhase({
    phase:'INTENT',evidence:evidence('original:event:seven'),
  });
  await port.advanceOriginalSessionPhase({
    phase:'PUBLISHED',evidence:evidence('original:network:readback'),
  });
  f.kernel.objects.values().next().value.object.data.stages[0]
    .evidence.evidenceDigest=B;
  await assert.rejects(port.inspectOriginalSession(),
    isCode('PHASE_ORIGINAL_CHAIN_INVALID'));
  assert.equal(f.kernel.calls,2);
});
test('same stage changed evidence is conflict and never overwrites T3 object',async()=>{
  const f=fixture(),port=f.create();
  await port.advanceOriginalSessionPhase({
    phase:'INTENT',evidence:evidence('original:event:seven'),
  });
  await assert.rejects(port.advanceOriginalSessionPhase({
    phase:'INTENT',evidence:evidence('different:source:event'),
  }),isCode('PHASE_ALREADY_ADVANCED_OR_CONFLICT'));
  assert.equal(f.kernel.calls,1);
});
test('out-of-order role, absence of evidence or revoked phase rights fail closed',async()=>{
  const f=fixture(),port=f.create();
  await assert.rejects(port.advanceOriginalSessionPhase({
    phase:'RECEIVED',evidence:evidence('signed:received'),
  }),isCode('PHASE_ROLE_OR_STAGE_UNSUPPORTED'));
  f.denyEvidence();
  await assert.rejects(port.advanceOriginalSessionPhase({
    phase:'INTENT',evidence:evidence('original:event:seven'),
  }),isCode('PHASE_ORIGINAL_EVIDENCE_NOT_VERIFIED'));
  f.revokeWrite();
  await assert.rejects(port.advanceOriginalSessionPhase({
    phase:'INTENT',evidence:evidence('original:event:seven'),
  }),e=>['PHASE_ORIGINAL_ACCESS_DENIED',
    'PHASE_ORIGINAL_EVIDENCE_NOT_VERIFIED'].includes(e.code));
  assert.equal(f.kernel.calls,0);
});
test('LOCAL_T3 cannot read or write any phase, without network dependencies',async()=>{
  const f=fixture();f.local();
  await assert.rejects(f.create().inspectOriginalSession(),
    isCode('PHASE_NETWORK_MODE_OFF'));
  assert.equal(f.kernel.reads,0);
  assert.equal(f.kernel.calls,0);
});
test('recipient APPLIED phase requires original readback again after cold restart',async()=>{
  const f=fixture(recipientNodeRef),port=f.create();
  for(const phase of ['RECEIVED','VERIFIED']){
    await port.advanceOriginalSessionPhase({
      phase,evidence:evidence('signed:ack:'+phase),
    });
  }
  f.allowApplied();
  await port.advanceOriginalSessionPhase({
    phase:'APPLIED',evidence:evidence('original:recipient:result','APPLIED'),
  });
  const row=f.kernel.objects.values().next().value;
  row.object.data.stages[2].evidence.originalRecipientStateDigest=H;
  await assert.rejects(f.create().inspectOriginalSession(),
    isCode('PHASE_ORIGINAL_CHAIN_INVALID'));
});
test('missing original Event makes phase non-verifiable, despite stored technical Object',async()=>{
  const f=fixture();
  await f.create().advanceOriginalSessionPhase({
    phase:'INTENT',evidence:evidence('original:event:seven'),
  });
  f.kernel.events.pop();
  await assert.rejects(f.create().inspectOriginalSession(),
    isCode('PHASE_ORIGINAL_EVENT_CHAIN_INCOMPLETE'));
});

test('source APPLIED_CONFIRMED requires an independent original recipient Result, not a signed ACK',async()=>{
  const f=fixture(),port=f.create();
  await port.advanceOriginalSessionPhase({
    phase:'INTENT',evidence:evidence('event:source:intent'),
  });
  await port.advanceOriginalSessionPhase({
    phase:'PUBLISHED',evidence:evidence('network:published'),
  });
  const ack=evidence('signed:network:ack','APPLIED_CONFIRMED');
  await assert.rejects(port.advanceOriginalSessionPhase({
    phase:'APPLIED_CONFIRMED',evidence:ack,
  }),isCode('PHASE_ORIGINAL_APPLIED_NOT_PROVEN'));
  assert.equal(f.kernel.events.length,2);
  f.allowApplied();
  const confirmed=await port.advanceOriginalSessionPhase({
    phase:'APPLIED_CONFIRMED',evidence:ack,
  });
  assert.equal(confirmed.originalBusinessApplied,true);
  assert.equal(confirmed.revision,3);
  assert.equal(f.kernel.events.length,3);
  f.restart();
  const recovered=f.create();
  const status=await recovered.inspectOriginalSession();
  assert.equal(status.currentPhase,'APPLIED_CONFIRMED');
  assert.equal(status.originalBusinessApplied,true);
  const again=await recovered.advanceOriginalSessionPhase({
    phase:'APPLIED_CONFIRMED',evidence:ack,
  });
  assert.equal(again.status,'ALREADY_CONFIRMED');
  assert.equal(f.kernel.calls,3);
  f.kernel.events[2].payload.evidenceDigest=B;
  await assert.rejects(recovered.inspectOriginalSession(),
    isCode('PHASE_ORIGINAL_EVENT_CHAIN_MISMATCH'));
});

test('new original recipient policy reserves an apply intent in the same phase Object',async()=>{
  const f=fixture(recipientNodeRef),port=createT4OriginalNetworkSessionPhasePort({
    ...f.base,recipientApplyIntentRequired:true,
  });
  await port.advanceOriginalSessionPhase({phase:'RECEIVED',evidence:evidence('signed:received:one')});
  await port.advanceOriginalSessionPhase({phase:'VERIFIED',evidence:evidence('signed:change:one')});
  f.allowApplied();
  await assert.rejects(port.advanceOriginalSessionPhase({
    phase:'APPLIED',evidence:evidence('signed:applied:one','APPLIED'),
  }),isCode('PHASE_PREDECESSOR_NOT_PROVEN'));
  await assert.rejects(port.advanceOriginalSessionPhase({
    phase:'APPLY_INTENT',evidence:evidence('signed:change:other'),
  }),isCode('PHASE_ORIGINAL_APPLY_INTENT_CHANGE_MISMATCH'));
  const intent=await port.advanceOriginalSessionPhase({
    phase:'APPLY_INTENT',evidence:evidence('signed:change:one'),
  });
  assert.equal(intent.revision,3);
  assert.equal((await port.inspectOriginalSession()).originalBusinessApplied,false);
  // No parallel phase ledger and no downgrade to legacy three-phase mode.
  assert.equal(f.kernel.objects.size,1);
  assert.equal(f.create().checkpointRef,port.checkpointRef);
  await assert.rejects(f.create().inspectOriginalSession(),
    isCode('PHASE_ORIGINAL_RECIPIENT_POLICY_MISMATCH'));
  await port.advanceOriginalSessionPhase({
    phase:'APPLIED',evidence:evidence('signed:applied:one','APPLIED'),
  });
  assert.equal((await port.inspectOriginalSession()).revision,4);
  assert.equal(f.kernel.calls,4);
});

test('inactive original Host cannot return even an empty phase checkpoint after an awaited original read',async()=>{
  const f=fixture();let active=true;
  const read=f.kernel.kernel.getObject;
  f.kernel.kernel.getObject=async(...args)=>{const row=await read(...args);active=false;return row;};
  const port=f.create().forOriginalHostLifetime(()=>active);
  await assert.rejects(port.inspectOriginalSession(),isCode('ORIGINAL_HOST_LIFETIME_ENDED'));
  assert.equal(f.kernel.calls,0);
  active=true;
  await assert.rejects(port.inspectOriginalSession(),isCode('ORIGINAL_HOST_LIFETIME_ENDED'));
});


const retirementRequest=status=>({expectedRevision:status.revision,expectedChainHash:status.chainHash,
  decisionRef:'decision:k46:replace',decisionDigest:B});
function retirementFixture(){
  const f=fixture(recipientNodeRef),decisions=[];let allow=true;
  const base={...f.base,recipientApplyIntentRequired:true,
    authorizeOriginalRecipientSupersession:async p=>{decisions.push(structuredClone(p));return allow;}};
  const port=patch=>createT4OriginalNetworkSessionPhasePort({...base,...patch});
  return {...f,base,port,decisions,deny:()=>{allow=false;}};
}
for(const prior of [null,'RECEIVED','VERIFIED']){
  test('K46 terminal retirement at '+(prior??'GENESIS')+' binds one successor in original phase CAS and survives cold read',async()=>{
    const f=retirementFixture(),p=f.port();
    if(prior!==null)await p.advanceOriginalSessionPhase({phase:'RECEIVED',evidence:evidence('frame:change')});
    if(prior==='VERIFIED')await p.advanceOriginalSessionPhase({phase:'VERIFIED',evidence:evidence('frame:change')});
    const before=await p.inspectOriginalSession(),request=retirementRequest(before);
    const result=await p.retireOriginalRecipientAttempt(request);
    assert.equal(result.status,'RECORDED');
    assert.equal(result.revision,before.revision+1);
    assert.equal(result.originalApplyIntentAbsent,true);
    assert.equal(result.originalNewAttemptAdmissionStillRequired,true);
    assert.equal(result.liveNetworkAuthorityGranted,false);
    const next=deriveT4OriginalReplacementAttempt(f.base);
    assert.equal(result.replacement.replacementSessionRef,next.replacementSessionRef);
    assert.equal(next.changeId,changeId);assert.notEqual(next.replacementSessionRef,sessionRef);
    assert.deepEqual(deriveT4OriginalReplacementAttempt({...f.base,localNodeRef:sourceNodeRef,
      technicalWorkspaceId:'ws:other:technical'}),next);
    assert.notEqual(deriveT4OriginalReplacementAttempt({...f.base,ownerEpoch:3}).replacementSessionRef,next.replacementSessionRef);
    assert.equal(f.kernel.objects.size,1);
    assert.equal(f.kernel.events.length,before.revision+1);
    f.restart();
    const cold=f.port({authorizeOriginalRecipientSupersession:null});
    const read=await cold.inspectOriginalSession();
    assert.equal(read.currentPhase,'SUPERSEDED');
    assert.equal(read.recipientApplyIntentEvidence,null);
    assert.equal(read.originalRecipientAttemptSuperseded,true);
    assert.equal(read.originalSupersessionEventId,result.originalSupersessionEventId);
    assert.equal(read.originalSupersessionEventId,f.kernel.events.at(-1).event_id);
    assert.equal(read.originalSupersessionPreviousChainHash,before.chainHash);
    assert.equal(read.originalBusinessApplied,false);
    assert.equal(read.originalT3EventChainVerified,true);
    const repeated=await f.port().retireOriginalRecipientAttempt(request);
    assert.equal(repeated.status,'ALREADY_CONFIRMED');
    assert.equal(repeated.chainHash,result.chainHash);
    assert.equal(f.kernel.calls,before.revision+1);
    for(const phase of ['RECEIVED','VERIFIED','APPLY_INTENT','APPLIED'])
      await assert.rejects(cold.advanceOriginalSessionPhase({phase,evidence:evidence('frame:change',phase)}),
        isCode('PHASE_ORIGINAL_RECIPIENT_ATTEMPT_SUPERSEDED'));
    await assert.rejects(f.port().retireOriginalRecipientAttempt({...request,decisionRef:'decision:foreign'}),
      isCode('PHASE_ORIGINAL_SUPERSESSION_DECISION_CONFLICT'));
    f.deny();await assert.rejects(f.port().retireOriginalRecipientAttempt(request),isCode('PHASE_ORIGINAL_SUPERSESSION_DENIED'));
    assert.equal(f.kernel.calls,before.revision+1);
  });
}
test('K46 original apply reservation forbids retirement even when no recipient result is available',async()=>{
  const f=retirementFixture(),p=f.port();
  for(const phase of ['RECEIVED','VERIFIED','APPLY_INTENT'])
    await p.advanceOriginalSessionPhase({phase,evidence:evidence('frame:change')});
  const status=await p.inspectOriginalSession();
  await assert.rejects(p.retireOriginalRecipientAttempt({expectedRevision:2,
    expectedChainHash:status.chainHash,decisionRef:'decision:k46:replace',decisionDigest:B}),
    isCode('PHASE_ORIGINAL_SUPERSESSION_APPLY_OUTCOME_REQUIRED'));
  f.allowApplied();await p.advanceOriginalSessionPhase({phase:'APPLIED',evidence:evidence('ack:done','APPLIED')});
  await assert.rejects(p.retireOriginalRecipientAttempt({expectedRevision:2,
    expectedChainHash:status.chainHash,decisionRef:'decision:k46:replace',decisionDigest:B}),
    isCode('PHASE_ORIGINAL_SUPERSESSION_APPLY_OUTCOME_REQUIRED'));
  assert.equal(f.kernel.calls,4);assert.equal(f.decisions.length,0);
});
test('K46 loss of retirement CAS response is recovered exactly; missing Object with surviving Event cannot create a fence',async()=>{
  const f=retirementFixture(),p=f.port(),request=retirementRequest(await p.inspectOriginalSession());
  f.kernel.loseNextReply();
  await assert.rejects(p.retireOriginalRecipientAttempt(request),isCode('PHASE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  f.restart();
  assert.equal((await f.port().retireOriginalRecipientAttempt(request)).status,'ALREADY_CONFIRMED');
  assert.equal(f.kernel.calls,1);f.kernel.objects.clear();
  await assert.rejects(f.port().inspectOriginalSession(),isCode('PHASE_ORIGINAL_EVENT_CHAIN_INCOMPLETE'));
  await assert.rejects(f.port().retireOriginalRecipientAttempt(request),isCode('PHASE_ORIGINAL_EVENT_CHAIN_INCOMPLETE'));
  assert.equal(f.kernel.calls,1);
});
test('K46 retirement and APPLY_INTENT contend on one original CAS; only one transition wins',async()=>{
  const f=retirementFixture(),p=f.port();
  for(const phase of ['RECEIVED','VERIFIED'])await p.advanceOriginalSessionPhase({phase,evidence:evidence('frame:change')});
  const before=await p.inspectOriginalSession(),request=retirementRequest(before);
  let unblock,arrived=0;const gate=new Promise(r=>{unblock=r;});
  const write=async proof=>{if(['SUPERSEDED','APPLY_INTENT'].includes(proof.phase)){
    arrived++;if(arrived===2)unblock();await gate;}return true;};
  const p1=f.port({authorizeOriginalTechnicalWrite:write}),p2=f.port({authorizeOriginalTechnicalWrite:write});
  const results=await Promise.allSettled([p1.retireOriginalRecipientAttempt(request),
    p2.advanceOriginalSessionPhase({phase:'APPLY_INTENT',evidence:evidence('frame:change')})]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.filter(x=>x.status==='rejected').length,1);
  const final=await f.port().inspectOriginalSession();
  assert.equal(final.revision,3);assert.ok(['SUPERSEDED','APPLY_INTENT'].includes(final.currentPhase));
  assert.equal(f.kernel.events.length,3);
  if(final.currentPhase==='SUPERSEDED')assert.equal(final.recipientApplyIntentEvidence,null);
  else assert.equal(final.originalRecipientAttemptSuperseded,undefined);
});
test('K46 retirement authority is explicit, recipient-only, and never inferred from transport or legacy phase',async()=>{
  const f=fixture(recipientNodeRef),legacy=f.create();
  assert.equal(legacy.retireOriginalRecipientAttempt,undefined);
  assert.throws(()=>createT4OriginalNetworkSessionPhasePort({...f.base,authorizeOriginalRecipientSupersession:async()=>true}),
    isCode('PHASE_ORIGINAL_T3_HOST_PORTS_REQUIRED'));
  const g=retirementFixture(),p=g.port(),request=retirementRequest(await p.inspectOriginalSession());
  g.deny();await assert.rejects(p.retireOriginalRecipientAttempt(request),isCode('PHASE_ORIGINAL_SUPERSESSION_DENIED'));
  assert.equal(g.kernel.calls,0);
});


// Real Ed25519 wire signatures and the original replay/phase contracts.
// The transport and Kernel ports here are fixtures, not an installed Host
// or proof of durable outgoing control publication.
async function controlFixture({indexed=false,realSourceHistory=false,canonicalCapture=false,multipartHandshake=false}={}){
  const f=retirementFixture(),sourceStore=fakeKernel(),ws='ws:k47:subject',epoch=2,
    suite='X25519_AES256GCM_ED25519',sha=x=>createHash('sha256').update(x).digest('hex');
  const sourceEventId='event:k47:original',sourceEvents=[{event_id:'event:k47:baseline',workspace_id:ws,
    service_id:'service:k47:source',object_id:'object:k47:one',revision:6,event_type:'business.changed',occurred_at:'2026-11-25T09:00:00Z',payload:{title:'before'}},
    {event_id:sourceEventId,workspace_id:ws,service_id:'service:k47:source',object_id:'object:k47:one',revision:7,
      event_type:'business.changed',occurred_at:'2026-11-25T09:01:00Z',payload:{title:'after'}}];
  const readOriginalEvents=async()=>structuredClone(sourceEvents),originalRead={workspaceId:ws,originalWriteOwnerRef:owner,
    maxEvents:1,authorizeOriginalRead:async()=>true,readOriginalEvents};
  const originalBefore=realSourceHistory?(await readT4OriginalEventWindow(originalRead)).nextCursor:null;
  const originalWindow=realSourceHistory?await readT4OriginalEventWindow({...originalRead,cursor:originalBefore}):null;
  if(multipartHandshake)f.base.changeKind='ASSET_PUT';
  const capture={kind:multipartHandshake?'ASSET_PUT':'OBJECT_PUT',captureRef:'capture:k47:one',
    workspaceId:ws,originalWriteOwnerRef:owner,sourceEventId,sourceRevision:7,
    originalIntentEventAndCanonicalBytesVerified:true,capturedWindowDigestVerified:true,
    sourceWindow:originalWindow?.window??{lastEventId:sourceEventId,eventRefs:[{eventDigest:H}],windowDigest:B,
      sourcePrefixDigestBefore:H,sourcePrefixDigestAfter:B},
    prepared:canonicalCapture?await prepareT4OriginalObjectDelta({window:originalWindow.window,workspaceId:ws,objectId:'object:k47:one',
      originalWriteOwnerRef:owner,originalKernel:{hasOperation:op=>op==='t1.getObject',getObject:async()=>({object:{object_id:'object:k47:one',
        schema_id:'iwxa.demo.note',schema_version:'1.0.0',revision:7,data:{title:'after'},extensions:{}}})},
      authorizeOriginalRead:async()=>true,getMode:()=> 'T4_NETWORK'}):{bytes:new Uint8Array(Buffer.from('original capture')),sha256:sha('original capture'),
      delta:{sourceEventId,sourceRevision:7,sourceEventDigest:originalWindow?.window.eventRefs[0].eventDigest??H,windowDigest:originalWindow?.window.windowDigest??B}}};
  const task={schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_OUTBOX_TASK_V1',
    state:'ORIGINAL_NATIVE_CAPTURE_READY',workspaceId:ws,originalWriteOwnerRef:owner,sourceNodeRef,recipientNodeRef,
    scopeRef,ownerEpoch:epoch,networkTargetRef:recipientNodeRef,networkPublished:false,sourceCursorAdvanced:false,
    originalRecipientApplied:false,sourceCursorBefore:originalBefore??{sourcePrefixDigest:H},sourceCursorAfter:originalWindow?.nextCursor??{sourcePrefixDigest:B},capture};
  const session=deriveT4OriginalNativeCaptureSession(task);
  const phase=()=>f.port({sessionRef:session.sessionRef,changeId:session.changeId});
  let network=true,sourceAllowed=true,recipientAllowed=true,captureVerified=true,acceptanceAllowed=true,readRecipient=true,
    sourcePhaseAllowed=true,sourceRecordAllowed=true,frontierChanged=false,sourceApplied=false,
    recipientFrontierChanged=false,replacementAllowed=true;
  let sourceKey={...generateKeyPairSync('ed25519'),id:'key:k47:source:1'},
    recipientKey={...generateKeyPairSync('ed25519'),id:'key:k47:recipient:1'};
  const historicalKeys=new Map([[sourceKey.id,sourceKey.publicKey],[recipientKey.id,recipientKey.publicKey]]);let networkAvailable=true;
  const historicalSignature=(node)=>async p=>{const key=historicalKeys.get(p.signerRef);
    if(!key||!verify(null,Buffer.from(p.bytes),key,Buffer.from(p.signature)))return null;
    return {schema:'IWXA_T4_ORIGINAL_HISTORICAL_SIGNATURE_V1',frameDigest:p.frameDigest,signerRef:p.signerRef,
      direction:p.sourceNodeRef===node?'LOCAL':'PEER',originalHistoricalSignatureVerified:true,originalHistoricalAcceptanceProven:false,
      liveNetworkAuthorityGranted:false,trustedSigningTimeProven:false,originalBusinessApplied:false};};
  const frames=new Map(),indexes=new Map();let networkPuts=0,networkGets=0,signatures=0,loseControlWrite=false,controlPublicationAllowed=true;
  const wire={wireKind:'T4_NETWORK_CANDIDATE',forOriginalHostLifetime(){return this;},
    async putSnapshot({key,bytes,expectedSha256}){assert.equal(sha(bytes),expectedSha256);
      if(frames.has(key)){assert.deepEqual(frames.get(key),new Uint8Array(bytes));
        return {key,sha256:expectedSha256,state:'ALREADY_PRESENT_VERIFIED'};}
      frames.set(key,new Uint8Array(bytes));networkPuts++;
      if(loseControlWrite){loseControlWrite=false;throw Object.assign(Error('lost control response'),{code:'OUTCOME_UNKNOWN'});}
      return {key,sha256:expectedSha256,state:'PUBLISHED_AND_READ_BACK'};},
    async getSnapshot({key,expectedSha256}){networkGets++;if(!networkAvailable)throw Error('network offline');
      const bytes=frames.get(key);assert.ok(bytes);assert.equal(sha(bytes),expectedSha256);return {bytes:new Uint8Array(bytes)};},
    async inspectOutcome({key,expectedSha256}){if(!networkAvailable)throw Error('network offline');assert.equal(sha(frames.get(key)),expectedSha256);
      return {key,sha256:expectedSha256,state:'EXPECTED_BYTES_PRESENT'};}};
  if(indexed){
    const receipt=(key,frameSha256)=>({schema:'IWXA_T4_NATIVE_FRAME_INDEX_READ_V1',key,frameSha256,
      addressMetadataIsNotSignatureOrAuthority:true,originalBusinessApplied:false});
    Object.assign(wire,{nativeFrameIndexVersion:1,
      async getNativeFrameIndex({key}){return indexes.has(key)?receipt(key,indexes.get(key)):null;},
      async putNativeFrameIndex({key,frameSha256}){
        if(indexes.has(key))assert.equal(indexes.get(key),frameSha256);
        indexes.set(key,frameSha256);return receipt(key,frameSha256);
      }});
  }
  const getMode=()=>network?'T4_NETWORK':'LOCAL_T3';
  const context=(node,technical)=>async()=>({workspaceId:technical,originalWriteOwnerRef:owner,
    originalOwnerRef:owner,nodeRef:node,scopeRef,hostSessionRef:'host:k47:'+node});
  const localKey=node=>node===sourceNodeRef?sourceKey:recipientKey;
  const transport=(node,patch={})=>{
    const technical=node===sourceNodeRef?'ws:k47:source:technical':workspace,
      kernel=node===sourceNodeRef?sourceStore.kernel:f.kernel.kernel,ctx=context(node,technical);
    const replay=createT4OriginalNetworkReplayPort({originalKernel:kernel,technicalWorkspaceId:technical,
      originalWriteOwnerRef:owner,localNodeRef:node,scopeRef,getMode,readOriginalHostContext:ctx,
      authorizeOriginalTechnicalRead:async()=>true,authorizeOriginalTechnicalWrite:async()=>true});
    return createT4CandidateFrameTransport({wireTransport:wire,getMode,readOriginalHostContext:ctx,
      originalHostNodeRef:node,originalHostScopeRef:scopeRef,authorizeOriginalHostWire:async()=>true,
      verifyOriginalNodeSignature:async p=>{const k=localKey(p.sourceNodeRef);
        return p.signerRef===k.id&&verify(null,Buffer.from(p.bytes),k.publicKey,Buffer.from(p.signature));},
      authorizeOriginalNetwork:async p=>['ATTEMPT_RETIRE_REQUEST','ATTEMPT_RETIRED_ACK','APPLIED_ACK','HEADS','DIFF_REQUEST','CHANGE_REF','CHUNK'].some(t=>p.operation==='t4.network.receive.'+t),
      persistOriginalReplayDecision:replay.persistOriginalReplayDecision,
      verifyOriginalHistoricalNodeSignature:historicalSignature(node),
      readOriginalHistoricalReplayEvidence:replay.readOriginalHistoricalReplayEvidence,
      readOriginalHistoricalAppliedAckSlot:replay.readOriginalHistoricalAppliedAckSlot,
      ...(multipartHandshake?{enableOriginalMultipartNegotiation:true,
        readOriginalMultipartAgreement:async()=>assert.fail('handshake must not authorize content')}: {}),...patch});
  };
  const signing=node=>({getMode,requiredCryptoSuite:suite,
    resolveOriginalSigningContext:async p=>{assert.equal(p.originalNodeSigningAuthorityRequired,true);
      assert.equal(p.session.workspaceId,ws);assert.ok(p.session.sessionRef.startsWith('session:t4:control:'));
      return {permissionRef:'permission:k47:'+node,signerRef:localKey(node).id};},
    signOriginalNodeBytes:async p=>{signatures++;const k=localKey(node);assert.equal(p.signerRef,k.id);
      return new Uint8Array(sign(null,Buffer.from(p.bytes),k.privateKey));}});
  const technical='ws:k47:source:technical',sourcePhase=(patch={})=>createT4OriginalNetworkSessionPhasePort({
    ...f.base,originalKernel:sourceStore.kernel,technicalWorkspaceId:technical,localNodeRef:sourceNodeRef,
    recipientApplyIntentRequired:false,authorizeOriginalRecipientSupersession:null,
    sessionRef:session.sessionRef,changeId:session.changeId,getMode,readOriginalHostContext:context(sourceNodeRef,technical),
    authorizeOriginalTechnicalRead:async()=>true,authorizeOriginalTechnicalWrite:async()=>true,
    verifyOriginalPhaseEvidence:async()=>true,verifyOriginalRecipientApplied:async()=>sourceApplied,
    authorizeOriginalSourceSupersession:async proof=>sourcePhaseAllowed&&proof.originalRecipientRetirementEvidenceRequired===true&&
      proof.originalAcceptedAppliedAckAbsentRequired===true&&proof.originalSubjectMutationAllowed===false,...patch});
  const sourceCursorBefore=originalBefore??{schema:'IWXA_T4_ORIGINAL_EVENT_CURSOR_V1',workspaceId:ws,originalWriteOwnerRef:owner,
    lastEventId:'event:k47:baseline',seenEventCount:1,sourcePrefixDigest:H,originalPermissionProof:false};
  // K69 runs both actual original cursor ports against the same two
  // Kernel fixtures used by the session phases, replay and publications.
  let frontierWriteAllowed=true;
  const cursorArgs=role=>{
    const source=role==='SOURCE',node=source?sourceNodeRef:recipientNodeRef;
    const identity={technicalWorkspaceId:source?technical:workspace,sourceWorkspaceId:ws,
      originalWriteOwnerRef:owner,sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch:epoch};
    return {...identity,originalKernel:source?sourceStore.kernel:f.kernel.kernel,getMode,
      readOriginalHostContext:context(node,identity.technicalWorkspaceId),authorizeOriginalTechnicalRead:async()=>true,
      authorizeOriginalTechnicalWrite:async()=>frontierWriteAllowed,authorizeOriginalSourceRead:async()=>true,
      readOriginalSourceEvents:readOriginalEvents,
      readOriginalAdmittedBaseline:async()=>({schema:'IWXA_T4_ORIGINAL_'+role+'_BASELINE_V1',identity,
        sourceCursor:sourceCursorBefore,originalBaselineRef:'baseline:k69:'+role,originalBaselineDigest:H})};
  };
  const realSourceCursor=()=>createT4OriginalNetworkHostCursorPort({...cursorArgs('SOURCE'),verifyOriginalSourceBaseline:async()=>true});
  const realRecipientCursor=()=>createT4OriginalNetworkRecipientCursorPort({...cursorArgs('RECIPIENT'),
    verifyOriginalRecipientBaseline:async()=>true,authorizeOriginalRecipientRead:async()=>true});
  // The earlier fixtures can still inject divergent frontiers explicitly.
  const cursorPort=Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_CURSOR_PORT_V1',
    checkpointRef:'cursor:k47:source',usesOriginalT3CAS:true,createsStore:false,
    inspectOriginalHostCursor:async()=>({schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_CURSOR_STATUS_V1',
      checkpointRef:'cursor:k47:source',sourceWorkspaceId:ws,originalWriteOwnerRef:owner,sourceNodeRef,recipientNodeRef,
      scopeRef,ownerEpoch:epoch,revision:0,chainHash:H,originalBaselineAdmitted:true,originalT3TechnicalWorkspaceOnly:true,
      originalBusinessApplyReceiptFabricated:false,otherCursorStoreCreated:false,originalT3EventChainVerified:false,
      originalT3NextCursor:frontierChanged?{...sourceCursorBefore,sourcePrefixDigest:B}:sourceCursorBefore,
      lastAcknowledgedChangeId:null,lastSourceEventId:null})});
  const recipientCursorPort=Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_RECIPIENT_CURSOR_PORT_V1',
    checkpointRef:'cursor:k50:recipient',originalT3OnlyStore:true,createsScheduler:false,
    inspectOriginalRecipientCursor:async()=>({schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_RECIPIENT_CURSOR_STATUS_V1',
      checkpointRef:'cursor:k50:recipient',sourceWorkspaceId:ws,originalWriteOwnerRef:owner,sourceNodeRef,recipientNodeRef,
      scopeRef,ownerEpoch:epoch,revision:0,chainHash:B,originalBaselineAdmitted:true,originalT3OnlyStore:true,
      originalSubjectMutationInvoked:false,sourceCursorAdvanced:false,originalT3EventChainVerified:false,
      originalT3VerifiedCursor:recipientFrontierChanged?{...sourceCursorBefore,sourcePrefixDigest:B}:sourceCursorBefore})});
  const sourceCursorAfter=originalWindow?.nextCursor??{...sourceCursorBefore,lastEventId:sourceEventId,seenEventCount:2,sourcePrefixDigest:B};
  const eligibilityOptions=()=>({originalCaptureSession:session,sourceCursorBefore,sourcePhasePort:sourcePhase(),
    recipientPhasePort:phase(),sourceCursorPort:realSourceHistory&&!frontierChanged?realSourceCursor():cursorPort,
    recipientCursorPort:realSourceHistory&&!recipientFrontierChanged?realRecipientCursor():recipientCursorPort,
    sourceHistoricalFramePort:transport(sourceNodeRef),
    requiredCryptoSuite:suite,getMode,verifyOriginalSourceCapture:async proof=>
      captureVerified&&proof.originalCaptureSession.sourceEventId===sourceEventId,
    authorizeOriginalReplacement:async proof=>replacementAllowed&&proof.originalBothAttemptsRetired===true});
  const eligibility=(patch={})=>recoverT4OriginalReplacementEligibility({...eligibilityOptions(),...patch});
  const createReplacementPort=async({session:identity},readOriginalReplacementEligibility,extra={})=>
    createT4OriginalNetworkPublicationPort({session:identity,localNodeRef:sourceNodeRef,technicalWorkspaceId:technical,
      originalKernel:sourceStore.kernel,getMode,readOriginalHostContext:context(sourceNodeRef,technical),
      authorizeOriginalTechnicalRead:async()=>true,authorizeOriginalTechnicalWrite:async()=>true,
      authorizeOriginalFramePublish:async()=>true,readOriginalReplacementEligibility,
      verifyOriginalNodeSignature:async p=>p.signerRef===sourceKey.id&&
        verify(null,Buffer.from(p.bytes),sourceKey.publicKey,Buffer.from(p.signature)),verifyOriginalHistoricalNodeSignature:historicalSignature(sourceNodeRef),
      frameTransport:transport(sourceNodeRef),...(multipartHandshake?{enableOriginalMultipartNegotiation:true}:{}),...extra});
  const createReplacementRecipientPort=async({session:identity},readOriginalReplacementRecipientAdmission,extra={})=>
    createT4OriginalNetworkPublicationPort({session:identity,localNodeRef:recipientNodeRef,technicalWorkspaceId:workspace,
      originalKernel:f.kernel.kernel,getMode,readOriginalHostContext:context(recipientNodeRef,workspace),
      authorizeOriginalTechnicalRead:async()=>true,authorizeOriginalTechnicalWrite:async()=>true,
      authorizeOriginalFramePublish:async()=>true,readOriginalReplacementRecipientAdmission,
      verifyOriginalNodeSignature:async p=>p.signerRef===recipientKey.id&&
        verify(null,Buffer.from(p.bytes),recipientKey.publicKey,Buffer.from(p.signature)),verifyOriginalHistoricalNodeSignature:historicalSignature(recipientNodeRef),
      frameTransport:transport(recipientNodeRef),...(multipartHandshake?{enableOriginalMultipartNegotiation:true}:{}),...extra});
  const recipientAdmissionOptions=phase=>({...eligibilityOptions(),sourceAdmissionPhasePort:phase,
    frameDiscoveryPort:transport(recipientNodeRef),...(multipartHandshake?{enableOriginalMultipartNegotiation:true}:{}),authorizeOriginalReplacementRecipientAdmission:async p=>
      recipientAllowed&&p.originalSourceIntentVerified===true&&p.originalRecipientDiffOnly===true&&p.originalSubjectMutationAllowed===false});
  const publishReplacementDiff=(phase,patch={})=>publishT4OriginalReplacementRecipientDiff({
    ...recipientAdmissionOptions(phase),createOriginalReplacementRecipientPublicationPort:createReplacementRecipientPort,
    resolveOriginalSigningContext:async p=>{
      assert.equal(p.originalReplacementRecipientDiffOnly,true);assert.equal(p.sequence,1);
      return {permissionRef:'permission:k47:'+recipientNodeRef,signerRef:recipientKey.id};},
    signOriginalNodeBytes:signing(recipientNodeRef).signOriginalNodeBytes,...patch});
  const publishReplacement=(patch={})=>publishT4OriginalReplacementSourceHead({...eligibilityOptions(),
    ...(multipartHandshake?{enableOriginalMultipartNegotiation:true}:{}),createOriginalReplacementPublicationPort:createReplacementPort,
    resolveOriginalSigningContext:async p=>{
      assert.equal(p.originalReplacementAnnouncementOnly,true);
      assert.equal(p.session.originalCaptureSession.sessionRef,session.sessionRef);
      return {permissionRef:'permission:k47:'+sourceNodeRef,signerRef:sourceKey.id};},
    signOriginalNodeBytes:signing(sourceNodeRef).signOriginalNodeBytes,...patch});
  const discoverReplacement=(patch={})=>discoverT4OriginalReplacementSourceHead({...eligibilityOptions(),
    frameDiscoveryPort:transport(recipientNodeRef),...(multipartHandshake?{enableOriginalMultipartNegotiation:true}:{}),...patch});
  const before=await phase().inspectOriginalSession();
  const plan=(requestRef='request:k47:one')=>prepareT4OriginalSupersessionControl({session,
    expectedPhaseRevision:before.revision,expectedPhaseChainHash:before.chainHash,decisionRef:'decision:k47:one',requestRef});
  const request=async p=>{
    const result=await signT4OriginalSupersessionRequest({plan:p,...signing(sourceNodeRef),
      authorizeOriginalSupersessionRequest:async proof=>sourceAllowed&&proof.originalSubjectMutationAllowed===false});
    assert.equal(result.networkPublished,false);
    await transport(sourceNodeRef).publishSignedFrame({wireBytes:result.wireBytes});return result;
  };
  const retire=(p,address)=>retireT4OriginalRecipientAttemptFromControl({plan:p,requestAddress:address,
    recipientPhasePort:phase(),frameDiscoveryPort:transport(recipientNodeRef),...signing(recipientNodeRef),
    verifyOriginalSourceCapture:async proof=>captureVerified&&proof.session.sourceEventId===sourceEventId&&
      proof.originalSourceCaptureAndFrontierReadRequired===true,
    authorizeOriginalRecipientSupersessionRequest:async proof=>recipientAllowed&&proof.originalSubjectMutationAllowed===false});
  const publishAck=ack=>transport(recipientNodeRef).publishSignedFrame({wireBytes:ack.wireBytes});
  const controlPublication=node=>async({session:identity})=>{
    const technical=node===sourceNodeRef?'ws:k47:source:technical':workspace,
      kernel=node===sourceNodeRef?sourceStore.kernel:f.kernel.kernel;
    return createT4OriginalNetworkPublicationPort({session:identity,localNodeRef:node,technicalWorkspaceId:technical,
      originalKernel:kernel,getMode,readOriginalHostContext:context(node,technical),
      authorizeOriginalTechnicalRead:async()=>true,authorizeOriginalTechnicalWrite:async()=>true,
      authorizeOriginalFramePublish:async()=>true,authorizeOriginalControlPublication:async proof=>
        controlPublicationAllowed&&proof.originalSubjectMutationAllowed===false&&proof.originalControlPublicationRequired===true,
      verifyOriginalNodeSignature:async p=>{const k=localKey(node);
        return p.signerRef===k.id&&verify(null,Buffer.from(p.bytes),k.publicKey,Buffer.from(p.signature));},
      frameTransport:transport(node)});
  };
  const durableRetire=(p,address,patch={})=>publishT4OriginalRecipientRetirementAck({plan:p,requestAddress:address,
    recipientPhasePort:phase(),frameDiscoveryPort:transport(recipientNodeRef),...signing(recipientNodeRef),
    verifyOriginalSourceCapture:async proof=>captureVerified&&proof.session.sourceEventId===sourceEventId,
    authorizeOriginalRecipientSupersessionRequest:async proof=>recipientAllowed&&proof.originalSubjectMutationAllowed===false,
    createOriginalControlPublicationPort:controlPublication(recipientNodeRef),...patch});
  const verifyAck=(p,address,patch={})=>verifyT4OriginalRecipientRetirementAck({plan:p,ackAddress:address,
    frameDiscoveryPort:transport(sourceNodeRef),getMode,requiredCryptoSuite:suite,
    readOriginalRecipientRetirement:async proof=>{assert.equal(proof.originalRecipientEventAndPhaseReadbackRequired,true);
      return readRecipient?phase().inspectOriginalSession():null;},
    authorizeOriginalSupersessionAcceptance:async proof=>acceptanceAllowed&&proof.originalSubjectMutationAllowed===false,...patch});
  const recordBoth=(p,address,sourceBefore,patch={})=>recordT4OriginalSourceSupersession({plan:p,ackAddress:address,
    sourceCursorBefore,sourcePhasePort:sourcePhase(),sourceCursorPort:cursorPort,
    expectedSourcePhaseRevision:sourceBefore.revision,expectedSourcePhaseChainHash:sourceBefore.chainHash,
    frameDiscoveryPort:transport(sourceNodeRef),getMode,requiredCryptoSuite:suite,
    verifyOriginalSourceCapture:async proof=>captureVerified&&proof.session.sourceEventId===sourceEventId,
    readOriginalRecipientRetirement:async()=>readRecipient?phase().inspectOriginalSession():null,
    authorizeOriginalSupersessionAcceptance:async()=>acceptanceAllowed,
    authorizeOriginalSourceSupersession:async proof=>sourceRecordAllowed&&proof.originalRecipientRetirementEventVerified===true,
    ...patch});
  const acceptConflictingAck=async()=>{
    const bytes=await signT4CandidateFrame({unsignedFrame:createT4CandidateUnsignedFrame({
      messageType:'APPLIED_ACK',messageId:'message:k48:old-ack',sourceNodeRef:recipientNodeRef,recipientNodeRef:sourceNodeRef,
      scopeRef,sessionRef:session.sessionRef,ownerEpoch:epoch,sequence:2,cryptoSuite:suite,criticalExtensions:[],
      signerRef:recipientKey.id,permissionRef:'permission:k47:'+recipientNodeRef,
      body:{changeId:session.changeId,contentDigest:H,ackRef:'ack:k48:conflict',recipientEventRef:'event:k48:conflict',
        recipientRevision:7,recipientStateDigest:B}}),signOriginalNodeBytes:signing(recipientNodeRef).signOriginalNodeBytes});
    const published=await transport(recipientNodeRef).publishSignedFrame({wireBytes:bytes});
    await transport(sourceNodeRef).readAndVerifySignedFrame({key:published.key,expectedSha256:published.sha256,requiredCryptoSuite:suite});
  };
  return {f,sourceStore,session,phase,plan,request,retire,publishAck,verifyAck,sourcePhase,recordBoth,acceptConflictingAck,
    task:{...task,sourceCursorBefore,sourceCursorAfter},readOriginalEvents,sourceEvents,offline:()=>{networkAvailable=false;},
    signSourceContent:signing(sourceNodeRef).signOriginalNodeBytes,
    signRecipientAck:signing(recipientNodeRef).signOriginalNodeBytes,
    recipientSigner:()=>({permissionRef:'permission:k47:'+recipientNodeRef,signerRef:recipientKey.id}),
    resolveSourceContentSigner:async()=>({permissionRef:'permission:k47:'+sourceNodeRef,signerRef:sourceKey.id}),
    durableRetire,signatureCount:()=>signatures,loseControlWrite:()=>{loseControlWrite=true;},
    eligibility,eligibilityOptions,sourceCursorBefore,sourceCursorAfter,transport,indexes,
    realSourceCursor,realRecipientCursor,setFrontierWriteAllowed:v=>{frontierWriteAllowed=v;},
    historicalReadOptions:node=>{
      const technicalWorkspaceId=node===sourceNodeRef?technical:workspace,kernel=node===sourceNodeRef?sourceStore.kernel:f.kernel.kernel;
      return {technicalWorkspaceId,localNodeRef:node,originalKernel:{hasOperation:op=>['t1.getObject','t1.listEventsSince','t1.listObjects'].includes(op),
        getObject:kernel.getObject,listEventsSince:kernel.listEventsSince,listObjects:kernel.listObjects},getMode,readOriginalHostContext:context(node,technicalWorkspaceId),
        authorizeOriginalTechnicalRead:async()=>true};
    },historicalSignature,verifySourceApplied:async()=>sourceApplied,
    publishReplacement,discoverReplacement,createReplacementPort,createReplacementRecipientPort,
    recipientAdmissionOptions,publishReplacementDiff,
    changeRecipientFrontier:()=>{recipientFrontierChanged=true;},restoreRecipientFrontier:()=>{recipientFrontierChanged=false;},
    denyReplacement:()=>{replacementAllowed=false;},allowReplacement:()=>{replacementAllowed=true;},
    signHead:async(body,sessionRef,criticalExtensions)=>signT4CandidateFrame({
      unsignedFrame:createT4CandidateUnsignedFrame({messageType:'HEADS',messageId:'message:k51:'+sessionRef,
        sourceNodeRef,recipientNodeRef,scopeRef,sessionRef,ownerEpoch:epoch,sequence:1,cryptoSuite:suite,
        permissionRef:'permission:k47:'+sourceNodeRef,signerRef:sourceKey.id,criticalExtensions,body}),
      signOriginalNodeBytes:signing(sourceNodeRef).signOriginalNodeBytes}),
    denyControlPublication:()=>{controlPublicationAllowed=false;},allowControlPublication:()=>{controlPublicationAllowed=true;},
    sourcePhaseWrites:()=>sourceStore.events.filter(e=>e.event_type==='t4.network.original.session.phase').length,
    changeFrontier:()=>{frontierChanged=true;},restoreFrontier:()=>{frontierChanged=false;},
    denySourceRecord:()=>{sourceRecordAllowed=false;},allowSourceRecord:()=>{sourceRecordAllowed=true;},
    denySourcePhase:()=>{sourcePhaseAllowed=false;},allowSourcePhase:()=>{sourcePhaseAllowed=true;},
    allowSourceApplied:()=>{sourceApplied=true;},
    phaseWrites:()=>f.kernel.events.filter(e=>e.event_type==='t4.network.original.session.phase').length,
    counts:()=>({networkPuts,networkGets}),denyCapture:()=>{captureVerified=false;},allowCapture:()=>{captureVerified=true;},
    denyRecipient:()=>{recipientAllowed=false;},allowRecipient:()=>{recipientAllowed=true;},
    denyAcceptance:()=>{acceptanceAllowed=false;},allowAcceptance:()=>{acceptanceAllowed=true;},
    denyRecipientRead:()=>{readRecipient=false;},allowRecipientRead:()=>{readRecipient=true;},
    rotateRecipient:()=>{recipientKey={...generateKeyPairSync('ed25519'),id:'key:k47:recipient:2'};historicalKeys.set(recipientKey.id,recipientKey.publicKey);},
    rotateSource:()=>{sourceKey={...generateKeyPairSync('ed25519'),id:'key:k47:source:2'};historicalKeys.set(sourceKey.id,sourceKey.publicKey);},
    stop:()=>{network=false;}};
}
test('K47 signed original retirement request and independent recipient phase/Event readback; a control ACK is not new transfer admission',async()=>{
  const x=await controlFixture(),plan=x.plan(),request=await x.request(plan);
  x.denyCapture();await assert.rejects(x.retire(plan,request),isCode('SUPERSESSION_ORIGINAL_SOURCE_CAPTURE_NOT_PROVEN'));
  assert.equal(x.phaseWrites(),0);
  x.allowCapture();x.denyRecipient();
  await assert.rejects(x.retire(plan,request),isCode('SUPERSESSION_ORIGINAL_RECIPIENT_DECISION_DENIED'));
  assert.equal(x.phaseWrites(),0);x.allowRecipient();
  const ack=await x.retire(plan,request);
  assert.equal(ack.retirementStatus,'RECORDED');assert.equal(ack.networkPublished,false);
  assert.equal(x.phaseWrites(),1);await x.publishAck(ack);
  x.denyRecipientRead();
  await assert.rejects(x.verifyAck(plan,ack),isCode('SUPERSESSION_ORIGINAL_RETIREMENT_NOT_PROVEN'));
  x.allowRecipientRead();x.denyAcceptance();
  await assert.rejects(x.verifyAck(plan,ack),isCode('SUPERSESSION_ORIGINAL_ACCEPTANCE_DENIED'));
  x.allowAcceptance();
  const result=await x.verifyAck(plan,ack);
  assert.equal(result.originalRecipientRetirementEventVerified,true);
  assert.equal(result.originalNewAttemptAdmissionStillRequired,true);
  assert.equal(result.originalSourceCursorAdvanced,false);
  assert.equal(result.originalSubjectMutationInvoked,false);
  assert.equal(result.liveNetworkAuthorityGranted,false);
  const read=await x.phase().inspectOriginalSession();
  assert.equal(result.retirement.retirementEventId,read.originalSupersessionEventId);
  await assert.rejects(x.verifyAck(plan,ack,{readOriginalRecipientRetirement:async()=>({...read,
    originalSupersessionEventId:'event:substituted'})}),isCode('SUPERSESSION_SIGNED_RETIREMENT_MISMATCH'));
  assert.equal(x.phaseWrites(),1);
});
test('K47 exact terminal phase CAS survives lost response and control re-attestation uses current keys without a second retirement or new change',async()=>{
  const x=await controlFixture(),plan=x.plan(),request=await x.request(plan);
  x.denyCapture();
  await assert.rejects(x.retire(plan,request),isCode('SUPERSESSION_ORIGINAL_SOURCE_CAPTURE_NOT_PROVEN'));
  x.allowCapture();x.f.kernel.loseNextReply();
  await assert.rejects(x.retire(plan,request),isCode('PHASE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  // The first control receipt was already in the replay journal, so the
  // lost response belongs to the phase CAS, not the network replay CAS.
  assert.equal(x.phaseWrites(),1);
  x.f.restart();const first=await x.retire(plan,request);await x.publishAck(first);
  assert.equal(first.retirementStatus,'ALREADY_CONFIRMED');
  x.rotateSource();x.rotateRecipient();
  await assert.rejects(x.verifyAck(plan,first),isCode('WIRE_SOURCE_SIGNATURE_NOT_VERIFIED'));
  const next=x.plan('request:k47:re-attest'),fresh=await x.request(next);
  assert.notEqual(next.claim.controlSessionRef,plan.claim.controlSessionRef);
  assert.equal(next.claim.body.decisionDigest,plan.claim.body.decisionDigest);
  assert.equal(next.claim.body.replacementSessionRef,plan.claim.body.replacementSessionRef);
  const second=await x.retire(next,fresh);await x.publishAck(second);
  assert.equal(second.retirementStatus,'ALREADY_CONFIRMED');
  assert.equal(second.retirement.retirementEventId,first.retirement.retirementEventId);
  assert.equal(second.retirement.retirementChainHash,first.retirement.retirementChainHash);
  assert.equal((await x.verifyAck(next,second)).originalRecipientRetirementEventVerified,true);
  assert.equal(x.phaseWrites(),1);
});


test('K48 source original phase records independently verified retirement only with unchanged frontier and no prior accepted APPLIED_ACK',async()=>{
  const x=await controlFixture(),p=x.plan(),request=await x.request(p),ack=await x.retire(p,request);
  await x.publishAck(ack);
  for(const phase of ['INTENT','PUBLISHED'])await x.sourcePhase().advanceOriginalSessionPhase({phase,evidence:evidence('original:source')});
  const before=await x.sourcePhase().inspectOriginalSession(),writes=x.sourcePhaseWrites();
  x.changeFrontier();
  await assert.rejects(x.recordBoth(p,ack,before),isCode('SUPERSESSION_ORIGINAL_SOURCE_FRONTIER_CHANGED'));
  x.restoreFrontier();x.denySourceRecord();
  await assert.rejects(x.recordBoth(p,ack,before),isCode('SUPERSESSION_ORIGINAL_SOURCE_DECISION_DENIED'));
  x.allowSourceRecord();x.denySourcePhase();
  await assert.rejects(x.recordBoth(p,ack,before),isCode('PHASE_ORIGINAL_SOURCE_SUPERSESSION_DENIED'));
  x.allowSourcePhase();assert.equal(x.sourcePhaseWrites(),writes);
  await x.verifyAck(p,ack);x.sourceStore.loseNextReply();
  await assert.rejects(x.recordBoth(p,ack,before),isCode('PHASE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  assert.equal(x.sourcePhaseWrites(),writes+1);
  const result=await x.recordBoth(p,ack,before);
  assert.equal(result.status,'ALREADY_CONFIRMED');
  assert.equal(result.originalSourceAttemptSuperseded,true);
  assert.equal(result.originalRecipientAttemptSuperseded,true);
  assert.equal(result.originalSourceCursorAdvanced,false);
  assert.equal(result.liveNetworkAuthorityGranted,false);
  assert.equal(result.originalNewAttemptAdmissionStillRequired,true);
  const cold=await x.sourcePhase({authorizeOriginalSourceSupersession:null}).inspectOriginalSession();
  assert.equal(cold.currentPhase,'SUPERSEDED');assert.equal(cold.originalBusinessApplied,false);
  assert.equal(cold.originalSourceSupersessionEvidence.retirement.retirementEventId,ack.retirement.retirementEventId);
  assert.equal(cold.originalSourceSupersessionEvidence.evidenceDigest,'sha256:'+ack.sha256);
  await assert.rejects(x.sourcePhase().advanceOriginalSessionPhase({phase:'APPLIED_CONFIRMED',
    evidence:evidence('ack:forbidden','APPLIED_CONFIRMED')}),isCode('PHASE_ORIGINAL_SOURCE_ATTEMPT_SUPERSEDED'));
  x.rotateRecipient();x.rotateSource();
  const next=x.plan('request:k48:current-keys'),fresh=await x.request(next),newAck=await x.retire(next,fresh);
  await x.publishAck(newAck);
  const reattested=await x.recordBoth(next,newAck,before);
  assert.equal(reattested.status,'ALREADY_CONFIRMED');
  assert.equal(reattested.originalSourcePhaseEventId,result.originalSourcePhaseEventId);
  assert.deepEqual(reattested.sourceRetirement,result.sourceRetirement);
  assert.notEqual(newAck.sha256,ack.sha256);
  assert.equal(x.sourcePhaseWrites(),writes+1);
});
test('K48 original accepted APPLIED_ACK forbids source supersession even when retirement control exists',async()=>{
  const x=await controlFixture(),p=x.plan(),request=await x.request(p),ack=await x.retire(p,request);
  await x.publishAck(ack);await x.acceptConflictingAck();
  const before=await x.sourcePhase().inspectOriginalSession();
  await assert.rejects(x.recordBoth(p,ack,before),isCode('SUPERSESSION_ORIGINAL_APPLIED_ACK_ALREADY_ACCEPTED'));
  assert.equal(x.sourcePhaseWrites(),0);
});
test('K48 source SUPERSEDED and APPLIED_CONFIRMED cannot both acquire the original phase CAS',async()=>{
  const x=await controlFixture(),p=x.plan(),request=await x.request(p),ack=await x.retire(p,request);
  for(const phase of ['INTENT','PUBLISHED'])await x.sourcePhase().advanceOriginalSessionPhase({phase,evidence:evidence('original:source')});
  const before=await x.sourcePhase().inspectOriginalSession();
  x.allowSourceApplied();
  let release,arrived=0;const gate=new Promise(r=>{release=r;});
  const write=async proof=>{if(['SUPERSEDED','APPLIED_CONFIRMED'].includes(proof.phase)){
    arrived++;if(arrived===2)release();await gate;}return true;};
  const a=x.sourcePhase({authorizeOriginalTechnicalWrite:write}),b=x.sourcePhase({authorizeOriginalTechnicalWrite:write});
  const settled=await Promise.allSettled([a.recordOriginalSourceSupersession({expectedRevision:before.revision,
    expectedChainHash:before.chainHash,retirementAckDigest:'sha256:'+ack.sha256,retirement:ack.retirement}),
    b.advanceOriginalSessionPhase({phase:'APPLIED_CONFIRMED',evidence:evidence('ack:done','APPLIED_CONFIRMED')})]);
  assert.equal(settled.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(settled.filter(x=>x.status==='rejected').length,1);
  assert.equal(x.sourcePhaseWrites(),3);
  assert.ok(['SUPERSEDED','APPLIED_CONFIRMED'].includes((await x.sourcePhase().inspectOriginalSession()).currentPhase));
});

test('K48 changed source frontier during final authorization never yields bilateral retirement proof',async()=>{
  const x=await controlFixture(),p=x.plan(),request=await x.request(p),ack=await x.retire(p,request);
  await x.publishAck(ack);
  const before=await x.sourcePhase().inspectOriginalSession();
  let checks=0;
  await assert.rejects(x.recordBoth(p,ack,before,{authorizeOriginalSourceSupersession:async()=>{
    if(++checks===2)x.changeFrontier();
    return true;
  }}),isCode('SUPERSESSION_ORIGINAL_SOURCE_FRONTIER_CHANGED'));
  assert.equal(checks,2);
  assert.equal(x.sourcePhaseWrites(),1);
  assert.equal((await x.sourcePhase().inspectOriginalSession()).currentPhase,'SUPERSEDED');
  x.restoreFrontier();
  assert.equal((await x.recordBoth(p,ack,before)).status,'ALREADY_CONFIRMED');
  assert.equal(x.sourcePhaseWrites(),1);
});

test('K49 recipient terminal retirement and durable outgoing ACK survive lost HTTPS response without a second retirement or signature',async()=>{
  const x=await controlFixture({indexed:true}),p=x.plan(),request=await x.request(p);
  const before=x.signatureCount();
  await assert.rejects(x.durableRetire(p,request,{createOriginalControlPublicationPort:null}),
    isCode('SUPERSESSION_ORIGINAL_CONTROL_PUBLICATION_PORT_REQUIRED'));
  assert.equal(x.phaseWrites(),0);
  x.loseControlWrite();
  await assert.rejects(x.durableRetire(p,request),isCode('PUBLICATION_NETWORK_OUTCOME_UNKNOWN'));
  assert.equal(x.signatureCount(),before+1);
  assert.equal(x.phaseWrites(),1);
  x.f.restart();x.denyControlPublication();
  await assert.rejects(x.durableRetire(p,request),isCode('PUBLICATION_ORIGINAL_CONTROL_AUTHORITY_DENIED'));
  x.allowControlPublication();const result=await x.durableRetire(p,request);
  assert.equal(result.publicationState,'REMOTE_READBACK_RECOVERED');
  assert.equal(result.retirementStatus,'ALREADY_CONFIRMED');
  assert.equal(result.networkPublished,true);
  assert.equal(result.originalSubjectMutationInvoked,false);
  assert.equal(x.phaseWrites(),1);assert.equal(x.signatureCount(),before+1);
  assert.equal((await x.verifyAck(p,result)).originalRecipientRetirementEventVerified,true);
  assert.deepEqual(x.f.kernel.events.filter(e=>e.event_type==='t4.network.original.frame.publication').map(e=>e.payload.action),
    ['PREPARE','ATTEMPT','PRESENT']);
});


async function closeInitialAttempt(x){
  const p=x.plan(),request=await x.request(p),ack=await x.retire(p,request);
  await x.publishAck(ack);
  await x.sourcePhase().advanceOriginalSessionPhase({phase:'INTENT',evidence:{
    evidenceRef:x.session.sourceEventId,evidenceDigest:x.session.capturedWindowDigest}});
  await x.sourcePhase().advanceOriginalSessionPhase({phase:'PUBLISHED',evidence:evidence('frame:old:change')});
  const before=await x.sourcePhase().inspectOriginalSession();
  await x.recordBoth(p,ack,before);
  return {p,ack,before};
}
test('K50 cold replacement eligibility requires two original terminal Events, exact capture and unchanged frontiers, without writing anything',async()=>{
  const x=await controlFixture();
  await assert.rejects(x.eligibility(),isCode('REPLACEMENT_ORIGINAL_PREDECESSOR_NOT_RETIRED'));
  await closeInitialAttempt(x);
  const before={source:x.sourceStore.calls,recipient:x.f.kernel.calls,network:x.counts()};
  const first=await x.eligibility();
  assert.equal(first.state,'ORIGINAL_REPLACEMENT_ELIGIBLE');
  assert.equal(first.originalBothTerminalPhaseEventsVerified,true);
  assert.equal(first.originalNewAttemptAdmissionStillRequired,true);
  assert.equal(first.liveNetworkAuthorityGranted,false);
  assert.equal(first.candidate.changeId,x.session.changeId);
  assert.equal(first.candidate.previousSessionRef,undefined);
  assert.equal(first.candidate.replacement.previousSessionRef,x.session.sessionRef);
  assert.equal(first.candidate.sessionRef,deriveT4OriginalReplacementAttempt(x.session).replacementSessionRef);
  assert.deepEqual(validateT4OriginalReplacementSessionCandidate(first.candidate),first.candidate);
  assert.throws(()=>validateT4OriginalNativeCaptureSession(first.candidate),
    isCode('PUBLICATION_ORIGINAL_CAPTURE_IDENTITY_INVALID'));
  x.f.restart();x.rotateSource();x.rotateRecipient();
  assert.deepEqual(await x.eligibility(),first);
  assert.deepEqual({source:x.sourceStore.calls,recipient:x.f.kernel.calls,network:x.counts()},before);
  x.changeFrontier();
  await assert.rejects(x.eligibility(),isCode('REPLACEMENT_ORIGINAL_CAUSAL_FRONTIER_CHANGED'));
  x.restoreFrontier();x.changeRecipientFrontier();
  await assert.rejects(x.eligibility(),isCode('REPLACEMENT_ORIGINAL_CAUSAL_FRONTIER_CHANGED'));
  x.restoreRecipientFrontier();x.denyCapture();
  await assert.rejects(x.eligibility(),isCode('REPLACEMENT_ORIGINAL_CAPTURE_NOT_PROVEN'));
  x.allowCapture();x.denyReplacement();
  await assert.rejects(x.eligibility(),isCode('REPLACEMENT_ORIGINAL_ADMISSION_DENIED'));
  x.allowReplacement();
  assert.deepEqual({source:x.sourceStore.calls,recipient:x.f.kernel.calls,network:x.counts()},before);
});
test('K50 a contradictory accepted old APPLIED_ACK or modified original retirement Event blocks candidate recovery',async()=>{
  const x=await controlFixture();await closeInitialAttempt(x);
  const good=await x.eligibility(),sourcePort=x.sourcePhase(),originalRead=sourcePort.inspectOriginalSession;
  await assert.rejects(x.eligibility({sourcePhasePort:{...sourcePort,inspectOriginalSession:async()=>{
    const v=await originalRead(),stored=structuredClone(v.originalSourceSupersessionEvidence);
    stored.retirement.retirementEventId='event:substituted';
    return {...v,currentEvidence:stored,originalSourceSupersessionEvidence:stored};
  }}}),isCode('REPLACEMENT_ORIGINAL_RETIREMENT_CONFLICT'));
  const event=x.f.kernel.events.find(e=>e.event_type==='t4.network.original.session.phase');
  const chain=event.payload.chainHash;event.payload.chainHash=H;
  await assert.rejects(x.eligibility(),isCode('PHASE_ORIGINAL_EVENT_CHAIN_MISMATCH'));
  event.payload.chainHash=chain;
  assert.deepEqual(await x.eligibility(),good);
  await x.acceptConflictingAck();
  await assert.rejects(x.eligibility(),isCode('REPLACEMENT_ORIGINAL_APPLIED_ACK_ALREADY_ACCEPTED'));
});
test('K51 replacement HEADS has a separate deterministic predecessor index and cannot replace the initial immutable HEADS',async()=>{
  const x=await controlFixture({indexed:true}),suite='X25519_AES256GCM_ED25519';
  const originalBody=createT4OriginalSourceSessionHead({session:x.session,sourceCursorBefore:x.sourceCursorBefore,
    sourceCursorAfter:x.sourceCursorAfter});
  const root=await x.signHead(originalBody,x.session.sessionRef,[T4_ORIGINAL_SOURCE_SESSION_EXTENSION]);
  const sender=x.transport(sourceNodeRef),receiver=x.transport(recipientNodeRef);
  const rootReceipt=await sender.publishSignedFrame({wireBytes:root});
  const rootIndex=t4NativeSourceHeadIndexKey({...x.session,predecessorEventCount:x.sourceCursorBefore.seenEventCount});
  assert.equal(x.indexes.get(rootIndex),rootReceipt.sha256);
  await closeInitialAttempt(x);
  const {candidate}=await x.eligibility();
  const body=createT4OriginalReplacementSourceHead({candidate,sourceCursorBefore:x.sourceCursorBefore,
    sourceCursorAfter:x.sourceCursorAfter});
  const bytes=await x.signHead(body,candidate.sessionRef,[T4_REPLACEMENT_SOURCE_SESSION_EXTENSION]);
  const published=await sender.publishSignedFrame({wireBytes:bytes});
  const predecessorIndex=t4NativeReplacementHeadIndexKey({...x.session,previousSessionRef:x.session.sessionRef});
  assert.notEqual(predecessorIndex,rootIndex);assert.equal(x.indexes.get(rootIndex),rootReceipt.sha256);
  assert.equal(x.indexes.get(predecessorIndex),published.sha256);
  assert.equal(x.indexes.get(t4NativeSessionFrameIndexKey({...candidate,sequence:1})),published.sha256);
  const selector={sourceNodeRef,ownerEpoch:2,previousSessionRef:x.session.sessionRef,
    sessionRef:candidate.sessionRef,changeId:candidate.changeId};
  const result=await receiver.discoverReplacementSourceHead({selector,requiredCryptoSuite:suite});
  assert.equal(result.state,'FOUND');assert.equal(result.candidatesExamined,1);
  assert.equal(result.originalNewAttemptAdmissionStillRequired,true);
  const received=result.receipts[0];
  assert.equal(received.originalSignatureVerified,true);assert.equal(received.originalSubjectMutationInvoked,false);
  const read=readT4OriginalReplacementSourceHead({identity:x.session,body:received.verifiedBody,
    sessionRef:received.verifiedSessionRef,sourceCursorBefore:x.sourceCursorBefore,expectedCandidate:candidate});
  assert.deepEqual(read.candidate,candidate);assert.equal(read.liveNetworkAuthorityGranted,false);
  const old=await receiver.discoverSourceSessionHeads({selector:{sourceNodeRef,ownerEpoch:2,
    familyRef:x.session.familyRef,predecessorEventCount:x.sourceCursorBefore.seenEventCount},requiredCryptoSuite:suite});
  assert.equal(old.receipts[0].verifiedSessionRef,x.session.sessionRef);
  x.indexes.set(predecessorIndex,rootReceipt.sha256);
  await assert.rejects(receiver.discoverReplacementSourceHead({selector,requiredCryptoSuite:suite}),
    isCode('WIRE_NATIVE_INDEX_TARGET_MISMATCH'));
  x.indexes.set(predecessorIndex,published.sha256);
  await assert.rejects(x.signHead(body,x.session.sessionRef,[T4_REPLACEMENT_SOURCE_SESSION_EXTENSION]),
    isCode('WIRE_REPLACEMENT_HEAD_IDENTITY_MISMATCH'));
  await assert.rejects(x.signHead(body,candidate.sessionRef,[T4_ORIGINAL_SOURCE_SESSION_EXTENSION]),
    isCode('WIRE_FIELDS_INVALID'));
  const conflict={...body,replacement:{...body.replacement,decisionDigest:H}};
  const conflictBytes=await x.signHead(conflict,candidate.sessionRef,[T4_REPLACEMENT_SOURCE_SESSION_EXTENSION]);
  const putsBeforeConflict=x.counts().networkPuts;
  await assert.rejects(sender.publishSignedFrame({wireBytes:conflictBytes}),isCode('WIRE_NATIVE_INDEX_SLOT_CONFLICT'));
  assert.equal(x.counts().networkPuts,putsBeforeConflict);
  assert.equal(x.indexes.get(predecessorIndex),published.sha256);
  assert.equal(x.indexes.get(rootIndex),rootReceipt.sha256);
});


test('K52 replacement HEAD is durable in the original publication ledger and cold discovery rechecks original terminal history',async()=>{
  const x=await controlFixture({indexed:true});await closeInitialAttempt(x);
  const first=await x.eligibility(),before={signs:x.signatureCount(),puts:x.counts().networkPuts,
    sourcePhase:x.sourcePhaseWrites(),recipientPhase:x.phaseWrites()};
  assert.equal((await x.discoverReplacement()).state,'WAITING_FOR_REPLACEMENT_HEAD');
  x.sourceStore.loseNextReply();
  await assert.rejects(x.publishReplacement(),isCode('PUBLICATION_ORIGINAL_CAS_OUTCOME_UNKNOWN'));
  assert.equal(x.signatureCount(),before.signs+1);
  assert.equal(x.counts().networkPuts,before.puts);
  x.loseControlWrite();
  await assert.rejects(x.publishReplacement(),isCode('PUBLICATION_NETWORK_OUTCOME_UNKNOWN'));
  assert.equal(x.signatureCount(),before.signs+1);assert.equal(x.counts().networkPuts,before.puts+1);
  x.denyReplacement();
  await assert.rejects(x.publishReplacement(),isCode('REPLACEMENT_ORIGINAL_ADMISSION_DENIED'));
  x.allowReplacement();
  const published=await x.publishReplacement();
  assert.equal(published.publicationState,'REMOTE_READBACK_RECOVERED');
  assert.deepEqual(published.candidate,first.candidate);
  assert.equal(x.signatureCount(),before.signs+1);assert.equal(x.counts().networkPuts,before.puts+1);
  const discovered=await x.discoverReplacement();
  assert.equal(discovered.state,'ORIGINAL_REPLACEMENT_HEAD_VERIFIED');
  assert.equal(discovered.headSha256,published.sha256);
  assert.equal(discovered.originalNewAttemptAdmissionStillRequired,true);
  assert.equal(discovered.liveNetworkAuthorityGranted,false);
  assert.equal(x.sourcePhaseWrites(),before.sourcePhase);assert.equal(x.phaseWrites(),before.recipientPhase);
  assert.deepEqual(await x.eligibility(),first);
  const port=await x.createReplacementPort({session:first.candidate},()=>x.eligibility());
  await assert.rejects(port.prepareSignedBatch({slots:[{sequence:2,messageType:'CHANGE_REF'}],
    createSignedFrames:async()=>assert.fail('subject transfer must not start')}),isCode('PUBLICATION_SLOT_BATCH_INVALID'));
  x.changeRecipientFrontier();
  await assert.rejects(x.discoverReplacement(),isCode('REPLACEMENT_ORIGINAL_CAUSAL_FRONTIER_CHANGED'));
  assert.equal(x.signatureCount(),before.signs+1);assert.equal(x.counts().networkPuts,before.puts+1);
});
test('K52 replacement publication requires a fresh original eligibility port, not a caller assertion',async()=>{
  const x=await controlFixture({indexed:true});await closeInitialAttempt(x);
  const {candidate}=await x.eligibility();
  await assert.rejects(x.createReplacementPort({session:candidate},null),
    isCode('PUBLICATION_ORIGINAL_REPLACEMENT_ELIGIBILITY_REQUIRED'));
  const port=await x.createReplacementPort({session:candidate},async()=>true);
  let calls=0;
  await assert.rejects(port.prepareSignedBatch({slots:[{sequence:1,messageType:'HEADS'}],
    createSignedFrames:async()=>{calls++;return [];}}),isCode('PUBLICATION_ORIGINAL_REPLACEMENT_ELIGIBILITY_CHANGED'));
  assert.equal(calls,0);
});

test('K53 successor source INTENT binds published HEADS and both terminal Events to original phase genesis; cold retry never writes twice',async()=>{
  const x=await controlFixture({indexed:true});await closeInitialAttempt(x);
  const createPhase=async({session:c,admission},readOriginalReplacementSourceAdmission)=>x.sourcePhase({
    sessionRef:c.sessionRef,authorizeOriginalSourceSupersession:null,replacementSourceAdmission:admission,
    readOriginalReplacementSourceAdmission});
  const admit=(patch={})=>admitT4OriginalReplacementSourcePhase({...x.eligibilityOptions(),
    createOriginalReplacementPublicationPort:x.createReplacementPort,createOriginalReplacementSourcePhasePort:createPhase,...patch});
  const oldWrites=x.sourcePhaseWrites();
  await assert.rejects(admit(),isCode('PUBLICATION_OUTBOUND_FRAME_NOT_PRESENT'));
  assert.equal(x.sourcePhaseWrites(),oldWrites);
  await x.publishReplacement();
  const before={signs:x.signatureCount(),puts:x.counts().networkPuts,writes:x.sourcePhaseWrites()};
  x.sourceStore.loseNextReply();
  await assert.rejects(admit(),isCode('PHASE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  assert.equal(x.sourcePhaseWrites(),before.writes+1);
  x.f.restart();
  const result=await admit();
  assert.equal(result.status,'ALREADY_CONFIRMED');
  assert.equal(result.originalSourceIntentRecorded,true);
  assert.equal(result.originalRecipientAdmissionStillRequired,true);
  assert.equal(result.liveNetworkAuthorityGranted,false);
  assert.equal(result.candidate.changeId,x.session.changeId);
  assert.equal(x.signatureCount(),before.signs);assert.equal(x.counts().networkPuts,before.puts);
  assert.equal(x.sourcePhaseWrites(),before.writes+1);
  const raw=x.sourcePhase({sessionRef:result.candidate.sessionRef,authorizeOriginalSourceSupersession:null});
  assert.equal(raw.checkpointRef,result.checkpointRef);
  await assert.rejects(raw.inspectOriginalSession(),isCode('PHASE_ORIGINAL_REPLACEMENT_POLICY_MISMATCH'));
  const phase=await createPhase({session:result.candidate,admission:result.admission},async()=>true);
  const status=await phase.inspectOriginalSession();
  assert.equal(status.originalReplacementAdmissionEventId,result.originalReplacementAdmissionEventId);
  await assert.rejects(phase.advanceOriginalSessionPhase({phase:'PUBLISHED',evidence:evidence('frame:unadmitted')}),
    isCode('PHASE_ORIGINAL_REPLACEMENT_LIVE_TRANSFER_NOT_ENABLED'));
  await assert.rejects(phase.advanceOriginalSessionPhase({phase:'INTENT',evidence:status.currentEvidence}),
    isCode('PHASE_ORIGINAL_REPLACEMENT_ADMISSION_NOT_PROVEN'));
  x.changeRecipientFrontier();
  await assert.rejects(admit(),isCode('REPLACEMENT_ORIGINAL_CAUSAL_FRONTIER_CHANGED'));
  assert.equal(x.sourcePhaseWrites(),before.writes+1);
});


test('K57 recipient DIFF requires independently committed successor source INTENT; lost CAS and network responses never sign or PUT twice',async()=>{
  const x=await controlFixture({indexed:true});await closeInitialAttempt(x);
  const head=await x.publishReplacement(),candidate=head.candidate;
  const admission={binding:candidate.replacement,sourceEventId:candidate.sourceEventId,captureDigest:candidate.capturedWindowDigest,
    headKey:head.key,headSha256:head.sha256,publicationRef:head.originalPublicationCheckpointRef,
    publicationRevision:head.originalPublicationRevision,publicationChainHash:head.originalPublicationChainHash};
  const createPhase=async({session:c,admission},readOriginalReplacementSourceAdmission)=>x.sourcePhase({
    sessionRef:c.sessionRef,authorizeOriginalSourceSupersession:null,replacementSourceAdmission:admission,
    readOriginalReplacementSourceAdmission});
  const phase=await createPhase({session:candidate,admission},async()=>true);
  const before={signs:x.signatureCount(),puts:x.counts().networkPuts,recipientPhase:x.phaseWrites()};
  await assert.rejects(x.publishReplacementDiff(phase),isCode('PUBLICATION_ORIGINAL_REPLACEMENT_RECIPIENT_ADMISSION_INVALID'));
  assert.equal(x.signatureCount(),before.signs);assert.equal(x.counts().networkPuts,before.puts);
  const admitted=await admitT4OriginalReplacementSourcePhase({...x.eligibilityOptions(),
    createOriginalReplacementPublicationPort:x.createReplacementPort,createOriginalReplacementSourcePhasePort:createPhase});
  x.denyRecipient();
  await assert.rejects(x.publishReplacementDiff(phase),isCode('REPLACEMENT_RECIPIENT_ADMISSION_DENIED'));
  x.allowRecipient();
  const options=x.recipientAdmissionOptions(phase);
  const proof=await readT4OriginalReplacementRecipientAdmission(options);
  assert.equal(proof.sourceIntent.originalReplacementAdmissionEventId,admitted.originalReplacementAdmissionEventId);
  await assert.rejects(readT4OriginalReplacementRecipientAdmission({...options,
    sourceAdmissionPhasePort:{...phase,inspectOriginalSession:async()=>({...proof.sourceIntent,
      originalReplacementSourceAdmission:{...admission,headKey:'other.t4n'}})}}),
    isCode('REPLACEMENT_RECIPIENT_SOURCE_ADMISSION_CHANGED'));
  x.f.kernel.loseNextReply();
  await assert.rejects(x.publishReplacementDiff(phase),isCode('PUBLICATION_ORIGINAL_CAS_OUTCOME_UNKNOWN'));
  assert.equal(x.signatureCount(),before.signs+1);assert.equal(x.counts().networkPuts,before.puts);
  x.loseControlWrite();
  await assert.rejects(x.publishReplacementDiff(phase),isCode('PUBLICATION_NETWORK_OUTCOME_UNKNOWN'));
  x.f.restart();
  assert.equal(x.signatureCount(),before.signs+1);assert.equal(x.counts().networkPuts,before.puts+1);
  const diff=await x.publishReplacementDiff(phase);
  assert.equal(diff.publicationState,'REMOTE_READBACK_RECOVERED');
  assert.equal(diff.originalSourceAdmissionEventId,admitted.originalReplacementAdmissionEventId);
  assert.equal(diff.originalNewAttemptAdmissionStillRequired,true);assert.equal(diff.liveNetworkAuthorityGranted,false);
  assert.equal(diff.sourceCursorAdvanced,false);assert.equal(diff.recipientCursorAdvanced,false);
  const src=await x.transport(sourceNodeRef).discoverUniqueSignedFrame({selector:{sourceNodeRef:recipientNodeRef,ownerEpoch:candidate.ownerEpoch,
    sessionRef:candidate.sessionRef,sequence:1,messageType:'DIFF_REQUEST'},requiredCryptoSuite:options.requiredCryptoSuite});
  assert.equal(src.state,'FOUND');assert.equal(src.receipt.sha256,diff.sha256);
  assert.deepEqual(src.receipt.verifiedBody,{familyRef:candidate.familyRef,fromHeads:[candidate.sourcePrefixDigestBefore]});
  assert.equal(x.signatureCount(),before.signs+1);assert.equal(x.counts().networkPuts,before.puts+1);
  assert.equal(x.phaseWrites(),before.recipientPhase);
  const port=await x.createReplacementRecipientPort({session:candidate},()=>readT4OriginalReplacementRecipientAdmission(options));
  await assert.rejects(port.prepareSignedBatch({slots:[{sequence:2,messageType:'APPLIED_ACK'}],
    createSignedFrames:async()=>assert.fail('subject ACK must not start')}),isCode('PUBLICATION_SLOT_BATCH_INVALID'));
  x.changeRecipientFrontier();
  await assert.rejects(x.publishReplacementDiff(phase),isCode('REPLACEMENT_ORIGINAL_CAUSAL_FRONTIER_CHANGED'));
  assert.equal(x.counts().networkPuts,before.puts+1);
});


test('K58 source accepts successor DIFF only with exact independently verified PRESENT recipient publication; no subject or cursor writes',async()=>{
  const x=await controlFixture({indexed:true});await closeInitialAttempt(x);
  await x.publishReplacement();
  const createPhase=async({session:c,admission},readOriginalReplacementSourceAdmission)=>x.sourcePhase({
    sessionRef:c.sessionRef,authorizeOriginalSourceSupersession:null,replacementSourceAdmission:admission,
    readOriginalReplacementSourceAdmission});
  const admitted=await admitT4OriginalReplacementSourcePhase({...x.eligibilityOptions(),
    createOriginalReplacementPublicationPort:x.createReplacementPort,createOriginalReplacementSourcePhasePort:createPhase});
  const c=admitted.candidate,phase=await createPhase({session:c,admission:admitted.admission},async()=>true);
  const admission=()=>readT4OriginalReplacementRecipientAdmission(x.recipientAdmissionOptions(phase));
  await admission();
  const sourcePublicationPort=await x.createReplacementPort({session:c},()=>x.eligibility());
  const recipientPublicationPort=await x.createReplacementRecipientPort({session:c},admission);
  const options={...x.eligibilityOptions(),sourceAdmissionPhasePort:phase,sourcePublicationPort,recipientPublicationPort,
    frameDiscoveryPort:x.transport(sourceNodeRef),readOriginalReplacementRecipientAdmission:admission,
    authorizeOriginalReplacementDiffAcceptance:async proof=>proof.originalRecipientDiffPublicationVerified===true&&
      proof.originalSubjectMutationAllowed===false};
  const accept=(patch={})=>discoverT4OriginalReplacementRecipientDiff({...options,...patch});
  assert.equal((await accept({readOriginalReplacementRecipientAdmission:async()=>{throw Error('peer witness must not be read before DIFF');}})).state,'WAITING_FOR_REPLACEMENT_DIFF');
  const published=await x.publishReplacementDiff(phase);
  const signs=x.signatureCount(),puts=x.counts().networkPuts,sourcePhase=x.sourcePhaseWrites(),recipientPhase=x.phaseWrites();
  const pending=await accept({recipientPublicationPort:{...recipientPublicationPort,readOriginalPublishedFrame:async()=>{
    throw Object.assign(Error('not committed'),{code:'PUBLICATION_OUTBOUND_FRAME_NOT_PRESENT'});
  }}});
  assert.equal(pending.state,'WAITING_FOR_REPLACEMENT_RECIPIENT_PUBLICATION');
  await assert.rejects(accept({recipientPublicationPort:{...recipientPublicationPort,readOriginalPublishedFrame:async p=>({
    ...await recipientPublicationPort.readOriginalPublishedFrame(p),verifiedMessageId:'message:substituted'})
  }}),isCode('REPLACEMENT_SOURCE_DIFF_ORIGINAL_PUBLICATION_MISMATCH'));
  await assert.rejects(accept({authorizeOriginalReplacementDiffAcceptance:async()=>false}),isCode('REPLACEMENT_SOURCE_DIFF_ACCEPTANCE_DENIED'));
  const before={source:x.sourceStore.calls,recipient:x.f.kernel.calls};
  const accepted=await accept();
  assert.equal(accepted.state,'ORIGINAL_REPLACEMENT_DIFF_VERIFIED');assert.equal(accepted.diffSha256,published.sha256);
  assert.equal(accepted.originalRecipientPublicationCheckpointRef,published.originalPublicationCheckpointRef);
  assert.equal(accepted.originalSourceAdmissionEventId,admitted.originalReplacementAdmissionEventId);
  assert.equal(accepted.originalSourceHeadPresentRevision,admitted.admission.publicationRevision);
  assert.equal(accepted.originalSourceHeadPresentChainHash,admitted.admission.publicationChainHash);
  assert.equal(accepted.originalSourceAdmissionChainHash,admitted.chainHash);
  assert.ok(accepted.originalSourceHeadPresentEventId);assert.ok(accepted.originalRecipientDiffPresentEventId);
  await assert.rejects(accept({sourcePublicationPort:{...sourcePublicationPort,readOriginalPublishedFrame:async p=>({
    ...await sourcePublicationPort.readOriginalPublishedFrame(p),originalPresentChainHash:'sha256:'+'f'.repeat(64)})}}),
    isCode('REPLACEMENT_SOURCE_DIFF_ORIGINAL_PUBLICATION_MISMATCH'));
  const extended=await accept({sourcePublicationPort:{...sourcePublicationPort,readOriginalPublishedFrame:async p=>{
    const proof=await sourcePublicationPort.readOriginalPublishedFrame(p);
    return {...proof,originalPublicationRevision:proof.originalPublicationRevision+3,originalPublicationChainHash:'sha256:'+'f'.repeat(64)};
  }}});
  assert.deepEqual(extended,accepted);
  assert.equal(accepted.originalRecipientDiffPublicationVerified,true);
  assert.equal(accepted.originalContentTransferStillRequired,true);assert.equal(accepted.liveNetworkAuthorityGranted,false);
  assert.equal(accepted.originalSubjectMutationInvoked,false);
  x.f.restart();
  assert.deepEqual(await accept(),accepted);
  assert.deepEqual({source:x.sourceStore.calls,recipient:x.f.kernel.calls},before);
  await assert.rejects(accept({authorizeOriginalReplacementDiffAcceptance:async()=>{x.changeFrontier();return true;}}),
    isCode('REPLACEMENT_ORIGINAL_CAUSAL_FRONTIER_CHANGED'));
  assert.equal(x.signatureCount(),signs);assert.equal(x.counts().networkPuts,puts);
  assert.equal(x.sourcePhaseWrites(),sourcePhase);assert.equal(x.phaseWrites(),recipientPhase);
});

async function replacementContentFixture(fixtureOptions={}){
  const x=await controlFixture({indexed:true,...fixtureOptions});await closeInitialAttempt(x);
  const head=await x.publishReplacement();
  const createPhase=async({session:c,admission},readOriginalReplacementSourceAdmission)=>x.sourcePhase({
    sessionRef:c.sessionRef,authorizeOriginalSourceSupersession:null,replacementSourceAdmission:admission,
    readOriginalReplacementSourceAdmission});
  const admit=()=>admitT4OriginalReplacementSourcePhase({...x.eligibilityOptions(),
    createOriginalReplacementPublicationPort:x.createReplacementPort,createOriginalReplacementSourcePhasePort:createPhase});
  const admitted=await admit(),c=admitted.candidate;
  const phase=await createPhase({session:c,admission:admitted.admission},async()=>true);
  const admission=()=>readT4OriginalReplacementRecipientAdmission(x.recipientAdmissionOptions(phase));
  const sourcePublicationPort=await x.createReplacementPort({session:c},()=>x.eligibility());
  const recipientPublicationPort=await x.createReplacementRecipientPort({session:c},admission);
  let acceptAllowed=true,sealedAllowed=true,seals=0;
  const options={...x.eligibilityOptions(),sourceAdmissionPhasePort:phase,sourcePublicationPort,recipientPublicationPort,
    frameDiscoveryPort:x.transport(sourceNodeRef),readOriginalReplacementRecipientAdmission:admission,
    authorizeOriginalReplacementDiffAcceptance:async p=>acceptAllowed&&p.originalRecipientDiffPublicationVerified===true};
  const current=()=>discoverT4OriginalReplacementRecipientDiff(options);
  // Transport fixture uses opaque bytes, not a simulated successful Vault.
  // The real agreement/encryption ports are qualified separately.
  const ciphertext=new Uint8Array(9000).fill(19);
  const contentPort=(read=current,authorize=async p=>sealedAllowed&&
    p.session.sessionRef===c.sessionRef&&Buffer.from(p.ciphertext).equals(Buffer.from(ciphertext)))=>
    x.createReplacementPort({session:c},()=>x.eligibility(),{
      readOriginalReplacementDiffAcceptance:read,authorizeOriginalSealedPublication:authorize});
  const params={...options,task:x.task,createOriginalReplacementContentPublicationPort:async(_p,read)=>contentPort(read),
    resolveOriginalSigningContext:x.resolveSourceContentSigner,signOriginalNodeBytes:x.signSourceContent,
    authorizeOriginalSealedContent:async()=>sealedAllowed,readOriginalSealedContent:async p=>{
      seals++;assert.equal(p.session.sessionRef,c.sessionRef);assert.equal(p.session.changeId,x.session.changeId);
      assert.equal(p.exactCapturedCanonicalBytesRequired,true);assert.deepEqual(new Uint8Array(p.originalCapture.prepared.bytes),new Uint8Array(x.task.capture.prepared.bytes));
      return {ciphertext,encryptionContextRef:'sealed:k60:successor'};}};
  return {x,c,phase,head,admit,sourcePublicationPort,recipientPublicationPort,current,contentPort,params,
    publish:patch=>publishT4OriginalReplacementSourceContent({...params,...patch}),
    diff:()=>x.publishReplacementDiff(phase),seals:()=>seals,
    denyAcceptance:()=>{acceptAllowed=false;},allowAcceptance:()=>{acceptAllowed=true;},
    denySealed:()=>{sealedAllowed=false;},allowSealed:()=>{sealedAllowed=true;}};
}

test('K60 content requires complete successor agreement and exact captured bytes before invoking the sealer',async()=>{
  const q=await replacementContentFixture(),{x}=q;
  const before={signs:x.signatureCount(),puts:x.counts().networkPuts,writes:x.sourceStore.calls};
  assert.equal((await q.publish()).state,'WAITING_FOR_REPLACEMENT_DIFF');
  const bad=structuredClone(x.task);bad.capture.prepared.bytes[0]^=1;
  await assert.rejects(q.publish({task:bad}),isCode('REPLACEMENT_CONTENT_ORIGINAL_CAPTURE_MISMATCH'));
  assert.equal(q.seals(),0);assert.equal(x.signatureCount(),before.signs);assert.equal(x.counts().networkPuts,before.puts);
  await q.diff();
  q.denyAcceptance();
  await assert.rejects(q.publish(),isCode('REPLACEMENT_SOURCE_DIFF_ACCEPTANCE_DENIED'));
  q.allowAcceptance();q.denySealed();
  await assert.rejects(q.publish(),isCode('CHUNK_ORIGINAL_ACCESS_DENIED'));
  assert.equal(q.seals(),0);assert.equal(x.counts().networkPuts,before.puts+1);
});

test('K60 successor content reuses the original PREPARE after lost CAS and lost transport response; no re-sign or re-seal',async()=>{
  const q=await replacementContentFixture(),{x,c}=q;await q.diff();
  const before={signs:x.signatureCount(),puts:x.counts().networkPuts,sourcePhase:x.sourcePhaseWrites(),recipientPhase:x.phaseWrites()};
  const agreement=await q.current(),head=await q.sourcePublicationPort.readOriginalPublishedFrame({sequence:1,includePresentEventAnchor:true});
  x.sourceStore.loseNextReply();
  await assert.rejects(q.publish(),isCode('PUBLICATION_ORIGINAL_CAS_OUTCOME_UNKNOWN'));
  assert.equal(q.seals(),1);assert.equal(x.signatureCount(),before.signs+3);assert.equal(x.counts().networkPuts,before.puts);
  x.loseControlWrite();
  await assert.rejects(q.publish(),isCode('PUBLICATION_NETWORK_OUTCOME_UNKNOWN'));
  assert.equal(q.seals(),1);assert.equal(x.signatureCount(),before.signs+3);assert.equal(x.counts().networkPuts,before.puts+1);
  x.f.restart();
  q.denyAcceptance();await assert.rejects(q.publish(),isCode('REPLACEMENT_SOURCE_DIFF_ACCEPTANCE_DENIED'));
  q.allowAcceptance();
  const sent=await q.publish();
  assert.equal(sent.state,'ORIGINAL_REPLACEMENT_CONTENT_PRESENT');assert.equal(sent.originalSignedBatchReused,true);
  assert.equal(sent.publications[0].state,'REMOTE_READBACK_RECOVERED');assert.equal(sent.publications.length,3);
  assert.equal(sent.originalBusinessApplied,false);assert.equal(sent.sourceCursorAdvanced,false);assert.equal(sent.recipientCursorAdvanced,false);
  assert.equal(q.seals(),1);assert.equal(x.signatureCount(),before.signs+3);assert.equal(x.counts().networkPuts,before.puts+3);
  const again=await q.publish();assert.equal(again.originalSignedBatchReused,true);
  assert.equal(q.seals(),1);assert.equal(x.signatureCount(),before.signs+3);assert.equal(x.counts().networkPuts,before.puts+3);
  assert.deepEqual(await q.current(),agreement);
  const recoveredHead=await x.publishReplacement();
  assert.equal(recoveredHead.originalPublicationRevision,q.head.originalPublicationRevision);
  assert.equal(recoveredHead.originalPublicationChainHash,q.head.originalPublicationChainHash);
  assert.equal(recoveredHead.sha256,q.head.sha256);
  assert.equal((await q.admit()).status,'ALREADY_CONFIRMED');
  const later=await q.sourcePublicationPort.readOriginalPublishedFrame({sequence:1,includePresentEventAnchor:true});
  assert.equal(later.originalPresentEventId,head.originalPresentEventId);assert.ok(later.originalPublicationRevision>head.originalPublicationRevision);
  const saved=await q.sourcePublicationPort.inspectOriginalPublication();
  assert.deepEqual(saved.frames.map(f=>f.messageType),['HEADS','CHANGE_REF','CHUNK','CHUNK']);
  for(const f of saved.frames.slice(1)){
    const decoded=decodeT4CandidateFrame(f.wireBytes);
    assert.equal(decoded.sessionRef,c.sessionRef);assert.equal(decoded.body.changeId,x.session.changeId);
  }
  assert.equal(x.sourcePhaseWrites(),before.sourcePhase);assert.equal(x.phaseWrites(),before.recipientPhase);
});

test('K60 admission is revalidated at the original content CAS and frame boundary; forged HEADS anchor cannot reserve bytes',async()=>{
  const q=await replacementContentFixture();await q.diff();const {x}=q;
  const before={signs:x.signatureCount(),puts:x.counts().networkPuts};
  const forged=await q.contentPort(async()=>({...await q.current(),originalSourceHeadPresentEventId:'event:k60:forged'}));
  await assert.rejects(forged.prepareSignedBatch({slots:[{sequence:2,messageType:'CHANGE_REF'},{sequence:3,messageType:'CHUNK'}],
    createSignedFrames:async()=>assert.fail('forged anchor allowed signing')}),isCode('PUBLICATION_ORIGINAL_REPLACEMENT_DIFF_HEAD_MISMATCH'));
  assert.equal(x.signatureCount(),before.signs);assert.equal(x.counts().networkPuts,before.puts);
  await assert.rejects(q.publish({createOriginalReplacementContentPublicationPort:async(_p,read)=>q.contentPort(read,async()=>false)}),
    isCode('PUBLICATION_ORIGINAL_SEALED_AUTHORITY_DENIED'));
  assert.equal(x.counts().networkPuts,before.puts);
  assert.equal((await q.sourcePublicationPort.inspectOriginalPublication()).frames.length,1);
  const result=await q.publish();assert.equal(result.state,'ORIGINAL_REPLACEMENT_CONTENT_PRESENT');
  assert.equal(x.counts().networkPuts,before.puts+3);
  const readOnly=q.sourcePublicationPort;
  await assert.rejects(readOnly.publishPreparedFrame({sequence:2}),isCode('PUBLICATION_ORIGINAL_REPLACEMENT_DIFF_ACCEPTANCE_REQUIRED'));
  x.changeRecipientFrontier();
  await assert.rejects(q.publish(),isCode('REPLACEMENT_ORIGINAL_CAUSAL_FRONTIER_CHANGED'));
  assert.equal(x.counts().networkPuts,before.puts+3);
});


// This fixture uses real signed wire frames and original publication/replay
// chains. Opaque content and the two original Kernel ports are test fixtures.
async function replacementRecipientFixture(fixtureOptions={}){
  const q=await replacementContentFixture(fixtureOptions),{x,c}=q;
  const source=await q.contentPort();let allowed=true;
  const options={session:c,frameDiscoveryPort:x.transport(recipientNodeRef),
    requiredCryptoSuite:x.eligibilityOptions().requiredCryptoSuite,requireSourceAnnouncement:true,
    sourceCursorBefore:x.sourceCursorBefore,authorizeOriginalRecipientSession:async p=>allowed&&
      p.originalReplacementContentReadRequired===true&&p.originalSubjectMutationAllowed===false,
    readOriginalReplacementDiffAcceptance:q.current,originalReplacementSourcePublicationPort:source,
    originalReplacementRecipientPublicationPort:q.recipientPublicationPort};
  return {...q,source,options,discover:(patch={})=>discoverT4OriginalNetworkSessionContent({...options,...patch}),
    deny:()=>{allowed=false;},allow:()=>{allowed=true;}};
}

test('K61 recipient independently discovers exact successor content and original source PRESENT events, without subject or phase writes',async()=>{
  const q=await replacementRecipientFixture(),{x,c}=q;
  await assert.rejects(q.discover(),isCode('PUBLICATION_ORIGINAL_REPLACEMENT_DIFF_ACCEPTANCE_REQUIRED'));
  await q.diff();
  assert.equal((await q.discover()).state,'WAITING_FOR_CHANGE');
  const writes={s:x.sourcePhaseWrites(),r:x.phaseWrites()};
  // Interrupt the existing task between the change and the first chunk.
  await assert.rejects(q.publish({createOriginalReplacementContentPublicationPort:async(_p,read)=>{
    const port=await q.contentPort(read);return {...port,publishPreparedFrame:async p=>{
      if(p.sequence===3)throw Object.assign(Error('test interruption'),{code:'TEST_INTERRUPTED'});
      return port.publishPreparedFrame(p);}};
  }}),isCode('TEST_INTERRUPTED'));
  const partial=await q.discover();assert.equal(partial.state,'WAITING_FOR_CHUNKS');
  assert.equal(partial.originalReplacementContentEvidence,undefined);
  assert.equal((await q.publish()).state,'ORIGINAL_REPLACEMENT_CONTENT_PRESENT');
  const before={signs:x.signatureCount(),puts:x.counts().networkPuts};
  const found=await q.discover(),e=found.originalReplacementContentEvidence;
  assert.equal(found.state,'CONTENT_VERIFIED');assert.equal(found.session.sessionRef,c.sessionRef);
  assert.equal(found.originalDecryptionInvoked,false);assert.equal(found.originalBusinessApplied,false);
  assert.equal(found.verifiedDiffRequest.originalOutboundSignatureVerified,true);
  assert.equal(found.verifiedDiffRequest.remoteReceiptProven,false);
  assert.equal(e.originalSubjectMutationInvoked,false);assert.equal(e.contentDigest,found.verifiedChangeRef.verifiedBody.contentDigest);
  assert.equal(e.encryptionContextRef,found.encryptionContextRef);assert.deepEqual(e.agreement,await q.current());
  assert.deepEqual(e.frames.map(f=>f.messageType),['HEADS','CHANGE_REF','CHUNK','CHUNK']);
  const p=await q.source.readOriginalReplacementPublishedContent();
  assert.equal(p.frames.length,4);assert.ok(p.frames.every(f=>f.originalPublicationRevision===p.originalPublicationRevision));
  assert.deepEqual(e.frames.map(f=>f.presentEventId),p.frames.map(f=>f.originalPresentEventId));
  x.f.restart();assert.deepEqual((await q.discover()).originalReplacementContentEvidence,e);
  assert.equal(x.signatureCount(),before.signs);assert.equal(x.counts().networkPuts,before.puts);
  assert.deepEqual({s:x.sourcePhaseWrites(),r:x.phaseWrites()},writes);
});

test('K61 transport receipt alone, wrong original publication or revoked acceptance cannot authorize successor open',async()=>{
  const q=await replacementRecipientFixture(),{x}=q;await q.diff();await q.publish();
  const source=q.source,diff=q.recipientPublicationPort;
  const p=await source.readOriginalReplacementPublishedContent();
  const missing=await q.discover({originalReplacementSourcePublicationPort:{...source,
    readOriginalReplacementPublishedContent:async()=>{throw Object.assign(Error('not present'),{code:'PUBLICATION_OUTBOUND_FRAME_NOT_PRESENT'});}}});
  assert.equal(missing.state,'WAITING_FOR_ORIGINAL_PUBLICATION');assert.equal(missing.originalReplacementContentEvidence,undefined);
  const bad=structuredClone(p);bad.frames[2].verifiedBody.contentDigest=H;
  await assert.rejects(q.discover({originalReplacementSourcePublicationPort:{...source,
    readOriginalReplacementPublishedContent:async()=>bad}}),isCode('CHUNK_ASSEMBLY_BODY_INVALID'));
  await assert.rejects(q.discover({originalReplacementRecipientPublicationPort:{...diff,
    readOriginalPublishedFrame:async opts=>({...await diff.readOriginalPublishedFrame(opts),originalPresentEventId:'event:fake:diff'})}}),
    isCode('SUBJECT_ORIGINAL_REPLACEMENT_PUBLICATION_MISMATCH'));
  const wrong=structuredClone(p);wrong.frames[0].originalPresentEventId='event:fake:head';
  await assert.rejects(q.discover({originalReplacementSourcePublicationPort:{...source,
    readOriginalReplacementPublishedContent:async()=>wrong}}),isCode('PUBLICATION_ORIGINAL_REPLACEMENT_BATCH_ANCHOR_MISMATCH'));
  await assert.rejects(q.discover({originalReplacementSourcePublicationPort:q.sourcePublicationPort}),
    isCode('SUBJECT_ORIGINAL_REPLACEMENT_CONTENT_PORTS_REQUIRED'));
  q.deny();await assert.rejects(q.discover(),isCode('SUBJECT_ORIGINAL_SESSION_DISCOVERY_DENIED'));q.allow();
  q.denyAcceptance();await assert.rejects(q.discover(),isCode('REPLACEMENT_SOURCE_DIFF_ACCEPTANCE_DENIED'));q.allowAcceptance();
  x.stop();await assert.rejects(q.discover());
});


test('K63 successor source PUBLISHED binds complete original publication and preserves the immutable INTENT across restart',async()=>{
  const q=await replacementRecipientFixture(),{x,c}=q;await q.diff();
  const source=q.source,agreement=await q.current();
  const phaseFor=(read=()=>source.readOriginalReplacementPublishedContent())=>x.sourcePhase({
    sessionRef:c.sessionRef,authorizeOriginalSourceSupersession:null,
    replacementSourceAdmission:q.phase.originalReplacementSourceAdmission,readOriginalReplacementSourceAdmission:async()=>true,
    readOriginalReplacementSourceContentPublication:read});
  const phase=phaseFor(),confirm=()=>confirmT4OriginalReplacementSourcePublication({sourceAdmissionPhasePort:phaseFor(),sourcePublicationPort:source,getMode:x.eligibilityOptions().getMode});
  const initial=await phase.inspectOriginalSession();
  await assert.rejects(confirm(),isCode('PUBLICATION_OUTBOUND_FRAME_NOT_PRESENT'));
  await q.publish();
  const batch=await source.readOriginalReplacementPublishedContent(),change=batch.frames[1];
  const ev={evidenceRef:change.key,evidenceDigest:'sha256:'+change.sha256};
  const forged=structuredClone(batch);forged.agreement.originalSourceAdmissionEventId='event:k63:forged';
  await assert.rejects(phaseFor(async()=>forged).advanceOriginalSessionPhase({phase:'PUBLISHED',evidence:ev}),isCode('PHASE_ORIGINAL_REPLACEMENT_CONTENT_PUBLICATION_NOT_PROVEN'));
  await assert.rejects(phase.advanceOriginalSessionPhase({phase:'PUBLISHED',evidence:{...ev,evidenceRef:'wrong.t4n'}}),isCode('PHASE_ORIGINAL_REPLACEMENT_CONTENT_PUBLICATION_NOT_PROVEN'));
  assert.equal((await phase.inspectOriginalSession()).revision,1);
  const before={s:x.sourcePhaseWrites(),r:x.phaseWrites(),signs:x.signatureCount(),puts:x.counts().networkPuts};
  x.sourceStore.loseNextReply();
  await assert.rejects(confirm(),isCode('PHASE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  x.f.restart();const done=await confirm();
  assert.equal(done.status,'ALREADY_CONFIRMED');assert.equal(done.revision,2);
  assert.equal(done.originalSourceAdmissionEventId,initial.originalReplacementAdmissionEventId);
  assert.equal(done.originalSourceAdmissionChainHash,initial.chainHash);
  const status=await phaseFor().inspectOriginalSession();
  assert.equal(status.currentPhase,'PUBLISHED');assert.equal(status.originalReplacementPublishedEventId,done.originalSourcePublishedEventId);
  assert.equal(status.originalReplacementAdmissionEventId,initial.originalReplacementAdmissionEventId);
  assert.equal(status.originalReplacementAdmissionChainHash,initial.chainHash);
  assert.deepEqual(await q.current(),agreement);
  const admitted=await q.admit();assert.equal(admitted.status,'ALREADY_CONFIRMED');assert.equal(admitted.revision,1);
  assert.equal(admitted.chainHash,initial.chainHash);assert.equal(admitted.originalReplacementAdmissionEventId,initial.originalReplacementAdmissionEventId);
  const sent=await q.publish();assert.equal(sent.originalSignedBatchReused,true);
  assert.equal((await q.discover()).state,'CONTENT_VERIFIED');
  assert.equal(x.sourcePhaseWrites(),before.s+1);assert.equal(x.phaseWrites(),before.r);
  assert.equal(x.signatureCount(),before.signs);assert.equal(x.counts().networkPuts,before.puts);
  x.changeRecipientFrontier();await assert.rejects(confirm(),isCode('REPLACEMENT_ORIGINAL_CAUSAL_FRONTIER_CHANGED'));
});


for(const order of ['RECIPIENT_FIRST_LOST_RESPONSES','SOURCE_FIRST_NORMAL'])
test('K67 K68 K69 K70 source confirms successor ACK and both original frontiers recover from fresh read-only ports: '+order,async()=>{
  const q=await replacementRecipientFixture({realSourceHistory:true}),{x,c}=q;await q.diff();await q.publish();
  const getMode=x.eligibilityOptions().getMode,source=q.source;
  let allowed=true,recipientResult=true;
  // The two original phase/publication/replay histories are actual adapter
  // CAS records; the independent business Result readers are test ports.
  const sourcePhase=()=>x.sourcePhase({sessionRef:c.sessionRef,authorizeOriginalSourceSupersession:null,
    replacementSourceAdmission:q.phase.originalReplacementSourceAdmission,readOriginalReplacementSourceAdmission:async()=>true,
    readOriginalReplacementSourceContentPublication:()=>source.readOriginalReplacementPublishedContent(),
    readOriginalReplacementSourceAckEvidence:()=>readT4OriginalReplacementSourceAckEvidence(args())});
  const published=await confirmT4OriginalReplacementSourcePublication({sourceAdmissionPhasePort:sourcePhase(),sourcePublicationPort:source,getMode});
  const found=await q.discover(),e=found.originalReplacementContentEvidence;
  const applyAdmission={schema:'IWXA_T4_ORIGINAL_REPLACEMENT_RECIPIENT_APPLY_ADMISSION_V1',candidate:c,contentEvidence:e,
    originalSourcePublishedEventId:published.originalSourcePublishedEventId,originalSourcePublishedChainHash:published.chainHash,
    originalStateDigest:B,originalCapturedSha256:c.capturedSha256,originalSourcePublishedVerified:true,originalCanonicalSubjectVerified:true,
    originalSubjectMutationInvoked:false,originalBusinessApplied:false,sourceCursorAdvanced:false,recipientCursorAdvanced:false,liveNetworkAuthorityGranted:false};
  const actualEvent='event:k67:actual-result';
  const body={changeId:c.changeId,contentDigest:e.contentDigest,recipientEventRef:actualEvent,recipientRevision:c.sourceRevision,
    recipientStateDigest:B,ackRef:'ack:t4:'+createHash('sha256').update(JSON.stringify(['IWXA-T4-ORIGINAL-APPLIED-ACK-V1',c.sessionRef,c.changeId,
      c.capturedSha256,actualEvent,c.sourceRevision,B])).digest('hex')};
  const recipientPhase=()=>x.f.port({sessionRef:c.sessionRef,changeId:c.changeId,recipientApplyIntentRequired:true,
    authorizeOriginalRecipientSupersession:null,verifyOriginalPhaseEvidence:async()=>true,
    verifyOriginalRecipientApplied:async p=>recipientResult&&p.originalRecipientEventId===actualEvent&&p.originalRecipientStateDigest===B,
    replacementRecipientAdmission:applyAdmission,readOriginalReplacementRecipientApplyAdmission:async()=>applyAdmission,
    readOriginalReplacementRecipientAckPublication:readPeerAck});
  const phase=recipientPhase();
  const readAckAdmission=async()=>{
    const s=await recipientPhase().inspectOriginalSession();
    if(!recipientResult||!['APPLY_INTENT','APPLIED'].includes(s.currentPhase))throw Object.assign(Error('no result'),{code:'TEST_RECIPIENT_RESULT_MISSING'});
    return {schema:'IWXA_T4_ORIGINAL_REPLACEMENT_APPLIED_ACK_ADMISSION_V1',admission:applyAdmission,body,
      recipientPhaseCheckpointRef:s.checkpointRef,originalApplyIntentEventId:s.originalReplacementRecipientApplyIntentEventId,
      originalRecipientResultVerified:true,originalDurableApplyIntentVerified:true,originalBusinessApplied:true,
      originalSubjectMutationInvoked:false,sourceCursorAdvanced:false,recipientCursorAdvanced:false,liveNetworkAuthorityGranted:false};
  };
  const recipient=await x.createReplacementRecipientPort({session:c},()=>readT4OriginalReplacementRecipientAdmission(x.recipientAdmissionOptions(sourcePhase())),
    {readOriginalReplacementAppliedAckAdmission:readAckAdmission});
  async function readPeerAck(){return {admission:await readAckAdmission(),publication:await recipient.readOriginalPublishedFrame({sequence:2,includePresentEventAnchor:true})};}
  const args=(patch={})=>({sourceAdmissionPhasePort:sourcePhase(),sourcePublicationPort:source,recipientPhasePort:recipientPhase(),
    recipientPublicationPort:recipient,readOriginalReplacementRecipientAckPublication:readPeerAck,frameDiscoveryPort:x.transport(sourceNodeRef),
    requiredCryptoSuite:x.eligibilityOptions().requiredCryptoSuite,getMode,authorizeOriginalReplacementSourceAckConfirmation:async p=>allowed&&p.originalRecipientResultVerified===true,...patch});
  const finish=()=>confirmT4OriginalReplacementSourceAcknowledgement(args());
  assert.equal((await finish()).state,'WAITING_FOR_RECIPIENT_APPLIED_ACK');
  await phase.advanceOriginalSessionPhase({phase:'RECEIVED',evidence:{evidenceRef:e.frames[2].key,evidenceDigest:'sha256:'+e.frames[2].sha256}});
  await phase.advanceOriginalSessionPhase({phase:'VERIFIED',evidence:{evidenceRef:e.frames[1].key,evidenceDigest:B}});
  await phase.advanceOriginalSessionPhase({phase:'APPLY_INTENT',evidence:{evidenceRef:e.frames[1].key,evidenceDigest:'sha256:'+c.capturedSha256}});
  await recipient.prepareSignedBatch({slots:[{sequence:2,messageType:'APPLIED_ACK'}],createSignedFrames:async()=>[await signT4CandidateFrame({
    unsignedFrame:createT4CandidateUnsignedFrame({messageType:'APPLIED_ACK',messageId:'message:k67:ack',sourceNodeRef:c.recipientNodeRef,
      recipientNodeRef:c.sourceNodeRef,scopeRef:c.scopeRef,sessionRef:c.sessionRef,ownerEpoch:c.ownerEpoch,sequence:2,
      ...x.recipientSigner(),cryptoSuite:x.eligibilityOptions().requiredCryptoSuite,criticalExtensions:[],body}),signOriginalNodeBytes:x.signRecipientAck})]});
  await recipient.publishPreparedFrame({sequence:2});
  assert.equal((await finish()).state,'WAITING_FOR_RECIPIENT_APPLIED_ACK');
  const ack=await recipient.readOriginalPublishedFrame({sequence:2,includePresentEventAnchor:true});
  await phase.advanceOriginalSessionPhase({phase:'APPLIED',evidence:{evidenceRef:ack.key,evidenceDigest:'sha256:'+ack.sha256,
    originalRecipientEventId:actualEvent,originalRecipientRevision:c.sourceRevision,originalRecipientStateDigest:B}});
  const before={writes:x.sourcePhaseWrites(),signs:x.signatureCount(),puts:x.counts().networkPuts};
  allowed=false;await assert.rejects(finish(),isCode('REPLACEMENT_SOURCE_ACK_CONFIRMATION_DENIED'));allowed=true;
  await assert.rejects(confirmT4OriginalReplacementSourceAcknowledgement(args({readOriginalReplacementRecipientAckPublication:async()=>{
    const a=await readPeerAck();return {...a,publication:{...a.publication,originalPresentEventId:'event:forged'}};}})),isCode('REPLACEMENT_SOURCE_ACK_ORIGINAL_PUBLICATION_MISMATCH'));
  await assert.rejects(finish(),isCode('PHASE_ORIGINAL_APPLIED_NOT_PROVEN'));
  assert.equal(x.sourcePhaseWrites(),before.writes);x.allowSourceApplied();
  x.sourceStore.loseNextReply();await assert.rejects(finish(),isCode('PHASE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  x.f.restart();const final=await finish();assert.equal(final.status,'ALREADY_CONFIRMED');
  assert.equal(final.sourcePhase.currentPhase,'APPLIED_CONFIRMED');assert.equal(final.sourcePhase.currentEvidence.originalRecipientEventId,actualEvent);
  assert.equal(final.sourcePhase.originalReplacementPublishedChainHash,published.chainHash);
  assert.equal(final.sourcePhase.originalReplacementPublishedEventId,published.originalSourcePublishedEventId);
  assert.equal(final.sourceCursorAdvanced,false);assert.equal(final.recipientCursorAdvanced,false);assert.equal(final.originalHostCursorCommitStillRequired,true);
  assert.equal(x.sourcePhaseWrites(),before.writes+1);assert.equal(x.signatureCount(),before.signs);assert.equal(x.counts().networkPuts,before.puts);
  assert.deepEqual(await q.current(),e.agreement);
  const diff=await q.diff();assert.equal(diff.originalPublicationRevision,e.agreement.originalRecipientPublicationRevision);
  assert.equal(diff.originalPublicationChainHash,e.agreement.originalRecipientPublicationChainHash);
  const recovered=await confirmT4OriginalReplacementSourcePublication({sourceAdmissionPhasePort:sourcePhase(),sourcePublicationPort:source,getMode});
  assert.equal(recovered.chainHash,published.chainHash);assert.equal(recovered.originalRecipientApplyStillRequired,false);
  recipientResult=false;await assert.rejects(finish(),isCode('PHASE_ORIGINAL_APPLIED_NOT_PROVEN'));recipientResult=true;
  // Once either frontier changes, live replacement eligibility must close.
  // Historical terminal evidence uses the old exact Event prefix and the
  // original terminal chains, not a fabricated live receipt.
  let historyAllowed=true;
  const historyArgs={session:c,sourceCursorBefore:x.sourceCursorBefore,sourcePhasePort:sourcePhase(),recipientPhasePort:recipientPhase(),
    retiredSourcePhasePort:x.sourcePhase(),retiredRecipientPhasePort:x.phase(),sourcePublicationPort:source,recipientPublicationPort:recipient,
    historicalFramePort:x.transport(sourceNodeRef),requiredCryptoSuite:x.eligibilityOptions().requiredCryptoSuite,getMode,
    authorizeOriginalHistoricalCursorRecovery:async p=>historyAllowed&&p.originalFrameRetryAllowed===false&&p.originalRecipientApplicationIndependentlyVerified===true,
    authorizeOriginalRead:async()=>true,readOriginalEvents:x.readOriginalEvents};
  const recover=patch=>recoverT4OriginalReplacementTerminalCursorEvidence({...historyArgs,...patch});
  const historical=await recover();assert.deepEqual(historical.originalT3NextCursor,x.sourceCursorAfter);
  assert.equal(historical.originalHistoricalAcceptanceProven,true);assert.equal(historical.originalT3HostCursorWriteInvoked,false);
  assert.equal(historical.originalSourcePhase.originalReplacementSourceConfirmedEventId,final.sourcePhase.originalReplacementSourceConfirmedEventId);
  assert.equal(historical.historicalAck.body.recipientEventRef,actualEvent);
  assert.equal(historical.originalBothRecipientResultReadbacksVerified,true);
  x.changeFrontier();x.changeRecipientFrontier();
  await assert.rejects(x.eligibility(),isCode('REPLACEMENT_ORIGINAL_CAUSAL_FRONTIER_CHANGED'));
  x.rotateSource();x.rotateRecipient();x.offline();x.f.restart();
  const counts={source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()};
  assert.deepEqual(await recover(),historical);
  // K70: reconstruct fresh original owner ports solely from canonical
  // session identities and the two original read-only Kernel interfaces.
  // No live admission, signing, transport or technical write callback.
  const peerResult=async p=>recipientResult&&p.originalRecipientEventId===actualEvent&&p.originalRecipientStateDigest===B;
  const originalReadOptions={SOURCE:x.historicalReadOptions(sourceNodeRef),RECIPIENT:x.historicalReadOptions(recipientNodeRef)};
  function coldPhase(session,role){
    const base={...originalReadOptions[role],verifyOriginalRecipientApplied:role==='SOURCE'?x.verifySourceApplied:peerResult};
    return session.schema==='IWXA_T4_ORIGINAL_REPLACEMENT_SESSION_CANDIDATE_V1'?
      createT4OriginalReplacementHistoricalPhasePort({...base,session}):createT4OriginalNetworkSessionPhasePort({...base,
        originalWriteOwnerRef:session.originalWriteOwnerRef,sourceNodeRef:session.sourceNodeRef,recipientNodeRef:session.recipientNodeRef,
        scopeRef:session.scopeRef,sessionRef:session.sessionRef,changeId:session.changeId,ownerEpoch:session.ownerEpoch,
        changeKind:session.changeKind,recipientApplyIntentRequired:role==='RECIPIENT',historicalReadOnly:true});
  }
  const coldPublication=role=>createT4OriginalNetworkPublicationPort({...originalReadOptions[role],session:c,historicalReadOnly:true,
    verifyOriginalHistoricalNodeSignature:x.historicalSignature(originalReadOptions[role].localNodeRef)});
  const sourceRead=originalReadOptions.SOURCE;
  const coldReplay=createT4OriginalNetworkReplayPort({...sourceRead,originalWriteOwnerRef:c.originalWriteOwnerRef,
    scopeRef:c.scopeRef,historicalReadOnly:true});
  const coldFrame=createT4CandidateFrameTransport({getMode,readOriginalHostContext:sourceRead.readOriginalHostContext,
    originalHostNodeRef:sourceNodeRef,originalHostScopeRef:c.scopeRef,authorizeOriginalHostWire:async()=>true,
    historicalReadOnly:true,verifyOriginalHistoricalNodeSignature:x.historicalSignature(sourceNodeRef),
    readOriginalHistoricalReplayEvidence:coldReplay.readOriginalHistoricalReplayEvidence,
    readOriginalHistoricalAppliedAckSlot:coldReplay.readOriginalHistoricalAppliedAckSlot});
  assert.equal(coldReplay.persistOriginalReplayDecision,undefined);assert.equal(coldFrame.publishSignedFrame,undefined);
  assert.equal(coldFrame.readOriginalHistoricalReceivedFrame,undefined);assert.equal(coldFrame.readAndVerifySignedFrame,undefined);
  const cold={sourcePhasePort:coldPhase(c,'SOURCE'),recipientPhasePort:coldPhase(c,'RECIPIENT'),
    retiredSourcePhasePort:coldPhase(x.session,'SOURCE'),retiredRecipientPhasePort:coldPhase(x.session,'RECIPIENT'),
    sourcePublicationPort:coldPublication('SOURCE'),recipientPublicationPort:coldPublication('RECIPIENT'),historicalFramePort:coldFrame};
  for(const port of [cold.sourcePhasePort,cold.recipientPhasePort,cold.retiredSourcePhasePort,cold.retiredRecipientPhasePort]){
    assert.equal(port.originalHistoricalReadOnly,true);assert.equal(port.advanceOriginalSessionPhase,undefined);
  }
  for(const port of [cold.sourcePublicationPort,cold.recipientPublicationPort]){
    assert.equal(port.originalHistoricalReadOnly,true);assert.equal(port.prepareSignedBatch,undefined);
    assert.equal(port.publishPreparedFrame,undefined);assert.equal(port.readOriginalPublishedFrame,undefined);
  }
  assert.deepEqual(await recover(cold),historical);
  const sourceObject=x.sourceStore.objects.get(originalReadOptions.SOURCE.technicalWorkspaceId+':'+cold.sourcePhasePort.checkpointRef);
  const storedBinding=sourceObject.object.data.replacementSourceAdmission.binding;
  sourceObject.object.data.replacementSourceAdmission.binding={...storedBinding,decisionDigest:H};
  await assert.rejects(cold.sourcePhasePort.inspectOriginalSession(),isCode('PHASE_ORIGINAL_REPLACEMENT_HISTORY_IDENTITY_MISMATCH'));
  sourceObject.object.data.replacementSourceAdmission.binding=storedBinding;
  const recipientObject=x.f.kernel.objects.get(workspace+':'+cold.recipientPhasePort.checkpointRef);
  const admission=recipientObject.object.data.replacementRecipientAdmission;
  delete recipientObject.object.data.replacementRecipientAdmission;
  await assert.rejects(cold.recipientPhasePort.inspectOriginalSession(),isCode('PHASE_ORIGINAL_REPLACEMENT_HISTORY_IDENTITY_MISMATCH'));
  recipientObject.object.data.replacementRecipientAdmission=admission;
  let active=true;const scoped=cold.sourcePhasePort.forOriginalHostLifetime(()=>active),scopedPublication=cold.sourcePublicationPort.forOriginalHostLifetime(()=>active);
  assert.deepEqual(await scoped.inspectOriginalSession(),historical.originalSourcePhase);
  active=false;await assert.rejects(scoped.inspectOriginalSession(),isCode('ORIGINAL_HOST_LIFETIME_ENDED'));
  await assert.rejects(scopedPublication.readOriginalHistoricalPublishedBatch(),isCode('ORIGINAL_HOST_LIFETIME_ENDED'));
  assert.throws(()=>createT4OriginalNetworkPublicationPort({...originalReadOptions.SOURCE,session:c,historicalReadOnly:true,
    verifyOriginalHistoricalNodeSignature:x.historicalSignature(sourceNodeRef),authorizeOriginalTechnicalWrite:async()=>true}),
    isCode('PUBLICATION_ORIGINAL_HOST_PORTS_REQUIRED'));
  Object.assign(historyArgs,cold);
  // K72: separate owner histories are obtained through bounded original
  // read-only requests. Simulate the native relay's single command slot.
  let ownerReadAllowed=true,peerUnavailable=false,ownerReads=0;
  function serialKernel(k){
    let busy=false;const run=async(fn,args)=>{assert.equal(busy,false,'one original relay command');busy=true;
      try{return await fn(...args);}finally{busy=false;}};
    return {...k,getObject:(...args)=>run(k.getObject,args),listEventsSince:(...args)=>run(k.listEventsSince,args)};
  }
  const ownerHistory=async request=>{
    ownerReads++;
    if(peerUnavailable&&request.ownerNodeRef===recipientNodeRef)return null;
    const role=request.ownerNodeRef===sourceNodeRef?'SOURCE':'RECIPIENT',base=originalReadOptions[role];
    return readT4OriginalReplacementOwnerHistory({...base,originalKernel:serialKernel(base.originalKernel),request,
      requiredCryptoSuite:historyArgs.requiredCryptoSuite,authorizeOriginalOwnerHistoryRead:async p=>ownerReadAllowed&&
        p.originalOwnerReadOnly===true&&p.originalSubjectMutationAllowed===false&&p.request.ownerNodeRef===base.localNodeRef,
      verifyOriginalRecipientApplied:role==='SOURCE'?x.verifySourceApplied:peerResult,
      verifyOriginalHistoricalNodeSignature:x.historicalSignature(base.localNodeRef),authorizeOriginalHostWire:async()=>true});
  };
  // K75: the installed owner call preserves the actual original signed
  // wire bytes across a bounded byte carrier in both directions.
  let carrierCalls=0;
  const peerContext=node=>({nodeRef:node,originalPeerSessionRef:'peer:k75:authenticated',contextEpoch:1,
    scopeRef:c.scopeRef,ownerEpoch:c.ownerEpoch,originalPeerAuthenticated:true,originalConfidentialChannelVerified:true});
  const carrier=node=>{
    const peer=node===sourceNodeRef?recipientNodeRef:sourceNodeRef;
    const common={scopeRef:c.scopeRef,ownerEpoch:c.ownerEpoch,workspaceId:c.workspaceId,originalWriteOwnerRef:c.originalWriteOwnerRef,getMode};
    const server=createT4OriginalReplacementHistoryServer({...common,localNodeRef:peer,peerNodeRef:node,
      readOriginalPeerContext:async()=>peerContext(node),readOriginalReplacementOwnerHistory:async({request,peerContext:caller})=>{
        assert.deepEqual(caller,{nodeRef:node,originalPeerSessionRef:'peer:k75:authenticated',contextEpoch:1});
        return ownerHistory(request);
      }});
    return createT4OriginalReplacementHistoryClient({...common,localNodeRef:node,peerNodeRef:peer,
      readOriginalPeerContext:async()=>peerContext(peer),invokeOriginalPeerHistory:async({requestBytes,originalPeerContext})=>{
        carrierCalls++;assert.ok(requestBytes instanceof Uint8Array);assert.deepEqual(originalPeerContext,peerContext(peer));
        return server(requestBytes);
      }});
  };
  const ownerRecovery=node=>({session:c,sourceCursorBefore:x.sourceCursorBefore,requiredCryptoSuite:historyArgs.requiredCryptoSuite,getMode,
    requesterNodeRef:node,readOriginalOwnerHistory:ownerHistory,verifyOriginalHistoricalNodeSignature:x.historicalSignature(node),
    authorizeOriginalHistoricalCursorRecovery:historyArgs.authorizeOriginalHistoricalCursorRecovery,
    authorizeOriginalRead:historyArgs.authorizeOriginalRead,readOriginalEvents:x.readOriginalEvents});
  if(order==='SOURCE_FIRST_NORMAL'){
    const args=ownerRecovery(sourceNodeRef),recoverOwner=patch=>recoverT4OriginalReplacementTerminalCursorEvidence({...args,...patch});
    assert.deepEqual(await recoverOwner(),historical);assert.equal(ownerReads,4);
    const request=createT4OriginalReplacementOwnerHistoryRequest({session:c,requesterNodeRef:recipientNodeRef,ownerNodeRef:sourceNodeRef});
    const original=await ownerHistory(request),bytes=encodeT4OriginalReplacementHistoryResponse(original,request);
    assert.deepEqual(decodeT4OriginalReplacementHistoryRequest(encodeT4OriginalReplacementHistoryRequest(request)),request);
    assert.deepEqual(decodeT4OriginalReplacementHistoryResponse(bytes,request),original);
    assert.deepEqual(await carrier(recipientNodeRef)(request),original);
    assert.equal(decodeT4OriginalReplacementHistoryResponse(encodeT4OriginalReplacementHistoryResponse(null,request),request),null);
    const wrong=createT4OriginalReplacementOwnerHistoryRequest({session:c,requesterNodeRef:sourceNodeRef,ownerNodeRef:recipientNodeRef});
    assert.throws(()=>decodeT4OriginalReplacementHistoryResponse(bytes,wrong),isCode('REPLACEMENT_HISTORY_CARRIER_RESPONSE_MISMATCH'));
    const parsed=JSON.parse(Buffer.from(bytes).toString('utf8'));
    parsed.snapshot.publication.frames[0].wireBytesBase64='AAAA';
    assert.throws(()=>decodeT4OriginalReplacementHistoryResponse(Buffer.from(JSON.stringify(parsed)),request),isCode('REPLACEMENT_HISTORY_CARRIER_FRAME_INVALID'));
    assert.throws(()=>decodeT4OriginalReplacementHistoryRequest(Buffer.from('{"schema":1,"schema":2}')),isCode('REPLACEMENT_HISTORY_CARRIER_ENCODING_INVALID'));
    assert.throws(()=>decodeT4OriginalReplacementHistoryRequest(Uint8Array.of(255)),isCode('REPLACEMENT_HISTORY_CARRIER_ENCODING_INVALID'));
    assert.throws(()=>decodeT4OriginalReplacementHistoryRequest(new Uint8Array(32769)),isCode('REPLACEMENT_HISTORY_CARRIER_SIZE_INVALID'));
    let channelEpoch=1;
    const client=createT4OriginalReplacementHistoryClient({localNodeRef:recipientNodeRef,peerNodeRef:sourceNodeRef,
      scopeRef:c.scopeRef,ownerEpoch:c.ownerEpoch,workspaceId:c.workspaceId,originalWriteOwnerRef:c.originalWriteOwnerRef,getMode,readOriginalPeerContext:async()=>({...peerContext(sourceNodeRef),contextEpoch:channelEpoch}),
      invokeOriginalPeerHistory:async()=>{channelEpoch++;return bytes;}});
    await assert.rejects(client(request),isCode('REPLACEMENT_HISTORY_CARRIER_PEER_CHANGED'));
    const unbound=createT4OriginalReplacementHistoryClient({localNodeRef:recipientNodeRef,peerNodeRef:sourceNodeRef,
      scopeRef:c.scopeRef,ownerEpoch:c.ownerEpoch,workspaceId:c.workspaceId,originalWriteOwnerRef:c.originalWriteOwnerRef,getMode,readOriginalPeerContext:async()=>({...peerContext(sourceNodeRef),originalConfidentialChannelVerified:false}),
      invokeOriginalPeerHistory:async()=>{assert.fail('unbound carrier must not invoke peer');}});
    await assert.rejects(unbound(request),isCode('REPLACEMENT_HISTORY_CARRIER_PEER_UNBOUND'));

    peerUnavailable=true;await assert.rejects(recoverOwner(),isCode('CURSOR_REPLACEMENT_OWNER_HISTORY_NOT_READY'));peerUnavailable=false;
    ownerReadAllowed=false;await assert.rejects(recoverOwner(),isCode('REPLACEMENT_HISTORY_OWNER_READ_DENIED'));ownerReadAllowed=true;
    await assert.rejects(recoverOwner({readOriginalOwnerHistory:async request=>{
      const snapshot=structuredClone(await ownerHistory(request));if(request.ownerNodeRef===recipientNodeRef)snapshot.request.ownerNodeRef=sourceNodeRef;
      return snapshot;}}),isCode('REPLACEMENT_HISTORY_SNAPSHOT_INVALID'));
    await assert.rejects(recoverOwner({verifyOriginalHistoricalNodeSignature:async()=>null}),isCode('WIRE_HISTORICAL_SIGNATURE_NOT_VERIFIED'));
    await assert.rejects(recoverOwner({sourcePhasePort:cold.sourcePhasePort}),isCode('CURSOR_REPLACEMENT_TERMINAL_HISTORY_PORTS_REQUIRED'));
    assert.deepEqual({source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()},counts);
  }
  // A later unrelated source Event cannot invalidate the exact captured prefix.
  x.sourceEvents.push({...x.sourceEvents[1],event_id:'event:k68:later',revision:8,payload:{title:'later'}});
  assert.deepEqual(await recover(),historical);
  historyAllowed=false;await assert.rejects(recover(),isCode('CURSOR_ORIGINAL_HISTORICAL_RECOVERY_DENIED'));historyAllowed=true;
  await assert.rejects(recover({sourcePublicationPort:{...source,readOriginalHistoricalPublishedBatch:async()=>{
    const batch=structuredClone(await source.readOriginalHistoricalPublishedBatch());batch.frames[0].originalPresentEventId='event:k68:forged';return batch;}}}),
    isCode('CURSOR_REPLACEMENT_HISTORICAL_ANCHOR_MISMATCH'));
  await assert.rejects(recover({historicalFramePort:{...historyArgs.historicalFramePort,readOriginalHistoricalAppliedAck:async()=>null}}),
    isCode('CURSOR_REPLACEMENT_HISTORICAL_ACK_MISMATCH'));
  recipientResult=false;await assert.rejects(recover(),isCode('PHASE_ORIGINAL_APPLIED_NOT_PROVEN'));recipientResult=true;
  const originalPayload=x.sourceEvents[1].payload;x.sourceEvents[1].payload={title:'forged'};
  await assert.rejects(recover(),isCode('CURSOR_ORIGINAL_T3_SOURCE_EVENT_CHANGED'));x.sourceEvents[1].payload=originalPayload;
  await assert.rejects(recoverT4OriginalHistoricallyConfirmedSourceCursor(historyArgs),isCode('PUBLICATION_ORIGINAL_CAPTURE_IDENTITY_INVALID'));
  assert.deepEqual({source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()},counts);
  // K69: both actual original frontier ports start at the admitted prefix.
  // The recipient Result callback above is a fixture; the actual recipient
  // cursor must independently find the original business Event as well.
  x.restoreFrontier();x.restoreRecipientFrontier();
  const cursorHistory=node=>order==='SOURCE_FIRST_NORMAL'?ownerRecovery(node):historyArgs;
  const recipientCommit=()=>x.realRecipientCursor().commitHistoricallyConfirmedReplacementCursor({recovery:cursorHistory(recipientNodeRef)});
  const sourceCommit=()=>x.realSourceCursor().commitHistoricallyConfirmedReplacementCursor({recovery:cursorHistory(sourceNodeRef)});
  const hostStep=async(role,patch={})=>{
    const node=role==='SOURCE'?sourceNodeRef:recipientNodeRef,base=originalReadOptions[role],port=role==='SOURCE'?x.realSourceCursor():x.realRecipientCursor();
    const readOriginalCurrentCursor=role==='SOURCE'?async()=>(await port.inspectOriginalHostCursor()).originalT3NextCursor:port.readOriginalVerifiedCursor;
    const selection=await readT4OriginalLocalReplacementSelection({...base,technicalSchemaId:'iwxa.demo.note',sourceWorkspaceId:c.workspaceId,
      originalWriteOwnerRef:c.originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef:c.scopeRef,ownerEpoch:c.ownerEpoch,
      sourceCursorBefore:await readOriginalCurrentCursor(),readOriginalCurrentCursor,requiredCryptoSuite:historyArgs.requiredCryptoSuite,
      verifyOriginalRecipientApplied:role==='SOURCE'?x.verifySourceApplied:peerResult,verifyOriginalHistoricalNodeSignature:x.historicalSignature(node)});
    return completeT4OriginalReplacementHostCursor({selection,role,originalCursorPort:port,getMode,requiredCryptoSuite:historyArgs.requiredCryptoSuite,
      readOriginalHostContext:async()=>({...await base.readOriginalHostContext(),workspaceId:c.workspaceId}),
      readOriginalLocalOwnerHistory:async request=>{assert.equal(request.ownerNodeRef,node);return ownerHistory(request);},
      readOriginalPeerReplacementHistory:async request=>{assert.notEqual(request.ownerNodeRef,node);return carrier(node)(request);},
      authorizeOriginalPeerReplacementHistoryRead:async p=>p.request.requesterNodeRef===node&&p.originalSubjectMutationAllowed===false,
      authorizeOriginalHostTask:async p=>p.nodeRef===node&&p.originalSubjectMutationAllowed===false,
      authorizeOriginalHistoricalCursorRecovery:historyArgs.authorizeOriginalHistoricalCursorRecovery,
      verifyOriginalHistoricalNodeSignature:x.historicalSignature(node),...patch});
  };
  assert.deepEqual((await x.realSourceCursor().inspectOriginalHostCursor()).originalT3NextCursor,x.sourceCursorBefore);
  assert.deepEqual(await x.realRecipientCursor().readOriginalVerifiedCursor(),x.sourceCursorBefore);
  await assert.rejects(recipientCommit(),isCode('RECIPIENT_CURSOR_ORIGINAL_RESULT_EVENT_MISMATCH'));
  x.f.kernel.events.push({event_id:actualEvent,workspace_id:c.workspaceId,object_id:'object:k47:one',
    revision:c.sourceRevision,event_type:'iwxa.t4.original-object.synced',payload:{originalEventId:c.sourceEventId,
      originalEventDigest:c.sourceEventDigest,originalWriteOwnerRef:c.originalWriteOwnerRef,originalContentDigest:B}});
  await assert.rejects(x.realRecipientCursor().persistOriginalVerifiedCursor({}, {session:c}),isCode('PUBLICATION_ORIGINAL_CAPTURE_IDENTITY_INVALID'));
  x.setFrontierWriteAllowed(false);await assert.rejects(recipientCommit(),isCode('RECIPIENT_CURSOR_ORIGINAL_ACCESS_DENIED'));
  x.setFrontierWriteAllowed(true);
  assert.deepEqual({source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()},counts);
  if(order==='RECIPIENT_FIRST_LOST_RESPONSES'){
    x.f.kernel.loseNextReply();await assert.rejects(recipientCommit(),isCode('RECIPIENT_CURSOR_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
    assert.deepEqual(await x.realRecipientCursor().readOriginalVerifiedCursor(),x.sourceCursorAfter);
    assert.deepEqual((await x.realSourceCursor().inspectOriginalHostCursor()).originalT3NextCursor,x.sourceCursorBefore);
    await assert.rejects(x.eligibility(),isCode('REPLACEMENT_ORIGINAL_CAUSAL_FRONTIER_CHANGED'));
    historyAllowed=false;await assert.rejects(sourceCommit(),isCode('CURSOR_ORIGINAL_HISTORICAL_RECOVERY_DENIED'));historyAllowed=true;
    x.sourceStore.loseNextReply();await assert.rejects(sourceCommit(),isCode('HOST_CURSOR_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  }else{
    const beforeHost={source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()};
    const ownerReadCount=ownerReads;
    peerUnavailable=true;assert.equal((await hostStep('SOURCE')).state,'WAITING_FOR_REPLACEMENT_OWNER_EVIDENCE');peerUnavailable=false;
    assert.equal(ownerReads,ownerReadCount+1,'busy peer must be checked before the local terminal history');
    // K76: a busy peer after initial admission but before CAS is waiting,
    // not a fatal wake suspension or a permission to write.
    let freshReads=0;
    const midProofWait=await hostStep('SOURCE',{readOriginalPeerReplacementHistory:async request=>{
      if(++freshReads===2)return null;return carrier(sourceNodeRef)(request);}});
    assert.equal(midProofWait.state,'WAITING_FOR_REPLACEMENT_OWNER_EVIDENCE');assert.equal(freshReads,2);
    assert.equal(midProofWait.sourceCursorAdvanced,false);assert.equal(midProofWait.originalRecipientCursorAdvanced,false);
    await assert.rejects(hostStep('SOURCE',{authorizeOriginalPeerReplacementHistoryRead:async p=>p.stage==='before'}),isCode('REPLACEMENT_HISTORY_PEER_READ_DENIED'));
    await assert.rejects(hostStep('SOURCE',{authorizeOriginalHostTask:async()=>false}),isCode('REPLACEMENT_HOST_CURSOR_TASK_DENIED'));
    assert.deepEqual({source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()},beforeHost);
    const sourceStep=await hostStep('SOURCE');assert.equal(sourceStep.state,'ORIGINAL_REPLACEMENT_CURSOR_COMMITTED');
    assert.equal(sourceStep.sourceCursorAdvanced,true);assert.equal(sourceStep.originalRecipientCursorAdvanced,false);
    assert.deepEqual((await x.realSourceCursor().inspectOriginalHostCursor()).originalT3NextCursor,x.sourceCursorAfter);
    assert.deepEqual(await x.realRecipientCursor().readOriginalVerifiedCursor(),x.sourceCursorBefore);
    await assert.rejects(x.eligibility(),isCode('REPLACEMENT_ORIGINAL_CAUSAL_FRONTIER_CHANGED'));
    historyAllowed=false;await assert.rejects(recipientCommit(),isCode('CURSOR_ORIGINAL_HISTORICAL_RECOVERY_DENIED'));historyAllowed=true;
    const realPort=x.realRecipientCursor();let committedHere=false;
    const interruptedReadback={...realPort,
      commitHistoricallyConfirmedReplacementCursor:async input=>{
        const result=await realPort.commitHistoricallyConfirmedReplacementCursor(input);committedHere=true;return result;},
      readOriginalVerifiedCursor:async()=>{
        if(committedHere)throw Object.assign(Error('lost final Host readback'),{code:'K76_READBACK_UNAVAILABLE'});
        return realPort.readOriginalVerifiedCursor();}};
    await assert.rejects(hostStep('RECIPIENT',{originalCursorPort:interruptedReadback}),error=>{
      assert.equal(error.code,'RECIPIENT_CURSOR_ORIGINAL_WRITE_OUTCOME_UNKNOWN');
      assert.equal(error.details.originalCode,'K76_READBACK_UNAVAILABLE');
      assert.equal(error.details.originalWriteMayHaveCommitted,true);assert.equal(error.details.automaticRetryAllowed,false);return true;});
    assert.equal(committedHere,true);assert.deepEqual(await realPort.readOriginalVerifiedCursor(),x.sourceCursorAfter);
    assert.ok(carrierCalls>2);
  }
  x.f.restart();
  assert.equal((await recipientCommit()).state,'ALREADY_COMMITTED');
  assert.equal((await sourceCommit()).state,'ALREADY_COMMITTED');
  assert.deepEqual((await x.realSourceCursor().inspectOriginalHostCursor()).originalT3NextCursor,x.sourceCursorAfter);
  const committed=await x.realSourceCursor().inspectOriginalCommittedSourceAcknowledgements({sessions:[c]});
  assert.equal(committed.results.length,1);assert.deepEqual(committed.results[0].session,c);
  assert.equal((await x.realSourceCursor().inspectOriginalCommittedSourceAcknowledgements({sessions:[x.session]})).results.length,0);
  const selection=Object.fromEntries(['sessionRef','changeId','sourceEventId','sourceEventDigest','capturedSha256'].map(k=>[k,c[k]]));
  const results=await x.realRecipientCursor().inspectOriginalCommittedRecipientResults({selections:[selection]});
  assert.deepEqual(results.results[0].session,c);assert.equal(results.results[0].originalRecipientEventId,actualEvent);
  const next=await x.realSourceCursor().readNextOriginalSourceEvent();
  assert.equal(next.state,'NEXT_ORIGINAL_EVENT_READY_FOR_EXISTING_HOST_TASK');assert.equal(next.nextCursor.lastEventId,'event:k68:later');
  assert.deepEqual({source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()},
    {...counts,source:counts.source+1,recipient:counts.recipient+1});
});


test('K71 local successor selection uses original frontier, retirement and signed publication; no peer or network port',async()=>{
  const x=await controlFixture({indexed:true}),before=x.sourceCursorBefore;
  let frontier=before;
  const options=node=>({...x.historicalReadOptions(node),technicalSchemaId:'iwxa.demo.note',sourceWorkspaceId:x.session.workspaceId,
    originalWriteOwnerRef:owner,sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch:x.session.ownerEpoch,
    sourceCursorBefore:before,readOriginalCurrentCursor:async()=>frontier,requiredCryptoSuite:x.eligibilityOptions().requiredCryptoSuite,
    verifyOriginalHistoricalNodeSignature:x.historicalSignature(node),verifyOriginalRecipientApplied:async()=>false});
  const select=(node,patch={})=>readT4OriginalLocalReplacementSelection({...options(node),...patch});
  assert.equal(await select(sourceNodeRef),null);assert.equal(await select(recipientNodeRef),null);
  await closeInitialAttempt(x);x.sourceStore.loseNextReply();
  await assert.rejects(x.publishReplacement(),isCode('PUBLICATION_ORIGINAL_CAS_OUTCOME_UNKNOWN'));
  const preparedCounts={source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()};
  const prepared=await select(sourceNodeRef);assert.equal(prepared.originalLocalPhase,null);
  assert.equal(prepared.originalLocalFrames[0].state,'PREPARED');assert.equal(prepared.liveNetworkAuthorityGranted,false);
  assert.deepEqual({source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()},preparedCounts);
  const head=await x.publishReplacement(),c=head.candidate;
  assert.deepEqual(prepared.session,c);assert.equal(x.signatureCount(),preparedCounts.signs);
  const request=createT4OriginalReplacementOwnerHistoryRequest({session:c,requesterNodeRef:recipientNodeRef,ownerNodeRef:sourceNodeRef});
  const readOptions={...x.historicalReadOptions(sourceNodeRef),request,requiredCryptoSuite:x.eligibilityOptions().requiredCryptoSuite,
    authorizeOriginalOwnerHistoryRead:async()=>true,verifyOriginalRecipientApplied:async()=>false,
    verifyOriginalHistoricalNodeSignature:x.historicalSignature(sourceNodeRef),authorizeOriginalHostWire:async()=>true};
  const waiting=await readT4OriginalReplacementOwnerHistory(readOptions);
  assert.equal(waiting.state,'WAITING_FOR_LOCAL_TERMINAL_PHASE');assert.equal(waiting.publication,null);assert.equal(waiting.retiredPhase,null);
  await assert.rejects(readT4OriginalReplacementOwnerHistory({...readOptions,authorizeOriginalOwnerHistoryRead:async()=>false}),isCode('REPLACEMENT_HISTORY_OWNER_READ_DENIED'));
  await assert.rejects(readT4OriginalReplacementOwnerHistory({...readOptions,request:{...request,ownerNodeRef:recipientNodeRef}}),isCode('REPLACEMENT_HISTORY_ORIGINAL_PORTS_REQUIRED'));
  const counts={source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()};
  const first=await select(sourceNodeRef);assert.deepEqual(first.session,c);
  assert.equal(first.originalLocalPhase,null);assert.equal(first.originalLocalFrames[0].state,'PRESENT');
  assert.equal(first.originalPeerOwnerReadStillRequired,true);assert.equal(first.liveNetworkAuthorityGranted,false);
  assert.equal(await select(recipientNodeRef),null);
  assert.deepEqual({source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()},counts);
  const createPhase=async({session:c,admission},readOriginalReplacementSourceAdmission)=>x.sourcePhase({
    sessionRef:c.sessionRef,authorizeOriginalSourceSupersession:null,replacementSourceAdmission:admission,readOriginalReplacementSourceAdmission});
  const admitted=await admitT4OriginalReplacementSourcePhase({...x.eligibilityOptions(),
    createOriginalReplacementPublicationPort:x.createReplacementPort,createOriginalReplacementSourcePhasePort:createPhase});
  const phase=await createPhase({session:c,admission:admitted.admission},async()=>true);
  await x.publishReplacementDiff(phase);
  x.rotateSource();x.rotateRecipient();x.offline();x.f.restart();
  const after={source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()};
  const s=await select(sourceNodeRef),r=await select(recipientNodeRef);
  assert.deepEqual(s.session,c);assert.deepEqual(r.session,c);assert.equal(s.originalLocalPhase,'INTENT');assert.equal(r.originalLocalPhase,null);
  assert.equal(r.originalLocalFrames[0].messageType,'DIFF_REQUEST');
  assert.equal(s.originalLocalRetirementEventVerified,true);assert.equal(r.originalLocalHistoricalSignaturesVerified,true);
  await assert.rejects(select(sourceNodeRef,{verifyOriginalHistoricalNodeSignature:async()=>null}),isCode('WIRE_HISTORICAL_SIGNATURE_NOT_VERIFIED'));
  frontier=x.sourceCursorAfter;await assert.rejects(select(sourceNodeRef),isCode('PHASE_ORIGINAL_REPLACEMENT_SELECTION_FRONTIER_CHANGED'));
  frontier=before;
  const stale=await select(sourceNodeRef,{sourceCursorBefore:x.sourceCursorAfter,readOriginalCurrentCursor:async()=>x.sourceCursorAfter});
  assert.equal(stale,null);
  await assert.rejects(select(recipientNodeRef,{authorizeOriginalTechnicalRead:async()=>false}),isCode('PUBLICATION_ORIGINAL_AUTHORITY_DENIED'));
  const p=options(sourceNodeRef),k=p.originalKernel;let n=0;
  await assert.rejects(select(sourceNodeRef,{originalKernel:{...k,listObjects:async input=>{
    const rows=await k.listObjects(input);if(++n===2)rows.find(o=>o.object_id===s.originalLocalPublicationCheckpointRef).data.title='changed';return rows;
  }}}),isCode('PHASE_ORIGINAL_REPLACEMENT_SELECTION_CHANGED'));
  assert.deepEqual({source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()},after);
});


test('K77 original wake deferral is bounded, role-distinct and resets with local progress',()=>{
  const selection={session:{sessionRef:'session:k77'},originalLocalPhase:'APPLIED',originalLocalPublicationRevision:4};
  const next=(role,previous=null,now=100,s=selection)=>deferT4OriginalReplacementHistoryWake({role,previous,now,selection:s});
  const source=next('SOURCE'),recipient=next('RECIPIENT');
  assert.equal(source.nextWakeAt,850);assert.equal(recipient.nextWakeAt,2350);
  let prior=source;
  for(let i=0;i<12;i++)prior=next('SOURCE',prior,prior.nextWakeAt);
  assert.equal(prior.retryAfterMs,6000);assert.equal(prior.attempt,5);
  const changed=next('SOURCE',prior,prior.nextWakeAt,{...selection,originalLocalPublicationRevision:5});
  assert.equal(changed.attempt,1);assert.equal(changed.retryAfterMs,750);
  const phase=next('RECIPIENT',recipient,recipient.nextWakeAt,{...selection,originalLocalPhase:'APPLIED_CONFIRMED'});
  assert.equal(phase.attempt,1);assert.equal(phase.retryAfterMs,2250);
  assert.throws(()=>next('SOURCE',prior,1),isCode('REPLACEMENT_HISTORY_WAKE_DEFERRAL_INVALID'));
});

import {createT4OriginalReplacementOwnerEligibilityRequest,readT4OriginalReplacementOwnerEligibility} from "../src/network/original-network-replacement-owner-eligibility.mjs";


test('K79 independent owner eligibility reads exact predecessor, frontier and source capture without a transport or write port',async()=>{
  const x=await controlFixture({indexed:true,realSourceHistory:true}),c=x.session,before=x.sourceCursorBefore;
  const request=(node,requester=sourceNodeRef)=>createT4OriginalReplacementOwnerEligibilityRequest({session:c,sourceCursorBefore:before,requesterNodeRef:requester,ownerNodeRef:node});
  let allowed=true,capture=c;
  const selection=()=>({schema:'IWXA_T4_ORIGINAL_NATIVE_CAPTURE_SELECTION_V1',state:'ORIGINAL_NATIVE_SESSION_SELECTED',
    ...Object.fromEntries(['workspaceId','originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch'].map(k=>[k,c[k]])),
    networkTargetRef:c.recipientNodeRef,session:capture,sourceCursorBefore:before,sourceCursorAfter:x.sourceCursorAfter,
    originalSourceOwnerReadVerified:true,originalCaptureEvidenceVerified:true,originalSourceCursorAdvanced:false,originalNetworkPublished:false,
    originalSubjectMutationInvoked:false,capturedPlaintextReturned:false,createsStore:false,createsScheduler:false});
  const options=r=>({...x.historicalReadOptions(r.ownerNodeRef),request:r,requiredCryptoSuite:x.eligibilityOptions().requiredCryptoSuite,
    verifyOriginalRecipientApplied:async()=>false,verifyOriginalHistoricalNodeSignature:x.historicalSignature(r.ownerNodeRef),
    authorizeOriginalHostWire:async()=>true,authorizeOriginalOwnerHistoryRead:async p=>allowed&&p.originalSubjectMutationAllowed===false&&p.request.schema===r.schema,
    originalCursorPort:r.ownerNodeRef===sourceNodeRef?x.realSourceCursor():x.realRecipientCursor(),
    ...(r.ownerNodeRef===sourceNodeRef?{readOriginalCaptureSelection:async()=>selection()}:{} )});
  const read=(r,patch={})=>readT4OriginalReplacementOwnerEligibility({...options(r),...patch});
  assert.equal((await read(request(sourceNodeRef))).state,'WAITING_FOR_LOCAL_RETIREMENT');
  assert.equal((await read(request(recipientNodeRef))).state,'WAITING_FOR_LOCAL_RETIREMENT');
  await closeInitialAttempt(x);
  const direct=await x.eligibility(),counts={source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()};
  const source=await read(request(sourceNodeRef)),recipient=await read(request(recipientNodeRef));
  assert.equal(source.state,'ORIGINAL_OWNER_ELIGIBILITY_VERIFIED');assert.deepEqual(source.sourceCapture.session,c);
  assert.equal(recipient.sourceCapture,null);assert.equal(source.retiredAck,null);assert.equal(recipient.liveNetworkAuthorityGranted,false);
  const composition={originalCaptureSession:c,sourceCursorBefore:before,requiredCryptoSuite:x.eligibilityOptions().requiredCryptoSuite,
    getMode:x.eligibilityOptions().getMode,authorizeOriginalReplacement:async()=>true};
  for(const requesterNodeRef of [sourceNodeRef,recipientNodeRef]){
    const paths=[];const r=await recoverT4OriginalReplacementEligibility({...composition,requesterNodeRef,readOriginalOwnerEligibility:async request=>{
      paths.push(request.ownerNodeRef);return read(request);}});
    assert.deepEqual(r,direct);assert.equal(paths.length,4);assert.notEqual(paths[0],requesterNodeRef);
  }
  await assert.rejects(recoverT4OriginalReplacementEligibility({...composition,requesterNodeRef:sourceNodeRef,
    readOriginalOwnerEligibility:async()=>null}),isCode('REPLACEMENT_ORIGINAL_OWNER_ELIGIBILITY_NOT_READY'));
  await assert.rejects(recoverT4OriginalReplacementEligibility({...composition,requesterNodeRef:sourceNodeRef,
    verifyOriginalSourceCapture:async()=>true,readOriginalOwnerEligibility:read}),isCode('REPLACEMENT_ORIGINAL_PORTS_REQUIRED'));
  await assert.rejects(recoverT4OriginalReplacementEligibility({...composition,requesterNodeRef:sourceNodeRef,
    readOriginalOwnerEligibility:async()=>source}),isCode('REPLACEMENT_ELIGIBILITY_OWNER_SNAPSHOT_INVALID'));
  await assert.rejects(recoverT4OriginalReplacementEligibility({...composition,requesterNodeRef:sourceNodeRef,
    authorizeOriginalReplacement:async()=>false,readOriginalOwnerEligibility:read}),isCode('REPLACEMENT_ORIGINAL_ADMISSION_DENIED'));
  allowed=false;await assert.rejects(read(request(sourceNodeRef)),isCode('REPLACEMENT_HISTORY_OWNER_READ_DENIED'));allowed=true;
  capture={...c,capturedSha256:'f'.repeat(64)};await assert.rejects(read(request(sourceNodeRef)),isCode('REPLACEMENT_ELIGIBILITY_OWNER_CAPTURE_MISMATCH'));capture=c;
  const actual=options(request(recipientNodeRef)).originalCursorPort;
  await assert.rejects(read(request(recipientNodeRef),{originalCursorPort:{...actual,inspectOriginalRecipientCursor:async()=>({
    ...await actual.inspectOriginalRecipientCursor(),originalT3VerifiedCursor:x.sourceCursorAfter})}}),isCode('REPLACEMENT_ORIGINAL_CAUSAL_FRONTIER_CHANGED'));
  let reads=0;await assert.rejects(read(request(recipientNodeRef),{originalCursorPort:{...actual,inspectOriginalRecipientCursor:async()=>({
    ...await actual.inspectOriginalRecipientCursor(),chainHash:++reads===1?H:B})}}),isCode('REPLACEMENT_ELIGIBILITY_OWNER_EVIDENCE_CHANGED'));
  x.offline();x.f.restart();assert.deepEqual(await read(request(sourceNodeRef)),source);
  assert.deepEqual({source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()},counts);
});

test('K79 accepted predecessor APPLIED_ACK prevents independent source eligibility',async()=>{
  const x=await controlFixture({indexed:true,realSourceHistory:true});await closeInitialAttempt(x);await x.acceptConflictingAck();
  const request=createT4OriginalReplacementOwnerEligibilityRequest({session:x.session,sourceCursorBefore:x.sourceCursorBefore,
    requesterNodeRef:recipientNodeRef,ownerNodeRef:sourceNodeRef});
  await assert.rejects(readT4OriginalReplacementOwnerEligibility({...x.historicalReadOptions(sourceNodeRef),request,
    requiredCryptoSuite:x.eligibilityOptions().requiredCryptoSuite,verifyOriginalRecipientApplied:async()=>false,
    verifyOriginalHistoricalNodeSignature:x.historicalSignature(sourceNodeRef),authorizeOriginalHostWire:async()=>true,
    authorizeOriginalOwnerHistoryRead:async()=>true,originalCursorPort:x.realSourceCursor(),readOriginalCaptureSelection:async()=>assert.fail('old accepted ACK must block capture read')}),
    isCode('REPLACEMENT_ORIGINAL_APPLIED_ACK_ALREADY_ACCEPTED'));
});


import {advanceT4OriginalReplacementSourceHandshake} from '../src/network/original-network-session-supersession.mjs';
import {requireT4OriginalRetiredAttemptStatus} from '../src/network/original-network-session-phases.mjs';

test('K81 stopped source advances one successor step at a time through owner eligibility carrier; lost responses never duplicate signature or phase',async()=>{
  const x=await controlFixture({indexed:true,realSourceHistory:true}),root=x.session,before=x.sourceCursorBefore;
  await closeInitialAttempt(x);
  const predecessor=x.sourcePhase(),retired=requireT4OriginalRetiredAttemptStatus(await predecessor.inspectOriginalSession(),root,'SOURCE',predecessor.checkpointRef);
  const {requiredCryptoSuite,getMode}=x.eligibilityOptions();
  const capture=()=>({schema:'IWXA_T4_ORIGINAL_NATIVE_CAPTURE_SELECTION_V1',state:'ORIGINAL_NATIVE_SESSION_SELECTED',
    ...Object.fromEntries(['workspaceId','originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch'].map(k=>[k,root[k]])),
    networkTargetRef:root.recipientNodeRef,session:root,sourceCursorBefore:before,sourceCursorAfter:x.sourceCursorAfter,
    originalSourceOwnerReadVerified:true,originalCaptureEvidenceVerified:true,originalSourceCursorAdvanced:false,originalNetworkPublished:false,
    originalSubjectMutationInvoked:false,capturedPlaintextReturned:false,createsStore:false,createsScheduler:false});
  const localRead=request=>readT4OriginalReplacementOwnerEligibility({...x.historicalReadOptions(request.ownerNodeRef),request,requiredCryptoSuite,
    verifyOriginalRecipientApplied:async()=>false,verifyOriginalHistoricalNodeSignature:x.historicalSignature(request.ownerNodeRef),
    authorizeOriginalHostWire:async()=>true,authorizeOriginalOwnerHistoryRead:async()=>true,
    originalCursorPort:request.ownerNodeRef===sourceNodeRef?x.realSourceCursor():x.realRecipientCursor(),
    ...(request.ownerNodeRef===sourceNodeRef?{readOriginalCaptureSelection:async()=>capture()}: {})});
  const carrier={scopeRef,ownerEpoch:root.ownerEpoch,workspaceId:root.workspaceId,originalWriteOwnerRef:owner,getMode};
  const peerContext=nodeRef=>({nodeRef,originalPeerSessionRef:'peer:k81:authenticated',contextEpoch:1,scopeRef,ownerEpoch:root.ownerEpoch,
    originalPeerAuthenticated:true,originalConfidentialChannelVerified:true});
  let busy=true,peerReads=0,allow=true;
  const server=createT4OriginalReplacementHistoryServer({...carrier,localNodeRef:recipientNodeRef,peerNodeRef:sourceNodeRef,
    readOriginalPeerContext:async()=>peerContext(sourceNodeRef),readOriginalReplacementOwnerHistory:async({request})=>{
      peerReads++;return busy?null:localRead(request);}});
  const client=createT4OriginalReplacementHistoryClient({...carrier,localNodeRef:sourceNodeRef,peerNodeRef:recipientNodeRef,
    readOriginalPeerContext:async()=>peerContext(recipientNodeRef),invokeOriginalPeerHistory:({requestBytes})=>server(requestBytes)});
  const select=()=>readT4OriginalLocalReplacementSelection({...x.historicalReadOptions(sourceNodeRef),technicalSchemaId:'iwxa.demo.note',
    sourceWorkspaceId:root.workspaceId,originalWriteOwnerRef:owner,sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch:root.ownerEpoch,
    sourceCursorBefore:before,readOriginalCurrentCursor:async()=>(await x.realSourceCursor().inspectOriginalHostCursor()).originalT3NextCursor,
    requiredCryptoSuite,verifyOriginalHistoricalNodeSignature:x.historicalSignature(sourceNodeRef),verifyOriginalRecipientApplied:async()=>false});
  const advance=(selection=null,patch={})=>advanceT4OriginalReplacementSourceHandshake({originalCaptureSession:root,sourceCursorBefore:before,retired,selection,
    getMode,requiredCryptoSuite,readOriginalOwnerEligibility:r=>r.ownerNodeRef===sourceNodeRef?localRead(r):client(r),
    authorizeOriginalReplacement:async proof=>allow&&proof.originalBothAttemptsRetired===true,
    createOriginalReplacementPublicationPort:x.createReplacementPort,
    createOriginalReplacementSourcePhasePort:async({session:c,admission},readOriginalReplacementSourceAdmission)=>x.sourcePhase({
      sessionRef:c.sessionRef,authorizeOriginalSourceSupersession:null,replacementSourceAdmission:admission,readOriginalReplacementSourceAdmission}),
    resolveOriginalSigningContext:x.resolveSourceContentSigner,signOriginalNodeBytes:x.signSourceContent,...patch});
  const baseline={signs:x.signatureCount(),puts:x.counts().networkPuts,source:x.sourceStore.calls,recipient:x.f.kernel.calls,phases:x.sourcePhaseWrites()};
  assert.equal(await select(),null);
  const waiting=await advance();assert.equal(waiting.state,'WAITING_FOR_REPLACEMENT_ELIGIBILITY');
  assert.equal(waiting.replacementWake.originalLocalPublicationRevision,0);assert.equal(waiting.automaticRetryAllowed,false);assert.equal(peerReads,1);
  assert.equal(x.sourceStore.calls,baseline.source);assert.equal(x.signatureCount(),baseline.signs);assert.equal(x.counts().networkPuts,baseline.puts);
  busy=false;allow=false;
  await assert.rejects(advance(),isCode('REPLACEMENT_ORIGINAL_ADMISSION_DENIED'));allow=true;
  await assert.rejects(advance(null,{retired:{...retired,originalSupersessionEventId:'event:wrong'}}),isCode('REPLACEMENT_HOST_SOURCE_HANDSHAKE_RETIREMENT_CHANGED'));
  x.sourceStore.loseNextReply();await assert.rejects(advance(),isCode('PUBLICATION_ORIGINAL_CAS_OUTCOME_UNKNOWN'));
  x.f.restart();const prepared=await select();assert.equal(prepared.originalLocalFrames[0].state,'PREPARED');
  assert.equal(x.signatureCount(),baseline.signs+1);assert.equal(x.counts().networkPuts,baseline.puts);
  busy=true;assert.equal((await advance(prepared)).state,'WAITING_FOR_REPLACEMENT_ELIGIBILITY');busy=false;
  x.loseControlWrite();await assert.rejects(advance(prepared),isCode('PUBLICATION_NETWORK_OUTCOME_UNKNOWN'));
  x.f.restart();const attempted=await select();assert.equal(attempted.originalLocalFrames[0].state,'ATTEMPTED');
  const published=await advance(attempted);assert.equal(published.state,'ORIGINAL_REPLACEMENT_HEAD_PUBLISHED');
  assert.equal(x.signatureCount(),baseline.signs+1);assert.equal(x.counts().networkPuts,baseline.puts+1);
  const present=await select();assert.equal(present.originalLocalFrames[0].state,'PRESENT');assert.equal(present.originalLocalPhase,null);
  x.sourceStore.loseNextReply();await assert.rejects(advance(present),isCode('PHASE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  x.f.restart();const admitted=await select();assert.equal(admitted.originalLocalPhase,'INTENT');assert.equal(admitted.originalLocalPhaseRevision,1);
  // The stale selection is not a new INTENT, nor permission to re-publish.
  const confirmed=await advance(present);assert.equal(confirmed.state,'ORIGINAL_REPLACEMENT_SOURCE_INTENT_RECORDED');assert.equal(confirmed.originalSourceAdmissionStatus,'ALREADY_CONFIRMED');
  assert.equal(x.sourcePhaseWrites(),baseline.phases+1);assert.equal(x.signatureCount(),baseline.signs+1);
  assert.equal(x.counts().networkPuts,baseline.puts+1);assert.equal(x.f.kernel.calls,baseline.recipient);
  assert.deepEqual((await x.realSourceCursor().inspectOriginalHostCursor()).originalT3NextCursor,before);
  assert.deepEqual((await x.realRecipientCursor().inspectOriginalRecipientCursor()).originalT3VerifiedCursor,before);
  await assert.rejects(advance(admitted),isCode('REPLACEMENT_HOST_SOURCE_HANDSHAKE_SELECTION_INVALID'));
});


import {advanceT4OriginalReplacementRecipientHandshake} from '../src/network/original-network-session-supersession.mjs';
import {createT4OriginalReplacementOwnerSourceAdmissionRequest,
  validateT4OriginalReplacementOwnerSourceAdmissionSnapshot} from '../src/network/original-network-replacement-owner-history.mjs';

test('K82 recipient reads source INTENT through independent owner carrier, requires live HEADS and recovers exact DIFF without duplicate signatures',async()=>{
  const x=await controlFixture({indexed:true,realSourceHistory:true}),root=x.session,before=x.sourceCursorBefore;
  await closeInitialAttempt(x);
  const old=x.phase(),retired=requireT4OriginalRetiredAttemptStatus(await old.inspectOriginalSession(),root,'RECIPIENT',old.checkpointRef);
  const {requiredCryptoSuite,getMode}=x.eligibilityOptions();
  const capture=()=>({schema:'IWXA_T4_ORIGINAL_NATIVE_CAPTURE_SELECTION_V1',state:'ORIGINAL_NATIVE_SESSION_SELECTED',
    ...Object.fromEntries(['workspaceId','originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch'].map(k=>[k,root[k]])),
    networkTargetRef:root.recipientNodeRef,session:root,sourceCursorBefore:before,sourceCursorAfter:x.sourceCursorAfter,
    originalSourceOwnerReadVerified:true,originalCaptureEvidenceVerified:true,originalSourceCursorAdvanced:false,originalNetworkPublished:false,
    originalSubjectMutationInvoked:false,capturedPlaintextReturned:false,createsStore:false,createsScheduler:false});
  const opts=request=>({...x.historicalReadOptions(request.ownerNodeRef),request,requiredCryptoSuite,
    verifyOriginalRecipientApplied:async()=>false,verifyOriginalHistoricalNodeSignature:x.historicalSignature(request.ownerNodeRef),
    authorizeOriginalHostWire:async()=>true,authorizeOriginalOwnerHistoryRead:async()=>true});
  const localRead=request=>readT4OriginalReplacementOwnerEligibility({...opts(request),
    originalCursorPort:request.ownerNodeRef===sourceNodeRef?x.realSourceCursor():x.realRecipientCursor(),
    ...(request.ownerNodeRef===sourceNodeRef?{readOriginalCaptureSelection:async()=>capture()}: {})});
  const carrier={scopeRef,ownerEpoch:root.ownerEpoch,workspaceId:root.workspaceId,originalWriteOwnerRef:owner,getMode};
  const peerContext=nodeRef=>({nodeRef,originalPeerSessionRef:'peer:k82:authenticated',contextEpoch:1,scopeRef,ownerEpoch:root.ownerEpoch,
    originalPeerAuthenticated:true,originalConfidentialChannelVerified:true});
  let busy=false,allow=true;
  const server=createT4OriginalReplacementHistoryServer({...carrier,localNodeRef:sourceNodeRef,peerNodeRef:recipientNodeRef,
    readOriginalPeerContext:async()=>peerContext(recipientNodeRef),readOriginalReplacementOwnerHistory:async({request})=>{
      if(request.schema==='IWXA_T4_ORIGINAL_REPLACEMENT_OWNER_ELIGIBILITY_REQUEST_V1')return localRead(request);
      return busy?null:readT4OriginalReplacementOwnerHistory(opts(request));}});
  const client=createT4OriginalReplacementHistoryClient({...carrier,localNodeRef:recipientNodeRef,peerNodeRef:sourceNodeRef,
    readOriginalPeerContext:async()=>peerContext(sourceNodeRef),invokeOriginalPeerHistory:({requestBytes})=>server(requestBytes)});
  const select=()=>readT4OriginalLocalReplacementSelection({...x.historicalReadOptions(recipientNodeRef),technicalSchemaId:'iwxa.demo.note',
    sourceWorkspaceId:root.workspaceId,originalWriteOwnerRef:owner,sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch:root.ownerEpoch,
    sourceCursorBefore:before,readOriginalCurrentCursor:async()=>(await x.realRecipientCursor().inspectOriginalRecipientCursor()).originalT3VerifiedCursor,
    requiredCryptoSuite,verifyOriginalHistoricalNodeSignature:x.historicalSignature(recipientNodeRef),verifyOriginalRecipientApplied:async()=>false});
  const advance=(selection=null,patch={})=>advanceT4OriginalReplacementRecipientHandshake({originalCaptureSession:root,sourceCursorBefore:before,retired,selection,
    getMode,requiredCryptoSuite,readOriginalOwnerEligibility:r=>r.ownerNodeRef===recipientNodeRef?localRead(r):client(r),
    readOriginalSourceAdmission:client,authorizeOriginalReplacement:async()=>true,
    authorizeOriginalReplacementRecipientAdmission:async p=>allow&&p.originalSourceIntentVerified===true&&p.originalRecipientDiffOnly===true,
    createOriginalReplacementRecipientPublicationPort:x.createReplacementRecipientPort,frameDiscoveryPort:x.transport(recipientNodeRef),
    resolveOriginalSigningContext:async()=>x.recipientSigner(),signOriginalNodeBytes:x.signRecipientAck,...patch});
  const initialSigns=x.signatureCount(),initialPuts=x.counts().networkPuts;
  assert.equal((await advance()).state,'WAITING_FOR_REPLACEMENT_ELIGIBILITY');assert.equal(await select(),null);
  const published=await x.publishReplacement(),c=published.candidate;
  const request=createT4OriginalReplacementOwnerSourceAdmissionRequest({session:c,requesterNodeRef:recipientNodeRef,ownerNodeRef:sourceNodeRef});
  assert.throws(()=>createT4OriginalReplacementOwnerSourceAdmissionRequest({...request,ownerNodeRef:recipientNodeRef}),isCode('REPLACEMENT_SOURCE_ADMISSION_HISTORY_ROUTE_INVALID'));
  assert.equal((await client(request)).state,'WAITING_FOR_SOURCE_INTENT');
  assert.equal((await advance()).state,'WAITING_FOR_REPLACEMENT_ELIGIBILITY');assert.equal(await select(),null);
  assert.equal(x.signatureCount(),initialSigns+1);assert.equal(x.counts().networkPuts,initialPuts+1);
  await admitT4OriginalReplacementSourcePhase({...x.eligibilityOptions(),createOriginalReplacementPublicationPort:x.createReplacementPort,
    createOriginalReplacementSourcePhasePort:async({session:c,admission},readOriginalReplacementSourceAdmission)=>x.sourcePhase({
      sessionRef:c.sessionRef,authorizeOriginalSourceSupersession:null,replacementSourceAdmission:admission,readOriginalReplacementSourceAdmission})});
  const source=await client(request);assert.equal(source.state,'ORIGINAL_SOURCE_INTENT_HISTORY_VERIFIED');
  assert.equal(source.phase.currentPhase,'INTENT');assert.equal(source.head.sha256,published.sha256);
  assert.equal(source.liveNetworkAuthorityGranted,false);assert.equal(source.head.wireBytes,undefined);
  assert.throws(()=>validateT4OriginalReplacementOwnerSourceAdmissionSnapshot({...source,head:{...source.head,sha256:'f'.repeat(64)}},request),
    isCode('REPLACEMENT_SOURCE_ADMISSION_HISTORY_HEAD_MISMATCH'));
  busy=true;assert.equal((await advance()).state,'WAITING_FOR_REPLACEMENT_ELIGIBILITY');busy=false;allow=false;
  await assert.rejects(advance(),isCode('REPLACEMENT_RECIPIENT_ADMISSION_DENIED'));allow=true;
  const signs=x.signatureCount(),puts=x.counts().networkPuts,phases=x.phaseWrites();
  x.f.kernel.loseNextReply();await assert.rejects(advance(),isCode('PUBLICATION_ORIGINAL_CAS_OUTCOME_UNKNOWN'));
  x.f.restart();const prepared=await select();assert.equal(prepared.originalLocalFrames[0].state,'PREPARED');
  x.loseControlWrite();await assert.rejects(advance(prepared),isCode('PUBLICATION_NETWORK_OUTCOME_UNKNOWN'));
  x.f.restart();const attempted=await select();assert.equal(attempted.originalLocalFrames[0].state,'ATTEMPTED');
  const diff=await advance(attempted);assert.equal(diff.state,'ORIGINAL_REPLACEMENT_RECIPIENT_DIFF_PUBLISHED');
  assert.equal((await select()).originalLocalFrames[0].state,'PRESENT');assert.equal(x.signatureCount(),signs+1);
  assert.equal(x.counts().networkPuts,puts+1);assert.equal(x.phaseWrites(),phases);
  assert.deepEqual((await x.realSourceCursor().inspectOriginalHostCursor()).originalT3NextCursor,before);
  assert.deepEqual((await x.realRecipientCursor().inspectOriginalRecipientCursor()).originalT3VerifiedCursor,before);
});


import {createT4OriginalReplacementOwnerRecipientDiffRequest,validateT4OriginalReplacementOwnerRecipientDiffSnapshot} from '../src/network/original-network-replacement-owner-history.mjs';

async function replacementOwnerDiffFixture(){
  const q=await replacementContentFixture({realSourceHistory:true}),{x,c}=q,root=x.session,before=x.sourceCursorBefore;
  const {requiredCryptoSuite,getMode}=x.eligibilityOptions();
  const capture=()=>({schema:'IWXA_T4_ORIGINAL_NATIVE_CAPTURE_SELECTION_V1',state:'ORIGINAL_NATIVE_SESSION_SELECTED',
    ...Object.fromEntries(['workspaceId','originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch'].map(k=>[k,root[k]])),
    networkTargetRef:root.recipientNodeRef,session:root,sourceCursorBefore:before,sourceCursorAfter:x.sourceCursorAfter,
    originalSourceOwnerReadVerified:true,originalCaptureEvidenceVerified:true,originalSourceCursorAdvanced:false,originalNetworkPublished:false,
    originalSubjectMutationInvoked:false,capturedPlaintextReturned:false,createsStore:false,createsScheduler:false});
  let allow=true,historyReads=0,busy=false,mutate=false;
  const opts=request=>({...x.historicalReadOptions(request.ownerNodeRef),request,requiredCryptoSuite,
    verifyOriginalRecipientApplied:async()=>false,verifyOriginalHistoricalNodeSignature:x.historicalSignature(request.ownerNodeRef),
    authorizeOriginalHostWire:async()=>true,authorizeOriginalOwnerHistoryRead:async()=>allow});
  const eligibilityRead=request=>readT4OriginalReplacementOwnerEligibility({...opts(request),
    originalCursorPort:request.ownerNodeRef===sourceNodeRef?x.realSourceCursor():x.realRecipientCursor(),
    ...(request.ownerNodeRef===sourceNodeRef?{readOriginalCaptureSelection:async()=>capture()}: {})});
  const carrier={scopeRef,ownerEpoch:c.ownerEpoch,workspaceId:c.workspaceId,originalWriteOwnerRef:owner,getMode};
  const peerContext=nodeRef=>({nodeRef,originalPeerSessionRef:'peer:k83:authenticated',contextEpoch:1,scopeRef,ownerEpoch:c.ownerEpoch,
    originalPeerAuthenticated:true,originalConfidentialChannelVerified:true});
  const server=createT4OriginalReplacementHistoryServer({...carrier,localNodeRef:recipientNodeRef,peerNodeRef:sourceNodeRef,
    readOriginalPeerContext:async()=>peerContext(sourceNodeRef),readOriginalReplacementOwnerHistory:async({request})=>{
      if(request.schema==='IWXA_T4_ORIGINAL_REPLACEMENT_OWNER_ELIGIBILITY_REQUEST_V1')return eligibilityRead(request);
      historyReads++;
      if(busy)return null;
      const v=await readT4OriginalReplacementOwnerHistory(opts(request));
      if(mutate&&v.diff)return {...v,diff:{...v.diff,sha256:'f'.repeat(64),key:'f'.repeat(64)+'.t4n'}};
      return v;
    }});
  const client=createT4OriginalReplacementHistoryClient({...carrier,localNodeRef:sourceNodeRef,peerNodeRef:recipientNodeRef,
    readOriginalPeerContext:async()=>peerContext(recipientNodeRef),invokeOriginalPeerHistory:({requestBytes})=>server(requestBytes)});
  const params={originalCaptureSession:root,sourceCursorBefore:before,requesterNodeRef:sourceNodeRef,getMode,requiredCryptoSuite,
    authorizeOriginalReplacement:async()=>true,readOriginalOwnerEligibility:r=>r.ownerNodeRef===sourceNodeRef?eligibilityRead(r):client(r),
    sourceAdmissionPhasePort:q.phase,sourcePublicationPort:q.sourcePublicationPort,frameDiscoveryPort:x.transport(sourceNodeRef),
    readOriginalRecipientDiffHistory:client,authorizeOriginalReplacementDiffAcceptance:async()=>true};
  const discover=(patch={})=>discoverT4OriginalReplacementRecipientDiff({...params,...patch});
  return {q,x,c,root,before,params,client,discover,historyReads:()=>historyReads,
    setBusy:v=>{busy=v;},setMutate:v=>{mutate=v;},setAllow:v=>{allow=v;}};
}
test('K83 source accepts DIFF via independent local recipient history, never a reciprocal source call',async()=>{
  const f=await replacementOwnerDiffFixture(),{q,x,c,client,discover}=f;
  assert.equal((await discover()).state,'WAITING_FOR_REPLACEMENT_DIFF');assert.equal(f.historyReads(),0);
  const head=(await q.sourcePublicationPort.inspectOriginalPublication()).frames[0];
  const request=createT4OriginalReplacementOwnerRecipientDiffRequest({session:c,requesterNodeRef:sourceNodeRef,ownerNodeRef:recipientNodeRef,
    headWireBase64:Buffer.from(head.wireBytes).toString('base64')});
  assert.equal((await client(request)).state,'WAITING_FOR_RECIPIENT_DIFF_PRESENT');
  await q.diff();
  const beforeCounts={source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()};
  const witness=await client(request);assert.equal(witness.state,'ORIGINAL_RECIPIENT_DIFF_HISTORY_VERIFIED');
  assert.equal(witness.acceptedHead.wireSha256,head.sha256);assert.equal(witness.acceptedHead.originalHistoricalAcceptanceProven,true);
  assert.equal(witness.liveNetworkAuthorityGranted,false);assert.deepEqual({source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()},beforeCounts);
  const direct=await q.current(),selected=await discover();assert.deepEqual(selected,direct);
  f.setBusy(true);assert.equal((await discover()).state,'WAITING_FOR_REPLACEMENT_RECIPIENT_PUBLICATION');f.setBusy(false);
  f.setMutate(true);await assert.rejects(discover(),isCode('REPLACEMENT_SOURCE_DIFF_ORIGINAL_PUBLICATION_MISMATCH'));f.setMutate(false);
  await assert.rejects(discover({recipientPublicationPort:q.recipientPublicationPort}),isCode('REPLACEMENT_SOURCE_DIFF_PORTS_REQUIRED'));
  assert.throws(()=>validateT4OriginalReplacementOwnerRecipientDiffSnapshot({...witness,acceptedHead:{...witness.acceptedHead,originalReplayCheckpointCreated:true}},request),
    isCode('REPLACEMENT_DIFF_HISTORY_PROOF_MISMATCH'));
  f.setAllow(false);await assert.rejects(client(request),isCode('REPLACEMENT_HISTORY_OWNER_READ_DENIED'));f.setAllow(true);
  // The local recipient endpoint does not need network transport or a live signer.
  x.rotateSource();x.rotateRecipient();x.offline();x.f.restart();
  const cold={source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()};
  assert.deepEqual(await client(request),witness);
  assert.deepEqual({source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()},cold);
});


import {advanceT4OriginalReplacementSourceContent} from '../src/network/original-network-session-supersession.mjs';

test('K84 source wake resumes prepared successor content and separately confirms PUBLISHED from the original phase',async()=>{
  const f=await replacementOwnerDiffFixture(),{q,x,c,root,before,params}=f;
  const {requiredCryptoSuite,getMode}=params;
  const select=()=>readT4OriginalLocalReplacementSelection({...x.historicalReadOptions(sourceNodeRef),technicalSchemaId:'iwxa.demo.note',
    sourceWorkspaceId:root.workspaceId,originalWriteOwnerRef:owner,sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch:root.ownerEpoch,
    sourceCursorBefore:before,readOriginalCurrentCursor:async()=>(await x.realSourceCursor().inspectOriginalHostCursor()).originalT3NextCursor,
    requiredCryptoSuite,verifyOriginalHistoricalNodeSignature:x.historicalSignature(sourceNodeRef),verifyOriginalRecipientApplied:async()=>false});
  const phase=()=>createT4OriginalReplacementHistoricalPhasePort({...x.historicalReadOptions(sourceNodeRef),session:c,verifyOriginalRecipientApplied:async()=>false});
  const advance=async(selection,patch={})=>advanceT4OriginalReplacementSourceContent({...params,selection:selection??await select(),
    sourceAdmissionPhasePort:phase(),task:x.task,resolveOriginalSigningContext:q.params.resolveOriginalSigningContext,
    signOriginalNodeBytes:q.params.signOriginalNodeBytes,authorizeOriginalSealedContent:q.params.authorizeOriginalSealedContent,
    readOriginalSealedContent:q.params.readOriginalSealedContent,createOriginalReplacementContentPublicationPort:q.params.createOriginalReplacementContentPublicationPort,
    createOriginalReplacementSourceContentPhasePort:async({session,admission},readOriginalReplacementSourceContentPublication)=>x.sourcePhase({
      sessionRef:session.sessionRef,authorizeOriginalSourceSupersession:null,replacementSourceAdmission:admission,
      readOriginalReplacementSourceAdmission:async()=>assert.fail('INTENT must not be rewritten'),readOriginalReplacementSourceContentPublication}),...patch});
  const initial=await select();assert.equal(initial.originalLocalPhase,'INTENT');
  assert.equal((await advance(initial)).state,'WAITING_FOR_REPLACEMENT_CONTENT_AGREEMENT');
  assert.equal(q.seals(),0);await q.diff();
  const counts={sourcePhase:x.sourcePhaseWrites(),recipientPhase:x.phaseWrites(),signs:x.signatureCount(),puts:x.counts().networkPuts};
  f.setBusy(true);assert.equal((await advance()).state,'WAITING_FOR_REPLACEMENT_CONTENT_AGREEMENT');f.setBusy(false);
  const stale=structuredClone(initial);stale.originalLocalPublicationRevision++;
  await assert.rejects(advance(stale),isCode('REPLACEMENT_HOST_SOURCE_CONTENT_SELECTION_CHANGED'));
  await assert.rejects(advance(null,{task:{...x.task,sourceCursorBefore:x.sourceCursorAfter}}));
  assert.equal(q.seals(),0);
  x.sourceStore.loseNextReply();await assert.rejects(advance(),isCode('PUBLICATION_ORIGINAL_CAS_OUTCOME_UNKNOWN'));
  x.f.restart();const prepared=await select();assert.deepEqual(prepared.originalLocalFrames.map(f=>f.state),['PRESENT','PREPARED','PREPARED','PREPARED']);
  assert.equal(q.seals(),1);assert.equal(x.signatureCount(),counts.signs+3);assert.equal(x.counts().networkPuts,counts.puts);
  x.loseControlWrite();await assert.rejects(advance(prepared),isCode('PUBLICATION_NETWORK_OUTCOME_UNKNOWN'));
  x.f.restart();const attempted=await select();assert.equal(attempted.originalLocalFrames[1].state,'ATTEMPTED');
  const content=await advance(attempted);assert.equal(content.state,'ORIGINAL_REPLACEMENT_CONTENT_PRESENT');assert.equal(content.originalSignedBatchReused,true);
  assert.equal(q.seals(),1);assert.equal(x.signatureCount(),counts.signs+3);assert.equal(x.counts().networkPuts,counts.puts+3);
  const present=await select();assert.ok(present.originalLocalFrames.every(f=>f.state==='PRESENT'));assert.equal(present.originalLocalPhase,'INTENT');
  x.sourceStore.loseNextReply();await assert.rejects(advance(present),isCode('PHASE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  x.f.restart();const published=await select();assert.equal(published.originalLocalPhase,'PUBLISHED');assert.equal(published.originalLocalPhaseRevision,2);
  assert.equal((await phase().inspectOriginalSession()).sourcePublishedEvidence.evidenceRef,present.originalLocalFrames[1].sha256+'.t4n');
  await assert.rejects(advance(published),isCode('REPLACEMENT_HOST_SOURCE_CONTENT_SELECTION_INVALID'));
  assert.equal(q.seals(),1);assert.equal(x.signatureCount(),counts.signs+3);assert.equal(x.counts().networkPuts,counts.puts+3);
  assert.equal(x.sourcePhaseWrites(),counts.sourcePhase+1);assert.equal(x.phaseWrites(),counts.recipientPhase);
  assert.deepEqual((await x.realSourceCursor().inspectOriginalHostCursor()).originalT3NextCursor,before);
  assert.deepEqual((await x.realRecipientCursor().inspectOriginalRecipientCursor()).originalT3VerifiedCursor,before);
});


import {createT4OriginalReplacementOwnerSourceContentRequest,validateT4OriginalReplacementOwnerSourceContentSnapshot} from '../src/network/original-network-replacement-owner-history.mjs';

test('K85 recipient verifies PUBLISHED via independent source owner history and still requires exact live frames',async()=>{
  const q=await replacementRecipientFixture({realSourceHistory:true}),{x,c}=q,root=x.session,before=x.sourceCursorBefore;
  const {requiredCryptoSuite,getMode}=x.eligibilityOptions();
  const capture=()=>({schema:'IWXA_T4_ORIGINAL_NATIVE_CAPTURE_SELECTION_V1',state:'ORIGINAL_NATIVE_SESSION_SELECTED',
    ...Object.fromEntries(['workspaceId','originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch'].map(k=>[k,root[k]])),
    networkTargetRef:root.recipientNodeRef,session:root,sourceCursorBefore:before,sourceCursorAfter:x.sourceCursorAfter,
    originalSourceOwnerReadVerified:true,originalCaptureEvidenceVerified:true,originalSourceCursorAdvanced:false,originalNetworkPublished:false,
    originalSubjectMutationInvoked:false,capturedPlaintextReturned:false,createsStore:false,createsScheduler:false});
  let allowed=true,busy=false,mutate=false;
  const opts=request=>({...x.historicalReadOptions(request.ownerNodeRef),request,requiredCryptoSuite,
    verifyOriginalRecipientApplied:async()=>false,verifyOriginalHistoricalNodeSignature:x.historicalSignature(request.ownerNodeRef),
    authorizeOriginalHostWire:async()=>true,authorizeOriginalOwnerHistoryRead:async()=>allowed});
  const eligibilityRead=request=>readT4OriginalReplacementOwnerEligibility({...opts(request),
    originalCursorPort:request.ownerNodeRef===sourceNodeRef?x.realSourceCursor():x.realRecipientCursor(),
    ...(request.ownerNodeRef===sourceNodeRef?{readOriginalCaptureSelection:async()=>capture()}: {})});
  const carrier={scopeRef,ownerEpoch:c.ownerEpoch,workspaceId:c.workspaceId,originalWriteOwnerRef:owner,getMode};
  const peerContext=nodeRef=>({nodeRef,originalPeerSessionRef:'peer:k85:authenticated',contextEpoch:1,scopeRef,ownerEpoch:c.ownerEpoch,
    originalPeerAuthenticated:true,originalConfidentialChannelVerified:true});
  const server=createT4OriginalReplacementHistoryServer({...carrier,localNodeRef:sourceNodeRef,peerNodeRef:recipientNodeRef,
    readOriginalPeerContext:async()=>peerContext(recipientNodeRef),readOriginalReplacementOwnerHistory:async({request})=>{
      if(request.schema==='IWXA_T4_ORIGINAL_REPLACEMENT_OWNER_ELIGIBILITY_REQUEST_V1')return eligibilityRead(request);
      if(busy)return null;
      const v=await readT4OriginalReplacementOwnerHistory(opts(request));
      if(mutate&&v.publication){const changed=structuredClone(v);changed.publication.frames[2].sha256='f'.repeat(64);changed.publication.frames[2].key='f'.repeat(64)+'.t4n';return changed;}
      return v;
    }});
  const client=createT4OriginalReplacementHistoryClient({...carrier,localNodeRef:recipientNodeRef,peerNodeRef:sourceNodeRef,
    readOriginalPeerContext:async()=>peerContext(sourceNodeRef),invokeOriginalPeerHistory:({requestBytes})=>server(requestBytes)});
  const discover=(patch={})=>q.discover({originalReplacementSourcePublicationPort:null,readOriginalReplacementDiffAcceptance:null,
    readOriginalSourceContentHistory:client,readOriginalOwnerEligibility:r=>r.ownerNodeRef===recipientNodeRef?eligibilityRead(r):client(r),
    authorizeOriginalReplacement:async()=>true,getMode,...patch});
  assert.equal((await discover()).state,'WAITING_FOR_ORIGINAL_PUBLICATION');
  await q.diff();
  const slot=(await q.recipientPublicationPort.inspectOriginalPublication()).frames[0];
  const request=createT4OriginalReplacementOwnerSourceContentRequest({session:c,requesterNodeRef:recipientNodeRef,ownerNodeRef:sourceNodeRef,
    diffWireBase64:Buffer.from(slot.wireBytes).toString('base64')});
  assert.equal((await client(request)).state,'WAITING_FOR_SOURCE_PUBLISHED');
  await q.publish();
  assert.equal((await discover()).state,'WAITING_FOR_ORIGINAL_PUBLICATION');
  const phase=x.sourcePhase({sessionRef:c.sessionRef,authorizeOriginalSourceSupersession:null,
    replacementSourceAdmission:q.phase.originalReplacementSourceAdmission,readOriginalReplacementSourceAdmission:async()=>true,
    readOriginalReplacementSourceContentPublication:()=>q.source.readOriginalReplacementPublishedContent()});
  await confirmT4OriginalReplacementSourcePublication({sourceAdmissionPhasePort:phase,sourcePublicationPort:q.source,getMode});
  const beforeCounts={source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()};
  const witness=await client(request);assert.equal(witness.state,'ORIGINAL_SOURCE_CONTENT_HISTORY_VERIFIED');
  assert.equal(witness.acceptedDiff.wireSha256,slot.sha256);assert.equal(witness.phase.currentPhase,'PUBLISHED');
  assert.ok(witness.publication.frames.every(f=>!Object.hasOwn(f,'wireBytes')));
  assert.deepEqual({source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()},beforeCounts);
  const found=await discover(),legacy=await q.discover();
  assert.equal(found.state,'CONTENT_VERIFIED');assert.deepEqual(found.originalReplacementContentEvidence,legacy.originalReplacementContentEvidence);
  assert.deepEqual(found.originalReplacementSourcePublishedPhase,await phase.inspectOriginalSession());
  busy=true;assert.equal((await discover()).state,'WAITING_FOR_ORIGINAL_PUBLICATION');busy=false;
  mutate=true;await assert.rejects(discover(),isCode('SUBJECT_ORIGINAL_REPLACEMENT_PUBLICATION_MISMATCH'));mutate=false;
  assert.throws(()=>validateT4OriginalReplacementOwnerSourceContentSnapshot({...witness,acceptedDiff:{...witness.acceptedDiff,originalReplayCheckpointCreated:true}},request),
    isCode('REPLACEMENT_CONTENT_HISTORY_DIFF_MISMATCH'));
  await assert.rejects(discover({originalReplacementSourcePublicationPort:q.source}),isCode('SUBJECT_ORIGINAL_REPLACEMENT_CONTENT_PORTS_REQUIRED'));
  allowed=false;await assert.rejects(client(request),isCode('REPLACEMENT_HISTORY_OWNER_READ_DENIED'));allowed=true;
  x.rotateSource();x.rotateRecipient();x.offline();x.f.restart();
  const cold={source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()};
  assert.deepEqual(await client(request),witness);
  assert.deepEqual({source:x.sourceStore.calls,recipient:x.f.kernel.calls,signs:x.signatureCount(),...x.counts()},cold);
});


test('K86 K87 K88 K89 original tasks recover one business write, confirm ACK and commit both original cursors',async()=>{
  const q=await replacementRecipientFixture({realSourceHistory:true,canonicalCapture:true}),{x,c}=q,root=x.session,before=x.sourceCursorBefore;
  const {getMode,requiredCryptoSuite}=x.eligibilityOptions();
  await q.diff();
  const phase=x.sourcePhase({sessionRef:c.sessionRef,authorizeOriginalSourceSupersession:null,
    replacementSourceAdmission:q.phase.originalReplacementSourceAdmission,readOriginalReplacementSourceAdmission:async()=>true,
    readOriginalReplacementSourceContentPublication:()=>q.source.readOriginalReplacementPublishedContent()});
  const sourceSelection=()=>({schema:'IWXA_T4_ORIGINAL_NATIVE_CAPTURE_SELECTION_V1',state:'ORIGINAL_NATIVE_SESSION_SELECTED',
    ...Object.fromEntries(['workspaceId','originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch'].map(k=>[k,root[k]])),
    networkTargetRef:root.recipientNodeRef,session:root,sourceCursorBefore:before,sourceCursorAfter:x.sourceCursorAfter,
    originalSourceOwnerReadVerified:true,originalCaptureEvidenceVerified:true,originalSourceCursorAdvanced:false,originalNetworkPublished:false,
    originalSubjectMutationInvoked:false,capturedPlaintextReturned:false,createsStore:false,createsScheduler:false});
  let busy=false,allowed=true,opens=0,writes=0,allowBusiness=false,loseSubjectReply=true;
  const originalKernel=x.f.kernel.kernel,baseHas=originalKernel.hasOperation;let subjectWrites=0;
  originalKernel.hasOperation=op=>op==='t1.commitObjectGraph'||baseHas(op);
  const delta=x.task.capture.prepared.delta;
  x.f.kernel.objects.set(delta.workspaceId+':'+delta.objectId,{object:{workspace_id:delta.workspaceId,object_id:delta.objectId,
    revision:delta.baseRevision,schema_id:delta.schemaId,schema_version:delta.schemaVersion,deleted:false,data:{title:'before'},extensions:{}},
    relations:{outgoing:[],incoming:[]}});
  originalKernel.commitObjectGraph=async input=>{subjectWrites++;assert.equal(input.idempotency_key,'t4-object-'+c.capturedSha256);
    const receipt=await originalKernel.putObject({workspace_id:input.workspace_id,...input.object,event:input.event});
    if(loseSubjectReply){loseSubjectReply=false;throw Object.assign(Error('lost subject response'),{code:'ACK_LOST'});}
    return {...receipt,transaction_id:'txn:k87:one',workspace_id:input.workspace_id};};
  const verifyApplied=async proof=>{const row=await originalKernel.getObject(delta.workspaceId,delta.objectId),events=await originalKernel.listEventsSince(delta.workspaceId);
    return row?.object?.revision===delta.sourceRevision&&JSON.stringify(row.object.data)===JSON.stringify(delta.data)&&
      events.some(e=>e.event_id===proof.originalRecipientEventId&&e.revision===proof.originalRecipientRevision&&
        e.payload.originalContentDigest===proof.originalRecipientStateDigest);};
  const opts=request=>({...x.historicalReadOptions(request.ownerNodeRef),request,requiredCryptoSuite,
    verifyOriginalRecipientApplied:async()=>false,verifyOriginalHistoricalNodeSignature:x.historicalSignature(request.ownerNodeRef),
    authorizeOriginalHostWire:async()=>true,authorizeOriginalOwnerHistoryRead:async()=>true});
  const readOriginalOwnerEligibility=request=>readT4OriginalReplacementOwnerEligibility({...opts(request),
    originalCursorPort:request.ownerNodeRef===sourceNodeRef?x.realSourceCursor():x.realRecipientCursor(),
    ...(request.ownerNodeRef===sourceNodeRef?{readOriginalCaptureSelection:async()=>sourceSelection()}: {})});
  const cursor=x.realRecipientCursor(),history=x.historicalReadOptions(recipientNodeRef);
  const select=()=>readT4OriginalLocalReplacementSelection({...history,technicalSchemaId:'iwxa.demo.note',sourceWorkspaceId:root.workspaceId,
    originalWriteOwnerRef:owner,sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch:c.ownerEpoch,sourceCursorBefore:before,
    readOriginalCurrentCursor:()=>cursor.readOriginalVerifiedCursor(),requiredCryptoSuite,verifyOriginalHistoricalNodeSignature:x.historicalSignature(recipientNodeRef),
    verifyOriginalRecipientApplied:verifyApplied});
  const context=async node=>({...await x.historicalReadOptions(node).readOriginalHostContext(),workspaceId:c.workspaceId});
  const dispatcher=()=>createT4OriginalHostRecipientDispatcher({workspaceId:c.workspaceId,originalWriteOwnerRef:owner,sourceNodeRef,recipientNodeRef,
    scopeRef,ownerEpoch:c.ownerEpoch,getMode,originalKernel:x.f.kernel.kernel,originalRecipientCursorPort:cursor,
    readOriginalHostContext:()=>context(recipientNodeRef),authorizeOriginalHostTask:async()=>true,authorizeOriginalRead:async()=>true,
    authorizeOriginalWrite:async()=>{writes++;return allowBusiness;},authorizeNetworkReceive:async()=>true,
    verifyOriginalSourceEvent:async p=>p.sourceEventId===delta.sourceEventId&&p.sourceEventDigest===delta.sourceEventDigest});
  const makePhase=(a,read,ack)=>x.f.port({sessionRef:c.sessionRef,changeId:c.changeId,authorizeOriginalRecipientSupersession:null,
    replacementRecipientAdmission:a,readOriginalReplacementRecipientApplyAdmission:read,readOriginalReplacementRecipientAckPublication:ack??null,
    verifyOriginalRecipientApplied:verifyApplied,verifyOriginalPhaseEvidence:async proof=>
      proof.phase==='RECEIVED'?proof.evidence.evidenceRef===a.contentEvidence.frames[2].key:
        proof.phase==='VERIFIED'?proof.evidence.evidenceDigest===a.originalStateDigest:
          proof.phase==='APPLY_INTENT'?proof.evidence.evidenceDigest==='sha256:'+c.capturedSha256:proof.phase==='APPLIED'});
  const options={requiredCryptoSuite,frameDiscoveryPort:x.transport(recipientNodeRef),recipientPublicationPort:q.recipientPublicationPort,
    authorizeOriginalRecipientSession:async()=>true,readOriginalSourceContentHistory:request=>busy?null:readT4OriginalReplacementOwnerHistory(opts(request)),
    readOriginalOwnerEligibility,authorizeOriginalReplacement:async()=>true,readOriginalSourceHostContext:()=>context(sourceNodeRef),
    authorizeOriginalSourceRead:async()=>true,readOriginalSourceEvents:x.readOriginalEvents,
    verifyOriginalSourceSubject:async p=>p.originalSourceEventId===c.sourceEventId&&p.originalEventDigest===c.sourceEventDigest,
    authorizeOriginalSealedOpen:async()=>true,verifyOriginalSourceBinding:async p=>p.originalSourceHeadProof.originalEventDigest===c.sourceEventDigest,
    bindOriginalReplacementRecipientContentEvidence:read=>async proof=>{const e=await read(proof);assert.equal(e.candidate.sessionRef,c.sessionRef);opens++;
      return {authenticated:true,plaintext:new Uint8Array(x.task.capture.prepared.bytes),originalVaultUsed:true,originalCapturedBytesVerified:true,originalBusinessApplied:false};},
    authorizeOriginalReplacementRecipientApplyAdmission:async()=>allowed,createOriginalReplacementRecipientPhasePort:({admission},read,ack)=>makePhase(admission,read,ack)};
  let task=dispatcher();const advance=async(patch={})=>task.runNativeReplacementStep({...options,selection:await select(),...patch});
  assert.equal((await advance()).state,'WAITING_FOR_REPLACEMENT_RECIPIENT_CONTENT');assert.equal(opens,0);
  await q.publish();await confirmT4OriginalReplacementSourcePublication({sourceAdmissionPhasePort:phase,sourcePublicationPort:q.source,getMode});
  busy=true;assert.equal((await advance()).state,'WAITING_FOR_REPLACEMENT_RECIPIENT_CONTENT');busy=false;
  const phaseWrites=x.phaseWrites();allowed=false;await assert.rejects(advance(),isCode('SUBJECT_ORIGINAL_REPLACEMENT_APPLY_ADMISSION_DENIED'));
  assert.equal(x.phaseWrites(),phaseWrites);allowed=true;
  const received=await advance();assert.equal(received.state,'ORIGINAL_REPLACEMENT_RECIPIENT_RECEIVED');
  assert.equal(received.originalSubjectMutationInvoked,false);assert.equal((await select()).originalLocalPhase,'RECEIVED');
  task.dispose();x.f.restart();task=dispatcher();
  const verified=await advance();assert.equal(verified.state,'ORIGINAL_REPLACEMENT_RECIPIENT_VERIFIED');
  assert.equal((await select()).originalLocalPhase,'VERIFIED');assert.equal(verified.originalSubjectMutationInvoked,false);
  assert.equal(x.phaseWrites(),phaseWrites+2);assert.equal(writes,0);assert.deepEqual(await cursor.readOriginalVerifiedCursor(),before);
  assert.ok(opens>=2);
  // K88: the source's own task reads the recipient's terminal history via
  // the actual authenticated carrier codec, without reciprocal source calls.
  const carrier={scopeRef,ownerEpoch:c.ownerEpoch,workspaceId:c.workspaceId,originalWriteOwnerRef:owner,getMode};
  const peerContext=nodeRef=>({nodeRef,originalPeerSessionRef:'peer:k88:authenticated',contextEpoch:1,scopeRef,ownerEpoch:c.ownerEpoch,
    originalPeerAuthenticated:true,originalConfidentialChannelVerified:true});
  let peerBusy=false,ackAllowed=true,forgeDiffAnchor=false,terminalReads=0;
  const server=createT4OriginalReplacementHistoryServer({...carrier,localNodeRef:recipientNodeRef,peerNodeRef:sourceNodeRef,
    readOriginalPeerContext:async()=>peerContext(sourceNodeRef),readOriginalReplacementOwnerHistory:async({request})=>{
      assert.equal(request.ownerNodeRef,recipientNodeRef);
      if(request.schema==='IWXA_T4_ORIGINAL_REPLACEMENT_OWNER_ELIGIBILITY_REQUEST_V1')return readOriginalOwnerEligibility(request);
      if(request.schema==='IWXA_T4_ORIGINAL_REPLACEMENT_OWNER_HISTORY_REQUEST_V1'){
        terminalReads++;if(peerBusy)return null;
      }
      const result=await readT4OriginalReplacementOwnerHistory({...opts(request),verifyOriginalRecipientApplied:verifyApplied});
      if(forgeDiffAnchor&&result.state==='ORIGINAL_OWNER_TERMINAL_HISTORY_VERIFIED'){
        const v=structuredClone(result);v.publication.frames[0].originalPresentEventId='event:k88:wrong-diff';return v;
      }
      return result;
    }});
  const client=createT4OriginalReplacementHistoryClient({...carrier,localNodeRef:sourceNodeRef,peerNodeRef:recipientNodeRef,
    readOriginalPeerContext:async()=>peerContext(recipientNodeRef),invokeOriginalPeerHistory:({requestBytes})=>server(requestBytes)});
  const sourceHistory=x.historicalReadOptions(sourceNodeRef),sourceCursor=x.realSourceCursor();
  const historicalPhase=()=>createT4OriginalReplacementHistoricalPhasePort({...sourceHistory,session:c,verifyOriginalRecipientApplied:verifyApplied});
  const selectSource=()=>readT4OriginalLocalReplacementSelection({...sourceHistory,technicalSchemaId:'iwxa.demo.note',sourceWorkspaceId:root.workspaceId,
    originalWriteOwnerRef:owner,sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch:c.ownerEpoch,sourceCursorBefore:before,
    readOriginalCurrentCursor:async()=>(await sourceCursor.inspectOriginalHostCursor()).originalT3NextCursor,
    requiredCryptoSuite,verifyOriginalHistoricalNodeSignature:x.historicalSignature(sourceNodeRef),verifyOriginalRecipientApplied:verifyApplied});
  const sourceEligibility={originalCaptureSession:root,sourceCursorBefore:before,requesterNodeRef:sourceNodeRef,getMode,requiredCryptoSuite,
    authorizeOriginalReplacement:async()=>true,readOriginalOwnerEligibility:r=>r.ownerNodeRef===sourceNodeRef?readOriginalOwnerEligibility(r):client(r)};
  const readDiff=()=>discoverT4OriginalReplacementRecipientDiff({...sourceEligibility,sourceAdmissionPhasePort:historicalPhase(),
    sourcePublicationPort:q.sourcePublicationPort,frameDiscoveryPort:x.transport(sourceNodeRef),readOriginalRecipientDiffHistory:client,
    authorizeOriginalReplacementDiffAcceptance:async()=>true});
  const contentPublication=await x.createReplacementPort({session:c},()=>recoverT4OriginalReplacementEligibility(sourceEligibility),{
    readOriginalReplacementDiffAcceptance:readDiff,authorizeOriginalSealedPublication:async()=>assert.fail('ACK cannot seal')});
  const finishSource=async()=>advanceT4OriginalReplacementSourceAck({selection:await selectSource(),sourceAdmissionPhasePort:historicalPhase(),
    sourcePublicationPort:contentPublication,frameDiscoveryPort:x.transport(sourceNodeRef),requiredCryptoSuite,getMode,
    readOriginalRecipientTerminalHistory:client,authorizeOriginalReplacementSourceAckConfirmation:async()=>ackAllowed,
    createOriginalReplacementSourceAckPhasePort:async({session,admission},readOriginalReplacementSourceAckEvidence)=>
      x.sourcePhase({sessionRef:session.sessionRef,authorizeOriginalSourceSupersession:null,replacementSourceAdmission:admission,
        readOriginalReplacementSourceAdmission:async()=>assert.fail('no new source admission'),readOriginalReplacementSourceAckEvidence})});
  assert.equal((await finishSource()).state,'WAITING_FOR_REPLACEMENT_SOURCE_ACK');assert.equal(terminalReads,0);
  // K87: use the same original task and phase ledger for business apply and
  // signed ACK. Only the Kernel implementation and open callback are fixtures.
  const signs=x.signatureCount(),puts=x.counts().networkPuts;
  const applyOptions={enableOriginalReplacementApply:true,resolveOriginalSigningContext:async()=>x.recipientSigner(),signOriginalNodeBytes:x.signRecipientAck,
    createOriginalReplacementRecipientAckPublicationPort:({session},readOriginalReplacementAppliedAckAdmission)=>
      x.createReplacementRecipientPort({session},()=>readT4OriginalReplacementRecipientAdmission(x.recipientAdmissionOptions(phase)),{readOriginalReplacementAppliedAckAdmission})};
  allowBusiness=true;
  await assert.rejects(advance(applyOptions),isCode('SUBJECT_ORIGINAL_APPLY_OUTCOME_UNKNOWN'));
  assert.equal(subjectWrites,1);assert.equal((await select()).originalLocalPhase,'APPLY_INTENT');
  assert.equal(x.signatureCount(),signs);assert.equal(x.counts().networkPuts,puts);
  task.dispose();x.f.restart();task=dispatcher();
  // Lose the ACK publication response, then prove the already signed bytes.
  x.loseControlWrite();await assert.rejects(advance(applyOptions),isCode('PUBLICATION_NETWORK_OUTCOME_UNKNOWN'));
  assert.equal(subjectWrites,1);assert.equal(x.signatureCount(),signs+1);assert.equal(x.counts().networkPuts,puts+1);
  assert.equal((await finishSource()).state,'WAITING_FOR_REPLACEMENT_SOURCE_ACK');assert.equal(terminalReads,0);
  const pending=await client(createT4OriginalReplacementOwnerHistoryRequest({session:c,requesterNodeRef:sourceNodeRef,ownerNodeRef:recipientNodeRef}));
  assert.equal(pending.state,'WAITING_FOR_LOCAL_TERMINAL_PHASE');
  task.dispose();x.f.restart();task=dispatcher();
  const applied=await advance(applyOptions);assert.equal(applied.state,'ORIGINAL_REPLACEMENT_RECIPIENT_APPLIED');
  assert.equal(applied.originalSubjectMutationInvoked,false);assert.equal(applied.originalRecipientApplied,true);
  assert.equal((await select()).originalLocalPhase,'APPLIED');assert.equal(subjectWrites,1);
  assert.equal(x.signatureCount(),signs+1);assert.equal(x.counts().networkPuts,puts+1);
  const sourceWrites=x.sourcePhaseWrites();
  peerBusy=true;assert.equal((await finishSource()).state,'WAITING_FOR_REPLACEMENT_SOURCE_ACK');peerBusy=false;
  forgeDiffAnchor=true;await assert.rejects(finishSource(),isCode('PUBLICATION_ORIGINAL_REPLACEMENT_HISTORICAL_ACK_NOT_PROVEN'));forgeDiffAnchor=false;
  ackAllowed=false;await assert.rejects(finishSource(),isCode('REPLACEMENT_SOURCE_ACK_CONFIRMATION_DENIED'));ackAllowed=true;
  assert.equal(x.sourcePhaseWrites(),sourceWrites);x.allowSourceApplied();
  const confirmed=await finishSource();assert.equal(confirmed.state,'ORIGINAL_REPLACEMENT_SOURCE_ACK_CONFIRMED');
  assert.equal(confirmed.originalHostCursorCommitStillRequired,true);assert.equal(confirmed.originalSubjectMutationInvoked,false);
  assert.equal((await selectSource()).originalLocalPhase,'APPLIED_CONFIRMED');assert.equal(x.sourcePhaseWrites(),sourceWrites+1);
  assert.equal(subjectWrites,1);assert.equal(x.signatureCount(),signs+1);assert.equal(x.counts().networkPuts,puts+1);
  assert.deepEqual((await sourceCursor.inspectOriginalHostCursor()).originalT3NextCursor,before);
  assert.deepEqual(await cursor.readOriginalVerifiedCursor(),before);
  // K89: finish through the pre-existing original cursor CAS ports. Both
  // owners use independent terminal history; no live wire/key is needed.
  const sourceServer=createT4OriginalReplacementHistoryServer({...carrier,localNodeRef:sourceNodeRef,peerNodeRef:recipientNodeRef,
    readOriginalPeerContext:async()=>peerContext(recipientNodeRef),readOriginalReplacementOwnerHistory:async({request})=>{
      assert.equal(request.ownerNodeRef,sourceNodeRef);
      return readT4OriginalReplacementOwnerHistory({...opts(request),verifyOriginalRecipientApplied:verifyApplied});
    }});
  const recipientClient=createT4OriginalReplacementHistoryClient({...carrier,localNodeRef:recipientNodeRef,peerNodeRef:sourceNodeRef,
    readOriginalPeerContext:async()=>peerContext(sourceNodeRef),invokeOriginalPeerHistory:({requestBytes})=>sourceServer(requestBytes)});
  const terminalArgs=async role=>{
    const source=role==='SOURCE',node=source?sourceNodeRef:recipientNodeRef;
    return {selection:await(source?selectSource():select()),role,originalCursorPort:source?sourceCursor:cursor,
      getMode,requiredCryptoSuite,readOriginalHostContext:()=>context(node),authorizeOriginalHostTask:async()=>true,
      authorizeOriginalHistoricalCursorRecovery:async()=>true,verifyOriginalHistoricalNodeSignature:x.historicalSignature(node),
      authorizeOriginalPeerReplacementHistoryRead:async()=>true,
      readOriginalLocalOwnerHistory:request=>readT4OriginalReplacementOwnerHistory({...opts(request),verifyOriginalRecipientApplied:verifyApplied}),
      readOriginalPeerReplacementHistory:source?client:recipientClient};
  };
  const beforeTerminal={signs:x.signatureCount(),puts:x.counts().networkPuts};
  x.rotateSource();x.rotateRecipient();x.offline();x.f.restart();
  peerBusy=true;
  const waiting=await completeT4OriginalReplacementHostCursor(await terminalArgs('SOURCE'));
  assert.equal(waiting.state,'WAITING_FOR_REPLACEMENT_OWNER_EVIDENCE');
  assert.deepEqual((await sourceCursor.inspectOriginalHostCursor()).originalT3NextCursor,before);peerBusy=false;
  const committedRecipient=await completeT4OriginalReplacementHostCursor(await terminalArgs('RECIPIENT'));
  assert.equal(committedRecipient.state,'ORIGINAL_REPLACEMENT_CURSOR_COMMITTED');assert.equal(committedRecipient.originalRecipientCursorAdvanced,true);
  assert.deepEqual(await cursor.readOriginalVerifiedCursor(),x.sourceCursorAfter);
  assert.deepEqual((await sourceCursor.inspectOriginalHostCursor()).originalT3NextCursor,before);
  x.f.restart();
  const committedSource=await completeT4OriginalReplacementHostCursor(await terminalArgs('SOURCE'));
  assert.equal(committedSource.state,'ORIGINAL_REPLACEMENT_CURSOR_COMMITTED');assert.equal(committedSource.sourceCursorAdvanced,true);
  assert.deepEqual((await sourceCursor.inspectOriginalHostCursor()).originalT3NextCursor,x.sourceCursorAfter);
  assert.deepEqual(await cursor.readOriginalVerifiedCursor(),x.sourceCursorAfter);
  assert.equal(subjectWrites,1);assert.equal(x.signatureCount(),beforeTerminal.signs);assert.equal(x.counts().networkPuts,beforeTerminal.puts);
});

import {validateT4OriginalReplacementDiffAcceptance,readT4OriginalReplacementHandshakeProfile,
  validateT4OriginalReplacementPublishedContent}
  from '../src/network/original-network-publication.mjs';
import {T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION} from '../src/network/standard-network-wire-candidate.mjs';

test('K165 exact successor multipart HEAD, original INTENT and DIFF converge after cold attach without enabling content',async()=>{
  const x=await controlFixture({indexed:true,multipartHandshake:true});await closeInitialAttempt(x);
  const createPhase=async({session:c,admission},readOriginalReplacementSourceAdmission)=>x.sourcePhase({
    sessionRef:c.sessionRef,authorizeOriginalSourceSupersession:null,replacementSourceAdmission:admission,
    readOriginalReplacementSourceAdmission});
  const opts={...x.eligibilityOptions(),enableOriginalMultipartNegotiation:true};
  const admit=()=>admitT4OriginalReplacementSourcePhase({...opts,
    createOriginalReplacementPublicationPort:x.createReplacementPort,createOriginalReplacementSourcePhasePort:createPhase});
  assert.equal((await x.discoverReplacement()).state,'WAITING_FOR_REPLACEMENT_HEAD');
  const head=await x.publishReplacement(),c=head.candidate;
  assert.equal(c.changeKind,'ASSET_PUT');
  assert.equal(head.liveNetworkAuthorityGranted,false);
  const source=await x.createReplacementPort({session:c},()=>x.eligibility());
  const h=(await source.inspectOriginalPublication()).frames[0],frame=decodeT4CandidateFrame(h.wireBytes);
  assert.ok(frame.criticalExtensions.includes(T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION));
  assert.equal(frame.body.replacement.previousSessionRef,x.session.sessionRef);
  const profile=readT4OriginalReplacementHandshakeProfile({candidate:c,headBody:frame.body,
    headSha256:h.sha256,headExtensions:frame.criticalExtensions,enableOriginalMultipartNegotiation:true});
  assert.equal(profile.multipart,true);
  await assert.rejects(x.discoverReplacement({enableOriginalMultipartNegotiation:false}));
  const a=await admit(),phase=await createPhase({session:c,admission:a.admission},async()=>true);
  assert.equal((await phase.inspectOriginalSession()).currentPhase,'INTENT');
  assert.equal(a.admission.headSha256,h.sha256);
  const recipientAdmission=()=>readT4OriginalReplacementRecipientAdmission(x.recipientAdmissionOptions(phase));
  const recipient=await x.createReplacementRecipientPort({session:c},recipientAdmission);
  const discover=patch=>discoverT4OriginalReplacementRecipientDiff({...opts,sourceAdmissionPhasePort:phase,
    sourcePublicationPort:source,recipientPublicationPort:recipient,frameDiscoveryPort:x.transport(sourceNodeRef),
    readOriginalReplacementRecipientAdmission:recipientAdmission,
    authorizeOriginalReplacementDiffAcceptance:async proof=>proof.originalSubjectMutationAllowed===false&&
      /^sha256:[a-f0-9]{64}$/.test(proof.originalMultipartAgreementDigest),...patch});
  assert.equal((await discover()).state,'WAITING_FOR_REPLACEMENT_DIFF');
  const puts=x.counts().networkPuts,signs=x.signatureCount();
  x.denyRecipient();
  await assert.rejects(x.publishReplacementDiff(phase),isCode('REPLACEMENT_RECIPIENT_ADMISSION_DENIED'));
  assert.equal(x.counts().networkPuts,puts);assert.equal(x.signatureCount(),signs);
  x.allowRecipient();
  const diff=await x.publishReplacementDiff(phase);
  assert.equal(diff.liveNetworkAuthorityGranted,false);
  const d=(await recipient.inspectOriginalPublication()).frames[0];
  const decoded=decodeT4CandidateFrame(d.wireBytes);
  assert.deepEqual(decoded.body,profile.diffBody);
  assert.deepEqual(decoded.criticalExtensions,profile.diffExtensions);
  assert.equal(x.counts().networkPuts,puts+1);assert.equal(x.signatureCount(),signs+1);
  const result=await discover();
  assert.equal(result.state,'ORIGINAL_REPLACEMENT_DIFF_VERIFIED');
  assert.equal(result.originalMultipartAgreement.headSha256,h.sha256);
  assert.equal(result.originalMultipartAgreement.diffSha256,d.sha256);
  assert.equal(result.originalMultipartAgreement.originalSubjectAuthorityGranted,false);
  assert.deepEqual(validateT4OriginalReplacementDiffAcceptance(result,c,{enableOriginalMultipartNegotiation:true}),result);
  assert.throws(()=>validateT4OriginalReplacementDiffAcceptance(result,c),isCode('PUBLICATION_REPLACEMENT_HANDSHAKE_PROFILE_MISMATCH'));
  assert.throws(()=>validateT4OriginalReplacementDiffAcceptance({...result,diffSha256:'f'.repeat(64),diffKey:'f'.repeat(64)+'.t4n'},c,
    {enableOriginalMultipartNegotiation:true}),isCode('PUBLICATION_REPLACEMENT_HANDSHAKE_PROFILE_MISMATCH'));
  const noWrites={source:x.sourceStore.calls,recipient:x.f.kernel.calls,puts:x.counts().networkPuts,signs:x.signatureCount()};
  x.f.restart();
  assert.equal((await x.publishReplacement()).publicationState,'ALREADY_PRESENT_VERIFIED');
  assert.equal((await x.publishReplacementDiff(phase)).publicationState,'ALREADY_PRESENT_VERIFIED');
  assert.deepEqual(await discover(),result);
  assert.deepEqual({source:x.sourceStore.calls,recipient:x.f.kernel.calls,puts:x.counts().networkPuts,signs:x.signatureCount()},noWrites);
  // Neither a negotiated handshake nor a compact port can admit content
  // before the successor multipart publication and subject routes exist.
  await assert.rejects(source.prepareSignedBatch({slots:[{sequence:2,messageType:'CHANGE_REF'}],
    createSignedFrames:async()=>assert.fail('content signing')}));
  await assert.rejects(recipient.prepareSignedBatch({slots:[{sequence:2,messageType:'APPLIED_ACK'}],
    createSignedFrames:async()=>assert.fail('ack signing')}));
  await assert.rejects(x.createReplacementPort({session:c},()=>x.eligibility(),{
    readOriginalReplacementDiffAcceptance:()=>discover(),authorizeOriginalSealedPublication:async()=>true}),
    isCode('PUBLICATION_NATIVE_MULTIPART_NEGOTIATION_PORTS_REQUIRED'));
  const compact=await x.createReplacementPort({session:c},()=>x.eligibility(),{
    enableOriginalMultipartNegotiation:false,readOriginalReplacementDiffAcceptance:()=>discover(),authorizeOriginalSealedPublication:async()=>true});
  await assert.rejects(compact.inspectOriginalPublication(),isCode('PUBLICATION_NATIVE_MULTIPART_NEGOTIATION_REQUIRED'));
  x.changeFrontier();await assert.rejects(discover(),isCode('REPLACEMENT_ORIGINAL_CAUSAL_FRONTIER_CHANGED'));x.restoreFrontier();
  // Independently read original history with no network or live signer.
  const historyOptions=request=>({...x.historicalReadOptions(request.ownerNodeRef),request,
    requiredCryptoSuite:opts.requiredCryptoSuite,verifyOriginalRecipientApplied:async()=>false,
    verifyOriginalHistoricalNodeSignature:x.historicalSignature(request.ownerNodeRef),
    authorizeOriginalHostWire:async()=>true,authorizeOriginalOwnerHistoryRead:async()=>true});
  const request=createT4OriginalReplacementOwnerRecipientDiffRequest({session:c,requesterNodeRef:sourceNodeRef,
    ownerNodeRef:recipientNodeRef,headWireBase64:Buffer.from(h.wireBytes).toString('base64')});
  const historical=await readT4OriginalReplacementOwnerHistory(historyOptions(request));
  assert.equal(historical.state,'ORIGINAL_RECIPIENT_DIFF_HISTORY_VERIFIED');
  assert.equal(historical.diff.sha256,d.sha256);
  assert.equal(historical.liveNetworkAuthorityGranted,false);
  x.rotateSource();x.rotateRecipient();x.offline();
  assert.deepEqual(await readT4OriginalReplacementOwnerHistory(historyOptions(request)),historical);
  assert.deepEqual({source:x.sourceStore.calls,recipient:x.f.kernel.calls,puts:x.counts().networkPuts,signs:x.signatureCount()},noWrites);
});

test('K166 a signed compact successor HEAD cannot consume the multipart replay slot',async()=>{
  const x=await controlFixture({indexed:true,multipartHandshake:true});await closeInitialAttempt(x);
  const {candidate:c}=await x.eligibility();
  const body=createT4OriginalReplacementSourceHead({candidate:c,sourceCursorBefore:x.sourceCursorBefore,
    sourceCursorAfter:x.sourceCursorAfter});
  const wrong=await x.signHead(body,c.sessionRef,[T4_REPLACEMENT_SOURCE_SESSION_EXTENSION]);
  await x.transport(sourceNodeRef).publishSignedFrame({wireBytes:wrong});
  const writes=x.f.kernel.calls,puts=x.counts().networkPuts;
  await assert.rejects(x.discoverReplacement(),isCode('WIRE_REPLACEMENT_HANDSHAKE_PROFILE_MISMATCH'));
  assert.equal(x.f.kernel.calls,writes);
  assert.equal(x.counts().networkPuts,puts);
});
test('K166 wrong signed successor DIFF selection is rejected before original replay or acceptance',async()=>{
  const x=await controlFixture({indexed:true,multipartHandshake:true});await closeInitialAttempt(x);
  const head=await x.publishReplacement(),c=head.candidate;
  const createPhase=async({session:s,admission},readOriginalReplacementSourceAdmission)=>x.sourcePhase({
    sessionRef:s.sessionRef,authorizeOriginalSourceSupersession:null,replacementSourceAdmission:admission,
    readOriginalReplacementSourceAdmission});
  const opts={...x.eligibilityOptions(),enableOriginalMultipartNegotiation:true};
  const a=await admitT4OriginalReplacementSourcePhase({...opts,createOriginalReplacementPublicationPort:x.createReplacementPort,
    createOriginalReplacementSourcePhasePort:createPhase});
  const phase=await createPhase({session:c,admission:a.admission},async()=>true);
  const source=await x.createReplacementPort({session:c},()=>x.eligibility());
  const admission=()=>readT4OriginalReplacementRecipientAdmission(x.recipientAdmissionOptions(phase));
  const recipient=await x.createReplacementRecipientPort({session:c},admission);
  const h=decodeT4CandidateFrame((await source.inspectOriginalPublication()).frames[0].wireBytes);
  const wrong=readT4OriginalReplacementHandshakeProfile({candidate:c,headBody:h.body,
    headSha256:'f'.repeat(64),headExtensions:h.criticalExtensions,enableOriginalMultipartNegotiation:true});
  const bytes=await signT4CandidateFrame({unsignedFrame:createT4CandidateUnsignedFrame({messageType:'DIFF_REQUEST',
    messageId:'message:k166:wrong',sourceNodeRef:recipientNodeRef,recipientNodeRef:sourceNodeRef,
    scopeRef,sessionRef:c.sessionRef,ownerEpoch:c.ownerEpoch,sequence:1,cryptoSuite:opts.requiredCryptoSuite,
    ...x.recipientSigner(),criticalExtensions:wrong.diffExtensions,body:wrong.diffBody}),
    signOriginalNodeBytes:x.signRecipientAck});
  await x.transport(recipientNodeRef).publishSignedFrame({wireBytes:bytes});
  const writes=x.sourceStore.calls,puts=x.counts().networkPuts;
  await assert.rejects(discoverT4OriginalReplacementRecipientDiff({...opts,sourceAdmissionPhasePort:phase,
    sourcePublicationPort:source,recipientPublicationPort:recipient,frameDiscoveryPort:x.transport(sourceNodeRef),
    readOriginalReplacementRecipientAdmission:admission,
    authorizeOriginalReplacementDiffAcceptance:async()=>assert.fail('wrong profile must not reach acceptance')}),
    isCode('WIRE_REPLACEMENT_HANDSHAKE_PROFILE_MISMATCH'));
  assert.equal(x.sourceStore.calls,writes);
  assert.equal(x.counts().networkPuts,puts);
});

import {prepareT4CandidateMultipartOpaqueChunks,t4CandidateMultipartChunkSequence}
  from '../src/network/standard-network-multipart-opaque-chunks.mjs';
import {T4_MULTIPART_OPAQUE_EXTENSION} from '../src/network/standard-network-wire-candidate.mjs';

test('K167 K170 K171 K172 K174 K175 successor multipart backing, lost PUT, complete signed batch and terminal history',async()=>{
  const x=await controlFixture({indexed:true,multipartHandshake:true,realSourceHistory:true});await closeInitialAttempt(x);
  const opts={...x.eligibilityOptions(),enableOriginalMultipartNegotiation:true};
  const head=await x.publishReplacement(),c=head.candidate;
  const createPhase=async({session:s,admission},readOriginalReplacementSourceAdmission)=>x.sourcePhase({
    sessionRef:s.sessionRef,authorizeOriginalSourceSupersession:null,replacementSourceAdmission:admission,
    readOriginalReplacementSourceAdmission});
  const a=await admitT4OriginalReplacementSourcePhase({...opts,createOriginalReplacementPublicationPort:x.createReplacementPort,
    createOriginalReplacementSourcePhasePort:createPhase});
  const phase=await createPhase({session:c,admission:a.admission},async()=>true);
  const source=await x.createReplacementPort({session:c},()=>x.eligibility());
  const admission=()=>readT4OriginalReplacementRecipientAdmission(x.recipientAdmissionOptions(phase));
  const recipient=await x.createReplacementRecipientPort({session:c},admission);
  const discover=()=>discoverT4OriginalReplacementRecipientDiff({...opts,sourceAdmissionPhasePort:phase,
    sourcePublicationPort:source,recipientPublicationPort:recipient,frameDiscoveryPort:x.transport(sourceNodeRef),
    readOriginalReplacementRecipientAdmission:admission,authorizeOriginalReplacementDiffAcceptance:async()=>true});
  await x.publishReplacementDiff(phase);
  const accepted=await discover(),agreement=accepted.originalMultipartAgreement,eligibility=await x.eligibility();
  assert.equal(accepted.state,'ORIGINAL_REPLACEMENT_DIFF_VERIFIED');
  let allow=true,allowBacking=true,allowSealed=true,agreementReads=0,admissionReads=0;
  // This isolated original-publication fixture models the original owner
  // authorization callbacks. Their initial witnesses are independently
  // reconstructed above, through actual signed HEAD/DIFF and phase CAS.
  const readOriginalMultipartAgreement=async()=>{agreementReads++;return agreement;};
  const readOriginalReplacementDiffAcceptance=async()=>{admissionReads++;return allow?accepted:null;};
  const ciphertext=new Uint8Array(524289).fill(27),sealedRef='sealed:k167:successor';
  const port=()=>x.createReplacementPort({session:c},async()=>eligibility,{
    frameTransport:x.transport(sourceNodeRef,{readOriginalMultipartAgreement}),
    readOriginalMultipartAgreement,readOriginalReplacementDiffAcceptance,
    authorizeOriginalMultipartBacking:async proof=>allowBacking&&proof.session.sessionRef===c.sessionRef,
    authorizeOriginalSealedPublication:async proof=>allowSealed&&proof.session.sessionRef===c.sessionRef&&
      proof.originalMultipartAgreementDigest===agreement.agreementDigest&&
      Buffer.from(proof.ciphertext).equals(Buffer.from(ciphertext))});
  const p=await port();
  assert.equal(p.originalReplacementMultipartContentPublication,true);
  assert.equal(p.originalReplacementSourceContentPublication,undefined);
  assert.equal(typeof p.readOriginalReplacementPublishedContent,'function');
  const chunks=await prepareT4CandidateMultipartOpaqueChunks({changeId:c.changeId,ownerRef:c.originalWriteOwnerRef,
    sourceContentRef:'asset:k167:one',getMode:opts.getMode,authorizeOriginalSealedContent:async()=>true,
    readOriginalSealedContent:async()=>({ciphertext,encryptionContextRef:sealedRef})});
  const change={changeId:c.changeId,changeKind:c.changeKind,eventRef:c.sourceEventId,ownerRef:c.originalWriteOwnerRef,
    sourceRevision:c.sourceRevision,parents:[c.sourcePrefixDigestBefore],contentDigest:chunks.manifest.contentDigest,
    multipartManifest:chunks.manifest};
  const signer=await x.resolveSourceContentSigner();
  const make=async(messageType,sequence,body)=>signT4CandidateFrame({unsignedFrame:createT4CandidateUnsignedFrame({
    messageType,sequence,messageId:'message:k167:'+sequence,sourceNodeRef,recipientNodeRef,scopeRef,
    ownerEpoch:c.ownerEpoch,sessionRef:c.sessionRef,cryptoSuite:opts.requiredCryptoSuite,...signer,
    criticalExtensions:[T4_MULTIPART_OPAQUE_EXTENSION],body}),signOriginalNodeBytes:x.signSourceContent});
  const wireBytes=[await make('CHANGE_REF',2,change),
    ...await Promise.all(chunks.bodies.map(b=>make('CHUNK',t4CandidateMultipartChunkSequence(b),b)))];
  const counts=()=>({source:x.sourceStore.calls,recipient:x.f.kernel.calls,puts:x.counts().networkPuts,signs:x.signatureCount()});
  const initial=counts();
  allow=false;await assert.rejects(p.prepareOriginalMultipartBacking({wireBytes}),isCode('PUBLICATION_ORIGINAL_REPLACEMENT_DIFF_ACCEPTANCE_REQUIRED'));
  allow=true;allowBacking=false;await assert.rejects(p.prepareOriginalMultipartBacking({wireBytes}),isCode('PUBLICATION_MULTIPART_ORIGINAL_AUTHORITY_DENIED'));
  allowBacking=true;allowSealed=false;await assert.rejects(p.prepareOriginalMultipartBacking({wireBytes}),isCode('PUBLICATION_ORIGINAL_SEALED_AUTHORITY_DENIED'));
  allowSealed=true;assert.deepEqual(counts(),initial);
  const reserved=await p.prepareOriginalMultipartBacking({wireBytes});
  assert.equal(reserved.originalRootReservationVerified,true);
  assert.equal(reserved.originalMultipartAgreementDigest,agreement.agreementDigest);
  assert.equal(reserved.originalPublicationPrepared,false);
  assert.equal(x.counts().networkPuts,initial.puts);
  assert.equal((await source.inspectOriginalPublication({metadataOnly:true})).multipartBackingReserved,true);
  allow=false;const locked=counts();
  await assert.rejects(p.prepareOriginalMultipartPublication(),isCode('PUBLICATION_ORIGINAL_REPLACEMENT_DIFF_ACCEPTANCE_REQUIRED'));
  assert.deepEqual(counts(),locked);allow=true;
  x.f.restart();let cold=await port();
  const prepared=await cold.prepareOriginalMultipartPublication();
  assert.equal(prepared.originalPublicationPrepared,true);
  const phaseFor=()=>x.sourcePhase({sessionRef:c.sessionRef,authorizeOriginalSourceSupersession:null,
    replacementSourceAdmission:a.admission,readOriginalReplacementSourceAdmission:async()=>assert.fail('INTENT must not be rewritten'),
    readOriginalReplacementSourceContentPublication:()=>cold.readOriginalReplacementPublishedContent()});
  const confirm=()=>confirmT4OriginalReplacementSourcePublication({sourceAdmissionPhasePort:phaseFor(),
    sourcePublicationPort:cold,getMode:opts.getMode});
  const phaseWrites=x.sourcePhaseWrites();
  const historyRequest=createT4OriginalReplacementOwnerSourceContentRequest({session:c,requesterNodeRef:recipientNodeRef,
    ownerNodeRef:sourceNodeRef,diffWireBase64:Buffer.from((await recipient.inspectOriginalPublication()).frames[0].wireBytes).toString('base64')});
  const readHistory=()=>readT4OriginalReplacementOwnerHistory({...x.historicalReadOptions(sourceNodeRef),request:historyRequest,
    requiredCryptoSuite:opts.requiredCryptoSuite,verifyOriginalRecipientApplied:async()=>false,
    verifyOriginalHistoricalNodeSignature:x.historicalSignature(sourceNodeRef),authorizeOriginalHostWire:async()=>true,
    authorizeOriginalOwnerHistoryRead:async()=>true});
  assert.equal((await readHistory()).state,'WAITING_FOR_SOURCE_PUBLISHED');
  await assert.rejects(confirm(),isCode('PUBLICATION_OUTBOUND_FRAME_NOT_PRESENT'));
  assert.equal(x.sourcePhaseWrites(),phaseWrites);
  const metadata=await source.inspectOriginalPublication({metadataOnly:true});
  assert.equal(metadata.frames.length,wireBytes.length+1);
  assert.ok(metadata.frames.slice(1).every(f=>f.wireBytes===undefined));
  assert.deepEqual(await discover(),accepted);
  x.loseControlWrite();
  await assert.rejects(cold.publishOriginalMultipartFrames({limit:1}),isCode('PUBLICATION_NETWORK_OUTCOME_UNKNOWN'));
  const sent=x.counts().networkPuts;assert.equal(sent,initial.puts+1);
  x.f.restart();cold=await port();
  const recovered=await cold.publishOriginalMultipartFrames({limit:1});
  assert.equal(recovered.frames[0].state,'REMOTE_READBACK_RECOVERED');
  assert.equal(x.counts().networkPuts,sent);
  allow=false;const blocked=counts();
  await assert.rejects(cold.publishOriginalMultipartFrames({limit:1}),isCode('PUBLICATION_ORIGINAL_REPLACEMENT_DIFF_ACCEPTANCE_REQUIRED'));
  assert.deepEqual(counts(),blocked);allow=true;
  let batch=await cold.publishOriginalMultipartFrames({limit:32});
  while(batch.remaining)batch=await cold.publishOriginalMultipartFrames({limit:32});
  assert.equal(batch.originalAllFramesPresentRecorded,true);
  const saved=await cold.inspectOriginalPublication();
  assert.ok(saved.frames.every(f=>f.state==='PRESENT'));
  assert.deepEqual(saved.frames.slice(1).map(f=>f.wireBytes),wireBytes.map(b=>new Uint8Array(b)));
  assert.equal(x.counts().networkPuts,initial.puts+wireBytes.length);
  assert.equal(x.signatureCount(),initial.signs);
  assert.equal(x.f.kernel.calls,initial.recipient);
  assert.equal((await phase.inspectOriginalSession()).currentPhase,'INTENT');
  assert.ok(agreementReads>wireBytes.length&&admissionReads>wireBytes.length);
  assert.deepEqual(await discover(),accepted);
  const proof=await cold.readOriginalReplacementPublishedContent();
  assert.equal(proof.frames.length,wireBytes.length+1);
  assert.deepEqual(proof.agreement.originalMultipartAgreement,agreement);
  assert.deepEqual(validateT4OriginalReplacementPublishedContent(proof,c),proof);
  for(const alter of [
    p=>p.frames.pop(),
    p=>{delete p.agreement.originalMultipartAgreement;},
    p=>{p.frames[2].verifiedCriticalExtensions=[];},
    p=>{p.frames[2].verifiedBody=structuredClone(p.frames[3].verifiedBody);},
  ]){
    const bad=structuredClone(proof);alter(bad);
    assert.throws(()=>validateT4OriginalReplacementPublishedContent(bad,c));
  }
  allow=false;
  await assert.rejects(confirm(),isCode('PUBLICATION_ORIGINAL_REPLACEMENT_DIFF_ACCEPTANCE_REQUIRED'));
  assert.equal(x.sourcePhaseWrites(),phaseWrites);allow=true;
  const phaseResult=await confirm();
  assert.equal(phaseResult.state,'ORIGINAL_REPLACEMENT_SOURCE_PUBLISHED');
  assert.equal((await phaseFor().inspectOriginalSession()).currentPhase,'PUBLISHED');
  assert.equal(x.sourcePhaseWrites(),phaseWrites+1);
  x.f.restart();cold=await port();
  assert.equal((await confirm()).status,'ALREADY_CONFIRMED');
  assert.equal(x.sourcePhaseWrites(),phaseWrites+1);
  assert.equal(x.signatureCount(),initial.signs);
  assert.equal(x.counts().networkPuts,initial.puts+wireBytes.length);
  const history=await readHistory();
  assert.equal(history.state,'ORIGINAL_SOURCE_CONTENT_HISTORY_VERIFIED');
  assert.equal(history.publication.frames.length,wireBytes.length+1);
  assert.deepEqual(history.publication.multipart,{agreementDigest:agreement.agreementDigest,
    manifestDigest:chunks.manifest.manifestDigest,contentDigest:chunks.manifest.contentDigest});
  assert.ok(history.publication.frames.every(f=>!Object.hasOwn(f,'wireBytes')));
  const bad=structuredClone(history);bad.publication.frames.pop();
  assert.throws(()=>validateT4OriginalReplacementOwnerSourceContentSnapshot(bad,historyRequest));
  const recipientTransport=x.transport(recipientNodeRef,{readOriginalMultipartAgreement});
  const receiveOptions={session:c,frameDiscoveryPort:recipientTransport,requiredCryptoSuite:opts.requiredCryptoSuite,
    requireSourceAnnouncement:true,sourceCursorBefore:x.sourceCursorBefore,authorizeOriginalRecipientSession:async()=>true,
    readOriginalMultipartAgreement,readOriginalReplacementDiffAcceptance:()=>discover(),
    originalReplacementSourcePublicationPort:cold,originalReplacementRecipientPublicationPort:recipient};
  const recipientPhaseWrites=x.phaseWrites();
  const found=await discoverT4OriginalNetworkSessionContent(receiveOptions);
  assert.equal(found.state,'CONTENT_VERIFIED');
  assert.equal(found.originalDecryptionInvoked,false);
  assert.equal(found.originalReplacementContentEvidence.originalMultipartManifestDigest,chunks.manifest.manifestDigest);
  assert.deepEqual(found.originalReplacementContentEvidence.frames,history.publication.frames);
  assert.equal(x.phaseWrites(),recipientPhaseWrites);
  const wrongAnchors=history.publication.frames.map(({sequence,messageType,sha256})=>({sequence,messageType,sha256}));
  wrongAnchors[2].sha256='f'.repeat(64);
  await assert.rejects(recipientTransport.discoverOriginalMultipartContentPage({selector:{sourceNodeRef,sessionRef:c.sessionRef,ownerEpoch:c.ownerEpoch},
    requiredCryptoSuite:opts.requiredCryptoSuite,replacementFrameAnchors:wrongAnchors}),isCode('WIRE_REPLACEMENT_CONTENT_PUBLICATION_ANCHOR_MISMATCH'));
  assert.equal(x.phaseWrites(),recipientPhaseWrites);
  // K174: exercise the original phase and ACK ports; the subject Result is
  // deliberately modeled here, not claimed as a real Asset mutation.
  const e=found.originalReplacementContentEvidence,actualEvent='event:k174:asset:result';
  const applyAdmission={schema:'IWXA_T4_ORIGINAL_REPLACEMENT_RECIPIENT_APPLY_ADMISSION_V1',candidate:c,contentEvidence:e,
    originalSourcePublishedEventId:phaseResult.originalSourcePublishedEventId,originalSourcePublishedChainHash:phaseResult.chainHash,
    originalStateDigest:B,originalCapturedSha256:c.capturedSha256,originalSourcePublishedVerified:true,originalCanonicalSubjectVerified:true,
    originalSubjectMutationInvoked:false,originalBusinessApplied:false,sourceCursorAdvanced:false,recipientCursorAdvanced:false,liveNetworkAuthorityGranted:false};
  const body={changeId:c.changeId,contentDigest:e.contentDigest,recipientEventRef:actualEvent,recipientRevision:c.sourceRevision,
    recipientStateDigest:B,ackRef:'ack:t4:'+createHash('sha256').update(JSON.stringify(['IWXA-T4-ORIGINAL-APPLIED-ACK-V1',c.sessionRef,c.changeId,
      c.capturedSha256,actualEvent,c.sourceRevision,B])).digest('hex')};
  let resultVerified=true,ackPort;
  const peerPhase=()=>x.f.port({sessionRef:c.sessionRef,changeId:c.changeId,recipientApplyIntentRequired:true,
    authorizeOriginalRecipientSupersession:null,verifyOriginalPhaseEvidence:async()=>true,
    verifyOriginalRecipientApplied:async p=>resultVerified&&p.originalRecipientEventId===actualEvent&&p.originalRecipientStateDigest===B,
    replacementRecipientAdmission:applyAdmission,readOriginalReplacementRecipientApplyAdmission:async()=>applyAdmission,
    readOriginalReplacementRecipientAckPublication:readPeerAck});
  async function readAckAdmission(){
    const s=await peerPhase().inspectOriginalSession();
    if(!resultVerified||!['APPLY_INTENT','APPLIED'].includes(s.currentPhase))throw Object.assign(Error('result missing'),{code:'TEST_RECIPIENT_RESULT_MISSING'});
    return {schema:'IWXA_T4_ORIGINAL_REPLACEMENT_APPLIED_ACK_ADMISSION_V1',admission:applyAdmission,body,
      recipientPhaseCheckpointRef:s.checkpointRef,originalApplyIntentEventId:s.originalReplacementRecipientApplyIntentEventId,
      originalRecipientResultVerified:true,originalDurableApplyIntentVerified:true,originalBusinessApplied:true,
      originalSubjectMutationInvoked:false,sourceCursorAdvanced:false,recipientCursorAdvanced:false,liveNetworkAuthorityGranted:false};
  }
  async function readPeerAck(){return {admission:await readAckAdmission(),publication:await ackPort.readOriginalPublishedFrame({sequence:2,includePresentEventAnchor:true})};}
  ackPort=await x.createReplacementRecipientPort({session:c},admission,{readOriginalReplacementAppliedAckAdmission:readAckAdmission});
  const sourceAckArgs={sourceAdmissionPhasePort:phaseFor(),sourcePublicationPort:cold,recipientPhasePort:peerPhase(),
    recipientPublicationPort:ackPort,readOriginalReplacementRecipientAckPublication:readPeerAck,
    frameDiscoveryPort:x.transport(sourceNodeRef,{readOriginalMultipartAgreement}),requiredCryptoSuite:opts.requiredCryptoSuite,getMode:opts.getMode,
    authorizeOriginalReplacementSourceAckConfirmation:async p=>p.originalRecipientResultVerified===true};
  assert.equal(await readT4OriginalReplacementSourceAckEvidence(sourceAckArgs),null);
  await peerPhase().advanceOriginalSessionPhase({phase:'RECEIVED',evidence:{evidenceRef:e.frames[2].key,evidenceDigest:'sha256:'+e.frames[2].sha256}});
  await peerPhase().advanceOriginalSessionPhase({phase:'VERIFIED',evidence:{evidenceRef:e.frames[1].key,evidenceDigest:B}});
  await peerPhase().advanceOriginalSessionPhase({phase:'APPLY_INTENT',evidence:{evidenceRef:e.frames[1].key,evidenceDigest:'sha256:'+c.capturedSha256}});
  const signAck=()=>signT4CandidateFrame({unsignedFrame:createT4CandidateUnsignedFrame({
    messageType:'APPLIED_ACK',messageId:'message:k174:ack',sourceNodeRef:recipientNodeRef,recipientNodeRef:sourceNodeRef,
    scopeRef,sessionRef:c.sessionRef,ownerEpoch:c.ownerEpoch,sequence:2,...x.recipientSigner(),cryptoSuite:opts.requiredCryptoSuite,
    criticalExtensions:[],body}),signOriginalNodeBytes:x.signRecipientAck});
  resultVerified=false;await assert.rejects(ackPort.prepareSignedBatch({slots:[{sequence:2,messageType:'APPLIED_ACK'}],
    createSignedFrames:async()=>assert.fail('missing result must not sign')}),isCode('TEST_RECIPIENT_RESULT_MISSING'));
  resultVerified=true;
  await ackPort.prepareSignedBatch({slots:[{sequence:2,messageType:'APPLIED_ACK'}],createSignedFrames:async()=>[await signAck()]});
  await ackPort.publishPreparedFrame({sequence:2});
  assert.equal(await readT4OriginalReplacementSourceAckEvidence(sourceAckArgs),null);
  const ack=await ackPort.readOriginalPublishedFrame({sequence:2,includePresentEventAnchor:true});
  await peerPhase().advanceOriginalSessionPhase({phase:'APPLIED',evidence:{evidenceRef:ack.key,evidenceDigest:'sha256:'+ack.sha256,
    originalRecipientEventId:actualEvent,originalRecipientRevision:c.sourceRevision,originalRecipientStateDigest:B}});
  const ackEvidence=await readT4OriginalReplacementSourceAckEvidence(sourceAckArgs);
  assert.equal(ackEvidence.originalRecipientResultVerified,true);
  assert.equal(ackEvidence.sourceCursorAdvanced,false);
  assert.equal(ackEvidence.recipientCursorAdvanced,false);
  assert.equal(ackEvidence.recipientAckAdmission.body.recipientEventRef,actualEvent);
  assert.deepEqual(await readHistory(),history);
  const finalPhase=()=>x.sourcePhase({sessionRef:c.sessionRef,authorizeOriginalSourceSupersession:null,
    replacementSourceAdmission:a.admission,readOriginalReplacementSourceAdmission:async()=>true,
    readOriginalReplacementSourceContentPublication:()=>cold.readOriginalReplacementPublishedContent(),
    readOriginalReplacementSourceAckEvidence:()=>readT4OriginalReplacementSourceAckEvidence({...sourceAckArgs,sourceAdmissionPhasePort:finalPhase()})});
  x.allowSourceApplied();
  const final=await confirmT4OriginalReplacementSourceAcknowledgement({...sourceAckArgs,sourceAdmissionPhasePort:finalPhase()});
  assert.equal(final.state,'ORIGINAL_REPLACEMENT_SOURCE_ACK_CONFIRMED');
  assert.equal(final.sourcePhase.currentPhase,'APPLIED_CONFIRMED');
  const ownerHistory=async request=>{
    const node=request.ownerNodeRef;
    const snapshot=await readT4OriginalReplacementOwnerHistory({...x.historicalReadOptions(node),request,
      requiredCryptoSuite:opts.requiredCryptoSuite,verifyOriginalRecipientApplied:node===sourceNodeRef?x.verifySourceApplied:
        async p=>resultVerified&&p.originalRecipientEventId===actualEvent&&p.originalRecipientStateDigest===B,
      verifyOriginalHistoricalNodeSignature:x.historicalSignature(node),authorizeOriginalHostWire:async()=>true,
      authorizeOriginalOwnerHistoryRead:async()=>true});
    const encoded=encodeT4OriginalReplacementHistoryResponse(snapshot,request);
    assert.ok(encoded.length<1024*1024);
    return decodeT4OriginalReplacementHistoryResponse(encoded,request);
  };
  const recover=node=>recoverT4OriginalReplacementTerminalCursorEvidence({session:c,sourceCursorBefore:x.sourceCursorBefore,
    requiredCryptoSuite:opts.requiredCryptoSuite,getMode:opts.getMode,requesterNodeRef:node,readOriginalOwnerHistory:ownerHistory,
    verifyOriginalHistoricalNodeSignature:x.historicalSignature(node),authorizeOriginalHistoricalCursorRecovery:async()=>true,
    authorizeOriginalRead:async()=>true,readOriginalEvents:x.readOriginalEvents});
  const beforeHistory=counts(),networkReads=x.counts().networkGets;
  x.rotateSource();x.rotateRecipient();x.offline();x.f.restart();
  const request=createT4OriginalReplacementOwnerHistoryRequest({session:c,requesterNodeRef:recipientNodeRef,ownerNodeRef:sourceNodeRef});
  const terminal=await ownerHistory(request);
  assert.equal(terminal.publication.schema,'IWXA_T4_ORIGINAL_HISTORICAL_MULTIPART_PUBLICATION_V1');
  assert.equal(terminal.publication.frames.length,wireBytes.length+1);
  assert.ok(terminal.publication.frames.every(f=>!Object.hasOwn(f,'wireBytes')));
  assert.equal(terminal.publication.manifestDigest,chunks.manifest.manifestDigest);
  const forged=structuredClone(terminal);forged.publication.frames[2].sha256='f'.repeat(64);
  assert.throws(()=>encodeT4OriginalReplacementHistoryResponse(forged,request));
  const sourceRecovered=await recover(sourceNodeRef),recipientRecovered=await recover(recipientNodeRef);
  assert.deepEqual(sourceRecovered,recipientRecovered);
  assert.deepEqual(sourceRecovered.originalT3NextCursor,x.sourceCursorAfter);
  await assert.rejects(recoverT4OriginalReplacementTerminalCursorEvidence({session:c,sourceCursorBefore:x.sourceCursorBefore,
    requiredCryptoSuite:opts.requiredCryptoSuite,getMode:opts.getMode,requesterNodeRef:recipientNodeRef,
    readOriginalOwnerHistory:async request=>{
      const v=structuredClone(await ownerHistory(request));
      if(request.ownerNodeRef===sourceNodeRef)v.publication.manifestDigest='sha256:'+'f'.repeat(64);
      return v;},verifyOriginalHistoricalNodeSignature:x.historicalSignature(recipientNodeRef),
    authorizeOriginalHistoricalCursorRecovery:async()=>true,authorizeOriginalRead:async()=>true,readOriginalEvents:x.readOriginalEvents}),
    isCode('CURSOR_REPLACEMENT_HISTORICAL_PUBLICATION_MISMATCH'));
  assert.deepEqual(counts(),beforeHistory);
  assert.equal(x.counts().networkGets,networkReads);
});
