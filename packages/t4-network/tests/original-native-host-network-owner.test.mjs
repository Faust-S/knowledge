import {createT4OriginalNativeHostNetworkProfile} from '../src/network/original-native-host-network-profile.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign,verify,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {T4TransferError} from '../src/network/webdav-package-transfer.mjs';
import {T4CandidateFrameTransportError} from '../src/network/standard-network-wire-transport.mjs';
import {T4OriginalNetworkPublicationError,isT4RecoverablePublicationWakeError} from '../src/network/original-network-publication.mjs';
import {createOriginalKernelNativeRelay} from '../../t3-core/src/t3/original-kernel-native-relay.mjs';
import {createTemporaryOriginalPersonalAuthority} from '../../t3-core/tests/support/t3-original-personal-authority.mjs';
import {createOriginalKernelRegistryStatePort} from '../../t3-core/src/t3/access/original-kernel-registry-state.mjs';
import {emptyVault,generateVaultKey,encryptVault} from '../../t3-core/src/t3/access/local-vault.mjs';
import {createT4OriginalVaultNodeSignaturePort} from '../src/network/original-vault-node-signature.mjs';
import {decodeOriginalNetworkRelayArgs,encodeOriginalNetworkRelayResult} from '../../t3-core/src/t3/original-kernel-native-relay-codec.mjs';
import {createT4OriginalNativeHostNetworkOwner} from '../src/network/original-native-host-network-owner.mjs';
import {createT4NetworkTopology,openT4NativeTopologyTransport} from '../src/network/network-topology.mjs';
import {createT4OriginalHostCaptureLedgerPort} from '../src/network/original-host-capture-ledger.mjs';
import {captureT4OriginalObjectMutation} from '../src/network/original-object-mutation-capture.mjs';
import {readT4OriginalEventWindow,digestT4OriginalEventRecord} from '../src/network/original-event-window.mjs';
import {readT4OriginalHostCapturedSubject,verifyT4OriginalHostCapturedSubjectSource} from '../src/network/original-host-outbox-delivery.mjs';
import {digestT4OriginalObjectContent} from '../src/network/original-object-delta.mjs';
import {decodeT4CandidateFrame,T4_ORIGINAL_SOURCE_SESSION_EXTENSION} from '../src/network/standard-network-wire-candidate.mjs';
const WS='ws:k14:subject',OWNER='owner:k14',S='node:k14:source',R='node:k14:recipient',
  SCOPE='scope:k14',SUITE='X25519_AES256GCM_ED25519';
const clone=x=>structuredClone(x),allow=async()=>true,deny=async()=>false;
const sha=x=>createHash('sha256').update(x).digest('hex');
const hash=x=>'sha256:'+sha(x);
const keyS=generateKeyPairSync('ed25519'),keyR=generateKeyPairSync('ed25519');
function kernelFixture(name){
  const rows=new Map(),events=[],graphReplays=new Map();let writes=0,graphInvocations=0;
  const kernel={hasOperation:()=>true,
    async getObject(ws,id){return clone(rows.get(ws+':'+id)??null)},
    async listObjects(q){return clone([...rows.values()].filter(r=>r.object.workspace_id===q.workspace_id).map(r=>r.object))},
    async listEventsSince(ws){return clone(events.filter(e=>e.workspace_id===ws))},
    async listAssets(){return []},
    async putObject(p){
      const key=p.workspace_id+':'+p.object_id,prev=rows.get(key)?.object;
      assert.equal(p.base_revision,prev?.revision??0);writes++;
      const object={workspace_id:p.workspace_id,object_id:p.object_id,schema_id:p.schema_id,
        schema_version:p.schema_version,revision:p.base_revision+1,deleted:false,data:clone(p.data),extensions:clone(p.extensions??{})};
      const event={workspace_id:p.workspace_id,object_id:p.object_id,revision:object.revision,
        event_id:'event:k14:'+name+':'+writes,event_type:p.event.event_type,payload:clone(p.event.payload??{}),
        service_id:'service:k14',occurred_at:new Date(Date.UTC(2026,10,24,0,0,writes)).toISOString()};
      rows.set(key,{object,relations:{incoming:[],outgoing:[]}});events.push(event);return {object,event};
    },
    async commitObjectGraph(p){
      graphInvocations++;
      const replayKey=p.workspace_id+':'+p.idempotency_key,prior=graphReplays.get(replayKey);
      if(prior){assert.deepEqual(p,prior.input);return clone({...prior.receipt,deduplicated:true});}
      const key=p.workspace_id+':'+p.object.object_id,previous=rows.get(key);
      assert.equal(p.object.base_revision,previous?.object.revision??0);writes++;
      const object={workspace_id:p.workspace_id,object_id:p.object.object_id,schema_id:p.object.schema_id,
        schema_version:p.object.schema_version,revision:p.object.base_revision+1,deleted:false,
        data:clone(p.object.data),extensions:{...previous?.object.extensions,...p.object.extensions}};
      rows.set(key,{object,relations:clone(previous?.relations??{incoming:[],outgoing:[]})});
      const puts=(p.relation_puts??[]).map(r=>({...r,workspace_id:p.workspace_id,created_by_service:'iwxa.workspace.relay'}));
      const deletes=(p.relation_deletes??[]).map(r=>r.relation_id);
      for(const row of rows.values())if(row.object.workspace_id===p.workspace_id){
        row.relations.incoming=row.relations.incoming.filter(r=>!deletes.includes(r.relation_id));
        row.relations.outgoing=row.relations.outgoing.filter(r=>!deletes.includes(r.relation_id));
      }
      for(const r of puts){
        rows.get(p.workspace_id+':'+r.from_object_id).relations.outgoing.push(r);
        rows.get(p.workspace_id+':'+r.to_object_id).relations.incoming.push(r);
      }
      const transaction_id='tx:k21:'+name+':'+writes;
      const event={workspace_id:p.workspace_id,object_id:object.object_id,revision:object.revision,
        event_id:'event:k14:'+name+':'+writes,event_type:p.event.event_type,payload:clone(p.event.payload??{}),
        service_id:'iwxa.workspace.relay',occurred_at:new Date(Date.UTC(2026,10,24,0,0,writes)).toISOString(),
        correlation_id:transaction_id,idempotency_key:p.idempotency_key};
      events.push(event);
      const receipt={workspace_id:p.workspace_id,transaction_id,object,event,relations_put:puts,
        relation_ids_deleted:deletes,deduplicated:false};
      graphReplays.set(replayKey,{input:clone(p),receipt:clone(receipt)});
      return clone(receipt);
    }
  };
  return {kernel,events,rows,get writes(){return writes},get graphInvocations(){return graphInvocations}};
}
function wireFixture(indexed=false){
  const frames=new Map(),indices=new Map();let puts=0,gets=0,lists=0;
  const address=(key,frameSha256)=>({schema:'IWXA_T4_NATIVE_FRAME_INDEX_READ_V1',key,frameSha256,addressMetadataIsNotSignatureOrAuthority:true,originalBusinessApplied:false});
  const wire={wireKind:'T4_NETWORK_CANDIDATE',forOriginalHostLifetime(){return this},
    async listNativeFrameAddresses(){
      lists++;const keys=[...frames.keys()].sort();
      return {schema:'IWXA_T4_NATIVE_FRAME_ADDRESS_LIST_V1',addresses:keys.map(key=>({key,sha256:key.slice(0,-4)})),
        listingDigest:sha(Buffer.concat([Buffer.from('IWXA-T4-FRAME-ADDRESS-LIST-V1\0'),Buffer.from(JSON.stringify(keys))])),
        collectionEnumerated:true,addressMetadataIsNotSignatureOrAuthority:true,originalBusinessApplied:false};
    },
    async getSnapshot({key,expectedSha256}){gets++;assert.equal(sha(frames.get(key)),expectedSha256);return {bytes:clone(frames.get(key))}},
    async putSnapshot({key,bytes,expectedSha256,createOnly}){
      assert.equal(createOnly,true);assert.equal(sha(bytes),expectedSha256);assert.equal(frames.has(key),false);
      puts++;frames.set(key,new Uint8Array(bytes));return {key,sha256:expectedSha256,state:'PUBLISHED_AND_READ_BACK'};
    },
    async inspectOutcome({key,expectedSha256}){
      if(!frames.has(key))throw Object.assign(Error('missing'),{code:'REMOTE_NOT_FOUND'});
      assert.equal(sha(frames.get(key)),expectedSha256);return {key,sha256:expectedSha256,state:'EXPECTED_BYTES_PRESENT'};
    }};
  if(indexed)Object.assign(wire,{nativeFrameIndexVersion:1,
    async getNativeFrameIndex({key}){return indices.has(key)?address(key,indices.get(key)):null;},
    async putNativeFrameIndex({key,frameSha256}){
      if(indices.has(key))assert.equal(indices.get(key),frameSha256);
      indices.set(key,frameSha256);return address(key,frameSha256);
    }});
  return {wire,frames,indices,get puts(){return puts},get gets(){return gets},get lists(){return lists}};
}
function scope(technicalWorkspaceId){return {technicalWorkspaceId,sourceWorkspaceId:WS,
  originalWriteOwnerRef:OWNER,sourceNodeRef:S,recipientNodeRef:R,scopeRef:SCOPE,ownerEpoch:2}}
const mutation=(objectId,title,eventType)=>({workspace_id:WS,object_id:objectId,schema_id:'iwxa.demo.note',
  schema_version:'1.0.0',base_revision:0,data:{title},extensions:{},event:{event_type:eventType,payload:{title}}});
