import {createT4OriginalNetworkBaselineAdmissionPort} from '../src/network/original-network-baseline-admission.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createCipheriv,createDecipheriv,generateKeyPairSync,randomBytes,sign,verify}
  from 'node:crypto';
import {readT4OriginalEventWindow} from '../src/network/original-event-window.mjs';
import {prepareT4OriginalObjectDelta} from '../src/network/original-object-delta.mjs';
import {deriveT4OriginalNativeCaptureSession,createT4OriginalNetworkPublicationPort,createT4OriginalSourceSessionHead}
  from '../src/network/original-network-publication.mjs';
import {createT4OriginalNetworkSessionPhasePort} from '../src/network/original-network-session-phases.mjs';
import {createT4OriginalNetworkReplayPort} from '../src/network/original-network-replay-checkpoint.mjs';
import {createT4CandidateFrameTransport} from '../src/network/standard-network-wire-transport.mjs';
import {createT4CandidateUnsignedFrame,signT4CandidateFrame,decodeT4CandidateFrame,
  T4_ORIGINAL_SOURCE_SESSION_EXTENSION}
  from '../src/network/standard-network-wire-candidate.mjs';
import {inspectT4OriginalNetworkRecipientResult} from '../src/network/original-network-subject-apply.mjs';
import {createT4OriginalHostRecipientDispatcher} from '../src/network/original-host-recipient-dispatcher.mjs';
import {createT4OriginalNetworkRecipientCursorPort} from '../src/network/original-network-host-cursor.mjs';

const ws='original:workspace:k4',owner='original:owner:k4',scope='original:scope:k4',
  source='node:k4:source',recipient='node:k4:recipient',technical='original:technical:k4',
  objectId='original:object:k4',suite='X25519_AES256GCM_ED25519',epoch=2;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const H=bytes=>'sha256:'+sha(bytes);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const code=c=>e=>{assert.equal(e?.code,c,String(e));return true;};
const allow=async()=>true;
const clone=x=>structuredClone(x);

