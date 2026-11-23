import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID,generateKeyPairSync,sign,verify as verifySignature,
  randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {createRequire} from 'node:module';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {materializeIntegrationHost,serveRealKernelHost}
  from '../../t3-core/scripts/real-kernel-e2e.mjs';
import {assertQualifiedKernelArtifact}
  from '../../t3-core/src/factory2/products/domain-completion/independent-browser-witness.mjs';
import {INITIAL_EXPORT_STATE,exportReducer}
  from '../../t3-core/src/modules/exchange/features/state/export-machine.ts';
import {createT4OriginalExchangeHandoff}
  from '../src/network/original-exchange-handoff.mjs';
import {createWebDavPackageTransport,packageSha256}
  from '../src/network/webdav-package-transfer.mjs';
import {readT4OriginalEventWindow}
  from '../src/network/original-event-window.mjs';
import {createT4OriginalObjectBacklog,publishT4OriginalObjectBacklog,
  replayT4OriginalObjectBacklog}
  from '../src/network/original-object-backlog.mjs';
import {prepareT4OriginalAssetDelta,publishT4OriginalAssetDelta,
  fetchT4OriginalAssetDelta,applyT4OriginalAssetDelta,
  advanceT4OriginalAssetCursor}
  from '../src/network/original-asset-delta.mjs';
import {prepareT4OriginalRelationPutDelta,publishT4OriginalRelationPutDelta,
  fetchT4OriginalRelationPutDelta,applyT4OriginalRelationPutDelta,
  advanceT4OriginalRelationCursor}
  from '../src/network/original-relation-delta.mjs';
import {captureT4OriginalDeletionAtMutation,publishT4OriginalDeleteDelta,
  fetchT4OriginalDeleteDelta,applyT4OriginalDeleteDelta,
  reconcileT4OriginalDeleteFromT3Event,advanceT4OriginalDeleteCursor}
  from '../src/network/original-deletion-delta.mjs';
import {captureT4OriginalObjectMutation}
  from '../src/network/original-object-mutation-capture.mjs';
import {reconcileT4OriginalMutationIntent}
  from '../src/network/original-object-intent-recovery.mjs';
import {createT4OriginalHostCaptureAdapter}
  from '../src/network/original-host-capture-adapter.mjs';
import {publishT4OriginalHostOutbox,inspectT4OriginalHostOutboxNetwork}
  from '../src/network/original-host-outbox-delivery.mjs';
import {createT4OriginalHostOutboxDispatcher}
  from '../src/network/original-host-outbox-dispatcher.mjs';
import {createT4OriginalHostRecipientDispatcher}
  from '../src/network/original-host-recipient-dispatcher.mjs';
import {prepareT4OriginalHostRecipientPlan}
  from '../src/network/original-host-recipient-plan.mjs';
import {createT4OriginalHostExchangeCycle}
  from '../src/network/original-host-exchange-cycle.mjs';
import {createT4OriginalNetworkReplayPort}
  from '../src/network/original-network-replay-checkpoint.mjs';
import {createT4OriginalNetworkSessionPhasePort}
  from '../src/network/original-network-session-phases.mjs';
import {verifyT4OriginalSourceHeadCausality}
  from '../src/network/original-network-source-head-proof.mjs';
import {prepareT4CandidateOpaqueChunks}
  from '../src/network/standard-network-opaque-chunks.mjs';
import {openT4OriginalNetworkObjectChange,
  inspectT4OriginalNetworkRecipientResult,
  applyT4OriginalNetworkObjectChange,
  createT4OriginalNetworkAppliedAckBody}
  from '../src/network/original-network-subject-apply.mjs';
import {digestT4OriginalObjectContent}
  from '../src/network/original-object-delta.mjs';
import {createT4CandidateUnsignedFrame,signT4CandidateFrame}
  from '../src/network/standard-network-wire-candidate.mjs';
import {createT4CandidateFrameTransport}
  from '../src/network/standard-network-wire-transport.mjs';
import {persistT4OriginalHostPlanCarrier,
  inspectT4OriginalHostImportedPlanCarrier}
  from '../src/network/original-host-plan-carrier.mjs';
import {createT4OriginalHostDispatchTaskBinding}
  from '../src/network/original-host-dispatch-task-binding.mjs';
import {createT4NetworkTopology,executeT4NetworkRoute}
  from '../src/network/network-topology.mjs';
import {prepareT4OriginalObjectDelta,publishT4OriginalObjectDelta,
  fetchT4OriginalObjectDelta,applyT4OriginalObjectDelta,
  advanceT4OriginalObjectDeltaCursor}
  from '../src/network/original-object-delta.mjs';

const require=createRequire(new URL('../../t3-core/package.json',import.meta.url));
const {chromium}=require('playwright');
const SERVICE='iwxa.workspace.integration';
const ORIGINAL_KERNEL='0.3.6';
const ORIGINAL_ID='iwxa-kernel-k036-same-store-history-20261019-qualified.1';
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');

const write=(base,path,content)=>{
  const full=join(base,...path.split('/'));
  mkdirSync(join(full,'..'),{recursive:true});
  writeFileSync(full,content);
};

function originalT3ConfirmedState({workspaceId,artifact,preview,receipt}){
  let state=INITIAL_EXPORT_STATE;
  const step=event=>{state=exportReducer(state,event);};
  step({type:'load-workspaces'});
  step({type:'workspaces-loaded',catalog:[{workspace_id:workspaceId,profile:'generic',deleted_at:null}],
    initialWorkspaces:[workspaceId]});
  step({type:'preview-started'});
  step({type:'preview-succeeded',preview});
  step({type:'ack-sensitive',value:true});
  step({type:'package-started'});
  step({type:'package-succeeded',artifact});
  step({type:'download-initiated'});
  step({type:'ack-file-saved',value:true});
  step({type:'confirm-started'});
  step({type:'confirm-succeeded',receipt});
  assert.equal(state.status,'confirmed','actual T3 ExportState never reached confirmed');
  return state;
}