async function sourceFixture(loseOriginalWrite=false){
  const f=kernelFixture('source'),tech='ws:k14:source:technical';
  const baselineEvent=(await f.kernel.putObject(mutation('o:k14:baseline','baseline','business.baseline'))).event;
  const before=(await readT4OriginalEventWindow({workspaceId:WS,originalWriteOwnerRef:OWNER,
    authorizeOriginalRead:allow,readOriginalEvents:()=>f.kernel.listEventsSince(WS),maxEvents:1})).nextCursor;
  const ledger=createT4OriginalHostCaptureLedgerPort({...scope(tech),originalKernel:f.kernel,
    getMode:()=> 'T4_NETWORK',readOriginalHostContext:async()=>({workspaceId:tech,originalWriteOwnerRef:OWNER,hostSessionRef:'host:fixture:capture'}),
    authorizeOriginalTechnicalRead:allow,authorizeOriginalTechnicalWrite:allow});
  const originalKernel=loseOriginalWrite?{...f.kernel,async putObject(p){
    const receipt=await f.kernel.putObject(p);
    if(p.workspace_id===WS)throw Object.assign(Error('lost original mutation response'),{code:'ACK_LOST'});
    return receipt;
  }}:f.kernel;
  const perform=()=>captureT4OriginalObjectMutation({...ledger,workspaceId:WS,objectId:'o:k14:change',
    originalWriteOwnerRef:OWNER,captureRef:'capture:k14:change',sourceCursor:before,
    mutationInput:mutation('o:k14:change','captured exact bytes','business.created'),
    originalKernel,authorizeOriginalRead:allow,authorizeOriginalWrite:allow,
    readOriginalEvents:()=>f.kernel.listEventsSince(WS),getMode:()=> 'T4_NETWORK'});
  let capture;
  if(loseOriginalWrite){
    await assert.rejects(perform(),{code:'OBJECT_CAPTURE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'});
    capture=await readT4OriginalEventWindow({workspaceId:WS,originalWriteOwnerRef:OWNER,
      cursor:before,authorizeOriginalRead:allow,readOriginalEvents:()=>f.kernel.listEventsSince(WS),maxEvents:1});
  }else capture=await perform();
  return {...f,technicalWorkspaceId:tech,before,capture,baselineEvent};
}
function nativeFixture({role,store,wire,baselineInput,source=null,phaseEvidence=deny,requestBaseline=true,
  localCapture=false,localGraph=false,localAdmission=allow,frameAdmission=allow,
  indexMigration=false,localResultVerification=false,technicalRead=allow,explicitResume=false,resumeInput=null,resumeAdmission=deny,
  nativeTopologyTransport=null,requireSignedTopologyAccess=false,originalVaultNodeSignaturePort=null,
  replacementRecovery=false,terminalRecovery=false,freshBaseline=null,peerHistoryRead=async()=>null,portOverrides={},canWake=()=>true,onResult=()=>{},testScopedVaultUnlock=false}){
  const tech=store.technicalWorkspaceId;
  const localOps=['t1.getObject','t1.listObjects','t1.listEventsSince','t1.putObject',
    't1.commitObjectGraph','t1.deleteObject','t1.listAssets','t1.getAsset','t1.putAsset','t1.deleteAsset','t1.putRelation','t1.deleteRelation'];
  const local=createTemporaryOriginalPersonalAuthority({workspaceId:WS,operations:localOps,clock:Date.now,testScopedVaultUnlock});
  const technical=createTemporaryOriginalPersonalAuthority({workspaceId:tech,
    operations:['t1.getObject','t1.putObject','t1.listObjects','t1.listEventsSince'],clock:Date.now,testScopedVaultUnlock});
  const results=[],commands=[];let epoch=1,admitted=true,mode='T4_NETWORK',failure=null,accessResolutions=0,
    clock=1000,signatureCalls=0;
  const originalPorts={authorizeOriginalBinding:async p=>admitted&&p.contextEpoch===epoch&&p.role===role&&
      p.sourceWorkspaceId===WS&&p.technicalWorkspaceId===tech&&p.scopeRef===SCOPE,
    resolveOriginalAccess:p=>{accessResolutions++;const q=p.args[0],ws=typeof q==='string'?q:q.workspace_id;
      return ws===WS?local.access:ws===tech?technical.access:null},
    authorizeOriginalTechnicalRead:technicalRead,authorizeOriginalTechnicalWrite:allow,
    authorizeOriginalBaselineAdmission:async p=>p.baseline.originalBaselineRef===baselineInput.originalBaselineRef,
    verifyOriginalBaselineEvidence:async p=>{
      const event=store.events.find(e=>e.event_id===p.baseline.originalBaselineRef);
      return !!event&&hash(JSON.stringify(event))===p.baseline.originalBaselineDigest&&
        JSON.stringify(p.baseline.sourceCursor)===JSON.stringify(baselineInput.sourceCursor);
    },
    authorizeOriginalHostTask:allow,authorizeOriginalRead:allow,authorizeOriginalWrite:allow,
    authorizeOriginalLocalMutation:localAdmission,
    authorizeOriginalReplacementOwnerHistoryRead:allow,authorizeOriginalPeerReplacementHistoryRead:allow,
    readOriginalPeerReplacementHistory:peerHistoryRead,authorizeOriginalHistoricalCursorRecovery:allow,
    authorizeOriginalHostWire:allow,authorizeOriginalNetwork:async p=>p.ownerEpoch===2&&p.scopeRef===SCOPE,
    authorizeOriginalFramePublish:frameAdmission,authorizeOriginalNetworkResume:resumeAdmission,
    verifyOriginalNodeSignature:async({signerRef,bytes,signature})=>{
      const k=signerRef==='key:k14:source'?keyS:signerRef==='key:k14:recipient'?keyR:null;
      return !!k&&verify(null,Buffer.from(bytes),k.publicKey,Buffer.from(signature));
    },
    resolveOriginalSigningContext:async()=>({permissionRef:'permission:k14',signerRef:role==='SOURCE'?'key:k14:source':'key:k14:recipient'}),
    signOriginalNodeBytes:async({bytes})=>{signatureCalls++;return sign(null,Buffer.from(bytes),role==='SOURCE'?keyS.privateKey:keyR.privateKey)},
    verifyOriginalPhaseEvidence:phaseEvidence,verifyOriginalRecipientApplied:deny,
    authorizeOriginalCaptureRecovery:async p=>role==='SOURCE'&&p.workspaceId===WS&&p.originalMutationRecoveryOnly===true,
    authorizeNetworkPublish:allow,authorizeOriginalSealedContent:deny,readOriginalSealedContent:async()=>{throw Error('unexpected content read')},
    authorizeNetworkReceive:allow,authorizeOriginalRecipientSession:allow,
    authorizeOriginalSourceRead:allow,readOriginalSourceEvents:()=>source.kernel.listEventsSince(WS),
    readOriginalSourceHostContext:async()=>({workspaceId:WS,originalWriteOwnerRef:OWNER,nodeRef:S,scopeRef:SCOPE,hostSessionRef:'host:k14:source:proof'}),
    verifyOriginalSourceSubject:deny,verifyOriginalSourceBinding:deny,verifyOriginalSourceEvent:deny,
    authorizeOriginalSealedOpen:deny,openOriginalSealedContent:async()=>{throw Error('unexpected sealed open')},
    readOriginalDependencyCoverage:async()=>null,withOriginalSubjectMutation:async(proof,action)=>{
      assert.equal(role,'SOURCE');
      if(!localCapture)assert.equal(proof.originalMutationRecoveryOnly,true);
      assert.equal(proof.originalHostMustSerializeAllWorkspaceGraphMutations,true);return action();
    },
  };
  Object.assign(originalPorts,portOverrides);
  if(freshBaseline!==null){delete originalPorts.authorizeOriginalBaselineAdmission;delete originalPorts.verifyOriginalBaselineEvidence;}
  if(originalVaultNodeSignaturePort)for(const k of ['verifyOriginalNodeSignature','resolveOriginalSigningContext','signOriginalNodeBytes'])
    delete originalPorts[k];
  const owner=createT4OriginalNativeHostNetworkOwner({...scope(tech),role,requiredCryptoSuite:SUITE,
    originalVaultNodeSignaturePort,requireOriginalVaultNodeSignature:originalVaultNodeSignaturePort!==null,
    getMode:()=>mode,...(nativeTopologyTransport?{nativeTopologyTransport}:{wireTransport:wire.wire}),originalPorts,enableLocalSourceCapture:localCapture,enablePublicationIndexMigration:indexMigration,monotonicNow:()=>clock,
    enableLocalRecipientResultVerification:localResultVerification,enableExplicitNetworkResume:explicitResume,readOriginalNetworkResumeInput:resumeInput,requireSignedTopologyAccess,
    enableLocalReplacementRecovery:replacementRecovery,enableReplacementTerminalRecovery:terminalRecovery,
    ...(freshBaseline===null?{readOriginalBaselineAdmissionInput:async()=>requestBaseline?baselineInput:null}:{originalFreshWorkspaceBaseline:freshBaseline}),
    onStep:r=>{results.push(r);onResult(r);}});
  const relay=createOriginalKernelNativeRelay({currentEpoch:()=>epoch,onAttach:()=>true,onDetach:()=>{local.closeOriginalVault();technical.closeOriginalVault();},networkOwner:{
    ...owner,async onIdleWake(p){try{if(canWake())await owner.onIdleWake(p)}catch(e){failure=e;throw e}}
  }});
  const info={contract_version:'1.3.0',runtime_version:'0.3.6',service_id:'iwxa.workspace.relay',mode:'ready',
    granted_operations:[...new Set(['t1.getWorkspace','t1.commitObjectGraph','t1.getObject','t1.listEventsSince',...owner.operations])]};
  const attach=async()=>{
    try{
      if(testScopedVaultUnlock)await Promise.all([local.unlockOriginalVault(),technical.unlockOriginalVault()]);
      return await relay.exchange({verb:'attach',payload:{sessionInfo:info,networkRelayVersion:1,
        ...(localCapture?{localSourceMutationVersion:1,...(localGraph?{localSourceGraphVersion:1}:{})}:{})}},epoch);
    }catch(error){local.closeOriginalVault();technical.closeOriginalVault();throw error;}
  };
  async function drive(session,target,after=0){
    // The production HTTP socket keeps the existing unref'ed long poll
    // alive. This in-process browser test has no socket, so bound its
    // lifetime with one test-only, referenced timeout.
    const deadline=setTimeout(()=>relay.close(),180000);
    try{while(!results.slice(after).some(r=>r.state===target)){
      if(failure)throw failure;
      const cmd=await relay.exchange({verb:'next',payload:{sessionId:session.sessionId}},epoch);
      if(failure)throw failure;
      if(cmd.kind==='IDLE')continue;
      commands.push(cmd);
      const method=cmd.method,args=decodeOriginalNetworkRelayArgs(method,cmd.args);
      assert.equal(typeof store.kernel[method],'function',method);
      const value=await store.kernel[method](...args);
      await relay.exchange({verb:'result',payload:{sessionId:session.sessionId,id:cmd.id,ok:true,
        result:encodeOriginalNetworkRelayResult(method,value)}},epoch);
    }}finally{clearTimeout(deadline);}
  }
  async function invokeLocal(session,method,input){
    const deadline=setTimeout(()=>relay.close(),180000);
    let settled=false,result,error;
    const request=relay.exchange({verb:'sourceMutation',payload:{sessionId:session.sessionId,method,args:[clone(input)]}},epoch)
      .then(v=>{result=v;settled=true},e=>{error=e;settled=true});
    try{
      while(!settled){
        // The native source operation runs concurrently with this very same
        // original Kernel command poll; no second mutation executor exists.
        const cmd=await relay.exchange({verb:'next',payload:{sessionId:session.sessionId}},epoch);
        if(cmd.kind==='IDLE')continue;
        commands.push(cmd);
        const args=decodeOriginalNetworkRelayArgs(cmd.method,cmd.args);
        const value=await store.kernel[cmd.method](...args);
        await relay.exchange({verb:'result',payload:{sessionId:session.sessionId,id:cmd.id,ok:true,
          result:encodeOriginalNetworkRelayResult(cmd.method,value)}},epoch);
      }
      await request;if(error)throw error;return result;
    }finally{clearTimeout(deadline);}
  }
  return {owner,relay,attach,drive,invokeLocal,results,commands,local,technical,get failure(){return failure},get accessResolutions(){return accessResolutions},
    revokeBinding(){admitted=false},disableMode(){mode='LOCAL_T3'},invalidate(){epoch++;relay.invalidate()},
    advanceClock(ms){clock+=ms},get signatureCalls(){return signatureCalls}};
}
for(const indexed of [false,true])test((indexed?'K23 indexed':'K14 existing')+' signed native relay drives original source baseline, captured intent and HEADS, then recipient DIFF',async()=>{
  const source=await sourceFixture(),wire=wireFixture(indexed);
  const baselineInput={sourceCursor:source.before,originalBaselineRef:source.baselineEvent.event_id,
    originalBaselineDigest:hash(JSON.stringify(source.baselineEvent))};
  const f=nativeFixture({role:'SOURCE',store:source,wire,baselineInput,
    phaseEvidence:async p=>p.phase==='INTENT'&&p.evidence.evidenceRef===source.capture.window.lastEventId&&
      p.evidence.evidenceDigest===source.capture.window.windowDigest});
  try{
    const s=await f.attach();assert.equal(s.networkRelayVersion,1);assert.equal(f.relay.networkAttached,true);
    assert.equal(f.commands.length,0);assert.equal(f.accessResolutions,0);
    for(const [op,args] of [['t1.getObject',['ws:foreign','o']],
      ['t1.putObject',[mutation('o:forbidden','forbidden','business.created')]],
      ['t1.putObject',[{workspace_id:source.technicalWorkspaceId,schema_id:'iwxa.demo.note',object_id:'o:forbidden'}]]]){
      assert.equal(await f.owner.resolveOriginalAccess({sessionId:s.sessionId,contextEpoch:s.contextEpoch,operation:op,args}),null);
    }
    assert.equal(f.accessResolutions,0);
    await f.drive(s,'HEADS_PRESENT');
    assert.ok(f.results.some(r=>r.state==='ADMITTED'));assert.ok(f.results.some(r=>r.state==='INTENT_RECORDED'));
    assert.ok(f.results.every(r=>r.sourceCursorAdvanced===false&&r.originalSubjectMutationInvoked===false));
    assert.equal(wire.puts,1);assert.equal(wire.frames.size,1);
    const head=decodeT4CandidateFrame([...wire.frames.values()][0]);
    assert.equal(head.messageType,'HEADS');assert.ok(head.criticalExtensions.includes(T4_ORIGINAL_SOURCE_SESSION_EXTENSION));
    assert.equal(head.body.sourceSession.sourceEventId,source.capture.window.lastEventId);
    assert.ok(f.local.proofCount>0);assert.ok(f.technical.proofCount>0);
    assert.equal(source.events.filter(e=>e.workspace_id===WS).length,2);
    assert.equal(source.events.filter(e=>e.event_type==='t4.network.original.baseline.admitted').length,1);
    assert.ok(f.commands.filter(c=>c.method==='putObject').every(c=>c.args[0].workspace_id===source.technicalWorkspaceId));
  }finally{f.relay.close();}
  const recipient=kernelFixture('recipient');recipient.technicalWorkspaceId='ws:k14:recipient:technical';
  const localBaseline=(await recipient.kernel.putObject(mutation('o:k14:baseline','baseline','business.baseline.materialized'))).event;
  const r=nativeFixture({role:'RECIPIENT',store:recipient,wire,source,
    baselineInput:{sourceCursor:source.before,originalBaselineRef:localBaseline.event_id,
      originalBaselineDigest:hash(JSON.stringify(localBaseline))}});
  try{
    const s=await r.attach();assert.equal(s.networkRelayVersion,1);
    await r.drive(s,'DIFF_PRESENT');
    assert.ok(r.results.some(x=>x.state==='ADMITTED'));assert.ok(r.results.every(x=>x.originalSubjectMutationInvoked===false));
    assert.equal(recipient.events.filter(e=>e.workspace_id===WS).length,1);
    assert.equal(wire.puts,2);
    assert.deepEqual([...wire.frames.values()].map(b=>decodeT4CandidateFrame(b).messageType),['HEADS','DIFF_REQUEST']);
    if(indexed){assert.equal(wire.indices.size,3);assert.equal(wire.lists,0);}
    assert.ok(r.technical.proofCount>0);
    assert.ok(r.commands.filter(c=>c.method==='putObject').every(c=>c.args[0].workspace_id===recipient.technicalWorkspaceId));
  }finally{r.relay.close();}
});
test('K14 missing original baseline remains waiting, never inferred from transport; revoked owner stops existing relay binding',async()=>{
  const store=kernelFixture('empty');store.technicalWorkspaceId='ws:k14:empty:technical';
  const wire=wireFixture(),f=nativeFixture({role:'SOURCE',store,wire,baselineInput:{},requestBaseline:false});
  try{
    const s=await f.attach();assert.equal(s.networkRelayVersion,1);
    await f.drive(s,'WAITING_FOR_ORIGINAL_BASELINE');assert.equal(store.writes,0);
    assert.equal(wire.puts,0);assert.equal(wire.gets,0);assert.equal(wire.lists,0);
    f.revokeBinding();
    await assert.rejects(f.owner.resolveOriginalAccess({sessionId:s.sessionId,contextEpoch:s.contextEpoch,
      operation:'t1.getObject',args:[store.technicalWorkspaceId,'o:k14:missing']}),
      e=>e?.code==='NATIVE_NETWORK_OWNER_ORIGINAL_BINDING_DENIED');
    f.invalidate();assert.equal(f.relay.networkAttached,false);
    assert.equal(await f.owner.resolveOriginalAccess({sessionId:s.sessionId,contextEpoch:s.contextEpoch,
      operation:'t1.getObject',args:[store.technicalWorkspaceId,'o:k14:missing']}),null);
  }finally{f.relay.close();}
});

