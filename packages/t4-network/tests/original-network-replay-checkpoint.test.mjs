import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,verify} from 'node:crypto';
import {
  createT4OriginalNetworkReplayPort
} from '../src/network/original-network-replay-checkpoint.mjs';
import {
  createT4CandidateUnsignedFrame,signT4CandidateFrame,
  verifyT4CandidateWireFrame,
} from '../src/network/standard-network-wire-candidate.mjs';

const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const sha='sha256:'+'d'.repeat(64);
const ws='original:recipient:network:technical',owner='original:owner:one';
const proof={
  operation:'t4.network.receive.HEADS',
  signerRef:'original:signer:source',sourceNodeRef:'node:source',
  recipientNodeRef:'node:recipient',scopeRef:'scope:opaque',
  permissionRef:'original:access:read',
  ownerEpoch:4,sessionRef:'session:network:one',
  sequence:2,frameDigest:sha,
  originalDurableCompareAndSetRequired:true,
};
const err=code=>e=>e?.code===code;
function fakeOriginal(){
  const rows=new Map(),events=[];
  let puts=0,reads=0,loseAck=false,delay=false;
  return{
    rows,events,
    get puts(){return puts;},get reads(){return reads;},
    setLoseAck(v){loseAck=v;},
    kernel:{
      hasOperation:op=>['t1.getObject','t1.putObject','t1.listEventsSince']
        .includes(op),
      async getObject(w,id){reads++;return structuredClone(
        rows.get(w+':'+id)??null);
      },
      async listEventsSince(){return structuredClone(events);},
      async putObject(input){
        puts++;
        assert.equal(input.base_revision,0,
          'the ORIGINAL T3 must perform atomic create-only CAS');
        const id=input.workspace_id+':'+input.object_id;
        if(rows.has(id))
          throw Object.assign(Error('original T3 compare-and-create failed'),
            {code:'REVISION_CONFLICT'});
        const row={workspace_id:input.workspace_id,
          object_id:input.object_id,schema_id:input.schema_id,
          schema_version:input.schema_version,deleted:false,
          revision:1,data:structuredClone(input.data),extensions:{}};
        rows.set(id,{object:row,relations:{outgoing:[],incoming:[]}});
        const event={event_id:'original:replay:event:'+puts,
          event_type:input.event.event_type,
          workspace_id:input.workspace_id,object_id:input.object_id,
          revision:1,payload:structuredClone(input.event.payload)};
        events.push(event);
        if(loseAck)throw Object.assign(Error('original source lost reply'),
          {code:'ORIGINAL_ACK_LOST'});
        return{object:row,event};
      },
    },
  };
}
function ports(original=fakeOriginal()){
  let mode='T4_NETWORK',grant=true,
    hostSessionRef='host:original:session:1';
  const binding=()=>createT4OriginalNetworkReplayPort({
    originalKernel:original.kernel,technicalWorkspaceId:ws,
    originalWriteOwnerRef:owner,localNodeRef:'node:recipient',
    scopeRef:'scope:opaque',
    getMode:()=>mode,
    readOriginalHostContext:async()=>({
      workspaceId:ws,originalWriteOwnerRef:owner,
      nodeRef:'node:recipient',scopeRef:'scope:opaque',
      hostSessionRef,
    }),
    authorizeOriginalTechnicalRead:async ctx=>grant&&
      ctx.operation==='t1.getObject'&&
      ctx.originalT3HostOwnsTechnicalWrite===true,
    authorizeOriginalTechnicalWrite:async ctx=>grant&&
      ctx.operation==='t1.putObject',
  });
  return{original,binding,local:()=>{mode='LOCAL_T3';},
    revoke:()=>{grant=false;},
    restart:()=>{hostSessionRef='host:original:session:2';}};
}
test('original T3 technical replay create persists a unique Event and reads original state twice',async()=>{
  const p=ports(),b=p.binding();
  assert.equal(await b.persistOriginalReplayDecision(proof),'RECORDED');
  assert.equal(p.original.puts,1);
  assert.equal(p.original.events.length,1);
  assert.equal(p.original.rows.size,1);
  assert.equal(await b.persistOriginalReplayDecision(proof),'SEEN_EXACT');
  assert.equal(p.original.puts,1);
});
test('restart of original Host reads existing T3 Event without second technical putObject',async()=>{
  const p=ports();
  assert.equal(await p.binding().persistOriginalReplayDecision(proof),
    'RECORDED');
  p.restart();
  assert.equal(await p.binding().persistOriginalReplayDecision(proof),
    'SEEN_EXACT');
  assert.equal(p.original.puts,1);
});
test('lost original T3 putObject reply is recovered read-only, never automatically retried',async()=>{
  const p=ports();p.original.setLoseAck(true);
  await assert.rejects(p.binding().persistOriginalReplayDecision(proof),
    e=>e?.code==='REPLAY_ORIGINAL_WRITE_OUTCOME_UNKNOWN'&&
      e.details.automaticRetryAllowed===false);
  assert.equal(p.original.puts,1);
  p.restart();p.original.setLoseAck(false);
  assert.equal(await p.binding().persistOriginalReplayDecision(proof),
    'SEEN_EXACT');
  assert.equal(p.original.puts,1);
});
test('same incoming sequence with different signed payload must be rejected',async()=>{
  const p=ports();
  await p.binding().persistOriginalReplayDecision(proof);
  await assert.rejects(p.binding().persistOriginalReplayDecision({
    ...proof,frameDigest:'sha256:'+'e'.repeat(64),
  }),err('REPLAY_ORIGINAL_SEQUENCE_CONFLICT'));
  assert.equal(p.original.puts,1);
});
test('tampered original Event is not sufficient proof after cold restart',async()=>{
  const p=ports();await p.binding().persistOriginalReplayDecision(proof);
  p.original.events[0].payload.frameDigest='sha256:'+'f'.repeat(64);
  p.restart();
  await assert.rejects(p.binding().persistOriginalReplayDecision(proof),
    err('REPLAY_ORIGINAL_EVENT_NOT_PROVEN'));
  assert.equal(p.original.puts,1);
});
test('tampered original technical checkpoint is rejected instead of being replaced',async()=>{
  const p=ports();await p.binding().persistOriginalReplayDecision(proof);
  const object=p.original.rows.values().next().value.object;
  object.data.identity.sequence=500;
  await assert.rejects(p.binding().persistOriginalReplayDecision(proof),
    err('REPLAY_ORIGINAL_CHECKPOINT_INVALID'));
  assert.equal(p.original.puts,1);
});
test('LOCAL_T3 mode cannot even read original technical Store',async()=>{
  const p=ports();p.local();
  await assert.rejects(p.binding().persistOriginalReplayDecision(proof),
    err('REPLAY_NETWORK_MODE_OFF'));
  assert.equal(p.original.reads,0);
  assert.equal(p.original.puts,0);
});
test('revoked original Host rights block original technical read/write',async()=>{
  const p=ports();p.revoke();
  await assert.rejects(p.binding().persistOriginalReplayDecision(proof),
    err('REPLAY_ORIGINAL_ACCESS_DENIED'));
  assert.equal(p.original.puts,0);
  assert.equal(p.original.reads,0);
});
test('candidate original peer receipt is never a subject Result',async()=>{
  const p=ports();
  const raw=createT4CandidateUnsignedFrame({
    messageType:'HEADS',messageId:'message:proof:one',
    sourceNodeRef:'node:source',recipientNodeRef:'node:recipient',
    sessionRef:'session:network:one',scopeRef:'scope:opaque',
    permissionRef:'original:access:read',
    signerRef:'original:signer:source',sequence:2,ownerEpoch:4,
    cryptoSuite:'X25519_AES256GCM_ED25519',
    body:{familyRef:'family:one',ownerEpoch:4,heads:[sha]},
  });
  const frame=await signT4CandidateFrame({
    unsignedFrame:raw,signOriginalNodeBytes:async({bytes})=>
      sign(null,Buffer.from(bytes),privateKey),
  });
  const binding=p.binding();
  const result=await verifyT4CandidateWireFrame({
    wireBytes:frame,recipientNodeRef:'node:recipient',
    scopeRef:'scope:opaque',requiredCryptoSuite:
      'X25519_AES256GCM_ED25519',
    verifyOriginalNodeSignature:async({bytes,signature})=>
      verify(null,Buffer.from(bytes),publicKey,Buffer.from(signature)),
    authorizeOriginalNetwork:async()=>true,
    persistOriginalReplayDecision:binding.persistOriginalReplayDecision,
  });
  assert.equal(result.originalReplayCheckpointRecorded,true);
  assert.equal(result.originalBusinessApplied,false);
  p.restart();
  const repeated=await verifyT4CandidateWireFrame({
    wireBytes:frame,recipientNodeRef:'node:recipient',
    scopeRef:'scope:opaque',
    requiredCryptoSuite:'X25519_AES256GCM_ED25519',
    verifyOriginalNodeSignature:async({bytes,signature})=>
      verify(null,Buffer.from(bytes),publicKey,Buffer.from(signature)),
    authorizeOriginalNetwork:async()=>true,
    persistOriginalReplayDecision:
      p.binding().persistOriginalReplayDecision,
  });
  assert.equal(repeated.exactPreviouslyVerifiedReplay,true);
  assert.equal(p.original.puts,1);
});