test('real original T2 0.3.6 Kernel .iwxa traverses T4 HTTPS into independent T3 Kernel and survives two cold browser processes',{
  timeout:240000,
},async()=>{
  const qualified=process.env.IWXA_T2_QUALIFIED_KERNEL_DIST;
  assert.ok(qualified&&existsSync(join(qualified,'_iwxa/runtime/0.3.6/runtime.js')),
    'QUALIFIED_ORIGINAL_T2_RUNTIME_REQUIRED');
  assert.ok(process.env.T4_TEST_URL&&process.env.T4_TEST_AUTH,
    'REAL_T4_APACHE_URL_AND_AUTH_REQUIRED');
  const root=mkdtempSync(join(tmpdir(),'iwxa-t4-original-kernel-webdav-'));
  const dist=join(root,'dist'),sourceProfile=join(root,'source-browser'),
    recipientProfile=join(root,'recipient-browser');
  mkdirSync(dist);
  const workspaceId='t4:original:'+randomUUID(),objectId='t4:work:'+randomUUID(),
    linkedObjectId='t4:linked:'+randomUUID(),relationId='t4:relation:'+randomUUID(),
    assetId='t4-asset-'+randomUUID(),
    title='Real original T2 result transferred over T4 network '+randomUUID(),
    linkedTitle='Linked work from the complete original T2 Workspace',
    assetText='Original T2 file content preserved across T4 network transfer';
  const kernelRuntimePath=join(dist,'_iwxa/runtime/0.3.6/runtime.js');
  let live=null,sourceContext=null,recipientContext=null,transport=null;
  try{
    cpSync(join(qualified,'_iwxa'),join(dist,'_iwxa'),{recursive:true});
    assertQualifiedKernelArtifact(dist,{kernel:ORIGINAL_KERNEL,contract:'1.3.0',
      artifactId:ORIGINAL_ID});
    const pinnedKernelSha=sha(kernelRuntimePath);
    live=await serveRealKernelHost(dist);
    const host=materializeIntegrationHost(dist,live.origin);
    host.passport.permissions.operations=['t1.commitObjectGraph'];
    host.domain.runtime.kernel_release=ORIGINAL_KERNEL;
    host.domain.runtime.runtime_version=ORIGINAL_KERNEL;
    host.workspaceConfig.host.required_runtime_version=ORIGINAL_KERNEL;
    host.workspaceConfig.host.required_contract_version='1.3.0';
    write(dist,'_iwxa/domain.json',JSON.stringify(host.domain));
    write(dist,'workspace/workspace.config.json',JSON.stringify(host.workspaceConfig));
    const passport='_iwxa/services/'+SERVICE+'.json';
    write(dist,passport,JSON.stringify(host.passport));
    write(dist,'_iwxa/service-catalog.json',JSON.stringify({
      count:1,entries:[{service_id:SERVICE,service_version:host.passport.service_version,
        base_path:host.passport.base_path,supported_levels:host.passport.supported_levels,
        file:passport,sha256:sha(join(dist,passport))}],
    }));
    write(dist,'workspace/index.html',
      '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>IWXA T4 Test</title>'+
      '</head><body><main><h1>IWXA original Workspace</h1></main>'+
      '<script src="/_iwxa/loader.js"></script></body></html>');

    const launch=profile=>chromium.launchPersistentContext(profile,{
      headless:true,ignoreHTTPSErrors:true,args:['--no-sandbox','--ignore-certificate-errors'],
    });
    const opened=async context=>{
      const page=context.pages()[0]||await context.newPage();
      await page.goto(live.origin+'/workspace/',{waitUntil:'domcontentloaded',timeout:30000});
      await page.waitForFunction(()=>typeof window.IWXA?.connect==='function',
        null,{timeout:30000});
      return page;
    };

    sourceContext=await launch(sourceProfile);
    const sourcePage=await opened(sourceContext);
    const actual=await sourcePage.evaluate(async({SERVICE,workspaceId,objectId,title,linkedObjectId,linkedTitle,relationId,assetId,assetText})=>{
      const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
      const required=['t1.createWorkspace','t1.putObject','t1.getObject','t2.exportPreview',
        't2.exportPackage','t2.confirmExport'];
      for(const operation of required)
        if(!kernel.granted_operations?.includes(operation))
          throw Error('ORIGINAL_T2_OPERATION_MISSING:'+operation);
      await kernel.t1.createWorkspace({workspace_id:workspaceId,profile:'generic'});
      const stored=await kernel.t1.putObject({
        workspace_id:workspaceId,object_id:objectId,schema_id:'iwxa.demo.note',
        schema_version:'1.0.0',data:{title},extensions:{},base_revision:0,
        event:{event_type:'t4.original.work.created',payload:{title}},
      });
      if(stored?.object?.object_id!==objectId)throw Error('ORIGINAL_T2_OBJECT_WRITE_FAILED');
      await kernel.t1.putObject({
        workspace_id:workspaceId,object_id:linkedObjectId,schema_id:'iwxa.demo.note',
        schema_version:'1.0.0',data:{title:linkedTitle},extensions:{future:{preserve:'yes'}},
        base_revision:0,event:{event_type:'t4.original.linked.work.created',payload:{}},
      });
      await kernel.t1.putRelation({
        workspace_id:workspaceId,relation_id:relationId,from_object_id:objectId,
        to_object_id:linkedObjectId,kind:'related',
        event:{event_type:'t4.original.relation.created',payload:{}},
      });
      await kernel.t1.putAsset({
        workspace_id:workspaceId,asset_id:assetId,object_id:objectId,
        mime:'text/plain',bytes:new TextEncoder().encode(assetText),
        event:{event_type:'t4.original.asset.created',payload:{}},
      });
      const options={workspaces:[workspaceId],include_history:true,
        include_assets:true,include_relations:true,include_schemas:true};
      const preview=await kernel.t2.exportPreview(options);
      if(preview.counts?.objects!==2||preview.counts?.relations!==1||
        preview.counts?.assets!==1||preview.counts?.schemas<1||
        preview.counts?.events<4)
        throw Error('ORIGINAL_T2_FULL_WORKSPACE_INVENTORY_MISSING');
      const artifact=await kernel.t2.exportPackage(options);
      const receipt=await kernel.t2.confirmExport({
        package_digest:artifact.package_digest,workspace_ids:[workspaceId],
      });
      const originalEvents=await kernel.t1.listEventsSince(workspaceId);
      return {preview,originalEvents,artifact:{...artifact,bytes:Array.from(artifact.bytes)},
        receipt,grants:kernel.granted_operations,contract:kernel.contract_version,
        runtime:kernel.runtime_version};
    },{SERVICE,workspaceId,objectId,title,linkedObjectId,linkedTitle,relationId,assetId,assetText});
    assert.equal(actual.runtime,ORIGINAL_KERNEL);
    assert.equal(actual.contract,'1.3.0');
    assert.ok(actual.artifact.bytes.length>0);
    actual.artifact.bytes=Uint8Array.from(actual.artifact.bytes);
    const state=originalT3ConfirmedState({...actual,workspaceId});
    const originalEventPort={
      workspaceId,originalWriteOwnerRef:'original:t2:exchange',
      authorizeOriginalRead:async ctx=>actual.grants.includes(ctx.operation),
      readOriginalEvents:async()=>actual.originalEvents,
    };
    const firstWindow=await readT4OriginalEventWindow({
      ...originalEventPort,maxEvents:3,
    });
    assert.equal(firstWindow.window.count,3);
    assert.equal(firstWindow.window.recipientApplied,false);
    const remainingWindow=await readT4OriginalEventWindow({
      ...originalEventPort,cursor:firstWindow.nextCursor,maxEvents:1024,
    });
    assert.equal(firstWindow.window.count+remainingWindow.window.count,
      actual.originalEvents.length);
    assert.ok(actual.originalEvents.length>=3);
    assert.equal(remainingWindow.window.hasMore,false);
    assert.ok(firstWindow.window.eventRefs.every(e=>!Object.hasOwn(e,'payload')));
    assert.equal(remainingWindow.window.causalOrderProven,false);
    console.log('T4_ORIGINAL_T3_EVENT_WINDOW_PREFIX_PASS',JSON.stringify({
      originalKernel:ORIGINAL_KERNEL,
      originalEventCount:actual.originalEvents.length,
      firstWindowCount:firstWindow.window.count,
      nextWindowCount:remainingWindow.window.count,
      cursorDoesNotReplaceOriginalStore:true,
    }));
    const policy={
      objectFamily:'owner-exported-package',workspaceId,authorityRoot:'original:t2:source',
      writeOwnerRef:'original:t2:exchange',primaryPlacement:'LOCAL_PRIMARY_HOSTED_REPLICA',
      allowedLocations:['test-webdav'],retentionClass:'test',recoveryClass:'test',
      universalCloudMaster:false,subjectActionAuthority:false,
    };
    transport=createWebDavPackageTransport({
      baseUrl:process.env.T4_TEST_URL,locationRef:'test-webdav',placementPolicy:policy,
      getMode:()=> 'T4_NETWORK',authorize:async()=>true,
      getAuthorizationHeader:async()=>process.env.T4_TEST_AUTH,
    });
    const selection={workspace_id:workspaceId};
    const sourceOriginalPort={
      hasOperation:op=>actual.grants.includes(op),
    };
    const sender=createT4OriginalExchangeHandoff({
      transport,originalKernel:sourceOriginalPort,workspaceId,
      currentWorkspace:{get:()=>selection,subscribe:()=>()=>{}},
      readOriginalExportState:()=>state,
    });
    const published=await sender.publishConfirmedExport();
    assert.equal(published.transportReceipt.state,'PUBLISHED_AND_READ_BACK');
    assert.equal(published.originalImportCommitted,false);
    await sourceContext.close();sourceContext=null;

    recipientContext=await launch(recipientProfile);
    let recipientPage=await opened(recipientContext);
    const receiving=await recipientPage.evaluate(async SERVICE=>{
      const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
      return {operations:kernel.granted_operations,contract:kernel.contract_version,
        runtime:kernel.runtime_version};
    },SERVICE);
    assert.equal(receiving.runtime,ORIGINAL_KERNEL);
    const receiverKernel={
      hasOperation:op=>receiving.operations.includes(op),
      importPreview:bytes=>recipientPage.evaluate(async({SERVICE,bytes})=>{
        const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
        return kernel.t2.importPreview(Uint8Array.from(bytes));
      },{SERVICE,bytes:Array.from(bytes)}),
      importCancel:token=>recipientPage.evaluate(async({SERVICE,token})=>{
        const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
        return kernel.t2.importCancel(token);
      },{SERVICE,token}),
    };
    const receiver=createT4OriginalExchangeHandoff({
      transport,originalKernel:receiverKernel,workspaceId,
      currentWorkspace:{get:()=>null,subscribe:()=>()=>{}},
      readOriginalExportState:()=>null,
    });
    const prepared=await receiver.previewRemoteImport({
      key:published.sha256+'.iwxa',expectedSha256:published.sha256,
    });
    assert.equal(prepared.originalImportCommitted,false);
    assert.equal(prepared.originalPreview.package_digest,actual.artifact.package_digest);
    const handle=prepared.originalPreview;
    const mode=handle.allowed_modes?.includes('full')?'full':'selective';
    const commit=await recipientPage.evaluate(async({SERVICE,handle,workspaceId,mode})=>{
      const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
      return kernel.t2.importCommit({
        preview_token:handle.preview_token,package_digest:handle.package_digest,
        plan:{mode,include_workspaces:[workspaceId],include_history:true,
          include_assets:true,include_relations:true,conflict:'skip'},
      });
    },{SERVICE,handle:{preview_token:handle.preview_token,package_digest:handle.package_digest},
      workspaceId,mode});
    assert.ok(commit,'original T2 Kernel did not commit import');
    const verify=async page=>page.evaluate(async({SERVICE,workspaceId,objectId,linkedObjectId,assetId})=>{
      const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
      const workspace=await kernel.t1.getWorkspace(workspaceId);
      const object=await kernel.t1.getObject(workspaceId,objectId);
      const linked=await kernel.t1.getObject(workspaceId,linkedObjectId);
      const asset=await kernel.t1.getAsset(workspaceId,assetId);
      const inventory=await kernel.t2.exportPreview({
        workspaces:[workspaceId],include_history:true,
        include_assets:true,include_relations:true,include_schemas:true,
      });
      return {workspace:workspace?.workspace_id,object:object?.object?.object_id,
        title:object?.object?.data?.title,revision:object?.object?.revision,
        linkedTitle:linked?.object?.data?.title,
        linkedExtension:linked?.object?.extensions?.future?.preserve,
        assetText:asset?new TextDecoder().decode(asset.bytes):null,
        assetMime:asset?.asset?.mime??null,objects:inventory.counts.objects,
        relations:inventory.counts.relations,assets:inventory.counts.assets,
        schemas:inventory.counts.schemas,events:inventory.counts.events};
    },{SERVICE,workspaceId,objectId,linkedObjectId,assetId});
    const initial=await verify(recipientPage);
    assert.deepEqual(initial,{
      workspace:workspaceId,object:objectId,title,revision:1,linkedTitle,
      linkedExtension:'yes',assetText,assetMime:'text/plain',objects:2,
      relations:1,assets:1,schemas:initial.schemas,events:initial.events,
    });
    assert.ok(initial.schemas>=1 && initial.events>=4);

    // The real original source T3 Kernel evolves AFTER the first Workspace import.
    // Only a single object revision, not the whole Workspace, crosses the delta wire.
    const nextTitle='Updated original T3 object over T4 delta '+randomUUID();
    sourceContext=await launch(sourceProfile);
    let activeSourcePage=await opened(sourceContext);
    const evolved=await activeSourcePage.evaluate(async({SERVICE,workspaceId,objectId,nextTitle})=>{
      const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
      const previous=await kernel.t1.getObject(workspaceId,objectId);
      const previousRevision=previous.object.revision;
      const saved=await kernel.t1.putObject({
        workspace_id:workspaceId,object_id:objectId,
        schema_id:previous.object.schema_id,schema_version:previous.object.schema_version,
        data:{...previous.object.data,title:nextTitle},
        extensions:previous.object.extensions??{},base_revision:previousRevision,
        event:{event_type:'t4.original.work.updated',payload:{title:nextTitle}},
      });
      const events=await kernel.t1.listEventsSince(workspaceId);
      const sourceObject=await kernel.t1.getObject(workspaceId,objectId);
      return {previousRevision,saved,events,sourceObject};
    },{SERVICE,workspaceId,objectId,nextTitle});
    assert.equal(evolved.previousRevision,1);
    assert.equal(evolved.sourceObject?.object?.revision,2);
    const newWindow=await readT4OriginalEventWindow({
      ...originalEventPort,cursor:remainingWindow.nextCursor,maxEvents:1,
      readOriginalEvents:async()=>evolved.events,
    });
    assert.equal(newWindow.window.count,1);
    assert.equal(newWindow.window.eventRefs[0].eventId,evolved.saved.event.event_id);
    assert.equal(newWindow.window.eventRefs[0].revision,2);
    assert.equal(newWindow.window.hasMore,false);
    const preparedDelta=await prepareT4OriginalObjectDelta({
      window:newWindow.window,workspaceId,objectId,
      originalWriteOwnerRef:'original:t2:exchange',
      originalKernel:{
        hasOperation:op=>actual.grants.includes(op),
        getObject:async()=>evolved.sourceObject,
      },
      authorizeOriginalRead:async ctx=>actual.grants.includes(ctx.operation),
      getMode:()=> 'T4_NETWORK',
    });
    assert.equal(preparedDelta.delta.sourceRevision,2);
    const deltaTopology=createT4NetworkTopology({
      topologyRef:'t4:source:route:'+workspaceId,revision:1,
      localNodeRef:'node:original-source',
      nodes:[
        {nodeRef:'node:original-source',kind:'LOCAL_DEVICE',
          subjectRef:'original:t2:source',operatorRef:'original:t2:source',
          locationRef:'local:original',availability:'AVAILABLE',
          advertisedCapabilities:[]},
        {nodeRef:'node:qualified-apache',kind:'THIRD_PARTY_SERVER',
          subjectRef:'original:t2:source',operatorRef:'operator:apache',
          locationRef:'test-webdav',profileRef:'profile:apache',
          availability:'AVAILABLE',
          advertisedCapabilities:['delta.push','delta.pull']},
      ],
      profiles:[{profileRef:'profile:apache',mode:'THIRD_PARTY',
        operatorRef:'operator:apache',locationRef:'test-webdav',
        endpointUrl:process.env.T4_TEST_URL}],
      connections:[{
        connectionRef:'connection:apache',sourceNodeRef:'node:original-source',
        targetNodeRef:'node:qualified-apache',profileRef:'profile:apache',
        state:'READY',capabilities:['delta.push','delta.pull'],
        objectFamilies:['owner-exported-package'],
      }],
      placements:[{policy:{...policy,
        allowedLocations:['local:original','test-webdav']},
        primaryNodeRef:'node:original-source',
        replicaNodeRefs:['node:qualified-apache']}],
    });
    const deltaRoute=(capability,authorization,executeTransport)=>
      executeT4NetworkRoute({
        topology:deltaTopology,workspaceId,objectFamily:'owner-exported-package',
        targetNodeRef:'node:qualified-apache',capability,
        getMode:()=> 'T4_NETWORK',
        verifyOriginalEndpoint:async ctx=>
          ctx.endpointUrl===process.env.T4_TEST_URL&&
          ctx.operatorRef==='operator:apache'&&
          ctx.originalWriteOwnerRef==='original:t2:exchange',
        authorizeOriginalOperation:async ctx=>
          ctx.operation===capability&&authorization(),
        executeTransport,
      });
    const deltaTransport=createWebDavPackageTransport({
      baseUrl:process.env.T4_TEST_URL,locationRef:'test-webdav',
      placementPolicy:policy,keySuffix:'.t4d',
      getMode:()=> 'T4_NETWORK',authorize:async()=>true,
      getAuthorizationHeader:async()=>process.env.T4_TEST_AUTH,
    });
    try {
      const sent=await deltaRoute('delta.push',
        ()=>actual.grants.includes('t1.getObject'),
        ()=>publishT4OriginalObjectDelta({
          prepared:preparedDelta,transport:deltaTransport,
        }));
      assert.equal(sent.originalRecipientApplied,false);
      assert.equal(sent.cursorAdvanced,false);
      const received=await deltaRoute('delta.pull',
        ()=>receiving.operations.includes('t1.getObject'),
        ()=>fetchT4OriginalObjectDelta({
          transport:deltaTransport,key:sent.key,sha256:sent.sha256,
          workspaceId,originalWriteOwnerRef:'original:t2:exchange',
        }));
      assert.ok(preparedDelta.bytes.length<actual.artifact.bytes.length,
        'original T4 single-object delta must be smaller than initial .iwxa');
      assert.equal(received.delta.sourceEventId,evolved.saved.event.event_id);

      let suppressFirstAcknowledgement=true;
      const receiverGraphKernel={
        hasOperation:op=>receiving.operations.includes(op),
        getObject:(workspaceId,objectId)=>recipientPage.evaluate(
          async({SERVICE,workspaceId,objectId})=>{
            const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
            return kernel.t1.getObject(workspaceId,objectId);
          },{SERVICE,workspaceId,objectId}),
        commitObjectGraph:async input=>{
          const receipt=await recipientPage.evaluate(async({SERVICE,input})=>{
            const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
            return kernel.t1.commitObjectGraph(input);
          },{SERVICE,input});
          if(suppressFirstAcknowledgement){
            suppressFirstAcknowledgement=false;
            throw Object.assign(new Error('SIMULATED_DELTA_ACK_LOST'),{
              code:'NETWORK_TIMEOUT',
            });
          }
          return receipt;
        },
      };
      assert.ok(receiving.operations.includes('t1.commitObjectGraph'),
        'original T3 graph commit operation must be granted by the existing passport');
      const application={
        received,originalKernel:receiverGraphKernel,
        authorizeOriginalWrite:async ctx=>receiving.operations.includes(ctx.operation),
        verifyOriginalSourceEvent:async proof=>
          proof.sourceEventId===evolved.saved.event.event_id&&
          proof.sourceEventDigest===newWindow.window.eventRefs[0].eventDigest&&
          proof.objectContentDigest===preparedDelta.delta.objectContentDigest&&
          proof.originalWriteOwnerRef==='original:t2:exchange'&&
          proof.sourceRevision===evolved.sourceObject.object.revision&&
          proof.networkEnvelopeIsNotSignedEvidence===true,
        getMode:()=> 'T4_NETWORK',
      };
      await assert.rejects(applyT4OriginalObjectDelta(application),error=>{
        assert.equal(error.code,'OBJECT_DELTA_OUTCOME_UNKNOWN');
        assert.equal(error.details.automaticRetryAllowed,false);return true;
      });
      // No delivery cursor is advanced on an unknown outcome.
      const changedWhileAckLost=await verify(recipientPage);
      assert.equal(changedWhileAckLost.title,nextTitle);
      assert.equal(changedWhileAckLost.revision,2);
      const reconciled=await applyT4OriginalObjectDelta(application);
      assert.equal(reconciled.originalReceipt.deduplicated,true);
      assert.equal(reconciled.originalObjectReadbackPassed,true);
      const savedCursor=await advanceT4OriginalObjectDeltaCursor({
        window:newWindow.window,nextCursor:newWindow.nextCursor,
        acknowledgement:reconciled.acknowledgement,
        verifyOriginalRecipient:async ctx=>{
          const target=await verify(recipientPage);
          return ctx.originalReceiptRef===reconciled.originalReceiptRef&&
            target.revision===2&&target.title===nextTitle;
        }
      });
      assert.equal(savedCursor.verified,true);
      assert.equal(savedCursor.originalT3Cursor.lastEventId,evolved.saved.event.event_id);
      const updated=await verify(recipientPage);
      assert.equal(updated.title,nextTitle);
      assert.equal(updated.revision,2);
      assert.equal(updated.objects,initial.objects);
      assert.equal(updated.relations,initial.relations);
      assert.equal(updated.assets,initial.assets);
      assert.ok(updated.events>=initial.events);
      console.log('T4_REAL_ORIGINAL_T3_OBJECT_DELTA_IDEMPOTENT_ACK_RECOVERY_PASS',
        JSON.stringify({
          originalKernel:ORIGINAL_KERNEL,deltaBytes:preparedDelta.bytes.length,
          originalArchiveBytes:actual.artifact.bytes.length,
          sourceRevision:2,recipientRevision:updated.revision,
        originalT4RouteSelected:true,
          originalReceiptRef:reconciled.originalReceiptRef,
          idempotentReplay:reconciled.originalReceipt.deduplicated===true,
          cursorCommittedOnlyAfterOriginalReceipt:savedCursor.verified,
          originalKernelUsed:true,
        }));

      // Two independent ORIGINAL T3 Stores now mutate the same base revision.
      // T4 must NOT use last-write-wins to hide the conflict.
      const localConflictTitle='Recipient independent change '+randomUUID();
      const sourceConflictTitle='Source independent change '+randomUUID();
      const locallyEdited=await recipientPage.evaluate(async({SERVICE,workspaceId,objectId,title})=>{
        const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
        const before=await kernel.t1.getObject(workspaceId,objectId);
        const saved=await kernel.t1.putObject({
          workspace_id:workspaceId,object_id:objectId,
          schema_id:before.object.schema_id,schema_version:before.object.schema_version,
          data:{...before.object.data,title},extensions:before.object.extensions??{},
          base_revision:before.object.revision,
          event:{event_type:'t4.original.recipient.concurrent-change',payload:{title}},
        });
        return{eventId:saved.event.event_id,revision:saved.object.revision};
      },{SERVICE,workspaceId,objectId,title:localConflictTitle});
      const sourceEdit=await activeSourcePage.evaluate(async({SERVICE,workspaceId,objectId,title})=>{
        const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
        const before=await kernel.t1.getObject(workspaceId,objectId);
        const saved=await kernel.t1.putObject({
          workspace_id:workspaceId,object_id:objectId,
          schema_id:before.object.schema_id,schema_version:before.object.schema_version,
          data:{...before.object.data,title},extensions:before.object.extensions??{},
          base_revision:before.object.revision,
          event:{event_type:'t4.original.source.concurrent-change',payload:{title}},
        });
        return{eventId:saved.event.event_id,
          sourceObject:await kernel.t1.getObject(workspaceId,objectId),
          events:await kernel.t1.listEventsSince(workspaceId)};
      },{SERVICE,workspaceId,objectId,title:sourceConflictTitle});
      assert.equal(locallyEdited.revision,3);
      assert.equal(sourceEdit.sourceObject.object.revision,3);
      const conflictWindow=await readT4OriginalEventWindow({
        ...originalEventPort,cursor:savedCursor.originalT3Cursor,maxEvents:1,
        readOriginalEvents:async()=>sourceEdit.events,
      });
      assert.equal(conflictWindow.window.count,1);
      assert.equal(conflictWindow.window.eventRefs[0].eventId,sourceEdit.eventId);
      const conflictPrepared=await prepareT4OriginalObjectDelta({
        window:conflictWindow.window,workspaceId,objectId,
        originalWriteOwnerRef:'original:t2:exchange',
        originalKernel:{hasOperation:op=>actual.grants.includes(op),
          getObject:async()=>sourceEdit.sourceObject},
        authorizeOriginalRead:async ctx=>actual.grants.includes(ctx.operation),
        getMode:()=> 'T4_NETWORK',
      });
      const conflictSent=await deltaRoute('delta.push',
        ()=>actual.grants.includes('t1.getObject'),
        ()=>publishT4OriginalObjectDelta({
          prepared:conflictPrepared,transport:deltaTransport,
        }));
      const conflictReceived=await deltaRoute('delta.pull',
        ()=>receiving.operations.includes('t1.getObject'),
        ()=>fetchT4OriginalObjectDelta({
          transport:deltaTransport,key:conflictSent.key,sha256:conflictSent.sha256,
          workspaceId,originalWriteOwnerRef:'original:t2:exchange',
        }));
      const beforeConflict=await verify(recipientPage);
      await assert.rejects(applyT4OriginalObjectDelta({
        ...application,received:conflictReceived,
        verifyOriginalSourceEvent:async proof=>
          proof.sourceEventId===sourceEdit.eventId&&
          proof.sourceRevision===sourceEdit.sourceObject.object.revision&&
          proof.sourceEventDigest===conflictWindow.window.eventRefs[0].eventDigest&&
          proof.objectContentDigest===conflictPrepared.delta.objectContentDigest,
      }),error=>error.code==='OBJECT_DELTA_REVISION_CONFLICT');
      const preserved=await verify(recipientPage);
      assert.deepEqual(preserved,beforeConflict);
      assert.equal(preserved.revision,3);
      assert.equal(preserved.title,localConflictTitle);
      assert.notEqual(preserved.title,sourceConflictTitle);
      assert.equal(savedCursor.originalT3Cursor.lastEventId,evolved.saved.event.event_id);
      console.log('T4_REAL_ORIGINAL_T3_CONCURRENT_REVISION_CONFLICT_PRESERVED_PASS',
        JSON.stringify({recipientRevision:3,sourceRevision:3,
          recipientLocalValuePreserved:true,networkDeltaDelivered:true,
          noSilentLastWriteWins:true,cursorNotAdvancedOnConflict:true,
          originalT3WriteAuthorityUsed:true}));

      // The original T3 recipient disconnects. Its linked object stays at revision 1.
      // The original source captures EVERY revision at the moment it is written;
      // missing source snapshots cannot be reconstructed from Event payloads alone.
      await recipientContext.close();recipientContext=null;
      const captured=[],originalEventRows=new Map();
      let sourceCursor=conflictWindow.nextCursor;
      for(let number=2;number<=4;number++){
        const stagedTitle='Offline linked work revision '+number+' '+randomUUID();
        const sourceChange=await activeSourcePage.evaluate(async({
          SERVICE,workspaceId,linkedObjectId,stagedTitle
        })=>{
          const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
          const before=await kernel.t1.getObject(workspaceId,linkedObjectId);
          const saved=await kernel.t1.putObject({
            workspace_id:workspaceId,object_id:linkedObjectId,
            schema_id:before.object.schema_id,
            schema_version:before.object.schema_version,
            data:{...before.object.data,title:stagedTitle},
            extensions:before.object.extensions??{},
            base_revision:before.object.revision,
            event:{event_type:'t4.original.offline.linked-change',
              payload:{title:stagedTitle}},
          });
          return {saved,sourceObject:await kernel.t1.getObject(workspaceId,linkedObjectId),
            events:await kernel.t1.listEventsSince(workspaceId)};
        },{SERVICE,workspaceId,linkedObjectId,stagedTitle});
        assert.equal(sourceChange.saved.object.revision,number);
        const item=await readT4OriginalEventWindow({
          ...originalEventPort,cursor:sourceCursor,maxEvents:1,
          readOriginalEvents:async()=>sourceChange.events,
        });
        assert.equal(item.window.count,1);
        assert.equal(item.window.eventRefs[0].eventId,
          sourceChange.saved.event.event_id);
        const prepared=await prepareT4OriginalObjectDelta({
          window:item.window,workspaceId,objectId:linkedObjectId,
          originalWriteOwnerRef:'original:t2:exchange',
          originalKernel:{hasOperation:op=>actual.grants.includes(op),
            getObject:async()=>sourceChange.sourceObject},
          authorizeOriginalRead:async ctx=>actual.grants.includes(ctx.operation),
          getMode:()=> 'T4_NETWORK',
        });
        captured.push({window:item.window,nextCursor:item.nextCursor,prepared});
        originalEventRows.set(sourceChange.saved.event.event_id,{
          sourceRevision:number,digest:item.window.eventRefs[0].eventDigest,
          objectContentDigest:prepared.delta.objectContentDigest,
          title:stagedTitle,
        });
        sourceCursor=item.nextCursor;
      }
      const backlog=createT4OriginalObjectBacklog({
        initialCursor:conflictWindow.nextCursor,expectedRecipientRevision:1,
        entries:captured,
      });
      assert.deepEqual(backlog.entries.map(e=>e.sourceRevision),[2,3,4]);
      const publishedBacklog=await publishT4OriginalObjectBacklog({
        plan:backlog,publishPrepared:prepared=>deltaRoute('delta.push',
          ()=>actual.grants.includes('t1.getObject'),
          ()=>publishT4OriginalObjectDelta({prepared,transport:deltaTransport})),
      });
      assert.equal(publishedBacklog.publishedCount,3);
      assert.equal(publishedBacklog.originalRecipientApplied,false);

      // Recipient is restarted only AFTER the three immutable envelopes exist.
      recipientContext=await launch(recipientProfile);
      recipientPage=await opened(recipientContext);
      const recipientLinked=async()=>recipientPage.evaluate(
        async({SERVICE,workspaceId,linkedObjectId})=>{
          const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
          return (await kernel.t1.getObject(workspaceId,linkedObjectId))?.object??null;
        },{SERVICE,workspaceId,linkedObjectId});
      assert.equal((await recipientLinked()).revision,1);

      // Store the verified sync cursor using ORIGINAL T3 object writes. No second Store.
      const checkpointWorkspace='t4:original:checkpoint:'+randomUUID();
      const checkpointObject='t4:sync:cursor:'+randomUUID();
      await recipientPage.evaluate(async({SERVICE,checkpointWorkspace})=>{
        const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
        await kernel.t1.createWorkspace({
          workspace_id:checkpointWorkspace,profile:'generic',
        });
      },{SERVICE,checkpointWorkspace});
      const persistCursor=async ctx=>recipientPage.evaluate(async({
        SERVICE,checkpointWorkspace,checkpointObject,ctx
      })=>{
        const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
        const old=await kernel.t1.getObject(checkpointWorkspace,checkpointObject);
        const existing=old?.object??null;
        if(existing&&
          (existing.data.cursor.lastEventId!==ctx.previousCursor.lastEventId||
           existing.data.cursor.sourcePrefixDigest!==ctx.previousCursor.sourcePrefixDigest))
          return false;
        const record=await kernel.t1.putObject({
          workspace_id:checkpointWorkspace,object_id:checkpointObject,
          schema_id:'iwxa.demo.note',schema_version:'1.0.0',
          data:{cursor:ctx.verifiedCursor,planDigest:ctx.planDigest,
            sourceEventId:ctx.sourceEventId,originalReceiptRef:ctx.originalReceiptRef},
          extensions:{},base_revision:existing?.revision??0,
          event:{event_type:'t4.original.sync.cursor.verified',
            payload:{sourceEventId:ctx.sourceEventId}},
        });
        const checked=await kernel.t1.getObject(checkpointWorkspace,checkpointObject);
        return Boolean(record?.object?.revision===checked?.object?.revision&&
          checked.object.data.cursor.lastEventId===ctx.verifiedCursor.lastEventId);
      },{SERVICE,checkpointWorkspace,checkpointObject,ctx});
      const loadCursor=async()=>recipientPage.evaluate(async({
        SERVICE,checkpointWorkspace,checkpointObject
      })=>{
        const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
        const result=await kernel.t1.getObject(checkpointWorkspace,checkpointObject);
        return result?.object?.data?.cursor??null;
      },{SERVICE,checkpointWorkspace,checkpointObject});

      // The original Kernel applies revision 2, then applies revision 3,
      // but its acknowledgement is deliberately lost AFTER the original write.
      let dropThirdRevisionAck=true;
      const kernelWithAckLoss={
        ...receiverGraphKernel,
        commitObjectGraph:async input=>{
          const receipt=await receiverGraphKernel.commitObjectGraph(input);
          if(input.object.object_id===linkedObjectId&&
            input.object.base_revision===2&&dropThirdRevisionAck){
            dropThirdRevisionAck=false;
            throw Object.assign(new Error('SIMULATED_OFFLINE_BACKLOG_ACK_LOST'),{
              code:'NETWORK_TIMEOUT',
            });
          }
          return receipt;
        },
      };
      const ports=resumeCursor=>({
        plan:backlog,resumeCursor,
        fetchReceived:({key,sha256})=>deltaRoute('delta.pull',
          ()=>receiving.operations.includes('t1.getObject'),
          ()=>fetchT4OriginalObjectDelta({
            transport:deltaTransport,key,sha256,workspaceId,
            originalWriteOwnerRef:'original:t2:exchange',
          })),
        originalKernel:kernelWithAckLoss,
        authorizeOriginalWrite:async ctx=>receiving.operations.includes(ctx.operation),
        verifyOriginalSourceEvent:async proof=>{
          const expected=originalEventRows.get(proof.sourceEventId);
          if(!expected||expected.sourceRevision!==proof.sourceRevision||
            expected.digest!==proof.sourceEventDigest||
            expected.objectContentDigest!==proof.objectContentDigest)return false;
          const currentSource=await activeSourcePage.evaluate(async({SERVICE,workspaceId})=>{
            const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
            return kernel.t1.listEventsSince(workspaceId);
          },{SERVICE,workspaceId});
          const found=currentSource.find(e=>e.event_id===proof.sourceEventId);
          if(!found||found.revision!==proof.sourceRevision)return false;
          const checked=await readT4OriginalEventWindow({
            ...originalEventPort,readOriginalEvents:async()=>[found],maxEvents:1,
          });
          return checked.window.eventRefs[0].eventDigest===proof.sourceEventDigest;
        },
        verifyOriginalRecipient:async ctx=>
          typeof ctx.originalReceiptRef==='string'&&
          /^[a-f0-9-]{36}$/.test(ctx.originalReceiptRef)&&
          (await recipientLinked()).revision===
            originalEventRows.get(ctx.lastEventId)?.sourceRevision,
        verifyOriginalResumeCursor:async ctx=>{
          if(ctx.planDigest!==backlog.planDigest||
            ctx.originalWriteOwnerRef!=='original:t2:exchange')return false;
          const stored=await loadCursor();
          return stored?
            stored.lastEventId===ctx.resumeCursor.lastEventId&&
              stored.sourcePrefixDigest===ctx.resumeCursor.sourcePrefixDigest:
            ctx.resumeCursor.lastEventId===backlog.initialCursor.lastEventId&&
              ctx.resumeCursor.sourcePrefixDigest===backlog.initialCursor.sourcePrefixDigest;
        },
        persistVerifiedCursor:persistCursor,
        getMode:()=> 'T4_NETWORK',
      });
      let lastVerified;
      await assert.rejects(replayT4OriginalObjectBacklog(
        ports(backlog.initialCursor)),error=>{
          assert.equal(error.code,'BACKLOG_REPLAY_STOPPED');
          assert.equal(error.details.index,1);
          assert.equal(error.details.originalCode,'OBJECT_DELTA_OUTCOME_UNKNOWN');
          assert.equal(error.details.processedCount,1);
          lastVerified=error.details.lastVerifiedCursor;
          assert.equal(lastVerified.seenEventCount,backlog.initialCursor.seenEventCount+1);
          return true;
        });
      assert.equal((await recipientLinked()).revision,3);
      assert.deepEqual(await loadCursor(),lastVerified);

      // Reopen a fresh browser process and recover the cursor from ORIGINAL T3.
      await recipientContext.close();recipientContext=null;
      recipientContext=await launch(recipientProfile);
      recipientPage=await opened(recipientContext);
      const restoredCursor=await loadCursor();
      assert.deepEqual(restoredCursor,lastVerified);
      const resumed=await replayT4OriginalObjectBacklog(ports(restoredCursor));
      assert.equal(resumed.originallyVerifiedSkipped,1);
      assert.equal(resumed.originalT3AppliedAndVerified,2);
      assert.equal(resumed.receipts[0].deduplicated,true);
      assert.equal((await recipientLinked()).revision,4);
      assert.equal((await recipientLinked()).data.title,
        originalEventRows.get(backlog.entries[2].eventId).title);
      assert.deepEqual(await loadCursor(),backlog.finalCursor);
      console.log('T4_REAL_ORIGINAL_T3_OFFLINE_THREE_REVISION_BACKLOG_RECOVERY_PASS',
        JSON.stringify({
          originalKernel:ORIGINAL_KERNEL,queuedRevisions:[2,3,4],
          recipientOfflineDuringPublication:true,
          originalT3CheckpointWorkspace:true,
          lostAckAfterOriginalRevision:3,
          resumedFromOriginalKernelAfterColdBrowserRestart:true,
          replayDeduplicated:true,
          recipientFinalRevision:4,sourcePrefixContinuous:true,
          originalWriterStillT3:true,
        }));

      // A real binary Asset update is transferred after the original offline
      // object backlog. The source and recipient use original T2 Asset APIs.
      const changedAssetText='Original T3 revised file over T4 '+randomUUID();
      const originalAssetUpdated=await activeSourcePage.evaluate(async({
        SERVICE,workspaceId,assetId,changedAssetText,
      })=>{
        const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
        const previous=await kernel.t1.getAsset(workspaceId,assetId);
        if(previous.asset.revision!==1)throw Error('ORIGINAL_ASSET_REVISION_NOT_ONE');
        const saved=await kernel.t1.putAsset({
          workspace_id:workspaceId,asset_id:assetId,object_id:previous.asset.object_id,
          mime:previous.asset.mime,base_revision:previous.asset.revision,
          bytes:new TextEncoder().encode(changedAssetText),
          event:{event_type:'t4.original.asset.updated',
            payload:{asset_id:assetId},idempotency_key:'source-asset-'+globalThis.crypto.randomUUID()},
        });
        const read=await kernel.t1.getAsset(workspaceId,assetId);
        return{saved,read:{asset:read.asset,bytes:Array.from(read.bytes)},
          events:await kernel.t1.listEventsSince(workspaceId)};
      },{SERVICE,workspaceId,assetId,changedAssetText});
      assert.equal(originalAssetUpdated.saved.asset.revision,2);
      const assetWindow=await readT4OriginalEventWindow({
        ...originalEventPort,cursor:backlog.finalCursor,maxEvents:1,
        readOriginalEvents:async()=>originalAssetUpdated.events,
      });
      assert.equal(assetWindow.window.count,1);
      assert.equal(assetWindow.window.lastEventId,originalAssetUpdated.saved.event.event_id);
      const assetPrepared=await prepareT4OriginalAssetDelta({
        window:assetWindow.window,workspaceId,assetId,
        originalWriteOwnerRef:'original:t2:exchange',
        originalKernel:{
          hasOperation:op=>actual.grants.includes(op),
          getAsset:async()=>({asset:originalAssetUpdated.read.asset,
            bytes:Uint8Array.from(originalAssetUpdated.read.bytes)}),
        },
        authorizeOriginalRead:async ctx=>actual.grants.includes(ctx.operation),
        getMode:()=> 'T4_NETWORK',
      });
      const assetPublished=await deltaRoute('delta.push',
        ()=>actual.grants.includes('t1.getAsset'),
        ()=>publishT4OriginalAssetDelta({
          prepared:assetPrepared,transport:deltaTransport,
        }));
      assert.equal(assetPublished.originalRecipientApplied,false);
      const assetReceived=await deltaRoute('delta.pull',
        ()=>receiving.operations.includes('t1.getAsset'),
        ()=>fetchT4OriginalAssetDelta({
          transport:deltaTransport,key:assetPublished.key,sha256:assetPublished.sha256,
          workspaceId,originalWriteOwnerRef:'original:t2:exchange',
        }));
      const assetRecipient={
        hasOperation:op=>receiving.operations.includes(op),
        getAsset:async(workspaceId,assetId)=>{
          const read=await recipientPage.evaluate(async({SERVICE,workspaceId,assetId})=>{
            const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
            const result=await kernel.t1.getAsset(workspaceId,assetId);
            return result?{asset:result.asset,bytes:Array.from(result.bytes)}:null;
          },{SERVICE,workspaceId,assetId});
          return read?{asset:read.asset,bytes:Uint8Array.from(read.bytes)}:null;
        },
        putAsset:async input=>{
          const result=await recipientPage.evaluate(async({SERVICE,input})=>{
            const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
            return kernel.t1.putAsset({...input,bytes:Uint8Array.from(input.bytes)});
          },{SERVICE,input:{...input,bytes:Array.from(input.bytes)}});
          if(assetAckLoss){
            assetAckLoss=false;
            throw Object.assign(new Error('SIMULATED_ORIGINAL_ASSET_ACK_LOST'),
              {code:'NETWORK_TIMEOUT'});
          }
          return result;
        },
      };
      let assetAckLoss=true;
      const assetApply={
        received:assetReceived,originalKernel:assetRecipient,
        authorizeOriginalWrite:async ctx=>receiving.operations.includes(ctx.operation),
        verifyOriginalSourceEvent:async proof=>{
          const expected=assetWindow.window.eventRefs[0];
          if(proof.sourceEventId!==expected.eventId||
            proof.sourceEventDigest!==expected.eventDigest||
            proof.sourceRevision!==2||
            proof.assetBytesSha256!==assetPrepared.delta.assetBytesSha256)return false;
          const currentEvents=await activeSourcePage.evaluate(async({SERVICE,workspaceId})=>{
            const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
            return kernel.t1.listEventsSince(workspaceId);
          },{SERVICE,workspaceId});
          const found=currentEvents.find(e=>e.event_id===proof.sourceEventId);
          if(!found)return false;
          const verified=await readT4OriginalEventWindow({
            ...originalEventPort,readOriginalEvents:async()=>[found],maxEvents:1,
          });
          return verified.window.eventRefs[0].eventDigest===expected.eventDigest;
        },
        getMode:()=> 'T4_NETWORK',
      };
      await assert.rejects(applyT4OriginalAssetDelta(assetApply),
        error=>error.code==='ASSET_DELTA_OUTCOME_UNKNOWN'&&
          error.details.automaticRetryAllowed===false);
      const lostAckRead=await assetRecipient.getAsset(workspaceId,assetId);
      assert.equal(lostAckRead.asset.revision,2);
      assert.equal(new TextDecoder().decode(lostAckRead.bytes),changedAssetText);
      const assetAccepted=await applyT4OriginalAssetDelta(assetApply);
      assert.equal(assetAccepted.originalReceipt.deduplicated,true);
      const assetCursor=await advanceT4OriginalAssetCursor({
        window:assetWindow.window,nextCursor:assetWindow.nextCursor,
        acknowledgement:assetAccepted.acknowledgement,
        verifyOriginalRecipient:async ctx=>{
          const state=await assetRecipient.getAsset(workspaceId,assetId);
          return ctx.originalReceiptRef===assetAccepted.originalReceiptRef&&
            state.asset.revision===2&&
            new TextDecoder().decode(state.bytes)===changedAssetText;
        },
      });
      assert.equal(assetCursor.verified,true);
      const afterAsset=await verify(recipientPage);
      assert.equal(afterAsset.assetText,changedAssetText);
      assert.equal(afterAsset.assets,initial.assets);
      console.log('T4_REAL_ORIGINAL_T3_ASSET_BINARY_DELTA_ACK_RECOVERY_PASS',
        JSON.stringify({originalKernel:ORIGINAL_KERNEL,
          sourceAssetRevision:2,recipientAssetRevision:2,
          originalAssetBytesVerified:true,
          originalKernelDeduplicatedAckLoss:true,
          assetDeltaBytes:assetPrepared.bytes.length,
          originalSourceEventVerified:true,
          recipientOriginalAssetReadback:true,
          originalT3CursorVerifiedAfterReceipt:true,
        }));

      // The original source adds a second real graph link, using original
      // t1.putRelation and the existing original Workspace.
      const additionalRelationId='t4:relation:additional:'+randomUUID();
      const sourceRelation=await activeSourcePage.evaluate(async({
        SERVICE,workspaceId,linkedObjectId,objectId,additionalRelationId
      })=>{
        const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
        const saved=await kernel.t1.putRelation({
          workspace_id:workspaceId,relation_id:additionalRelationId,
          from_object_id:linkedObjectId,to_object_id:objectId,kind:'related',
          event:{event_type:'t4.original.relation.additional',
            payload:{relation_id:additionalRelationId},
            idempotency_key:'source-relation-'+globalThis.crypto.randomUUID()},
        });
        const sourceObject=await kernel.t1.getObject(workspaceId,linkedObjectId);
        return {saved,sourceObject,
          events:await kernel.t1.listEventsSince(workspaceId)};
      },{SERVICE,workspaceId,linkedObjectId,objectId,additionalRelationId});
      assert.equal(sourceRelation.saved.relation.relation_id,additionalRelationId);
      const relationWindow=await readT4OriginalEventWindow({
        ...originalEventPort,cursor:assetWindow.nextCursor,maxEvents:1,
        readOriginalEvents:async()=>sourceRelation.events,
      });
      assert.equal(relationWindow.window.count,1);
      assert.equal(relationWindow.window.lastEventId,sourceRelation.saved.event.event_id);
      const relationPrepared=await prepareT4OriginalRelationPutDelta({
        window:relationWindow.window,workspaceId,
        relationId:additionalRelationId,fromObjectId:linkedObjectId,
        originalWriteOwnerRef:'original:t2:exchange',
        originalKernel:{
          hasOperation:op=>actual.grants.includes(op),
          getObject:async()=>sourceRelation.sourceObject,
        },
        authorizeOriginalRead:async ctx=>actual.grants.includes(ctx.operation),
        getMode:()=> 'T4_NETWORK',
      });
      const relationSent=await deltaRoute('delta.push',
        ()=>actual.grants.includes('t1.getObject'),
        ()=>publishT4OriginalRelationPutDelta({
          prepared:relationPrepared,transport:deltaTransport,
        }));
      assert.equal(relationSent.cursorAdvanced,false);
      const relationReceived=await deltaRoute('delta.pull',
        ()=>receiving.operations.includes('t1.getObject'),
        ()=>fetchT4OriginalRelationPutDelta({
          transport:deltaTransport,key:relationSent.key,sha256:relationSent.sha256,
          workspaceId,originalWriteOwnerRef:'original:t2:exchange',
        }));
      let dropOriginalRelationAck=true;
      const relationRecipient={
        hasOperation:op=>receiving.operations.includes(op),
        getObject:async(workspaceId,objectId)=>recipientPage.evaluate(
          async({SERVICE,workspaceId,objectId})=>{
            const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
            return kernel.t1.getObject(workspaceId,objectId);
          },{SERVICE,workspaceId,objectId}),
        putRelation:async input=>{
          const saved=await recipientPage.evaluate(async({SERVICE,input})=>{
            const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
            return kernel.t1.putRelation(input);
          },{SERVICE,input});
          if(dropOriginalRelationAck){
            dropOriginalRelationAck=false;
            throw Object.assign(new Error('SIMULATED_ORIGINAL_RELATION_ACK_LOST'),
              {code:'NETWORK_TIMEOUT'});
          }
          return saved;
        },
      };
      const relationApplication={
        received:relationReceived,originalKernel:relationRecipient,
        authorizeOriginalWrite:async ctx=>receiving.operations.includes(ctx.operation),
        verifyOriginalSourceEvent:async proof=>{
          if(proof.sourceEventId!==sourceRelation.saved.event.event_id||
            proof.sourceEventDigest!==relationWindow.window.eventRefs[0].eventDigest||
            proof.relationContentDigest!==relationPrepared.delta.relationContentDigest)
            return false;
          const currentEvents=await activeSourcePage.evaluate(async({
            SERVICE,workspaceId
          })=>{
            const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
            return kernel.t1.listEventsSince(workspaceId);
          },{SERVICE,workspaceId});
          const found=currentEvents.find(e=>e.event_id===proof.sourceEventId);
          if(!found)return false;
          const verified=await readT4OriginalEventWindow({
            ...originalEventPort,readOriginalEvents:async()=>[found],maxEvents:1,
          });
          return verified.window.eventRefs[0].eventDigest===proof.sourceEventDigest;
        },
        getMode:()=> 'T4_NETWORK',
      };
      await assert.rejects(applyT4OriginalRelationPutDelta(relationApplication),
        error=>error.code==='RELATION_DELTA_OUTCOME_UNKNOWN'&&
          error.details.automaticRetryAllowed===false);
      const afterLostRelationAck=await relationRecipient.getObject(
        workspaceId,linkedObjectId);
      assert.ok(afterLostRelationAck.relations.outgoing.some(
        r=>r.relation_id===additionalRelationId));
      const relationAccepted=await applyT4OriginalRelationPutDelta(
        relationApplication);
      assert.equal(relationAccepted.originalReceipt.deduplicated,true);
      const relationCursor=await advanceT4OriginalRelationCursor({
        window:relationWindow.window,nextCursor:relationWindow.nextCursor,
        acknowledgement:relationAccepted.acknowledgement,
        verifyOriginalRecipient:async ctx=>{
          const checked=await relationRecipient.getObject(workspaceId,linkedObjectId);
          return ctx.originalReceiptRef===relationAccepted.originalReceiptRef&&
            checked.relations.outgoing.some(r=>
              r.relation_id===additionalRelationId&&
              r.from_object_id===linkedObjectId&&r.to_object_id===objectId);
        },
      });
      assert.equal(relationCursor.verified,true);
      const afterNewRelation=await verify(recipientPage);
      assert.equal(afterNewRelation.relations,initial.relations+1);
      console.log('T4_REAL_ORIGINAL_T3_RELATION_DELTA_ACK_RECOVERY_PASS',
        JSON.stringify({originalKernel:ORIGINAL_KERNEL,
          originalT3RelationAdded:true,recipientRelations:afterNewRelation.relations,
          recipientOriginalPutRelationDeduplicated:true,
          originalT3RelationReadback:true,originalEventWitnessVerified:true,
          networkDeltaKey:relationSent.key,
          originalHostCursorVerifiedAfterReceipt:true}));

      // Original T3 must preserve the deletion pre-image BEFORE mutating its own
      // relation/asset. The source capture is stored in a separate original T3
      // technical Workspace, not a parallel T4 Store.
      const sourceCaptureWorkspace='t4:original:predelete:'+randomUUID();
      await activeSourcePage.evaluate(async({SERVICE,sourceCaptureWorkspace})=>{
        const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
        await kernel.t1.createWorkspace({workspace_id:sourceCaptureWorkspace,
          profile:'generic'});
      },{SERVICE,sourceCaptureWorkspace});
      const sourceKernel={
        hasOperation:op=>actual.grants.includes(op),
        getObject:(w,id)=>activeSourcePage.evaluate(async({SERVICE,w,id})=>{
          const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t1.getObject(w,id);
        },{SERVICE,w,id}),
        getAsset:async(w,id)=>{
          const value=await activeSourcePage.evaluate(async({SERVICE,w,id})=>{
            const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
            const result=await kernel.t1.getAsset(w,id);
            return result?{asset:result.asset,bytes:Array.from(result.bytes)}:null;
          },{SERVICE,w,id});
          return value?{asset:value.asset,bytes:Uint8Array.from(value.bytes)}:null;
        },
        deleteRelation:input=>activeSourcePage.evaluate(async({SERVICE,input})=>{
          const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t1.deleteRelation(input);
        },{SERVICE,input}),
        deleteAsset:input=>activeSourcePage.evaluate(async({SERVICE,input})=>{
          const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t1.deleteAsset(input);
        },{SERVICE,input}),
      };
      const persistOriginalPreDeleteWitness=async capture=>
        activeSourcePage.evaluate(async({SERVICE,sourceCaptureWorkspace,capture})=>{
          const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
          const saved=await kernel.t1.putObject({
            workspace_id:sourceCaptureWorkspace,object_id:capture.captureRef,
            schema_id:'iwxa.demo.note',schema_version:'1.0.0',
            data:{title:'Original pre-delete capture',
              preImageDigest:capture.preImageDigest,preImage:capture.preImage,
              captureRef:capture.captureRef},extensions:{},base_revision:0,
            event:{event_type:'t4.original.predel.capture',
              payload:{captureRef:capture.captureRef}},
          });
          const checked=await kernel.t1.getObject(
            sourceCaptureWorkspace,capture.captureRef);
          return saved.object.revision===checked.object.revision&&
            checked.object.data.preImageDigest===capture.preImageDigest;
        },{SERVICE,sourceCaptureWorkspace,capture});
      const readOriginalPreDeleteWitness=async capture=>
        activeSourcePage.evaluate(async({SERVICE,sourceCaptureWorkspace,capture})=>{
          const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
          const value=await kernel.t1.getObject(
            sourceCaptureWorkspace,capture.captureRef);
          return value?.object?.data??null;
        },{SERVICE,sourceCaptureWorkspace,capture});
      const readSourceEvents=()=>activeSourcePage.evaluate(async({SERVICE,workspaceId})=>{
        const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
        return kernel.t1.listEventsSince(workspaceId);
      },{SERVICE,workspaceId});
      const originalOutboxNetworkArgs=(kind,captureRef,subjectId)=>({
        kind,captureRef,subjectId,workspaceId,
        originalWriteOwnerRef:'original:t2:exchange',
        readOriginalIntent:ctx=>readSourceTechnical('intent',ctx.captureRef),
        readOriginalOutbox:ctx=>readSourceTechnical('outbox',ctx.captureRef),
        readOriginalEvents:readSourceEvents,
        authorizeOriginalRead:async ctx=>actual.grants.includes(ctx.operation),
        authorizeNetworkPublish:async ctx=>
          ctx.operation==='t4.network.publish'&&
          ctx.originalWriteOwnerRef==='original:t2:exchange',
        transport:deltaTransport,getMode:()=> 'T4_NETWORK',
      });
      const sourceDeleteCapture=async({kind,subjectId,objectId,sourceCursor})=>
        captureT4OriginalDeletionAtMutation({
          kind,subjectId,objectId,sourceCursor,
          workspaceId,originalWriteOwnerRef:'original:t2:exchange',
          sourceIdempotencyKey:'original:source:delete:'+randomUUID(),
          originalKernel:sourceKernel,getMode:()=> 'T4_NETWORK',
          authorizeOriginalRead:async ctx=>actual.grants.includes(ctx.operation),
          authorizeOriginalDelete:async ctx=>actual.grants.includes(ctx.operation),
          persistOriginalPreDeleteWitness,readOriginalPreDeleteWitness,
          readOriginalEvents:readSourceEvents,
        });
      const verifySourceDelete=async(proof,expected)=>{
        if(proof.sourceEventId!==expected.prepared.delta.sourceEventId||
          proof.sourceEventDigest!==expected.prepared.delta.sourceEventDigest||
          proof.preImageDigest!==expected.prepared.delta.preImageDigest||
          proof.captureRef!==expected.prepared.delta.captureRef)return false;
        const events=await readSourceEvents();
        const row=events.find(e=>e.event_id===proof.sourceEventId);
        if(!row)return false;
        const confirmed=await readT4OriginalEventWindow({
          ...originalEventPort,maxEvents:1,readOriginalEvents:async()=>[row],
        });
        return confirmed.window.eventRefs[0].eventDigest===proof.sourceEventDigest;
      };
      const recipientDeleteKernel={
        hasOperation:op=>receiving.operations.includes(op),
        getObject:(w,id)=>recipientPage.evaluate(async({SERVICE,w,id})=>{
          const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t1.getObject(w,id);
        },{SERVICE,w,id}),
        getAsset:async(w,id)=>{
          const result=await recipientPage.evaluate(async({SERVICE,w,id})=>{
            const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
            const asset=await kernel.t1.getAsset(w,id);
            return asset?{asset:asset.asset,bytes:Array.from(asset.bytes)}:null;
          },{SERVICE,w,id});
          return result?{asset:result.asset,bytes:Uint8Array.from(result.bytes)}:null;
        },
        listEventsSince:workspaceId=>recipientPage.evaluate(async({SERVICE,workspaceId})=>{
          const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t1.listEventsSince(workspaceId);
        },{SERVICE,workspaceId}),
        deleteRelation:input=>recipientPage.evaluate(async({SERVICE,input})=>{
          const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t1.deleteRelation(input);
        },{SERVICE,input}),
        deleteAsset:input=>recipientPage.evaluate(async({SERVICE,input})=>{
          const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t1.deleteAsset(input);
        },{SERVICE,input}),
      };

      // Original RelationDelete, including the source snapshot in original T3.
      const deletedRelation=await sourceDeleteCapture({
        kind:'RELATION_DELETE',subjectId:additionalRelationId,
        objectId:linkedObjectId,sourceCursor:relationWindow.nextCursor,
      });
      assert.equal(deletedRelation.originalPreDeleteCapture.preImage.relationId,
        additionalRelationId);
      const relDeleteSent=await deltaRoute('delta.push',
        ()=>actual.grants.includes('t1.deleteRelation'),
        ()=>publishT4OriginalDeleteDelta({
          prepared:deletedRelation.prepared,transport:deltaTransport,
        }));
      const relDeleteReceived=await deltaRoute('delta.pull',
        ()=>receiving.operations.includes('t1.deleteRelation'),
        ()=>fetchT4OriginalDeleteDelta({
          transport:deltaTransport,key:relDeleteSent.key,sha256:relDeleteSent.sha256,
          workspaceId,originalWriteOwnerRef:'original:t2:exchange',
        }));
      let relationDeleteAckLost=true,relationDeleteFirstReceipt=null;
      const recipientDeletion={
        ...recipientDeleteKernel,
        deleteRelation:async input=>{
          const saved=await recipientDeleteKernel.deleteRelation(input);
          if(relationDeleteAckLost){
            relationDeleteAckLost=false;relationDeleteFirstReceipt=saved;
            throw Object.assign(new Error('SIMULATED_RELATION_DELETE_ACK_LOST'),
              {code:'NETWORK_TIMEOUT'});
          }
          return saved;
        },
      };
      const relDeleteApply={
        received:relDeleteReceived,originalKernel:recipientDeletion,
        authorizeOriginalWrite:async ctx=>receiving.operations.includes(ctx.operation),
        verifyOriginalSourceEvent:proof=>verifySourceDelete(proof,deletedRelation),
        getMode:()=> 'T4_NETWORK',
      };
      await assert.rejects(applyT4OriginalDeleteDelta(relDeleteApply),
        error=>error.code==='DELETE_ORIGINAL_RECIPIENT_OUTCOME_UNKNOWN');
      const missingRelation=await recipientDeleteKernel.getObject(workspaceId,linkedObjectId);
      assert.equal(missingRelation.relations.outgoing.some(r=>
        r.relation_id===additionalRelationId),false);
      await assert.rejects(applyT4OriginalDeleteDelta(relDeleteApply),
        error=>error.code==='DELETE_ORIGINAL_RECIPIENT_ABSENT_REQUIRES_EVENT_RECONCILIATION');
      const relDeleteRecovered=await reconcileT4OriginalDeleteFromT3Event({
        received:relDeleteReceived,originalKernel:recipientDeleteKernel,
        authorizeOriginalRead:async ctx=>receiving.operations.includes(ctx.operation),
        authorizeOriginalWrite:async ctx=>receiving.operations.includes(ctx.operation),
        verifyOriginalSourceEvent:proof=>verifySourceDelete(proof,deletedRelation),
        getMode:()=> 'T4_NETWORK',
      });
      assert.equal(relDeleteRecovered.originalT3EventProofPassed,true);
      assert.equal(relDeleteRecovered.originalOperationReceiptRecreated,false);
      assert.equal(relDeleteRecovered.originalKernelDeleteRetried,false);
      assert.equal(relDeleteRecovered.originalReceiptRef,
        relationDeleteFirstReceipt.event.event_id);
      await advanceT4OriginalDeleteCursor({
        window:deletedRelation.window,nextCursor:deletedRelation.nextCursor,
        acknowledgement:relDeleteRecovered.acknowledgement,
        verifyOriginalRecipient:async ctx=>
          ctx.originalReceiptRef===relDeleteRecovered.originalReceiptRef&&
          (await recipientDeleteKernel.getObject(workspaceId,linkedObjectId))
            .relations.outgoing.every(r=>r.relation_id!==additionalRelationId),
      });
      const afterRelationDelete=await verify(recipientPage);
      assert.equal(afterRelationDelete.relations,initial.relations);
      console.log('T4_REAL_ORIGINAL_T3_RELATION_DELETE_DELTA_ACK_RECOVERY_PASS',
        JSON.stringify({
          originalKernel:ORIGINAL_KERNEL,
          originalT3CapturedPreDeleteRelation:true,
          recipientOriginalRelationRemoved:true,
          originalKernelEventReconciledWithoutReDelete:true,
          originalCursorAfterDeleteVerified:true,
          relationInventoryAfterDelete:afterRelationDelete.relations,
        }));

      // Original AssetDelete, preserving source byte digest and revision before
      // deletion, then requiring original T3 deleteAsset and exact readback.
      const deletedAsset=await sourceDeleteCapture({
        kind:'ASSET_DELETE',subjectId:assetId,
        sourceCursor:deletedRelation.nextCursor,
      });
      assert.equal(deletedAsset.originalPreDeleteCapture.preImage.revision,2);
      const assetDeleteSent=await deltaRoute('delta.push',
        ()=>actual.grants.includes('t1.deleteAsset'),
        ()=>publishT4OriginalDeleteDelta({
          prepared:deletedAsset.prepared,transport:deltaTransport,
        }));
      const assetDeleteReceived=await deltaRoute('delta.pull',
        ()=>receiving.operations.includes('t1.deleteAsset'),
        ()=>fetchT4OriginalDeleteDelta({
          transport:deltaTransport,key:assetDeleteSent.key,sha256:assetDeleteSent.sha256,
          workspaceId,originalWriteOwnerRef:'original:t2:exchange',
        }));
      let assetDeleteAckLost=true,assetDeleteFirstReceipt=null;
      const recipientAssetDeletion={
        ...recipientDeleteKernel,
        deleteAsset:async input=>{
          const saved=await recipientDeleteKernel.deleteAsset(input);
          if(assetDeleteAckLost){
            assetDeleteAckLost=false;assetDeleteFirstReceipt=saved;
            throw Object.assign(new Error('SIMULATED_ASSET_DELETE_ACK_LOST'),
              {code:'NETWORK_TIMEOUT'});
          }
          return saved;
        },
      };
      const assetDeleteApply={
        received:assetDeleteReceived,originalKernel:recipientAssetDeletion,
        authorizeOriginalWrite:async ctx=>receiving.operations.includes(ctx.operation),
        verifyOriginalSourceEvent:proof=>verifySourceDelete(proof,deletedAsset),
        getMode:()=> 'T4_NETWORK',
      };
      await assert.rejects(applyT4OriginalDeleteDelta(assetDeleteApply),
        error=>error.code==='DELETE_ORIGINAL_RECIPIENT_OUTCOME_UNKNOWN');
      assert.equal(await recipientDeleteKernel.getAsset(workspaceId,assetId),null);
      await assert.rejects(applyT4OriginalDeleteDelta(assetDeleteApply),
        error=>error.code==='DELETE_ORIGINAL_RECIPIENT_ABSENT_REQUIRES_EVENT_RECONCILIATION');
      const assetDeleteRecovered=await reconcileT4OriginalDeleteFromT3Event({
        received:assetDeleteReceived,originalKernel:recipientDeleteKernel,
        authorizeOriginalRead:async ctx=>receiving.operations.includes(ctx.operation),
        authorizeOriginalWrite:async ctx=>receiving.operations.includes(ctx.operation),
        verifyOriginalSourceEvent:proof=>verifySourceDelete(proof,deletedAsset),
        getMode:()=> 'T4_NETWORK',
      });
      assert.equal(assetDeleteRecovered.originalT3EventProofPassed,true);
      assert.equal(assetDeleteRecovered.originalOperationReceiptRecreated,false);
      assert.equal(assetDeleteRecovered.originalKernelDeleteRetried,false);
      assert.equal(assetDeleteRecovered.originalReceiptRef,
        assetDeleteFirstReceipt.event.event_id);
      await advanceT4OriginalDeleteCursor({
        window:deletedAsset.window,nextCursor:deletedAsset.nextCursor,
        acknowledgement:assetDeleteRecovered.acknowledgement,
        verifyOriginalRecipient:async ctx=>
          ctx.originalReceiptRef===assetDeleteRecovered.originalReceiptRef&&
          (await recipientDeleteKernel.getAsset(workspaceId,assetId))===null,
      });
      const afterAssetDelete=await verify(recipientPage);
      assert.equal(afterAssetDelete.assets,0);
      assert.equal(afterAssetDelete.assetText,null);
      console.log('T4_REAL_ORIGINAL_T3_ASSET_DELETE_DELTA_ACK_RECOVERY_PASS',
        JSON.stringify({originalKernel:ORIGINAL_KERNEL,
          originalT3PreDeleteAssetRevision:2,
          originalT3PreDeleteByteDigestCaptured:true,
          recipientOriginalAssetDeleted:true,
          originalKernelEventReconciledWithoutReDelete:true,
          originalCursorAfterDeleteVerified:true,
          recipientAssetInventory:afterAssetDelete.assets,
        }));

      // Two original T3 writes happen before any T4 network delivery.
      // Each exact intermediate revision must be durably captured in the
      // existing original source T3 technical Workspace before returning.
      const mutationKernel={
        ...sourceKernel,
        putObject:input=>activeSourcePage.evaluate(async({SERVICE,input})=>{
          const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t1.putObject(input);
        },{SERVICE,input}),
      };
      const technicalId=(kind,captureRef)=>'t4:'+kind+':'+captureRef;
      const persistSourceTechnical=(kind,payload)=>activeSourcePage.evaluate(
        async({SERVICE,sourceCaptureWorkspace,objectId,payload})=>{
          const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
          const saved=await kernel.t1.putObject({
            workspace_id:sourceCaptureWorkspace,object_id:objectId,
            schema_id:'iwxa.demo.note',schema_version:'1.0.0',
            data:payload,extensions:{},base_revision:0,
            event:{event_type:'t4.original.mutation.capture.'+payload.schema,
              payload:{captureRef:payload.captureRef}},
          });
          return saved.object.revision===1;
        },{SERVICE,sourceCaptureWorkspace,
          objectId:technicalId(kind,payload.captureRef),payload});
      const readSourceTechnical=(kind,captureRef)=>activeSourcePage.evaluate(
        async({SERVICE,sourceCaptureWorkspace,objectId})=>{
          const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
          return (await kernel.t1.getObject(sourceCaptureWorkspace,objectId))
            ?.object?.data??null;
        },{SERVICE,sourceCaptureWorkspace,objectId:technicalId(kind,captureRef)});
      let currentSourceCursor=deletedAsset.nextCursor;
      const stagedObjectMutations=[];
      for(const targetRevision of [5,6]){
        const prior=await sourceKernel.getObject(workspaceId,linkedObjectId);
        assert.equal(prior.object.revision,targetRevision-1);
        const targetTitle='Continuous captured original T3 revision '+targetRevision+
          ' '+randomUUID();
        const captured=await captureT4OriginalObjectMutation({
          workspaceId,objectId:linkedObjectId,
          originalWriteOwnerRef:'original:t2:exchange',
          captureRef:'t4:original:mutation:'+randomUUID(),
          sourceCursor:currentSourceCursor,
          mutationInput:{
            workspace_id:workspaceId,object_id:linkedObjectId,
            schema_id:prior.object.schema_id,
            schema_version:prior.object.schema_version,
            data:{...prior.object.data,title:targetTitle},
            extensions:prior.object.extensions??{},
            base_revision:prior.object.revision,
            event:{event_type:'t4.original.mutation.capture.write',
              payload:{revision:targetRevision}},
          },
          originalKernel:mutationKernel,
          authorizeOriginalRead:async ctx=>actual.grants.includes(ctx.operation),
          authorizeOriginalWrite:async ctx=>actual.grants.includes(ctx.operation),
          readOriginalEvents:readSourceEvents,
          getMode:()=> 'T4_NETWORK',
          persistOriginalIntent:payload=>persistSourceTechnical('intent',payload),
          readOriginalIntent:payload=>readSourceTechnical('intent',payload.captureRef),
          persistOriginalOutbox:payload=>persistSourceTechnical('outbox',payload),
          readOriginalOutbox:payload=>readSourceTechnical('outbox',payload.captureRef),
        });
        assert.equal(captured.originalT3OutboxVerified,true);
        assert.equal(captured.sourceRevision,targetRevision);
        assert.equal(captured.prepared.delta.data.title,targetTitle);
        stagedObjectMutations.push({captured,title:targetTitle});
        currentSourceCursor=captured.nextCursor;
      }
      const latestOriginal=await sourceKernel.getObject(workspaceId,linkedObjectId);
      assert.equal(latestOriginal.object.revision,6);
      const historicOutbox=await readSourceTechnical('outbox',
        stagedObjectMutations[0].captured.captureRef);
      assert.equal(historicOutbox.sha256,
        stagedObjectMutations[0].captured.prepared.sha256);
      assert.deepEqual(Buffer.from(historicOutbox.bytesBase64,'base64'),
        stagedObjectMutations[0].captured.prepared.bytes);
      assert.equal(stagedObjectMutations[0].captured.prepared.delta.sourceRevision,5);
      assert.equal(stagedObjectMutations[1].captured.prepared.delta.sourceRevision,6);
      assert.equal((await receiverGraphKernel.getObject(workspaceId,linkedObjectId))
        .object.revision,4);

      // Reopen the ORIGINAL source Kernel before publishing any captured data.
      // Both historical revisions must survive the writer's process shutdown.
      await sourceContext.close();sourceContext=null;
      sourceContext=await launch(sourceProfile);
      activeSourcePage=await opened(sourceContext);
      const restoredSource=await sourceKernel.getObject(workspaceId,linkedObjectId);
      assert.equal(restoredSource.object.revision,6);
      for(const {captured} of stagedObjectMutations){
        const stored=await readSourceTechnical('outbox',captured.captureRef);
        assert.equal(stored.sha256,captured.prepared.sha256);
        assert.deepEqual(Buffer.from(stored.bytesBase64,'base64'),
          captured.prepared.bytes);
      }

      for(const [index,{captured,title}] of stagedObjectMutations.entries()){
        const staged=await readSourceTechnical('outbox',captured.captureRef);
        const exactBytes=Buffer.from(staged.bytesBase64,'base64');
        assert.equal(staged.sha256,packageSha256(exactBytes));
        const sent=await deltaRoute('delta.push',
          ()=>actual.grants.includes('t1.getObject'),
          ()=>publishT4OriginalHostOutbox(originalOutboxNetworkArgs(
            'OBJECT_PUT',captured.captureRef,linkedObjectId)));
        const received=await deltaRoute('delta.pull',
          ()=>receiving.operations.includes('t1.getObject'),
          ()=>fetchT4OriginalObjectDelta({
            transport:deltaTransport,key:sent.key,sha256:sent.sha256,
            workspaceId,originalWriteOwnerRef:'original:t2:exchange',
          }));
        const applied=await applyT4OriginalObjectDelta({
          received,originalKernel:receiverGraphKernel,
          authorizeOriginalWrite:async ctx=>receiving.operations.includes(ctx.operation),
          verifyOriginalSourceEvent:async proof=>{
            if(proof.sourceEventId!==captured.window.lastEventId||
              proof.sourceEventDigest!==captured.window.eventRefs[0].eventDigest||
              proof.objectContentDigest!==captured.prepared.delta.objectContentDigest)
              return false;
            const readBack=await readSourceTechnical('outbox',captured.captureRef);
            const events=await readSourceEvents();
            return readBack.sha256===captured.prepared.sha256&&
              events.some(e=>e.event_id===proof.sourceEventId);
          },
          getMode:()=> 'T4_NETWORK',
        });
        assert.equal(applied.originalT3CommitApplied,true);
        const cursor=await advanceT4OriginalObjectDeltaCursor({
          window:captured.window,nextCursor:captured.nextCursor,
          acknowledgement:applied.acknowledgement,
          verifyOriginalRecipient:async ctx=>{
            const item=await receiverGraphKernel.getObject(workspaceId,linkedObjectId);
            return ctx.originalReceiptRef===applied.originalReceiptRef&&
              item.object.revision===index+5&&item.object.data.title===title;
          },
        });
        assert.equal(cursor.verified,true);
      }
      const afterBothCaptured=await receiverGraphKernel.getObject(workspaceId,linkedObjectId);
      assert.equal(afterBothCaptured.object.revision,6);
      assert.equal(afterBothCaptured.object.data.title,stagedObjectMutations[1].title);
      console.log('T4_REAL_ORIGINAL_T3_TWO_MUTATION_TIME_OUTBOX_REVISIONS_PASS',
        JSON.stringify({originalKernel:ORIGINAL_KERNEL,
          stagedBeforeAnyNetworkPublish:[5,6],
          originalSourceTechnicalWorkspace:true,
          bothHistoricalStatesDurablyPreserved:true,
          sourceKernelColdRestartBeforeAnyNetworkPublish:true,
          originalOutboxReadbackVerified:true,
          originalRecipientFinalRevision:6,
          bothOriginalRecipientReceiptsConfirmed:true,
          noNewStoreOrKernel:true,
        }));

      // Original T3 writes revision 7, but its answer is lost before the
      // technical outbox is committed. The original event and intent survive.
      const uncertainCaptureRef='t4:original:lost-source-ack:'+randomUUID();
      const sourceBeforeUnknown=await sourceKernel.getObject(workspaceId,linkedObjectId);
      assert.equal(sourceBeforeUnknown.object.revision,6);
      const unknownInput={
        workspace_id:workspaceId,object_id:linkedObjectId,
        schema_id:sourceBeforeUnknown.object.schema_id,
        schema_version:sourceBeforeUnknown.object.schema_version,
        data:{...sourceBeforeUnknown.object.data,
          title:'Original T3 intent recovered after source ACK loss '+randomUUID()},
        extensions:sourceBeforeUnknown.object.extensions??{},
        base_revision:6,event:{
          event_type:'t4.original.source-ack-lost',
          payload:{businessPurpose:'original-version-recovery',revision:7},
        },
      };
      let dropOriginalSourceAck=true;
      const sourceWithAckLoss={
        ...mutationKernel,
        putObject:async input=>{
          const saved=await mutationKernel.putObject(input);
          if(dropOriginalSourceAck){
            dropOriginalSourceAck=false;
            throw Object.assign(new Error('SIMULATED_ORIGINAL_T3_SOURCE_ACK_LOST'),{
              code:'NETWORK_TIMEOUT',
            });
          }
          return saved;
        },
      };
      const originalHostWithAckLoss=createT4OriginalHostCaptureAdapter({
        originalKernel:sourceWithAckLoss,
        originalWriteOwnerRef:'original:t2:exchange',
        getMode:()=> 'T4_NETWORK',
        authorizeOriginalRead:async ctx=>actual.grants.includes(ctx.operation),
        authorizeOriginalWrite:async ctx=>actual.grants.includes(ctx.operation),
        readOriginalEvents:readSourceEvents,
        persistOriginalIntent:payload=>persistSourceTechnical('intent',payload),
        readOriginalIntent:payload=>readSourceTechnical('intent',payload.captureRef),
        persistOriginalOutbox:payload=>persistSourceTechnical('outbox',payload),
        readOriginalOutbox:payload=>readSourceTechnical('outbox',payload.captureRef),
      });
      await assert.rejects(originalHostWithAckLoss.putObject({
        sourceCursor:currentSourceCursor,captureRef:uncertainCaptureRef,
        mutationInput:unknownInput,
      }),error=>error.code==='OBJECT_CAPTURE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'&&
        error.details.automaticRetryAllowed===false);
      assert.equal((await sourceKernel.getObject(workspaceId,linkedObjectId))
        .object.revision,7);
      assert.equal(await readSourceTechnical('outbox',uncertainCaptureRef),null);

      // A cold source process restart occurs while the original T3 write has
      // committed but the T4 outbox has not been recorded.
      await sourceContext.close();sourceContext=null;
      sourceContext=await launch(sourceProfile);
      activeSourcePage=await opened(sourceContext);
      assert.equal((await sourceKernel.getObject(workspaceId,linkedObjectId))
        .object.revision,7);
      const recoveredSource=await originalHostWithAckLoss.reconcileObjectMutation({
        captureRef:uncertainCaptureRef,workspaceId,objectId:linkedObjectId,
      });
      assert.equal(recoveredSource.originalSourceEventVerified,true);
      assert.equal(recoveredSource.originalMutationRetried,false);
      assert.equal(recoveredSource.originalOperationReceiptRecreated,false);
      assert.equal(recoveredSource.originalT3OutboxVerified,true);
      assert.equal(recoveredSource.prepared.delta.sourceRevision,7);
      const recoveredOutbox=await readSourceTechnical('outbox',uncertainCaptureRef);
      assert.equal(recoveredOutbox.sha256,recoveredSource.prepared.sha256);
      assert.deepEqual(Buffer.from(recoveredOutbox.bytesBase64,'base64'),
        recoveredSource.prepared.bytes);

      const recoveredPublished=await deltaRoute('delta.push',
        ()=>actual.grants.includes('t1.getObject'),
        ()=>publishT4OriginalHostOutbox(originalOutboxNetworkArgs(
          'OBJECT_PUT',uncertainCaptureRef,linkedObjectId)));
      const recoveredReceived=await deltaRoute('delta.pull',
        ()=>receiving.operations.includes('t1.getObject'),
        ()=>fetchT4OriginalObjectDelta({
          transport:deltaTransport,key:recoveredPublished.key,
          sha256:recoveredPublished.sha256,
          workspaceId,originalWriteOwnerRef:'original:t2:exchange',
        }));
      const originalRecipientApplied=await applyT4OriginalObjectDelta({
        received:recoveredReceived,
        originalKernel:receiverGraphKernel,
        authorizeOriginalWrite:async ctx=>receiving.operations.includes(ctx.operation),
        verifyOriginalSourceEvent:async proof=>{
          const events=await readSourceEvents();
          const row=events.find(e=>e.event_id===proof.sourceEventId);
          const intent=await readSourceTechnical('intent',uncertainCaptureRef);
          return proof.sourceEventId===recoveredSource.window.lastEventId&&
            proof.sourceEventDigest===recoveredSource.window.eventRefs[0].eventDigest&&
            row?.payload?.iwxa_t4_capture_ref===uncertainCaptureRef&&
            row?.payload?.iwxa_t4_original_input_digest===intent.originalInputDigest&&
            proof.objectContentDigest===recoveredSource.prepared.delta.objectContentDigest;
        },
        getMode:()=> 'T4_NETWORK',
      });
      assert.equal(originalRecipientApplied.originalT3CommitApplied,true);
      const verifiedUnknownCursor=await advanceT4OriginalObjectDeltaCursor({
        window:recoveredSource.window,nextCursor:recoveredSource.nextCursor,
        acknowledgement:originalRecipientApplied.acknowledgement,
        verifyOriginalRecipient:async ctx=>{
          const item=await receiverGraphKernel.getObject(workspaceId,linkedObjectId);
          return ctx.originalReceiptRef===originalRecipientApplied.originalReceiptRef&&
            item?.object?.revision===7&&
            item.object.data.title===unknownInput.data.title;
        },
      });
      assert.equal(verifiedUnknownCursor.verified,true);
      assert.equal((await receiverGraphKernel.getObject(workspaceId,linkedObjectId))
        .object.revision,7);
      console.log('T4_REAL_ORIGINAL_T3_SOURCE_LOST_ACK_INTENT_RECOVERY_PASS',
        JSON.stringify({
          originalKernel:ORIGINAL_KERNEL,
          sourceRevisionAfterUnknownWrite:7,
          coldRestartBetweenOriginalCommitAndOutbox:true,
          originalIntentAndSourceEventReconciled:true,
          originalHostCaptureAdapterUsed:true,
          originalPutObjectNotRetried:true,
          originalOperationReceiptNotInvented:true,
          originalT3OutboxCreatedAfterRecovery:true,
          recipientOriginalGraphCommitRevision:7,
          recipientOriginalReceiptVerifiedBeforeCursor:true,
        }));

      // The original T3 Host now captures AssetPut/RelationPut, not only
      // ObjectPut. Two distinct Asset revisions are stored before networking.
      const capturedAssetId='t4:source:captured-asset:'+randomUUID();
      const capturedRelationId='t4:source:captured-relation:'+randomUUID();
      let subjectSourceRelationAckLost=true,subjectSourcePutRelationCalls=0;
      const subjectSourceKernel={
        ...mutationKernel,
        putAsset:async input=>activeSourcePage.evaluate(async({SERVICE,input})=>{
          const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t1.putAsset({...input,bytes:Uint8Array.from(input.bytes)});
        },{SERVICE,input:{...input,bytes:Array.from(input.bytes)}}),
        putRelation:async input=>{
          subjectSourcePutRelationCalls++;
          const receipt=await activeSourcePage.evaluate(async({SERVICE,input})=>{
            const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
            return kernel.t1.putRelation(input);
          },{SERVICE,input});
          if(subjectSourceRelationAckLost){
            subjectSourceRelationAckLost=false;
            throw Object.assign(new Error('ORIGINAL_T3_RELATION_SOURCE_ACK_LOST'),
              {code:'NETWORK_TIMEOUT'});
          }
          return receipt;
        },
      };
      const subjectHost=createT4OriginalHostCaptureAdapter({
        originalKernel:subjectSourceKernel,
        originalWriteOwnerRef:'original:t2:exchange',
        getMode:()=> 'T4_NETWORK',
        authorizeOriginalRead:async ctx=>actual.grants.includes(ctx.operation),
        authorizeOriginalWrite:async ctx=>actual.grants.includes(ctx.operation),
        readOriginalEvents:readSourceEvents,
        persistOriginalIntent:payload=>persistSourceTechnical('intent',payload),
        readOriginalIntent:payload=>readSourceTechnical('intent',payload.captureRef),
        persistOriginalOutbox:payload=>persistSourceTechnical('outbox',payload),
        readOriginalOutbox:payload=>readSourceTechnical('outbox',payload.captureRef),
      });
      const capturedAssetMutations=[];
      let capturedSourceCursor=recoveredSource.nextCursor;
      for(const index of [0,1]){
        const text='Original Host Asset staged before T4 network '+index+' '+randomUUID();
        const captureRef='t4:host:asset:'+randomUUID();
        const mutationInput={
          workspace_id:workspaceId,asset_id:capturedAssetId,
          object_id:linkedObjectId,mime:'text/plain',base_revision:index,
          bytes:Buffer.from(text,'utf8'),
          event:{event_type:'t4.original.host.asset.mutation',
            payload:{sourceIndex:index}},
        };
        const created=await subjectHost.putAsset({
          mutationInput,sourceCursor:capturedSourceCursor,captureRef,
        });
        assert.equal(created.capture.originalT3OutboxVerified,true);
        assert.equal(created.originalReceipt.asset.revision,index+1);
        assert.equal(created.capture.prepared.delta.sourceRevision,index+1);
        assert.equal(created.capture.prepared.delta.assetBytesSha256,
          packageSha256(mutationInput.bytes));
        const persisted=await readSourceTechnical('outbox',captureRef);
        assert.equal(persisted.sha256,created.capture.prepared.sha256);
        capturedAssetMutations.push({captureRef,text,created});
        capturedSourceCursor=created.capture.nextCursor;
      }
      assert.equal((await subjectSourceKernel.getAsset(workspaceId,capturedAssetId))
        .asset.revision,2);
      assert.equal(await recipientDeleteKernel.getAsset(workspaceId,capturedAssetId),null);
      let missingRelationAckCaptureRef='t4:host:relation:'+randomUUID();
      await assert.rejects(subjectHost.putRelation({
        mutationInput:{
          workspace_id:workspaceId,relation_id:capturedRelationId,
          from_object_id:linkedObjectId,to_object_id:objectId,
          kind:'related',event:{
            event_type:'t4.original.host.relation.mutation',
            payload:{businessPurpose:'linked dependency'},
          },
        },
        sourceCursor:capturedSourceCursor,captureRef:missingRelationAckCaptureRef,
      }),err=>err.code==='SUBJECT_CAPTURE_SOURCE_WRITE_OUTCOME_UNKNOWN'&&
        err.details.automaticRetryAllowed===false);
      assert.equal(subjectSourcePutRelationCalls,1);
      assert.equal(await readSourceTechnical('outbox',missingRelationAckCaptureRef),null);
      assert.equal((await subjectSourceKernel.getObject(workspaceId,linkedObjectId))
        .relations.outgoing.some(r=>r.relation_id===capturedRelationId),true);

      // The source's network connection is not needed for its original T3
      // writes, and a process restart cannot destroy the original outbox.
      await sourceContext.close();sourceContext=null;
      sourceContext=await launch(sourceProfile);
      activeSourcePage=await opened(sourceContext);
      for(const item of capturedAssetMutations){
        const stored=await readSourceTechnical('outbox',item.captureRef);
        assert.deepEqual(Buffer.from(stored.bytesBase64,'base64'),
          item.created.capture.prepared.bytes);
      }
      const restoredRelation=await subjectHost.reconcileRelationMutation({
        captureRef:missingRelationAckCaptureRef,
        workspaceId,relationId:capturedRelationId,
      });
      assert.equal(restoredRelation.originalMutationRetried,false);
      assert.equal(restoredRelation.originalReceipt,null);
      assert.equal(restoredRelation.originalT3OutboxVerified,true);
      assert.equal(subjectSourcePutRelationCalls,1);
      assert.equal(restoredRelation.prepared.delta.relationId,capturedRelationId);
      const independentAssetRecipient={
        ...recipientDeleteKernel,
        putAsset:async input=>recipientPage.evaluate(async({SERVICE,input})=>{
          const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t1.putAsset({...input,bytes:Uint8Array.from(input.bytes)});
        },{SERVICE,input:{...input,bytes:Array.from(input.bytes)}}),
        putRelation:input=>recipientPage.evaluate(async({SERVICE,input})=>{
          const kernel=await IWXA.connect({service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t1.putRelation(input);
        },{SERVICE,input}),
      };
      // Trusted original Host invokes bounded work on its own task tick.
      // All delivery records live in the original source T3 technical Workspace.
      const dispatchFrontierRef='t4:host:frontier:'+randomUUID();
      assert.equal(await persistSourceTechnical('network-frontier',{
        schema:'IWXA_T4_ORIGINAL_HOST_DISPATCH_FRONTIER_V1',
        captureRef:dispatchFrontierRef,workspaceId,
        originalWriteOwnerRef:'original:t2:exchange',
        originalCursor:recoveredSource.nextCursor,
      }),true);
      const capturedDispatchRefs=[
        ...capturedAssetMutations.map(item=>item.captureRef),
        missingRelationAckCaptureRef,
      ];
      let scheduledNetworkPutCount=0,loseScheduledRemoteAck=false;
      const scheduledTransport={
        ...deltaTransport,
        putSnapshot:async input=>{
          scheduledNetworkPutCount++;
          const result=await deltaTransport.putSnapshot(input);
          if(loseScheduledRemoteAck){
            loseScheduledRemoteAck=false;
            throw Object.assign(new Error('ORIGINAL_HOST_REMOTE_ACK_LOST'),
              {code:'OUTCOME_UNKNOWN'});
          }
          return result;
        },
      };
      const hostDispatchPorts={
        ...originalOutboxNetworkArgs(
          'ASSET_PUT',capturedAssetMutations[0].captureRef,capturedAssetId),
        networkTargetRef:'node:qualified-apache',
        authorizeOriginalWrite:async ctx=>actual.grants.includes(ctx.operation),
        readOriginalDeliveryFrontier:async()=>{
          const stored=await readSourceTechnical('network-frontier',
            dispatchFrontierRef);
          return stored?.originalCursor??null;
        },
        listOriginalOutbox:async()=>Promise.all(
          capturedDispatchRefs.map(ref=>readSourceTechnical('outbox',ref))),
        readOriginalDeliveryAttempt:ctx=>readSourceTechnical(
          'network-attempt',ctx.captureRef),
        persistOriginalDeliveryAttempt:payload=>persistSourceTechnical(
          'network-attempt',payload),
        readOriginalDeliveryCheckpoint:ctx=>readSourceTechnical(
          'network-checkpoint',ctx.captureRef),
        persistOriginalDeliveryCheckpoint:payload=>persistSourceTechnical(
          'network-checkpoint',payload),
        transport:scheduledTransport,
      };
      const dispatchHostSessions=new WeakMap();
      const sourceHostSession=()=>{
        let ref=dispatchHostSessions.get(sourceContext);
        if(!ref){
          ref='original:host:session:'+randomUUID();
          dispatchHostSessions.set(sourceContext,ref);
        }
        return ref;
      };
      const runOriginalHostDispatchTask=maxEntries=>deltaRoute('delta.push',
        ()=>actual.grants.includes('t1.getObject')&&
          actual.grants.includes('t1.getAsset'),
        async()=>{
          const binding=createT4OriginalHostDispatchTaskBinding({
            expectedWorkspaceId:workspaceId,
            expectedOriginalWriteOwnerRef:'original:t2:exchange',
            expectedNetworkTargetRef:'node:qualified-apache',
            getMode:()=> 'T4_NETWORK',
            readOriginalHostContext:async()=>({
              workspaceId,originalWriteOwnerRef:'original:t2:exchange',
              networkTargetRef:'node:qualified-apache',
              hostSessionRef:sourceHostSession(),
            }),
            authorizeOriginalHostTask:async proof=>
              proof.operation==='t4.network.publish'&&
              proof.originalWriteOwnerRef==='original:t2:exchange'&&
              actual.grants.includes('t1.getObject'),
            dispatcher:createT4OriginalHostOutboxDispatcher(hostDispatchPorts),
          });
          const tick=await binding.run({maxEntries});
          assert.equal(tick.originalHostTaskOwnerVerified,true);
          return tick.result;
        });
      const dispatchFirst=await runOriginalHostDispatchTask(1);
      assert.equal(dispatchFirst.newlyVerifiedCount,1);
      assert.equal(dispatchFirst.hasMore,true);
      assert.equal(scheduledNetworkPutCount,1);
      assert.ok(await readSourceTechnical('network-attempt',
        capturedAssetMutations[0].captureRef));
      assert.ok(await readSourceTechnical('network-checkpoint',
        capturedAssetMutations[0].captureRef));
      // Cold restart AFTER first publication and BEFORE later operations.
      await sourceContext.close();sourceContext=null;
      sourceContext=await launch(sourceProfile);
      activeSourcePage=await opened(sourceContext);
      assert.ok(await readSourceTechnical('network-frontier',dispatchFrontierRef));
      loseScheduledRemoteAck=true;
      await assert.rejects(runOriginalHostDispatchTask(1),
        error=>error.code==='HOST_TASK_DISPATCH_STOPPED'&&
          error.details.originalCode==='DISPATCH_REMOTE_OUTCOME_UNKNOWN'&&
          error.details.automaticRetryAllowed===false);
      assert.equal(scheduledNetworkPutCount,2);
      assert.ok(await readSourceTechnical('network-attempt',
        capturedAssetMutations[1].captureRef));
      assert.equal(await readSourceTechnical('network-checkpoint',
        capturedAssetMutations[1].captureRef),null);
      // The second remote PUT completed, but its Host-visible answer is gone.
      // Restart before recovery: only exact WebDAV readback may resolve it.
      await sourceContext.close();sourceContext=null;
      sourceContext=await launch(sourceProfile);
      activeSourcePage=await opened(sourceContext);
      const dispatchSecond=await runOriginalHostDispatchTask(1);
      assert.equal(dispatchSecond.results.at(-1).state,
        'REMOTE_READBACK_RECOVERED');
      assert.equal(scheduledNetworkPutCount,2);
      assert.equal(dispatchSecond.previouslyVerifiedCount,1);
      assert.equal(dispatchSecond.newlyVerifiedCount,1);
      assert.equal(dispatchSecond.hasMore,true);
      const dispatchThird=await runOriginalHostDispatchTask(1);
      assert.equal(dispatchThird.previouslyVerifiedCount,2);
      assert.equal(dispatchThird.newlyVerifiedCount,1);
      assert.equal(dispatchThird.hasMore,false);
      const dispatchIdle=await runOriginalHostDispatchTask(1);
      assert.equal(dispatchIdle.previouslyVerifiedCount,3);
      assert.equal(dispatchIdle.newlyVerifiedCount,0);
      assert.equal(dispatchIdle.hasMore,false);
      assert.equal(scheduledNetworkPutCount,3);
      for(const ref of capturedDispatchRefs){
        const attempted=await readSourceTechnical('network-attempt',ref);
        const checkpoint=await readSourceTechnical('network-checkpoint',ref);
        const exact=await readSourceTechnical('outbox',ref);
        assert.equal(attempted.sha256,exact.sha256);
        assert.equal(checkpoint.sha256,exact.sha256);
      }
      assert.equal((await independentAssetRecipient.getAsset(
        workspaceId,capturedAssetId)),null);

      for(const [index,item] of capturedAssetMutations.entries()){
        const {captureRef,text,created}=item;
        const stored=await readSourceTechnical('outbox',captureRef);
        const recoveredBytes=Buffer.from(stored.bytesBase64,'base64');
        assert.equal(packageSha256(recoveredBytes),stored.sha256);
        const sent=await deltaRoute('delta.push',
          ()=>actual.grants.includes('t1.getAsset'),
          ()=>inspectT4OriginalHostOutboxNetwork(originalOutboxNetworkArgs(
            'ASSET_PUT',captureRef,capturedAssetId)));
        const received=await deltaRoute('delta.pull',
          ()=>receiving.operations.includes('t1.getAsset'),
          ()=>fetchT4OriginalAssetDelta({
            transport:deltaTransport,key:sent.key,sha256:sent.sha256,
            workspaceId,originalWriteOwnerRef:'original:t2:exchange',
          }));
        const committed=await applyT4OriginalAssetDelta({
          received,originalKernel:independentAssetRecipient,
          authorizeOriginalWrite:async ctx=>receiving.operations.includes(ctx.operation),
          verifyOriginalSourceEvent:async proof=>{
            const intent=await readSourceTechnical('intent',captureRef);
            const events=await readSourceEvents();
            const event=events.find(e=>e.event_id===proof.sourceEventId);
            return event?.idempotency_key===intent.idempotencyKey&&
              event.event_type===intent.operation.event.event_type&&
              proof.sourceEventDigest===created.capture.window.eventRefs[0].eventDigest&&
              proof.assetBytesSha256===packageSha256(Buffer.from(text,'utf8'))&&
              proof.sourceRevision===index+1;
          },
          getMode:()=> 'T4_NETWORK',
        });
        const verified=await advanceT4OriginalAssetCursor({
          window:created.capture.window,nextCursor:created.capture.nextCursor,
          acknowledgement:committed.acknowledgement,
          verifyOriginalRecipient:async ctx=>{
            const read=await independentAssetRecipient.getAsset(
              workspaceId,capturedAssetId);
            return ctx.originalReceiptRef===committed.originalReceiptRef&&
              read.asset.revision===index+1&&
              Buffer.from(read.bytes).toString('utf8')===text;
          },
        });
        assert.equal(verified.verified,true);
      }
      const finalAsset=await independentAssetRecipient.getAsset(
        workspaceId,capturedAssetId);
      assert.equal(finalAsset.asset.revision,2);
      assert.equal(Buffer.from(finalAsset.bytes).toString('utf8'),
        capturedAssetMutations[1].text);
      const relationStaged=await readSourceTechnical(
        'outbox',missingRelationAckCaptureRef);
      const savedRelationBytes=Buffer.from(relationStaged.bytesBase64,'base64');
      assert.equal(packageSha256(savedRelationBytes),relationStaged.sha256);
      const hostRelationSent=await deltaRoute('delta.push',
        ()=>actual.grants.includes('t1.getObject'),
        ()=>inspectT4OriginalHostOutboxNetwork(originalOutboxNetworkArgs(
          'RELATION_PUT',missingRelationAckCaptureRef,capturedRelationId)));
      const hostRelationReceived=await deltaRoute('delta.pull',
        ()=>receiving.operations.includes('t1.getObject'),
        ()=>fetchT4OriginalRelationPutDelta({
          transport:deltaTransport,key:hostRelationSent.key,sha256:hostRelationSent.sha256,
          workspaceId,originalWriteOwnerRef:'original:t2:exchange',
        }));
      const relationCommitted=await applyT4OriginalRelationPutDelta({
        received:hostRelationReceived,originalKernel:independentAssetRecipient,
        authorizeOriginalWrite:async ctx=>receiving.operations.includes(ctx.operation),
        verifyOriginalSourceEvent:async proof=>{
          const intent=await readSourceTechnical('intent',missingRelationAckCaptureRef);
          const events=await readSourceEvents();
          const source=events.find(e=>e.event_id===proof.sourceEventId);
          return source?.idempotency_key===intent.idempotencyKey&&
            proof.sourceEventDigest===restoredRelation.window.eventRefs[0].eventDigest&&
            proof.relationContentDigest===restoredRelation.prepared.delta.relationContentDigest;
        },
        getMode:()=> 'T4_NETWORK',
      });
      await advanceT4OriginalRelationCursor({
        window:restoredRelation.window,nextCursor:restoredRelation.nextCursor,
        acknowledgement:relationCommitted.acknowledgement,
        verifyOriginalRecipient:async ctx=>{
          const result=await independentAssetRecipient.getObject(
            workspaceId,linkedObjectId);
          return ctx.originalReceiptRef===relationCommitted.originalReceiptRef&&
            result.relations.outgoing.some(r=>r.relation_id===capturedRelationId);
        },
      });
      assert.equal((await independentAssetRecipient.getObject(
        workspaceId,linkedObjectId)).relations.outgoing.some(r=>
          r.relation_id===capturedRelationId),true);
      console.log('T4_REAL_ORIGINAL_T3_HOST_ASSET_RELATION_CAPTURE_RECOVERY_PASS',
        JSON.stringify({
          originalKernel:ORIGINAL_KERNEL,
          originalAssetRevisionsStagedBeforeNetwork:[1,2],
          originalSourceColdRestart:true,
          originalRelationSourceACKLostAndReconciled:true,
          originalSourceRelationNotRetried:true,
          originalT3TechnicalOutboxRestored:true,
          originalHostOutboxPublisherUsedForObjectAssetRelation:true,
          originalHostOrderedDispatcherUsedForAssetAndRelation:true,
          originalHostTrustedTaskBindingUsed:true,
          originalHostDispatchNetworkPutCount:scheduledNetworkPutCount,
          originalHostDispatchColdRestartBetweenBatches:true,
          originalHostDispatchCheckpointsDurableInRealT3:true,
          originalHostDispatchIdleTickNoDuplicatePut:true,
          originalHostDispatchRemoteACKRecoveredAfterColdRestart:true,
          originalT3RecipientAssetRevision:2,
          originalT3RecipientRelationCreated:true,
          originalRecipientCursorsVerified:true,
          originalT3StoreSovereign:true,
        }));
      // Receiver-side, original T3-owned causal application. Three different
      // writes are captured at the original source and delivered through the
      // existing Host Outbox before any recipient writes. The recipient has
      // its own original T3 technical Workspace (not a second T4 Store).
      const receiverSourceBefore=await sourceKernel.getObject(
        workspaceId,linkedObjectId);
      assert.equal(receiverSourceBefore.object.revision,7);
      const receiveStartCursor=restoredRelation.nextCursor;
      const receiveSourceObjectRef='t4:receiver:object:'+randomUUID();
      const receiveObjectTitle='Original T3 ordered receiver '+randomUUID();
      const receiveObject=await subjectHost.putObject({
        captureRef:receiveSourceObjectRef,sourceCursor:receiveStartCursor,
        mutationInput:{
          workspace_id:workspaceId,object_id:linkedObjectId,
          schema_id:receiverSourceBefore.object.schema_id,
          schema_version:receiverSourceBefore.object.schema_version,
          data:{...receiverSourceBefore.object.data,title:receiveObjectTitle},
          extensions:receiverSourceBefore.object.extensions??{},
          base_revision:7,
          event:{event_type:'t4.original.recipient.batch.object',
            payload:{phase:'object-before-asset'}},
        },
      });
      assert.equal(receiveObject.capture.sourceRevision,8);
      const receiveAssetRef='t4:receiver:asset:'+randomUUID();
      const receiveAssetText='Original T3 recipient Asset revision 3 '+randomUUID();
      const receiveAsset=await subjectHost.putAsset({
        captureRef:receiveAssetRef,
        sourceCursor:receiveObject.capture.nextCursor,
        mutationInput:{
          workspace_id:workspaceId,asset_id:capturedAssetId,
          object_id:linkedObjectId,mime:'text/plain',base_revision:2,
          bytes:Buffer.from(receiveAssetText,'utf8'),
          event:{event_type:'t4.original.recipient.batch.asset',
            payload:{phase:'asset-after-object'}},
        },
      });
      assert.equal(receiveAsset.originalReceipt.asset.revision,3);
      const receiveRelationRef='t4:receiver:relation:'+randomUUID();
      const receiveRelationId='t4:receiver:linked:'+randomUUID();
      const receiveRelation=await subjectHost.putRelation({
        captureRef:receiveRelationRef,
        sourceCursor:receiveAsset.capture.nextCursor,
        mutationInput:{
          workspace_id:workspaceId,relation_id:receiveRelationId,
          from_object_id:linkedObjectId,to_object_id:objectId,kind:'related',
          event:{event_type:'t4.original.recipient.batch.relation',
            payload:{phase:'relation-after-asset'}},
        },
      });
      assert.equal(receiveRelation.originalReceipt.relation.relation_id,
        receiveRelationId);
      const receiveSourceEntries=[
        {kind:'OBJECT_PUT',captureRef:receiveSourceObjectRef,
          subjectId:linkedObjectId,before:receiveStartCursor,
          receipt:receiveObject.capture},
        {kind:'ASSET_PUT',captureRef:receiveAssetRef,
          subjectId:capturedAssetId,before:receiveObject.capture.nextCursor,
          receipt:receiveAsset.capture},
        {kind:'RELATION_PUT',captureRef:receiveRelationRef,
          subjectId:receiveRelationId,before:receiveAsset.capture.nextCursor,
          receipt:receiveRelation.capture},
      ];
      const receiveSourceOutbox={
        ...hostDispatchPorts,
        readOriginalDeliveryFrontier:async()=>receiveStartCursor,
        listOriginalOutbox:async()=>Promise.all(
          receiveSourceEntries.map(item=>readSourceTechnical(
            'outbox',item.captureRef))),
      };
      const earlierPutCount=scheduledNetworkPutCount;
      const receiveSent=await createT4OriginalHostOutboxDispatcher(
        receiveSourceOutbox).drain({maxEntries:3});
      assert.equal(receiveSent.newlyVerifiedCount,3);
      assert.equal(receiveSent.hasMore,false);
      assert.equal(scheduledNetworkPutCount-earlierPutCount,3);
      // The Source original T3 technical Workspace is the ONLY producer
      // of the subsequent recipient plan; all capture receipts can be lost.
      await sourceContext.close();sourceContext=null;
      sourceContext=await launch(sourceProfile);
      activeSourcePage=await opened(sourceContext);
      for(const item of receiveSourceEntries){
        const stored=await readSourceTechnical('outbox',item.captureRef);
        assert.equal(stored.sourceWindow.windowDigest,
          item.receipt.window.windowDigest);
      }

      const recipientTechnicalWorkspace='t4:recipient:technical:'+randomUUID();
      const recipientCursorRef='t4:recipient:cursor:'+randomUUID();
      await recipientPage.evaluate(async({SERVICE,recipientTechnicalWorkspace})=>{
        const kernel=await IWXA.connect({
          service_id:SERVICE,required_levels:['T1','T2']});
        return kernel.t1.createWorkspace({
          workspace_id:recipientTechnicalWorkspace,profile:'generic'});
      },{SERVICE,recipientTechnicalWorkspace});
      const recipientTechnicalId=(kind,ref)=>'t4:recipient:'+kind+':'+ref;
      const recipientTechnicalRead=(kind,ref)=>recipientPage.evaluate(
        async({SERVICE,recipientTechnicalWorkspace,objectId})=>{
          const kernel=await IWXA.connect({
            service_id:SERVICE,required_levels:['T1','T2']});
          const row=await kernel.t1.getObject(
            recipientTechnicalWorkspace,objectId);
          return row?.object?.data??null;
        },{SERVICE,recipientTechnicalWorkspace,
          objectId:recipientTechnicalId(kind,ref)});
      const recipientTechnicalPersist=(kind,value)=>recipientPage.evaluate(
        async({SERVICE,recipientTechnicalWorkspace,objectId,value,kind})=>{
          const kernel=await IWXA.connect({
            service_id:SERVICE,required_levels:['T1','T2']});
          const saved=await kernel.t1.putObject({
            workspace_id:recipientTechnicalWorkspace,
            object_id:objectId,schema_id:'iwxa.demo.note',
            schema_version:'1.0.0',data:value,extensions:{},base_revision:0,
            event:{event_type:'t4.original.recipient.technical.'+kind,
              payload:{captureRef:value.captureRef}},
          });
          return saved.object.revision===1;
        },{SERVICE,recipientTechnicalWorkspace,
          objectId:recipientTechnicalId(kind,value.captureRef),value,kind});
      await recipientPage.evaluate(async({
        SERVICE,recipientTechnicalWorkspace,recipientCursorRef,receiveStartCursor,
      })=>{
        const kernel=await IWXA.connect({
          service_id:SERVICE,required_levels:['T1','T2']});
        return kernel.t1.putObject({
          workspace_id:recipientTechnicalWorkspace,
          object_id:recipientCursorRef,schema_id:'iwxa.demo.note',
          schema_version:'1.0.0',
          data:{cursor:receiveStartCursor},extensions:{},base_revision:0,
          event:{event_type:'t4.original.recipient.cursor.created',
            payload:{sourceEventId:receiveStartCursor.lastEventId}},
        });
      },{SERVICE,recipientTechnicalWorkspace,recipientCursorRef,
        receiveStartCursor});
      const readRecipientCursor=()=>recipientPage.evaluate(async({
        SERVICE,recipientTechnicalWorkspace,recipientCursorRef,
      })=>{
        const kernel=await IWXA.connect({
          service_id:SERVICE,required_levels:['T1','T2']});
        const saved=await kernel.t1.getObject(
          recipientTechnicalWorkspace,recipientCursorRef);
        return saved?.object?.data?.cursor??null;
      },{SERVICE,recipientTechnicalWorkspace,recipientCursorRef});
      const persistRecipientCursor=value=>recipientPage.evaluate(async({
        SERVICE,recipientTechnicalWorkspace,recipientCursorRef,value,
      })=>{
        const kernel=await IWXA.connect({
          service_id:SERVICE,required_levels:['T1','T2']});
        const current=await kernel.t1.getObject(
          recipientTechnicalWorkspace,recipientCursorRef);
        if(JSON.stringify(current?.object?.data?.cursor)!==
           JSON.stringify(value.previousCursor))return false;
        const saved=await kernel.t1.putObject({
          workspace_id:recipientTechnicalWorkspace,
          object_id:recipientCursorRef,schema_id:'iwxa.demo.note',
          schema_version:'1.0.0',
          data:{cursor:value.verifiedCursor},
          extensions:{},base_revision:current.object.revision,
          event:{event_type:'t4.original.recipient.cursor.verified',
            payload:{sourceEventId:value.sourceEventId}},
        });
        return saved.object.revision===current.object.revision+1;
      },{SERVICE,recipientTechnicalWorkspace,recipientCursorRef,value});
      let lostRecipientAssetAck=true,recipientObjectPutCalls=0,
        recipientAssetPutCalls=0,recipientRelationPutCalls=0;
      const originalReceiverKernel={
        ...independentAssetRecipient,
        commitObjectGraph:async input=>{
          recipientObjectPutCalls++;
          return recipientPage.evaluate(async({SERVICE,input})=>{
            const kernel=await IWXA.connect({
              service_id:SERVICE,required_levels:['T1','T2']});
            return kernel.t1.commitObjectGraph(input);
          },{SERVICE,input});
        },
        putAsset:async input=>{
          recipientAssetPutCalls++;
          const receipt=await independentAssetRecipient.putAsset(input);
          if(lostRecipientAssetAck){
            lostRecipientAssetAck=false;
            throw Object.assign(new Error('ORIGINAL_RECIPIENT_ACK_LOST'),
              {code:'NETWORK_TIMEOUT'});
          }
          return receipt;
        },
        putRelation:async input=>{
          recipientRelationPutCalls++;
          return independentAssetRecipient.putRelation(input);
        },
      };
      const lookupReceiveEntry=sourceEventId=>receiveSourceEntries.find(
        entry=>entry.receipt.window.lastEventId===sourceEventId)??null;
      const recipientPorts={
        workspaceId,originalWriteOwnerRef:'original:t2:exchange',
        sourceNodeRef:'node:original-source',
        originalKernel:originalReceiverKernel,transport:deltaTransport,
        getMode:()=> 'T4_NETWORK',
        authorizeOriginalRead:async ctx=>receiving.operations.includes(
          ctx.operation),
        authorizeOriginalWrite:async ctx=>receiving.operations.includes(
          ctx.operation),
        authorizeNetworkReceive:async ctx=>
          ctx.operation==='t4.network.receive',
        verifyOriginalSourceEntry:async proof=>{
          const entry=receiveSourceEntries.find(
            row=>row.captureRef===proof.captureRef);
          if(!entry||entry.receipt.prepared.sha256!==proof.sha256||
            entry.receipt.window.lastEventId!==proof.sourceEventId)return false;
          const source=await readSourceTechnical('outbox',proof.captureRef);
          if(source?.key!==proof.key||source?.sha256!==proof.sha256)
            return false;
          const current=await readT4OriginalEventWindow({
            workspaceId,originalWriteOwnerRef:'original:t2:exchange',
            cursor:entry.before,maxEvents:1,
            authorizeOriginalRead:async ctx=>
              actual.grants.includes(ctx.operation),
            readOriginalEvents:readSourceEvents,
          });
          return current.window.eventRefs[0]?.eventDigest===
              proof.sourceEventDigest&&
            current.window.lastEventId===proof.sourceEventId&&
            current.nextCursor.sourcePrefixDigest===
              proof.sourceCursorAfter.sourcePrefixDigest;
        },
        verifyOriginalSourceEvent:async proof=>{
          const entry=lookupReceiveEntry(proof.sourceEventId);
          if(!entry||proof.sourceEventDigest!==
            entry.receipt.window.eventRefs[0].eventDigest||
            proof.originalWriteOwnerRef!=='original:t2:exchange')
            return false;
          const d=entry.receipt.prepared.delta;
          return (!proof.objectContentDigest||
              proof.objectContentDigest===d.objectContentDigest)&&
            (!proof.assetBytesSha256||
              proof.assetBytesSha256===d.assetBytesSha256)&&
            (!proof.relationContentDigest||
              proof.relationContentDigest===d.relationContentDigest);
        },
        verifyOriginalRecipient:async proof=>{
          const entry=lookupReceiveEntry(proof.lastEventId);
          if(!entry||proof.windowDigest!==
            entry.receipt.window.windowDigest||
            !receiving.operations.includes('t1.getObject'))return false;
          const ev=await originalReceiverKernel.listEventsSince(workspaceId);
          const prefix=entry.kind==='OBJECT_PUT'?'t4-object-':
            entry.kind==='ASSET_PUT'?'t4-asset-':'t4-relation-';
          return ev.some(row=>
            row.idempotency_key===prefix+entry.receipt.prepared.sha256&&
            row.payload?.originalEventId===proof.lastEventId);
        },
        readOriginalVerifiedCursor:readRecipientCursor,
        persistOriginalVerifiedCursor:persistRecipientCursor,
        readOriginalApplyAttempt:async ctx=>recipientTechnicalRead(
          'apply-attempt',ctx.captureRef),
        persistOriginalApplyAttempt:async value=>
          recipientTechnicalPersist('apply-attempt',value),
        readOriginalApplyCheckpoint:async ctx=>recipientTechnicalRead(
          'applied-checkpoint',ctx.captureRef),
        persistOriginalApplyCheckpoint:async value=>
          recipientTechnicalPersist('applied-checkpoint',value),
      };
      const receiveSourceTask=createT4OriginalHostDispatchTaskBinding({
        expectedWorkspaceId:workspaceId,
        expectedOriginalWriteOwnerRef:'original:t2:exchange',
        expectedNetworkTargetRef:'node:qualified-apache',
        getMode:()=> 'T4_NETWORK',
        readOriginalHostContext:async()=>({
          workspaceId,originalWriteOwnerRef:'original:t2:exchange',
          networkTargetRef:'node:qualified-apache',
          hostSessionRef:sourceHostSession(),
        }),
        authorizeOriginalHostTask:async proof=>
          proof.operation==='t4.network.publish'&&
          proof.originalWriteOwnerRef==='original:t2:exchange'&&
          actual.grants.includes('t1.getObject'),
        dispatcher:createT4OriginalHostOutboxDispatcher(receiveSourceOutbox),
      });
      const recipientHostSessions=new WeakMap();
      const recipientHostSession=()=>{
        let ref=recipientHostSessions.get(recipientContext);
        if(!ref){
          ref='original:recipient:session:'+randomUUID();
          recipientHostSessions.set(recipientContext,ref);
        }
        return ref;
      };
      const planFromSourceT3=()=>prepareT4OriginalHostRecipientPlan({
        ...receiveSourceOutbox,
        sourceNodeRef:'node:original-source',
        readOriginalEvents:readSourceEvents,
        authorizeOriginalPlanHandoff:async proof=>
          proof.operation==='t4.original-host.plan-handoff'&&
          proof.originalWriteOwnerRef==='original:t2:exchange'&&
          actual.grants.includes('t1.listEventsSince'),
      });
      const originalExchangeCycle=createT4OriginalHostExchangeCycle({
        workspaceId,originalWriteOwnerRef:'original:t2:exchange',
        networkTargetRef:'node:qualified-apache',
        sourceNodeRef:'node:original-source',
        getMode:()=> 'T4_NETWORK',
        readOriginalSourceHostContext:async()=>({
          workspaceId,originalWriteOwnerRef:'original:t2:exchange',
          networkTargetRef:'node:qualified-apache',
          sourceNodeRef:'node:original-source',
          hostSessionRef:sourceHostSession(),
        }),
        readOriginalRecipientHostContext:async()=>({
          workspaceId,originalWriteOwnerRef:'original:t2:exchange',
          networkTargetRef:'node:qualified-apache',
          sourceNodeRef:'node:original-source',
          hostSessionRef:recipientHostSession(),
        }),
        authorizeOriginalHostExchange:async proof=>
          proof.operation==='t4.original-host.exchange'&&
          proof.networkTargetRef==='node:qualified-apache'&&
          (proof.role==='SOURCE'?
            actual.grants.includes('t1.listEventsSince'):
            receiving.operations.includes('t1.getObject')),
        sourceTask:receiveSourceTask,
        prepareRecipientPlan:planFromSourceT3,
        recipientDispatcher:createT4OriginalHostRecipientDispatcher(
          recipientPorts),
      });
      const receiveBatch=async maxEntries=>{
        const cycle=await originalExchangeCycle.run({
          maxSourceEntries:3,maxRecipientEntries:maxEntries});
        assert.equal(cycle.publishedPrefixCount,receiveSourceEntries.length);
        assert.equal(cycle.stillWaitingForNetworkCount,0);
        assert.equal(scheduledNetworkPutCount-earlierPutCount,
          receiveSourceEntries.length,
          'Host exchange must never duplicate a completed network PUT');
        return cycle.recipient;
      };
      const receivedFirst=await receiveBatch(1).catch(error=>{
        console.log('T4_ORIGINAL_RECIPIENT_FIRST_BATCH_FAILURE',
          JSON.stringify({code:error?.code,details:error?.details}));
        throw error;
      });
      assert.equal(receivedFirst.processedCount,1);
      assert.equal(recipientObjectPutCalls,1);
      assert.equal((await independentAssetRecipient.getObject(
        workspaceId,linkedObjectId)).object.revision,8);
      assert.ok(await recipientTechnicalRead(
        'applied-checkpoint',receiveSourceObjectRef));
      // Original recipient Host and Kernel are now restarted: its Event
      // and checkpoint, not memory in T4, are the sole recovery evidence.
      await recipientContext.close();recipientContext=null;
      recipientContext=await launch(recipientProfile);
      recipientPage=await opened(recipientContext);
      await assert.rejects(receiveBatch(1),
        error=>error.code==='EXCHANGE_CYCLE_ORIGINAL_HOST_STEP_STOPPED'&&
          error.details.originalCode==='RECIPIENT_BATCH_STOPPED'&&
          error.details.originalNestedCode==='ASSET_DELTA_OUTCOME_UNKNOWN'&&
          error.details.automaticRetryAllowed===false);
      assert.equal(recipientAssetPutCalls,1);
      assert.equal((await independentAssetRecipient.getAsset(
        workspaceId,capturedAssetId)).asset.revision,3);
      assert.equal(await recipientTechnicalRead(
        'applied-checkpoint',receiveAssetRef),null);
      await recipientContext.close();recipientContext=null;
      recipientContext=await launch(recipientProfile);
      recipientPage=await opened(recipientContext);
      const receivedRecovered=await receiveBatch(1);
      assert.equal(receivedRecovered.results.at(-1).state,
        'RECOVERED_FROM_ORIGINAL_T3_EVENT');
      assert.equal(recipientAssetPutCalls,1);
      assert.ok(await recipientTechnicalRead(
        'applied-checkpoint',receiveAssetRef));
      const receivedRelation=await receiveBatch(1);
      assert.equal(receivedRelation.processedCount,1);
      assert.equal(recipientRelationPutCalls,1);
      const receivedIdle=await receiveBatch(1);
      assert.equal(receivedIdle.processedCount,0);
      assert.equal(receivedIdle.skippedVerifiedCount,3);
      assert.equal(recipientObjectPutCalls,1);
      assert.equal(recipientAssetPutCalls,1);
      assert.equal(recipientRelationPutCalls,1);
      const finalRecipientAsset=await independentAssetRecipient.getAsset(
        workspaceId,capturedAssetId);
      assert.equal(finalRecipientAsset.asset.revision,3);
      assert.equal(Buffer.from(finalRecipientAsset.bytes).toString('utf8'),
        receiveAssetText);
      const finalRecipientObject=await independentAssetRecipient.getObject(
        workspaceId,linkedObjectId);
      assert.equal(finalRecipientObject.object.revision,8);
      assert.equal(finalRecipientObject.object.data.title,receiveObjectTitle);
      assert.equal(finalRecipientObject.relations.outgoing.some(
        item=>item.relation_id===receiveRelationId),true);
      assert.equal((await readRecipientCursor()).lastEventId,
        receiveRelation.capture.window.lastEventId);
      console.log('T4_REAL_ORIGINAL_T3_RECIPIENT_ORDERED_BATCH_RECOVERY_PASS',
        JSON.stringify({
          originalKernel:ORIGINAL_KERNEL,originalHostRecipientDispatcher:true,
          objectAssetRelationOriginalKernelApplied:true,
          originalRecipientColdRestartBeforeAsset:true,
          originalRecipientACKLostAfterAssetCommit:true,
          originalRecipientColdRestartBeforeEventRecovery:true,
          originalRecipientAssetPutNotRetried:true,
          originalRecipientObjectRevision:8,
          originalRecipientAssetRevision:3,
          originalRecipientNewRelationPresent:true,
          originalRecipientAttemptAndCheckpointPersistedInT3:true,
          originalRecipientCursorCausalAndDurable:true,
          originalRecipientIdleTickNoDuplicateWrites:true,
          originalHostCombinedExchangeCycleUsed:true,
          originalSourceOutboxDerivedRecipientPlanAfterColdRestart:true,
          originalHostExchangeCreatesScheduler:false,
          originalObjectPutCalls:recipientObjectPutCalls,
          originalAssetPutCalls:recipientAssetPutCalls,
          originalRelationPutCalls:recipientRelationPutCalls,
          independentPhysicalDevices:false,
        }));

      // A NEW source event after a fully drained queue must be picked up
      // by the NEXT original Host exchange task. No hand-written recipient
      // plan, manually advanced cursor or second T4 task engine is allowed.
      const nextSource=await sourceKernel.getObject(
        workspaceId,linkedObjectId);
      assert.equal(nextSource.object.revision,8);
      const followupCaptureRef='t4:receiver:incremental:'+randomUUID();
      const followupTitle='Original T3 next exchange wave '+randomUUID();
      const followup=await subjectHost.putObject({
        captureRef:followupCaptureRef,
        sourceCursor:receiveRelation.capture.nextCursor,
        mutationInput:{
          workspace_id:workspaceId,object_id:linkedObjectId,
          schema_id:nextSource.object.schema_id,
          schema_version:nextSource.object.schema_version,
          data:{...nextSource.object.data,title:followupTitle},
          extensions:nextSource.object.extensions??{},
          base_revision:8,
          event:{event_type:'t4.original.recipient.incremental.object',
            payload:{purpose:'next-host-tick'}},
        },
      });
      assert.equal(followup.capture.sourceRevision,9);
      receiveSourceEntries.push({
        kind:'OBJECT_PUT',captureRef:followupCaptureRef,
        subjectId:linkedObjectId,
        before:receiveRelation.capture.nextCursor,
        receipt:followup.capture,
      });
      assert.equal(await readSourceTechnical('network-checkpoint',
        followupCaptureRef),null);
      await sourceContext.close();sourceContext=null;
      sourceContext=await launch(sourceProfile);
      activeSourcePage=await opened(sourceContext);
      await recipientContext.close();recipientContext=null;
      recipientContext=await launch(recipientProfile);
      recipientPage=await opened(recipientContext);
      const additionalWave=await receiveBatch(1);
      assert.equal(additionalWave.processedCount,1);
      assert.equal(additionalWave.hasMore,false);
      assert.equal(recipientObjectPutCalls,2);
      assert.equal(recipientAssetPutCalls,1);
      assert.equal(recipientRelationPutCalls,1);
      assert.equal((await independentAssetRecipient.getObject(
        workspaceId,linkedObjectId)).object.revision,9);
      assert.equal((await independentAssetRecipient.getObject(
        workspaceId,linkedObjectId)).object.data.title,followupTitle);
      assert.equal((await readRecipientCursor()).lastEventId,
        followup.capture.window.lastEventId);
      assert.ok(await readSourceTechnical('network-checkpoint',
        followupCaptureRef));
      assert.ok(await recipientTechnicalRead('applied-checkpoint',
        followupCaptureRef));
      const followupIdle=await receiveBatch(1);
      assert.equal(followupIdle.processedCount,0);
      assert.equal(followupIdle.skippedVerifiedCount,4);
      assert.equal(recipientObjectPutCalls,2);
      console.log('T4_REAL_ORIGINAL_T3_HOST_EXCHANGE_INCREMENTAL_WAVE_PASS',
        JSON.stringify({
          originalKernel:ORIGINAL_KERNEL,originalHostExchangeCycle:true,
          sourceEventAfterPriorRecipientSync:true,
          sourceAndRecipientColdRestartBeforeNextHostTick:true,
          originalSourceOutboxPlanRebuiltFromStore:true,
          originalSourceRecipientFourthEventConfirmed:true,
          secondObjectRevisionApplied:9,
          originalObjectCommitCalls:recipientObjectPutCalls,
          originalAssetPutCalls:recipientAssetPutCalls,
          originalRelationPutCalls:recipientRelationPutCalls,
          originalHostTaskAdditionalNetworkPuts:1,
          originalHostTaskFinalIdleNoDuplicateWrites:true,
          originalHostUsesExistingT3Store:true,
          separateSchedulerIntroduced:false,
          independentPhysicalDevices:false,
        }));

      // Independent original T3 Exchange, NOT a new manifest transport:
      // the source saves the prepared plan as an ordinary T3 Object into
      // its own dedicated technical Workspace; the original T2 Kernel
      // exports and confirms an .iwxa; a separate recipient T3 Kernel
      // previews, commits and cold-reads that exact imported Object.
      const carrierWorkspaceId='t4:original:plan-carrier:'+randomUUID();
      const carrierObjectId='t4:original:plan:'+randomUUID();
      await activeSourcePage.evaluate(async({
        SERVICE,carrierWorkspaceId,
      })=>{
        const kernel=await IWXA.connect({
          service_id:SERVICE,required_levels:['T1','T2']});
        return kernel.t1.createWorkspace({
          workspace_id:carrierWorkspaceId,profile:'generic'});
      },{SERVICE,carrierWorkspaceId});
      const originalCarrierKernel={
        hasOperation:op=>actual.grants.includes(op),
        getObject:(w,id)=>activeSourcePage.evaluate(async({
          SERVICE,w,id,
        })=>{
          const kernel=await IWXA.connect({
            service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t1.getObject(w,id);
        },{SERVICE,w,id}),
        putObject:input=>activeSourcePage.evaluate(async({
          SERVICE,input,
        })=>{
          const kernel=await IWXA.connect({
            service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t1.putObject(input);
        },{SERVICE,input}),
        listEventsSince:w=>activeSourcePage.evaluate(async({
          SERVICE,w,
        })=>{
          const kernel=await IWXA.connect({
            service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t1.listEventsSince(w);
        },{SERVICE,w}),
      };
      const carrierContext=()=>({
        workspaceId:carrierWorkspaceId,
        originalWriteOwnerRef:'original:t2:exchange',
        sourceNodeRef:'node:original-source',
        networkTargetRef:'node:qualified-apache',
        hostSessionRef:sourceHostSession(),
      });
      const currentPlan=await planFromSourceT3();
      assert.equal(currentPlan.entries.length,4);
      const carrierStored=await persistT4OriginalHostPlanCarrier({
        plan:currentPlan,carrierWorkspaceId,carrierObjectId,
        originalKernel:originalCarrierKernel,
        getMode:()=> 'T4_NETWORK',
        readOriginalHostContext:async()=>carrierContext(),
        authorizeOriginalRead:async proof=>
          actual.grants.includes(proof.operation),
        authorizeOriginalWrite:async proof=>
          actual.grants.includes(proof.operation),
      }).catch(async error=>{
        console.log('T4_CARRIER_SOURCE_EVENT_DIAG',JSON.stringify({
          code:error?.code,
          savedEvents:(await originalCarrierKernel.listEventsSince(
            carrierWorkspaceId)).map(ev=>({eventId:ev.event_id,
              eventType:ev.event_type,idempotencyKey:ev.idempotency_key??null,
              objectId:ev.object_id,payloadKeys:Object.keys(ev.payload??{})})),
        }));
        throw error;
      });
      assert.equal(carrierStored.originalT3ObjectAndEventReadback,true);
      assert.equal(carrierStored.recipientBusinessApplicationAuthorized,false);
      const carrierPackage=await activeSourcePage.evaluate(async({
        SERVICE,carrierWorkspaceId,
      })=>{
        const kernel=await IWXA.connect({
          service_id:SERVICE,required_levels:['T1','T2']});
        const options={workspaces:[carrierWorkspaceId],
          include_history:true,include_assets:true,
          include_relations:true,include_schemas:true};
        const preview=await kernel.t2.exportPreview(options);
        const artifact=await kernel.t2.exportPackage(options);
        const receipt=await kernel.t2.confirmExport({
          package_digest:artifact.package_digest,
          workspace_ids:[carrierWorkspaceId],
        });
        return{preview,artifact:{...artifact,bytes:Array.from(artifact.bytes)},
          receipt};
      },{SERVICE,carrierWorkspaceId});
      assert.equal(carrierPackage.preview.counts.objects,1);
      assert.equal(carrierPackage.preview.counts.assets,0);
      assert.equal(carrierPackage.preview.counts.relations,0);
      carrierPackage.artifact.bytes=Uint8Array.from(
        carrierPackage.artifact.bytes);
      const originalCarrierExportState=originalT3ConfirmedState({
        workspaceId:carrierWorkspaceId,...carrierPackage});
      const stableCarrierSelection={workspace_id:carrierWorkspaceId};
      const signedCarrierSender=createT4OriginalExchangeHandoff({
        transport,
        originalKernel:{hasOperation:op=>actual.grants.includes(op)},
        workspaceId:carrierWorkspaceId,
        currentWorkspace:{
          get:()=>stableCarrierSelection,
          subscribe:()=>()=>{},
        },
        readOriginalExportState:()=>originalCarrierExportState,
      });
      const transferredCarrier=await signedCarrierSender.publishConfirmedExport();
      assert.equal(transferredCarrier.originalExportConfirmed,true);
      assert.equal(transferredCarrier.originalImportCommitted,false);
      const importedCarrierKernel={
        hasOperation:op=>receiving.operations.includes(op),
        importPreview:bytes=>recipientPage.evaluate(async({
          SERVICE,bytes,
        })=>{
          const kernel=await IWXA.connect({
            service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t2.importPreview(Uint8Array.from(bytes));
        },{SERVICE,bytes:Array.from(bytes)}),
        importCancel:token=>recipientPage.evaluate(async({
          SERVICE,token,
        })=>{
          const kernel=await IWXA.connect({
            service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t2.importCancel(token);
        },{SERVICE,token}),
      };
      const importedCarrierPreview=await createT4OriginalExchangeHandoff({
        transport,originalKernel:importedCarrierKernel,
        workspaceId:carrierWorkspaceId,
        currentWorkspace:{get:()=>null,subscribe:()=>()=>{}},
        readOriginalExportState:()=>null,
      }).previewRemoteImport({
        key:transferredCarrier.sha256+'.iwxa',
        expectedSha256:transferredCarrier.sha256,
      });
      assert.equal(importedCarrierPreview.originalImportPreviewed,true);
      const importedToken=importedCarrierPreview.originalPreview;
      const carrierMode=importedToken.allowed_modes.includes('full')
        ?'full':'selective';
      const originalCarrierImport=await recipientPage.evaluate(async({
        SERVICE,importedToken,carrierWorkspaceId,carrierMode,
      })=>{
        const kernel=await IWXA.connect({
          service_id:SERVICE,required_levels:['T1','T2']});
        return kernel.t2.importCommit({
          preview_token:importedToken.preview_token,
          package_digest:importedToken.package_digest,
          plan:{mode:carrierMode,
            include_workspaces:[carrierWorkspaceId],
            include_history:true,include_assets:true,
            include_relations:true,conflict:'fail'},
        });
      },{SERVICE,importedToken:{
        preview_token:importedToken.preview_token,
        package_digest:importedToken.package_digest,
      },carrierWorkspaceId,carrierMode});
      assert.equal(originalCarrierImport.format,'iwxa.import.receipt');
      assert.equal(originalCarrierImport.applied.objects_inserted,1);
      // Persist exactly the ORIGINAL Kernel importCommit receipt, not a
      // receipt reconstructed from WebDAV. This T3 Object remains readable
      // through the recipient's original Host after a true cold restart.
      const recipientImportReceiptRef='t4:original:plan-import:'+randomUUID();
      await recipientPage.evaluate(async({
        SERVICE,carrierWorkspaceId,recipientImportReceiptRef,
        originalCarrierImport,
      })=>{
        const kernel=await IWXA.connect({
          service_id:SERVICE,required_levels:['T1','T2']});
        return kernel.t1.putObject({
          workspace_id:carrierWorkspaceId,
          object_id:recipientImportReceiptRef,
          schema_id:'iwxa.demo.note',schema_version:'1.0.0',
          data:{title:'Original T3 import receipt',
            originalImportReceipt:originalCarrierImport},
          extensions:{},base_revision:0,
          event:{event_type:'t4.original.plan.import-receipt-stored',
            payload:{importId:originalCarrierImport.import_id,
              packageDigest:originalCarrierImport.package_digest}},
        });
      },{SERVICE,carrierWorkspaceId,recipientImportReceiptRef,
        originalCarrierImport});
      await recipientContext.close();recipientContext=null;
      recipientContext=await launch(recipientProfile);
      recipientPage=await opened(recipientContext);
      const originalCarrierRecipientKernel={
        hasOperation:op=>receiving.operations.includes(op),
        getObject:(w,id)=>recipientPage.evaluate(async({
          SERVICE,w,id,
        })=>{
          const kernel=await IWXA.connect({
            service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t1.getObject(w,id);
        },{SERVICE,w,id}),
      };
      const inspectCarrier=()=>inspectT4OriginalHostImportedPlanCarrier({
        carrierWorkspaceId,
        sourceCarrierWorkspaceId:carrierWorkspaceId,
        carrierObjectId,sourceWorkspaceId:workspaceId,
        originalWriteOwnerRef:'original:t2:exchange',
        networkTargetRef:'node:qualified-apache',
        sourceNodeRef:'node:original-source',
        originalKernel:originalCarrierRecipientKernel,
        originalImportReceipt:originalCarrierImport,
        readOriginalImportReceipt:()=>recipientPage.evaluate(async({
          SERVICE,carrierWorkspaceId,recipientImportReceiptRef,
        })=>{
          const kernel=await IWXA.connect({
            service_id:SERVICE,required_levels:['T1','T2']});
          const found=await kernel.t1.getObject(
            carrierWorkspaceId,recipientImportReceiptRef);
          return found?.object?.data?.originalImportReceipt??null;
        },{SERVICE,carrierWorkspaceId,recipientImportReceiptRef}),
        expectedPackageDigest:carrierPackage.artifact.package_digest,
        expectedSourcePlanDigest:currentPlan.planDigest,
        getMode:()=> 'T4_NETWORK',
        readOriginalHostContext:async()=>({
          workspaceId:carrierWorkspaceId,
          originalWriteOwnerRef:'original:t2:exchange',
          sourceNodeRef:'node:original-source',
          networkTargetRef:'node:qualified-apache',
          hostSessionRef:recipientHostSession(),
        }),
        authorizeOriginalRead:async proof=>
          receiving.operations.includes(proof.operation),
      });
      const importedCarrier=await inspectCarrier();
      assert.equal(importedCarrier.plan.entries.length,4);
      assert.equal(importedCarrier.planDigest,undefined);
      assert.equal(importedCarrier.sourcePlanDigest,currentPlan.planDigest);
      assert.equal(importedCarrier.originalT3ObjectReadbackVerified,true);
      assert.equal(importedCarrier.originalT3ImportReceiptDurableReadback,true);
      assert.equal(importedCarrier.mayInvokeRecipientDispatcher,false);
      assert.equal(importedCarrier.signedSourceProvenanceNotProven,true);
      assert.equal(importedCarrier.recipientBusinessApplicationAuthorized,false);
      await recipientContext.close();recipientContext=null;
      recipientContext=await launch(recipientProfile);
      recipientPage=await opened(recipientContext);
      const carrierAfterCold=await inspectCarrier();
      assert.equal(carrierAfterCold.sourcePlanDigest,currentPlan.planDigest);
      console.log('T4_REAL_ORIGINAL_T3_IWXA_PLAN_CARRIER_HANDOFF_PASS',
        JSON.stringify({
          originalKernel:ORIGINAL_KERNEL,
          originalT3ExchangeFormat:'iwxa.package',
          originalT3CarrierObject:carrierObjectId,
          originalT3SourcePlanEntries:currentPlan.entries.length,
          originalT3CarrierWorkspaceExported:true,
          originalT3ExportConfirmed:true,
          apacheWebDavPackageTransferred:true,
          independentOriginalT3ImportPreview:true,
          independentOriginalT3ImportCommit:true,
          originalT3ImportedPlanColdReadback:true,
          originalT3ImportReceiptDurableInOriginalStore:true,
          originalT3SignedSourceProvenanceVerified:false,
          originalT3RecipientDataWriteGrantFromCarrier:false,
          planIsNotAutomaticRecipientApplyAuthority:true,
          independentPhysicalDevices:false,
        }));

      // P2.2 original T3 replay CAS for a genuine signed native T4 frame.
      // Unlike the old .iwxa carrier, this packet is never exported or
      // imported: its checkpoint is written in the existing recipient
      // technical Workspace through the unmodified original Kernel.
      const nativeReplayWorkspace='t4:network:replay:'+randomUUID();
      await recipientPage.evaluate(async({SERVICE,nativeReplayWorkspace})=>{
        const kernel=await IWXA.connect({
          service_id:SERVICE,required_levels:['T1','T2']});
        return kernel.t1.createWorkspace({
          workspace_id:nativeReplayWorkspace,profile:'generic'});
      },{SERVICE,nativeReplayWorkspace});
      const replayKernel={
        hasOperation:op=>receiving.operations.includes(op),
        getObject:(w,id)=>recipientPage.evaluate(async({
          SERVICE,w,id,
        })=>{
          const kernel=await IWXA.connect({
            service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t1.getObject(w,id);
        },{SERVICE,w,id}),
        putObject:input=>recipientPage.evaluate(async({
          SERVICE,input,
        })=>{
          const kernel=await IWXA.connect({
            service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t1.putObject(input);
        },{SERVICE,input}),
        listEventsSince:w=>recipientPage.evaluate(async({
          SERVICE,w,
        })=>{
          const kernel=await IWXA.connect({
            service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t1.listEventsSince(w);
        },{SERVICE,w}),
      };
      const nativeKeys=generateKeyPairSync('ed25519');
      const nativeUnsigned=createT4CandidateUnsignedFrame({
        messageType:'HEADS',messageId:'message:original:replay:one',
        sourceNodeRef:'node:original:source',
        recipientNodeRef:'node:original:recipient',
        sessionRef:'session:original:replay:one',
        scopeRef:'scope:original:replay',
        permissionRef:'original:permission:replay',
        signerRef:'key:original:network:fixture',
        sequence:1,ownerEpoch:2,
        cryptoSuite:'X25519_AES256GCM_ED25519',
        body:{familyRef:'family:original:network:one',
          ownerEpoch:2,heads:['sha256:'+'a'.repeat(64)]},
      });
      const nativeWire=await signT4CandidateFrame({
        unsignedFrame:nativeUnsigned,
        signOriginalNodeBytes:async({bytes})=>sign(null,
          Buffer.from(bytes),nativeKeys.privateKey),
      });
      let replayOriginalHostSession='original:replay:host:'+randomUUID();
      const nativeReplayBinding=()=>createT4OriginalNetworkReplayPort({
        originalKernel:replayKernel,
        technicalWorkspaceId:nativeReplayWorkspace,
        originalWriteOwnerRef:'original:t2:exchange',
        localNodeRef:'node:original:recipient',
        scopeRef:'scope:original:replay',getMode:()=> 'T4_NETWORK',
        readOriginalHostContext:async()=>({
          workspaceId:nativeReplayWorkspace,
          originalWriteOwnerRef:'original:t2:exchange',
          nodeRef:'node:original:recipient',
          scopeRef:'scope:original:replay',
          hostSessionRef:replayOriginalHostSession,
        }),
        authorizeOriginalTechnicalRead:async proof=>
          receiving.operations.includes(proof.operation),
        authorizeOriginalTechnicalWrite:async proof=>
          receiving.operations.includes(proof.operation),
      });
      const nativeNetworkTransport=createWebDavPackageTransport({
        baseUrl:process.env.T4_TEST_URL,locationRef:'test-webdav',
        placementPolicy:policy,getMode:()=> 'T4_NETWORK',
        authorize:async()=>true,
        getAuthorizationHeader:async()=>process.env.T4_TEST_AUTH,
        keySuffix:'.t4n',candidateNetworkWire:true,
      });
      const nativeSender=createT4CandidateFrameTransport({
        wireTransport:nativeNetworkTransport,
        originalHostNodeRef:'node:original:source',
        originalHostScopeRef:'scope:original:replay',
        getMode:()=> 'T4_NETWORK',
        readOriginalHostContext:async()=>({
          nodeRef:'node:original:source',
          scopeRef:'scope:original:replay',
          originalOwnerRef:'original:t2:exchange',
          hostSessionRef:'original:network:source',
        }),
        authorizeOriginalHostWire:async proof=>
          proof.originalHostNodeRef==='node:original:source'&&
          actual.grants.includes('t1.getObject'),
        // Receiver-only ports do not issue signatures or permissions.
        verifyOriginalNodeSignature:async()=>false,
        authorizeOriginalNetwork:async()=>false,
        persistOriginalReplayDecision:async()=> 'DENIED',
      });
      const nativeNetworkSent=await nativeSender.publishSignedFrame({
        wireBytes:nativeWire,
      });
      assert.match(nativeNetworkSent.key,/^[a-f0-9]{64}\.t4n$/);
      const nativeReceiver=()=>createT4CandidateFrameTransport({
        wireTransport:nativeNetworkTransport,
        originalHostNodeRef:'node:original:recipient',
        originalHostScopeRef:'scope:original:replay',
        getMode:()=> 'T4_NETWORK',
        readOriginalHostContext:async()=>({
          nodeRef:'node:original:recipient',
          scopeRef:'scope:original:replay',
          originalOwnerRef:'original:t2:exchange',
          hostSessionRef:replayOriginalHostSession,
        }),
        authorizeOriginalHostWire:async proof=>
          proof.originalHostNodeRef==='node:original:recipient'&&
          receiving.operations.includes('t1.getObject'),
        verifyOriginalNodeSignature:async({bytes,signature})=>
          verifySignature(null,Buffer.from(bytes),
            nativeKeys.publicKey,Buffer.from(signature)),
        authorizeOriginalNetwork:async proof=>
          proof.permissionRef==='original:permission:replay'&&
          proof.sourceNodeRef==='node:original:source'&&
          receiving.operations.includes('t1.getObject'),
        persistOriginalReplayDecision:async proof=>
          nativeReplayBinding().persistOriginalReplayDecision(proof),
      });
      const nativeVerify=()=>nativeReceiver().readAndVerifySignedFrame({
        key:nativeNetworkSent.key,
        expectedSha256:nativeNetworkSent.sha256,
        requiredCryptoSuite:'X25519_AES256GCM_ED25519',
      });
      const nativeFirst=await nativeVerify();
      assert.equal(nativeFirst.originalReplayCheckpointRecorded,true);
      assert.equal(nativeFirst.exactPreviouslyVerifiedReplay,false);
      assert.equal(nativeFirst.originalBusinessApplied,false);
      await recipientContext.close();recipientContext=null;
      recipientContext=await launch(recipientProfile);
      recipientPage=await opened(recipientContext);
      replayOriginalHostSession='original:replay:host:'+randomUUID();
      const nativeAfterCold=await nativeVerify();
      assert.equal(nativeAfterCold.exactPreviouslyVerifiedReplay,true);
      const nativeReplayEvents=await replayKernel.listEventsSince(
        nativeReplayWorkspace);
      assert.equal(nativeReplayEvents.filter(e=>
        e.event_type==='t4.network.original.frame.replay.checkpoint')
        .length,1);
      // P2.2-B: the original T3, not a T4 Store, persists a separate
      // per-peer SOURCE and RECIPIENT chain. The receipt is technical;
      // no business application may be inferred from VERIFIED_ACK.
      const networkPhaseSession='session:original:phase:'+randomUUID();
      const networkPhaseChange='change:original:phase:'+randomUUID();
      const networkPhaseDigest='sha256:'+nativeNetworkSent.sha256;
      const originalPhaseIntent={
        evidenceRef:followup.capture.window.lastEventId,
        evidenceDigest:followup.capture.window.windowDigest,
      };
      const networkPhaseSent={
        evidenceRef:nativeNetworkSent.key,
        evidenceDigest:networkPhaseDigest,
      };
      const networkPhaseReceived={
        evidenceRef:nativeNetworkSent.key,
        evidenceDigest:networkPhaseDigest,
      };
      const networkPhaseVerified={
        evidenceRef:'original:network:signature:verified',
        evidenceDigest:networkPhaseDigest,
      };
      let sourcePhaseHostSession='original:phase:source:initial';
      let recipientPhaseHostSession='original:phase:recipient:initial';
      const originalSourcePhase=()=>createT4OriginalNetworkSessionPhasePort({
        originalKernel:originalCarrierKernel,
        technicalWorkspaceId:sourceCaptureWorkspace,
        originalWriteOwnerRef:'original:t2:exchange',
        sourceNodeRef:'node:original:source',
        recipientNodeRef:'node:original:recipient',
        localNodeRef:'node:original:source',
        scopeRef:'scope:original:network:phases',
        sessionRef:networkPhaseSession,changeId:networkPhaseChange,
        ownerEpoch:2,getMode:()=> 'T4_NETWORK',
        readOriginalHostContext:async()=>({
          workspaceId:sourceCaptureWorkspace,
          originalWriteOwnerRef:'original:t2:exchange',
          nodeRef:'node:original:source',
          scopeRef:'scope:original:network:phases',
          hostSessionRef:sourcePhaseHostSession,
        }),
        authorizeOriginalTechnicalRead:async p=>
          actual.grants.includes(p.operation),
        authorizeOriginalTechnicalWrite:async p=>
          actual.grants.includes(p.operation),
        verifyOriginalPhaseEvidence:async proof=>{
          if(proof.phase==='INTENT'){
            const original=await sourceKernel.getObject(
              workspaceId,linkedObjectId);
            const events=await originalCarrierKernel.listEventsSince(workspaceId);
            return proof.evidence.evidenceRef===
                followup.capture.window.lastEventId&&
              proof.evidence.evidenceDigest===
                followup.capture.window.windowDigest&&
              original?.object?.revision===9&&
              events.some(e=>e.event_id===
                followup.capture.window.lastEventId);
          }
          return proof.phase==='PUBLISHED'&&
            proof.evidence.evidenceRef===nativeNetworkSent.key&&
            nativeNetworkSent.immutableTransportReadback===true&&
            proof.evidence.evidenceDigest===networkPhaseDigest;
        },
        verifyOriginalRecipientApplied:async()=>false,
      });
      const originalRecipientPhase=()=>createT4OriginalNetworkSessionPhasePort({
        originalKernel:replayKernel,
        technicalWorkspaceId:nativeReplayWorkspace,
        originalWriteOwnerRef:'original:t2:exchange',
        sourceNodeRef:'node:original:source',
        recipientNodeRef:'node:original:recipient',
        localNodeRef:'node:original:recipient',
        scopeRef:'scope:original:network:phases',
        sessionRef:networkPhaseSession,changeId:networkPhaseChange,
        ownerEpoch:2,getMode:()=> 'T4_NETWORK',
        readOriginalHostContext:async()=>({
          workspaceId:nativeReplayWorkspace,
          originalWriteOwnerRef:'original:t2:exchange',
          nodeRef:'node:original:recipient',
          scopeRef:'scope:original:network:phases',
          hostSessionRef:recipientPhaseHostSession,
        }),
        authorizeOriginalTechnicalRead:async p=>
          receiving.operations.includes(p.operation),
        authorizeOriginalTechnicalWrite:async p=>
          receiving.operations.includes(p.operation),
        verifyOriginalPhaseEvidence:async proof=>{
          const valid=nativeAfterCold.originalReplayCheckpointRecorded===
            true&&nativeAfterCold.originalSignatureVerified===true;
          if(proof.phase==='RECEIVED')return valid&&
            proof.evidence.evidenceRef===nativeNetworkSent.key&&
            proof.evidence.evidenceDigest===networkPhaseDigest;
          if(proof.phase==='APPLIED')return valid&&
            proof.evidence.evidenceRef===
              'network:ack:is:not:subject:result'&&
            proof.evidence.evidenceDigest===networkPhaseDigest;
          return proof.phase==='VERIFIED'&&valid&&
            proof.evidence.evidenceRef===
              'original:network:signature:verified'&&
            proof.evidence.evidenceDigest===networkPhaseDigest;
        },
        verifyOriginalRecipientApplied:async()=>false,
      });
      const phaseFirst=await originalSourcePhase()
        .advanceOriginalSessionPhase({
          phase:'INTENT',evidence:originalPhaseIntent,
        });
      assert.equal(phaseFirst.revision,1);
      await originalSourcePhase().advanceOriginalSessionPhase({
        phase:'PUBLISHED',evidence:networkPhaseSent,
      });
      await originalRecipientPhase().advanceOriginalSessionPhase({
        phase:'RECEIVED',evidence:networkPhaseReceived,
      });
      await originalRecipientPhase().advanceOriginalSessionPhase({
        phase:'VERIFIED',evidence:networkPhaseVerified,
      });
      await assert.rejects(originalRecipientPhase()
        .advanceOriginalSessionPhase({
          phase:'APPLIED',evidence:{
            evidenceRef:'network:ack:is:not:subject:result',
            evidenceDigest:networkPhaseDigest,
            originalRecipientEventId:'event:unverified:recipient',
            originalRecipientRevision:1,
            originalRecipientStateDigest:networkPhaseDigest,
          },
        }),e=>e?.code==='PHASE_ORIGINAL_APPLIED_NOT_PROVEN');
      await sourceContext.close();sourceContext=null;
      await recipientContext.close();recipientContext=null;
      sourceContext=await launch(sourceProfile);
      activeSourcePage=await opened(sourceContext);
      recipientContext=await launch(recipientProfile);
      recipientPage=await opened(recipientContext);
      sourcePhaseHostSession='original:phase:source:after-cold';
      recipientPhaseHostSession='original:phase:recipient:after-cold';
      const sourcePhaseRestored=await originalSourcePhase()
        .inspectOriginalSession();
      const recipientPhaseRestored=await originalRecipientPhase()
        .inspectOriginalSession();
      assert.equal(sourcePhaseRestored.currentPhase,'PUBLISHED');
      assert.equal(recipientPhaseRestored.currentPhase,'VERIFIED');
      assert.equal(sourcePhaseRestored.revision,2);
      assert.equal(recipientPhaseRestored.revision,2);
      assert.equal(sourcePhaseRestored.originalBusinessApplied,false);
      assert.equal(recipientPhaseRestored.originalBusinessApplied,false);
      assert.equal((await originalSourcePhase()
        .advanceOriginalSessionPhase({
          phase:'PUBLISHED',evidence:networkPhaseSent,
        })).status,'ALREADY_CONFIRMED');
      assert.equal((await originalRecipientPhase()
        .advanceOriginalSessionPhase({
          phase:'VERIFIED',evidence:networkPhaseVerified,
        })).status,'ALREADY_CONFIRMED');
      const sourcePhaseEvents=(await originalCarrierKernel.listEventsSince(
        sourceCaptureWorkspace)).filter(e=>
        e.object_id===sourcePhaseRestored.checkpointRef&&
        e.event_type==='t4.network.original.session.phase');
      const recipientPhaseEvents=(await replayKernel.listEventsSince(
        nativeReplayWorkspace)).filter(e=>
        e.object_id===recipientPhaseRestored.checkpointRef&&
        e.event_type==='t4.network.original.session.phase');
      assert.equal(sourcePhaseEvents.length,2);
      assert.equal(recipientPhaseEvents.length,2);
      console.log('T4_REAL_ORIGINAL_T3_NETWORK_SESSION_PHASE_COLD_CAS_PASS',
        JSON.stringify({
          originalKernel:ORIGINAL_KERNEL,
          originalT3SourcePhases:['INTENT','PUBLISHED'],
          originalT3RecipientPhases:['RECEIVED','VERIFIED'],
          originalT3SourcePhaseEvents:sourcePhaseEvents.length,
          originalT3RecipientPhaseEvents:recipientPhaseEvents.length,
          bothOriginalHostsColdRestarted:true,
          originalT3PhaseCASReadback:true,
          originalT3SignedAckNotBusinessApplied:true,
          originalT3SessionStageWritesNotRepeated:true,
          originalT3ExchangeUsedForNativePhase:false,
          independentPhysicalDevices:false,
        }));

      // P2.2-B independent SOURCE proof: signed peer messages traverse
      // actual HTTPS and are matched with a real ORIGINAL T3 Event prefix.
      // This demonstrates the source Head/Change causal boundary, NOT a
      // new native subject-level apply or a cross-device corporate signer.
      const sourceBusinessEvents=await originalCarrierKernel.listEventsSince(
        workspaceId);
      const sourceLastIndex=sourceBusinessEvents.findIndex(ev=>
        ev.event_id===followup.capture.window.lastEventId);
      assert.equal(sourceLastIndex,sourceBusinessEvents.length-1);
      const sourceProofWindow=async(cursor,maxEvents)=>
        readT4OriginalEventWindow({
          workspaceId,originalWriteOwnerRef:'original:t2:exchange',
          cursor,maxEvents,
          authorizeOriginalRead:async proof=>
            actual.grants.includes(proof.operation),
          readOriginalEvents:()=>originalCarrierKernel.listEventsSince(workspaceId),
        });
      const previousSourceCursor=sourceLastIndex===0?null:
        (await sourceProofWindow(null,sourceLastIndex)).nextCursor;
      const trueLast=await sourceProofWindow(previousSourceCursor,1);
      assert.equal(trueLast.window.count,1);
      assert.equal(trueLast.window.hasMore,false);
      const sourceHeadSession='session:original:network:head:'+randomUUID();
      const sourceHeadChange='change:original:network:head:'+randomUUID();
      const peerSignedKeys=generateKeyPairSync('ed25519');
      const sourceSignedFrame=async(type,from,body,sequence)=>{
        const isSource=from==='SOURCE',fromNode=isSource?
          'node:original:source':'node:original:recipient';
        const toNode=isSource?
          'node:original:recipient':'node:original:source';
        const frame=createT4CandidateUnsignedFrame({
          messageType:type,
          messageId:'message:original:head:'+randomUUID(),
          sourceNodeRef:fromNode,recipientNodeRef:toNode,
          sessionRef:sourceHeadSession,scopeRef:'scope:original:replay',
          permissionRef:'original:permission:replay',
          signerRef:isSource?'key:original:source:head':
            'key:original:recipient:head',
          sequence,ownerEpoch:2,
          cryptoSuite:'X25519_AES256GCM_ED25519',body,
        });
        return signT4CandidateFrame({
          unsignedFrame:frame,signOriginalNodeBytes:async({bytes})=>
            sign(null,Buffer.from(bytes),isSource?
              nativeKeys.privateKey:peerSignedKeys.privateKey),
        });
      };
      const sourceReplayPhasePort=createT4OriginalNetworkReplayPort({
        originalKernel:originalCarrierKernel,
        technicalWorkspaceId:sourceCaptureWorkspace,
        originalWriteOwnerRef:'original:t2:exchange',
        localNodeRef:'node:original:source',
        scopeRef:'scope:original:replay',getMode:()=> 'T4_NETWORK',
        readOriginalHostContext:async()=>({
          workspaceId:sourceCaptureWorkspace,
          originalWriteOwnerRef:'original:t2:exchange',
          nodeRef:'node:original:source',
          scopeRef:'scope:original:replay',
          hostSessionRef:'original:source:head:host',
        }),
        authorizeOriginalTechnicalRead:async p=>
          actual.grants.includes(p.operation),
        authorizeOriginalTechnicalWrite:async p=>
          actual.grants.includes(p.operation),
      });
      const sourceHeadVerifier=createT4CandidateFrameTransport({
        wireTransport:nativeNetworkTransport,
        originalHostNodeRef:'node:original:source',
        originalHostScopeRef:'scope:original:replay',
        getMode:()=> 'T4_NETWORK',
        readOriginalHostContext:async()=>({
          nodeRef:'node:original:source',
          scopeRef:'scope:original:replay',
          originalOwnerRef:'original:t2:exchange',
          hostSessionRef:'original:source:head:wire',
        }),
        authorizeOriginalHostWire:async p=>
          p.originalHostNodeRef==='node:original:source'&&
          actual.grants.includes('t1.getObject'),
        verifyOriginalNodeSignature:async({bytes,signature})=>
          verifySignature(null,Buffer.from(bytes),
            peerSignedKeys.publicKey,Buffer.from(signature)),
        authorizeOriginalNetwork:async p=>
          p.sourceNodeRef==='node:original:recipient'&&
          p.recipientNodeRef==='node:original:source'&&
          p.permissionRef==='original:permission:replay',
        persistOriginalReplayDecision:
          sourceReplayPhasePort.persistOriginalReplayDecision,
      });
      const signedHeadExchange=async(type,from,body,sequence)=>{
        const encoded=await sourceSignedFrame(type,from,body,sequence);
        const published=await (from==='SOURCE'?
          nativeSender:nativeReceiver()).publishSignedFrame({
          wireBytes:encoded,
        });
        return (from==='SOURCE'?
          nativeReceiver():sourceHeadVerifier).readAndVerifySignedFrame({
          key:published.key,expectedSha256:published.sha256,
          requiredCryptoSuite:'X25519_AES256GCM_ED25519',
        });
      };
      const verifiedOriginalHeads=await signedHeadExchange(
        'HEADS','SOURCE',{
          familyRef:'family:original:object',
          ownerEpoch:2,
          heads:[trueLast.window.sourcePrefixDigestAfter],
        },1);
      const verifiedOriginalDiff=await signedHeadExchange(
        'DIFF_REQUEST','RECIPIENT',{
          familyRef:'family:original:object',
          fromHeads:previousSourceCursor?
            [trueLast.window.sourcePrefixDigestBefore]:[],
        },1);
      const verifiedOriginalChange=await signedHeadExchange(
        'CHANGE_REF','SOURCE',{
          changeId:sourceHeadChange,changeKind:'OBJECT_PUT',
          eventRef:followup.capture.window.lastEventId,
          ownerRef:'original:t2:exchange',sourceRevision:9,
          contentDigest:networkPhaseDigest,
          parents:[trueLast.window.sourcePrefixDigestBefore],
        },2);
      const realOriginalHead=await verifyT4OriginalSourceHeadCausality({
        verifiedHeads:verifiedOriginalHeads,
        verifiedDiffRequest:verifiedOriginalDiff,
        verifiedChangeRef:verifiedOriginalChange,
        workspaceId,originalWriteOwnerRef:'original:t2:exchange',
        sourceNodeRef:'node:original:source',
        recipientNodeRef:'node:original:recipient',
        scopeRef:'scope:original:replay',
        sessionRef:sourceHeadSession,ownerEpoch:2,
        sourceCursorBefore:previousSourceCursor,
        getMode:()=> 'T4_NETWORK',
        readOriginalHostContext:async()=>({
          workspaceId,originalWriteOwnerRef:'original:t2:exchange',
          nodeRef:'node:original:source',
          scopeRef:'scope:original:replay',
          hostSessionRef:'original:source:head:original',
        }),
        authorizeOriginalRead:async ctx=>
          actual.grants.includes(ctx.operation),
        readOriginalEvents:()=>originalCarrierKernel.listEventsSince(workspaceId),
        verifyOriginalSourceSubject:async proof=>{
          const object=await sourceKernel.getObject(
            workspaceId,linkedObjectId);
          return proof.originalSourceEventId===
              followup.capture.window.lastEventId&&
            proof.originalSourceRevision===9&&
            proof.originalObjectId===linkedObjectId&&
            object?.object?.revision===9&&
            object.object.object_id===linkedObjectId;
        },
      });
      assert.equal(realOriginalHead.signedHeadMatchesOriginalT3EventPrefix,
        true);
      assert.equal(realOriginalHead.signedDiffMatchesOriginalT3Frontier,
        true);
      assert.equal(realOriginalHead.originalSourceSubjectIndependentlyRead,
        true);
      assert.equal(realOriginalHead.originalBusinessApplied,false);
      console.log('T4_REAL_ORIGINAL_T3_SIGNED_SOURCE_HEAD_CAUSAL_PASS',
        JSON.stringify({
          originalKernel:ORIGINAL_KERNEL,
          signedHeadsDiffAndChangeDeliveredViaApache:true,
          differentOriginalNodeTestKeys:true,
          sourceOriginalEvent:realOriginalHead.originalSourceEventId,
          sourceOriginalEventRevision:realOriginalHead.originalEventRevision,
          sourceOriginalEventPrefixReconstructed:true,
          originalSourceSubjectRevisionVerified:true,
          originalT3ExchangeUsedForNativeHeads:false,
          ciphertextNotBoundToSubjectContentInThisTest:true,
          historicalForkWitnessAvailable:false,
          independentPhysicalDevices:false,
        }));

      // P2.2-C: actual original T3 Object -> authenticated encrypted native
      // CHANGE_REF/CHUNK -> original recipient graph commit -> signed
      // APPLIED_ACK. A lost ORIGINAL graph ACK must never trigger retry.
      const p2cObjectId='t4:network:p22c:subject:'+randomUUID();
      const p2cInput={
        workspace_id:workspaceId,object_id:p2cObjectId,
        schema_id:'iwxa.demo.note',schema_version:'1.0.0',
        data:{title:'Original T3 subject applied by native T4 network',
          quantity:7,sourceOwner:'original:t2:exchange'},
        extensions:{nativeNetworkSubject:true},base_revision:0,
        event:{event_type:'t4.network.p22c.original.subject.created',
          payload:{subjectId:p2cObjectId}},
      };
      const p2cSourceWrite=await originalCarrierKernel.putObject(p2cInput);
      assert.equal(p2cSourceWrite.object.revision,1);
      const p2cWindow=await sourceProofWindow(trueLast.nextCursor,1);
      assert.equal(p2cWindow.window.count,1);
      assert.equal(p2cWindow.window.hasMore,false);
      assert.equal(p2cWindow.window.lastEventId,
        p2cSourceWrite.event.event_id);
      const p2cPrepared=await prepareT4OriginalObjectDelta({
        window:p2cWindow.window,workspaceId,objectId:p2cObjectId,
        originalWriteOwnerRef:'original:t2:exchange',
        originalKernel:originalCarrierKernel,
        authorizeOriginalRead:async p=>actual.grants.includes(p.operation),
        getMode:()=> 'T4_NETWORK',
      });
      assert.equal(p2cPrepared.delta.sourceRevision,1);
      const p2cSession='session:original:p22c:'+randomUUID();
      const p2cChangeId='change:original:p22c:'+randomUUID();
      const p2cFamily='family:original:p22c:objects';
      const p2cIv=randomBytes(12),p2cKey=randomBytes(32),
        p2cAad=Buffer.from(p2cSession+':'+p2cChangeId);
      const p2cCipher=createCipheriv('aes-256-gcm',p2cKey,p2cIv);
      p2cCipher.setAAD(p2cAad);
      const p2cSealed=Buffer.concat([p2cIv,
        p2cCipher.update(p2cPrepared.bytes),p2cCipher.final(),
        p2cCipher.getAuthTag()]);
      const p2cPlan=await prepareT4CandidateOpaqueChunks({
        changeId:p2cChangeId,ownerRef:'original:t2:exchange',
        sourceContentRef:'original:sealed:p22c:'+randomUUID(),
        getMode:()=> 'T4_NETWORK',
        authorizeOriginalSealedContent:async()=>actual.grants.includes(
          't1.getObject'),
        readOriginalSealedContent:async()=>({
          ciphertext:new Uint8Array(p2cSealed),
          encryptionContextRef:'original:test:sealed:epoch:2',
        }),
      });
      assert.ok(p2cPlan.chunkCount>0);
      const p2cFrame=async(type,from,body,sequence)=>{
        const source=from==='SOURCE';
        const frame=createT4CandidateUnsignedFrame({
          messageType:type,
          messageId:'message:original:p22c:'+randomUUID(),
          sourceNodeRef:source?'node:original:source':
            'node:original:recipient',
          recipientNodeRef:source?'node:original:recipient':
            'node:original:source',
          sessionRef:p2cSession,scopeRef:'scope:original:replay',
          permissionRef:'original:permission:replay',
          signerRef:source?'key:original:source:p22c':
            'key:original:recipient:p22c',sequence,ownerEpoch:2,
          cryptoSuite:'X25519_AES256GCM_ED25519',body,
        });
        return signT4CandidateFrame({
          unsignedFrame:frame,signOriginalNodeBytes:async({bytes})=>
            sign(null,Buffer.from(bytes),source?
              nativeKeys.privateKey:peerSignedKeys.privateKey),
        });
      };
      const p2cExchange=async(type,from,body,sequence)=>{
        const source=from==='SOURCE';
        const wireBytes=await p2cFrame(type,from,body,sequence);
        const sender=source?nativeSender:nativeReceiver();
        const publication=await sender.publishSignedFrame({wireBytes});
        const receiver=source?nativeReceiver():sourceHeadVerifier;
        const verified=await receiver.readAndVerifySignedFrame({
          key:publication.key,expectedSha256:publication.sha256,
          requiredCryptoSuite:'X25519_AES256GCM_ED25519',
        });
        assert.equal(verified.originalSignatureVerified,true);
        return {publication,verified};
      };
      const p2cHeads=await p2cExchange('HEADS','SOURCE',{
        familyRef:p2cFamily,ownerEpoch:2,
        heads:[p2cWindow.window.sourcePrefixDigestAfter],
      },1);
      const p2cDiff=await p2cExchange('DIFF_REQUEST','RECIPIENT',{
        familyRef:p2cFamily,
        fromHeads:[p2cWindow.window.sourcePrefixDigestBefore],
      },1);
      const p2cChange=await p2cExchange('CHANGE_REF','SOURCE',{
        changeId:p2cChangeId,changeKind:'OBJECT_PUT',
        eventRef:p2cSourceWrite.event.event_id,
        ownerRef:'original:t2:exchange',sourceRevision:1,
        contentDigest:p2cPlan.contentDigest,
        parents:[p2cWindow.window.sourcePrefixDigestBefore],
      },2);
      const p2cChunks=[];
      for(const [index,body] of p2cPlan.bodies.entries()){
        p2cChunks.push(await p2cExchange('CHUNK','SOURCE',body,
          index+3));
      }
      const p2cHeadProof=await verifyT4OriginalSourceHeadCausality({
        verifiedHeads:p2cHeads.verified,
        verifiedDiffRequest:p2cDiff.verified,
        verifiedChangeRef:p2cChange.verified,
        workspaceId,originalWriteOwnerRef:'original:t2:exchange',
        sourceNodeRef:'node:original:source',
        recipientNodeRef:'node:original:recipient',
        scopeRef:'scope:original:replay',
        sessionRef:p2cSession,ownerEpoch:2,
        sourceCursorBefore:trueLast.nextCursor,
        getMode:()=> 'T4_NETWORK',
        readOriginalHostContext:async()=>({
          workspaceId,originalWriteOwnerRef:'original:t2:exchange',
          nodeRef:'node:original:source',
          scopeRef:'scope:original:replay',
          hostSessionRef:'host:original:p22c:source',
        }),
        authorizeOriginalRead:async p=>actual.grants.includes(
          p.operation),
        readOriginalEvents:()=>originalCarrierKernel.listEventsSince(
          workspaceId),
        verifyOriginalSourceSubject:async proof=>{
          const found=await originalCarrierKernel.getObject(
            workspaceId,p2cObjectId);
          return proof.originalSourceEventId===
              p2cSourceWrite.event.event_id&&
            proof.originalObjectId===p2cObjectId&&
            proof.originalSourceRevision===1&&
            found?.object?.revision===1;
        },
      });
      const p2cOpened=await openT4OriginalNetworkObjectChange({
        verifiedChangeRef:p2cChange.verified,
        verifiedChunks:p2cChunks.map(x=>x.verified),
        originalSourceHeadProof:p2cHeadProof,
        encryptionContextRef:p2cPlan.encryptionContextRef,
        recipientNodeRef:'node:original:recipient',
        scopeRef:'scope:original:replay',
        getMode:()=> 'T4_NETWORK',
        readOriginalHostContext:async()=>({
          nodeRef:'node:original:recipient',
          scopeRef:'scope:original:replay',
          hostSessionRef:'host:original:p22c:recipient',
          originalWriteOwnerRef:'original:t2:exchange',
        }),
        authorizeOriginalSealedOpen:async p=>
          receiving.operations.includes('t1.getObject')&&
          p.originalHostKeyAndPolicyRequired===true&&
          p.sourceEventId===p2cSourceWrite.event.event_id,
        verifyOriginalSourceBinding:async proof=>{
          if(proof.sourceEventId!==p2cSourceWrite.event.event_id)
            return false;
          const source=await originalCarrierKernel.getObject(
            workspaceId,p2cObjectId);
          if(source?.object?.revision!==1)return false;
          if(proof.originalT3SourceObjectEventAndContentReadbackRequired){
            return proof.originalObjectId===p2cObjectId&&
              proof.originalWorkspaceId===workspaceId&&
              proof.originalObjectContentDigest===
                digestT4OriginalObjectContent({
                  schemaId:source.object.schema_id,
                  schemaVersion:source.object.schema_version,
                  data:source.object.data,
                  extensions:source.object.extensions??{},
                });
          }
          return true;
        },
        openOriginalSealedContent:async p=>{
          const input=Buffer.from(p.ciphertext);
          const dec=createDecipheriv('aes-256-gcm',p2cKey,
            input.subarray(0,12));
          dec.setAAD(p2cAad);
          dec.setAuthTag(input.subarray(-16));
          const plain=Buffer.concat([
            dec.update(input.subarray(12,-16)),dec.final(),
          ]);
          return {authenticated:true,plaintext:new Uint8Array(plain)};
        },
      });
      assert.equal(p2cOpened.originalBusinessApplied,false);
      assert.equal(p2cOpened.originalSourceEventAndObjectVerified,true);
      let p2cCommitCalls=0,p2cLostOriginalAck=true;
      const p2cRecipientKernel={
        hasOperation:op=>receiving.operations.includes(op),
        getObject:(w,id)=>recipientPage.evaluate(async({
          SERVICE,w,id,
        })=>{
          const kernel=await IWXA.connect({
            service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t1.getObject(w,id);
        },{SERVICE,w,id}),
        listEventsSince:w=>recipientPage.evaluate(async({
          SERVICE,w,
        })=>{
          const kernel=await IWXA.connect({
            service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t1.listEventsSince(w);
        },{SERVICE,w}),
        commitObjectGraph:async input=>{
          p2cCommitCalls++;
          const committed=await recipientPage.evaluate(async({
            SERVICE,input,
          })=>{
            const kernel=await IWXA.connect({
              service_id:SERVICE,required_levels:['T1','T2']});
            return kernel.t1.commitObjectGraph(input);
          },{SERVICE,input});
          if(p2cLostOriginalAck){
            p2cLostOriginalAck=false;
            throw Object.assign(
              Error('ORIGINAL_T3_GRAPH_ACK_INTENTIONALLY_LOST'),
              {code:'ACK_LOST'});
          }
          return committed;
        },
      };
      const p2cApplyArgs=()=>({
        received:p2cOpened,originalKernel:p2cRecipientKernel,
        getMode:()=> 'T4_NETWORK',
        authorizeOriginalRead:async p=>receiving.operations.includes(
          p.operation),
        authorizeOriginalWrite:async p=>receiving.operations.includes(
          p.operation),
        verifyOriginalSourceEvent:async proof=>
          proof.sourceEventId===p2cSourceWrite.event.event_id&&
          proof.sourceRevision===1&&
          proof.objectContentDigest===p2cOpened.originalStateDigest,
      });
      // P2.2-C durable session for THIS encrypted subject transfer.
      // Both phase chains live in existing original T3 technical Workspaces.
      let p2cSourceHostSession='host:p22c:source:initial';
      let p2cRecipientHostSession='host:p22c:recipient:initial';
      let p2cSignedAppliedAck=null;
      const p2cSourcePhase=()=>createT4OriginalNetworkSessionPhasePort({
        originalKernel:originalCarrierKernel,
        technicalWorkspaceId:sourceCaptureWorkspace,
        originalWriteOwnerRef:'original:t2:exchange',
        sourceNodeRef:'node:original:source',
        recipientNodeRef:'node:original:recipient',
        localNodeRef:'node:original:source',
        scopeRef:'scope:original:replay',
        sessionRef:p2cSession,changeId:p2cChangeId,
        ownerEpoch:2,getMode:()=> 'T4_NETWORK',
        readOriginalHostContext:async()=>({
          workspaceId:sourceCaptureWorkspace,
          originalWriteOwnerRef:'original:t2:exchange',
          nodeRef:'node:original:source',
          scopeRef:'scope:original:replay',
          hostSessionRef:p2cSourceHostSession,
        }),
        authorizeOriginalTechnicalRead:async p=>
          actual.grants.includes(p.operation),
        authorizeOriginalTechnicalWrite:async p=>
          actual.grants.includes(p.operation),
        verifyOriginalPhaseEvidence:async p=>{
          if(p.phase==='INTENT'){
            const original=await originalCarrierKernel.getObject(
              workspaceId,p2cObjectId);
            const events=await originalCarrierKernel.listEventsSince(
              workspaceId);
            return p.evidence.evidenceRef===
                p2cSourceWrite.event.event_id&&
              p.evidence.evidenceDigest===p2cWindow.window.windowDigest&&
              original?.object?.revision===1&&
              events.some(e=>e.event_id===p2cSourceWrite.event.event_id);
          }
          return p.phase==='PUBLISHED'&&
            p.evidence.evidenceRef===p2cChange.publication.key&&
            p.evidence.evidenceDigest===
              'sha256:'+p2cChange.publication.sha256&&
            p2cChange.publication.immutableTransportReadback===true;
        },
        verifyOriginalRecipientApplied:async()=>false,
      });
      const p2cRecipientPhase=()=>createT4OriginalNetworkSessionPhasePort({
        originalKernel:replayKernel,
        technicalWorkspaceId:nativeReplayWorkspace,
        originalWriteOwnerRef:'original:t2:exchange',
        sourceNodeRef:'node:original:source',
        recipientNodeRef:'node:original:recipient',
        localNodeRef:'node:original:recipient',
        scopeRef:'scope:original:replay',
        sessionRef:p2cSession,changeId:p2cChangeId,
        ownerEpoch:2,getMode:()=> 'T4_NETWORK',
        readOriginalHostContext:async()=>({
          workspaceId:nativeReplayWorkspace,
          originalWriteOwnerRef:'original:t2:exchange',
          nodeRef:'node:original:recipient',
          scopeRef:'scope:original:replay',
          hostSessionRef:p2cRecipientHostSession,
        }),
        authorizeOriginalTechnicalRead:async p=>
          receiving.operations.includes(p.operation),
        authorizeOriginalTechnicalWrite:async p=>
          receiving.operations.includes(p.operation),
        verifyOriginalPhaseEvidence:async p=>{
          if(p.phase==='RECEIVED')return p.evidence.evidenceRef===
            p2cChunks[0].publication.key&&
            p.evidence.evidenceDigest===
              'sha256:'+p2cChunks[0].publication.sha256&&
            p2cChunks[0].verified.networkBytesVerified===true;
          if(p.phase==='VERIFIED')return p.evidence.evidenceRef===
            p2cChange.publication.key&&
            p.evidence.evidenceDigest===
              p2cOpened.originalStateDigest&&
            p2cOpened.originalSourceEventAndObjectVerified===true;
          if(p.phase==='APPLIED')return (
            p2cSignedAppliedAck?.signedMessageType==='APPLIED_ACK'&&
            p2cSignedAppliedAck.originalSignatureVerified===true&&
            p2cSignedAppliedAck.verifiedBody?.recipientEventRef===
              p.evidence.originalRecipientEventId&&
            p2cSignedAppliedAck.verifiedBody?.recipientStateDigest===
              p.evidence.originalRecipientStateDigest
          );
          return false;
        },
        verifyOriginalRecipientApplied:async p=>{
          const actualResult=await inspectT4OriginalNetworkRecipientResult(
            p2cApplyArgs());
          return actualResult.state==='APPLIED_VERIFIED'&&
            p.originalRecipientEventId===
              actualResult.originalRecipientEventId&&
            p.originalRecipientRevision===
              actualResult.originalRecipientRevision&&
            p.originalRecipientStateDigest===
              actualResult.originalRecipientStateDigest;
        },
      });
      const p2cSourceIntentEvidence={
        evidenceRef:p2cSourceWrite.event.event_id,
        evidenceDigest:p2cWindow.window.windowDigest,
      };
      const p2cSourcePublishedEvidence={
        evidenceRef:p2cChange.publication.key,
        evidenceDigest:'sha256:'+p2cChange.publication.sha256,
      };
      const p2cReceivedEvidence={
        evidenceRef:p2cChunks[0].publication.key,
        evidenceDigest:'sha256:'+p2cChunks[0].publication.sha256,
      };
      const p2cVerifiedEvidence={
        evidenceRef:p2cChange.publication.key,
        evidenceDigest:p2cOpened.originalStateDigest,
      };
      await p2cSourcePhase().advanceOriginalSessionPhase({
        phase:'INTENT',evidence:p2cSourceIntentEvidence,
      });
      await p2cSourcePhase().advanceOriginalSessionPhase({
        phase:'PUBLISHED',evidence:p2cSourcePublishedEvidence,
      });
      await p2cRecipientPhase().advanceOriginalSessionPhase({
        phase:'RECEIVED',evidence:p2cReceivedEvidence,
      });
      await p2cRecipientPhase().advanceOriginalSessionPhase({
        phase:'VERIFIED',evidence:p2cVerifiedEvidence,
      });
      assert.equal((await p2cRecipientPhase().inspectOriginalSession())
        .currentPhase,'VERIFIED');
      const p2cBefore=await inspectT4OriginalNetworkRecipientResult(
        p2cApplyArgs());
      assert.equal(p2cBefore.state,'NOT_APPLIED');
      await assert.rejects(applyT4OriginalNetworkObjectChange(
        p2cApplyArgs()),error=>
          error?.code==='SUBJECT_ORIGINAL_APPLY_OUTCOME_UNKNOWN'&&
          error.details.automaticRetryAllowed===false);
      assert.equal(p2cCommitCalls,1);
      // Cold restart before inspecting the uncertain outcome.
      await sourceContext.close();sourceContext=null;
      await recipientContext.close();recipientContext=null;
      sourceContext=await launch(sourceProfile);
      activeSourcePage=await opened(sourceContext);
      recipientContext=await launch(recipientProfile);
      recipientPage=await opened(recipientContext);
      p2cSourceHostSession='host:p22c:source:cold';
      p2cRecipientHostSession='host:p22c:recipient:cold';
      assert.equal((await p2cSourcePhase().inspectOriginalSession())
        .currentPhase,'PUBLISHED');
      assert.equal((await p2cRecipientPhase().inspectOriginalSession())
        .currentPhase,'VERIFIED');
      const p2cRealResult=await inspectT4OriginalNetworkRecipientResult(
        p2cApplyArgs());
      assert.equal(p2cRealResult.state,'APPLIED_VERIFIED');
      assert.equal(p2cRealResult.originalRecipientRevision,1);
      const p2cAppliedAgain=await applyT4OriginalNetworkObjectChange(
        p2cApplyArgs());
      assert.equal(p2cAppliedAgain.originalCommitInvoked,false);
      assert.equal(p2cCommitCalls,1);
      const p2cAckBody=createT4OriginalNetworkAppliedAckBody({
        received:p2cOpened,verifiedResult:p2cRealResult,
        ackRef:'ack:original:p22c:'+randomUUID(),
      });
      const p2cAck=await p2cExchange('APPLIED_ACK',
        'RECIPIENT',p2cAckBody,2);
      assert.equal(p2cAck.verified.verifiedBody.recipientEventRef,
        p2cRealResult.originalRecipientEventId);
      assert.equal(p2cAck.verified.verifiedBody.recipientStateDigest,
        p2cOpened.originalStateDigest);
      assert.equal(p2cAck.verified.originalBusinessApplied,false);
      p2cSignedAppliedAck=p2cAck.verified;
      const p2cAppliedPhaseEvidence={
        evidenceRef:p2cAck.publication.key,
        evidenceDigest:'sha256:'+p2cAck.publication.sha256,
        originalRecipientEventId:p2cRealResult.originalRecipientEventId,
        originalRecipientRevision:p2cRealResult.originalRecipientRevision,
        originalRecipientStateDigest:p2cRealResult.originalRecipientStateDigest,
      };
      const p2cPhaseApplied=await p2cRecipientPhase()
        .advanceOriginalSessionPhase({
          phase:'APPLIED',evidence:p2cAppliedPhaseEvidence,
        });
      assert.equal(p2cPhaseApplied.originalBusinessApplied,true);
      // Second cold restart proves that the durable APPLIED phase AND
      // independent original T3 business Result remain the same.
      await sourceContext.close();sourceContext=null;
      await recipientContext.close();recipientContext=null;
      sourceContext=await launch(sourceProfile);
      activeSourcePage=await opened(sourceContext);
      recipientContext=await launch(recipientProfile);
      recipientPage=await opened(recipientContext);
      p2cSourceHostSession='host:p22c:source:after-second-cold';
      p2cRecipientHostSession='host:p22c:recipient:after-second-cold';
      const p2cSourceCold=await p2cSourcePhase()
        .inspectOriginalSession();
      const p2cRecipientCold=await p2cRecipientPhase()
        .inspectOriginalSession();
      assert.equal(p2cSourceCold.currentPhase,'PUBLISHED');
      assert.equal(p2cRecipientCold.currentPhase,'APPLIED');
      assert.equal(p2cRecipientCold.originalBusinessApplied,true);
      assert.equal((await p2cRecipientPhase()
        .advanceOriginalSessionPhase({
          phase:'APPLIED',evidence:p2cAppliedPhaseEvidence,
        })).status,'ALREADY_CONFIRMED');
      const p2cConfirmedAck=await sourceHeadVerifier
        .readAndVerifySignedFrame({
          key:p2cAck.publication.key,
          expectedSha256:p2cAck.publication.sha256,
          requiredCryptoSuite:'X25519_AES256GCM_ED25519',
        });
      assert.equal(p2cConfirmedAck.signedMessageType,'APPLIED_ACK');
      assert.equal(p2cConfirmedAck.exactPreviouslyVerifiedReplay,true);
      assert.equal((await inspectT4OriginalNetworkRecipientResult(
        p2cApplyArgs())).originalRecipientEventId,
        p2cRealResult.originalRecipientEventId);
      const p2cRecipientPhases=(await replayKernel.listEventsSince(
        nativeReplayWorkspace)).filter(e=>
          e.object_id===p2cRecipientCold.checkpointRef&&
          e.event_type==='t4.network.original.session.phase');
      assert.equal(p2cRecipientPhases.length,3);
      assert.equal(p2cCommitCalls,1);
      console.log('T4_REAL_ORIGINAL_T3_NATIVE_SUBJECT_APPLY_COLD_PASS',
        JSON.stringify({
          originalKernel:ORIGINAL_KERNEL,
          signedOriginalHeadsDiffChangeChunkAckViaApache:true,
          authenticatedEncryptedOriginalDelta:true,
          originalT3SourceEventId:p2cSourceWrite.event.event_id,
          originalT3RecipientEventId:
            p2cRealResult.originalRecipientEventId,
          originalT3RecipientRevision:1,
          originalT3SubjectContentBound:true,
          originalT3CommitCalls:1,
          originalT3CommitAckIntentionallyLost:true,
          bothOriginalHostsColdRestartedAfterCommit:true,
          originalRecipientNetworkSessionPhase:'APPLIED',
          originalRecipientTechnicalEvents:3,
          originalSourceNetworkSessionPhase:'PUBLISHED',
          originalNetworkAppliedPhaseRecoveredAfterSecondCold:true,
          originalSignedAckReplayRecoveredAfterCold:true,
          replayedSubjectMutation:false,
          originalT3ExchangeUsedForNativeNetwork:false,
          independentPhysicalDevices:false,
        }));

      nativeNetworkTransport.close();
      console.log('T4_REAL_ORIGINAL_T3_NETWORK_REPLAY_COLD_CAS_PASS',
        JSON.stringify({
          originalKernel:ORIGINAL_KERNEL,
          signedNativeWireEd25519Verified:true,
          realApacheNativeT4NetworkFrameTransferred:true,
          realApacheNativeT4NetworkFrameColdReadback:true,
          originalT3TechnicalStoreUsed:true,
          originalT3NetworkReplayEventCount:1,
          originalT3ColdRestartReplayRecovered:true,
          originalT3RepeatedNetworkCheckpointWrite:false,
          originalT3OriginalBusinessMutation:false,
          newStoreCreated:false,
          originalT3IwxExchangeCalledForNetworkReplay:false,
          independentPhysicalDevices:false,
        }));

      // Isolated semantics audit of RELEASED original T3 deleteObject.
      // Never publish a delete delta here; a lost original delete ACK is not
      // permission to invoke the destructive operation a second time.
      const deleteProbeObjectId='t4:source:delete-probe:'+randomUUID();
      const preparedDeleteObject=await activeSourcePage.evaluate(
        async({SERVICE,sourceCaptureWorkspace,deleteProbeObjectId})=>{
          const kernel=await IWXA.connect({
            service_id:SERVICE,required_levels:['T1','T2']});
          return kernel.t1.putObject({
            workspace_id:sourceCaptureWorkspace,object_id:deleteProbeObjectId,
            schema_id:'iwxa.demo.note',schema_version:'1.0.0',
            data:{probe:'t4-original-delete-policy',phase:'created'},
            extensions:{},base_revision:0,
            event:{event_type:'t4.original.delete.probe.created',
              payload:{probeObjectId:deleteProbeObjectId}},
          });
        },{SERVICE,sourceCaptureWorkspace,deleteProbeObjectId});
      assert.equal(preparedDeleteObject.object.revision,1);
      let originalDeleteObjectCalls=0;
      await assert.rejects(async()=>{
        originalDeleteObjectCalls++;
        await activeSourcePage.evaluate(
          async({SERVICE,sourceCaptureWorkspace,deleteProbeObjectId})=>{
            const kernel=await IWXA.connect({
              service_id:SERVICE,required_levels:['T1','T2']});
            return kernel.t1.deleteObject({
              workspace_id:sourceCaptureWorkspace,object_id:deleteProbeObjectId,
              base_revision:1,
              event:{event_type:'t4.original.delete.probe.deleted',
                payload:{probeObjectId:deleteProbeObjectId}},
            });
          },{SERVICE,sourceCaptureWorkspace,deleteProbeObjectId});
        throw Object.assign(new Error('ORIGINAL_DELETE_ACK_INTENTIONALLY_LOST'),
          {code:'NETWORK_TIMEOUT'});
      },error=>error.code==='NETWORK_TIMEOUT');
      assert.equal(originalDeleteObjectCalls,1);
      const readDeleteProbe=()=>activeSourcePage.evaluate(
        async({SERVICE,sourceCaptureWorkspace,deleteProbeObjectId})=>{
          const kernel=await IWXA.connect({
            service_id:SERVICE,required_levels:['T1','T2']});
          const [record,catalog,events]=await Promise.all([
            kernel.t1.getObject(sourceCaptureWorkspace,deleteProbeObjectId),
            kernel.t1.listObjects({
              workspace_id:sourceCaptureWorkspace,include_deleted:true}),
            kernel.t1.listEventsSince(sourceCaptureWorkspace),
          ]);
          const matching=events.filter(row=>
            row.object_id===deleteProbeObjectId&&
            row.event_type==='t4.original.delete.probe.deleted');
          return {
            objectFound:record!==null,
            objectDeleted:record?.object?.deleted??null,
            objectRevision:record?.object?.revision??null,
            listedIncludingDeleted:catalog.some(row=>
              row.object_id===deleteProbeObjectId),
            matchingDeleteEvents:matching.length,
            sourceDeleteEventId:matching[0]?.event_id??null,
          };
        },{SERVICE,sourceCaptureWorkspace,deleteProbeObjectId});
      const deletedBeforeCold=await readDeleteProbe();
      assert.equal(deletedBeforeCold.matchingDeleteEvents,1);
      assert.equal(typeof deletedBeforeCold.sourceDeleteEventId,'string');
      await sourceContext.close();sourceContext=null;
      sourceContext=await launch(sourceProfile);
      activeSourcePage=await opened(sourceContext);
      const deletedAfterCold=await readDeleteProbe();
      assert.deepEqual(deletedAfterCold,deletedBeforeCold);
      assert.equal(originalDeleteObjectCalls,1);
      console.log('T4_REAL_ORIGINAL_T3_DELETE_OBJECT_SOURCE_SEMANTICS_PASS',
        JSON.stringify({
          originalKernel:ORIGINAL_KERNEL,
          lostSourceDeleteACK:true,
          originalDeleteObjectCalls,
          coldRestartReadbackSame:true,
          remoteDeleteDeltaPublished:false,
          ...deletedAfterCold,
        }));
      // Separate dependent Object deletion qualification: original T3 owns
      // both relation and asset semantics; T4 must not infer a cascade.
      const dependencyProbe={
        deletedId:'t4:source:delete-dependent:'+randomUUID(),
        linkedId:'t4:source:delete-target:'+randomUUID(),
        assetId:'t4:source:delete-asset:'+randomUUID(),
        relationId:'t4:source:delete-relation:'+randomUUID(),
      };
      const dependencyDeleteOutcome=await activeSourcePage.evaluate(
        async({SERVICE,sourceCaptureWorkspace,dependencyProbe})=>{
          const kernel=await IWXA.connect({
            service_id:SERVICE,required_levels:['T1','T2']});
          for(const objectId of [dependencyProbe.deletedId,
            dependencyProbe.linkedId]){
            await kernel.t1.putObject({
              workspace_id:sourceCaptureWorkspace,object_id:objectId,
              schema_id:'iwxa.demo.note',schema_version:'1.0.0',
              data:{probe:'t4-delete-dependent',objectId},
              extensions:{},base_revision:0,
              event:{event_type:'t4.original.delete.dependency.object-created',
                payload:{objectId}},
            });
          }
          await kernel.t1.putRelation({
            workspace_id:sourceCaptureWorkspace,
            relation_id:dependencyProbe.relationId,
            from_object_id:dependencyProbe.deletedId,
            to_object_id:dependencyProbe.linkedId,
            kind:'related',
            event:{event_type:'t4.original.delete.dependency.relation-created',
              payload:{relationId:dependencyProbe.relationId}},
          });
          await kernel.t1.putAsset({
            workspace_id:sourceCaptureWorkspace,
            asset_id:dependencyProbe.assetId,
            object_id:dependencyProbe.deletedId,
            mime:'text/plain',base_revision:0,
            bytes:new TextEncoder().encode('Original T3 asset dependency'),
            event:{event_type:'t4.original.delete.dependency.asset-created',
              payload:{assetId:dependencyProbe.assetId}},
          });
          const current=await kernel.t1.getObject(
            sourceCaptureWorkspace,dependencyProbe.deletedId);
          let result;
          try{
            const receipt=await kernel.t1.deleteObject({
              workspace_id:sourceCaptureWorkspace,
              object_id:dependencyProbe.deletedId,
              base_revision:current.object.revision,
              event:{event_type:'t4.original.delete.dependency.attempt',
                payload:{probe:'linked-object-delete'}},
            });
            result={kind:'COMMITTED',receiptEventId:receipt?.event?.event_id??null};
          }catch(error){
            result={kind:'REJECTED',errorCode:error?.code??'UNCLASSIFIED'};
          }
          return result;
        },{SERVICE,sourceCaptureWorkspace,dependencyProbe});
      const readDependencyState=()=>activeSourcePage.evaluate(
        async({SERVICE,sourceCaptureWorkspace,dependencyProbe})=>{
          const kernel=await IWXA.connect({
            service_id:SERVICE,required_levels:['T1','T2']});
          const [record,asset,other,events]=await Promise.all([
            kernel.t1.getObject(sourceCaptureWorkspace,
              dependencyProbe.deletedId),
            kernel.t1.getAsset(sourceCaptureWorkspace,
              dependencyProbe.assetId),
            kernel.t1.getObject(sourceCaptureWorkspace,
              dependencyProbe.linkedId),
            kernel.t1.listEventsSince(sourceCaptureWorkspace),
          ]);
          return {
            objectFound:record!==null,
            objectDeleted:record?.object?.deleted??null,
            objectRevision:record?.object?.revision??null,
            relationPresent:(record?.relations?.outgoing??[]).some(
              link=>link.relation_id===dependencyProbe.relationId),
            relationIncomingToTarget:(other?.relations?.incoming??[]).some(
              link=>link.relation_id===dependencyProbe.relationId),
            assetPresent:asset!==null,
            assetRevision:asset?.asset?.revision??null,
            objectDeleteEvents:events.filter(row=>
              row.object_id===dependencyProbe.deletedId&&
              row.event_type==='t4.original.delete.dependency.attempt').length,
          };
        },{SERVICE,sourceCaptureWorkspace,dependencyProbe});
      const dependencyBeforeCold=await readDependencyState();
      await sourceContext.close();sourceContext=null;
      sourceContext=await launch(sourceProfile);
      activeSourcePage=await opened(sourceContext);
      const dependencyAfterCold=await readDependencyState();
      assert.deepEqual(dependencyAfterCold,dependencyBeforeCold);
      console.log('T4_REAL_ORIGINAL_T3_DELETE_OBJECT_DEPENDENCY_POLICY_PASS',
        JSON.stringify({
          originalKernel:ORIGINAL_KERNEL,
          ...dependencyDeleteOutcome,...dependencyAfterCold,
          coldRestartReadbackSame:true,
          t4NetworkObjectDeleteEnabled:false,
          objectDeleteRetried:false,
        }));
    }finally{deltaTransport.close();}
    await sourceContext.close();sourceContext=null;
    const updatedAfterDelta=await verify(recipientPage);
    await recipientContext.close();recipientContext=null;

    for(let attempt=1;attempt<=2;attempt++){
      recipientContext=await launch(recipientProfile);
      const coldPage=await opened(recipientContext);
      assert.deepEqual(await verify(coldPage),updatedAfterDelta);
      await recipientContext.close();recipientContext=null;
    }
    assert.equal(sha(kernelRuntimePath),pinnedKernelSha);
    console.log('T4_ORIGINAL_T2_0_3_6_REAL_WEB_DAV_EXCHANGE_TWO_COLD_READS_PASS',
      JSON.stringify({originalKernel:ORIGINAL_KERNEL,contract:actual.contract,
        originalPackageBytes:actual.artifact.bytes.length,
        sha256:published.sha256,independentProfiles:2,
        recipientColdBrowserProcessRestarts:2,
        verifiedObjects:initial.objects,verifiedRelations:initial.relations,
        verifiedAssets:initial.assets,verifiedSchemas:initial.schemas,
        verifiedEvents:initial.events,verifiedAssetBytes:true,
        originalT3EventWindowPrepared:true,originalT3EventWindowSent:false,
        singleObjectDeltaOriginalKernelApplied:true,
        singleObjectDeltaAckLossIdempotencyVerified:true,
        signedCorporateNativeOwnerTested:false,installedProductTested:false,
        physicalSecondDeviceTested:false}));
  }finally{
    if(recipientContext)await recipientContext.close().catch(()=>{});
    if(sourceContext)await sourceContext.close().catch(()=>{});
    if(transport)transport.close();
    if(live?.server?.listening)await new Promise(done=>live.server.close(done));
    rmSync(root,{recursive:true,force:true});
  }
});
