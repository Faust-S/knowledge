import test from 'node:test';
import assert from 'node:assert/strict';
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
