// Public source qualification only: genuine original private signed owner,
 // original qualified T2 0.3.6, and actual Center candidate's read-only adapter.
 // The isolated fixture follows the existing original-owner source regression:
 // test vault passphrase and explicit source-only Human choices, NOT installed
 // Windows DPAPI, independent employee GUI, or whole-product acceptance.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {materializeIntegrationHost,serveRealKernelHost} from '../scripts/real-kernel-e2e.mjs';
import {assertQualifiedKernelArtifact} from '../src/factory2/products/domain-completion/independent-browser-witness.mjs';
import {createSignedAccessHostPort} from '../src/t3/signed-access-host-port.mjs';
import {createTrustedReconciliationKernelApply} from '../src/t3/reconciliation-kernel-apply.mjs';
const SERVICE='iwxa.workspace.integration';
const REGISTRY='iwxa.t3.access.signed-registry';
const APPLIED='iwxa.admin.applied-results';
const ARTIFACT='iwxa-kernel-k036-same-store-history-20261019-qualified.1';
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const write=(base,path,content)=>{
 const full=join(base,...path.split('/'));
 mkdirSync(join(full,'..'),{recursive:true});writeFileSync(full,content);return full;
};
const prior=process.cwd();
let root=null,live=null,browser=null,owner=null,admin=null,control=null;
let phase='INPUTS';
try{
 assert.equal(process.argv.length,5);
 const t3=resolve(process.argv[2]),center=resolve(process.argv[3]),qualified=resolve(process.argv[4]);
 assert.ok(existsSync(join(qualified,'_iwxa/runtime/0.3.6/runtime.js')));
 const [{provision,I},{openInterop},{createOriginalAdminD3HostPort},{readOriginalAppliedResult,originalResultTaskText}]=await Promise.all([
  import(pathToFileURL(join(t3,'interop/provision.mjs')).href),
  import(pathToFileURL(join(t3,'interop/runtime.mjs')).href),
  import(pathToFileURL(join(t3,'interop/native-admin-d3.mjs')).href),
  import(pathToFileURL(join(center,'runtime/cen03-d3-owner.mjs')).href),
 ]);
 process.chdir(join(prior,'packages/t3-core'));
 root=mkdtempSync(join(tmpdir(),'iwxa-center-reuse-real-t2-'));
 const dist=join(root,'dist'),profile=join(root,'profile');
 const adminRoot=join(root,'admin'),controlRoot=join(root,'control');
 const NOW=Date.now(),passphrase='ephemeral-original-signed-source-test';
 const identity={...I,person:I.reviewer};
 const productionWs=identity.workspace,productionOrg=identity.org;
 mkdirSync(dist,{recursive:true});
    cpSync(join(qualified,'_iwxa'),join(dist,'_iwxa'),{recursive:true});
    assertQualifiedKernelArtifact(dist,{kernel:'0.3.6',
      contract:'1.3.0',artifactId:ARTIFACT});
    phase='REAL_T2_HOST';
    live=await serveRealKernelHost(dist);
    const config=materializeIntegrationHost(dist,live.origin);
    config.domain.runtime.kernel_release='0.3.6';
    config.domain.runtime.runtime_version='0.3.6';
    config.workspaceConfig.host.required_runtime_version='0.3.6';
    config.workspaceConfig.host.required_contract_version='1.3.0';
    for(const schema of [REGISTRY,APPLIED]){
      config.domain.security.allowed_object_classes.push(schema);
      config.passport.input_object_types.push(schema);
      config.passport.output_object_types.push(schema);
      config.passport.permissions.objects.read.push(schema);
      config.passport.permissions.objects.write.push(schema);
      config.passport.schemas[schema]={
        schema_version:'1.0.0',preserve_unknown:true,
        json_schema:{type:'object'},embedded:{},
      };
    }
    config.passport.schemas[APPLIED].json_schema={
      type:'object',properties:{schema:{const:'IWXA_T3_ADMIN_APPLIED_RESULTS/1'}},
    };
    config.passport.permissions.operations=['t1.commitObjectGraph'];
    write(dist,'_iwxa/domain.json',JSON.stringify(config.domain));
    write(dist,'workspace/workspace.config.json',
      JSON.stringify(config.workspaceConfig));
    const filename='_iwxa/services/'+SERVICE+'.json';
    const passport=write(dist,filename,JSON.stringify(config.passport));
    write(dist,'_iwxa/service-catalog.json',JSON.stringify({
      count:1,entries:[{service_id:SERVICE,
        service_version:config.passport.service_version,
        base_path:config.passport.base_path,
        supported_levels:config.passport.supported_levels,
        file:filename,sha256:hash(passport)}],
    }));
    write(dist,'workspace/index.html',
      '<!doctype html><title>IWXA original T2 Kernel</title>'+
      '<script src="/_iwxa/loader.js"></script>');
    const launch=()=>chromium.launchPersistentContext(profile,{
      channel:'msedge',headless:true,ignoreHTTPSErrors:true,
    });
    browser=await launch();
    let page=await browser.newPage();
    await page.goto(live.origin+'/workspace/');
    await page.waitForFunction(()=>typeof window.IWXA?.connect==='function');
    const granted=await page.evaluate(async SERVICE=>{
      const s=await IWXA.connect({service_id:SERVICE});
      return {contract_version:s.contract_version,
        runtime_version:s.runtime_version,
        granted_operations:s.granted_operations};
    },SERVICE);
    assert.equal(granted.contract_version,'1.3.0');
    assert.equal(granted.runtime_version,'0.3.6');
    for(const id of ['t1.createWorkspace','t1.commitObjectGraph',
      't1.getWorkspace','t1.getObject','t1.listEventsSince'])
      assert.ok(granted.granted_operations.includes(id),
        'G4_REAL_T2_GRAPH_OPERATION_NOT_GRANTED');
    await page.evaluate(async({serviceId,workspaceId})=>{
      const s=await IWXA.connect({service_id:serviceId});
      await s.t1.createWorkspace({workspace_id:workspaceId,profile:'generic'});
    },{serviceId:SERVICE,workspaceId:productionWs});
    const facade={
      sessionInfo:{contract_version:'1.3.0',runtime_version:'0.3.6',
        service_id:SERVICE},
      hasOperation:id=>granted.granted_operations.includes(id),
      getWorkspace:workspaceId=>page.evaluate(async({serviceId,workspaceId})=>{
        const s=await IWXA.connect({service_id:serviceId});
        return s.t1.getWorkspace(workspaceId);
      },{serviceId:SERVICE,workspaceId}),
      getObject:(workspaceId,objectId)=>page.evaluate(
        async({serviceId,workspaceId,objectId})=>{
          const s=await IWXA.connect({service_id:serviceId});
          try{return await s.t1.getObject(workspaceId,objectId);}
          catch(e){
            if(e?.code==='OBJECT_NOT_FOUND')return null;
            throw e;
          }
        },{serviceId:SERVICE,workspaceId,objectId}),
      listEventsSince:(workspaceId,since)=>page.evaluate(
        async({serviceId,workspaceId,since})=>{
          const s=await IWXA.connect({service_id:serviceId});
          return s.t1.listEventsSince(workspaceId,since);
        },{serviceId:SERVICE,workspaceId,since}),
      commitObjectGraph:input=>page.evaluate(
        async({serviceId,input})=>{
          const s=await IWXA.connect({service_id:serviceId});
          return s.t1.commitObjectGraph(input);
        },{serviceId:SERVICE,input}),
    };

    phase='SIGNED_SOURCE_PROVISION';
    provision({adminRoot,controlRoot,passphrase,identity,environment:'PRODUCTION',now:NOW});
    writeFileSync(join(adminRoot,'operators.json'),JSON.stringify({
      schema:'IWXA_T3_LOCAL_ORGANIZATIONAL_OPERATORS/1',
      custody:'WINDOWS_DPAPI_CURRENT_USER',productionActivation:true,
      operators:[
        {id:'issuer',name:'Issuer',personId:identity.reviewer,keyId:identity.issuer,
         vault:'vault.json',adminGrantId:'grant:admin'},
        {id:'reviewer',name:'Reviewer',personId:identity.reviewer,keyId:identity.reviewKey,
         vault:'vault.json',acceptanceGrantId:'grant:review'}
      ],
    }),{flag:'wx'});
    const openAdmin=()=>openInterop({root:adminRoot,product:'admin',passphrase,clock:()=>NOW});
    admin=openAdmin();
    control=openInterop({root:controlRoot,product:'control',passphrase,clock:()=>NOW});
    admin.selectOperator('issuer');
    const invitation=admin.invite();
    admin.selectOperator('reviewer');
    control.importInvite(invitation);
    control.selectContext('ORGANIZATION');
    const originalTaskText='Проверить качество комплектации заказа';
    const resultText='Комплект из 12 деталей соответствует спецификации. '+('Проверена маркировка и документация. '.repeat(20));
    control.receiveTask(admin.createTask(originalTaskText));
    control.prepare(resultText);
    const carrier=control.exportResult(control.previewExport().previewDigest);
    let expectedReview=null,expectedApply=null,reviewCount=0,applyCount=0,writeCount=0;
    // Count dispatches without replacing the real T2 Kernel or any write.
    const observedKernel={...facade,commitObjectGraph:async input=>{
      writeCount++;return facade.commitObjectGraph(input);
    }};
    const openHost=()=>createOriginalAdminD3HostPort({
      runtime:admin,kernel:observedKernel,createSignedAccessHostPort,
      createTrustedReconciliationKernelApply,currentHostEpoch:()=>1,
      confirmHumanReview:async details=>{
        if(!expectedReview||details.decision!=='ACCEPT'||
           details.operationId!==expectedReview.operationId||
           details.packageSha256!==expectedReview.packageSha256||
           details.previewDigest!==expectedReview.previewDigest)return false;
        expectedReview=null;reviewCount++;return true;
      },
      confirmSeparateApply:async details=>{
        if(!expectedApply||details.acceptanceId!==expectedApply.acceptanceId||
           JSON.stringify(details.revisionIds)!==JSON.stringify(expectedApply.revisionIds)||
           details.target?.workspaceId!==productionWs||
           details.target?.subjectId!==productionOrg)return false;
        expectedApply=null;applyCount++;return true;
      },
    });
    owner=openHost();
    let snap=owner.nativeState().view.snapshot;
    let binding={organizationId:productionOrg,workspaceId:productionWs,
      actorId:snap.actorId,contextId:snap.contextId,contextEpoch:snap.contextEpoch};
    const execute=async(operation,input={})=>(await owner.nativeAction({
      organizationId:productionOrg,operation,input,binding})).result;
    const session={organizationId:productionOrg,workspaceId:productionWs};
    phase='SIGNED_ACCEPT';
    const received=await owner.port.receive(carrier);
    const preview=received.preview;
    assert.equal(received.acceptanceState,'NOT_ACCEPTED');
    assert.equal(preview.resultInspection.taskCatalogVerified,true);
    const reviewId='review:reuse-'+randomUUID();
    expectedReview={operationId:reviewId,packageSha256:preview.packageSha256,
      previewDigest:preview.previewDigest};
    const accepted=await execute('d3Decide',{...expectedReview,decision:'ACCEPT'});
    assert.equal(accepted.acceptanceState,'ACCEPTED');
    assert.equal(accepted.kernelApplication,'NOT_APPLIED');
    assert.equal(reviewCount,1);
    assert.equal(writeCount,0);
    const source={...session,taskId:preview.resultInspection.taskId,
      taskRevisionId:preview.resultInspection.taskRevisionId,
      resultRevisionId:preview.resultInspection.resultRevisionId,
      acceptanceId:accepted.receipt.acceptanceId};
    const selection={acceptanceId:source.acceptanceId,revisionIds:[source.resultRevisionId]};
    phase='BEFORE_APPLY_REFUSAL';
    await assert.rejects(()=>readOriginalAppliedResult(execute,session,source),
      /CEN_D3_REUSE_ORIGINAL_RESULT_NOT_CONFIRMED/);
    assert.equal(applyCount,0);assert.equal(writeCount,0);
    console.log('CENTER_ORIGINAL_REUSE_ACCEPT_WITHOUT_APPLY_REFUSED_PASS');
    phase='REAL_T2_APPLY';
    const candidate=await execute('d3InspectAccepted',selection);
    expectedApply=selection;
    const applied=await execute('d3ApplyAccepted',{...selection,target:candidate.target});
    assert.equal(applied.kernelWriteReadback,'CONFIRMED');
    assert.equal(writeCount,1);assert.equal(applyCount,1);
    phase='REAL_T2_REUSE';
    const actual=await readOriginalAppliedResult(execute,session,source);
    assert.deepEqual(actual.source,source);assert.equal(actual.result,resultText);
    assert.equal(actual.effectKey,applied.originalEventReadback.idempotency_key);
    assert.equal(writeCount,1);assert.equal(applyCount,1);
    const nextText=originalResultTaskText('Согласовать отгрузку',source);
    assert.ok(nextText.includes(source.resultRevisionId));
    assert.ok(nextText.includes(source.acceptanceId));
    console.log('CENTER_ORIGINAL_REUSE_REAL_T2_OBJECT_EVENT_PASS');
    phase='COLD_OWNER_AND_T2';
    owner.close();owner=null;admin.close();admin=null;
    await browser.close();browser=null;
    browser=await launch();page=await browser.newPage();
    await page.goto(live.origin+'/workspace/');
    await page.waitForFunction(()=>typeof window.IWXA?.connect==='function');
    admin=openAdmin();admin.selectOperator('reviewer');owner=openHost();
    snap=owner.nativeState().view.snapshot;
    binding={organizationId:productionOrg,workspaceId:productionWs,
      actorId:snap.actorId,contextId:snap.contextId,contextEpoch:snap.contextEpoch};
    const cold=await readOriginalAppliedResult(execute,session,source);
    assert.deepEqual(cold,actual);
    assert.equal(writeCount,1);assert.equal(applyCount,1);
    const events=await facade.listEventsSince(productionWs);
    assert.equal(events.filter(e=>e.idempotency_key===actual.effectKey&&
      e.event_type==='iwxa.admin.result.applied').length,1);
    console.log('CENTER_ORIGINAL_REUSE_COLD_READ_ONLY_SINGLE_EVENT_PASS');
    phase='CONTINUED_SIGNED_TASK';
    const created=await execute('d3CreateTask',{taskId:'task:continuation-'+randomUUID(),task:nextText});
    assert.equal(created.status,'SIGNED_TASK_CREATED_NOT_DELIVERED');
    assert.equal(writeCount,1);assert.equal(applyCount,1);
    console.log('CENTER_ORIGINAL_REUSE_CONTINUED_TASK_SIGNED_SOURCE_PASS');
    console.log('CENTER_ORIGINAL_APPLIED_REUSE_SOURCE_QUALIFICATION_PASS');
}catch(error){
 const raw=typeof error?.code==='string'?error.code:error?.message;
 const code=typeof raw==='string'&&/^[A-Z][A-Z0-9_]{4,99}$/.test(raw)?raw:
   error?.code==='ERR_ASSERTION'?'ERR_ASSERTION':'UNCLASSIFIED';
 console.error('CENTER_ORIGINAL_REUSE_FAILURE_PHASE '+phase);
 console.error('CENTER_ORIGINAL_REUSE_FAILURE_CODE '+code);
 process.exitCode=1;
}finally{
 try{owner?.close()}catch{}
 try{admin?.close()}catch{}
 try{control?.close()}catch{}
 try{await browser?.close()}catch{}
 if(live?.server?.listening){
   live.server.closeAllConnections();
   await new Promise(resolve=>live.server.close(resolve));
 }
 process.chdir(prior);
 if(root)try{rmSync(root,{recursive:true,force:true})}catch{}
}
