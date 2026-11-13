// Public T3 owner integration test: one real qualified T2 Kernel and Store,
// extended with T3 activity semantic projection, with real browser restart.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {createServer as createHttpServer} from 'node:http';
import {
  LOCAL_INFERENCE_DRAFT_SCHEMA, LOCAL_INFERENCE_DRAFT_DECLARATION,
} from '../../src/t3/local-inference-draft.mjs';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const T2_HEAD = '9c64951cd78411283e8a416641c36d71e169fc1d';
const T2_TREE = '56e55a9458aeb3ce540ef87dbc2dd9549ae2fcb2';
const KERNEL = '0.3.6';
const CONTRACT = '1.3.0';
const ARTIFACT = 'iwxa-kernel-k036-same-store-history-20261019-qualified.1';
const ARCHIVE_SHA = '7075b8b9590ef1283e34ecb3c21dd9d1b7342697287e1aa150cd4f4a60860b68';
const RUNTIME_SHA = 'e1737245aba309e900203b458087ca07cb08d9ccc89901754e1122cbc9a01e78';
const READER = 'iwxa.t2.qualification.reader';
const WRITER = 'iwxa.workspace.integration';
const MODULE_ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/t3/activity'));
const {canonical} = await import(pathToFileURL(join(MODULE_ROOT,"index.mjs")).href);
const {stageT3ActivityWitness, readT3ActivityInLiveBrowser} = await import(
  pathToFileURL(join(MODULE_ROOT,"t2-host-witness.mjs")).href);