test('K17 existing native source wake recovers original missing Outbox through signed relay, then publishes HEADS',async()=>{
  const source=await sourceFixture(true),wire=wireFixture();
  const f=nativeFixture({role:'SOURCE',store:source,wire,
    baselineInput:{sourceCursor:source.before,originalBaselineRef:source.baselineEvent.event_id,
      originalBaselineDigest:hash(JSON.stringify(source.baselineEvent))},
    phaseEvidence:async p=>p.phase==='INTENT'&&p.evidence.evidenceRef===source.capture.window.lastEventId&&
      p.evidence.evidenceDigest===source.capture.window.windowDigest});
  try{
    const s=await f.attach();
    await f.drive(s,'ORIGINAL_CAPTURE_RECONCILED');
    assert.equal(wire.puts,0);
    const recovery=f.results.find(r=>r.state==='ORIGINAL_CAPTURE_RECONCILED');
    assert.equal(recovery.originalSourceEventId,source.capture.window.lastEventId);
    assert.equal(recovery.originalSubjectMutationInvoked,false);
    assert.equal(source.events.filter(e=>e.workspace_id===WS).length,2);
    assert.ok(source.events.some(e=>e.payload?.role==='outbox'));
    await f.drive(s,'HEADS_PRESENT');
    assert.equal(wire.puts,1);
    assert.equal(decodeT4CandidateFrame([...wire.frames.values()][0]).body.sourceSession.sourceEventId,
      source.capture.window.lastEventId);
    assert.ok(f.commands.filter(c=>c.method==='putObject').every(c=>c.args[0].workspace_id===source.technicalWorkspaceId));
  }finally{f.relay.close();}
});

test('K17 original native relay accepts canonical base64url tokens beginning with hyphen or underscore',async()=>{
  const store=kernelFixture('session-identity');store.technicalWorkspaceId='ws:k14:token:technical';
  for(const first of [248,252]){
    const bytes=Buffer.alloc(32);bytes[0]=first;const sessionId=bytes.toString('base64url');
    assert.ok(sessionId.startsWith(first===248?'-':'_'));
    const wire=wireFixture(),f=nativeFixture({role:'SOURCE',store,wire,baselineInput:{},requestBaseline:false});
    const p={sessionId,contextEpoch:1,kernel:{...store.kernel,authorityMode:'ORIGINAL_T3_SIGNED',
      listAssets:async()=>[],getAsset:async()=>null},isHostActive:()=>true};
    try{
      assert.equal(await f.owner.onAttach(p),true);
      await f.owner.onIdleWake(p);
      const r=f.results.at(-1);
      assert.equal(r.state,'WAITING_FOR_ORIGINAL_BASELINE');
      assert.match(r.originalHostSessionRef,/^host:relay:[a-f0-9]{64}$/);
      assert.notEqual(r.originalHostSessionRef,sessionId);
      f.owner.onDetach(p);
      assert.equal(await f.owner.resolveOriginalAccess({sessionId,contextEpoch:1,operation:'t1.getObject',
        args:[store.technicalWorkspaceId,'o:absent']}),null);
    }finally{f.relay.close();}
  }
});

test('K20 existing native signed relay captures an explicitly admitted local source mutation without granting its network task subject write authority',async()=>{
  const store=kernelFixture('local-source');store.technicalWorkspaceId='ws:k20:technical';
  const baselineEvent=(await store.kernel.putObject(mutation('o:k20:baseline','baseline','business.baseline'))).event;
  const before=(await readT4OriginalEventWindow({workspaceId:WS,originalWriteOwnerRef:OWNER,
    authorizeOriginalRead:allow,readOriginalEvents:()=>store.kernel.listEventsSince(WS),maxEvents:1})).nextCursor;
  const wire=wireFixture(),f=nativeFixture({role:'SOURCE',store,wire,localCapture:true,
    baselineInput:{sourceCursor:before,originalBaselineRef:baselineEvent.event_id,originalBaselineDigest:hash(JSON.stringify(baselineEvent))}});
  try{
    const session=await f.attach();assert.equal(session.localSourceMutationVersion,1);
    assert.equal(session.localSourceWorkspaceId,WS);
    assert.ok(session.localSourceMutationMethods.includes('putObject'));
    assert.throws(()=>f.relay.nativeKernel.commitObjectGraph({workspace_id:WS,object:{object_id:'o:bypass'}}),
      {code:'T3_LOCAL_SOURCE_CAPTURE_OPERATION_NOT_SUPPORTED'});
    await assert.rejects(f.relay.exchange({verb:'sourceMutation',payload:{sessionId:session.sessionId,
      method:'putObject',args:[{...mutation('o:foreign','no','business.created'),workspace_id:'ws:foreign'}]}},session.contextEpoch),
      {code:'T3_ORIGINAL_LOCAL_SOURCE_MUTATION_SCOPE_DENIED'});
    await f.drive(session,'ADMITTED');
    // Wait for completion of the existing baseline wake before a local RPC.
    await new Promise(resolve=>setImmediate(resolve));
    const input=mutation('o:k20:captured','local original command','business.local.created');
    assert.equal(await f.owner.resolveOriginalAccess({sessionId:session.sessionId,contextEpoch:session.contextEpoch,
      operation:'t1.putObject',args:[input]}),null);
    const result=await f.invokeLocal(session,'putObject',input);
    assert.equal(result.state,'ORIGINAL_SOURCE_MUTATION_CAPTURED');
    assert.equal(result.originalReceipt.object.data.title,'local original command');
    assert.equal(result.originalT3OutboxVerified,true);assert.equal(result.networkPublished,false);
    const business=store.events.filter(e=>e.workspace_id===WS);
    assert.equal(business.length,2);
    assert.equal(business[1].payload.iwxa_t4_capture_ref,result.captureRef);
    assert.equal(store.events.filter(e=>e.payload?.role==='outbox').length,1);
    assert.equal(f.commands.filter(c=>c.method==='putObject'&&c.args[0].workspace_id===WS).length,1);
    assert.ok(f.local.proofCount>0);assert.ok(f.technical.proofCount>0);
    assert.equal(await f.owner.resolveOriginalAccess({sessionId:session.sessionId,contextEpoch:session.contextEpoch,
      operation:'t1.putObject',args:[input]}),null);
  }finally{f.relay.close();}
});
test('K20 local source route is opt-in and unavailable to an old relay handshake or foreign Workspace',async()=>{
  const source=await sourceFixture(),wire=wireFixture();
  const f=nativeFixture({role:'SOURCE',store:source,wire,
    baselineInput:{sourceCursor:source.before,originalBaselineRef:source.baselineEvent.event_id,originalBaselineDigest:hash(JSON.stringify(source.baselineEvent))}});
  try{
    const s=await f.attach();assert.equal(s.localSourceMutationVersion,undefined);
    await assert.rejects(f.relay.exchange({verb:'sourceMutation',payload:{sessionId:s.sessionId,
      method:'putObject',args:[mutation('o:k20:forbidden','x','business.created')]}},s.contextEpoch),
      {code:'T3_ORIGINAL_LOCAL_SOURCE_MUTATION_NOT_AVAILABLE'});
    assert.equal(source.events.filter(e=>e.workspace_id===WS).length,2);
  }finally{f.relay.close();}
});