test('historical replay evidence is read-only, exact, and refuses a missing or conflicting checkpoint',async()=>{
  const p=ports(),b=p.binding(),query={...proof,originalHistoricalEvidenceOnly:true};
  assert.equal(await b.readOriginalHistoricalReplayEvidence(query),null);
  assert.equal(p.original.puts,0);
  await b.persistOriginalReplayDecision(proof);p.restart();
  const evidence=await p.binding().readOriginalHistoricalReplayEvidence(query);
  assert.equal(evidence.originalHistoricalEvidenceOnly,true);
  assert.equal(evidence.originalReplayEventId,p.original.events[0].event_id);
  assert.equal(evidence.liveNetworkAuthorityGranted,false);
  assert.equal(evidence.frameDigest,proof.frameDigest);
  await assert.rejects(p.binding().readOriginalHistoricalReplayEvidence({...query,signerRef:'key:foreign'}),
    err('REPLAY_ORIGINAL_SEQUENCE_CONFLICT'));
  p.original.events[0].payload.frameDigest='sha256:'+'0'.repeat(64);
  await assert.rejects(p.binding().readOriginalHistoricalReplayEvidence(query),err('REPLAY_ORIGINAL_EVENT_NOT_PROVEN'));
  assert.equal(p.original.puts,1);
});