const {
  createRealT2ActivityFixture,
  readRealT2ActivitySource,
  proveRealT2ReadOnlyProjection,
  proveRealT2StaleRevisionDenied,
  verifyRealT2ColdRestart,
  verifyRealT2UnknownAndTombstone,
  roundTripRealT2Iwxa,
  LIVE_T2_BINDINGS,
  exportSelectedRealT2Iwxa,
  importSelectedRealT2Iwxa,
} = await import(pathToFileURL(join(MODULE_ROOT,"real-t2-host-acceptance.mjs")).href);
const {
  initD1TestHostState,
  seedD1OnRealKernel,
  verifyD1AfterBrowserRestart,
} = await import(pathToFileURL(join(MODULE_ROOT, "real-t2-d1-host-acceptance.mjs")).href);
function inside(root, child) {
  const diff = relative(root, child);
  return diff.length > 0 && diff !== '..' && !diff.startsWith('..' + sep) && !isAbsolute(diff);
}
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function requiredDirectory(name) {
  const value=process.env[name];
  assert.ok(value,'REQUIRED_'+name);
  return realpathSync(resolve(value));
}
async function openBrowser(chromium, profile, origin) {
  const context = await chromium.launchPersistentContext(profile, {
    headless:true, ignoreHTTPSErrors:true, serviceWorkers:'block',
  });
  await context.route('**/*', route => {
    const target = route.request().url();
    if (target.startsWith(origin + '/')) return route.continue();
    return route.abort();
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto(origin + '/__t2_independent_readback__', {waitUntil:'load'});
  await page.waitForFunction(() => typeof globalThis.IWXA?.connect === 'function');
  return {context,page};
}

/**
 * D1 product preflight: ORIGINAL qualified T2 Kernel/Store must actually run
 * at the exact HTTP loopback origin used by the existing private Control.
 * The prior HTTPS witness cannot prove this transport works. Only a disposable
 * browser profile and a test-only static server; no second Kernel or parser.
 */
async function probeOriginalT2OnControlHttp(root,chromium,temp){
  let origin=null,context=null;
  const server=createHttpServer((request,response)=>{
    const send=(status,body,type='text/plain')=>{
      response.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'"});
      response.end(body);
    };
    try{
      if(request.headers.host!==new URL(origin).host)
        return send(403,'HTTP_PROBE_HOST_MISMATCH');
      const url=new URL(request.url,origin),path=url.pathname;
      if(path==='/__t3_control_http_kernel__'){
        return send(200,'<!doctype html><title>T3 original T2 on Control HTTP</title><script src="/_iwxa/loader.js"></script>','text/html');
      }
      if(!/^\/_iwxa\/[A-Za-z0-9._/-]+$/.test(path)||
          path.includes('..')||path.includes('/.'))
        return send(404,'HTTP_PROBE_ASSET_NOT_FOUND');
      const file=resolve(root,'.'+path);
      if(!inside(root,file))return send(404,'HTTP_PROBE_OUTSIDE_ROOT');
      let bytes=readFileSync(file);
      if(path==='/_iwxa/domain.json'||path==='/_iwxa/domain-shell.json'){
        const doc=JSON.parse(bytes.toString('utf8'));
        doc.origin=origin; // Same qualified asset; only host-owned origin.
        bytes=Buffer.from(JSON.stringify(doc));
      }
      const type=path.endsWith('.json')?'application/json':
        path.endsWith('.js')||path.endsWith('.mjs')?'text/javascript':
          path.endsWith('.wasm')?'application/wasm':'application/octet-stream';
      return send(200,bytes,type);
    }catch{
      return send(404,'HTTP_PROBE_ASSET_MISSING');
    }
  });
  try{
    await new Promise((done,fail)=>{
      server.once('error',fail);
      server.listen(0,'127.0.0.1',done);
    });
    const address=server.address();
    assert.ok(address&&typeof address!=='string');
    origin='http://127.0.0.1:'+address.port;
    const profile=join(temp,'d1-http-control-loopback');
    const options={headless:true,serviceWorkers:'block'};
    const launch=async()=>{
      context=await chromium.launchPersistentContext(profile,options);
      const page=context.pages()[0]||await context.newPage();
      await page.goto(origin+'/__t3_control_http_kernel__',{waitUntil:'load'});
      await page.waitForFunction(()=>typeof globalThis.IWXA?.connect==='function',
        undefined,{timeout:20000});
      return page;
    };
    let page=await launch();
    const workspace_id='t3-d1-loopback-'+randomUUID();
    const object_id='d1-http-control-object';
    const committed=await page.evaluate(async({workspace_id,object_id,service_id})=>{
      const session=await globalThis.IWXA.connect({service_id});
      if(session.contract_version!=='1.3.0'||session.runtime_version!=='0.3.6'||
         !session.granted_operations.includes('t1.putObject'))
        throw Error('T3_D1_HTTP_ORIGINAL_KERNEL_CONTRACT_MISMATCH');
      const workspace=await session.t1.createWorkspace({workspace_id,profile:'generic'});
      const saved=await session.t1.putObject({
        workspace_id,object_id,schema_id:'iwxa.demo.note',schema_version:'1.0.0',
        base_revision:0,data:{title:'Signed Control HTTP protocol validation'},
        extensions:{},event:{event_type:'t3.d1.http.loopback.created',payload:{}},
      });
      const read=await session.t1.getObject(workspace_id,object_id);
      return {workspace:workspace?.workspace_id,event:saved?.event?.event_id,
        revision:saved?.object?.revision,read:read?.object?.data?.title,
        secureContext:globalThis.isSecureContext};
    },{workspace_id,object_id,service_id:WRITER});
    assert.equal(committed.workspace,workspace_id);
    assert.ok(committed.event);
    assert.equal(committed.revision,1);
    assert.equal(committed.read,'Signed Control HTTP protocol validation');
    assert.equal(committed.secureContext,true,
      'T3_D1_CONTROL_HTTP_REQUIRES_TRUSTWORTHY_LOOPBACK');
    await context.close();context=null;
    page=await launch();
    const reopened=await page.evaluate(async({workspace_id,object_id,service_id})=>{
      const session=await globalThis.IWXA.connect({service_id});
      const saved=await session.t1.getObject(workspace_id,object_id);
      const events=await session.t1.listEventsSince(workspace_id);
      return {revision:saved?.object?.revision,title:saved?.object?.data?.title,
        eventIds:events.map(e=>e.event_id)};
    },{workspace_id,object_id,service_id:WRITER});
    assert.equal(reopened.revision,committed.revision,
      'T3_D1_ORIGINAL_KERNEL_HTTP_COLD_REVISION_MISMATCH');
    assert.equal(reopened.title,committed.read,
      'T3_D1_ORIGINAL_KERNEL_HTTP_COLD_READBACK_MISMATCH');
    assert.ok(reopened.eventIds.includes(committed.event),
      'T3_D1_ORIGINAL_KERNEL_HTTP_EVENT_MISSING');
    return {originProtocol:'http:',hostname:'127.0.0.1',
      originalKernel:'0.3.6',contract:'1.3.0',
      workspace_id,object_id,eventId:committed.event,
      coldReadback:true,secureContext:true};
  }finally{
    if(context)await context.close().catch(()=>{});
    server.closeAllConnections();
    await new Promise(done=>server.close(()=>done()));
  }
}

async function run() {
  const t2Source = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
  const qualified = requiredDirectory('IWXA_T2_QUALIFIED_KERNEL_DIST');
  const releaseZip = process.env.IWXA_T2_QUALIFIED_RELEASE_ZIP ??
    join(t2Source,'qualified-runtime/iwxa-kernel-k036-same-store-history-20261019-qualified.1.zip');
  assert.ok(releaseZip, 'ORIGINAL_T2_RELEASE_ZIP_REQUIRED');
  assert.equal(sha(readFileSync(realpathSync(resolve(releaseZip)))), ARCHIVE_SHA,
    'ORIGINAL_T2_RELEASE_ZIP_DIGEST_MISMATCH');
  assert.ok(existsSync(join(t2Source,'public','favicon.ico')), 'T2_ORIGINAL_HOST_FIXTURE_MISSING');
  const {assertQualifiedKernelArtifact,stageQualificationReader} = await import(
    pathToFileURL(join(t2Source,'src/factory2/products/domain-completion/independent-browser-witness.mjs')).href);
  const {materializeIntegrationHost,serveRealKernelHost} = await import(
    pathToFileURL(join(t2Source,'scripts/real-kernel-e2e.mjs')).href);
  const {chromium} = await import('playwright');
  const temp = mkdtempSync(join(tmpdir(),'iwxa-t3-d2-real-'));
  const originalCwd = process.cwd();
  let stage = null, witness = null, live = null, browser = null;
  try {
    const dist = join(temp,'dist');
    mkdirSync(dist);
    cpSync(join(qualified,'_iwxa'),join(dist,'_iwxa'),{recursive:true});
    const verified = assertQualifiedKernelArtifact(dist,{kernel:KERNEL,contract:CONTRACT,artifactId:ARTIFACT});
    assert.equal(verified.archiveSha256,ARCHIVE_SHA);
    assert.equal(sha(readFileSync(join(dist,'_iwxa/runtime/0.3.6/runtime.js'))),RUNTIME_SHA);
    process.chdir(t2Source);
    const host = materializeIntegrationHost(dist,'https://127.0.0.1');
    host.domain.runtime.kernel_release = KERNEL;
    host.domain.runtime.runtime_version = KERNEL;
    host.workspaceConfig.host.required_runtime_version = KERNEL;
    host.workspaceConfig.host.required_contract_version = CONTRACT;
    writeFileSync(join(dist,'_iwxa/domain.json'),JSON.stringify(host.domain));
    writeFileSync(join(dist,'workspace/workspace.config.json'),JSON.stringify(host.workspaceConfig));
    // Register the D5 draft as a *real* declared object type on the existing
    // T2 service passport. Never bypass the original Kernel schema gate.
    host.domain.security.allowed_object_classes.push(LOCAL_INFERENCE_DRAFT_SCHEMA);
    host.passport.input_object_types.push(LOCAL_INFERENCE_DRAFT_SCHEMA);
    host.passport.output_object_types.push(LOCAL_INFERENCE_DRAFT_SCHEMA);
    host.passport.schemas[LOCAL_INFERENCE_DRAFT_SCHEMA] = LOCAL_INFERENCE_DRAFT_DECLARATION;
    // Schema declaration is not an operation grant. Explicitly permit the
    // existing writer service to read/write this one draft type only.
    host.passport.permissions.objects.read.push(LOCAL_INFERENCE_DRAFT_SCHEMA);
    host.passport.permissions.objects.write.push(LOCAL_INFERENCE_DRAFT_SCHEMA);
    writeFileSync(join(dist,'_iwxa/domain.json'),JSON.stringify(host.domain));
    const passportFile = '_iwxa/services/' + WRITER + '.json';
    writeFileSync(join(dist,passportFile),JSON.stringify(host.passport));
    const passportBytes = readFileSync(join(dist,passportFile));
    writeFileSync(join(dist,'_iwxa/service-catalog.json'),JSON.stringify({count:1,entries:[{
      service_id:WRITER,service_version:host.passport.service_version,
      base_path:host.passport.base_path,supported_levels:host.passport.supported_levels,
      file:passportFile,sha256:sha(passportBytes),
    }]}));
    stage = stageQualificationReader(dist,{auditorMode:'ISOLATED_READ_ONLY',
      journeys:[{readServiceId:READER,denyServiceId:READER}]});
    assertQualifiedKernelArtifact(stage.root,{kernel:KERNEL,contract:CONTRACT,artifactId:ARTIFACT});
    witness = stageT3ActivityWitness({sourceDir:MODULE_ROOT,hostRoot:stage.root});
    live = await serveRealKernelHost(stage.root,{independentWitness:true,previewOrigin:true});
    const originalHttpControl=await probeOriginalT2OnControlHttp(stage.root,chromium,temp);
    console.log("T3_D1_ORIGINAL_KERNEL_HTTP_CONTROL_LOOPBACK_PASS",
      JSON.stringify(originalHttpControl));
    const profile = join(temp,'persistent-profile');
    const workspace_id = 't3-d2-'+randomUUID();
    const foreign_id = 't3-foreign-'+randomUUID();
    const restored_id = 't3-restored-'+randomUUID();
    browser = await openBrowser(chromium,profile,live.origin);
    const writerPage = browser.page;
    const receipts = await createRealT2ActivityFixture(writerPage, {
      workspace_id, foreign_workspace_id: foreign_id, writer_service_id: WRITER,
    });
    const exchange = await roundTripRealT2Iwxa(writerPage, {
      workspace_id, restored_workspace_id: restored_id, writer_service_id: WRITER,
    });
    // D4: a SINGLE selected .iwxa produced by the original owner is taken
    // through the original Kernel parser by TWO fully separate browser
    // profiles. This is not two tabs and not a second copy of the Store.
    const selectedArchive=await exportSelectedRealT2Iwxa(writerPage,{
      workspace_id,writer_service_id:WRITER,
    });
    assert.equal(selectedArchive.workspace_id,workspace_id);
    assert.deepEqual(selectedArchive.selected_workspaces,[workspace_id]);
    const consumerReceipts=[];
    const consumerProfiles=[];
    for (const ordinal of ["a","b"]) {
      const target='t3-d4-consumer-'+ordinal+'-'+randomUUID();
      const consumerProfile=join(temp,'d4-consumer-'+ordinal);
      let consumer=null;
      try {
        consumer=await openBrowser(chromium,consumerProfile,live.origin);
        const imported=await importSelectedRealT2Iwxa(consumer.page,{
          archive:selectedArchive,source_workspace_id:workspace_id,
          target_workspace_id:target,writer_service_id:WRITER,
        });
        assert.equal(imported.workspace_id,target);
        assert.equal(imported.package_digest,selectedArchive.package_digest);
        assert.equal(imported.qualified_event_links,1,
          "ORIGINAL_IWXA_RECIPIENT_LOST_QUALIFIED_EVENT_SOURCE");
        const original=await readRealT2ActivitySource(consumer.page,{
          workspace_id:target,reader_service_id:READER,
        });
        assert.equal(original.objects.length,2);
        assert.deepEqual(original.objects.map(x=>x.object_id).sort(),
          [...receipts.object_ids].sort());
        assert.equal(original.objects.find(x=>x.object_id==="activity:a")?.revision,
          receipts.revisions.a_current);
        assert.deepEqual(
          original.objects.find(x=>x.object_id==="activity:a")?.data?.dependency_ids,
          ["activity:b"]);
        assert.ok(original.details.some(x=>x.relations.outgoing.some(link=>
          link.relation_id===receipts.relation_id)));
        const recipientProjection=await readT3ActivityInLiveBrowser(consumer.page,{
          workspace_id:target,service_id:READER,bindings:LIVE_T2_BINDINGS,
        });
        const linked=recipientProjection.view.events.find(x=>
          x.event_type==="t3.activity.updated");
        assert.deepEqual(linked?.object_refs,[
          {object_id:"activity:a",revision:receipts.revisions.a_current,qualifier:"primary"},
          {object_id:"activity:b",revision:receipts.revisions.b_current,qualifier:"related_requirement"},
        ],"ORIGINAL_IWXA_RECIPIENT_D2_QUALIFIED_LINKS_CHANGED");
        assert.equal(recipientProjection.view.unresolved.length,0);
        await consumer.context.close();
        consumer=null;
        // The imported independent consumer keeps its own Store after
        // closing every browser process. It never re-imports the archive.
        consumer=await openBrowser(chromium,consumerProfile,live.origin);
        const reopened=await readRealT2ActivitySource(consumer.page,{
          workspace_id:target,reader_service_id:READER,
        });
        assert.equal(canonical(reopened),canonical(original),
          "T3_D4_INDEPENDENT_CONSUMER_COLD_READBACK_CHANGED");
        const afterColdProjection=await readT3ActivityInLiveBrowser(consumer.page,{
          workspace_id:target,service_id:READER,bindings:LIVE_T2_BINDINGS,
        });
        assert.equal(canonical(afterColdProjection.view),
          canonical(recipientProjection.view),
          "ORIGINAL_IWXA_RECIPIENT_QUALIFIED_E2O_COLD_RESTART_CHANGED");
        const isolation=await consumer.page.evaluate(async({source,target,service_id})=>{
          const session=await globalThis.IWXA.connect({service_id});
          const workspaces=await session.t1.listWorkspaces();
          return {
            containsTarget:workspaces.some(row=>row.workspace_id===target),
            containsSource:workspaces.some(row=>row.workspace_id===source),
            count:workspaces.length,
          };
        },{source:workspace_id,target,service_id:READER});
        assert.equal(isolation.containsTarget,true);
        assert.equal(isolation.containsSource,false,
          "T3_D4_SOURCE_OWNER_WORKSPACE_LEAKED_IN_CONSUMER");
        assert.equal(isolation.count,1,
          "T3_D4_IMPORTED_UNSELECTED_WORKSPACE");
        consumerReceipts.push({...imported,objects:reopened.objects.length,
          events:reopened.events.length,coldReadback:true,
          isolatedWorkspace:true});
        consumerProfiles.push(consumerProfile);
      } finally {
        if(consumer) await consumer.context.close().catch(()=>{});
      }
    }
    assert.equal(consumerReceipts.length,2);
    assert.notEqual(consumerReceipts[0].workspace_id,consumerReceipts[1].workspace_id);
    assert.notEqual(consumerReceipts[0].import_id,consumerReceipts[1].import_id);
    assert.equal(consumerReceipts[0].package_digest,consumerReceipts[1].package_digest);
    console.log("T3_D4_TWO_INDEPENDENT_ORIGINAL_KERNEL_CONSUMERS_PASS",
      JSON.stringify({originalKernel:KERNEL,contract:CONTRACT,
        sourceWorkspace:workspace_id,selectedWorkspaces:1,
        archiveBytes:selectedArchive.size,
        packageDigest:selectedArchive.package_digest,
        consumers:consumerReceipts.map(x=>({workspace:x.workspace_id,
          objects:x.objects,events:x.events,
          coldReadback:x.coldReadback,isolatedWorkspace:x.isolatedWorkspace})),
      }));

    const readerPage = await browser.context.newPage();
    await readerPage.goto(live.origin + "/__t2_independent_readback__", {waitUntil:"load"});
    const before = await proveRealT2ReadOnlyProjection(readerPage, {
      workspace_id, reader_service_id: READER, writer_service_id: WRITER,
      foreign_workspace_id: foreign_id, receipts,
    });
    const staleDenial = await proveRealT2StaleRevisionDenied(writerPage, {
      workspace_id, writer_service_id: WRITER,
    });
    const d1TestStateFile=join(temp,"d1-contract-only-owner.json");
    initD1TestHostState(d1TestStateFile,"t3-d1-"+randomUUID());
    const d1Receipts=await seedD1OnRealKernel(writerPage,d1TestStateFile);

    // D5: original T2 Kernel persistence of an explicitly chosen local-model
    // draft. The text is synthetic: this witness does NOT run WebGPU.
    const d5WorkspaceId='t3-d5-'+randomUUID();
    const d5Draft=await writerPage.evaluate(async ({workspace_id,service_id})=>{
      const session=await globalThis.IWXA.connect({service_id});
      await session.t1.createWorkspace({workspace_id,profile:'generic'});
      const focus=Object.freeze({workspace_id});
      const context={
        currentWorkspace:{get:()=>focus,subscribe:()=>()=>{}},
        kernel:{
          sessionInfo:{contract_version:session.contract_version},
          hasOperation:op=>session.granted_operations.includes(op),
          getWorkspace:id=>session.t1.getWorkspace(id),
          putObject:input=>session.t1.putObject(input),
          getObject:(ws,id)=>session.t1.getObject(ws,id),
          listObjects:query=>session.t1.listObjects(query),
        },
      };
      const mod=await import('/_t3/activity/local-inference-draft.mjs');
      return mod.saveLocalInferenceDraft(context,{
        expected_workspace_id:workspace_id,
        model_id:'SYNTHETIC_MODEL_NOT_EXECUTED',
        engine:'TEST_ONLY_NO_WEBGPU',
        output:'An explicitly reviewed synthetic draft for the original Kernel',
      });
    },{workspace_id:d5WorkspaceId,service_id:WRITER});
    assert.equal(d5Draft.status,'DRAFT_UNTRUSTED');
    assert.equal(d5Draft.readback,true);
    // A real Kernel write commits, but the caller loses its receipt. The
    // original putObject MUST run exactly once and the same ID MUST reopen.
    const d5LostAck=await writerPage.evaluate(async ({workspace_id,service_id})=>{
      const session=await globalThis.IWXA.connect({service_id});
      const focus=Object.freeze({workspace_id});
      const context={
        currentWorkspace:{get:()=>focus,subscribe:()=>()=>{}},
        kernel:{
          sessionInfo:{contract_version:session.contract_version},
          hasOperation:op=>session.granted_operations.includes(op),
          getWorkspace:id=>session.t1.getWorkspace(id),
          putObject:async input=>{
            await session.t1.putObject(input); // committed in original Kernel
            throw Object.assign(new Error("ack interrupted"),{code:"TEST_D5_LOST_ACK"});
          },
          getObject:(ws,id)=>session.t1.getObject(ws,id),
        },
      };
      const mod=await import('/_t3/activity/local-inference-draft.mjs');
      let uncertain;
      try {
        await mod.saveLocalInferenceDraft(context,{
          expected_workspace_id:workspace_id,
          model_id:"SYNTHETIC_MODEL_NOT_EXECUTED",
          engine:"TEST_ONLY_NO_WEBGPU",
          output:"A committed draft whose Kernel receipt was deliberately lost",
        });
        throw Error("T3_D5_LOST_ACK_WAS_NOT_REPORTED");
      } catch(error) {
        if(error.code!=="T3_D5_WRITE_MAY_HAVE_COMMITTED") throw error;
        uncertain={object_id:error.object_id,cause_code:error.cause_code};
      }
      const recovered=await mod.getLocalInferenceDraft(context,{
        expected_workspace_id:workspace_id,object_id:uncertain.object_id,
      });
      const records=await session.t1.listObjects({workspace_id});
      return {
        ...uncertain,readback:recovered.readback,text:recovered.text,
        identical_records:records.filter(x=>x.object_id===uncertain.object_id).length,
      };
    },{workspace_id:d5WorkspaceId,service_id:WRITER});
    assert.equal(d5LostAck.cause_code,"TEST_D5_LOST_ACK");
    assert.equal(d5LostAck.readback,true);
    assert.equal(d5LostAck.identical_records,1,
      "T3_D5_LOST_ACK_MUST_NOT_TRIGGER_A_SECOND_KERNEL_WRITE");

    await browser.context.close();
    browser = null;
    // The owner explicitly closes the complete browser process, then opens
    // the same persistent profile under the same HTTPS origin.
    browser = await openBrowser(chromium,profile,live.origin);
    const coldRestored = await readRealT2ActivitySource(browser.page, {
      workspace_id: restored_id, reader_service_id: READER,
    });
    assert.equal(coldRestored.workspace?.workspace_id,restored_id,"T2_IMPORT_COLD_WORKSPACE_MISSING");
    assert.equal(coldRestored.objects.length,2,"T2_IMPORT_COLD_OBJECTS_MISSING");
    assert.ok(coldRestored.events.length>=4,"T2_IMPORT_COLD_HISTORY_MISSING");
    const after = await proveRealT2ReadOnlyProjection(browser.page, {
      workspace_id, reader_service_id: READER, writer_service_id: WRITER,
      foreign_workspace_id: foreign_id, receipts,
    });
    const same = verifyRealT2ColdRestart(before,after);
    const tombstone = await verifyRealT2UnknownAndTombstone(browser.page, {
      workspace_id, reader_service_id: READER, writer_service_id: WRITER,
    });
    const d1ColdOne=await verifyD1AfterBrowserRestart(browser.page,d1TestStateFile,d1Receipts);
    const d5ColdOne=await browser.page.evaluate(async ({workspace_id,object_id,lost_ack_object_id,service_id})=>{
      const session=await globalThis.IWXA.connect({service_id});
      const focus=Object.freeze({workspace_id});
      const context={
        currentWorkspace:{get:()=>focus,subscribe:()=>()=>{}},
        kernel:{
          sessionInfo:{contract_version:session.contract_version},
          hasOperation:op=>session.granted_operations.includes(op),
          getWorkspace:id=>session.t1.getWorkspace(id),
          getObject:(ws,id)=>session.t1.getObject(ws,id),
        },
      };
      const mod=await import('/_t3/activity/local-inference-draft.mjs');
      const opened=await mod.getLocalInferenceDraft(context,{
        expected_workspace_id:workspace_id,object_id,
      });
      const recoveredLost=await mod.getLocalInferenceDraft(context,{
        expected_workspace_id:workspace_id,object_id:lost_ack_object_id,
      });
      const detail=await session.t1.getObject(workspace_id,object_id);
      const events=await session.t1.listEventsSince(workspace_id);
      return {opened,recoveredLost,object:detail?.object,events};
    },{workspace_id:d5WorkspaceId,object_id:d5Draft.object_id,
      lost_ack_object_id:d5LostAck.object_id,service_id:WRITER});
    assert.equal(d5ColdOne.recoveredLost?.text,d5LostAck.text,
      "T3_D5_LOST_ACK_COLD_KERNEL_READBACK_MISMATCH");
    // The recovery field accepts an exact ID, but never lets that ID
    // escape the explicitly selected Workspace through the original Kernel.
    const wrongScopeRecovery=await browser.page.evaluate(async ({
      other_workspace_id,object_id,service_id,
    })=>{
      const session=await globalThis.IWXA.connect({service_id});
      const focus=Object.freeze({workspace_id:other_workspace_id});
      const context={
        currentWorkspace:{get:()=>focus,subscribe:()=>()=>{}},
        kernel:{
          sessionInfo:{contract_version:session.contract_version},
          hasOperation:op=>session.granted_operations.includes(op),
          getWorkspace:id=>session.t1.getWorkspace(id),
          getObject:(ws,id)=>session.t1.getObject(ws,id),
        },
      };
      const mod=await import('/_t3/activity/local-inference-draft.mjs');
      try{
        await mod.getLocalInferenceDraft(context,{
          expected_workspace_id:other_workspace_id,object_id,
        });
        return {denied:false};
      }catch(error){
        return {denied:true,code:error.code||error.message};
      }
    },{other_workspace_id:foreign_id,object_id:d5LostAck.object_id,
       service_id:WRITER});
    assert.equal(wrongScopeRecovery.denied,true,
      "T3_D5_COLD_RECOVERY_MUST_NOT_OPEN_FOREIGN_WORKSPACE_DRAFT");

    assert.equal(d5ColdOne.opened?.readback,true,'T3_D5_KERNEL_EXACT_DRAFT_REOPEN_MISSING');
    assert.equal(d5ColdOne.opened?.text,
      'An explicitly reviewed synthetic draft for the original Kernel');
    assert.equal(d5ColdOne.object?.data?.status,'DRAFT_UNTRUSTED');
    assert.equal(d5ColdOne.object?.schema_id,'iwxa.local-inference.draft');
    assert.equal(d5ColdOne.object?.data?.model_id,'SYNTHETIC_MODEL_NOT_EXECUTED');
    assert.ok(d5ColdOne.events.some(e=>e.event_id===d5Draft.event_id));
    await browser.context.close();
    browser = null;
    browser = await openBrowser(chromium,profile,live.origin);
    const d1ColdTwo=await verifyD1AfterBrowserRestart(browser.page,d1TestStateFile,d1Receipts,
      {revoke:true});
    const d5ColdTwo=await browser.page.evaluate(async ({workspace_id,object_id,service_id})=>{
      const session=await globalThis.IWXA.connect({service_id});
      return (await session.t1.getObject(workspace_id,object_id))?.object;
    },{workspace_id:d5WorkspaceId,object_id:d5Draft.object_id,service_id:WRITER});
    assert.equal(d5ColdTwo?.data?.text,d5ColdOne.object.data.text);
    assert.equal(d5ColdTwo?.revision,d5Draft.revision);
    const report = {
      status:'T3_D2_B0_LIVE_PROJECTION_ROUNDTRIP_PASS',
      t2_head:T2_HEAD,t2_tree:T2_TREE,source_owner:'inherited-T2-inside-T3',
      kernel:KERNEL,contract:CONTRACT,artifact_id:ARTIFACT,
      archive_sha256:ARCHIVE_SHA,runtime_sha256:RUNTIME_SHA,
      workspace_id,foreign_workspace_id:foreign_id,
      receipts:{objects:receipts.object_ids.length,revisions:receipts.revisions,
        events:receipts.event_ids.length,relation_id:receipts.relation_id},
      iwxa_roundtrip:exchange,
      d4_independent_consumers:{
        status:"T3_D4_TWO_INDEPENDENT_ORIGINAL_KERNEL_CONSUMERS_PASS",
        selected_workspaces:1,consumer_count:consumerReceipts.length,
        source_workspace_id:workspace_id,archive_digest:selectedArchive.package_digest,
        bytes:selectedArchive.size,consumers:consumerReceipts,
        distinct_browser_profiles:consumerProfiles.length,
        exact_source_bytes_reused:true,original_t2_parser:true,
        both_cold_reopened:true,
      },
      independent_read_only:true,reader_write_denial:before.denied_write,stale_revision_denial:staleDenial,
      t3:same,tombstone,process_restarted:true,profile_reused:true,projection_mutation_delta:0,
      snapshot_sha256:sha(Buffer.from(canonical(before.source))),
      d5_local_draft:{
        status:"T3_D5_ORIGINAL_T2_SAVE_READBACK_PASS",
        explicit_reopen_through_original_kernel_after_cold_restart:true,
        lost_ack_original_kernel_commit_recovered_after_restart:true,
        lost_ack_created_object_count:d5LostAck.identical_records,
        workspace_id:d5WorkspaceId,object_id:d5Draft.object_id,
        event_id:d5Draft.event_id,revision:d5Draft.revision,
        readback_after_two_cold_restarts:true,
        model_inference_executed:false,model_source:"SYNTHETIC",
        native_webgpu_qualified:false,
      },
      d1_real_t2_kernel:{
        status:"T3_D1_LIVE_KERNEL_TEST_OWNER_PASS",
        selected_subjects:d1Receipts.map(x=>x.kind),
        workspace_count:d1Receipts.length,
        event_count:d1Receipts.length*3,
        workspace_lifecycle_roundtrip:true,
        single_subject_iwxa_export_confirm:true,
        subject_workspace_purge_after_second_readback:
          d1ColdTwo.purge_workspace_after_readback,
        first_cold_restart:d1ColdOne,
        second_cold_restart:d1ColdTwo,
        browser_process_restarts:2,
        authority_kind:"SYNTHETIC_CONTRACT_ONLY",
        signed_owner_product_e2e:false,
      },
    };
    const evidence = process.env.IWXA_T3_PRIVATE_EVIDENCE_FILE;
    if (evidence) {
      const target=resolve(evidence);
      assert.ok(!inside(t2Source,target) && !inside(MODULE_ROOT,target),
        'EVIDENCE_OUTSIDE_SOURCE_REQUIRED');
      writeFileSync(target,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    }
    process.stdout.write(JSON.stringify(report)+'\n');
  } finally {
    if(browser) await browser.context.close().catch(()=>{});
    if(live) await new Promise(done=>live.server.close(done));
    if(witness) witness.cleanup();
    if(stage) stage.cleanup();
    process.chdir(originalCwd);
    rmSync(temp,{recursive:true,force:true});
  }
}
run().catch(error=>{
  process.stderr.write((error?.stack||String(error))+'\n');
  process.exitCode=1;
});
