// Public T3 owner integration test: one real qualified T2 Kernel and Store,
// extended with T3 activity semantic projection, with real browser restart.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
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
const {stageT3ActivityWitness} = await import(pathToFileURL(join(MODULE_ROOT,"t2-host-witness.mjs")).href);
const {
  createRealT2ActivityFixture,
  readRealT2ActivitySource,
  proveRealT2ReadOnlyProjection,
  proveRealT2StaleRevisionDenied,
  verifyRealT2ColdRestart,
  verifyRealT2UnknownAndTombstone,
  roundTripRealT2Iwxa,
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
    const passportFile = '_iwxa/services/' + WRITER + '.json';
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
    const d5ColdOne=await browser.page.evaluate(async ({workspace_id,object_id,service_id})=>{
      const session=await globalThis.IWXA.connect({service_id});
      const detail=await session.t1.getObject(workspace_id,object_id);
      const events=await session.t1.listEventsSince(workspace_id);
      return {object:detail?.object,events};
    },{workspace_id:d5WorkspaceId,object_id:d5Draft.object_id,service_id:WRITER});
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
      independent_read_only:true,reader_write_denial:before.denied_write,stale_revision_denial:staleDenial,
      t3:same,tombstone,process_restarted:true,profile_reused:true,projection_mutation_delta:0,
      snapshot_sha256:sha(Buffer.from(canonical(before.source))),
      d5_local_draft:{
        status:"T3_D5_ORIGINAL_T2_SAVE_READBACK_PASS",
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
