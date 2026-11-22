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
    const recipientPage=await opened(recipientContext);
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
        title:object?.object?.data?.title,linkedTitle:linked?.object?.data?.title,
        linkedExtension:linked?.object?.extensions?.future?.preserve,
        assetText:asset?new TextDecoder().decode(asset.bytes):null,
        assetMime:asset?.asset?.mime??null,objects:inventory.counts.objects,
        relations:inventory.counts.relations,assets:inventory.counts.assets,
        schemas:inventory.counts.schemas,events:inventory.counts.events};
    },{SERVICE,workspaceId,objectId,linkedObjectId,assetId});
    const initial=await verify(recipientPage);
    assert.deepEqual(initial,{
      workspace:workspaceId,object:objectId,title,linkedTitle,
      linkedExtension:'yes',assetText,assetMime:'text/plain',objects:2,
      relations:1,assets:1,schemas:initial.schemas,events:initial.events,
    });
    assert.ok(initial.schemas>=1 && initial.events>=4);
    await recipientContext.close();recipientContext=null;

    for(let attempt=1;attempt<=2;attempt++){
      recipientContext=await launch(recipientProfile);
      const coldPage=await opened(recipientContext);
      assert.deepEqual(await verify(coldPage),initial);
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
