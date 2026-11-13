// Real ORIGINAL T2 Runtime 0.3.6, Contract 1.3.0, actual browser IndexedDB.
// Only a disposable public integration Host and one ordinary T2 service
// registration. This does NOT certify private signer, disclosure or .iwxa.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {planOriginalT2ActivityReviewRegistration} from
  '../modules/activity-base-anonymizer/t3-owner-review-passport-registration.node.mjs';
import {T3_ACTIVITY_OWNER_REVIEW_SCHEMA} from
  '../modules/activity-base-anonymizer/t3-owner-review-stage.mjs';
import {T3_SELECTED_VIEW_SCHEMA} from
  '../modules/activity-base-anonymizer/t3-selected-host.mjs';

const core=resolve(process.env.IWXA_T3_PUBLIC_CORE_DIR??'');
const qualified=resolve(process.env.IWXA_T2_QUALIFIED_KERNEL_DIST??'');
assert.ok(process.env.IWXA_T3_PUBLIC_CORE_DIR&&
  process.env.IWXA_T2_QUALIFIED_KERNEL_DIST,
  'ACTIVITY_ORIGINAL_T2_QUALIFIED_HOST_REQUIRED');
const mod=async relative=>import(pathToFileURL(join(core,relative)).href);
const {assertQualifiedKernelArtifact}=await mod(
  'src/factory2/products/domain-completion/independent-browser-witness.mjs');
const {materializeIntegrationHost,serveRealKernelHost}=await mod(
  'scripts/real-kernel-e2e.mjs');
const requireCore=createRequire(pathToFileURL(join(core,'package.json')).href);
const {chromium}=requireCore('playwright');
const sha=value=>createHash('sha256').update(value).digest('hex');
const kernel='0.3.6',contract='1.3.0',writer='iwxa.workspace.integration';
const reviewer='iwxa.activity.reviewer',artifactId=
  'iwxa-kernel-k036-same-store-history-20261019-qualified.1';
const proofData={
  status:'OWNER_REVIEW_DRAFT',
  source_review_schema:T3_SELECTED_VIEW_SCHEMA,
  source_status:'STRUCTURE_PRESERVED_REVIEW_REQUIRED',
  semantic_mapping:'T0_T1_D2_ONLY_NOT_OCEL2_CONFORMANCE',
  reason_codes:[],
  anonymity:'NOT_ESTABLISHED',
  disclosure_status:'NOT_EVALUATED',
  export_allowed:false,
  candidate:[{
    object_type:'object_type_001',cohort_band:'3-9',
    observed_event_kinds:['event_type_001'],
    object_local_successions:[],
  }],
};

async function open(chromium,profile,origin) {
  const context=await chromium.launchPersistentContext(profile,{
    headless:true,ignoreHTTPSErrors:true,serviceWorkers:'block',
  });
  await context.route('**/*',route=>{
    if(route.request().url().startsWith(origin+'/'))return route.continue();
    return route.abort();
  });
  const page=context.pages()[0]??await context.newPage();
  await page.goto(origin+'/__t2_independent_readback__',{waitUntil:'load'});
  await page.waitForFunction(()=>typeof globalThis.IWXA?.connect==='function');
  return {context,page};
}