test('K21 existing native signed relay captures atomic graph and returns original dedup receipt with one business Event',async()=>{
  const store=kernelFixture('local-graph');store.technicalWorkspaceId='ws:k21:native:technical';
  const baseId='o:k21:base',targetId='o:k21:new';
  const baselineEvent=(await store.kernel.putObject(mutation(baseId,'baseline','business.baseline'))).event;
  const before=(await readT4OriginalEventWindow({workspaceId:WS,originalWriteOwnerRef:OWNER,
    authorizeOriginalRead:allow,readOriginalEvents:()=>store.kernel.listEventsSince(WS),maxEvents:1})).nextCursor;
  const wire=wireFixture(),f=nativeFixture({role:'SOURCE',store,wire,localCapture:true,localGraph:true,
    baselineInput:{sourceCursor:before,originalBaselineRef:baselineEvent.event_id,
      originalBaselineDigest:hash(JSON.stringify(baselineEvent))}});
  try{
    const session=await f.attach();
    assert.equal(session.localSourceMutationVersion,1);
    assert.equal(session.localSourceGraphVersion,1);
    assert.ok(session.localSourceMutationMethods.includes('commitObjectGraph'));
    await f.drive(session,'ADMITTED');await new Promise(resolve=>setImmediate(resolve));
    const input={workspace_id:WS,idempotency_key:'original graph key',
      object:{object_id:targetId,schema_id:'iwxa.demo.note',schema_version:'1.0.0',
        base_revision:0,data:{title:'atomic graph'},extensions:{}},
      relation_puts:[{relation_id:'r:k21:local',from_object_id:targetId,to_object_id:baseId,kind:'related'}],
      relation_deletes:[],event:{event_type:'business.graph.created',payload:{}}};
    assert.equal(await f.owner.resolveOriginalAccess({sessionId:session.sessionId,contextEpoch:session.contextEpoch,
      operation:'t1.commitObjectGraph',args:[input]}),null);
    const first=await f.invokeLocal(session,'commitObjectGraph',input);
    assert.equal(first.state,'ORIGINAL_SOURCE_MUTATION_CAPTURED');assert.equal(first.originalT3OutboxVerified,true);
    assert.equal(first.originalReceipt.deduplicated,false);
    assert.equal(first.originalReceipt.relations_put.length,1);
    assert.equal(first.originalReceipt.event.correlation_id,first.originalReceipt.transaction_id);
    const again=await f.invokeLocal(session,'commitObjectGraph',input);
    assert.equal(again.captureRef,first.captureRef);assert.equal(again.originalReceipt.deduplicated,true);
    assert.equal(again.originalReceipt.transaction_id,first.originalReceipt.transaction_id);
    assert.equal(store.graphInvocations,2);
    assert.equal(store.events.filter(e=>e.workspace_id===WS).length,2);
    assert.equal(store.events.filter(e=>e.payload?.role==='outbox').length,1);
    assert.equal(store.events.filter(e=>e.payload?.role==='intent').length,1);
    assert.equal(f.commands.filter(c=>c.method==='commitObjectGraph').length,2);
    assert.ok(f.local.proofCount>0);assert.ok(f.technical.proofCount>0);
    const target=await store.kernel.getObject(WS,targetId),base=await store.kernel.getObject(WS,baseId);
    assert.deepEqual(target.relations.outgoing,base.relations.incoming);
  }finally{f.relay.close();}
});

function recoverySource(source,wire,options={}){
  return nativeFixture({role:'SOURCE',store:source,wire,
    baselineInput:{sourceCursor:source.before,originalBaselineRef:source.baselineEvent.event_id,
      originalBaselineDigest:hash(JSON.stringify(source.baselineEvent))},
    phaseEvidence:async p=>p.phase==='INTENT'&&p.evidence.evidenceRef===source.capture.window.lastEventId&&
      p.evidence.evidenceDigest===source.capture.window.windowDigest,...options});
}
test('K28 wake classification preserves exact typed transport cause and never retries a lost PRESENT slot, integrity or authority error',()=>{
  const transfer=(code,details)=>new T4TransferError(code,details);
  const wire=cause=>new T4CandidateFrameTransportError('WIRE_NETWORK_PUBLICATION_OUTCOME_UNKNOWN',{},cause);
  const publish=cause=>new T4OriginalNetworkPublicationError('PUBLICATION_NETWORK_OUTCOME_UNKNOWN',{},cause);
  const missing=(state,limit=false)=>new T4OriginalNetworkPublicationError('PUBLICATION_PRIOR_NETWORK_OUTCOME_UNRESOLVED',
    {priorState:state,attemptLimitReached:limit},transfer('REMOTE_NOT_FOUND'));
  for(const error of [transfer('NETWORK_UNAVAILABLE'),transfer('REMOTE_INDEX_READ_FAILED',{status:503}),
    publish(wire(transfer('OUTCOME_UNKNOWN',{operation:'PUT'}))),missing('ATTEMPTED')])
    assert.equal(isT4RecoverablePublicationWakeError(error),true,error.code);
  for(const error of [transfer('REMOTE_AUTHORIZATION_DENIED'),transfer('DIGEST_MISMATCH'),
    transfer('REMOTE_READ_FAILED',{status:400}),publish(wire(transfer('REMOTE_AUTHORIZATION_DENIED'))),
    missing('PRESENT'),missing('ATTEMPTED',true),Object.assign(Error('fake'),{code:'NETWORK_UNAVAILABLE'}),
    new T4OriginalNetworkPublicationError('PUBLICATION_ORIGINAL_CAS_OUTCOME_UNKNOWN',{},transfer('NETWORK_UNAVAILABLE'))])
    assert.equal(isT4RecoverablePublicationWakeError(error),false,error.code);
});
for(const failurePoint of ['after-frame','before-frame','after-index'])test('K28 existing signed relay resumes '+failurePoint+' after transport loss without re-signing or repeating subject writes',async()=>{
  const source=await sourceFixture(),wire=wireFixture(true);
  let offline=true,attempts=0,retryGrants=0,indexAttempts=0;
  const originalPut=wire.wire.putSnapshot,originalIndex=wire.wire.putNativeFrameIndex,originalInspect=wire.wire.inspectOutcome;
  wire.wire.putSnapshot=async p=>{
    attempts++;
    if(offline&&failurePoint==='before-frame')throw new T4TransferError('OUTCOME_UNKNOWN',{operation:'PUT'});
    const r=await originalPut(p);
    if(offline&&failurePoint==='after-frame')throw new T4TransferError('OUTCOME_UNKNOWN',{operation:'PUT'});
    return r;
  };
  wire.wire.putNativeFrameIndex=async p=>{
    indexAttempts++;const r=await originalIndex(p);
    if(offline&&failurePoint==='after-index')throw new T4TransferError('OUTCOME_UNKNOWN',{operation:'PUT'});
    return r;
  };
  wire.wire.inspectOutcome=async p=>{
    if(offline)throw new T4TransferError('NETWORK_UNAVAILABLE');
    if(!wire.frames.has(p.key))throw new T4TransferError('REMOTE_NOT_FOUND');
    return originalInspect(p);
  };
  const f=recoverySource(source,wire,{frameAdmission:async p=>{
    if(p.operation==='t4.network.publish.retry-missing')retryGrants++;
    return true;
  }});
  try{
    const session=await f.attach();
    await f.drive(session,'NETWORK_WAKE_RECOVERY_WAIT');
    assert.equal(f.relay.networkAttached,true);assert.equal(f.signatureCalls,1);
    assert.equal(attempts,1);assert.equal(f.results.at(-1).retryAfterMs,5000);
    const first=f.results.length;
    f.advanceClock(5000);
    await f.drive(session,'NETWORK_WAKE_RECOVERY_WAIT',first);
    assert.equal(f.results.at(-1).retryAfterMs,10000);
    assert.equal(attempts,1);assert.equal(f.signatureCalls,1);
    offline=false;f.advanceClock(10000);
    await f.drive(session,'HEADS_PRESENT');
    assert.equal(f.relay.networkAttached,true);assert.equal(f.signatureCalls,1);
    assert.equal(attempts,failurePoint==='before-frame'?2:1);
    assert.equal(retryGrants,failurePoint==='before-frame'?1:0);
    assert.equal(wire.puts,1);assert.equal(wire.indices.size,2);assert.equal(indexAttempts,2);
    assert.equal(source.events.filter(e=>e.workspace_id===WS).length,2);
    assert.ok(f.commands.filter(c=>c.method==='putObject').every(c=>c.args[0].workspace_id===source.technicalWorkspaceId));
  }finally{f.relay.close();}
});
test('K28 cold signed owner requires original explicit retry grant after exact missing ATTEMPTED frame',async()=>{
  const source=await sourceFixture(),wire=wireFixture(true);
  let attempts=0,retryGrants=0;
  const originalPut=wire.wire.putSnapshot;
  wire.wire.putSnapshot=async()=>{attempts++;throw new T4TransferError('OUTCOME_UNKNOWN',{operation:'PUT'});};
  wire.wire.inspectOutcome=async()=>{throw new T4TransferError('REMOTE_NOT_FOUND');};
  const first=recoverySource(source,wire);
  try{const s=await first.attach();await first.drive(s,'NETWORK_WAKE_RECOVERY_WAIT');
    assert.equal(first.signatureCalls,1);
  }finally{first.relay.close();}
  wire.wire.putSnapshot=async p=>{attempts++;return originalPut(p);};
  const next=recoverySource(source,wire,{localCapture:true,frameAdmission:async p=>{
    if(p.operation==='t4.network.publish.retry-missing'){retryGrants++;return false;}
    return true;
  }});
  try{
    const s=await next.attach();await next.drive(s,'NETWORK_WAKE_RECOVERY_WAIT');
    assert.equal(next.signatureCalls,0);assert.equal(attempts,1);
    next.advanceClock(5000);await next.drive(s,'NETWORK_WAKE_SUSPENDED');
    assert.equal(retryGrants,1);assert.equal(attempts,1);assert.equal(next.signatureCalls,0);
    assert.equal(next.relay.networkAttached,true);
    assert.equal(source.events.filter(e=>e.workspace_id===WS).length,2);
  }finally{next.relay.close();}
});
test('K28 recipient reuses original native owner after a temporary indexed discovery failure',async()=>{
  const source=await sourceFixture(),wire=wireFixture(true),sender=recoverySource(source,wire);
  try{const s=await sender.attach();await sender.drive(s,'HEADS_PRESENT');}
  finally{sender.relay.close();}
  const recipient=kernelFixture('recipient-recovery');recipient.technicalWorkspaceId='ws:k28:recipient:technical';
  const e=(await recipient.kernel.putObject(mutation('o:k14:baseline','baseline','business.baseline.materialized'))).event;
  const originalIndex=wire.wire.getNativeFrameIndex;let offline=true;
  wire.wire.getNativeFrameIndex=async p=>{
    if(offline)throw new T4TransferError('REMOTE_INDEX_READ_FAILED',{status:503});
    return originalIndex(p);
  };
  const f=nativeFixture({role:'RECIPIENT',store:recipient,wire,source,
    baselineInput:{sourceCursor:source.before,originalBaselineRef:e.event_id,originalBaselineDigest:hash(JSON.stringify(e))}});
  try{
    const s=await f.attach();await f.drive(s,'NETWORK_WAKE_RECOVERY_WAIT');
    assert.equal(f.relay.networkAttached,true);assert.equal(f.signatureCalls,0);
    assert.equal(wire.puts,1);assert.equal(f.results.at(-1).originalSubjectMutationMayHaveCommitted,true);
    offline=false;f.advanceClock(5000);
    await f.drive(s,'DIFF_PRESENT');
    assert.equal(f.relay.networkAttached,true);assert.equal(f.signatureCalls,1);
    assert.equal(wire.puts,2);assert.equal(recipient.events.filter(x=>x.workspace_id===WS).length,1);
  }finally{f.relay.close();}
});
test('K28 permanent transport authorization failure is not a reconnectable wake',async()=>{
  const source=await sourceFixture(),wire=wireFixture(true);
  let attempts=0;
  wire.wire.putSnapshot=async()=>{attempts++;throw new T4TransferError('REMOTE_AUTHORIZATION_DENIED');};
  const f=recoverySource(source,wire,{localCapture:true});
  try{
    const s=await f.attach();await f.drive(s,'NETWORK_WAKE_SUSPENDED');
    assert.equal(f.results.some(x=>x.state==='NETWORK_WAKE_RECOVERY_WAIT'),false);
    assert.equal(f.relay.networkAttached,true);assert.equal(attempts,1);assert.equal(f.signatureCalls,1);
    assert.equal(source.events.filter(e=>e.workspace_id===WS).length,2);
  }finally{f.relay.close();}
});