async function fixture(){
  const originalObject={workspace_id:ws,object_id:objectId,schema_id:'iwxa.demo.note',
    schema_version:'1.0.0',revision:1,deleted:false,data:{title:'Original K4 result',quantity:17},extensions:{}};
  const sourceEvents=[
    {event_id:'event:k4:baseline',event_type:'business.baseline',workspace_id:ws,
      object_id:'object:k4:baseline',revision:1,service_id:'service:k4',payload:{baseline:true},
      occurred_at:'2026-11-24T00:00:00Z'},
    {event_id:'event:k4:change',event_type:'business.object.created',workspace_id:ws,
      object_id:objectId,revision:1,service_id:'service:k4',payload:{quantity:17},
      occurred_at:'2026-11-24T00:00:01Z'},
  ];
  const eventArgs={workspaceId:ws,originalWriteOwnerRef:owner,
    authorizeOriginalRead:allow,readOriginalEvents:async()=>clone(sourceEvents),maxEvents:1};
  const predecessor=(await readT4OriginalEventWindow(eventArgs)).nextCursor;
  const {window,nextCursor}=await readT4OriginalEventWindow({...eventArgs,cursor:predecessor});
  const prepared=await prepareT4OriginalObjectDelta({window,workspaceId:ws,objectId,
    originalWriteOwnerRef:owner,originalKernel:{hasOperation:()=>true,
      getObject:async()=>({object:clone(originalObject)})},authorizeOriginalRead:allow,getMode:()=> 'T4_NETWORK'});
  const session=deriveT4OriginalNativeCaptureSession({
    schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_OUTBOX_TASK_V1',state:'ORIGINAL_NATIVE_CAPTURE_READY',
    workspaceId:ws,originalWriteOwnerRef:owner,sourceNodeRef:source,recipientNodeRef:recipient,
    networkTargetRef:recipient,scopeRef:scope,ownerEpoch:epoch,networkPublished:false,
    sourceCursorAdvanced:false,originalRecipientApplied:false,
    sourceCursorBefore:predecessor,sourceCursorAfter:nextCursor,
    capture:{workspaceId:ws,originalWriteOwnerRef:owner,sourceEventId:window.lastEventId,
      sourceRevision:1,kind:'OBJECT_PUT',originalIntentEventAndCanonicalBytesVerified:true,
      capturedWindowDigestVerified:true,prepared,sourceWindow:window},
  });
  const sourceKeys=generateKeyPairSync('ed25519'),recipientKeys=generateKeyPairSync('ed25519');
  const key=randomBytes(32),iv=randomBytes(12),aad=Buffer.from(session.sessionRef);
  const seal=createCipheriv('aes-256-gcm',key,iv);seal.setAAD(aad);
  const encrypted=Buffer.concat([iv,seal.update(prepared.bytes),seal.final(),seal.getAuthTag()]);
  const half=Math.ceil(encrypted.length/2),parts=[encrypted.subarray(0,half),encrypted.subarray(half)];
  const contentDigest=H(encrypted),encryptionContextRef='key:k4:epoch:2';
  const sourceBodies=[
    ['HEADS',{familyRef:session.familyRef,ownerEpoch:epoch,heads:[session.sourcePrefixDigestAfter]}],
    ['CHANGE_REF',{changeId:session.changeId,changeKind:'OBJECT_PUT',eventRef:session.sourceEventId,
      ownerRef:owner,sourceRevision:1,contentDigest,parents:[session.sourcePrefixDigestBefore]}],
    ...parts.map((p,i)=>['CHUNK',{changeId:session.changeId,contentDigest,chunkIndex:i,chunkCount:2,
      ciphertextBase64:p.toString('base64'),ciphertextSha256:H(p),encryptionContextRef}]),
  ];
  const remote=new Map(),objects=new Map(),events=[];
  const counters={subjectWrites:0,technicalWrites:0,replayWrites:0,phaseWrites:0,
    signatures:0,puts:0,lists:0,gets:0,opens:0,admissions:0};
  let online=true,admitted=true,sourceAllowed=true,active=true,hostSerial=1,
    loseTechnical=null,losePut=false,loseSubject=false,observed=null,stopOnAdmission=false;
  let recipientCursor=clone(predecessor),cursorWrites=0,loseCursor=false;
  const hostRef=()=> 'host:k4:recipient:'+hostSerial;
  const getMode=()=>online?'T4_NETWORK':'LOCAL_T3';
  const context=workspaceId=>async()=>({workspaceId,originalWriteOwnerRef:owner,originalOwnerRef:owner,
    nodeRef:recipient,scopeRef:scope,hostSessionRef:hostRef()});
  const originalKernel={
    hasOperation:op=>['t1.getObject','t1.putObject','t1.listEventsSince','t1.commitObjectGraph'].includes(op),
    getObject:async(w,id)=>clone(objects.get(w+':'+id)??null),
    listEventsSince:async w=>clone(events.filter(e=>e.workspace_id===w)),
    async putObject(input){
      const k=input.workspace_id+':'+input.object_id;
      assert.equal(input.workspace_id,technical);
      assert.equal(input.base_revision,objects.get(k)?.object.revision??0);
      counters.technicalWrites++;
      if(input.event.event_type==='t4.network.original.frame.replay.checkpoint')counters.replayWrites++;
      if(input.event.event_type==='t4.network.original.session.phase')counters.phaseWrites++;
      const object={workspace_id:input.workspace_id,object_id:input.object_id,
        schema_id:input.schema_id,schema_version:input.schema_version,revision:input.base_revision+1,
        deleted:false,data:clone(input.data),extensions:clone(input.extensions)};
      const event={event_id:'event:k4:technical:'+counters.technicalWrites,
        workspace_id:input.workspace_id,object_id:input.object_id,revision:object.revision,
        event_type:input.event.event_type,payload:clone(input.event.payload)};
      objects.set(k,{object});events.push(event);
      if(loseTechnical!==null&&(input.event.payload.phase===loseTechnical||input.event.payload.action===loseTechnical)){
        loseTechnical=null;throw Object.assign(Error('lost original technical write response'),{code:'ACK_LOST'});
      }
      return {object,event};
    },
    async commitObjectGraph(input){
      assert.equal(input.workspace_id,ws);
      const k=ws+':'+input.object.object_id,previous=objects.get(k)?.object;
      assert.equal(input.object.base_revision,previous?.revision??0);
      counters.subjectWrites++;
      const object={workspace_id:ws,object_id:input.object.object_id,
        schema_id:input.object.schema_id,schema_version:input.object.schema_version,
        revision:input.object.base_revision+1,deleted:false,data:clone(input.object.data),extensions:clone(input.object.extensions)};
      const event={event_id:'event:k4:subject:'+counters.subjectWrites,
        workspace_id:ws,object_id:object.object_id,revision:object.revision,event_type:input.event.event_type,
        payload:clone(input.event.payload)};
      objects.set(k,{object});events.push(event);
      if(loseSubject){loseSubject=false;throw Object.assign(Error('lost original subject response'),{code:'ACK_LOST'});}
      return {object,event,workspace_id:ws,transaction_id:'transaction:k4:'+counters.subjectWrites};
    },
  };
  const add=async(i,overrides={})=>{
    const [messageType,body]=sourceBodies[i];
    const wire=await signT4CandidateFrame({
      unsignedFrame:createT4CandidateUnsignedFrame({messageType,sequence:i+1,
        messageId:'message:k4:source:'+(i+1),sourceNodeRef:source,recipientNodeRef:recipient,
        sessionRef:session.sessionRef,scopeRef:scope,ownerEpoch:epoch,
        permissionRef:'permission:k4:source',signerRef:'key:k4:source',
        cryptoSuite:suite,body,...overrides}),
      signOriginalNodeBytes:async({bytes})=>sign(null,Buffer.from(bytes),sourceKeys.privateKey)});
    const key=sha(wire)+'.t4n';remote.set(key,new Uint8Array(wire));return key;
  };
  const raw={
    wireKind:'T4_NETWORK_CANDIDATE',forOriginalHostLifetime(){return this;},
    async listNativeFrameAddresses(){
      counters.lists++;
      const keys=[...remote.keys()].sort();
      return {schema:'IWXA_T4_NATIVE_FRAME_ADDRESS_LIST_V1',
        addresses:keys.map(key=>({key,sha256:key.slice(0,-4)})),
        listingDigest:createHash('sha256').update('IWXA-T4-FRAME-ADDRESS-LIST-V1\0')
          .update(JSON.stringify(keys)).digest('hex'),
        collectionEnumerated:true,addressMetadataIsNotSignatureOrAuthority:true,originalBusinessApplied:false};
    },
    async getSnapshot({key,expectedSha256}){
      counters.gets++;
      if(!remote.has(key))throw Object.assign(Error('missing'),{code:'REMOTE_NOT_FOUND'});
      assert.equal(sha(remote.get(key)),expectedSha256);
      return {bytes:new Uint8Array(remote.get(key))};
    },
    async putSnapshot({key,bytes,expectedSha256,createOnly}){
      counters.puts++;
      assert.equal(createOnly,true);assert.equal(sha(bytes),expectedSha256);
      assert.equal(remote.has(key),false);remote.set(key,new Uint8Array(bytes));
      if(losePut){losePut=false;throw Object.assign(Error('lost PUT response'),{code:'OUTCOME_UNKNOWN'});}
      return {key,sha256:expectedSha256,state:'PUBLISHED_AND_READ_BACK'};
    },
    async inspectOutcome({key,expectedSha256}){
      if(!remote.has(key))throw Object.assign(Error('missing'),{code:'REMOTE_NOT_FOUND'});
      assert.equal(sha(remote.get(key)),expectedSha256);
      return {key,sha256:expectedSha256,state:'EXPECTED_BYTES_PRESENT'};
    },
  };
  const tech={originalKernel,technicalWorkspaceId:technical,originalWriteOwnerRef:owner,
    getMode,readOriginalHostContext:context(technical),
    authorizeOriginalTechnicalRead:allow,authorizeOriginalTechnicalWrite:allow};
  const signature=async({signerRef,bytes,signature})=>{
    const pair=signerRef==='key:k4:source'?sourceKeys:signerRef==='key:k4:recipient'?recipientKeys:null;
    return !!pair&&verify(null,Buffer.from(bytes),pair.publicKey,Buffer.from(signature));
  };
  const transport=()=>createT4CandidateFrameTransport({
    wireTransport:raw,getMode,readOriginalHostContext:context(technical),authorizeOriginalHostWire:allow,
    originalHostNodeRef:recipient,originalHostScopeRef:scope,verifyOriginalNodeSignature:signature,
    authorizeOriginalNetwork:async p=>p.sourceNodeRef===source&&p.recipientNodeRef===recipient&&p.ownerEpoch===epoch,
    persistOriginalReplayDecision:createT4OriginalNetworkReplayPort({...tech,
      localNodeRef:recipient,scopeRef:scope}).persistOriginalReplayDecision,
  });
  const publication=()=>createT4OriginalNetworkPublicationPort({...tech,session,localNodeRef:recipient,
    authorizeOriginalFramePublish:allow,verifyOriginalNodeSignature:signature,frameTransport:transport()});
  const phase=(patch={})=>createT4OriginalNetworkSessionPhasePort({...tech,sourceNodeRef:source,recipientNodeRef:recipient,
    localNodeRef:recipient,scopeRef:scope,sessionRef:session.sessionRef,changeId:session.changeId,ownerEpoch:epoch,
    recipientApplyIntentRequired:true,verifyOriginalPhaseEvidence:async p=>{
      const r=observed?.received,c=observed?.verifiedContent;
      if(p.phase==='RECEIVED')return !!c&&p.evidence.evidenceRef===c.verifiedChunks[0].key&&
        p.evidence.evidenceDigest==='sha256:'+c.verifiedChunks[0].sha256;
      if(p.phase==='VERIFIED')return !!r&&p.evidence.evidenceRef===r.sourceChangeFrameKey&&p.evidence.evidenceDigest===r.originalStateDigest;
      if(p.phase==='APPLY_INTENT')return !!r&&p.evidence.evidenceRef===r.sourceChangeFrameKey&&p.evidence.evidenceDigest==='sha256:'+r.sha256;
      if(p.phase==='APPLIED'){
        const ack=(await publication().inspectOriginalPublication()).frames[1];
        return ack?.state==='PRESENT'&&ack.key===p.evidence.evidenceRef&&'sha256:'+ack.sha256===p.evidence.evidenceDigest&&
          decodeT4CandidateFrame(ack.wireBytes).body.recipientEventRef===p.evidence.originalRecipientEventId;
      }
      return false;
    },verifyOriginalRecipientApplied:async p=>{
      if(!observed?.received)return false;
      const r=await inspectT4OriginalNetworkRecipientResult({received:observed.received,originalKernel,
        getMode,authorizeOriginalRead:allow});
      return r.state==='APPLIED_VERIFIED'&&r.originalRecipientEventId===p.originalRecipientEventId&&
        r.originalRecipientRevision===p.originalRecipientRevision&&r.originalRecipientStateDigest===p.originalRecipientStateDigest;
    },...patch});
  const binding=(overrides={})=>createT4OriginalHostRecipientDispatcher({
    workspaceId:ws,originalWriteOwnerRef:owner,sourceNodeRef:source,recipientNodeRef:recipient,scopeRef:scope,
    ownerEpoch:epoch,originalKernel,getMode,isHostActive:()=>active,readOriginalHostContext:context(ws),
    authorizeOriginalHostTask:allow,authorizeNetworkReceive:allow,authorizeOriginalRead:allow,
    authorizeOriginalWrite:allow,verifyOriginalSourceEvent:async p=>sourceAllowed&&p.sourceEventId===session.sourceEventId&&
      p.sourceEventDigest===session.sourceEventDigest&&p.objectContentDigest===prepared.delta.objectContentDigest,
    readOriginalVerifiedCursor:async()=>clone(recipientCursor),
    persistOriginalVerifiedCursor:async value=>{
      assert.equal(value.schema,'IWXA_T4_ORIGINAL_RECIPIENT_CURSOR_CAS_V1');
      assert.deepEqual(value.previousCursor,recipientCursor);
      assert.deepEqual(value.verifiedCursor,nextCursor);
      assert.equal(value.sourceEventId,session.sourceEventId);
      const status=await phase().inspectOriginalSession();
      assert.equal(status.currentPhase,'APPLIED');
      assert.equal(value.originalReceiptRef,status.currentEvidence.originalRecipientEventId);
      cursorWrites++;recipientCursor=clone(value.verifiedCursor);
      if(loseCursor){loseCursor=false;throw Object.assign(Error('lost cursor reply'),{code:'ACK_LOST'});}
      return true;
    },
    ...overrides,
  });
  const args=(overrides={})=>({session,sourceCursorBefore:predecessor,requiredCryptoSuite:suite,
    authorizeOriginalRecipientSession:async p=>{
      counters.admissions++;
      if(stopOnAdmission)active=false;
      return admitted&&equal(p.session,session)&&equal(p.sourceCursorBefore,predecessor);
    },
    frameDiscoveryPort:transport(),recipientPublicationPort:publication(),
    createOriginalRecipientPhasePort:async p=>{observed=p;return phase();},
    resolveOriginalSigningContext:async()=>({permissionRef:'permission:k4:recipient',signerRef:'key:k4:recipient'}),
    signOriginalNodeBytes:async({bytes})=>{counters.signatures++;return sign(null,Buffer.from(bytes),recipientKeys.privateKey);},
    readOriginalSourceHostContext:async()=>({workspaceId:ws,originalWriteOwnerRef:owner,nodeRef:source,
      scopeRef:scope,hostSessionRef:'host:k4:source'}),
    authorizeOriginalSourceRead:async()=>sourceAllowed,readOriginalSourceEvents:async()=>clone(sourceEvents),
    verifyOriginalSourceSubject:async p=>sourceAllowed&&p.originalSourceEventId===session.sourceEventId&&
      p.originalObjectId===objectId&&p.originalSourceRevision===1,
    verifyOriginalSourceBinding:async p=>sourceAllowed&&p.originalSourceHeadProof.originalEventDigest===session.sourceEventDigest&&
      (p.originalObjectContentDigest===undefined||p.originalObjectContentDigest===prepared.delta.objectContentDigest),
    authorizeOriginalSealedOpen:allow,openOriginalSealedContent:async p=>{
      counters.opens++;const b=Buffer.from(p.ciphertext),decipher=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));
      decipher.setAAD(aad);decipher.setAuthTag(b.subarray(-16));
      return {authenticated:true,plaintext:new Uint8Array(Buffer.concat([decipher.update(b.subarray(12,-16)),decipher.final()]))};
    },...overrides,
  });
  const step=overrides=>binding().runNativeStep(args(overrides));
  const select=async proof=>{
    const idle=equal(proof.sourceCursorBefore,nextCursor);
    assert.ok(idle||equal(proof.sourceCursorBefore,predecessor));
    return {schema:'IWXA_T4_ORIGINAL_NATIVE_CAPTURE_SELECTION_V1',
      state:idle?'NO_NEXT_ORIGINAL_EVENT':'ORIGINAL_NATIVE_SESSION_SELECTED',
      workspaceId:ws,originalWriteOwnerRef:owner,sourceNodeRef:source,recipientNodeRef:recipient,
      scopeRef:scope,ownerEpoch:epoch,networkTargetRef:recipient,
      sourceCursorBefore:clone(proof.sourceCursorBefore),sourceCursorAfter:clone(nextCursor),
      originalSourceOwnerReadVerified:true,originalSourceCursorAdvanced:false,
      originalNetworkPublished:false,originalSubjectMutationInvoked:false,capturedPlaintextReturned:false,
      createsStore:false,createsScheduler:false,originalCaptureEvidenceVerified:!idle,
      session:idle?null:session,...(idle?{mustRescanOnNextHostWake:true}:{})};
  };
  const ownerArgs=(overrides={})=>{
    const {session,sourceCursorBefore,recipientPublicationPort,...a}=args();
    return {...a,readOriginalNativeSessionAtCursor:select,
      createOriginalRecipientPublicationPort:async proof=>{
        assert.deepEqual(proof.session,session);return publication();
      },...overrides};
  };
  const ownerStep=(overrides,ports)=>binding(ports).runNativeOwnerStep(ownerArgs(overrides));
  const admittedBaseline={schema:'IWXA_T4_ORIGINAL_RECIPIENT_BASELINE_V1',
    identity:{technicalWorkspaceId:technical,sourceWorkspaceId:ws,originalWriteOwnerRef:owner,
      sourceNodeRef:source,recipientNodeRef:recipient,scopeRef:scope,ownerEpoch:epoch},
    originalBaselineRef:'original:baseline:k6',originalBaselineDigest:H('original admitted baseline'),
    sourceCursor:clone(predecessor)};
  const baselinePort=()=>createT4OriginalNetworkBaselineAdmissionPort({...tech,
    ...admittedBaseline.identity,role:'RECIPIENT',authorizeOriginalBaselineAdmission:allow,
    verifyOriginalBaselineEvidence:async p=>equal(p.baseline,admittedBaseline)});
  const cursorPort=(overrides={})=>createT4OriginalNetworkRecipientCursorPort({
    ...tech,sourceWorkspaceId:ws,sourceNodeRef:source,recipientNodeRef:recipient,scopeRef:scope,ownerEpoch:epoch,
    authorizeOriginalRecipientRead:allow,authorizeOriginalSourceRead:async()=>sourceAllowed,
    readOriginalSourceEvents:async()=>clone(sourceEvents),
    readOriginalAdmittedBaseline:async()=>clone(admittedBaseline),
    verifyOriginalRecipientBaseline:async p=>equal(p.baseline,admittedBaseline),...overrides,
  });
  const typedStep=(overrides={},port=cursorPort())=>ownerStep(overrides,{
    readOriginalVerifiedCursor:undefined,persistOriginalVerifiedCursor:undefined,
    originalRecipientCursorPort:port,
  });
  const full=async()=>{await add(0);assert.equal((await step()).state,'DIFF_PRESENT');
    await add(1);await add(2);await add(3);};
  return {session,predecessor,nextCursor,prepared,remote,counters,events,objects,add,binding,args,step,full,phase,publication,
    ownerStep,ownerArgs,select,cursor:()=>clone(recipientCursor),cursorWrites:()=>cursorWrites,
    cursorPort,typedStep,admittedBaseline,baselinePort,
    loseCursor(){loseCursor=true;},setCursor(v){recipientCursor=clone(v);},
    restart(){hostSerial++;active=true;observed=null;},loseTechnical:v=>{loseTechnical=v;},
    losePut(){losePut=true;},loseSubject(){loseSubject=true;},
    deny(){admitted=false;},denySource(){sourceAllowed=false;},local(){online=false;},stopOnAdmission(){stopOnAdmission=true;}};
}

