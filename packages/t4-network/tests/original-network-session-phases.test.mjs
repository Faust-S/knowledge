import test from 'node:test';
import assert from 'node:assert/strict';
import {createT4OriginalNetworkSessionPhasePort} from
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
      proof.operation==='t1.getObject',
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