test('K30 native original source and recipient migrate their legacy publications and recover a lost address response without re-signing',async()=>{
  const source=await sourceFixture(),wire=wireFixture(true);
  wire.wire.nativeFrameIndexVersion=0;
  const sender=recoverySource(source,wire);
  try{const s=await sender.attach();await sender.drive(s,'HEADS_PRESENT');}
  finally{sender.relay.close();}
  const recipient=kernelFixture('recipient-migration');recipient.technicalWorkspaceId='ws:k30:recipient:technical';
  const baseline=(await recipient.kernel.putObject(mutation('o:k14:baseline','baseline','business.baseline.materialized'))).event;
  const recipientFixture=options=>nativeFixture({role:'RECIPIENT',store:recipient,wire,source,
    baselineInput:{sourceCursor:source.before,originalBaselineRef:baseline.event_id,
      originalBaselineDigest:hash(JSON.stringify(baseline))},...options});
  const receiver=recipientFixture();
  try{const s=await receiver.attach();await receiver.drive(s,'DIFF_PRESENT');}
  finally{receiver.relay.close();}
  assert.equal(wire.puts,2);assert.equal(wire.indices.size,0);
  const originalFrames=clone([...wire.frames]),sourceEvents=clone(source.events),recipientEvents=clone(recipient.events);
  wire.wire.nativeFrameIndexVersion=1;
  const putIndex=wire.wire.putNativeFrameIndex;let calls=0,lose=true,grants=0;
  wire.wire.putNativeFrameIndex=async p=>{
    calls++;const result=await putIndex(p);
    if(lose){lose=false;throw new T4TransferError('OUTCOME_UNKNOWN',{operation:'PUT'});}
    return result;
  };
  const sourceMigration=()=>recoverySource(source,wire,{indexMigration:true,frameAdmission:async p=>{
    if(p.operation==='t4.network.publish.index.migrate')grants++;
    return true;
  }});
  const first=sourceMigration();
  try{
    const s=await first.attach();await first.drive(s,'NETWORK_WAKE_RECOVERY_WAIT');
    assert.equal(first.relay.networkAttached,true);assert.equal(wire.indices.size,1);assert.equal(calls,1);
    assert.equal(first.signatureCalls,0);assert.deepEqual(source.events,sourceEvents);
    first.advanceClock(5000);await first.drive(s,'NETWORK_INDEX_MIGRATION_COMPLETE');
    assert.equal(first.results.at(-1).migratedPublicationCount,1);
    assert.equal(first.results.at(-1).verifiedMigratedFrameCount,1);
    assert.equal(wire.indices.size,2);assert.equal(calls,2);assert.equal(first.signatureCalls,0);
    assert.ok(grants>0);
  }finally{first.relay.close();}
  const second=recipientFixture({indexMigration:true});
  try{
    const s=await second.attach();await second.drive(s,'NETWORK_INDEX_MIGRATION_COMPLETE');
    assert.equal(second.results.at(-1).migratedPublicationCount,1);
    assert.equal(second.results.at(-1).verifiedMigratedFrameCount,1);
    assert.equal(second.signatureCalls,0);assert.equal(wire.indices.size,3);assert.equal(calls,3);
  }finally{second.relay.close();}
  const cold=sourceMigration();
  try{
    const s=await cold.attach();await cold.drive(s,'NETWORK_INDEX_MIGRATION_COMPLETE');
    assert.equal(cold.signatureCalls,0);assert.equal(calls,3);
  }finally{cold.relay.close();}
  assert.equal(wire.puts,2);assert.deepEqual([...wire.frames],originalFrames);
  assert.deepEqual(source.events,sourceEvents);assert.deepEqual(recipient.events,recipientEvents);
});
test('K30 original owner must separately authorize publication migration inventory; no network access on denial',async()=>{
  const source=await sourceFixture(),wire=wireFixture(true);
  const f=recoverySource(source,wire,{indexMigration:true,localCapture:true,
    technicalRead:async p=>p.purpose!=='index-migration-inventory'});
  try{
    const s=await f.attach();await f.drive(s,'NETWORK_WAKE_SUSPENDED');
    assert.ok(f.results.some(r=>r.state==='ADMITTED'));
    assert.equal(wire.puts,0);assert.equal(wire.gets,0);assert.equal(wire.lists,0);
    assert.equal(f.signatureCalls,0);assert.equal(f.relay.networkAttached,true);
  }finally{f.relay.close();}
});

test('K30 final native migration refuses a changed original inventory even without revision or terminal hash change',async()=>{
  const source=await sourceFixture(),wire=wireFixture(true);
  wire.wire.nativeFrameIndexVersion=0;
  const sender=recoverySource(source,wire);
  try{const s=await sender.attach();await sender.drive(s,'HEADS_PRESENT');}
  finally{sender.relay.close();}
  wire.wire.nativeFrameIndexVersion=1;
  const originalList=source.kernel.listObjects;let catalogReads=0;
  source.kernel.listObjects=async q=>{
    const objects=await originalList(q);
    if(q.workspace_id===source.technicalWorkspaceId&&q.include_deleted===true&&
      objects.some(o=>o.object_id.startsWith('t4:net:publish:'))&&++catalogReads===2){
      const row=objects.find(o=>o.object_id.startsWith('t4:net:publish:'));
      row.data.title='different original catalog evidence';
    }
    return objects;
  };
  const f=recoverySource(source,wire,{indexMigration:true,localCapture:true});
  try{
    const s=await f.attach();await f.drive(s,'NETWORK_WAKE_SUSPENDED');
    assert.equal(catalogReads,2);
    assert.equal(f.results.some(r=>r.state==='NETWORK_INDEX_MIGRATION_COMPLETE'),false);
    assert.equal(f.signatureCalls,0);assert.equal(wire.puts,1);assert.equal(wire.indices.size,2);
    assert.equal(f.relay.networkAttached,true);
  }finally{f.relay.close();}
});