test('K4 recipient discovers HEADS, publishes DIFF, waits for missing ciphertext and applies only through original phase ledger',async()=>{
  const f=await fixture();
  assert.equal((await f.step()).state,'WAITING_FOR_HEADS');
  assert.equal(f.counters.signatures,0);assert.equal(f.counters.subjectWrites,0);
  await f.add(0);assert.equal((await f.step()).state,'DIFF_PRESENT');
  assert.equal((await f.step()).state,'WAITING_FOR_CHANGE');
  await f.add(1);await f.add(3);
  const partial=await f.step();assert.equal(partial.state,'WAITING_FOR_CHUNKS');
  assert.deepEqual(partial.missingChunkIndexes,[0]);assert.equal(f.counters.opens,0);
  assert.equal(f.counters.phaseWrites,0);assert.equal(f.counters.subjectWrites,0);
  await f.add(2);await f.add(0,{sessionRef:'session:unrelated',messageId:'message:unrelated'});
  assert.equal((await f.step()).state,'RECEIVED_RECORDED');assert.equal(f.counters.subjectWrites,0);
  f.restart();assert.equal((await f.step()).state,'VERIFIED_RECORDED');
  f.restart();const done=await f.step();
  assert.equal(done.state,'APPLIED_AND_ACKNOWLEDGED');assert.equal(done.sourceCursorAdvanced,false);
  assert.equal(done.originalSubjectMutationInvoked,true);
  assert.equal(f.counters.subjectWrites,1);assert.equal(f.counters.signatures,2);
  assert.equal(f.counters.puts,2);assert.equal(f.counters.phaseWrites,4);
  assert.equal(f.counters.replayWrites,4);
  assert.equal((await f.phase().inspectOriginalSession()).currentPhase,'APPLIED');
  const writes=f.counters.technicalWrites;f.restart();
  const cold=await f.step();assert.equal(cold.originalSubjectMutationInvoked,false);
  assert.equal(cold.result.acknowledgement.state,'ALREADY_FINALIZED');
  assert.equal(f.counters.technicalWrites,writes);assert.equal(f.counters.signatures,2);
  assert.equal(f.counters.puts,2);assert.equal(f.counters.subjectWrites,1);
});

