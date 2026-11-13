// Real ORIGINAL T2 Runtime 0.3.6, Contract 1.3.0, actual browser IndexedDB.
// Only a disposable public integration Host and one ordinary T2 service
// registration. This does NOT certify private signer, disclosure or .iwxa.
import assert from 'node:assert/strict';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {planOriginalT2ActivityReviewRegistration} from
  '../modules/activity-base-anonymizer/t3-owner-review-passport-registration.node.mjs';
import {T3_ACTIVITY_OWNER_REVIEW_SCHEMA,T3_ACTIVITY_OWNER_REVIEW_DECLARATION} from
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
const {createTemporaryOriginalPersonalAuthority}=await mod(
  'tests/support/t3-original-personal-authority.mjs');
const {createOriginalControlHttpHandler}=await mod(
  'src/t3/original-control-http-handler.mjs');
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
let server=null,browser=null,handler=null;
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
  // Trusted ordinary T2 Host service has both source and derived data types;
  // the independent reviewer passport remains write-only-for-its-own-schema
  // and explicitly cannot export. No second Kernel/Store/Exchange.
  host.passport.input_object_types.push(T3_ACTIVITY_OWNER_REVIEW_SCHEMA);
  host.passport.output_object_types.push(T3_ACTIVITY_OWNER_REVIEW_SCHEMA);
  host.passport.schemas[T3_ACTIVITY_OWNER_REVIEW_SCHEMA]=
    T3_ACTIVITY_OWNER_REVIEW_DECLARATION;
  host.passport.permissions.objects.read.push(T3_ACTIVITY_OWNER_REVIEW_SCHEMA);
  host.passport.permissions.objects.write.push(T3_ACTIVITY_OWNER_REVIEW_SCHEMA);
  const writerFile='_iwxa/services/'+writer+'.json';
  writeFileSync(join(dist,writerFile),JSON.stringify(host.passport));
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
  // Stage ORIGINAL T3 D1/D2 browser modules and Activity Host composition
  // into the same temporary original T2 Host; no new runtime or server.
  const t3Files=['index.mjs','subject-access-binding.mjs',
    'signed-access-host-port.mjs','local-inference-draft.mjs',
    'control-loopback-owner.mjs'];
  mkdirSync(join(dist,'_t3','activity'),{recursive:true});
  for(const name of t3Files)cpSync(join(core,'src/t3',name),join(dist,'_t3',name));
  for(const name of ['index.mjs','kernel-reader.mjs']){
    cpSync(join(core,'src/t3/activity',name),join(dist,'_t3/activity',name));
  }
  const actFiles=['t3-selected-host.mjs','t3-control-host-link.mjs',
    't3-owner-review-stage.mjs','t3-review-controller.mjs',
    't3-original-t2-owner-host.mjs'];
  mkdirSync(join(dist,'_activity'),{recursive:true});
  for(const name of actFiles)cpSync(join(oldCwd,'modules/activity-base-anonymizer',name),
    join(dist,'_activity',name));
  const source='d05-production-'+randomUUID();
  const target='activity-private-review-'+randomUUID();
  const signedTarget='activity-signed-review-'+randomUUID();
  const token=randomBytes(32).toString('base64url');
  const listen=new Set();
  let contextEpoch=1;
  server=await serveRealKernelHost(dist,{
    independentWitness:true,previewOrigin:true,
    controlHandler:async(req,res)=>handler?handler(req,res):false,
  });
  const readOps=['t1.getWorkspace','t1.listObjects','t1.getObject',
    't1.listEventsSince'];
  const deriveOps=['t1.getWorkspace','t1.listObjects','t1.getObject',
    't1.putObject'];
  const sourceAuthority=createTemporaryOriginalPersonalAuthority({
    workspaceId:source,now:Date.now(),clock:Date.now,
    purpose:'activity.analysis',operations:readOps,
    operationActions:Object.fromEntries(readOps.map(op=>[op,'activity.read'])),
  });
  const targetAuthority=createTemporaryOriginalPersonalAuthority({
    workspaceId:signedTarget,now:Date.now(),clock:Date.now,
    purpose:'activity.derivation',operations:deriveOps,
    operationActions:Object.fromEntries(deriveOps.map(op=>[op,'activity.derive'])),
  });
  handler=createOriginalControlHttpHandler({
    origin:server.origin,token,
    currentEpoch:()=>contextEpoch,
    subscribeInvalidation:fn=>{listen.add(fn);return()=>listen.delete(fn);},
    ownerFor:({scope,operation})=>scope!=='activity'?null:
      operation==='activity.read'?sourceAuthority.access:
        operation==='activity.derive'?targetAuthority.access:null,
  });
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
    await sourceWriter.t1.createWorkspace({
      workspace_id:args.signedTarget,profile:'generic',
    });
    const sourceWrite=await sourceWriter.t1.putObject({
      workspace_id:args.source,object_id:'d05:source-bracket',
      schema_id:'iwxa.demo.note',schema_version:'1.0.0',
      base_revision:0,data:{title:'PRIVATE_CEHOVOD_CUSTOMER_BRACKET'},
      extensions:{},event:{event_type:'d05.bracket.created',payload:{}},
    });
    for(let index=1;index<3;index++){
      await sourceWriter.t1.putObject({
        workspace_id:args.source,object_id:'d05:source-bracket-'+index,
        schema_id:'iwxa.demo.note',schema_version:'1.0.0',
        base_revision:0,
        data:{title:'PRIVATE_CEHOVOD_CUSTOMER_BRACKET_'+index},
        extensions:{},event:{event_type:'d05.bracket.created',payload:{}},
      });
    }
    // A real process requires observed succession, not just object creation:
    // three separate sample brackets undergo four original Kernel writes.
    // Synthetic industrial input, NOT the production 120-bracket CASE-001.
    const phases=['cut','bent','inspected'];
    const ids=['d05:source-bracket','d05:source-bracket-1',
      'd05:source-bracket-2'];
    for(let index=0;index<ids.length;index++){
      for(let step=0;step<phases.length;step++){
        // Original T2 events use millisecond timestamps. Ensure the test
        // does not invent ordering from multiple writes in the same ms.
        await new Promise(done=>setTimeout(done,8));
        const saved=await sourceWriter.t1.putObject({
          workspace_id:args.source,object_id:ids[index],
          schema_id:'iwxa.demo.note',schema_version:'1.0.0',
          base_revision:step+1,
          data:{title:'PRIVATE_CEHOVOD_CUSTOMER_BRACKET'+
            (index?'_'+index:'')},
          extensions:{},event:{event_type:'d05.bracket.'+phases[step],
            payload:{}},
        });
        if(saved?.object?.revision!==step+2)
          throw Error('REAL_T2_PRODUCTION_PHASE_RECEIPT_INVALID');
      }
    }
    const sourceObjects=await sourceWriter.t1.listObjects({
      workspace_id:args.source,include_deleted:true,
    });
    const sourceEvents=await sourceWriter.t1.listEventsSince(args.source);
    if(sourceObjects.length!==3||
      !sourceObjects.every(row=>row.revision===4)||
      sourceEvents.length!==13)
      throw Error('REAL_T2_PRODUCTION_PROCESS_HISTORY_MISSING');
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
  },{source,target,signedTarget,writer,reviewer,objectId:'activity-review:original-kernel',
    schema:T3_ACTIVITY_OWNER_REVIEW_SCHEMA,data:proofData});
  assert.equal(first.source_revision,1);
  assert.equal(first.draft_revision,1);
  assert.equal(first.reviewer_service,reviewer);
  assert.equal(first.export_denied,true);
  assert.equal(first.source_denied,true);
  // Full SAME-host signed D1 Activity Read and separate signed Derive over
  // one REAL original T2 Kernel facade, with one selected source Workspace.
  // No synthetic authorize callback, no second Store, no separate Control EXE.
  const signed=await browser.page.evaluate(async args=>{
    const {createControlLoopbackOwner}=await import('/_t3/control-loopback-owner.mjs');
    const {createSubjectKernelBinding,readActivityFromWorkspaceContext}=
      await import('/_t3/index.mjs');
    const {openActivityFromOriginalT2Host}=
      await import('/_activity/t3-original-t2-owner-host.mjs');
    const {createT3ReviewController}=
      await import('/_activity/t3-review-controller.mjs');
    const session=await globalThis.IWXA.connect({service_id:args.writer});
    const selected=Object.freeze({workspace_id:args.source});
    const selectedListeners=new Set();
    const currentWorkspace=Object.freeze({
      get:()=>selected,
      subscribe:fn=>{selectedListeners.add(fn);return()=>selectedListeners.delete(fn);},
    });
    const control=createControlLoopbackOwner({
      origin:location.origin,token:args.token,
    });
    const bound=await openActivityFromOriginalT2Host({
      session,control,currentWorkspace,bindings:{
        objects:[{schema_id:'iwxa.demo.note',schema_version:'1.0.0',
          semantic_kind:'Process'}],
        events:['created','cut','bent','inspected'].map(phase=>({
          event_type:'d05.bracket.'+phase,semantic_kind:'Event',
        })),
        context_events:['workspace.created'],
        relations:[],
      },readActivityFromWorkspaceContext,createSubjectKernelBinding,
    });
    const updates=[];
    const ui=createT3ReviewController({
      host:bound.port,onUpdate:x=>updates.push(x),
    });
    try{
      if(Object.hasOwn(bound.port,'kernel')||
        Object.hasOwn(bound.port,'sourceSignedAccess')||
        Object.hasOwn(bound.port,'targetSignedAccess')||
        !Object.hasOwn(bound.port,'stageSelected'))
        throw Error('ORIGINAL_T3_SIGNED_PORT_NOT_NARROW');
      const read=await ui.readSelected();
      if(read.status!=='REVIEW')throw Error('ORIGINAL_T3_SIGNED_READ_'+read.status+
        '_'+String(updates.at(-1)?.code??''));
      const snapshot=updates.at(-1)?.review;
      if(!snapshot||snapshot.export_allowed!==false||
        snapshot.status!=='STRUCTURE_PRESERVED_REVIEW_REQUIRED'||
        snapshot.structural_candidate?.length!==1||
        snapshot.structural_candidate[0].observed_event_kinds.length!==4||
        snapshot.structural_candidate[0].object_local_successions.length!==3||
        snapshot.structural_candidate[0].cohort_band!=='3-9'||
        !snapshot.structural_candidate[0].object_local_successions.every(
          step=>step.cohort_band==='3-9'&&
            step.relation==='OBSERVED_OBJECT_LOCAL_ORDER_NOT_CAUSAL_DEPENDENCY')||
        JSON.stringify(snapshot).includes('PRIVATE_CEHOVOD_CUSTOMER'))
        throw Error('ORIGINAL_T3_D2_OBSERVED_FOUR_STEP_PROCESS_UNVERIFIED');
      const staged=await ui.stageSelected();
      if(staged.status!=='STAGED')
        throw Error('ORIGINAL_T3_SIGNED_DERIVE_'+staged.status+
          '_'+String(updates.at(-1)?.code??''));
      const targetObjects=await session.t1.listObjects({
        workspace_id:args.signedTarget,include_deleted:true,
      });
      if(targetObjects.length!==1||targetObjects[0]?.schema_id!==args.schema||
        targetObjects[0]?.data?.anonymity!=='NOT_ESTABLISHED'||
        targetObjects[0]?.data?.export_allowed!==false||
        JSON.stringify(targetObjects).includes('PRIVATE_CEHOVOD_CUSTOMER'))
        throw Error('ORIGINAL_T3_SIGNED_DRAFT_NOT_PERSISTED');
      const events=await session.t1.listEventsSince(args.signedTarget);
      const stagedEvent=events.find(e=>e.event_type==='t3.activity.review.staged');
      if(!stagedEvent)throw Error('ORIGINAL_T3_SIGNED_EVENT_NOT_PERSISTED');
      return {status:staged.status,source_review:snapshot.status,
        source_reason_codes:[...snapshot.reason_codes],
        observed_step_types:snapshot.structural_candidate[0].observed_event_kinds.length,
        observed_successions:snapshot.structural_candidate[0].object_local_successions.length,
        draft_revision:targetObjects[0].revision,
        draft_object_id:targetObjects[0].object_id,
        event_id:stagedEvent.event_id,
        renderer_no_private_content:true,
        narrow_host_keys:Object.keys(bound.port),
        original_service:session.service.service_id,
      };
    } finally {
      ui.dispose();bound.dispose();
      if(selectedListeners.size!==0)
        throw Error('ORIGINAL_T3_HOST_SELECTION_LISTENER_LEAK');
    }
  },{source,signedTarget,writer,token,schema:T3_ACTIVITY_OWNER_REVIEW_SCHEMA});
  assert.equal(signed.status,'STAGED');
  assert.equal(signed.source_review,'STRUCTURE_PRESERVED_REVIEW_REQUIRED');
  assert.equal(signed.observed_step_types,4);
  assert.equal(signed.observed_successions,3);
  assert.deepEqual(signed.source_reason_codes.sort(),[
    'EXTERNAL_LINKAGE_RISK_UNMEASURED',
    'T3_SIGNED_OWNER_RESULT_NOT_INDEPENDENTLY_ATTESTED',
    'OCEL2_FULL_CONFORMANCE_NOT_ESTABLISHED',
    'T3_D2_SYSTEM_CONTEXT_EXCLUDED',
  ].sort());
  assert.equal(signed.draft_revision,1);
  assert.equal(signed.original_service,writer);
  assert.ok(signed.narrow_host_keys.includes('stageSelected'));
  assert.equal(sourceAuthority.proofCount>0,true);
  assert.equal(targetAuthority.proofCount>0,true);

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
    const signedDraft=await sourceWriter.t1.getObject(
      args.signedTarget,args.signedObjectId);
    const signedEvents=await sourceWriter.t1.listEventsSince(args.signedTarget);
    return {
      source_title:sourceObject?.object?.data?.title,
      source_revision:sourceObject?.object?.revision,
      draft_revision:draft?.object?.revision,
      draft_schema:draft?.object?.schema_id,
      draft_data:draft?.object?.data,
      event_ids:targetEvents.map(x=>x.event_id),
      signed_draft_revision:signedDraft?.object?.revision,
      signed_draft_data:signedDraft?.object?.data,
      signed_event_ids:signedEvents.map(x=>x.event_id),
    };
  },{source,target,signedTarget,writer,reviewer,
    signedObjectId:signed.draft_object_id,
    objectId:'activity-review:original-kernel'});
  assert.equal(reopened.source_title,'PRIVATE_CEHOVOD_CUSTOMER_BRACKET');
  assert.equal(reopened.source_revision,4);
  assert.equal(reopened.draft_revision,1);
  assert.equal(reopened.draft_schema,T3_ACTIVITY_OWNER_REVIEW_SCHEMA);
  assert.deepEqual(reopened.draft_data,proofData);
  assert.ok(reopened.event_ids.includes(first.draft_event_id));
  assert.equal(reopened.signed_draft_revision,1);
  assert.equal(reopened.signed_draft_data?.export_allowed,false);
  assert.equal(reopened.signed_draft_data?.anonymity,'NOT_ESTABLISHED');
  assert.ok(reopened.signed_event_ids.includes(signed.event_id));
  console.log('ACTIVITY_REAL_SIGNED_T3_READ_DERIVE_ORIGINAL_T2_COLD_PASS',
    JSON.stringify({signed:'ED25519_PERSONAL',
      signedReadProofs:sourceAuthority.proofCount,
      signedDeriveProofs:targetAuthority.proofCount,
      sameOriginalT2Store:true,selectedWorkspaceStores:1,
      coldReadback:true,sourceUnchanged:true,
      sourceReview:signed.source_review,
      observedStepTypes:signed.observed_step_types,
      observedSuccessions:signed.observed_successions,
      safeReasonCodes:signed.source_reason_codes,
      rendererNoPrivateContent:true,externalTransferAccepted:false}));
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