function resumeDecision(request,overrides={}){
  return {schema:'IWXA_T4_ORIGINAL_NETWORK_RESUME_DECISION_V1',
    resumeRequestRef:request.resumeRequestRef,originalHostSessionRef:request.originalHostSessionRef,
    contextEpoch:request.contextEpoch,decisionRef:'decision:k33:explicit',
    resolutionEvidenceRef:'evidence:k33:owner-resolution',resume:true,...overrides};
}
test('K33 original signed source resumes a deliberate suspension only on an exact authorized decision, not a frame retry grant',async()=>{
  const source=await sourceFixture(),wire=wireFixture(true);
  const originalPut=wire.wire.putSnapshot,originalInspect=wire.wire.inspectOutcome;
  let attempts=0,blocked=true,pending=null,admitted=false,decisions=0,retryGrants=0;
  wire.wire.putSnapshot=async p=>{
    attempts++;if(blocked)throw new T4TransferError('REMOTE_AUTHORIZATION_DENIED');return originalPut(p);
  };
  wire.wire.inspectOutcome=async p=>{
    if(!wire.frames.has(p.key))throw new T4TransferError('REMOTE_NOT_FOUND');
    return originalInspect(p);
  };
  const f=recoverySource(source,wire,{localCapture:true,explicitResume:true,
    resumeInput:async()=>{const value=pending;pending=null;return value;},
    resumeAdmission:async p=>{
      decisions++;assert.equal(p.operation,'t4.network.original.host.resume');
      assert.equal(p.originalFrameRetryAllowed,false);assert.equal(p.originalSubjectMutationAllowed,false);
      assert.equal(p.decision.resolutionEvidenceRef,'evidence:k33:owner-resolution');return admitted;
    },
    frameAdmission:async p=>{if(p.operation==='t4.network.publish.retry-missing')retryGrants++;return true;}
  });
  try{
    const s=await f.attach();await f.drive(s,'NETWORK_WAKE_SUSPENDED');
    const suspended=f.results.find(x=>x.state==='NETWORK_WAKE_SUSPENDED');
    assert.ok(suspended.resumeRequestRef);assert.equal(attempts,1);assert.equal(f.signatureCalls,1);
    assert.equal(wire.puts,0);assert.equal(f.relay.networkAttached,true);
    const technicalBefore=clone(source.events);
    blocked=false;
    // Wrong suspension or lifetime cannot consume the original decision.
    pending=resumeDecision(suspended,{originalHostSessionRef:'host:stale'});
    let start=f.results.length;await f.drive(s,'NETWORK_RESUME_DECISION_REJECTED',start);
    assert.equal(f.results.at(-1).reason,'ORIGINAL_RESUME_DECISION_INVALID');assert.equal(decisions,0);
    pending=resumeDecision(suspended);start=f.results.length;
    await f.drive(s,'NETWORK_RESUME_DECISION_REJECTED',start);
    assert.equal(f.results.at(-1).reason,'ORIGINAL_RESUME_AUTHORITY_DENIED');assert.equal(decisions,1);
    assert.equal(attempts,1);assert.equal(f.signatureCalls,1);assert.deepEqual(source.events,technicalBefore);
    admitted=true;pending=resumeDecision(suspended);start=f.results.length;
    await f.drive(s,'NETWORK_WAKE_RESUMED',start);
    assert.equal(f.results.at(-1).originalDurableEvidenceRecheckRequired,true);
    assert.equal(f.results.at(-1).originalFrameRetryAllowed,false);assert.equal(decisions,2);
    assert.equal(attempts,1);assert.equal(retryGrants,0);assert.deepEqual(source.events,technicalBefore);
    // Even a valid owner resume is not an explicit original retry-missing
    // decision. First reconstruct the exact ATTEMPTED record and prove 404.
    await f.drive(s,'NETWORK_WAKE_RECOVERY_WAIT',start);
    assert.equal(attempts,1);assert.equal(retryGrants,0);assert.equal(f.signatureCalls,1);
    f.advanceClock(5000);await f.drive(s,'HEADS_PRESENT',start);
    assert.equal(attempts,2);assert.equal(retryGrants,1);assert.equal(wire.puts,1);
    assert.equal(f.signatureCalls,1);assert.equal(f.relay.networkAttached,true);
    assert.equal(source.events.filter(e=>e.workspace_id===WS).length,2);
    const publication=[...source.rows.values()].find(row=>row.object.object_id.startsWith('t4:net:publish:'));
    assert.equal(publication.object.data.entries[0].attempts,2);
    assert.equal(publication.object.data.entries[0].state,'PRESENT');
  }finally{f.relay.close();}
});
test('K33 original signed recipient retains no automatic write permission while a deliberate network suspension awaits owner resolution',async()=>{
  const source=await sourceFixture(),wire=wireFixture(true),sender=recoverySource(source,wire);
  try{const s=await sender.attach();await sender.drive(s,'HEADS_PRESENT');}
  finally{sender.relay.close();}
  const recipient=kernelFixture('recipient-resume');recipient.technicalWorkspaceId='ws:k33:recipient:technical';
  const e=(await recipient.kernel.putObject(mutation('o:k14:baseline','baseline','business.baseline.materialized'))).event;
  const originalIndex=wire.wire.getNativeFrameIndex;let blocked=true,pending=null,decisions=0;
  wire.wire.getNativeFrameIndex=async p=>{
    if(blocked)throw new T4TransferError('REMOTE_AUTHORIZATION_DENIED');return originalIndex(p);
  };
  const f=nativeFixture({role:'RECIPIENT',store:recipient,wire,source,explicitResume:true,
    baselineInput:{sourceCursor:source.before,originalBaselineRef:e.event_id,originalBaselineDigest:hash(JSON.stringify(e))},
    resumeInput:async()=>{const value=pending;pending=null;return value;},
    resumeAdmission:async p=>{decisions++;return p.role==='RECIPIENT'&&p.originalFrameRetryAllowed===false;}
  });
  try{
    const s=await f.attach();await f.drive(s,'NETWORK_WAKE_SUSPENDED');
    const suspended=f.results.find(x=>x.state==='NETWORK_WAKE_SUSPENDED');
    assert.equal(suspended.originalSubjectMutationMayHaveCommitted,true);
    assert.equal(f.signatureCalls,0);assert.equal(wire.puts,1);assert.equal(f.relay.networkAttached,true);
    blocked=false;pending=resumeDecision(suspended,{resumeRequestRef:'t4:resume:old'});
    let start=f.results.length;await f.drive(s,'NETWORK_RESUME_DECISION_REJECTED',start);
    assert.equal(decisions,0);assert.equal(f.signatureCalls,0);assert.equal(wire.puts,1);
    pending=resumeDecision(suspended);start=f.results.length;await f.drive(s,'NETWORK_WAKE_RESUMED',start);
    assert.equal(decisions,1);assert.equal(wire.puts,1);
    await f.drive(s,'DIFF_PRESENT',start);
    assert.equal(wire.puts,2);assert.equal(f.signatureCalls,1);
    assert.equal(recipient.events.filter(x=>x.workspace_id===WS).length,1);
  }finally{f.relay.close();}
});

test('K34 existing signed native Host uses an admitted T4.1 topology transport and suspends on changed original topology without retargeting',async()=>{
  const source=await sourceFixture(),server='node:k34:server',location='loc:k34:server',family='family:k34:wire';
  const caps=['network.frame.publish','network.frame.read','network.frame.index.publish','network.frame.index.read'];
  const topology=createT4NetworkTopology({topologyRef:'topology:k34',revision:1,localNodeRef:S,
    nodes:[{nodeRef:S,kind:'LOCAL_DEVICE',subjectRef:OWNER,operatorRef:OWNER,locationRef:'loc:k34:local',
      availability:'AVAILABLE',advertisedCapabilities:[]},
      {nodeRef:server,kind:'PERSONAL_SERVER',subjectRef:OWNER,operatorRef:OWNER,locationRef:location,
        profileRef:'profile:k34',availability:'AVAILABLE',advertisedCapabilities:caps}],
    profiles:[{profileRef:'profile:k34',mode:'SELF_HOSTED',operatorRef:OWNER,locationRef:location,
      endpointUrl:'https://native.example.test/dav/'}],
    connections:[{connectionRef:'link:k34',sourceNodeRef:S,targetNodeRef:server,profileRef:'profile:k34',
      state:'READY',capabilities:caps,objectFamilies:[family]}],
    placements:[{policy:{objectFamily:family,workspaceId:WS,authorityRoot:OWNER,writeOwnerRef:OWNER,
      primaryPlacement:'LOCAL_PRIMARY_HOSTED_REPLICA',allowedLocations:['loc:k34:local',location],
      retentionClass:'test',recoveryClass:'test',universalCloudMaster:false,subjectActionAuthority:false},
      primaryNodeRef:S,replicaNodeRefs:[server]}]});
  let current=topology,requests=0,credentials=0,peerHistoryReads=0;const records=new Map();
  let registry=null,vaultReads=0;
  const routeAuthority=createTemporaryOriginalPersonalAuthority({workspaceId:WS,
    operations:[...caps.map(c=>'t4.'+c),'t4.network.node.sign','t4.network.node.verify'],
    purpose:'network.synchronization',clock:Date.now});
  const vault=emptyVault(),peerVault=emptyVault(),sourceKey='key:k34:network:source',peerKey='key:k34:network:peer';
  const ownKey=generateVaultKey(vault,{keyId:sourceKey,subjectId:'person:local'}),
    otherKey=generateVaultKey(peerVault,{keyId:peerKey,subjectId:'person:local'});
  const initial=routeAuthority.snapshotSignedState(),now=Date.now();
  for(const key of [ownKey,otherKey])initial.policy.keys[key.keyId]={subjectId:key.subjectId,environment:'TEST',
    publicKey:key.publicKeyPem,status:'ACTIVE',uses:['NETWORK_FRAME'],
    notBefore:new Date(now-60000).toISOString(),expiresAt:new Date(now+600000).toISOString()};
  // SAME fixture Kernel as the captured Workspace and technical publication
  // ledger, not a second runtime or independent registry implementation.
  registry=createOriginalKernelRegistryStatePort({kernel:{...source.kernel,sessionInfo:{contract_version:'1.3.0'}},
    workspaceId:'ws:k34:registry',trustedPolicy:initial.policy,clock:Date.now});
  await registry.commitSignedState(initial);
  const bound=routeAuthority.bindOriginalRegistry(registry);
  const passphrase='K34_TEST_ONLY_DEDICATED_VAULT_PASSPHRASE',encrypted=encryptVault(vault,passphrase);
  const originalVaultNodeSignaturePort=createT4OriginalVaultNodeSignaturePort({
    workspaceId:WS,originalWriteOwnerRef:OWNER,localNodeRef:S,remoteNodeRef:R,scopeRef:SCOPE,ownerEpoch:2,
    requiredCryptoSuite:SUITE,localKeyRef:sourceKey,remoteKeyRef:peerKey,registry,...bound,
    expectedContext:bound.access.currentContext(),getMode:()=> 'T4_NETWORK',
    readOriginalNodeKeyBinding:async p=>({bindingRef:'binding:'+p.sourceNodeRef,subjectId:'person:local',
      permissionRef:'permission:k14',keyId:p.signerRef,nodeRef:p.sourceNodeRef,recipientNodeRef:p.recipientNodeRef,
      workspaceId:WS,originalWriteOwnerRef:OWNER,scopeRef:SCOPE,ownerEpoch:2,active:true}),
    readEncryptedVault:async()=>{vaultReads++;return encrypted;},
    unlockPassphrase:async()=>passphrase});
  const openTransport=access=>openT4NativeTopologyTransport({topology,workspaceId:WS,objectFamily:family,serverNodeRef:server,
    originalSignedAccess:{access,expectedContext:access.currentContext()},
    nativeWireProfile:'INDEXED',readOriginalTopology:async()=>current,getMode:()=> 'T4_NETWORK',
    verifyOriginalEndpoint:async p=>p.endpointUrl==='https://native.example.test/dav/'&&p.originalWriteOwnerRef===OWNER,
    authorizeOriginalOperation:async p=>p.originalWriteOwnerRef===OWNER&&p.storageLocationIsNotProtocolPeer&&
      p.originalSignedSubject?.principal_id==='person:local'&&p.originalSignedSubject?.workspace_id===WS,
    getAuthorizationHeader:async()=>{credentials++;return 'Bearer test';},
    fetchImpl:async(url,options)=>{
      requests++;assert.equal(url.origin,'https://native.example.test');
      const k=url.pathname.split('/').at(-1);
      if(options.method==='GET')return records.has(k)?new Response(records.get(k)):new Response(null,{status:404});
      assert.equal(options.method,'PUT');assert.equal(options.headers['If-None-Match'],'*');
      if(records.has(k))return new Response(null,{status:412});
      records.set(k,Buffer.from(options.body));return new Response(null,{status:201});
    }});
  // Even with identical signed context and original Registry, a different
  // assembled Access Host port is not the exact route/signer binding.
  const foreignAccess=routeAuthority.bindOriginalRegistry(registry).access;
  const mismatchedTransport=openTransport(foreignAccess);
  try{
    assert.deepEqual(mismatchedTransport.originalSignedSubject,originalVaultNodeSignaturePort.originalSignedSubject);
    assert.throws(()=>recoverySource(source,null,{nativeTopologyTransport:mismatchedTransport,localCapture:true,
      requireSignedTopologyAccess:true,originalVaultNodeSignaturePort}),{code:'NATIVE_NETWORK_OWNER_SIGNED_SUBJECT_MISMATCH'});
    assert.equal(requests,0);assert.equal(credentials,0);assert.equal(vaultReads,0);
  }finally{mismatchedTransport.close();}
  const transport=openTransport(bound.access);
  assert.throws(()=>createT4OriginalNativeHostNetworkOwner({enableReplacementTerminalRecovery:true}),
    {code:'NATIVE_NETWORK_OWNER_REPLACEMENT_TERMINAL_PROFILE_INVALID'});
  assert.throws(()=>recoverySource(source,null,{nativeTopologyTransport:transport,localCapture:true,requireSignedTopologyAccess:true,
    originalVaultNodeSignaturePort,replacementRecovery:true,terminalRecovery:true}),
    {code:'NATIVE_NETWORK_OWNER_LOCAL_REPLACEMENT_PROFILE_INVALID'});
  const f=recoverySource(source,null,{nativeTopologyTransport:transport,localCapture:true,requireSignedTopologyAccess:true,
    originalVaultNodeSignaturePort,peerHistoryRead:async()=>{peerHistoryReads++;return null;}});
  try{
    const s=await f.attach();await f.drive(s,'HEADS_PRESENT');
    assert.equal(f.owner.originalReplacementTerminalRecoveryEnabled,undefined);assert.equal(peerHistoryReads,0);
    assert.equal(f.owner.originalTopologyBinding.topologyDigest,topology.topologyDigest);
    assert.equal(f.owner.originalSignedTopologyAccess,true);
    assert.equal(f.owner.originalVaultNodeIdentity.localKeyRef,sourceKey);
    assert.ok(routeAuthority.proofCount>0);
    assert.equal(routeAuthority.registryReads,0); // no arbitrary readState path
    assert.equal(f.owner.originalTopologyBinding.serverNodeRef,server);
    assert.equal(f.owner.identity.recipientNodeRef,R);
    assert.equal([...records.keys()].filter(k=>k.endsWith('.t4n')).length,1);
    assert.equal([...records.keys()].filter(k=>k.endsWith('.t4i')).length,2);
    const frame=decodeT4CandidateFrame([...records].find(([k])=>k.endsWith('.t4n'))[1]);
    assert.equal(frame.sourceNodeRef,S);assert.equal(frame.recipientNodeRef,R);
    assert.equal(frame.signerRef,sourceKey);assert.equal(vaultReads,1);assert.equal(f.signatureCalls,0);
    const count=requests,creds=credentials,start=f.results.length;
    current=createT4NetworkTopology({...topology,revision:2,previousTopologyDigest:topology.topologyDigest});
    await f.drive(s,'NETWORK_WAKE_SUSPENDED',start);
    assert.equal(requests,count);assert.equal(credentials,creds);assert.equal(vaultReads,1);assert.equal(f.signatureCalls,0);assert.equal(peerHistoryReads,0);
    assert.equal(f.relay.networkAttached,true);
    assert.equal(source.events.filter(e=>e.workspace_id===WS).length,2);
  }finally{f.relay.close();transport.close();}
});


