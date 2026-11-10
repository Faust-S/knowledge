/**
 * Produce a real .iwxa for final Exchange UI qualification.
 * Uses the accepted Kernel and its export API, never a hand-made ZIP.
 * Usage (from canonical-source/):
 *   node scripts/create-exchange-ui-archive.mjs <verified-candidate-dist> <new-output.iwxa>
 * A disposable source browser is isolated from the destination UI profile.
 */
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,relative,isAbsolute,sep} from 'node:path';
import {chromium} from 'playwright';
import {materializeIntegrationHost,serveRealKernelHost} from './real-kernel-e2e.mjs';
import {assertQualifiedKernelArtifact} from '../src/factory2/products/domain-completion/independent-browser-witness.mjs';

const release={kernel:'0.3.6',contract:'1.3.0',artifactId:'iwxa-kernel-k036-import-timestamp-20261018-qualified.1'};
const args=process.argv.slice(2);
if(args.length!==2||!args[1].toLowerCase().endsWith('.iwxa')){
  throw new Error('USAGE: node scripts/create-exchange-ui-archive.mjs <verified-candidate-dist> <new-output.iwxa>');
}
const source=resolve(args[0]),destination=resolve(args[1]),sourceRoot=resolve(import.meta.dirname,'..');
const rel=relative(sourceRoot,destination);
if(!rel||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel)))throw new Error('OUTPUT_MUST_BE_OUTSIDE_T2_SOURCE');
if(existsSync(destination))throw new Error('OUTPUT_ALREADY_EXISTS');
assertQualifiedKernelArtifact(source,release);
if(!existsSync(join(sourceRoot,'public','favicon.ico')))throw new Error('CANONICAL_SOURCE_FAVICON_MISSING');
const temp=mkdtempSync(join(tmpdir(),'iwxa-exchange-fixture-'));
const root=join(temp,'host');
let server=null,browser=null;
try{
  mkdirSync(root);
  cpSync(join(source,'_iwxa'),join(root,'_iwxa'),{recursive:true});
  assertQualifiedKernelArtifact(root,release);
  writeFileSync(join(root,'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="/favicon.ico"><script src="/_iwxa/loader.js"></script></head><body>IWXA Kernel fixture producer</body></html>');
  const live=await serveRealKernelHost(root);
  server=live.server;
  const origin=live.origin;
  // Reuse the existing valid domain, service and capability fixtures. Only
  // bind their runtime metadata to this K036 successor in the temp source host.
  const previousCwd=process.cwd();
  let setup;
  try{
    process.chdir(sourceRoot);
    setup=materializeIntegrationHost(root,origin);
  }finally{process.chdir(previousCwd);}
  setup.domain.runtime.kernel_release=release.kernel;
  setup.domain.runtime.runtime_version=release.kernel;
  setup.workspaceConfig.host.required_contract_version=release.contract;
  setup.workspaceConfig.host.required_runtime_version=release.kernel;
  writeFileSync(join(root,'_iwxa','domain.json'),JSON.stringify(setup.domain));
  writeFileSync(join(root,'workspace','workspace.config.json'),JSON.stringify(setup.workspaceConfig));

  browser=await chromium.launchPersistentContext(join(temp,'source-profile'),{
    headless:true,ignoreHTTPSErrors:true,serviceWorkers:'block',
  });
  const page=await browser.newPage();
  await page.goto(origin+'/');
  await page.waitForFunction(()=>typeof globalThis.IWXA?.connect==='function');
  const made=await page.evaluate(async()=>{
    const c=await globalThis.IWXA.connect({service_id:'iwxa.workspace.integration',required_levels:['T1','T2']});
    const required=['t1.createWorkspace','t1.putObject','t1.putRelation','t1.getObject','t2.exportPreview','t2.exportPackage','t2.confirmExport'];
    const missing=required.filter(op=>!c.granted_operations.includes(op));
    if(missing.length)throw new Error('FIXTURE_SOURCE_OPERATIONS_NOT_GRANTED:'+missing.join(','));
    const workspace='exchange-fixture-source';
    await c.t1.createWorkspace({workspace_id:workspace,profile:'generic',capabilities:[]});
    for(const [id,title] of [['object-a','Historical source A'],['object-b','Historical source B']]){
      await c.t1.putObject({workspace_id:workspace,object_id:id,
        schema_id:'iwxa.demo.note',schema_version:'1.0.0',
        data:{title,fixture:'exchange-ui-timestamp'},
        extensions:{future:{preserve:'unknown-extension'}},
        base_revision:0,event:{event_type:'fixture.object.created',payload:{object_id:id}}});
    }
    await c.t1.putRelation({workspace_id:workspace,relation_id:'fixture-link',
      from_object_id:'object-a',to_object_id:'object-b',kind:'related',
      event:{event_type:'fixture.relation.created',payload:{relation_id:'fixture-link'}}});
    const sourceA=(await c.t1.getObject(workspace,'object-a'))?.object;
    const sourceB=(await c.t1.getObject(workspace,'object-b'))?.object;
    if(!sourceA||!sourceB)throw new Error('FIXTURE_SOURCE_READBACK_MISSING');
    const options={workspaces:[workspace],include_history:true,include_relations:true,include_assets:true,include_schemas:true};
    const preview=await c.t2.exportPreview(options);
    if(preview.counts.objects!==2||preview.counts.relations!==1||preview.counts.events<3||
       preview.summary.included.objects!==2||preview.summary.included.relations!==1||preview.summary.included.events<3||
       preview.summary.excluded_by_permission.events!==0){
      throw new Error('FIXTURE_EXPORT_SCOPE_INCOMPLETE:'+JSON.stringify(preview));
    }
    const artifact=await c.t2.exportPackage(options);
    const receipt=await c.t2.confirmExport({package_digest:artifact.package_digest,workspace_ids:[workspace]});
    if(receipt.package_digest!==artifact.package_digest)throw new Error('FIXTURE_EXPORT_CONFIRMATION_MISMATCH');
    return {bytes:Array.from(artifact.bytes),counts:preview.counts,included:preview.summary.included,
      packageDigest:artifact.package_digest,workspaceId:workspace,
      objects:[sourceA,sourceB]};
  });
  assert.ok(made.bytes.length>0,'Kernel exported no .iwxa bytes');
  assert.equal(made.objects.length,2);
  mkdirSync(dirname(destination),{recursive:true});
  writeFileSync(destination,Buffer.from(made.bytes),{flag:'wx'});
  const manifest={schema:'IWXA_T2_EXCHANGE_UI_SOURCE_FIXTURE_V1',release,
    source:'REAL_QUALIFIED_KERNEL_EXPORT',productionActivation:false,
    path:destination,bytes:made.bytes.length,packageDigest:made.packageDigest,
    workspaceId:made.workspaceId,counts:made.counts,included:made.included,
    objects:made.objects};
  writeFileSync(destination+'.source.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  process.stdout.write(JSON.stringify({...manifest,objects:made.objects.map(o=>({object_id:o.object_id,updated_at:o.updated_at,revision:o.revision}))},null,2)+'\n');
}finally{
  if(browser)await browser.close().catch(()=>{});
  if(server)await new Promise(resolveClose=>server.close(resolveClose));
  rmSync(temp,{recursive:true,force:true});
}
