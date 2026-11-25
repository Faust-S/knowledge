import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,verify,createHash} from 'node:crypto';
import {deriveT4OriginalNativeCaptureSession,createT4OriginalNetworkPublicationPort,validateT4OriginalNativeCaptureSession,
  validateT4OriginalReplacementSessionCandidate,createT4OriginalSourceSessionHead,
  createT4OriginalReplacementSourceHead,readT4OriginalReplacementSourceHead} from '../src/network/original-network-publication.mjs';
import {t4NativeSourceHeadIndexKey,t4NativeReplacementHeadIndexKey,t4NativeSessionFrameIndexKey}
  from '../src/network/original-network-frame-address.mjs';
import {createT4CandidateFrameTransport} from '../src/network/standard-network-wire-transport.mjs';
import {createT4OriginalNetworkReplayPort} from '../src/network/original-network-replay-checkpoint.mjs';
import {createT4CandidateUnsignedFrame,signT4CandidateFrame,T4_ORIGINAL_SOURCE_SESSION_EXTENSION,
  T4_REPLACEMENT_SOURCE_SESSION_EXTENSION} from '../src/network/standard-network-wire-candidate.mjs';
import {prepareT4OriginalSupersessionControl,signT4OriginalSupersessionRequest,
  retireT4OriginalRecipientAttemptFromControl,verifyT4OriginalRecipientRetirementAck,recordT4OriginalSourceSupersession,
  publishT4OriginalRecipientRetirementAck,recoverT4OriginalReplacementEligibility,
  publishT4OriginalReplacementSourceHead,discoverT4OriginalReplacementSourceHead,admitT4OriginalReplacementSourcePhase,
  readT4OriginalReplacementRecipientAdmission,publishT4OriginalReplacementRecipientDiff,
  discoverT4OriginalReplacementRecipientDiff}
  from '../src/network/original-network-session-supersession.mjs';