test('K42 original replay stores exact previously authorized final ACK bytes, not chunk copies, and resolves the original slot after restart',async()=>{
  const p=ports(),b=p.binding(),suite='X25519_AES256GCM_ED25519';
  const raw=createT4CandidateUnsignedFrame({messageType:'APPLIED_ACK',messageId:'message:k42:ack',
    sourceNodeRef:proof.sourceNodeRef,recipientNodeRef:proof.recipientNodeRef,scopeRef:proof.scopeRef,
    sessionRef:proof.sessionRef,permissionRef:proof.permissionRef,signerRef:proof.signerRef,
    sequence:2,ownerEpoch:proof.ownerEpoch,cryptoSuite:suite,
    body:{changeId:'change:k42:one',ackRef:'ack:k42:one',contentDigest:sha,
      recipientEventRef:'event:k42:recipient',recipientRevision:7,recipientStateDigest:sha}});
  const bytes=await signT4CandidateFrame({unsignedFrame:raw,signOriginalNodeBytes:async({bytes})=>
    sign(null,Buffer.from(bytes),privateKey)});
  const exact=new Uint8Array(bytes);
  const slot={sourceNodeRef:proof.sourceNodeRef,recipientNodeRef:proof.recipientNodeRef,scopeRef:proof.scopeRef,
    sessionRef:proof.sessionRef,ownerEpoch:proof.ownerEpoch,sequence:2,operation:'t4.network.receive.APPLIED_ACK',
    originalHistoricalEvidenceOnly:true};
  assert.equal(await b.readOriginalHistoricalAppliedAckSlot(slot),null);
  const live={recipientNodeRef:proof.recipientNodeRef,scopeRef:proof.scopeRef,requiredCryptoSuite:suite,
    verifyOriginalNodeSignature:async({bytes,signature})=>verify(null,Buffer.from(bytes),publicKey,Buffer.from(signature)),
    authorizeOriginalNetwork:async()=>{bytes.fill(0);return true;},
    persistOriginalReplayDecision:b.persistOriginalReplayDecision};
  const accepted=await verifyT4CandidateWireFrame({...live,wireBytes:bytes});
  assert.equal(accepted.originalReplayCheckpointRecorded,true);
  assert.equal(p.original.puts,1);p.restart();
  const evidence=await p.binding().readOriginalHistoricalAppliedAckSlot(slot);
  assert.equal(evidence.frameDigest,accepted.frameDigest);
  assert.deepEqual(Buffer.from(evidence.retainedAppliedAckBase64,'base64'),Buffer.from(exact));
  assert.equal(p.original.events[0].payload.wireSha256,evidence.wireSha256);
  assert.equal(evidence.originalHistoricalEvidenceOnly,true);
  assert.equal(evidence.liveNetworkAuthorityGranted,false);
  assert.equal(evidence.originalBusinessApplied,false);
  assert.equal(p.original.puts,1);
  const repeated=await verifyT4CandidateWireFrame({...live,wireBytes:exact,authorizeOriginalNetwork:async()=>true});
  assert.equal(repeated.exactPreviouslyVerifiedReplay,true);assert.equal(p.original.puts,1);
  const saved=p.original.rows.values().next().value;
  const original=structuredClone(saved.object.data);
  saved.object.data.retainedAppliedAckBase64=Buffer.from('wrong bytes').toString('base64');
  await assert.rejects(p.binding().readOriginalHistoricalAppliedAckSlot(slot),err('REPLAY_ORIGINAL_RETAINED_ACK_INVALID'));
  saved.object.data=original;
  p.original.events[0].payload.wireSha256='0'.repeat(64);
  await assert.rejects(p.binding().readOriginalHistoricalAppliedAckSlot(slot),err('REPLAY_ORIGINAL_EVENT_NOT_PROVEN'));
  assert.equal(p.original.puts,1);
});
test('K42 an original orphan replay Event blocks slot recreation and historical claims',async()=>{
  const p=ports();await p.binding().persistOriginalReplayDecision(proof);
  p.original.rows.clear();p.restart();
  await assert.rejects(p.binding().persistOriginalReplayDecision(proof),err('REPLAY_ORIGINAL_CHECKPOINT_MISSING_WITH_EVENT'));
  await assert.rejects(p.binding().readOriginalHistoricalReplayEvidence({...proof,originalHistoricalEvidenceOnly:true}),
    err('REPLAY_ORIGINAL_CHECKPOINT_MISSING_WITH_EVENT'));
  assert.equal(p.original.puts,1);
});
test('K42 historical ACK lookup distinguishes a legacy accepted slot from an absent slot and never rewrites it',async()=>{
  const p=ports(),ack={...proof,operation:'t4.network.receive.APPLIED_ACK'};
  await p.binding().persistOriginalReplayDecision(ack);p.restart();
  const query={sourceNodeRef:ack.sourceNodeRef,recipientNodeRef:ack.recipientNodeRef,scopeRef:ack.scopeRef,
    sessionRef:ack.sessionRef,ownerEpoch:ack.ownerEpoch,sequence:2,operation:ack.operation,originalHistoricalEvidenceOnly:true};
  const old=await p.binding().readOriginalHistoricalAppliedAckSlot(query);
  assert.equal(old.frameDigest,ack.frameDigest);assert.equal(old.retainedAppliedAckBase64,undefined);
  assert.equal(await p.binding().readOriginalHistoricalAppliedAckSlot({...query,sessionRef:'session:absent'}),null);
  p.revoke();
  await assert.rejects(p.binding().readOriginalHistoricalAppliedAckSlot(query),err('REPLAY_ORIGINAL_ACCESS_DENIED'));
  assert.equal(p.original.puts,1);
});
