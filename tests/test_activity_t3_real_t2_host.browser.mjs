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
import {T3_ACTIVITY_OWNER_REVIEW_SCHEMA} from
  '../modules/activity-base-anonymizer/t3-owner-review-stage.mjs';
import {T3_SELECTED_VIEW_SCHEMA} from
  '../modules/activity-base-anonymizer/t3-selected-host.mjs';
import {createCehovodD05T3Bindings} from
  '../modules/activity-base-anonymizer/d05-t3-evidence-binding.mjs';

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
const reviewer='iwxa.activity.reviewer',
  d05Service='iwxa.activity.d05.witness',artifactId=
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
  // Product source service can read/write ONLY its own domain types.
  // Typed Activity review is an independently registered original T2
  // service, not an extra power silently grafted onto the writer passport.
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
  // Isolated ORIGINAL T2 test-only service, not the private CehoVod Host.
  // Write permission belongs to this exact normal T2 service passport,
  // never to Activity or the original workspace writer.
  const sourceProfile=createCehovodD05T3Bindings();
  const kinds=['production-order','production-execution','quality-check-result','operation-route','quality-plan','quality-check-template'];
  const d05Schemas=kinds.map(kind=>{
    const bound=sourceProfile.objects.find(x=>
      x.schema_id==='ru.5ibs.productionops.'+kind);
    assert.ok(bound&&bound.schema_version==='1.0.0');
    return bound.schema_id;
  });
  const d05Path='/workspace/activity-d05-witness/';
  const d05Passport={
    service_id:d05Service,service_version:'1.0.0',
    base_path:d05Path,supported_levels:['T0','T1','T2'],
    input_object_types:[],output_object_types:d05Schemas,
    schemas:Object.fromEntries(d05Schemas.map(schema=>[schema,{
      schema_version:'1.0.0',preserve_unknown:true,
      json_schema:{type:'object'},embedded:{},
    }])),
    permissions:{
      workspace:{list:false,read:true,create:false,soft_delete:false,
        restore:false,purge:false},
      objects:{read:d05Schemas,write:d05Schemas,delete:[]},
      events:{read_scope:'service'},
      packages:{export:false,import:false,
        export_scope:'readable_objects',import_scope:'writable_objects'},
      // This graph operation is granted only when explicitly listed in
      // the NORMAL original CehoVod T2 service passport. Object write alone
      // does not confer t1.commitObjectGraph.
      operations:['t1.commitObjectGraph'],
    },
  };
  const d05File='_iwxa/services/'+d05Service+'.json';
  const d05Bytes=JSON.stringify(d05Passport);
  const d05Entry={service_id:d05Service,service_version:'1.0.0',
    base_path:d05Path,supported_levels:['T0','T1','T2'],
    file:d05File,sha256:sha(d05Bytes)};
  const withD05Domain={...prepared.domain,
    modules:[...prepared.domain.modules,
      {service_id:d05Service,base_path:d05Path}],
    security:{...prepared.domain.security,
      allowed_object_classes:[
        ...prepared.domain.security.allowed_object_classes,...d05Schemas,
      ]},
  };
  const withD05Catalog={...prepared.catalog,
    entries:[...prepared.catalog.entries,d05Entry],
    count:prepared.catalog.count+1};
  const withD05Control={...prepared.controlPlane,
    services:[...prepared.controlPlane.services,{
      schema_version:'0.3.1',service_id:d05Service,
      capability_control:'NONE',capability_ceiling:[],
      activation_any_of:[],operation_guards:[],
    }]};
  writeFileSync(join(dist,d05File),d05Bytes);
  assert.equal(sha(readFileSync(join(dist,d05File))),d05Entry.sha256);
  writeFileSync(join(dist,'_iwxa/domain.json'),JSON.stringify(withD05Domain));
  writeFileSync(join(dist,'workspace/workspace.config.json'),
    JSON.stringify(host.workspaceConfig));
  writeFileSync(join(dist,'_iwxa/security/capability-control-plane.json'),
    JSON.stringify(withD05Control));
  writeFileSync(join(dist,'_iwxa/service-catalog.json'),
    JSON.stringify(withD05Catalog));
  writeFileSync(join(dist,prepared.passport_file),prepared.passport_bytes);
  assert.equal(sha(readFileSync(join(dist,prepared.passport_file))),
    prepared.passport_sha256,'ORIGINAL_T2_PASSPORT_DIGEST_MISMATCH');
  // Stage ORIGINAL T3 D1/D2 browser modules and Activity Host composition
  // into the same temporary original T2 Host; no new runtime or server.
  // T3 0.3.0 intentionally exports native-only owner modules (including
  // node:crypto) from its Node entry. The raw Node index is NOT a browser
  // module. Build a browser test entry with the ORIGINAL D2 function body
  // taken verbatim from this exact pinned source; do not implement D2 again
  // or pull native signing/issuer code into the browser.
  const originalIndex=readFileSync(join(core,'src/t3/index.mjs'),'utf8');
  const functionStart='function contextError(code) {';
  const functionEnd="export { createSubjectKernelBinding } from './subject-access-binding.mjs';";
  const from=originalIndex.indexOf(functionStart);
  const to=originalIndex.indexOf(functionEnd,from);
  assert.ok(from>0&&to>from&&originalIndex.indexOf(functionStart,from+1)<0&&
    originalIndex.indexOf(functionEnd,to+1)<0&&
    originalIndex.slice(from,to).includes(
      'export async function readActivityFromWorkspaceContext('),
    'RELEASED_T3_ORIGINAL_D2_SOURCE_LAYOUT_CHANGED');
  const originalD2=originalIndex.slice(from,to);
  const browserD2=[
    'import {readActivityFromT2Host} from "./activity/kernel-reader.mjs";',
    'import {createSubjectKernelBinding} from "./subject-access-binding.mjs";',
    originalD2,
    'export {createSubjectKernelBinding} from "./subject-access-binding.mjs";',
  ].join('\n');
  mkdirSync(join(dist,'_t3','activity'),{recursive:true});
  writeFileSync(join(dist,'_t3/index.mjs'),browserD2);
  for(const name of ['subject-access-binding.mjs','control-loopback-owner.mjs']){
    cpSync(join(core,'src/t3',name),join(dist,'_t3',name));
  }
  for(const name of ['index.mjs','kernel-reader.mjs']){
    cpSync(join(core,'src/t3/activity',name),join(dist,'_t3/activity',name));
  }
  const actFiles=['d05-t3-evidence-binding.mjs','d05-route-host.mjs','d05-route-comparison.mjs','engine.mjs','t3-evidence-passport.mjs','t3-transition-map.mjs','graph-order.mjs','t3-selected-host.mjs',
    't3-control-host-link.mjs',
    't3-owner-review-stage.mjs','t3-review-controller.mjs',
    't3-original-t2-owner-host.mjs'];
  mkdirSync(join(dist,'_activity'),{recursive:true});
  for(const name of actFiles)cpSync(join(oldCwd,'modules/activity-base-anonymizer',name),
    join(dist,'_activity',name));
  const source='d05-production-'+randomUUID();
  const target='activity-private-review-'+randomUUID();
  const signedTarget='activity-signed-review-'+randomUUID();
  const d05Workspace='d05-case001-reported-'+randomUUID();
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
  const d05ReadAuthority=createTemporaryOriginalPersonalAuthority({
    workspaceId:d05Workspace,now:Date.now(),clock:Date.now,
    purpose:'activity.analysis',operations:readOps,
    operationActions:Object.fromEntries(readOps.map(op=>[op,'activity.read'])),
  });
  // One existing signed Control. After its first signed cold readback we
  // invalidate the epoch and switch the selected read scope, never mint a
  // grant in React or invent a second transport.
  let selectedReadAuthority=sourceAuthority.access;
  handler=createOriginalControlHttpHandler({
    origin:server.origin,token,
    currentEpoch:()=>contextEpoch,
    subscribeInvalidation:fn=>{listen.add(fn);return()=>listen.delete(fn);},
    ownerFor:({scope,operation})=>scope!=='activity'?null:
      operation==='activity.read'?selectedReadAuthority:
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
    await sourceWriter.t1.createWorkspace({
      workspace_id:args.d05Workspace,profile:'generic',
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
  },{source,target,signedTarget,d05Workspace,writer,reviewer,
    objectId:'activity-review:original-kernel',
    schema:T3_ACTIVITY_OWNER_REVIEW_SCHEMA,data:proofData});
  assert.equal(first.source_revision,1);
  assert.equal(first.draft_revision,1);
  assert.equal(first.reviewer_service,reviewer);
  assert.equal(first.export_denied,true);
  assert.equal(first.source_denied,true);
  // Additional D05-shaped records are written through a THIRD, separately
  // restricted normal T2 TEST service. No real production is asserted.
  const d05Saved=await browser.page.evaluate(async args=>{
    const client=await globalThis.IWXA.connect({service_id:args.service});
    if(client.contract_version!=='1.3.0'||client.runtime_version!=='0.3.6'||
      !client.granted_operations.includes('t1.putObject')||
      client.granted_operations.includes('t1.createWorkspace')||
      client.granted_operations.includes('t2.exportPackage'))
      throw Error('D05_WITNESS_T2_PASSPORT_NOT_ISOLATED');
    const schema='ru.5ibs.productionops.';
    const entries=[
      ['d05:case001:order','production-order','cehovod.result.saved'],
      ['d05:case001:execution','production-execution','cehovod.operation.transitioned'],
      ['d05:case001:quality','quality-check-result','cehovod.result.saved'],
    ];
    for(const [id,type,eventType] of entries){
      const data={
        object_id:id,object_type:type,source_schema_version:'1.0.0',
        display_label:'INTERNAL_MODEL_ORDER',source_service_id:args.service,
        status:'reported',summary_markdown:'MODEL_ONLY',
        algorithm_version:null,
        value:{quantity:120,evidence:'NOT_INDEPENDENTLY_CONFIRMED'},
      };
      const event={event_type:eventType,payload:{
        object_id:id,actor_role:'test_operator',
        action:'recorded_not_observed',
      }};
      // The ORIGINAL T2 graph commit records a qualified, same-Workspace
      // based_on relation. No client-side inferred edge or second graph.
      const saved=type==='production-execution'
        ? await client.t1.commitObjectGraph({
            workspace_id:args.workspace,
            idempotency_key:'d05-witness-exec-'+args.workspace,
            object:{object_id:id,schema_id:schema+type,
              schema_version:'1.0.0',data},
            relation_puts:[{
              relation_id:'ceh.link.d05-case001-execution-order',
              from_object_id:id,to_object_id:'d05:case001:order',
              kind:'based_on',
            }],
            relation_deletes:[],event,
          })
        : await client.t1.putObject({
            workspace_id:args.workspace,object_id:id,
            schema_id:schema+type,schema_version:'1.0.0',
            base_revision:0,data,extensions:{},event,
          });
      if(saved?.object?.revision!==1||
        saved?.event?.correlation_id!==saved?.transaction_id)
        throw Error('D05_WITNESS_ORIGINAL_T2_WRITE_RECEIPT_INVALID');
    }
    // Save the actual route Result representation in the same ORIGINAL T2
    // test service and store. These are reproducible models, never execution.
    const {buildD05RouteComparisonExample}=await import('/_activity/d05-route-comparison.mjs');
    for(const value of buildD05RouteComparisonExample()){
      const id=value.object_id;
      const saved=await client.t1.putObject({
        workspace_id:args.workspace,object_id:id,schema_id:schema+'operation-route',
        schema_version:'1.0.0',base_revision:0,
        data:{object_id:id,object_type:'operation-route',source_schema_version:'1.0.0',
          display_label:'PRIVATE_ROUTE_MODEL',source_service_id:args.service,
          algorithm_version:null,status:'active',summary_markdown:'MODEL_ONLY',value},
        extensions:{},event:{event_type:'cehovod.result.saved',payload:{object_id:id}},
      });
      if(saved?.object?.revision!==1||saved?.event?.correlation_id!==saved?.transaction_id)
        throw Error('A41_ORIGINAL_T2_ROUTE_WRITE_RECEIPT_INVALID');
    }
    // Use the original graph commit for declared quality control. All
    // route/template targets already exist before a plan is linked.
    const {buildD05RouteQualityComparisonExample}=await import('/_activity/d05-route-comparison.mjs');
    const quality=buildD05RouteQualityComparisonExample(args.workspace);
    const templateType=schema+'quality-check-template',planType=schema+'quality-plan';
    for(const item of [...quality.filter(x=>x.object.schema_id===templateType),
      ...quality.filter(x=>x.object.schema_id===planType)]){
      const {object,relations}=item;
      const data={...object.data,source_service_id:args.service};
      const event={event_type:'cehovod.result.saved',payload:{object_id:object.object_id}};
      const saved=object.schema_id===planType?await client.t1.commitObjectGraph({
        workspace_id:args.workspace,idempotency_key:'quality-witness-'+object.object_id,
        object:{object_id:object.object_id,schema_id:object.schema_id,
          schema_version:object.schema_version,data},
        relation_puts:relations.outgoing.map(({relation_id,from_object_id,to_object_id,kind})=>
          ({relation_id,from_object_id,to_object_id,kind})),relation_deletes:[],event,
      }):await client.t1.putObject({
        workspace_id:args.workspace,object_id:object.object_id,schema_id:object.schema_id,
        schema_version:object.schema_version,base_revision:0,data,extensions:{},event,
      });
      if(saved?.object?.revision!==1||saved?.event?.correlation_id!==saved?.transaction_id)
        throw Error('A41_ORIGINAL_T2_QUALITY_WRITE_RECEIPT_INVALID');
    }
    const previous=await client.t1.getObject(args.workspace,'d05:case001:order');
    const updated=await client.t1.putObject({
      workspace_id:args.workspace,object_id:'d05:case001:order',
      schema_id:schema+'production-order',schema_version:'1.0.0',
      base_revision:1,data:{...previous.object.data,status:'approved'},
      extensions:{},event:{event_type:'cehovod.order.transitioned',
        payload:{object_id:'d05:case001:order',action:'approve',
          actor_role:'test_manager',previous_status:'reported',
          next_status:'approved'}},
    });
    const records=await client.t1.listObjects({
      workspace_id:args.workspace,include_deleted:true,
    });
    const history=await client.t1.listEventsSince(args.workspace);
    const observed=history.filter(x=>[
      'cehovod.result.saved','cehovod.operation.transitioned',
      'cehovod.order.transitioned',
    ].includes(x.event_type));
    const linked=await client.t1.getObject(args.workspace,'d05:case001:execution');
    const links=linked?.relations?.outgoing??[];
    if(links.length!==1||links[0].kind!=='based_on'||
      links[0].to_object_id!=='d05:case001:order')
      throw Error('D05_WITNESS_ORIGINAL_T2_BASED_ON_RELATION_MISSING');
    if(updated?.object?.revision!==2||records.length!==12||observed.length!==13)
      throw Error('D05_WITNESS_ORIGINAL_T2_READBACK_INVALID');
    return {object_count:records.length,event_count:observed.length,
      revision:updated.object.revision};
  },{workspace:d05Workspace,service:d05Service});
  assert.deepEqual(d05Saved,{object_count:12,event_count:13,revision:2});

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
    const {buildT3TransitionMap}=
      await import('/_activity/t3-transition-map.mjs');
    const session=await globalThis.IWXA.connect({service_id:args.writer});
    const reviewerSession=await globalThis.IWXA.connect({service_id:args.reviewer});
    if(reviewerSession.service?.service_id!=='iwxa.activity.reviewer'||
      reviewerSession.granted_operations.includes('t2.exportPackage')||
      !reviewerSession.granted_operations.includes('t1.putObject'))
      throw Error('ORIGINAL_T2_REVIEWER_PRIVILEGE_INVALID');
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
      session,reviewerSession,control,currentWorkspace,bindings:{
        objects:[{schema_id:'iwxa.demo.note',schema_version:'1.0.0',
          semantic_kind:'Process'}],
        events:['created','cut','bent','inspected'].map(phase=>({
          event_type:'d05.bracket.'+phase,semantic_kind:'Event',
          epistemic_status:'observed',
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
      // The ORIGINAL signed D2 returns qualified aliases. The user's
      // object-local map must not infer extra transitions or business
      // causality; it remains internal and cannot be exported.
      const map=buildT3TransitionMap(snapshot.structural_candidate[0]);
      if(map.nodes.length!==4||map.transitions.length!==3||
        map.inferred_edges!==0||!map.linear||map.cyclic||
        map.export_allowed!==false||
        JSON.stringify(map).includes('PRIVATE_CEHOVOD_CUSTOMER'))
        throw Error('ORIGINAL_T3_D2_INTERACTIVE_MAP_INFERRED_OR_LEAKED');
      const staged=await ui.stageSelected();
      if(staged.status!=='STAGED')
        throw Error('ORIGINAL_T3_SIGNED_DERIVE_'+staged.status+
          '_'+String(updates.at(-1)?.code??''));
      const targetObjects=await reviewerSession.t1.listObjects({
        workspace_id:args.signedTarget,include_deleted:true,
      });
      if(targetObjects.length!==1||targetObjects[0]?.schema_id!==args.schema||
        targetObjects[0]?.data?.anonymity!=='NOT_ESTABLISHED'||
        targetObjects[0]?.data?.export_allowed!==false||
        JSON.stringify(targetObjects).includes('PRIVATE_CEHOVOD_CUSTOMER'))
        throw Error('ORIGINAL_T3_SIGNED_DRAFT_NOT_PERSISTED');
      const sourceCannotRead=await session.t1.getObject(
        args.signedTarget,targetObjects[0]?.object_id);
      if(sourceCannotRead?.object!==null&&sourceCannotRead?.object!==undefined)
        throw Error('ORIGINAL_T2_SOURCE_SERVICE_READS_REVIEW_TYPE');
      const events=await reviewerSession.t1.listEventsSince(args.signedTarget);
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
        safe_map_nodes:map.nodes.length,safe_map_edges:map.transitions.length,
        no_inferred_map_edges:map.inferred_edges===0,
        narrow_host_keys:Object.keys(bound.port),
        original_service:session.service.service_id,
      };
    } finally {
      ui.dispose();bound.dispose();
      if(selectedListeners.size!==0)
        throw Error('ORIGINAL_T3_HOST_SELECTION_LISTENER_LEAK');
    }
  },{source,signedTarget,writer,reviewer,token,schema:T3_ACTIVITY_OWNER_REVIEW_SCHEMA});
  assert.equal(signed.status,'STAGED');
  assert.equal(signed.source_review,'STRUCTURE_PRESERVED_REVIEW_REQUIRED');
  assert.equal(signed.observed_step_types,4);
  assert.equal(signed.observed_successions,3);
  assert.equal(signed.safe_map_nodes,4);
  assert.equal(signed.safe_map_edges,3);
  assert.equal(signed.no_inferred_map_edges,true);
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
    const signedDraft=await targetReviewer.t1.getObject(
      args.signedTarget,args.signedObjectId);
    const signedEvents=await targetReviewer.t1.listEventsSince(args.signedTarget);
    // New browser profile and freshly acquired original signed D1 rights:
    // independent Kernel readback, not a repeat of the old putObject.
    const {recoverSelectedT3ActivityReview}=await import(
      '/_activity/t3-owner-review-stage.mjs');
    const {useOriginalT2ActivityKernelFacade}=await import(
      '/_activity/t3-original-t2-owner-host.mjs');
    const {createSubjectKernelBinding}=await import('/_t3/index.mjs');
    const {createControlLoopbackOwner}=await import(
      '/_t3/control-loopback-owner.mjs');
    const control=createControlLoopbackOwner({
      origin:location.origin,token:args.token,
    });
    // Fresh signed Control session requires the SAME original SSE ready
    // handshake before any D1 request; a surviving POST endpoint alone is
    // deliberately not authority after a cold browser profile restart.
    const stopControl=control.subscribeSignedAccessInvalidation(()=>{});
    let recovered;
    try {
      const selection=Object.freeze({workspace_id:args.source});
      recovered=await recoverSelectedT3ActivityReview({
        sourceContext:{
          kernel:useOriginalT2ActivityKernelFacade(sourceWriter),
          currentWorkspace:{get:()=>selection,subscribe:()=>()=>{}},
        },
        sourceSignedAccess:await control.signedActivityAccess('activity.read'),
        targetWorkspaceId:args.signedTarget,
        targetKernel:useOriginalT2ActivityKernelFacade(targetReviewer),
        targetSignedAccess:await control.signedActivityAccess('activity.derive'),
        createSubjectKernelBinding,
      });
    } finally {stopControl();}
    const afterRecovery=await targetReviewer.t1.listObjects({
      workspace_id:args.signedTarget,include_deleted:true,
    });
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
      recovered_status:recovered.status,
      recovered_readback:recovered.readback,
      recovered_export_allowed:recovered.export_allowed,
      post_recovery_draft_count:afterRecovery.length,
    };
  },{source,target,signedTarget,writer,reviewer,token,
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
  assert.equal(reopened.recovered_status,'OWNER_REVIEW_DRAFT');
  assert.equal(reopened.recovered_readback,true);
  assert.equal(reopened.recovered_export_allowed,false);
  assert.equal(reopened.post_recovery_draft_count,1,
    'read-only recovery cannot repeat the original Kernel write');
  // The original review has now been independently cold-recovered.
  // Switch the original signed read owner to this test-only D05 Workspace;
  // signal its original Control epoch. A stale signed owner is not reused.
  selectedReadAuthority=d05ReadAuthority.access;
  contextEpoch+=1;
  for(const notify of [...listen])notify();
  const d05Cold=await browser.page.evaluate(async args=>{
    const session=await globalThis.IWXA.connect({service_id:args.service});
    const before=await session.t1.listObjects({
      workspace_id:args.workspace,include_deleted:true,
    });
    const history=await session.t1.listEventsSince(args.workspace);
    const savedOrder=await session.t1.getObject(args.workspace,'d05:case001:order');
    const execution=await session.t1.getObject(args.workspace,'d05:case001:execution');
    if(execution?.relations?.outgoing?.length!==1||
      execution.relations.outgoing[0].kind!=='based_on')
      throw Error('D05_WITNESS_ORIGINAL_T2_COLD_RELATION_MISSING');
    const reported=history.filter(row=>[
      'cehovod.result.saved','cehovod.order.transitioned',
      'cehovod.operation.transitioned',
    ].includes(row.event_type));
    if(before.length!==12||reported.length!==13||
      savedOrder?.object?.revision!==2||
      savedOrder?.object?.data?.value?.quantity!==120)
      throw Error('D05_WITNESS_ORIGINAL_T2_COLD_READBACK_MISMATCH');
    const {readActivityFromWorkspaceContext,createSubjectKernelBinding}=
      await import('/_t3/index.mjs');
    const {openActivityFromOriginalT2Host}=
      await import('/_activity/t3-original-t2-owner-host.mjs');
    const {createCehovodD05T3Bindings}=
      await import('/_activity/d05-t3-evidence-binding.mjs');
    const {buildT3EvidencePassport}=
      await import('/_activity/t3-evidence-passport.mjs');
    const {createT3ReviewController}=
      await import('/_activity/t3-review-controller.mjs');
    const {createControlLoopbackOwner}=
      await import('/_t3/control-loopback-owner.mjs');
    const control=createControlLoopbackOwner({
      origin:location.origin,token:args.token,
    });
    // Original Control admits exactly ONE owner SSE. The trusted Host
    // multiplexes that one invalidation to the Activity UI; subscribing
    // again would be refused, not a reason to weaken Control.
    const owners=new Set();
    const stop=control.subscribeSignedAccessInvalidation(()=>{
      for(const notify of owners)notify();
    });
    let ui=null,opened=null;
    try{
      const selected=Object.freeze({workspace_id:args.workspace});
      const currentWorkspace={get:()=>selected,subscribe:()=>()=>{}};
      const subscribeExistingInvalidation=fn=>{owners.add(fn);return()=>owners.delete(fn);};
      // Exercise the product composition, not a manually assembled alternate
      // port: one original session, one signed Control stream and existing
      // Activity Host. D05 model review is an explicit optional capability.
      opened=await openActivityFromOriginalT2Host({
        session,control,currentWorkspace,bindings:createCehovodD05T3Bindings(),
        readActivityFromWorkspaceContext,createSubjectKernelBinding,
        subscribeExistingInvalidation,enableD05RouteReview:true,includeD05QualityPlans:true,
      });
      const {port,d05RouteHost:routes}=opened;
      if(!routes||owners.size!==1||
        Object.keys(routes).sort().join(',')!=='readSelectedRoutes,subscribeInvalidation'||
        Object.keys(port).sort().join(',')!=='readSelected,subscribeInvalidation')
        throw Error('A41_ORIGINAL_HOST_COMPOSITION_INVALID');
      const routeReview=await routes.readSelectedRoutes();
      if(routeReview.source_authority!=='ORIGINAL_SIGNED_SELECTED_READBACK'||
        routeReview.model_count!==3||routeReview.group_count!==2||
        routeReview.repeated_group_count!==1||routeReview.export_allowed!==false||
        routeReview.anonymity!=='NOT_ESTABLISHED'||routeReview.iwxa_package!==null||
        routeReview.epistemic_status!=='CALCULATED_OR_DECLARED_NOT_OBSERVED'||
        !routeReview.groups.some(g=>g.model_count===2&&g.differing_fields.includes('DURATION')))
        throw Error('A41_ORIGINAL_T2_SIGNED_ROUTE_GROUPING_INVALID');
      const comparedQuality=routeReview.quality_review?.groups.find(g=>g.models.length===2);
      if(comparedQuality?.comparison!=='DECLARED_FIELDS_DIFFER'||
        JSON.stringify(comparedQuality.differing_fields)!=='["CRITERIA"]'||
        !comparedQuality.models.every(m=>m.status==='DECLARED_CHECKS_READ'&&m.check_count===1&&m.blocking_count===1))
        throw Error('A41_ORIGINAL_T2_SIGNED_QUALITY_COMPARISON_INVALID');
      for(const forbidden of ['example-route-','example-plan-','example-check-','99.5','100.5','PRIVATE_ROUTE_MODEL','MODEL_ONLY',args.workspace])
        if(JSON.stringify(routeReview).includes(forbidden))
          throw Error('A41_ORIGINAL_T2_ROUTE_SOURCE_LEAK');
      const afterRoutes=await session.t1.listObjects({workspace_id:args.workspace,include_deleted:true});
      const afterHistory=await session.t1.listEventsSince(args.workspace);
      const canon=rows=>JSON.stringify([...rows].sort((a,b)=>
        String(a.object_id??a.event_id).localeCompare(String(b.object_id??b.event_id))));
      if(canon(afterRoutes)!==canon(before)||canon(afterHistory)!==canon(history))
        throw Error('A41_ROUTE_READ_MUTATED_ORIGINAL_STORE');
      const states=[];
      ui=createT3ReviewController({host:port,onUpdate:s=>states.push(s)});
      const outcome=await ui.readSelected();
      const review=states.at(-1)?.review;
      if(outcome.status!=='REVIEW'||review?.status!=='HOLD'||
        !review.reason_codes.includes('T3_D2_UNVERIFIED_EVENT_STEP')||
        !review.reason_codes.includes('T3_D2_RARE_OBJECT_ROUTE')||
        !review.reason_codes.includes('T3_D2_RELATION_PRIVACY_REVIEW_REQUIRED')||
        review.structural_candidate!==null||review.export_allowed!==false||
        review.anonymity!=='NOT_ESTABLISHED'||review.iwxa_package!==null)
        throw Error('D05_WITNESS_SYSTEM_REPORT_FALSELY_OBSERVED');
      // Product UI sees the ORIGINAL D2 reason-code passport, not source
      // rows or an invented confidence score.
      const passport=buildT3EvidencePassport(review);
      if(passport.result!=='INSUFFICIENT_FOR_RECONSTRUCTION'||
        passport.businessExecution!=='NOT_INDEPENDENTLY_PROVEN'||
        passport.disclosure!=='FORBIDDEN'||
        !passport.groups.some(g=>g.area==='facts'&&
          g.items.some(i=>i.code==='T3_D2_UNVERIFIED_EVENT_STEP'))||
        !passport.groups.some(g=>g.area==='privacy'&&
          g.items.some(i=>i.code==='T3_D2_RELATION_PRIVACY_REVIEW_REQUIRED')))
        throw Error('D05_WITNESS_EVIDENCE_PASSPORT_FALSE_PROOF');
      const visible=JSON.stringify(states)+JSON.stringify(passport);
      for(const forbidden of ['d05:case001','120','cehovod.operation.transitioned',
        args.workspace,'MODEL_ONLY','INTERNAL_MODEL_ORDER'])
        if(visible.includes(forbidden))
          throw Error('D05_WITNESS_RENDERER_SOURCE_LEAK');
      return {read:outcome.status,status:review.status,
        reason_codes:review.reason_codes,objects:before.length,
        reported_events:reported.length,order_revision:savedOrder.object.revision,
        export_allowed:review.export_allowed,
        evidence_passport_actions:passport.actionCount,
        route_models:routeReview.model_count,route_groups:routeReview.group_count,
        repeated_route_groups:routeReview.repeated_group_count,quality_comparison:comparedQuality.comparison};
    }finally{
      ui?.dispose();opened?.dispose();stop();
      if(owners.size)throw Error('D05_WITNESS_CONTROL_LISTENER_LEAK');
    }
  },{service:d05Service,workspace:d05Workspace,token});
  assert.equal(d05Cold.read,'REVIEW');
  assert.equal(d05Cold.status,'HOLD');
  assert.equal(d05Cold.objects,12);
  assert.equal(d05Cold.reported_events,13);
  assert.equal(d05Cold.route_models,3);
  assert.equal(d05Cold.route_groups,2);
  assert.equal(d05Cold.repeated_route_groups,1);
  assert.equal(d05Cold.quality_comparison,'DECLARED_FIELDS_DIFFER');
  console.log('ACTIVITY_A41_ORIGINAL_T2_SIGNED_QUALITY_COLD_READ_PASS',JSON.stringify({plans:3,templates:3,comparison:d05Cold.quality_comparison,sourceUnchanged:true,externalTransfer:false}));
  console.log('ACTIVITY_A41_ORIGINAL_T2_SIGNED_ROUTE_COLD_READ_PASS',
    JSON.stringify({models:3,groups:2,repeated:1,sourceUnchanged:true,externalTransfer:false,
      originalHostComposition:true,originalControlStreams:1}));
  assert.equal(d05Cold.order_revision,2);
  assert.equal(d05Cold.export_allowed,false);
  assert.ok(d05Cold.evidence_passport_actions>=2);
  assert.ok(d05ReadAuthority.proofCount>0);
  console.log('ACTIVITY_D05_ORIGINAL_T2_SIGNED_REPORTED_COLD_HOLD_PASS',
    JSON.stringify({realOriginalT2Kernel:true,testOnlyD05Service:true,
      signedOriginalT3Read:true,coldReadback:true,
      savedResultTypes:6,savedObjects:12,savedEvents:13,
      originalKernelBasedOnRelation:true,evidencePassport:true,
      provenBusinessExecution:false,
      review:'HOLD',externalTransfer:false}));

  console.log('ACTIVITY_ORIGINAL_T2_SIGNED_COLD_RECOVERY_NO_RETRY_PASS');
  console.log('ACTIVITY_REAL_SIGNED_T3_READ_DERIVE_ORIGINAL_T2_COLD_PASS',
    JSON.stringify({signed:'ED25519_PERSONAL',
      signedReadProofs:sourceAuthority.proofCount,
      signedDeriveProofs:targetAuthority.proofCount,
      sameOriginalT2Store:true,selectedWorkspaceStores:1,
      coldReadback:true,sourceUnchanged:true,
      sourceReview:signed.source_review,
      observedStepTypes:signed.observed_step_types,
      observedSuccessions:signed.observed_successions,
      originalD2SafeProcessMap:true,
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