import {createT4OriginalNetworkSessionPhasePort,deriveT4OriginalReplacementAttempt} from
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
      hasOperation:op=>['t1.getObject','t1.putObject','t1.listEventsSince']
        .includes(op),
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
async function controlFixture({indexed=false}={}){
  const f=retirementFixture(),sourceStore=fakeKernel(),ws='ws:k47:subject',epoch=2,
    suite='X25519_AES256GCM_ED25519',sha=x=>createHash('sha256').update(x).digest('hex');
  const sourceEventId='event:k47:original',capture={kind:'OBJECT_PUT',captureRef:'capture:k47:one',
    workspaceId:ws,originalWriteOwnerRef:owner,sourceEventId,sourceRevision:7,
    originalIntentEventAndCanonicalBytesVerified:true,capturedWindowDigestVerified:true,
    sourceWindow:{lastEventId:sourceEventId,eventRefs:[{eventDigest:H}],windowDigest:B,
      sourcePrefixDigestBefore:H,sourcePrefixDigestAfter:B},
    prepared:{sha256:sha('original capture'),delta:{sourceEventId,sourceRevision:7,sourceEventDigest:H,windowDigest:B}}};
  const session=deriveT4OriginalNativeCaptureSession({schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_OUTBOX_TASK_V1',
    state:'ORIGINAL_NATIVE_CAPTURE_READY',workspaceId:ws,originalWriteOwnerRef:owner,sourceNodeRef,recipientNodeRef,
    scopeRef,ownerEpoch:epoch,networkTargetRef:recipientNodeRef,networkPublished:false,sourceCursorAdvanced:false,
    originalRecipientApplied:false,sourceCursorBefore:{sourcePrefixDigest:H},sourceCursorAfter:{sourcePrefixDigest:B},capture});
  const phase=()=>f.port({sessionRef:session.sessionRef,changeId:session.changeId});
  let network=true,sourceAllowed=true,recipientAllowed=true,captureVerified=true,acceptanceAllowed=true,readRecipient=true,
    sourcePhaseAllowed=true,sourceRecordAllowed=true,frontierChanged=false,sourceApplied=false,
    recipientFrontierChanged=false,replacementAllowed=true;
  let sourceKey={...generateKeyPairSync('ed25519'),id:'key:k47:source:1'},
    recipientKey={...generateKeyPairSync('ed25519'),id:'key:k47:recipient:1'};
  const frames=new Map(),indexes=new Map();let networkPuts=0,networkGets=0,signatures=0,loseControlWrite=false,controlPublicationAllowed=true;
  const wire={wireKind:'T4_NETWORK_CANDIDATE',forOriginalHostLifetime(){return this;},
    async putSnapshot({key,bytes,expectedSha256}){assert.equal(sha(bytes),expectedSha256);
      if(frames.has(key)){assert.deepEqual(frames.get(key),new Uint8Array(bytes));
        return {key,sha256:expectedSha256,state:'ALREADY_PRESENT_VERIFIED'};}
      frames.set(key,new Uint8Array(bytes));networkPuts++;
      if(loseControlWrite){loseControlWrite=false;throw Object.assign(Error('lost control response'),{code:'OUTCOME_UNKNOWN'});}
      return {key,sha256:expectedSha256,state:'PUBLISHED_AND_READ_BACK'};},
    async getSnapshot({key,expectedSha256}){networkGets++;
      const bytes=frames.get(key);assert.ok(bytes);assert.equal(sha(bytes),expectedSha256);return {bytes:new Uint8Array(bytes)};},
    async inspectOutcome({key,expectedSha256}){assert.equal(sha(frames.get(key)),expectedSha256);
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
  const transport=node=>{
    const technical=node===sourceNodeRef?'ws:k47:source:technical':workspace,
      kernel=node===sourceNodeRef?sourceStore.kernel:f.kernel.kernel,ctx=context(node,technical);
    const replay=createT4OriginalNetworkReplayPort({originalKernel:kernel,technicalWorkspaceId:technical,
      originalWriteOwnerRef:owner,localNodeRef:node,scopeRef,getMode,readOriginalHostContext:ctx,
      authorizeOriginalTechnicalRead:async()=>true,authorizeOriginalTechnicalWrite:async()=>true});
    return createT4CandidateFrameTransport({wireTransport:wire,getMode,readOriginalHostContext:ctx,
      originalHostNodeRef:node,originalHostScopeRef:scopeRef,authorizeOriginalHostWire:async()=>true,
      verifyOriginalNodeSignature:async p=>{const k=localKey(p.sourceNodeRef);
        return p.signerRef===k.id&&verify(null,Buffer.from(p.bytes),k.publicKey,Buffer.from(p.signature));},
      authorizeOriginalNetwork:async p=>['ATTEMPT_RETIRE_REQUEST','ATTEMPT_RETIRED_ACK','APPLIED_ACK','HEADS','DIFF_REQUEST'].some(t=>p.operation==='t4.network.receive.'+t),
      persistOriginalReplayDecision:replay.persistOriginalReplayDecision,
      verifyOriginalHistoricalNodeSignature:async p=>{const k=localKey(p.sourceNodeRef);
        if(p.signerRef!==k.id||!verify(null,Buffer.from(p.bytes),k.publicKey,Buffer.from(p.signature)))return null;
        return {schema:'IWXA_T4_ORIGINAL_HISTORICAL_SIGNATURE_V1',frameDigest:p.frameDigest,signerRef:p.signerRef,
          direction:'PEER',originalHistoricalSignatureVerified:true,originalHistoricalAcceptanceProven:false,
          liveNetworkAuthorityGranted:false,trustedSigningTimeProven:false,originalBusinessApplied:false};},
      readOriginalHistoricalReplayEvidence:replay.readOriginalHistoricalReplayEvidence,
      readOriginalHistoricalAppliedAckSlot:replay.readOriginalHistoricalAppliedAckSlot});
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
  const sourceCursorBefore={schema:'IWXA_T4_ORIGINAL_EVENT_CURSOR_V1',workspaceId:ws,originalWriteOwnerRef:owner,
    lastEventId:'event:k47:baseline',seenEventCount:1,sourcePrefixDigest:H,originalPermissionProof:false};
  // The source frontier is an explicit test port; the actual phase and
  // replay Objects are exercised in the original Kernel fixture.
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
  const sourceCursorAfter={...sourceCursorBefore,lastEventId:sourceEventId,seenEventCount:2,sourcePrefixDigest:B};
  const eligibilityOptions=()=>({originalCaptureSession:session,sourceCursorBefore,sourcePhasePort:sourcePhase(),
    recipientPhasePort:phase(),sourceCursorPort:cursorPort,recipientCursorPort,sourceHistoricalFramePort:transport(sourceNodeRef),
    requiredCryptoSuite:suite,getMode,verifyOriginalSourceCapture:async proof=>
      captureVerified&&proof.originalCaptureSession.sourceEventId===sourceEventId,
    authorizeOriginalReplacement:async proof=>replacementAllowed&&proof.originalBothAttemptsRetired===true});
  const eligibility=(patch={})=>recoverT4OriginalReplacementEligibility({...eligibilityOptions(),...patch});
  const createReplacementPort=async({session:identity},readOriginalReplacementEligibility)=>
    createT4OriginalNetworkPublicationPort({session:identity,localNodeRef:sourceNodeRef,technicalWorkspaceId:technical,
      originalKernel:sourceStore.kernel,getMode,readOriginalHostContext:context(sourceNodeRef,technical),
      authorizeOriginalTechnicalRead:async()=>true,authorizeOriginalTechnicalWrite:async()=>true,
      authorizeOriginalFramePublish:async()=>true,readOriginalReplacementEligibility,
      verifyOriginalNodeSignature:async p=>p.signerRef===sourceKey.id&&
        verify(null,Buffer.from(p.bytes),sourceKey.publicKey,Buffer.from(p.signature)),frameTransport:transport(sourceNodeRef)});
  const createReplacementRecipientPort=async({session:identity},readOriginalReplacementRecipientAdmission)=>
    createT4OriginalNetworkPublicationPort({session:identity,localNodeRef:recipientNodeRef,technicalWorkspaceId:workspace,
      originalKernel:f.kernel.kernel,getMode,readOriginalHostContext:context(recipientNodeRef,workspace),
      authorizeOriginalTechnicalRead:async()=>true,authorizeOriginalTechnicalWrite:async()=>true,
      authorizeOriginalFramePublish:async()=>true,readOriginalReplacementRecipientAdmission,
      verifyOriginalNodeSignature:async p=>p.signerRef===recipientKey.id&&
        verify(null,Buffer.from(p.bytes),recipientKey.publicKey,Buffer.from(p.signature)),frameTransport:transport(recipientNodeRef)});
  const recipientAdmissionOptions=phase=>({...eligibilityOptions(),sourceAdmissionPhasePort:phase,
    frameDiscoveryPort:transport(recipientNodeRef),authorizeOriginalReplacementRecipientAdmission:async p=>
      recipientAllowed&&p.originalSourceIntentVerified===true&&p.originalRecipientDiffOnly===true&&p.originalSubjectMutationAllowed===false});
  const publishReplacementDiff=(phase,patch={})=>publishT4OriginalReplacementRecipientDiff({
    ...recipientAdmissionOptions(phase),createOriginalReplacementRecipientPublicationPort:createReplacementRecipientPort,
    resolveOriginalSigningContext:async p=>{
      assert.equal(p.originalReplacementRecipientDiffOnly,true);assert.equal(p.sequence,1);
      return {permissionRef:'permission:k47:'+recipientNodeRef,signerRef:recipientKey.id};},
    signOriginalNodeBytes:signing(recipientNodeRef).signOriginalNodeBytes,...patch});
  const publishReplacement=(patch={})=>publishT4OriginalReplacementSourceHead({...eligibilityOptions(),
    createOriginalReplacementPublicationPort:createReplacementPort,
    resolveOriginalSigningContext:async p=>{
      assert.equal(p.originalReplacementAnnouncementOnly,true);
      assert.equal(p.session.originalCaptureSession.sessionRef,session.sessionRef);
      return {permissionRef:'permission:k47:'+sourceNodeRef,signerRef:sourceKey.id};},
    signOriginalNodeBytes:signing(sourceNodeRef).signOriginalNodeBytes,...patch});
  const discoverReplacement=(patch={})=>discoverT4OriginalReplacementSourceHead({...eligibilityOptions(),
    frameDiscoveryPort:transport(recipientNodeRef),...patch});
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
    durableRetire,signatureCount:()=>signatures,loseControlWrite:()=>{loseControlWrite=true;},
    eligibility,eligibilityOptions,sourceCursorBefore,sourceCursorAfter,transport,indexes,
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
    rotateRecipient:()=>{recipientKey={...generateKeyPairSync('ed25519'),id:'key:k47:recipient:2'};},
    rotateSource:()=>{sourceKey={...generateKeyPairSync('ed25519'),id:'key:k47:source:2'};},
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
  await assert.rejects(sender.publishSignedFrame({wireBytes:conflictBytes}),isCode('WIRE_NETWORK_PUBLICATION_OUTCOME_UNKNOWN'));
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
  assert.equal((await accept()).state,'WAITING_FOR_REPLACEMENT_DIFF');
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
