// Real original Kernel and ArtBazy commands. Only IndexedDB is the original
// Kernel test dependency (fake-indexeddb), and fetch is local file transport.
// No browser/physical persistence/PRODUCT_ACCEPTED claim.
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [rootArg, siteArg, dependencyArg] = process.argv.slice(2);
const root = realpathSync(resolve(rootArg)), site = realpathSync(resolve(siteArg)), dep = realpathSync(resolve(dependencyArg));
await import(pathToFileURL(join(dep, 'node_modules/fake-indexeddb/auto/index.mjs')).href);
const {IDBFactory}=globalThis;
assert.equal(typeof IDBFactory,'function');
const service='ru.iwxa.artbazy.workspace';
const schema='ru.iwxa.artbazy.calculation-result';
const file='_iwxa/services/'+service+'.json';
const origin='https://artbazy.ru';
const json=p=>JSON.parse(readFileSync(join(root,p),'utf8'));
const domain=json('_iwxa/domain.json'),current=json('_iwxa/current.json');
const runtimeFile=join(root,current.runtime_url.slice(1));
assert.equal(createHash('sha256').update(readFileSync(runtimeFile)).digest('hex'),'e1737245aba309e900203b458087ca07cb08d9ccc89901754e1122cbc9a01e78');
const runtime=await import(pathToFileURL(runtimeFile).href);
const {preparePublicCalculationDraft}=await import(pathToFileURL(join(site,'runtime/artbazy-module/w5-calculation-service.mjs')).href);
const owner=await import(pathToFileURL(join(site,'runtime/artbazy-module/w5-calculation-owner.mjs')).href);
const catalog=JSON.parse(readFileSync(join(site,'runtime/artbazy-module/service-catalog.json'),'utf8'));
const originalFetch=globalThis.fetch;
globalThis.fetch=async input=>{
  const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,origin);
  assert.equal(u.origin,origin);
  assert([file,'_iwxa/security/capability-control-plane.json'].includes(u.pathname.slice(1)),'UNEXPECTED_FETCH');
  return new Response(readFileSync(join(root,u.pathname.slice(1))),{headers:{'Content-Type':'application/json'}});
};
const ws='MODEL-ARTBAZY-CALC',other='MODEL-OTHER-WORKSPACE';
const id=n=>'calc-00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const scope={workspace_id:ws,subject_ref:'MODEL-COMPANY',object_ref:'MODEL-SKU',object_revision:'R1',period_from:'2026-11-01',period_through:'2026-11-30',unit:'шт',currency:'RUB',tax_basis:'VAT_EXCLUDED',comparison_ref:'MODEL-NOV-BASE'};
const draft=preparePublicCalculationDraft({tool_id:'contribution-margin',source_path:'/tools/contribution-margin/',title:'Unit economics fixture',sections:[{heading:'Calculation',paragraph:'Control scenario'}],typed_inputs:{price_minor:120000,variable_minor:84000,units:120,fixed_minor:3000000}});
const args={workspace_id:ws,object_id:id(1),draft,scope};
const link={workspace_id:ws,object_id:id(2),source_object_id:id(1),source_revision:1,discount_bps:1000};
const request={service_id:service,required_levels:['T0','T1','T2']}, connection={domain,current,origin};
let client,ctx;
const results=[];
async function connect(factory,workspace=ws){
  globalThis.indexedDB=factory;
  runtime.__resetKernelStoreForTests();
  client=await runtime.connect(request,connection);
  const focus=await client.t1.getWorkspace(workspace);
  ctx={profile:{id:'organization',fallback:false},currentWorkspace:{get:()=>focus,subscribe:()=>()=>{}},kernel:{
    ...client.t1,sessionInfo:{service_id:service,contract_version:client.contract_version},
    hasOperation:op=>client.granted_operations.includes(op)
  }};
  return client;
}
async function pass(name,fn){await fn();results.push(name);console.log('ARTBAZY_STORAGE_PASS='+name);}
try{
 const factory=new IDBFactory();
 await pass('CREATE_WORKSPACES',async()=>{await connect(factory);await client.t1.createWorkspace({workspace_id:ws,profile:'organization'});await client.t1.createWorkspace({workspace_id:other,profile:'organization'});await connect(factory);assert.equal(ctx.currentWorkspace.get().workspace_id,ws)});
 let saved,linked;
 await pass('SAVE_AND_READ_CALCULATION',async()=>{
   saved=await owner.saveCalculationDraft(ctx,catalog,args);
   assert.equal(saved.status,'READBACK_CONFIRMED');assert.equal(saved.object.data.calculation.metrics.unit_contribution_minor,36000);
   assert.equal(saved.object.revision,1);
 });
 await pass('SAVE_LINKED_DISCOUNT_AND_RELATION',async()=>{
   linked=await owner.saveLinkedDiscount(ctx,catalog,link);
   assert.equal(linked.status,'READBACK_CONFIRMED');assert.equal(linked.source_state,'SOURCE_REVISION_READBACK');
   assert.equal(linked.object.data.calculation.metrics.required_units_to_keep_selected_contribution,180);
   const row=await client.t1.getObject(ws,id(2));assert(row.relations.outgoing.some(x=>x.kind==='derived_from'&&x.to_object_id===id(1)));
 });
 await pass('RETRY_WITHOUT_SECOND_WRITE',async()=>{
   const events=await client.t1.listEventsSince(ws);
   assert.equal((await owner.saveCalculationDraft(ctx,catalog,args)).status,'READBACK_CONFIRMED_EXISTING');
   assert.equal((await owner.saveLinkedDiscount(ctx,catalog,link)).status,'READBACK_CONFIRMED_EXISTING');
   assert.equal((await client.t1.listEventsSince(ws)).length,events.length);
 });
 await pass('WORKSPACE_ISOLATION',async()=>{
   assert.equal((await client.t1.listObjects({workspace_id:other})).length,0);
   assert.equal(await client.t1.getObject(other,id(1)),null);
   await assert.rejects(owner.saveCalculationDraft(ctx,catalog,{...args,workspace_id:other,scope:{...scope,workspace_id:other}}),/CALC_WORKSPACE_FOCUS_REQUIRED/);
 });
 await pass('REOPEN_ORIGINAL_STORE_AND_READBACK',async()=>{
   await connect(factory);
   const actual=await owner.readCalculationDraft(ctx,catalog,{workspace_id:ws,object_id:id(2)});
   assert.deepEqual(actual.object,linked.object);assert.equal(actual.source_state,'SOURCE_REVISION_READBACK');
   assert.equal((await owner.listCalculationDrafts(ctx,catalog,{workspace_id:ws})).items.length,2);
 });
 let artifact;
 const exportOptions={workspaces:[ws],include_history:true,include_assets:true,include_relations:true,include_schemas:true};
 await pass('ORIGINAL_IWXA_EXPORT',async()=>{
   const preview=await client.t2.exportPreview(exportOptions);
   assert.equal(preview.counts.objects,2);assert.equal(preview.counts.relations,1);
   artifact=await client.t2.exportPackage(exportOptions);
   assert(artifact.filename.endsWith('.iwxa'));assert(artifact.bytes.length>0);assert.equal(artifact.validation.ok,true);
   assert.equal(artifact.manifest.counts.objects,2);assert.equal(artifact.manifest.counts.relations,1);
 });
 const receiver=new IDBFactory();
 await pass('IMPORT_INDEPENDENT_EMPTY_STORE',async()=>{
   await connect(receiver);
   assert.equal((await client.t1.listWorkspaces()).length,0);
   const p=await client.t2.importPreview(artifact.bytes);
   assert.equal(p.preview.totals.objects,2);assert.equal(p.preview.totals.relations,1);
   assert(p.allowed_modes.includes('full'));
   const receipt=await client.t2.importCommit({preview_token:p.preview_token,package_digest:p.package_digest,plan:{mode:'full',conflict:'fail',include_history:true,include_assets:true,include_relations:true}});
   assert.equal(receipt.applied.objects_inserted,2);assert.equal(receipt.applied.relations,1);
   await connect(receiver);
   assert.deepEqual((await client.t1.getObject(ws,id(1))).object.data,saved.object.data);
   assert.deepEqual((await client.t1.getObject(ws,id(2))).object.data,linked.object.data);
   const r=await owner.readCalculationDraft(ctx,catalog,{workspace_id:ws,object_id:id(2)});
   assert.equal(r.source_state,'SOURCE_REVISION_READBACK');
   assert.equal(r.object.data.calculation.metrics.required_units_to_keep_selected_contribution,180);
 });
 await pass('SOURCE_STORE_UNCHANGED',async()=>{
   await connect(factory);
   assert.equal((await client.t1.listObjects({workspace_id:ws})).length,2);
   assert.deepEqual((await client.t1.getObject(ws,id(1))).object,saved.object);
   assert.deepEqual((await client.t1.getObject(ws,id(2))).object,linked.object);
 });
 console.log(JSON.stringify({status:'ORIGINAL_KERNEL_STORAGE_AND_EXCHANGE_PASS',passed:results.length,indexedDB:'fake-indexeddb@6.2.5',runtime:runtime.RUNTIME_VERSION,browser:'NOT_RUN',coldProcessRestart:'NOT_RUN',productAccepted:false}));
}catch(e){
 console.error('ARTBAZY_STORAGE_FAILED_AT='+results.length+' CODE='+(typeof e.code==='string'?e.code:'ASSERTION_OR_RUNTIME'));
 // Error message is from a synthetic test; no source, customer data or credentials.
 console.error(String(e.message).slice(0,500));process.exitCode=1;
}finally{globalThis.fetch=originalFetch;}
