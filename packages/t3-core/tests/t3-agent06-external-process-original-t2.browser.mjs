// Qualify the narrow ERP-link passport on the ACTUAL inherited T2 0.3.6
// Kernel and IndexedDB Store. This is a disposable public test Host, not a
// production Agent/ERPNext, real external process, new Store or D1 issuer.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync}
  from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {planOriginalT2ExternalProcessRegistration}
  from '../src/t3/external-process-passport-registration.node.mjs';
import {EXTERNAL_PROCESS_LINK_SCHEMA,EXTERNAL_PROCESS_LINK_EVENT}
  from '../src/t3/external-process-link.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const ARTIFACT='iwxa-kernel-k036-same-store-history-20261019-qualified.1';
const DIGEST='7075b8b9590ef1283e34ecb3c21dd9d1b7342697287e1aa150cd4f4a60860b68';
const ORIGINAL='iwxa.workspace.integration';
const EXTERNAL='iwxa.agent06.external-process';
const sha=x=>createHash('sha256').update(x).digest('hex');

test('original T2 service enforces narrow ERP-link schema, revision CAS and cold readback',async()=>{
  const qualified=process.env.IWXA_T2_QUALIFIED_KERNEL_DIST;
  assert.ok(qualified,'T3_EXT_ORIGINAL_T2_QUALIFIED_DIST_REQUIRED');
  const {assertQualifiedKernelArtifact}=await import(
    '../src/factory2/products/domain-completion/independent-browser-witness.mjs');
  const {materializeIntegrationHost,serveRealKernelHost}=await import(
    '../scripts/real-kernel-e2e.mjs');
  const {chromium}=await import('playwright');
  const tmp=mkdtempSync(join(tmpdir(),'iwxa-external-link-original-t2-'));
  const oldCwd=process.cwd();
  let serving=null,browser=null;
  try{
    const dist=join(tmp,'dist');
    mkdirSync(dist);
    cpSync(join(realpathSync(resolve(qualified)),'_iwxa'),join(dist,'_iwxa'),
      {recursive:true});
    const verified=assertQualifiedKernelArtifact(dist,{
      kernel:'0.3.6',contract:'1.3.0',artifactId:ARTIFACT});
    assert.equal(verified.archiveSha256,DIGEST);
    process.chdir(ROOT); // Existing Host fixture's public/favicon.ico
    const host=materializeIntegrationHost(dist,'https://127.0.0.1');
    host.domain.runtime.kernel_release='0.3.6';
    host.domain.runtime.runtime_version='0.3.6';
    host.workspaceConfig.host.required_runtime_version='0.3.6';
    host.workspaceConfig.host.required_contract_version='1.3.0';
    const writerFile='_iwxa/services/'+ORIGINAL+'.json';
    const writerBytes=readFileSync(join(dist,writerFile));
    const catalog={contract_version:'1.3.0',count:1,entries:[{
      service_id:ORIGINAL,
      service_version:host.passport.service_version,
      base_path:host.passport.base_path,
      supported_levels:host.passport.supported_levels,
      file:writerFile,sha256:sha(writerBytes),
    }]};
    const plan=planOriginalT2ExternalProcessRegistration({
      domain:host.domain,catalog,controlPlane:host.controlPlane});
    assert.equal(plan.catalog.count,2);
    writeFileSync(join(dist,'_iwxa/domain.json'),JSON.stringify(plan.domain));
    writeFileSync(join(dist,'workspace/workspace.config.json'),
      JSON.stringify(host.workspaceConfig));
    writeFileSync(join(dist,'_iwxa/security/capability-control-plane.json'),
      JSON.stringify(plan.controlPlane));
    writeFileSync(join(dist,'_iwxa/service-catalog.json'),
      JSON.stringify(plan.catalog));
    writeFileSync(join(dist,plan.passport_file),plan.passport_bytes);
    assert.equal(sha(readFileSync(join(dist,plan.passport_file))),
      plan.passport_sha256);
    serving=await serveRealKernelHost(dist,{
      independentWitness:true,previewOrigin:true});
    const profile=join(tmp,'browser-profile');
    const open=async()=>{
      browser=await chromium.launchPersistentContext(profile,{
        headless:true,ignoreHTTPSErrors:true,serviceWorkers:'block'});
      const page=browser.pages()[0]??await browser.newPage();
      await page.goto(serving.origin+'/__t2_independent_readback__',
        {waitUntil:'load'});
      await page.waitForFunction(()=>typeof globalThis.IWXA?.connect==='function');
      return page;
    };
    const ws='t3-ext-real-'+randomUUID();
    const obj='external-link:original-kernel-real-test';
    let page=await open();
    const written=await page.evaluate(async({ws,obj,ORIGINAL,EXTERNAL,SCHEMA,EVENT})=>{
      const writer=await globalThis.IWXA.connect({service_id:ORIGINAL});
      const link=await globalThis.IWXA.connect({service_id:EXTERNAL});
      const grants=link.granted_operations;
      if(link.contract_version!=='1.3.0'||link.runtime_version!=='0.3.6')
        throw Error('T3_EXT_ORIGINAL_T2_VERSION_MISMATCH');
      if(!['t1.getWorkspace','t1.getObject','t1.putObject'].every(x=>grants.includes(x)))
        throw Error('T3_EXT_NARROW_LINK_METHOD_MISSING');
      if(['t1.createWorkspace','t1.deleteObject','t2.exportPackage','t2.importCommit']
        .some(x=>grants.includes(x)))
        throw Error('T3_EXT_PASSPORT_WRITABLE_SCOPE_TOO_BROAD');
      await writer.t1.createWorkspace({workspace_id:ws,profile:'generic'});
      const data={source_owner:'erpnext:shop1',record_kind:'Sales Order',
        record_id:'SO-0042',source_revision:'2026-11-15 13:00:00.1000',
        source_digest:'a'.repeat(64),source_receipt:null,
        source_state:'Submitted',epistemic_status:'reported',
        record_authority:'EXTERNAL_OWNER'};
      const put=async(base_revision,source_revision)=>{
        const snapshot={...data,source_revision};
        return link.t1.putObject({workspace_id:ws,object_id:obj,
          schema_id:SCHEMA,schema_version:'1.0.0',
          base_revision,data:snapshot,extensions:{},
          event:{event_type:EVENT,payload:{
            source_owner:data.source_owner,record_kind:data.record_kind,
            record_id:data.record_id,source_revision,
            epistemic_status:'reported',
          }}});
      };
      const first=await put(0,data.source_revision);
      const second=await put(1,'2026-11-15 13:01:00.2000');
      let staleDenied=false;
      try{await put(1,'2026-11-15 13:02:00.3000')}
      catch{staleDenied=true}
      let foreignDenied=false;
      try{await link.t1.putObject({workspace_id:ws,object_id:'foreign-test',
        schema_id:'iwxa.demo.note',schema_version:'1.0.0',base_revision:0,
        data:{title:'must not save'},extensions:{},
        event:{event_type:'test.unapproved',payload:{}}})}
      catch{foreignDenied=true}
      const read=await link.t1.getObject(ws,obj);
      return {first:first?.object?.revision,second:second?.object?.revision,
        latest:read?.object?.revision,snapshot:read?.object?.data,
        events:[first?.event?.event_id,second?.event?.event_id],
        staleDenied,foreignDenied,canExport:grants.includes('t2.exportPackage')};
    },{ws,obj,ORIGINAL,EXTERNAL,SCHEMA:EXTERNAL_PROCESS_LINK_SCHEMA,
      EVENT:EXTERNAL_PROCESS_LINK_EVENT});
    assert.equal(written.first,1);
    assert.equal(written.second,2);
    assert.equal(written.latest,2);
    assert.equal(written.snapshot.epistemic_status,'reported');
    assert.equal(written.snapshot.source_revision,'2026-11-15 13:01:00.2000');
    assert.deepEqual(written.events.every(x=>typeof x==='string'),true);
    assert.equal(written.staleDenied,true);
    assert.equal(written.foreignDenied,true);
    assert.equal(written.canExport,false);
    await browser.close();browser=null;
    page=await open();
    const reopened=await page.evaluate(async({ws,obj,EXTERNAL})=>{
      const link=await globalThis.IWXA.connect({service_id:EXTERNAL});
      const x=await link.t1.getObject(ws,obj);
      const history=await link.t1.listEventsSince(ws);
      return {revision:x?.object?.revision,
        source_revision:x?.object?.data?.source_revision,
        eventTypes:history.map(e=>e.event_type)};
    },{ws,obj,EXTERNAL});
    assert.equal(reopened.revision,2);
    assert.equal(reopened.source_revision,written.snapshot.source_revision);
    assert.equal(reopened.eventTypes.filter(e=>e===EXTERNAL_PROCESS_LINK_EVENT).length,2);
    console.log('T3_AGENT06_ORIGINAL_T2_ERP_LINK_PASSPORT_COLD_PASS',
      JSON.stringify({kernel:'0.3.6',contract:'1.3.0',
        revision:reopened.revision,originalEventCount:2,
        staleDenied:written.staleDenied,foreignDenied:written.foreignDenied}));
  }finally{
    if(browser)await browser.close().catch(()=>{});
    if(serving){
      serving.server.closeAllConnections();
      await new Promise(done=>serving.server.close(()=>done()));
    }
    process.chdir(oldCwd);
    rmSync(tmp,{recursive:true,force:true});
  }
});