test('K92 original signed native relays drain three causal captures, including two revisions of one object, and resume the remaining backlog cold',{timeout:600000},async()=>{
  const source=kernelFixture('k92-source'),recipient=kernelFixture('k92-recipient'),wire=wireFixture(true);
  source.technicalWorkspaceId='ws:k92:source:technical';recipient.technicalWorkspaceId='ws:k92:recipient:technical';
  const base=mutation('o:k92:baseline','baseline','business.baseline');
  const sourceBaseline=(await source.kernel.putObject(base)).event,recipientBaseline=(await recipient.kernel.putObject(base)).event;
  const before=(await readT4OriginalEventWindow({workspaceId:WS,originalWriteOwnerRef:OWNER,
    authorizeOriginalRead:allow,readOriginalEvents:()=>source.kernel.listEventsSince(WS),maxEvents:1})).nextCursor;
  const getMode=()=> 'T4_NETWORK',ledger=createT4OriginalHostCaptureLedgerPort({...scope(source.technicalWorkspaceId),originalKernel:source.kernel,getMode,
    readOriginalHostContext:async()=>({workspaceId:source.technicalWorkspaceId,originalWriteOwnerRef:OWNER,hostSessionRef:'host:k92:original-source'}),
    authorizeOriginalTechnicalRead:allow,authorizeOriginalTechnicalWrite:deny});
  const capturePorts=async id=>{
    const rows=await ledger.listOriginalOutbox({workspaceId:WS,originalWriteOwnerRef:OWNER,sourceEventId:id});
    assert.equal(rows.length,1);
    const r=rows[0];return {...ledger,workspaceId:WS,originalWriteOwnerRef:OWNER,networkTargetRef:R,
      kind:r.kind??'OBJECT_PUT',subjectId:r.subjectId??r.objectId,captureRef:r.captureRef,originalKernel:source.kernel,
      getMode,authorizeOriginalRead:allow,authorizeNetworkPublish:allow,readOriginalEvents:()=>source.kernel.listEventsSince(WS)};
  };
  const captured=async id=>readT4OriginalHostCapturedSubject(await capturePorts(id));
  const verifySource=async p=>verifyT4OriginalHostCapturedSubjectSource(await capturePorts(p.originalSourceEventId??p.sourceEventId),p);
  const verifyEvent=async p=>{
    const d=(await captured(p.sourceEventId)).prepared.delta;
    return p.sourceEventDigest===d.sourceEventDigest&&p.objectContentDigest===d.objectContentDigest&&p.sourceRevision===d.sourceRevision&&p.windowDigest===d.windowDigest;
  };
  const verifyApplied=async p=>{
    const event=recipient.events.find(e=>e.workspace_id===WS&&e.event_id===p.originalRecipientEventId);
    if(!event||event.revision!==p.originalRecipientRevision||event.payload.originalContentDigest!==p.originalRecipientStateDigest)return false;
    const o=(await recipient.kernel.getObject(WS,event.object_id))?.object;
    return o?.revision===event.revision&&digestT4OriginalObjectContent({schemaId:o.schema_id,schemaVersion:o.schema_version,data:o.data,extensions:o.extensions})===p.originalRecipientStateDigest;
  };
  const phaseEvidence=async p=>{
    const e=p.evidence;
    if(p.phase==='INTENT')return (await captured(e.evidenceRef)).sourceWindow.windowDigest===e.evidenceDigest;
    const bytes=wire.frames.get(e.evidenceRef);
    if(!bytes)return false;
    const frame=decodeT4CandidateFrame(bytes);
    if(p.phase==='VERIFIED'||p.phase==='APPLY_INTENT'){
      if(frame.messageType!=='CHANGE_REF')return false;
      const c=await captured(frame.body.eventRef);
      return e.evidenceDigest===(p.phase==='VERIFIED'?c.prepared.delta.objectContentDigest:'sha256:'+c.prepared.sha256);
    }
    if(e.evidenceDigest!==hash(bytes))return false;
    if(p.phase==='APPLIED'||p.phase==='APPLIED_CONFIRMED')return frame.messageType==='APPLIED_ACK'&&await verifyApplied(e);
    return (p.phase==='PUBLISHED'&&frame.messageType==='CHANGE_REF')||(p.phase==='RECEIVED'&&frame.messageType==='CHUNK');
  };
  // Actual authenticated encryption and signed frames; the Kernel and transport
  // are test ports. Production Vault and signed Access composition are K90.
  const key=randomBytes(32);let seals=0,opens=0;
  const gates=new Map();
  const gate=role=>({canWake:()=>gates.has(role),onResult:r=>{
    console.log('K92',role,r.state,r.errorCode??'');
    const g=gates.get(role);
    if(g&&(r.state===g.target||r.state==='NETWORK_WAKE_SUSPENDED'||r.state==='NETWORK_WAKE_RECOVERY_WAIT')){
      gates.delete(role);if(r.state!==g.target)g.reject(Error(r.errorCode??r.state));else g.resolve(r);
    }
  }});
  const makeSource=()=>nativeFixture({...gate('SOURCE'),testScopedVaultUnlock:true,role:'SOURCE',store:source,wire,localCapture:true,localGraph:true,phaseEvidence,
    baselineInput:{sourceCursor:before,originalBaselineRef:sourceBaseline.event_id,originalBaselineDigest:hash(JSON.stringify(sourceBaseline))},
    portOverrides:{verifyOriginalRecipientApplied:verifyApplied,authorizeOriginalSealedContent:allow,
      readOriginalSealedContent:async p=>{
        const bytes=p.originalCapture.prepared.bytes;assert.equal(sha(bytes),p.session.capturedSha256);seals++;
        const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(p.session.sessionRef));
        return {ciphertext:Buffer.concat([iv,cipher.update(bytes),cipher.final(),cipher.getAuthTag()]),encryptionContextRef:'sealed:k92:epoch2'};
      }}});
  const makeRecipient=(indexMigration=false)=>nativeFixture({...gate('RECIPIENT'),testScopedVaultUnlock:true,role:'RECIPIENT',store:recipient,source,wire,phaseEvidence,indexMigration,localResultVerification:true,
    baselineInput:{sourceCursor:before,originalBaselineRef:recipientBaseline.event_id,originalBaselineDigest:hash(JSON.stringify(recipientBaseline))},
    portOverrides:{verifyOriginalRecipientApplied:async()=>{throw Error('unexpected external witnessed recipient verification')},verifyOriginalSourceSubject:verifySource,verifyOriginalSourceBinding:verifySource,
      verifyOriginalSourceEvent:verifyEvent,authorizeOriginalSealedOpen:allow,
      openOriginalSealedContent:async p=>{
        const bytes=Buffer.from(p.ciphertext);assert.equal(hash(bytes),p.contentDigest);opens++;
        const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAAD(Buffer.from(p.sessionRef));decipher.setAuthTag(bytes.subarray(-16));
        return {authenticated:true,plaintext:new Uint8Array(Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]))};
      },withOriginalSubjectMutation:async(p,action)=>action()}});
  let sender=makeSource(),receiver=makeRecipient(),ss,rs,pumps=[],pumpFailure=null;
  const deadline=setTimeout(()=>{sender.relay.close();receiver.relay.close();},590000);
  // Both original WebView polls remain alive while either peer is doing work.
  // The test gates wakes at protocol milestones, not native command execution.
  const pump=(f,session,store)=>{
    let stopped=false;
    const task=(async()=>{try{while(!stopped){
      if(f.failure)throw f.failure;
      const cmd=await f.relay.exchange({verb:'next',payload:{sessionId:session.sessionId}},1);
      if(cmd.kind==='IDLE')continue;
      const args=decodeOriginalNetworkRelayArgs(cmd.method,cmd.args);
      const value=await store.kernel[cmd.method](...args);
      await f.relay.exchange({verb:'result',payload:{sessionId:session.sessionId,id:cmd.id,ok:true,
        result:encodeOriginalNetworkRelayResult(cmd.method,value)}},1);
    }}catch(error){if(!stopped){pumpFailure=error;for(const g of gates.values())g.reject(error);gates.clear();throw error;}}})();
    task.catch(()=>{});
    return {stop:async()=>{stopped=true;f.relay.close();await task;}};
  };
  const start=async()=>{ss=await sender.attach();rs=await receiver.attach();pumps=[pump(sender,ss,source),pump(receiver,rs,recipient)];};
  const stop=async()=>{await Promise.all(pumps.map(p=>p.stop()));pumps=[];};
  const drive=(f,target)=>new Promise((resolve,reject)=>{
    if(pumpFailure||f.failure)return reject(pumpFailure??f.failure);
    assert.equal(gates.has(f===sender?'SOURCE':'RECIPIENT'),false);
    gates.set(f===sender?'SOURCE':'RECIPIENT',{target,resolve,reject});
  });
  const frontier=(store,kind)=>[...store.rows.values()].map(r=>r.object).find(o=>o.data?.schema===kind);
  const transfer=async(i)=>{
    await drive(sender,'HEADS_PRESENT');await drive(receiver,'DIFF_PRESENT');
    await drive(sender,'PUBLISHED_RECORDED');await drive(receiver,'RECIPIENT_CURSOR_ADVANCED');
    await drive(sender,'SOURCE_ACK_CONFIRMED');
    const sc=frontier(source,'IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_FRONTIER_V1'),rc=frontier(recipient,'IWXA_T4_ORIGINAL_HOST_NATIVE_RECIPIENT_FRONTIER_V1');
    assert.equal(sc.revision,i);assert.equal(rc.revision,i);
    assert.deepEqual(sc.data.last.sourceCursorAfter,rc.data.last.sourceCursorAfter);
    assert.equal(recipient.events.filter(e=>e.workspace_id===WS).length,i+1);
    assert.equal(seals,i);
  };
  try{
    await start();
    await drive(sender,'ADMITTED');await drive(receiver,'ADMITTED');
    const a=mutation('o:k92:a','revision one','business.created');
    const b={...mutation('o:k92:a','revision two','business.updated'),base_revision:1};
    const c=mutation('o:k92:b','independent object','business.created');
    const captures=[];
    for(const input of [a,b,c])captures.push(await sender.relay.exchange({verb:'sourceMutation',payload:{sessionId:ss.sessionId,method:'putObject',args:[input]}},1));
    assert.equal(new Set(captures.map(x=>x.captureRef)).size,3);
    assert.equal(source.events.filter(e=>e.workspace_id===WS).length,4);assert.equal(wire.puts,0);
    await transfer(1);assert.equal((await recipient.kernel.getObject(WS,a.object_id)).object.data.title,'revision one');
    await transfer(2);assert.equal((await recipient.kernel.getObject(WS,a.object_id)).object.data.title,'revision two');
    for(const f of [sender,receiver]){
      assert.equal(f.local.vaultUnlocks,1);assert.equal(f.technical.vaultUnlocks,1);
      assert.ok(f.technical.proofCount>1);assert.ok(f.technical.registryReads>1);
    }
    await stop();const priorPuts=wire.puts;
    sender=makeSource();receiver=makeRecipient(true);await start();
    await drive(receiver,'NETWORK_INDEX_MIGRATION_COMPLETE');
    assert.equal(receiver.results.at(-1).skippedCompletedRecipientPublicationCount,2);assert.equal(receiver.signatureCalls,0);assert.equal(wire.puts,priorPuts);
    await transfer(3);
    assert.equal((await recipient.kernel.getObject(WS,c.object_id)).object.data.title,'independent object');
    await drive(sender,'NO_NEXT_ORIGINAL_EVENT');await drive(receiver,'WAITING_FOR_HEADS');
    assert.equal(source.events.filter(e=>e.workspace_id===WS).length,4);assert.equal(recipient.events.filter(e=>e.workspace_id===WS).length,4);
    assert.equal(recipient.graphInvocations,3);assert.equal(seals,3);assert.ok(opens>=3);assert.equal(wire.lists,0);
    assert.equal([...wire.frames.values()].filter(b=>decodeT4CandidateFrame(b).messageType==='APPLIED_ACK').length,3);
    for(const f of [sender,receiver]){
      assert.equal(f.local.vaultUnlocks,1);assert.equal(f.technical.vaultUnlocks,1);
      assert.ok(f.technical.proofCount>1);assert.ok(f.technical.registryReads>1);
    }
  }finally{clearTimeout(deadline);await stop();sender.relay.close();receiver.relay.close();key.fill(0);}
});