test('K4 resumes lost DIFF preparation and HTTPS publication using exact signed bytes',async()=>{
  const f=await fixture();await f.add(0);f.loseTechnical('PREPARE');
  await assert.rejects(f.step(),code('PUBLICATION_ORIGINAL_CAS_OUTCOME_UNKNOWN'));
  const saved=await f.publication().inspectOriginalPublication();
  assert.equal(saved.frames[0].state,'PREPARED');assert.equal(f.counters.signatures,1);assert.equal(f.counters.puts,0);
  f.restart();f.losePut();
  await assert.rejects(f.step(),code('PUBLICATION_NETWORK_OUTCOME_UNKNOWN'));
  assert.equal(f.counters.signatures,1);assert.equal(f.counters.puts,1);
  f.restart();const done=await f.step();
  assert.equal(done.state,'DIFF_PRESENT');assert.equal(done.originalSignedDiffReused,true);
  assert.deepEqual((await f.publication().inspectOriginalPublication()).frames[0].wireBytes,saved.frames[0].wireBytes);
  assert.equal(f.counters.signatures,1);assert.equal(f.counters.puts,1);
  assert.equal(f.counters.subjectWrites,0);
});

test('K4 reconciles lost RECEIVED and VERIFIED CAS, lost subject response and lost ACK PUT',async()=>{
  const f=await fixture();await f.full();f.loseTechnical('RECEIVED');
  await assert.rejects(f.step(),code('PHASE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  f.restart();f.loseTechnical('VERIFIED');
  await assert.rejects(f.step(),code('PHASE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  assert.equal(f.counters.phaseWrites,2);assert.equal(f.counters.subjectWrites,0);
  f.restart();f.loseSubject();
  await assert.rejects(f.step(),code('SUBJECT_ORIGINAL_APPLY_OUTCOME_UNKNOWN'));
  assert.equal(f.counters.subjectWrites,1);assert.equal(f.counters.phaseWrites,3);
  f.restart();f.losePut();
  await assert.rejects(f.step(),code('PUBLICATION_NETWORK_OUTCOME_UNKNOWN'));
  const saved=(await f.publication().inspectOriginalPublication()).frames[1];
  assert.equal(saved.state,'ATTEMPTED');assert.equal(f.counters.signatures,2);assert.equal(f.counters.puts,2);
  f.restart();const done=await f.step();
  assert.equal(done.state,'APPLIED_AND_ACKNOWLEDGED');assert.equal(done.originalSubjectMutationInvoked,false);
  assert.equal(done.result.acknowledgement.publication.state,'REMOTE_READBACK_RECOVERED');
  assert.deepEqual((await f.publication().inspectOriginalPublication()).frames[1].wireBytes,saved.wireBytes);
  assert.equal(f.counters.subjectWrites,1);assert.equal(f.counters.signatures,2);
  assert.equal(f.counters.puts,2);assert.equal(f.counters.phaseWrites,4);
});

test('K4 local mode, wrong admitted predecessor and original admission denial have no network or original mutations',async()=>{
  const f=await fixture();await f.add(0);
  await assert.rejects(f.step({sourceCursorBefore:{...f.predecessor,sourcePrefixDigest:H('wrong')}}),
    code('RECIPIENT_NATIVE_ORIGINAL_PREDECESSOR_REQUIRED'));
  f.deny();await assert.rejects(f.step(),code('RECIPIENT_NATIVE_ORIGINAL_ADMISSION_DENIED'));
  f.local();assert.equal((await f.binding().runNativeStep()).state,'LOCAL_T3');
  assert.equal(f.counters.technicalWrites,0);assert.equal(f.counters.lists,0);
  assert.equal(f.counters.gets,0);assert.equal(f.counters.puts,0);assert.equal(f.counters.opens,0);
});

test('K4 refuses decryption and subject writes when original source authority is withdrawn',async()=>{
  const f=await fixture();await f.full();f.denySource();
  await assert.rejects(f.step(),code('HEAD_ORIGINAL_ACCESS_DENIED'));
  assert.equal(f.counters.opens,0);assert.equal(f.counters.phaseWrites,0);assert.equal(f.counters.subjectWrites,0);
  assert.equal(f.counters.signatures,1);assert.equal(f.counters.puts,1);
});

test('K4 Host invalidated during admission cannot access transport and stale binding cannot resume',async()=>{
  const f=await fixture(),binding=f.binding();await f.add(0);f.stopOnAdmission();
  await assert.rejects(binding.runNativeStep(f.args()),code('RECIPIENT_ORIGINAL_HOST_DISPOSED'));
  f.restart();
  await assert.rejects(binding.runNativeStep(f.args()),code('RECIPIENT_ORIGINAL_HOST_DISPOSED'));
  assert.equal(f.counters.lists,0);assert.equal(f.counters.technicalWrites,0);assert.equal(f.counters.signatures,0);
});

test('K4 original dispatcher excludes concurrent native steps before any second original effect',async()=>{
  const f=await fixture(),binding=f.binding();await f.add(0);
  let entered,release;const enteredPromise=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
  let first=true;
  const running=binding.runNativeStep(f.args({authorizeOriginalRecipientSession:async()=>{
    if(first){first=false;entered();await gate;}return true;
  }}));
  await enteredPromise;
  try{await assert.rejects(binding.runNativeStep(f.args()),code('RECIPIENT_CONCURRENT_NATIVE_TASK'));}
  finally{release();}
  assert.equal((await running).state,'DIFF_PRESENT');assert.equal(f.counters.signatures,1);
  assert.equal(f.counters.puts,1);
});

test('K5 owner wake chooses next original event and advances its existing cursor only after verified APPLIED',async()=>{
  const f=await fixture();
  assert.equal((await f.ownerStep()).state,'WAITING_FOR_HEADS');
  await f.add(0);assert.equal((await f.ownerStep()).state,'DIFF_PRESENT');
  await f.add(1);await f.add(2);await f.add(3);
  assert.equal((await f.ownerStep()).state,'RECEIVED_RECORDED');
  f.restart();assert.equal((await f.ownerStep()).state,'VERIFIED_RECORDED');
  assert.equal(f.cursorWrites(),0);assert.deepEqual(f.cursor(),f.predecessor);
  const done=await f.ownerStep();
  assert.equal(done.state,'RECIPIENT_CURSOR_ADVANCED');
  assert.equal(done.originalRecipientCursorAdvanced,true);assert.equal(done.sourceCursorAdvanced,false);
  assert.deepEqual(f.cursor(),f.nextCursor);assert.equal(f.cursorWrites(),1);
  const writes=f.counters.technicalWrites,lists=f.counters.lists;f.restart();
  assert.equal((await f.ownerStep()).state,'NO_NEXT_ORIGINAL_EVENT');
  assert.equal(f.counters.technicalWrites,writes);assert.equal(f.counters.lists,lists);
  assert.equal(f.counters.subjectWrites,1);assert.equal(f.counters.signatures,2);
});

test('K5 lost recipient cursor CAS reply is reconciled by next owner wake without repeating mutation or ACK',async()=>{
  const f=await fixture();await f.full();
  assert.equal((await f.ownerStep()).state,'RECEIVED_RECORDED');
  assert.equal((await f.ownerStep()).state,'VERIFIED_RECORDED');
  f.loseCursor();
  await assert.rejects(f.ownerStep(),code('RECIPIENT_NATIVE_OWNER_CURSOR_OUTCOME_UNKNOWN'));
  assert.deepEqual(f.cursor(),f.nextCursor);assert.equal(f.cursorWrites(),1);
  const counts=clone(f.counters);f.restart();
  assert.equal((await f.ownerStep()).state,'NO_NEXT_ORIGINAL_EVENT');
  for(const k of ['technicalWrites','subjectWrites','signatures','puts','lists'])
    assert.equal(f.counters[k],counts[k],k);
  assert.equal(f.cursorWrites(),1);
});

test('K5 failed cursor CAS leaves original applied session recoverable before the next event',async()=>{
  const f=await fixture();await f.full();
  await f.ownerStep();await f.ownerStep();
  await assert.rejects(f.ownerStep({},{
    persistOriginalVerifiedCursor:async()=>false}),code('RECIPIENT_NATIVE_OWNER_CURSOR_OUTCOME_UNKNOWN'));
  assert.deepEqual(f.cursor(),f.predecessor);assert.equal(f.counters.subjectWrites,1);
  const counts=clone(f.counters);f.restart();
  const done=await f.ownerStep();assert.equal(done.state,'RECIPIENT_CURSOR_ADVANCED');
  assert.equal(done.originalSubjectMutationInvoked,false);
  for(const k of ['technicalWrites','subjectWrites','signatures','puts'])
    assert.equal(f.counters[k],counts[k],k);
  assert.equal(f.cursorWrites(),1);
});

test('K5 owner rejects caller session and invalid selection before network or writes',async()=>{
  const f=await fixture();await f.add(0);
  await assert.rejects(f.ownerStep({session:f.session}),code('RECIPIENT_NATIVE_OWNER_STEP_ORIGINAL_PORTS_REQUIRED'));
  await assert.rejects(f.ownerStep({readOriginalNativeSessionAtCursor:async p=>({
    ...await f.select(p),sourceCursorAfter:{...f.nextCursor,seenEventCount:f.nextCursor.seenEventCount+1},
  })}),code('RECIPIENT_NATIVE_OWNER_SELECTION_CAUSAL_MISMATCH'));
  await assert.rejects(f.ownerStep({readOriginalNativeSessionAtCursor:async p=>({
    ...await f.select(p),recipientNodeRef:'node:other',
  })}),code('RECIPIENT_NATIVE_OWNER_SELECTION_INVALID'));
  assert.equal(f.counters.lists,0);assert.equal(f.counters.technicalWrites,0);
  assert.equal(f.cursorWrites(),0);
});

test('K5 concurrent recipient cursor advance during source selection stops the stale wake',async()=>{
  const f=await fixture();await f.add(0);
  await assert.rejects(f.ownerStep({readOriginalNativeSessionAtCursor:async p=>{
    const value=await f.select(p);f.setCursor(f.nextCursor);return value;
  }}),code('RECIPIENT_NATIVE_OWNER_CURSOR_CHANGED'));
  assert.equal(f.counters.lists,0);assert.equal(f.counters.technicalWrites,0);
  assert.equal(f.cursorWrites(),0);
});

test('K6 original Kernel recipient frontier advances once from admitted baseline using actual applied witness',async()=>{
  const f=await fixture(),port=f.cursorPort();
  const initial=await port.inspectOriginalRecipientCursor();
  assert.equal(initial.revision,0);assert.deepEqual(initial.originalT3VerifiedCursor,f.predecessor);
  assert.equal(initial.originalBaselineAdmitted,true);
  await f.full();await f.typedStep();await f.typedStep();
  const applied=await f.typedStep();
  assert.equal(applied.state,'RECIPIENT_CURSOR_ADVANCED');
  const final=await f.cursorPort().inspectOriginalRecipientCursor();
  assert.equal(final.revision,1);assert.equal(final.originalT3EventChainVerified,true);
  assert.deepEqual(final.originalT3VerifiedCursor,f.nextCursor);
  assert.equal(final.lastOriginalRecipientEventId,applied.originalReceiptRef);
  assert.equal(f.events.filter(e=>e.event_type==='t4.network.original.host.recipient.frontier').length,1);
  assert.equal(f.cursorWrites(),0);assert.equal(f.counters.subjectWrites,1);
  const counts=clone(f.counters);f.restart();
  assert.equal((await f.typedStep()).state,'NO_NEXT_ORIGINAL_EVENT');
  for(const k of ['technicalWrites','subjectWrites','signatures','puts','lists'])
    assert.equal(f.counters[k],counts[k],k);
});

test('K6 original recipient frontier lost CAS reply recovers locally on next wake without repeating ACK',async()=>{
  const f=await fixture();await f.full();await f.typedStep();await f.typedStep();
  f.loseTechnical('ADVANCE');
  await assert.rejects(f.typedStep(),e=>e?.code==='RECIPIENT_NATIVE_OWNER_CURSOR_OUTCOME_UNKNOWN'&&
    e.details.originalErrorCode==='RECIPIENT_CURSOR_ORIGINAL_WRITE_OUTCOME_UNKNOWN');
  f.restart();const counts=clone(f.counters);
  assert.equal((await f.cursorPort().inspectOriginalRecipientCursor()).revision,1);
  assert.equal((await f.typedStep()).state,'NO_NEXT_ORIGINAL_EVENT');
  for(const k of ['technicalWrites','subjectWrites','signatures','puts','lists'])
    assert.equal(f.counters[k],counts[k],k);
});

test('K6 cold frontier read refuses corrupted original result or missing checkpoint Event',async()=>{
  const f=await fixture();await f.full();await f.typedStep();await f.typedStep();await f.typedStep();
  const receipt=f.events.find(e=>e.event_type==='iwxa.t4.original-object.synced');
  const old=clone(receipt.payload);receipt.payload.originalContentDigest=H('wrong');
  await assert.rejects(f.cursorPort().inspectOriginalRecipientCursor(),code('RECIPIENT_CURSOR_ORIGINAL_RESULT_EVENT_MISMATCH'));
  receipt.payload=old;
  const index=f.events.findIndex(e=>e.event_type==='t4.network.original.host.recipient.frontier');
  f.events.splice(index,1);
  await assert.rejects(f.cursorPort().inspectOriginalRecipientCursor(),code('RECIPIENT_CURSOR_ORIGINAL_CHECKPOINT_INVALID'));
  assert.equal(f.counters.subjectWrites,1);
});

test('K6 baseline admission and independent recipient read are mandatory; raw cursor alone cannot commit',async()=>{
  const f=await fixture();
  await assert.rejects(f.cursorPort({verifyOriginalRecipientBaseline:async()=>false})
    .inspectOriginalRecipientCursor(),code('RECIPIENT_CURSOR_ORIGINAL_BASELINE_DENIED'));
  const port=f.cursorPort();
  await assert.rejects(port.persistOriginalVerifiedCursor({
    schema:'IWXA_T4_ORIGINAL_RECIPIENT_CURSOR_CAS_V1',previousCursor:f.predecessor,
    verifiedCursor:f.nextCursor,originalReceiptRef:'event:fake'},{}));
  await f.full();await f.typedStep();await f.typedStep();
  await assert.rejects(f.typedStep({},f.cursorPort({authorizeOriginalRecipientRead:async()=>false})),
    e=>e?.code==='RECIPIENT_NATIVE_OWNER_CURSOR_OUTCOME_UNKNOWN');
  assert.equal((await f.cursorPort().inspectOriginalRecipientCursor()).revision,0);
  assert.equal(f.counters.subjectWrites,1);
  const resumed=await f.typedStep();assert.equal(resumed.state,'RECIPIENT_CURSOR_ADVANCED');
  assert.equal(resumed.originalSubjectMutationInvoked,false);
});

test('K6 typed cursor cannot coexist with another incoming cursor owner or use another peer epoch',async()=>{
  const f=await fixture();
  await assert.rejects(f.ownerStep({},{
    originalRecipientCursorPort:f.cursorPort(),
  }),code('RECIPIENT_NATIVE_OWNER_MULTIPLE_CURSOR_PORTS'));
  await assert.rejects(f.typedStep({},f.cursorPort({ownerEpoch:epoch+1})),
    code('RECIPIENT_NATIVE_OWNER_ORIGINAL_CURSOR_PORT_REQUIRED'));
  assert.equal(f.counters.lists,0);assert.equal(f.counters.technicalWrites,0);
});

const signedSelectionOptions={readOriginalNativeSessionAtCursor:undefined,useSignedSourceAnnouncement:true};
const announcedHead=f=>createT4OriginalSourceSessionHead({session:f.session,
  sourceCursorBefore:f.predecessor,sourceCursorAfter:f.nextCursor});
test('K12 recipient owner discovers signed successor, then uses existing proof and original cursor CAS',async()=>{
  const f=await fixture();
  const wake=()=>f.typedStep(signedSelectionOptions);
  const initial=await wake();
  assert.equal(initial.state,'WAITING_FOR_HEADS');
  assert.equal(initial.sourceSelectionDirectOriginalReadVerified,false);
  assert.equal(initial.originalRecipientCursorAdvanced,false);
  await f.add(0,{body:announcedHead(f),criticalExtensions:[T4_ORIGINAL_SOURCE_SESSION_EXTENSION]});
  const diff=await wake();
  assert.equal(diff.state,'DIFF_PRESENT');
  assert.equal(diff.sourceSessionDiscoveredFromSignedAnnouncement,true);
  assert.equal(f.counters.opens,0);assert.equal(f.counters.subjectWrites,0);
  await f.add(1);await f.add(2);await f.add(3);
  assert.equal((await wake()).state,'RECEIVED_RECORDED');
  f.restart();assert.equal((await wake()).state,'VERIFIED_RECORDED');
  f.loseTechnical('ADVANCE');
  await assert.rejects(wake(),e=>e?.code==='RECIPIENT_NATIVE_OWNER_CURSOR_OUTCOME_UNKNOWN');
  assert.equal(f.counters.subjectWrites,1);
  assert.equal((await f.cursorPort().inspectOriginalRecipientCursor()).revision,1);
  f.restart();const before=clone(f.counters),idle=await wake();
  assert.equal(idle.state,'WAITING_FOR_HEADS');assert.equal(idle.originalRecipientCursorAdvanced,false);
  for(const k of ['technicalWrites','subjectWrites','signatures','puts'])
    assert.equal(f.counters[k],before[k],k);
  assert.deepEqual((await f.cursorPort().inspectOriginalRecipientCursor()).originalT3VerifiedCursor,f.nextCursor);
});
test('K12 incompatible or legacy announcement cannot silently supply recipient selection',async()=>{
  const f=await fixture();await f.add(0);
  assert.equal((await f.typedStep(signedSelectionOptions)).state,'WAITING_FOR_HEADS');
  assert.equal(f.counters.signatures,0);assert.equal(f.counters.subjectWrites,0);
  await assert.rejects(f.typedStep({...signedSelectionOptions,readOriginalNativeSessionAtCursor:f.select}),
    code('RECIPIENT_NATIVE_OWNER_STEP_ORIGINAL_PORTS_REQUIRED'));
  await assert.rejects(f.typedStep({...signedSelectionOptions,requireSourceAnnouncement:false}),
    code('RECIPIENT_NATIVE_OWNER_STEP_ORIGINAL_PORTS_REQUIRED'));
});
test('K12 same predecessor count with different original history is a conflict',async()=>{
  const f=await fixture(),body=clone(announcedHead(f));
  body.sourceSession.predecessorPrefixDigest=H('fork');
  await f.add(0,{body,criticalExtensions:[T4_ORIGINAL_SOURCE_SESSION_EXTENSION]});
  await assert.rejects(f.typedStep(signedSelectionOptions),code('SOURCE_ANNOUNCEMENT_PREDECESSOR_CONFLICT'));
  assert.equal(f.counters.signatures,0);assert.equal(f.counters.subjectWrites,0);
});
test('K12 a second signed successor at the same position cannot be selected by arrival order',async()=>{
  const f=await fixture(),body=clone(announcedHead(f));
  const otherEvent='event:k4:competing';
  const hashDomain=(domain,value)=>{
    const sort=x=>x&&typeof x==='object'&&!Array.isArray(x)?
      Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;
    return sha(Buffer.from('IWXA-T4-ORIGINAL-'+domain+'-V1\0'+JSON.stringify(sort(value))));
  };
  const {workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch}=f.session;
  const otherSession='session:t4:'+hashDomain('NATIVE-SESSION',{workspaceId,originalWriteOwnerRef,sourceNodeRef,
    recipientNodeRef,scopeRef,ownerEpoch,sourceEventId:otherEvent});
  await f.add(0,{body,criticalExtensions:[T4_ORIGINAL_SOURCE_SESSION_EXTENSION]});
  body.sourceSession.sourceEventId=otherEvent;
  body.sourceSession.sourceEventDigest=H('other event');
  body.heads=[H('other successor')];
  await f.add(0,{body,sessionRef:otherSession,messageId:'message:k12:other',
    criticalExtensions:[T4_ORIGINAL_SOURCE_SESSION_EXTENSION]});
  await assert.rejects(f.typedStep(signedSelectionOptions),code('SOURCE_ANNOUNCEMENT_SUCCESSOR_CONFLICT'));
  assert.equal(f.counters.subjectWrites,0);assert.equal(f.counters.signatures,0);
});
test('K12 signed announcement still cannot replace original source access or actual result proof',async()=>{
  const f=await fixture();await f.add(0,{body:announcedHead(f),criticalExtensions:[T4_ORIGINAL_SOURCE_SESSION_EXTENSION]});
  await f.typedStep(signedSelectionOptions);await f.add(1);await f.add(2);await f.add(3);
  f.denySource();
  await assert.rejects(f.typedStep(signedSelectionOptions),code('HEAD_ORIGINAL_ACCESS_DENIED'));
  assert.equal(f.counters.opens,0);assert.equal(f.counters.subjectWrites,0);
  assert.equal((await f.cursorPort().inspectOriginalRecipientCursor()).revision,0);
});

test('K13 recipient owner recovers admitted baseline from original Object/Event and discovers signed successor',async()=>{
  const f=await fixture(),{originalBaselineRef,originalBaselineDigest,sourceCursor}=f.admittedBaseline;
  const port=()=>f.cursorPort({originalBaselinePort:f.baselinePort(),readOriginalAdmittedBaseline:null,
    verifyOriginalRecipientBaseline:null});
  await f.baselinePort().admitOriginalBaseline({originalBaselineRef,originalBaselineDigest,sourceCursor});
  f.restart();
  const wake=()=>f.typedStep(signedSelectionOptions,port());
  assert.equal((await wake()).state,'WAITING_FOR_HEADS');
  await f.add(0,{body:announcedHead(f),criticalExtensions:[T4_ORIGINAL_SOURCE_SESSION_EXTENSION]});
  assert.equal((await wake()).state,'DIFF_PRESENT');
  await f.add(1);await f.add(2);await f.add(3);
  assert.equal((await wake()).state,'RECEIVED_RECORDED');f.restart();
  assert.equal((await wake()).state,'VERIFIED_RECORDED');
  const result=await wake();assert.equal(result.originalRecipientCursorAdvanced,true);
  f.restart();assert.deepEqual((await port().inspectOriginalRecipientCursor()).originalT3VerifiedCursor,f.nextCursor);
  assert.equal((await wake()).state,'WAITING_FOR_HEADS');
  assert.equal(f.counters.subjectWrites,1);
  assert.equal(f.events.filter(e=>e.event_type==='t4.network.original.baseline.admitted').length,1);
});

test('K54 cold recipient stops a retired VERIFIED attempt before any old transport read or Vault open',async()=>{
  const f=await fixture();await f.full();await f.step();await f.step();
  const before=await f.phase().inspectOriginalSession();assert.equal(before.currentPhase,'VERIFIED');
  const terminal=await f.phase({authorizeOriginalRecipientSupersession:async()=>true}).retireOriginalRecipientAttempt({
    expectedRevision:before.revision,expectedChainHash:before.chainHash,
    decisionRef:'decision:k54:recipient',decisionDigest:H('independently authorized fixture decision')});
  f.restart();const counters=clone(f.counters),cursor=f.cursor();
  const result=await f.ownerStep();
  assert.equal(result.state,'WAITING_FOR_REPLACEMENT_ADMISSION');
  assert.equal(result.step.originalSupersessionEventId,terminal.originalSupersessionEventId);
  assert.equal(result.step.replacementSessionRef,terminal.replacement.replacementSessionRef);
  assert.equal(result.step.liveNetworkAuthorityGranted,false);
  assert.equal(result.originalRecipientCursorAdvanced,false);assert.deepEqual(f.cursor(),cursor);
  for(const key of ['puts','lists','gets','opens','signatures','subjectWrites','technicalWrites','replayWrites'])
    assert.equal(f.counters[key],counters[key],key);
});
