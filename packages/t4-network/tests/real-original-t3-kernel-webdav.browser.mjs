import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
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
import {createWebDavPackageTransport}
  from '../src/network/webdav-package-transfer.mjs';
import {readT4OriginalEventWindow}
  from '../src/network/original-event-window.mjs';
import {createT4OriginalObjectBacklog,publishT4OriginalObjectBacklog,
  replayT4OriginalObjectBacklog}
  from '../src/network/original-object-backlog.mjs';
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
    const activeSourcePage=await opened(sourceContext);
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