const oldCwd=process.cwd(),tmp=mkdtempSync(join(tmpdir(),'iwxa-activity-real-t2-'));
let server=null,browser=null;
try {
  const dist=join(tmp,'dist');mkdirSync(dist);
  cpSync(join(qualified,'_iwxa'),join(dist,'_iwxa'),{recursive:true});
  const art=assertQualifiedKernelArtifact(dist,{kernel,contract,artifactId});
  assert.equal(art.archiveSha256,
    '7075b8b9590ef1283e34ecb3c21dd9d1b7342697287e1aa150cd4f4a60860b68');
  process.chdir(core); // Original T2 host uses its own public/favicon.ico
  const host=materializeIntegrationHost(dist,'https://127.0.0.1');
  host.domain.runtime.kernel_release=kernel;
  host.domain.runtime.runtime_version=kernel;
  host.workspaceConfig.host.required_runtime_version=kernel;
  host.workspaceConfig.host.required_contract_version=contract;
  const writerFile='_iwxa/services/'+writer+'.json';
  const writerBytes=readFileSync(join(dist,writerFile));
  const catalog={contract_version:contract,count:1,entries:[{
    service_id:writer,service_version:host.passport.service_version,
    base_path:host.passport.base_path,
    supported_levels:host.passport.supported_levels,
    file:writerFile,sha256:sha(writerBytes),
  }]};
  const prepared=planOriginalT2ActivityReviewRegistration({
    domain:host.domain,catalog,controlPlane:host.controlPlane,
  });
  assert.equal(prepared.catalog.count,2);
  assert.equal(prepared.domain.modules.length,2);
  assert.equal(prepared.controlPlane.services.length,2);
  const plan2=planOriginalT2ActivityReviewRegistration({
    domain:prepared.domain,catalog:prepared.catalog,
    controlPlane:prepared.controlPlane,
  });
  assert.deepEqual(plan2,prepared);
  writeFileSync(join(dist,'_iwxa/domain.json'),JSON.stringify(prepared.domain));
  writeFileSync(join(dist,'workspace/workspace.config.json'),
    JSON.stringify(host.workspaceConfig));
  writeFileSync(join(dist,'_iwxa/security/capability-control-plane.json'),
    JSON.stringify(prepared.controlPlane));
  writeFileSync(join(dist,'_iwxa/service-catalog.json'),
    JSON.stringify(prepared.catalog));
  writeFileSync(join(dist,prepared.passport_file),prepared.passport_bytes);
  assert.equal(sha(readFileSync(join(dist,prepared.passport_file))),
    prepared.passport_sha256,'ORIGINAL_T2_PASSPORT_DIGEST_MISMATCH');
  server=await serveRealKernelHost(dist,{
    independentWitness:true,previewOrigin:true,
  });
  const source='d05-production-'+randomUUID();
  const target='activity-private-review-'+randomUUID();
  const profile=join(tmp,'original-kernel-profile');
  browser=await open(chromium,profile,server.origin);
  const first=await browser.page.evaluate(async args=>{
    const sourceWriter=await globalThis.IWXA.connect({service_id:args.writer});
    const targetReviewer=await globalThis.IWXA.connect({service_id:args.reviewer});
    if(sourceWriter.contract_version!=='1.3.0'||
      sourceWriter.runtime_version!=='0.3.6'||
      targetReviewer.contract_version!=='1.3.0'||
      targetReviewer.runtime_version!=='0.3.6')
      throw Error('ORIGINAL_T2_RUNTIME_REQUIRED');
    if(!targetReviewer.granted_operations.includes('t1.putObject')||
       targetReviewer.granted_operations.includes('t2.exportPackage')||
       targetReviewer.granted_operations.includes('t2.importCommit'))
      throw Error('REVIEWER_NOT_SCOPED_TO_PRIVATE_TYPED_WRITE');
    await sourceWriter.t1.createWorkspace({
      workspace_id:args.source,profile:'generic',
    });
    await sourceWriter.t1.createWorkspace({
      workspace_id:args.target,profile:'generic',
    });
    const sourceWrite=await sourceWriter.t1.putObject({
      workspace_id:args.source,object_id:'d05:source-bracket',
      schema_id:'iwxa.demo.note',schema_version:'1.0.0',
      base_revision:0,data:{title:'PRIVATE_CEHOVOD_CUSTOMER_BRACKET'},
      extensions:{},event:{event_type:'d05.bracket.created',payload:{}},
    });
    const emptiness=await targetReviewer.t1.listObjects({
      workspace_id:args.target,include_deleted:true,
    });
    if(emptiness.length!==0)throw Error('REVIEW_TARGET_NOT_EMPTY');
    const receipt=await targetReviewer.t1.putObject({
      workspace_id:args.target,object_id:args.objectId,
      schema_id:args.schema,schema_version:'1.0.0',
      base_revision:0,data:args.data,extensions:{},
      event:{event_type:'t3.activity.review.staged',
        payload:{status:'OWNER_REVIEW_DRAFT',
          disclosure_status:'NOT_EVALUATED'}},
    });
    const read=await targetReviewer.t1.getObject(args.target,args.objectId);
    const raw=JSON.stringify(read?.object?.data);
    if(read?.object?.revision!==1||
      read?.object?.schema_id!==args.schema||
      raw!==JSON.stringify(args.data)||
      raw.includes('PRIVATE_CEHOVOD_CUSTOMER_BRACKET'))
      throw Error('ORIGINAL_T2_PRIVATE_REVIEW_READBACK_INVALID');
    let exportDenied=false,foreignDenied=false;
    try{
      await targetReviewer.t2.exportPackage({
        workspaces:[args.target],include_history:true,
        include_relations:true,include_schemas:true,
      });
    }catch{exportDenied=true;}
    try{
      const foreign=await targetReviewer.t1.getObject(
        args.source,'d05:source-bracket');
      // The original T2 may conceal an ungranted object by returning null
      // rather than raising an exception. Both are denied disclosures.
      foreignDenied=foreign?.object==null;
    }catch{foreignDenied=true;}
    if(!exportDenied||!foreignDenied)
      throw Error('ORIGINAL_T2_PRIVATE_REVIEW_PERMISSION_LEAK_'
        +String(exportDenied)+'_'+String(foreignDenied));
    return {
      source_revision:sourceWrite.object.revision,
      source_event_id:sourceWrite.event.event_id,
      draft_revision:receipt.object.revision,
      draft_event_id:receipt.event.event_id,
      reviewer_service:targetReviewer.service.service_id,
      export_denied:exportDenied,source_denied:foreignDenied,
    };
  },{source,target,writer,reviewer,objectId:'activity-review:original-kernel',
    schema:T3_ACTIVITY_OWNER_REVIEW_SCHEMA,data:proofData});
  assert.equal(first.source_revision,1);
  assert.equal(first.draft_revision,1);
  assert.equal(first.reviewer_service,reviewer);
  assert.equal(first.export_denied,true);
  assert.equal(first.source_denied,true);
  await browser.context.close();browser=null;
  // Actual cold browser profile restart, same host origin and IndexedDB.
  browser=await open(chromium,profile,server.origin);
  const reopened=await browser.page.evaluate(async args=>{
    const sourceWriter=await globalThis.IWXA.connect({service_id:args.writer});
    const targetReviewer=await globalThis.IWXA.connect({service_id:args.reviewer});
    const sourceObject=await sourceWriter.t1.getObject(
      args.source,'d05:source-bracket');
    const draft=await targetReviewer.t1.getObject(args.target,args.objectId);
    const targetEvents=await targetReviewer.t1.listEventsSince(args.target);
    return {
      source_title:sourceObject?.object?.data?.title,
      source_revision:sourceObject?.object?.revision,
      draft_revision:draft?.object?.revision,
      draft_schema:draft?.object?.schema_id,
      draft_data:draft?.object?.data,
      event_ids:targetEvents.map(x=>x.event_id),
    };
  },{source,target,writer,reviewer,objectId:'activity-review:original-kernel'});
  assert.equal(reopened.source_title,'PRIVATE_CEHOVOD_CUSTOMER_BRACKET');
  assert.equal(reopened.source_revision,1);
  assert.equal(reopened.draft_revision,1);
  assert.equal(reopened.draft_schema,T3_ACTIVITY_OWNER_REVIEW_SCHEMA);
  assert.deepEqual(reopened.draft_data,proofData);
  assert.ok(reopened.event_ids.includes(first.draft_event_id));
  console.log('ACTIVITY_ORIGINAL_T2_REVIEW_PASSPORT_COLD_KERNEL_PASS',
    JSON.stringify({original_kernel:kernel,original_contract:contract,
      target_schema:T3_ACTIVITY_OWNER_REVIEW_SCHEMA,
      cold_readback:true,source_unchanged:true,
      denied_other_source:true,export_draft_denied:true,
      reviewer_service:reviewer}));
}finally{
  if(browser)await browser.context.close().catch(()=>{});
  if(server){
    server.server.closeAllConnections();
    await new Promise(resolve=>server.server.close(resolve));
  }
  process.chdir(oldCwd);
  rmSync(tmp,{recursive:true,force:true});
}
