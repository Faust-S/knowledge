import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID,generateKeyPairSync,sign,verify} from 'node:crypto';
import {createRequire} from 'node:module';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {materializeIntegrationHost,serveRealKernelHost} from '../../t3-core/scripts/real-kernel-e2e.mjs';
import {assertQualifiedKernelArtifact} from '../../t3-core/src/factory2/products/domain-completion/independent-browser-witness.mjs';
import {prepareT4OriginalNetworkTechnicalSchemaRegistration,assertT4OriginalNetworkTechnicalSchemaRegistered,
  T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID} from '../src/network/original-network-technical-schema.mjs';
import {readT4OriginalEventWindow,digestT4OriginalEventRecord} from '../src/network/original-event-window.mjs';
import {createT4OriginalNetworkBaselineAdmissionPort} from '../src/network/original-network-baseline-admission.mjs';
import {createT4OriginalHostCaptureLedgerPort} from '../src/network/original-host-capture-ledger.mjs';
import {createT4OriginalHostCaptureAdapter} from '../src/network/original-host-capture-adapter.mjs';
import {readT4OriginalNativeCaptureSessionAtCursor} from '../src/network/original-host-outbox-dispatcher.mjs';
import {createT4OriginalNetworkPublicationPort,createT4OriginalSourceSessionHead,
  createT4OriginalPublicationIndexMigrationStepper,isT4RecoverablePublicationWakeError}
  from '../src/network/original-network-publication.mjs';
import {createWebDavPackageTransport} from '../src/network/webdav-package-transfer.mjs';
import {createT4CandidateFrameTransport} from '../src/network/standard-network-wire-transport.mjs';
import {createT4CandidateUnsignedFrame,signT4CandidateFrame,T4_ORIGINAL_SOURCE_SESSION_EXTENSION}
  from '../src/network/standard-network-wire-candidate.mjs';
import {t4NativeFrameIndexKeys} from '../src/network/original-network-frame-address.mjs';
import {decodeT4CandidateFrame} from '../src/network/standard-network-wire-candidate.mjs';
import {readT4OriginalHostCapturedSubject} from '../src/network/original-host-outbox-delivery.mjs';
import {createT4OriginalNetworkSessionPhasePort} from '../src/network/original-network-session-phases.mjs';
import {applyT4OriginalNetworkSubjectWithDurableIntent,createT4OriginalNetworkAppliedAckBody}
  from '../src/network/original-network-subject-apply.mjs';

const require=createRequire(new URL('../../t3-core/package.json',import.meta.url));
const {chromium}=require('playwright');
const SERVICE='iwxa.workspace.integration',ORIGINAL_KERNEL='0.3.6',
  ORIGINAL_ID='iwxa-kernel-k036-same-store-history-20261019-qualified.1';
const H=x=>'sha256:'+createHash('sha256').update(x).digest('hex');
const hashFile=path=>H(readFileSync(path)).slice(7);
const mode=()=> 'T4_NETWORK';
const write=(base,path,content)=>{
  const full=join(base,...path.split('/'));
  mkdirSync(join(full,'..'),{recursive:true});writeFileSync(full,content);
};