test('K113 commit-order profile requires source role, signed source window and original history boundary',()=>{
  for(const options of [
    {role:'RECIPIENT',enableOriginalCommitOrder:true,enableSourceEventWindowRead:true},
    {role:'SOURCE',enableOriginalCommitOrder:true},
    {role:'SOURCE',enableOriginalCommitOrder:true,enableSourceEventWindowRead:true},
    {role:'SOURCE',enableOriginalCommitOrder:'true'},
  ])assert.throws(()=>createT4OriginalNativeHostNetworkOwner(options),e=>e?.code==='NATIVE_NETWORK_OWNER_COMMIT_ORDER_PROFILE_INVALID');
});

test('K116 top-level native profile refuses inconsistent commit-order configuration before opening transports',()=>{
 for(const options of [
   {role:'RECIPIENT',enableOriginalCommitOrder:true,enableSourceEventWindowRead:true},
   {role:'SOURCE',enableOriginalCommitOrder:true},
   {role:'SOURCE',enableOriginalCommitOrder:true,enableSourceEventWindowRead:true},
   {role:'SOURCE',enableOriginalCommitOrder:'true'},
 ])assert.throws(()=>createT4OriginalNativeHostNetworkProfile(options),
   {code:'NATIVE_NETWORK_PROFILE_COMMIT_ORDER_REQUIRED'});
});

test('K125 exact technical history cannot activate an unselected source commit order or invalid option',()=>{
  for(const options of [{role:'SOURCE',enableOriginalTechnicalObjectHistory:true},
    {role:'RECIPIENT',enableOriginalTechnicalObjectHistory:'true'}]){
    assert.throws(()=>createT4OriginalNativeHostNetworkOwner(options),{code:'NATIVE_NETWORK_OWNER_TECHNICAL_OBJECT_HISTORY_PROFILE_INVALID'});
    assert.throws(()=>createT4OriginalNativeHostNetworkProfile(options),{code:'NATIVE_NETWORK_PROFILE_TECHNICAL_OBJECT_HISTORY_REQUIRED'});
  }
});

test('K156 multipart native profile is explicit and rejects incomplete original owner ports before attachment or transport',()=>{
  const rejectOwner={code:'NATIVE_NETWORK_OWNER_MULTIPART_PROFILE_INVALID'};
  const rejectProfile={code:'NATIVE_NETWORK_PROFILE_MULTIPART_REQUIRED'};
  for(const options of [
    {role:'SOURCE',enableOriginalMultipartNegotiation:true},
    {role:'RECIPIENT',enableOriginalMultipartNegotiation:true},
    {role:'SOURCE',enableOriginalMultipartNegotiation:'true'},
    {role:'SOURCE',enableOriginalMultipartNegotiation:true,enableOriginalTechnicalObjectHistory:true,
      enableSourceEventWindowRead:true,enableSourceCaptureBinding:true,enableRecipientResultRead:true,enableOriginalCommitOrder:true,
      enableOriginalDispatchEvidence:true,originalPorts:{authorizeOriginalMultipartAssetCapture:async()=>true}},
    {role:'RECIPIENT',enableOriginalMultipartNegotiation:true,enableOriginalTechnicalObjectHistory:true,
      enableSourceEventWindowRead:true,enableSourceCaptureBinding:true,enableRecipientResultRead:true},
  ]){
    assert.throws(()=>createT4OriginalNativeHostNetworkOwner(options),rejectOwner);
    assert.throws(()=>createT4OriginalNativeHostNetworkProfile(options),rejectProfile);
  }
});

test('K178 replacement multipart cannot implicitly activate or bypass complete original profile',()=>{
  for(const role of ['SOURCE','RECIPIENT']){
    for(const flag of [true,'true']){
      const options={role,enableOriginalReplacementMultipartNegotiation:flag};
      assert.throws(()=>createT4OriginalNativeHostNetworkOwner(options),{code:'NATIVE_NETWORK_OWNER_REPLACEMENT_MULTIPART_PROFILE_INVALID'});
      assert.throws(()=>createT4OriginalNativeHostNetworkProfile(options),{code:'NATIVE_NETWORK_PROFILE_REPLACEMENT_MULTIPART_REQUIRED'});
    }
  }
});


test('fixed installed profile cannot start replacement multipart or accept a non-boolean replacement selection',()=>{
  for(const role of ['SOURCE','RECIPIENT']){
    assert.throws(()=>createT4OriginalNativeHostNetworkProfile({role,enableOriginalReplacementAttempts:'false'}),
      {code:'NATIVE_NETWORK_PROFILE_REPLACEMENT_ATTEMPTS_INVALID'});
    assert.throws(()=>createT4OriginalNativeHostNetworkProfile({role,enableOriginalReplacementAttempts:false,
      enableOriginalMultipartNegotiation:true,enableOriginalReplacementMultipartNegotiation:true}),
      {code:'NATIVE_NETWORK_PROFILE_REPLACEMENT_MULTIPART_REQUIRED'});
  }
});


test('both native roles admit the same original fresh Workspace through the signed Kernel relay without external baseline callbacks',async()=>{
  const creation={workspace_id:WS,event_id:'event:pilot:creation',event_type:'workspace.created',
    service_id:'iwxa.admin-center.workspace',occurred_at:'2026-11-27T12:00:00.000Z',
    payload:{profile:'generic',capabilities:[],read_only:false}};
  const selection={confirmed:true,eventId:creation.event_id,eventDigest:digestT4OriginalEventRecord(creation,WS)};
  let shared;
  for(const role of ['SOURCE','RECIPIENT']){
    const store=kernelFixture('fresh-'+role);store.technicalWorkspaceId='ws:pilot:technical:'+role;
    store.events.push(clone(creation));
    const wire=wireFixture(true),f=nativeFixture({role,store,wire,freshBaseline:selection});
    try{
      const session=await f.attach();await f.drive(session,'ADMITTED');
      // onStep intentionally projects only operational metadata. Read the
      // persisted original technical Object, not an imaginary baseline field
      // in that notification.
      const admitted=[...store.rows.values()].map(r=>r.object).filter(o=>
        o.workspace_id===store.technicalWorkspaceId&&o.data?.schema==='IWXA_T4_ORIGINAL_NETWORK_BASELINE_ADMISSION_RECORD_V1');
      assert.equal(admitted.length,1);
      const admission=admitted[0].data.baseline;
      assert.equal(admission.originalBaselineRef,creation.event_id);
      assert.equal(admission.originalBaselineDigest,selection.eventDigest);
      if(shared)assert.deepEqual(admission.sourceCursor,shared);else shared=admission.sourceCursor;
      assert.equal(store.events.filter(e=>e.workspace_id===WS).length,1);
      assert.equal(store.events.filter(e=>e.event_type==='t4.network.original.baseline.admitted').length,1);
      assert.ok(f.local.proofCount>0&&f.technical.proofCount>0);
      assert.equal(wire.puts,0);assert.equal(wire.gets,0);
      assert.ok(f.commands.filter(c=>c.method==='putObject').every(c=>c.args[0].workspace_id===store.technicalWorkspaceId));
    }finally{f.relay.close();}
  }
});