// Focused test of the actual pinned Kernel, distinct from the full HTTPS
// regression. The single-executor boundary and owner decisions are fixtures;
// the source Outbox and recipient apply-intent are original persisted Objects.
test('K21/K22 focused original Kernel atomic graph, source inventory and cold recipient recovery',{timeout:180000},async()=>{
  const qualified=process.env.IWXA_T2_QUALIFIED_KERNEL_DIST;
  assert.ok(qualified&&existsSync(join(qualified,'_iwxa/runtime/0.3.6/runtime.js')),'QUALIFIED_ORIGINAL_T2_RUNTIME_REQUIRED');
  const root=mkdtempSync(join(tmpdir(),'iwxa-t4-original-graph-focus-')),dist=join(root,'dist');
  mkdirSync(dist);let live=null;const contexts=new Map();
  const id=randomUUID(),ws='ws:graph:'+id,target='object:target',other='object:other',
    old='relation:old',first='relation:first',second='relation:second',owner='owner:graph-focus';
  const sourceNodeRef='node:graph-focus:source',recipientNodeRef='node:graph-focus:recipient',
    scopeRef='scope:graph-focus',ownerEpoch=1;
  try{
    cpSync(join(qualified,'_iwxa'),join(dist,'_iwxa'),{recursive:true});
    assertQualifiedKernelArtifact(dist,{kernel:ORIGINAL_KERNEL,contract:'1.3.0',artifactId:ORIGINAL_ID});
    const kernelPath=join(dist,'_iwxa/runtime/0.3.6/runtime.js'),pinned=hashFile(kernelPath);
    live=await serveRealKernelHost(dist);
    const host=materializeIntegrationHost(dist,live.origin);
    host.passport.permissions.operations=['t1.commitObjectGraph'];
    const registered=prepareT4OriginalNetworkTechnicalSchemaRegistration(host);
    host.domain=registered.domain;host.passport=registered.passport;
    assert.equal(assertT4OriginalNetworkTechnicalSchemaRegistered(host),T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID);
    host.domain.runtime.kernel_release=ORIGINAL_KERNEL;host.domain.runtime.runtime_version=ORIGINAL_KERNEL;
    host.workspaceConfig.host.required_runtime_version=ORIGINAL_KERNEL;
    host.workspaceConfig.host.required_contract_version='1.3.0';
    write(dist,'_iwxa/domain.json',JSON.stringify(host.domain));
    write(dist,'workspace/workspace.config.json',JSON.stringify(host.workspaceConfig));
    const passport='_iwxa/services/'+SERVICE+'.json';
    write(dist,passport,JSON.stringify(host.passport));
    write(dist,'_iwxa/service-catalog.json',JSON.stringify({count:1,entries:[{
      service_id:SERVICE,service_version:host.passport.service_version,base_path:host.passport.base_path,
      supported_levels:host.passport.supported_levels,file:passport,sha256:hashFile(join(dist,passport))}]}));
    write(dist,'workspace/index.html','<!doctype html><html><body><main>Original graph qualification</main><script src="/_iwxa/loader.js"></script></body></html>');
    async function endpoint(role){
      const profile=join(root,role),tech='ws:technical:'+role+':'+id;
      let page=null,epoch=0,grants=[],held=false,lose=false,invocations=0,commits=0;
      async function open(){
        const previous=contexts.get(role);if(previous){await previous.close();contexts.delete(role);}
        const context=await chromium.launchPersistentContext(profile,{headless:true,ignoreHTTPSErrors:true,
          args:['--no-sandbox','--ignore-certificate-errors']});contexts.set(role,context);
        page=context.pages()[0]||await context.newPage();epoch++;
        await page.goto(live.origin+'/workspace/',{waitUntil:'domcontentloaded',timeout:30000});
        await page.waitForFunction(()=>typeof window.IWXA?.connect==='function',null,{timeout:30000});
        const meta=await page.evaluate(async SERVICE=>{
          const k=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
          return {grants:k.granted_operations,runtime:k.runtime_version,contract:k.contract_version};
        },SERVICE);
        grants=meta.grants;assert.equal(meta.runtime,ORIGINAL_KERNEL);assert.equal(meta.contract,'1.3.0');
        for(const op of ['createWorkspace','putObject','getObject','listObjects','listEventsSince','putRelation','commitObjectGraph'])
          assert.ok(grants.includes('t1.'+op),op);
      }
      const rpc=(op,...args)=>page.evaluate(async({SERVICE,op,args})=>{
        const k=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
        return k.t1[op](...args);
      },{SERVICE,op,args});
      await open();
      const kernel={hasOperation:op=>grants.includes(op),sessionInfo:{service_id:SERVICE},
        getObject:(...a)=>rpc('getObject',...a),putObject:(...a)=>rpc('putObject',...a),
        listObjects:(...a)=>rpc('listObjects',...a),listEventsSince:(...a)=>rpc('listEventsSince',...a),
        commitObjectGraph:async input=>{
          assert.equal(held,true);invocations++;
          const r=await rpc('commitObjectGraph',input);if(!r.deduplicated)commits++;
          if(lose){lose=false;throw Object.assign(Error('fixture lost original result'),{code:'ACK_LOST'});}
          return r;
        }};
      const authorize=async p=>grants.includes(p.operation);
      const boundary=async(proof,fn)=>{
        assert.equal(held,false);assert.equal(proof.originalHostMustSerializeAllWorkspaceGraphMutations,true);
        held=true;try{return await fn();}finally{held=false;}
      };
      const context=async()=>({workspaceId:tech,originalWriteOwnerRef:owner,
        nodeRef:role==='source'?sourceNodeRef:recipientNodeRef,scopeRef,hostSessionRef:'host:graph-focus:'+role+':'+epoch});
      await rpc('createWorkspace',{workspace_id:ws,profile:'generic'});
      await rpc('createWorkspace',{workspace_id:tech,profile:'generic'});
      for(const object_id of [target,other])await kernel.putObject({workspace_id:ws,object_id,
        schema_id:'iwxa.demo.note',schema_version:'1.0.0',base_revision:0,data:{title:object_id},
        extensions:{preserved:'yes'},event:{event_type:'t4.graph.baseline',payload:{}}});
      await rpc('putRelation',{workspace_id:ws,relation_id:old,from_object_id:target,to_object_id:other,
        kind:'related',event:{event_type:'t4.graph.baseline.relation',payload:{}}});
      return {role,tech,kernel,authorize,boundary,context,open,loseAck(){lose=true;},
        get invocations(){return invocations;},get commits(){return commits;}};
    }
    const source=await endpoint('source'),recipient=await endpoint('recipient');
    const history=()=>source.kernel.listEventsSince(ws);
    const initial=(await readT4OriginalEventWindow({workspaceId:ws,originalWriteOwnerRef:owner,
      readOriginalEvents:history,authorizeOriginalRead:source.authorize})).nextCursor;
    const baselineEvent=(await history()).find(e=>e.event_id===initial.lastEventId);
    const baselineInput={sourceCursor:initial,originalBaselineRef:baselineEvent.event_id,
      originalBaselineDigest:digestT4OriginalEventRecord(baselineEvent,ws)};
    const scope={sourceWorkspaceId:ws,originalWriteOwnerRef:owner,sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch};
    const tech=e=>({...scope,technicalWorkspaceId:e.tech,originalKernel:e.kernel,getMode:mode,
      readOriginalHostContext:e.context,authorizeOriginalTechnicalRead:e.authorize,authorizeOriginalTechnicalWrite:e.authorize});
    const baseline=()=>createT4OriginalNetworkBaselineAdmissionPort({...tech(source),role:'SOURCE',
      authorizeOriginalBaselineAdmission:async p=>p.role==='SOURCE',
      verifyOriginalBaselineEvidence:async p=>{
        const stream=await history(),row=stream.find(e=>e.event_id===p.baseline.originalBaselineRef);
        if(!row||digestT4OriginalEventRecord(row,ws)!==p.baseline.originalBaselineDigest)return false;
        const {window}=await readT4OriginalEventWindow({workspaceId:ws,originalWriteOwnerRef:owner,
          cursor:p.baseline.sourceCursor,readOriginalEvents:()=>stream,authorizeOriginalRead:source.authorize,maxEvents:1});
        return window.sourcePrefixDigestBefore===initial.sourcePrefixDigest;
      }});
    assert.equal((await baseline().admitOriginalBaseline(baselineInput)).state,'ADMITTED');
    const ledger=()=>createT4OriginalHostCaptureLedgerPort(tech(source));
    const common=()=>({...ledger(),workspaceId:ws,originalWriteOwnerRef:owner,originalKernel:source.kernel,
      getMode:mode,readOriginalEvents:history,authorizeOriginalRead:source.authorize,
      authorizeOriginalWrite:source.authorize,authorizeNetworkPublish:async()=>true});
    const captureHost=()=>createT4OriginalHostCaptureAdapter({...common(),
      readOriginalAdmittedBaseline:()=>baseline().readOriginalAdmittedBaseline(),
      authorizeOriginalCaptureRecovery:async()=>true,withOriginalSubjectMutation:source.boundary});
    const input=(revision,remove,add)=>({workspace_id:ws,idempotency_key:'graph:'+id+':'+revision,
      object:{object_id:target,schema_id:'iwxa.demo.note',schema_version:'1.0.0',base_revision:revision-1,
        data:{title:'graph '+revision},extensions:{graphRevision:revision}},
      relation_puts:[{relation_id:add,from_object_id:target,to_object_id:other,kind:'related'}],
      relation_deletes:[{relation_id:remove}],event:{event_type:'t4.graph.focus.commit',payload:{revision}}});
    const oneInput=input(2,old,first),twoInput=input(3,first,second),oneRef='capture:one:'+id,twoRef='capture:two:'+id;
    let h=captureHost();const one=await h.commitObjectGraph({mutationInput:oneInput,captureRef:oneRef});
    assert.equal(one.capture.originalT3OutboxVerified,true);assert.equal(one.originalReceipt.deduplicated,false);
    source.loseAck();
    await assert.rejects(h.commitObjectGraph({mutationInput:twoInput,captureRef:twoRef}),
      {code:'GRAPH_ORIGINAL_WRITE_OUTCOME_UNKNOWN'});
    h.dispose();assert.equal(source.commits,2);assert.equal(source.invocations,2);
    assert.equal((await ledger().listOriginalPendingIntents({workspaceId:ws,originalWriteOwnerRef:owner})).length,1);
    await source.open();h=captureHost();
    const recovered=await h.reconcileGraphMutation({captureRef:twoRef,workspaceId:ws,objectId:target});
    assert.equal(recovered.originalT3OutboxVerified,true);assert.equal(recovered.originalMutationRetried,false);
    const inventory=await ledger().readOriginalCaptureInventory({workspaceId:ws,originalWriteOwnerRef:owner});
    assert.equal(inventory.pairs.length,2);assert.equal(inventory.pending.length,0);
    const beforeReplay=await history();
    const replay=await h.commitObjectGraph({mutationInput:oneInput,captureRef:oneRef});
    assert.equal(replay.originalReceipt.deduplicated,true);assert.equal(replay.capture.prepared.sha256,one.capture.prepared.sha256);
    assert.equal(source.invocations,3);assert.equal(source.commits,2);assert.deepEqual(await history(),beforeReplay);
    // Observe the actual released listEventsSince contract. A date-based
    // filter (or event-id filter) alone is not a durable original ordinal.
    const probeSince=async value=>{
      try{
        const rows=await source.kernel.listEventsSince(ws,value);
        assert.ok(Array.isArray(rows));assert.ok(rows.every(e=>e.workspace_id===ws));
        return {count:rows.length,eventIds:rows.map(e=>e.event_id),
          equalsStrictOriginalSuffix:JSON.stringify(rows.map(e=>e.event_id))===
            JSON.stringify(beforeReplay.slice(initial.seenEventCount).map(e=>e.event_id))};
      }catch(error){return {code:error?.code??'ORIGINAL_QUERY_REJECTED'};}
    };
    console.log('T4_REAL_ORIGINAL_EVENT_SINCE_PROBE',JSON.stringify({originalKernel:ORIGINAL_KERNEL,
      baselineCount:initial.seenEventCount,wholeCount:beforeReplay.length,
      sinceOriginalEventId:await probeSince(initial.lastEventId),
      sinceOriginalOccurredAt:await probeSince(baselineEvent.occurred_at),
      durableOrdinalContractNotInferred:true}));
    const readCapture=captureRef=>readT4OriginalHostCapturedSubject({...common(),kind:'GRAPH_COMMIT',subjectId:target,captureRef});
    const captures=[await readCapture(oneRef),await readCapture(twoRef)];
    assert.equal(captures[0].laterSourceEventsExist,true);
    assert.equal(captures[0].prepared.sha256,one.capture.prepared.sha256);
    for(let i=0;i<captures.length;i++){
      const c=captures[i],d=c.prepared.delta,ref=i===0?oneRef:twoRef;
      const received={schema:'IWXA_T4_ORIGINAL_NETWORK_SUBJECT_RECEIVED_V1',changeKind:'GRAPH_COMMIT',
        originalSubjectId:target,originalSourceRevision:d.sourceRevision,originalSourceEventAndSubjectVerified:true,
        changeId:'change:'+id+':'+i,contentDigest:H('fixture-content:'+i),sourceNodeRef,recipientNodeRef,scopeRef,
        sessionRef:'session:'+id+':'+i,encryptionContextRef:'crypto:fixture',ownerEpoch,
        sourceChangeFrameKey:H('fixture-frame:'+i).slice(7)+'.t4n',originalEventDigest:d.sourceEventDigest,
        sourcePrefixDigestAfter:c.sourceWindow.sourcePrefixDigestAfter,originalStateDigest:d.graphContentDigest,
        delta:structuredClone(d),sha256:c.prepared.sha256,key:c.prepared.key,originalHostAuthenticatedOpen:true,
        originalRecipientSubjectPermissionGranted:false,originalT3ExchangeCalled:false};
      // This focused route isolates actual Kernel semantics; the full
      // qualification independently builds received evidence via HTTPS.
      const phase=()=>createT4OriginalNetworkSessionPhasePort({...tech(recipient),localNodeRef:recipientNodeRef,
        sessionRef:received.sessionRef,changeId:received.changeId,changeKind:'GRAPH_COMMIT',
        recipientApplyIntentRequired:true,verifyOriginalPhaseEvidence:async()=>true,verifyOriginalRecipientApplied:async()=>true});
      const port=phase();
      await port.advanceOriginalSessionPhase({phase:'RECEIVED',evidence:{evidenceRef:'frame:fixture:'+i,evidenceDigest:H('chunk:'+i)}});
      await port.advanceOriginalSessionPhase({phase:'VERIFIED',evidence:{evidenceRef:received.sourceChangeFrameKey,evidenceDigest:d.graphContentDigest}});
      const args=()=>({received,originalKernel:recipient.kernel,getMode:mode,authorizeOriginalRead:recipient.authorize,
        authorizeOriginalWrite:recipient.authorize,recipientPhasePort:phase(),withOriginalSubjectMutation:recipient.boundary,
        verifyOriginalSourceEvent:async proof=>{
          const observed=await readCapture(ref),delta=observed.prepared.delta;
          return proof.kind==='GRAPH_COMMIT'&&proof.sourceEventId===delta.sourceEventId&&
            proof.sourceEventDigest===delta.sourceEventDigest&&proof.wireSha256===observed.prepared.sha256&&
            proof.graphContentDigest===delta.graphContentDigest;
        }});
      let result;
      if(i===1){
        recipient.loseAck();await assert.rejects(applyT4OriginalNetworkSubjectWithDurableIntent(args()),
          {code:'SUBJECT_ORIGINAL_APPLY_OUTCOME_UNKNOWN'});
        assert.equal((await phase().inspectOriginalSession()).currentPhase,'APPLY_INTENT');
        await recipient.open();result=await applyT4OriginalNetworkSubjectWithDurableIntent(args());
        assert.equal(result.status,'ALREADY_APPLIED_FROM_ORIGINAL_T3');assert.equal(result.originalCommitInvoked,false);
      }else result=await applyT4OriginalNetworkSubjectWithDurableIntent(args());
      assert.equal(result.actualOriginalT3GraphReadback,true);
      assert.equal(createT4OriginalNetworkAppliedAckBody({received,verifiedResult:result,ackRef:'ack:'+id+':'+i}).recipientRevision,i+2);
    }
    const src=await source.kernel.getObject(ws,target),dst=await recipient.kernel.getObject(ws,target);
    assert.deepEqual(src.object.data,dst.object.data);assert.deepEqual(src.object.extensions,dst.object.extensions);
    assert.equal(dst.object.revision,3);assert.ok(dst.relations.outgoing.some(r=>r.relation_id===second));
    assert.ok(!dst.relations.outgoing.some(r=>r.relation_id===first||r.relation_id===old));
    assert.ok((await recipient.kernel.getObject(ws,other)).relations.incoming.some(r=>r.relation_id===second));
    assert.equal(recipient.invocations,2);assert.equal(recipient.commits,2);assert.equal(hashFile(kernelPath),pinned);
    // This optional focused qualification runs inside the real Apache
    // fixture. Both publication histories are persisted in independent
    // original Kernel profiles, including an old HEADS without announcement.
    if(process.env.T4_TEST_URL){
      assert.ok(process.env.T4_TEST_AUTH,'ORIGINAL_HTTPS_CREDENTIAL_FIXTURE_REQUIRED');
      const selection=async before=>readT4OriginalNativeCaptureSessionAtCursor({...common(),
        sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch,networkTargetRef:recipientNodeRef,
        sourceCursorBefore:before,readOriginalHostContext:async()=>({...await source.context(),workspaceId:ws}),
        authorizeOriginalSessionSelection:async p=>p.workspaceId===ws&&p.ownerEpoch===ownerEpoch});
      const selected=[await selection(initial),await selection(captures[0].nextCursor)];
      assert.ok(selected.every(x=>x.state==='ORIGINAL_NATIVE_SESSION_SELECTED'&&x.originalCaptureEvidenceVerified));
      const keys={source:generateKeyPairSync('ed25519'),recipient:generateKeyPairSync('ed25519')};
      const suite='X25519_AES256GCM_ED25519',stats={framePut:0,indexPut:0,collectionList:0};
      let loseIndexResponse=false,losses=0,signatureCalls=0;
      const wire=(indexedNetworkWire)=>createWebDavPackageTransport({
        baseUrl:process.env.T4_TEST_URL,locationRef:'test-webdav',getMode:mode,
        placementPolicy:{objectFamily:'owner-network-frame',workspaceId:ws,authorityRoot:owner,
          writeOwnerRef:owner,primaryPlacement:'LOCAL_PRIMARY_HOSTED_REPLICA',allowedLocations:['test-webdav'],
          retentionClass:'test',recoveryClass:'test',universalCloudMaster:false,subjectActionAuthority:false},
        authorize:async()=>true,getAuthorizationHeader:async()=>process.env.T4_TEST_AUTH,
        keySuffix:'.t4n',candidateNetworkWire:true,indexedNetworkWire,
        fetchImpl:async(url,options)=>{
          const path=new URL(url).pathname;
          if(options.method==='PROPFIND'){stats.collectionList++;throw Error('MIGRATION_COLLECTION_SCAN_FORBIDDEN');}
          if(options.method==='PUT'&&path.endsWith('.t4n'))stats.framePut++;
          if(options.method==='PUT'&&path.endsWith('.t4i')){
            stats.indexPut++;const response=await fetch(url,options);
            if(loseIndexResponse){
              loseIndexResponse=false;assert.ok([200,201,204].includes(response.status));
              await response.body?.cancel();losses++;throw Error('fixture lost committed HTTPS index response');
            }
            return response;
          }
          return fetch(url,options);
        }
      });
      const legacy=wire(false),indexed=wire(true);
      const node=e=>e.role==='source'?sourceNodeRef:recipientNodeRef;
      const remote=e=>e.role==='source'?recipientNodeRef:sourceNodeRef;
      const keyRef=e=>'key:graph-focus:'+e.role;
      const frameTransport=(e,wireTransport)=>createT4CandidateFrameTransport({
        wireTransport,getMode:mode,originalHostNodeRef:node(e),originalHostScopeRef:scopeRef,
        readOriginalHostContext:async()=>({...await e.context(),originalOwnerRef:owner}),
        authorizeOriginalHostWire:async p=>p.originalHostNodeRef===node(e),
        verifyOriginalNodeSignature:async()=>false,authorizeOriginalNetwork:async()=>false,
        persistOriginalReplayDecision:async()=> 'DENIED',
      });
      const publication=(e,session,wireTransport)=>createT4OriginalNetworkPublicationPort({
        ...tech(e),session,localNodeRef:node(e),technicalSchemaId:T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID,
        frameTransport:frameTransport(e,wireTransport),
        authorizeOriginalFramePublish:async p=>p.localNodeRef===node(e)&&p.sessionRef===session.sessionRef&&
          p.ownerEpoch===ownerEpoch&&p.scopeRef===scopeRef&&p.originalWriteOwnerRef===owner,
        verifyOriginalNodeSignature:async({bytes,signature,signerRef})=>signerRef===keyRef(e)&&
          verify(null,Buffer.from(bytes),keys[e.role].publicKey,Buffer.from(signature)),
      });
      const signFrame=async(e,session,messageType,body,criticalExtensions=[])=>{
        signatureCalls++;
        return signT4CandidateFrame({unsignedFrame:createT4CandidateUnsignedFrame({
          messageType,messageId:'message:'+randomUUID(),sourceNodeRef:node(e),recipientNodeRef:remote(e),
          scopeRef,sessionRef:session.sessionRef,ownerEpoch,permissionRef:'permission:graph-focus',
          signerRef:keyRef(e),sequence:1,cryptoSuite:suite,body,criticalExtensions,
        }),signOriginalNodeBytes:async({bytes})=>sign(null,Buffer.from(bytes),keys[e.role].privateKey)});
      };
      const exactFrames=[];
      try{
        for(const [i,pick] of selected.entries()){
          const {session,sourceCursorBefore,sourceCursorAfter}=pick;
          for(const e of [source,recipient]){
            const isSource=e===source,messageType=isSource?'HEADS':'DIFF_REQUEST';
            const body=isSource?(i===0?createT4OriginalSourceSessionHead({session,sourceCursorBefore,sourceCursorAfter}):
              {familyRef:session.familyRef,ownerEpoch,heads:[session.sourcePrefixDigestAfter]}):
              {familyRef:session.familyRef,fromHeads:[session.sourcePrefixDigestBefore]};
            const bytes=await signFrame(e,session,messageType,body,isSource&&i===0?[T4_ORIGINAL_SOURCE_SESSION_EXTENSION]:[]);
            const port=publication(e,session,legacy);
            await port.prepareSignedBatch({slots:[{sequence:1,messageType}],createSignedFrames:async()=>[bytes]});
            await port.publishPreparedFrame({sequence:1});
            exactFrames.push({e,session,bytes,before:await port.inspectOriginalPublication(),
              keys:t4NativeFrameIndexKeys(decodeT4CandidateFrame(bytes))});
          }
        }
        assert.equal(signatureCalls,4);assert.equal(stats.framePut,4);assert.equal(stats.indexPut,0);
        for(const f of exactFrames)for(const key of f.keys)assert.equal(await indexed.getNativeFrameIndex({key}),null);
        const histories=await Promise.all([source,recipient].map(e=>e.kernel.listEventsSince(e.tech)));
        const business=await Promise.all([source,recipient].map(e=>e.kernel.listEventsSince(ws)));
        const makeStep=e=>createT4OriginalPublicationIndexMigrationStepper({...tech(e),localNodeRef:node(e),
          technicalSchemaId:T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID,
          createOriginalPublicationPort:async({session})=>publication(e,session,indexed)});
        await source.open();await recipient.open();
        let next=makeStep(source);loseIndexResponse=true;
        await assert.rejects(next(),e=>e.code==='PUBLICATION_INDEX_MIGRATION_OUTCOME_UNKNOWN'&&
          isT4RecoverablePublicationWakeError(e));
        assert.equal(losses,1);assert.equal(stats.indexPut,1);
        // Cold Host continuation derives the complete original inventory;
        // the lost address reply is recovered by GET, not a second PUT.
        await source.open();next=makeStep(source);
        assert.equal((await next()).state,'NETWORK_INDEX_MIGRATION_PROGRESS');
        assert.equal((await next()).state,'NETWORK_INDEX_MIGRATION_COMPLETE');
        assert.equal(await next(),null);
        const receiver=makeStep(recipient);
        assert.equal((await receiver()).state,'NETWORK_INDEX_MIGRATION_PROGRESS');
        assert.equal((await receiver()).state,'NETWORK_INDEX_MIGRATION_COMPLETE');
        const addressCount=exactFrames.reduce((n,f)=>n+f.keys.length,0);
        assert.equal(addressCount,5);assert.equal(stats.indexPut,addressCount);
        for(const f of exactFrames){
          const after=publication(f.e,f.session,indexed);
          assert.deepEqual(await after.inspectOriginalPublication(),f.before);
          assert.equal((await after.readOriginalPublishedFrame({sequence:1})).sha256,f.before.frames[0].sha256);
          for(const key of f.keys)assert.equal((await indexed.getNativeFrameIndex({key})).frameSha256,f.before.frames[0].sha256);
        }
        // A second cold migration is read-only at both boundaries.
        await source.open();await recipient.open();
        for(const e of [source,recipient]){
          const step=makeStep(e);await step();assert.equal((await step()).state,'NETWORK_INDEX_MIGRATION_COMPLETE');
        }
        assert.deepEqual(await Promise.all([source,recipient].map(e=>e.kernel.listEventsSince(e.tech))),histories);
        assert.deepEqual(await Promise.all([source,recipient].map(e=>e.kernel.listEventsSince(ws))),business);
        assert.equal(stats.framePut,4);assert.equal(signatureCalls,4);assert.equal(stats.indexPut,addressCount);
        assert.equal(stats.collectionList,0);assert.equal(hashFile(kernelPath),pinned);
        console.log('T4_K32_REAL_ORIGINAL_PUBLICATION_PROFILE_MIGRATION_PASS',JSON.stringify({
          originalKernel:ORIGINAL_KERNEL,originalPublicationRecords:4,immutableFrames:4,verifiedIndexes:addressCount,
          lostCommittedHttpsIndexResponseRecovered:true,originalHostMigrationStepperUsed:true,
          originalSourceAndRecipientColdProfiles:true,oldUnsignedAnnouncementNotInvented:true,
          repeatedSubjectWrites:0,repeatedFramePuts:0,repeatedSignatures:0,repeatedIndexPuts:0,
          originalPublicationEventsUnchanged:true,remoteCollectionEnumerated:false,
          installedNativeSchedulerQualified:false,independentPhysicalDevices:false
        }));
      }finally{legacy.close();indexed.close();}
    }
    console.log('T4_REAL_ORIGINAL_T3_GRAPH_FOCUS_PASS',JSON.stringify({originalKernel:ORIGINAL_KERNEL,
      sourceTransactions:source.commits,sourceInvocations:source.invocations,recipientTransactions:recipient.commits,
      recipientInvocations:recipient.invocations,sourceColdRecovery:true,recipientColdRecovery:true,
      pairedOriginalInventory:inventory.pairs.length,productionHostSerializationQualified:false,fullNetworkRoute:false}));
  }finally{
    for(const c of contexts.values())await c.close().catch(()=>{});
    if(live?.server?.listening)await new Promise(done=>live.server.close(done));
    rmSync(root,{recursive:true,force:true});
  }
});
