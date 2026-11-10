import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {qualifyFactory2DomainProduct,verifyFactory2DomainProduct} from '../src/factory2/products/domain-completion/product-completion.mjs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {build} from 'vite';
import {materializeIntegrationHost,serveRealKernelHost} from '../scripts/real-kernel-e2e.mjs';
import {runIndependentSiteWitness,assertQualifiedKernelArtifact,stageQualificationReader} from '../src/factory2/products/domain-completion/independent-browser-witness.mjs';
const sourceRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function runDomainCli(...args){const cli=resolve(sourceRoot,'scripts/factory2-domain-run-cli.mjs');const r=spawnSync(process.execPath,[cli,...args],{cwd:sourceRoot,encoding:'utf8',env:process.env});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
function rejectDomainCli(...args){const cli=resolve(sourceRoot,'scripts/factory2-domain-run-cli.mjs');const r=spawnSync(process.execPath,[cli,...args],{cwd:sourceRoot,encoding:'utf8',env:process.env});assert.notEqual(r.status,0);return r.stderr;}
const publicCalculatorHtml='<!doctype html><title>Neutral site calculator</title><nav><a id="public-nav" href="/">Calculator</a> <a id="workspace-nav" href="/workspace/">Workspace</a></nav><h1>Local calculator</h1><label>Left<input id="left" type="number"></label><label>Right<input id="right" type="number"></label><button id="calculate">Add</button><output id="sum"></output><script>document.querySelector("#calculate").onclick=()=>{document.querySelector("#sum").textContent=String(Number(document.querySelector("#left").value)+Number(document.querySelector("#right").value));};</script>';
async function verifyPublicCalculator(buildRoot,playwrightUrl,integratedOrigin=null){
 const {createServer}=await import('node:http'),{readFileSync}=await import('node:fs'),{join}=await import('node:path');
 const {chromium}=await import(playwrightUrl);
 const check=(value,message)=>{if(!value)throw new Error(message);};
 let kernelRequests=0;
 const server=createServer((req,res)=>{if(req.url?.startsWith('/_iwxa'))kernelRequests++;if(req.url!=='/'){res.writeHead(503);res.end('Kernel is stopped');return;}res.setHeader('Content-Type','text/html');res.end(readFileSync(join(buildRoot,'index.html')));});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({ignoreHTTPSErrors:true});
  const calculate=async(a,b,expected)=>{await page.locator('#left').fill(String(a));await page.locator('#right').fill(String(b));await page.locator('#calculate').click();check(await page.locator('#sum').textContent()===String(expected),'PUBLIC_CALCULATION_FAILED');};
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await calculate(6,7,13);
  check(await page.evaluate(()=>typeof globalThis.IWXA==='undefined'),'PUBLIC_REQUIRES_KERNEL');
  await page.reload();await calculate(20,22,42);check(kernelRequests===0,'PUBLIC_REQUESTED_KERNEL');
  check(await page.locator('#workspace-nav').getAttribute('href')==='/workspace/','PUBLIC_NAVIGATION_MISSING');
  if(integratedOrigin){
   await page.goto(integratedOrigin+'/');await calculate(6,7,13);
   await page.locator('#workspace-nav').click();await page.locator('#save').waitFor({state:'visible'});
   check(new URL(page.url()).origin===integratedOrigin,'SEPARATE_HOST_SITE');
   await page.locator('#public-nav').click();await calculate(20,22,42);
  }
  return {status:'PASS',withoutKernel:true,kernelRequests,afterReload:true,unifiedNavigation:!!integratedOrigin};
 }finally{if(browser)await browser.close();await new Promise(done=>server.close(done));}
}
const kernel=process.env.IWXA_T2_QUALIFIED_KERNEL_DIST;
const version=process.env.IWXA_T2_QUALIFIED_KERNEL_VERSION??'0.3.6',runtimeContract=version==='0.3.5'?'1.2.0':'1.3.0';
if(!kernel)throw new Error('IWXA_T2_QUALIFIED_KERNEL_DIST_REQUIRED');
const root=mkdtempSync(join(tmpdir(),'t2-real-product-'));
const dist=join(root,'dist');mkdirSync(dist);
cpSync(resolve(kernel,'_iwxa'),join(dist,'_iwxa'),{recursive:true});
const qualifiedManifest=JSON.parse(readFileSync(new URL('../src/factory2/products/domain-completion/qualified-kernel-artifact.json',import.meta.url),'utf8'));
const exactReleases=qualifiedManifest.artifacts.filter(release=>
 release.kernel===version&&release.contract===runtimeContract&&release.files.every(file=>{
  const path=join(dist,file.path);
  return existsSync(path)&&createHash('sha256').update(readFileSync(path)).digest('hex')===file.sha256;
 }));
assert.equal(exactReleases.length,1,'QUALIFIED_TEST_KERNEL_ARTIFACT_AMBIGUOUS_OR_UNAVAILABLE');
const exactRelease=exactReleases[0];
// Never choose by the Kernel version alone: the selected bytes establish the
// exact release; newer accepted bytes are selected explicitly in the contract.
if(exactRelease.artifactId)assert.equal(exactRelease.releaseAccepted,true,'UNACCEPTED_TEST_KERNEL_ARTIFACT');
const runtimeSelection=exactRelease.artifactId?{artifactId:exactRelease.artifactId}:{};
assertQualifiedKernelArtifact(dist,{kernel:version,contract:runtimeContract,...runtimeSelection});
const host=materializeIntegrationHost(dist,'https://127.0.0.1');
host.domain.runtime.kernel_release=version;host.domain.runtime.runtime_version=version;
host.domain.modules.push({service_id:'iwxa.workspace.reader',base_path:'/workspace/'});
writeFileSync(join(dist,'_iwxa/domain.json'),JSON.stringify(host.domain));
host.workspaceConfig.host.required_runtime_version=version;host.workspaceConfig.host.required_contract_version=runtimeContract;
writeFileSync(join(dist,'workspace/workspace.config.json'),JSON.stringify(host.workspaceConfig));
// Supply a source-owned catalog entry in this disposable real-Kernel fixture.
const passportFile='_iwxa/services/'+host.passport.service_id+'.json';
const passportBytes=readFileSync(join(dist,passportFile));
writeFileSync(join(dist,'_iwxa/service-catalog.json'),JSON.stringify({count:1,entries:[{
 service_id:host.passport.service_id,service_version:host.passport.service_version,
 base_path:host.passport.base_path,supported_levels:host.passport.supported_levels,
 file:passportFile,sha256:createHash('sha256').update(passportBytes).digest('hex')
}]}));
const reader={...host.passport,service_id:'iwxa.workspace.reader',permissions:{...host.passport.permissions,workspace:{...host.passport.permissions.workspace,create:false},objects:{read:['*'],write:[],delete:[]}}};
writeFileSync(join(dist,'_iwxa/services/iwxa.workspace.reader.json'),JSON.stringify(reader));
host.controlPlane.services.push({...host.controlPlane.services[0],service_id:reader.service_id});
writeFileSync(join(dist,'_iwxa/security/capability-control-plane.json'),JSON.stringify(host.controlPlane));
const code=`import {createKernelFacade} from '${sourceRoot.replaceAll('\\','/')}/src/workspace-host/context/create-kernel-facade.ts';
document.querySelector('#save').onclick=async()=>{try{
const session=await IWXA.connect({service_id:'iwxa.workspace.integration'});
const kernel=createKernelFacade({session});
const workspaceId='product-ws';if(!await kernel.getWorkspace(workspaceId))await kernel.createWorkspace({workspace_id:workspaceId,profile:'generic'});
const objectId='product-'+crypto.randomUUID();
await kernel.putObject({workspace_id:workspaceId,object_id:objectId,schema_id:'iwxa.demo.note',schema_version:'1.0.0',base_revision:0,data:{title:document.querySelector('#title').value},extensions:{},event:{event_type:'user.note.created',payload:{}}});
const node=document.querySelector('#result');node.dataset.t2WorkspaceId=workspaceId;node.dataset.t2ObjectId=objectId;node.hidden=false;
}catch(e){document.querySelector('#error').textContent=e.stack;throw e;}};`;
const entry=join(root,'real-product.ts');writeFileSync(entry,code);await build({configFile:false,resolve:{alias:{'@':join(sourceRoot,'src')}},build:{outDir:join(dist,'workspace'),emptyOutDir:false,minify:false,lib:{entry,formats:['es'],fileName:()=> 'app.js'}}});
const html='<!doctype html><title>Native Product fixture</title><nav><a id="public-nav" href="/">Calculator</a> <a id="workspace-nav" href="/workspace/">Workspace</a></nav><input id="title" aria-label="Title"><button id="save">Save</button><output id="result" hidden>Saved</output><pre id="error"></pre><script type="module" src="/workspace/app.js"></script>';
writeFileSync(join(dist,'workspace/index.html'),html);
const inventory={persistentFamilies:['note'],serviceIds:['iwxa.workspace.integration'],routes:['/workspace/']};
const contract={runtime:{kernel:version,contract:runtimeContract,...runtimeSelection,hostConfiguration:{path:'workspace/workspace.config.json',sha256:createHash('sha256').update(readFileSync(join(dist,'workspace/workspace.config.json'))).digest('hex')}},witness:{previewOrigin:'LOOPBACK_TLS',runner:'T2_PLAYWRIGHT_KERNEL_READBACK',journeys:[{serviceId:'iwxa.workspace.integration',readServiceId:reader.service_id,denyServiceId:reader.service_id,family:'note',schemaId:'iwxa.demo.note',route:'/workspace/',resultSelector:'#result',actions:[{type:'fill',selector:'#title',value:'User note {{T2_CHALLENGE}}'},{type:'click',selector:'#save'}]}]}};
const QUALIFICATION_READER_ID='iwxa.t2.qualification.reader';
const isolatedContract={...contract,witness:{...contract.witness,
 auditorMode:'ISOLATED_READ_ONLY',
 journeys:contract.witness.journeys.map(j=>({...j,readServiceId:QUALIFICATION_READER_ID,denyServiceId:QUALIFICATION_READER_ID}))
}};
// Probe the actual qualified Kernel: no local JSON-only substitute can pass.
async function probeQualificationReader(root,fn){
 const live=await serveRealKernelHost(root,{independentWitness:true,previewOrigin:true});
 const profile=mkdtempSync(join(tmpdir(),'t2-reader-connect-'));
 let context;
 try{
  const {chromium}=await import('playwright');
  context=await chromium.launchPersistentContext(profile,{headless:true,ignoreHTTPSErrors:true,serviceWorkers:'block'});
  const page=context.pages()[0]||await context.newPage();
  await page.goto(live.origin+'/__t2_independent_readback__',{waitUntil:'load'});
  return await page.evaluate(fn,QUALIFICATION_READER_ID);
 }finally{
  if(context)await context.close().catch(()=>{});
  await new Promise(done=>live.server.close(done));
  rmSync(profile,{recursive:true,force:true});
 }
}
test('real Kernel rejects former isolated auditor passport with workspace package scopes',async()=>{
 const stage=stageQualificationReader(dist,isolatedContract.witness);
 const stagedRoot=stage.root;
 try{
  const readerPath=join(stagedRoot,'_iwxa/services/'+QUALIFICATION_READER_ID+'.json');
  const legacy=JSON.parse(readFileSync(readerPath,'utf8'));
  legacy.permissions.packages.export_scope='workspace';
  legacy.permissions.packages.import_scope='workspace';
  const bytes=Buffer.from(JSON.stringify(legacy,null,2));
  writeFileSync(readerPath,bytes);
  const catalogPath=join(stagedRoot,'_iwxa/service-catalog.json');
  const catalog=JSON.parse(readFileSync(catalogPath,'utf8'));
  const entry=catalog.entries.find(e=>e.service_id===QUALIFICATION_READER_ID);
  assert.ok(entry);
  entry.sha256=createHash('sha256').update(bytes).digest('hex');
  writeFileSync(catalogPath,JSON.stringify(catalog));
  const result=await probeQualificationReader(stagedRoot,async serviceId=>{
   try{await globalThis.IWXA.connect({service_id:serviceId});return {accepted:true};}
   catch(e){return {accepted:false,code:e?.code??null,message:String(e?.message??e)};}
  });
  assert.equal(result.accepted,false);
  assert.equal(result.code,'PASSPORT_INVALID');
 }finally{
  stage.cleanup();
  assert.equal(existsSync(stagedRoot),false);
 }
});
test('real Kernel connects isolated read-only auditor; reads history and rejects all mutations',async()=>{
 const stage=stageQualificationReader(dist,isolatedContract.witness);
 const stagedRoot=stage.root;
 try{
  const result=await probeQualificationReader(stagedRoot,async serviceId=>{
   const producer=await globalThis.IWXA.connect({service_id:'iwxa.workspace.integration'});
   const workspaceId='reader-probe';
   const objectId='reader-existing';
   await producer.t1.createWorkspace({workspace_id:workspaceId,profile:'generic'});
   const receipt=await producer.t1.putObject({
    workspace_id:workspaceId,object_id:objectId,schema_id:'iwxa.demo.note',
    schema_version:'1.0.0',base_revision:0,data:{title:'reader permission baseline'},
    event:{event_type:'test.reader.baseline',payload:{source:'authorized-producer'}}
   });
   const session=await globalThis.IWXA.connect({service_id:serviceId});
   const grants=[...session.granted_operations].sort();
   const readBefore=await session.t1.getObject(workspaceId,objectId);
   const historyBefore=await session.t1.listEventsSince(workspaceId);
   const workspacesBefore=await session.t1.listWorkspaces();
   const denied=[];
   const attempt=async(name,invoke)=>{
    if(typeof invoke!=='function')return {name,denied:false,reason:'METHOD_MISSING'};
    try{await invoke();return {name,denied:false,reason:'SUCCEEDED'};}
    catch(e){
     const code=String(e?.code??''),message=String(e?.message??e);
     return {name,denied:['PERMISSION_DENIED','OPERATION_NOT_GRANTED','NOT_GRANTED','AUTHORIZATION_DENIED','ACCESS_DENIED'].includes(code)||
      /operation not granted|permission denied|authorization denied|access denied/i.test(message),code,message};
    }
   };
   denied.push(await attempt('createWorkspace',()=>session.t1.createWorkspace({workspace_id:'reader-extra',profile:'generic'})));
   denied.push(await attempt('putObject',()=>session.t1.putObject({
    workspace_id:workspaceId,object_id:'reader-denied',schema_id:'iwxa.demo.note',
    schema_version:'1.0.0',base_revision:0,data:{title:'must never be written'},
    event:{event_type:'test.denied',payload:{}}
   })));
   denied.push(await attempt('deleteObject',()=>session.t1.deleteObject({
    workspace_id:workspaceId,object_id:objectId,base_revision:receipt.object.revision,
    event:{event_type:'test.denied',payload:{}}
   })));
   denied.push(await attempt('softDeleteWorkspace',()=>session.t1.softDeleteWorkspace(workspaceId)));
   denied.push(await attempt('restoreWorkspace',()=>session.t1.restoreWorkspace(workspaceId)));
   denied.push(await attempt('purgePreview',()=>session.t1.purgePreview({workspace_id:workspaceId})));
   denied.push(await attempt('exportPreview',()=>session.t2.exportPreview({workspaces:[]})));
   denied.push(await attempt('importPreview',()=>session.t2.importPreview(new Uint8Array([0x50,0x4b,0x03,0x04]))));
   const readAfter=await session.t1.getObject(workspaceId,objectId);
   const historyAfter=await session.t1.listEventsSince(workspaceId);
   const workspacesAfter=await session.t1.listWorkspaces();
   return {
    grants,serviceId:session.service.service_id,contract:session.contract_version,
    workspaceVisible:workspacesBefore.some(w=>w.workspace_id===workspaceId),
    objectVisible:readBefore?.object?.object_id===objectId,
    historyVisible:historyBefore.some(e=>e.event_id===receipt.event.event_id&&e.object_id===objectId),
    stateUnchanged:JSON.stringify([readBefore,historyBefore,workspacesBefore])===
      JSON.stringify([readAfter,historyAfter,workspacesAfter]),
    denied
   };
  });
  assert.equal(result.serviceId,QUALIFICATION_READER_ID);
  assert.equal(result.contract,runtimeContract);
  assert.equal(result.workspaceVisible,true);
  assert.equal(result.objectVisible,true);
  assert.equal(result.historyVisible,true);
  assert.equal(result.stateUnchanged,true);
  assert.deepEqual(result.grants,['t0.validate','t1.getAsset','t1.getObject','t1.getWorkspace','t1.listAssets','t1.listEventsSince','t1.listObjects','t1.listWorkspaces'].sort());
  assert.deepEqual(result.denied.filter(x=>!x.denied),[]);
 }finally{
  stage.cleanup();
  assert.equal(existsSync(stagedRoot),false);
 }
 const result=await runIndependentSiteWitness({siteRoot:root,buildDirectory:'dist',contract:isolatedContract,inventory});
 assert.equal(result.status,'PASS');
 assert.equal(result.isolatedReader,true);
 assert.equal(result.observations.length,1);
 assert.equal(result.observations[0].afterKernelRestart,true);
 assert.equal(result.observations[0].afterPageReload,true);
 assert.equal(result.observations[0].historyPreserved,true);
 assert.equal(result.observations[0].deniedWriteRejected,true);
 assert.equal(result.observations[0].unrelatedObjectsPreserved,true);
});
test('real UI uses sanctioned KernelFacade and qualified Kernel with isolated durable restart readback',async()=>{
 const result=await runIndependentSiteWitness({siteRoot:root,buildDirectory:'dist',contract,inventory});
 assert.equal(result.status,'PASS');assert.equal(result.isolatedReader,true);
 assert.equal(result.observations[0].freshUiChallenge,true);assert.equal(result.observations[0].afterKernelRestart,true);
 assert.equal(result.observations[0].afterPageReload,true);assert.equal(result.observations[0].historyPreserved,true);
 assert.equal(result.observations[0].afterPageReload,true);assert.equal(result.observations[0].historyPreserved,true);
});
test('replaced window.IWXA cannot pass',async()=>{
 const old=readFileSync(join(dist,'workspace/app.js'),'utf8');
 writeFileSync(join(dist,'workspace/app.js'),'window.IWXA={connect:async()=>({})};\n'+old);
 try{await assert.rejects(()=>runIndependentSiteWitness({siteRoot:root,buildDirectory:'dist',contract,inventory}),/SUBSTITUTION|COMMIT|READBACK|visible|Timeout/);}finally{writeFileSync(join(dist,'workspace/app.js'),old);}
});
test('precreated object and fabricated visible receipt without user Kernel operation cannot pass',async()=>{
 const old=readFileSync(join(dist,'workspace/app.js'),'utf8');
 writeFileSync(join(dist,'workspace/app.js'),`
 const title=document.querySelector('#title'),save=document.querySelector('#save');title.disabled=true;save.disabled=true;
 (async()=>{const s=await IWXA.connect({service_id:'iwxa.workspace.integration'});if(!await s.t1.getWorkspace('product-ws'))await s.t1.createWorkspace({workspace_id:'product-ws',profile:'generic'});
 await s.t1.putObject({workspace_id:'product-ws',object_id:'prebuilt',schema_id:'iwxa.demo.note',schema_version:'1.0.0',base_revision:0,data:{title:'Prepared before the user operation'},extensions:{},event:{event_type:'test.precreated',payload:{}}});
 save.onclick=()=>{const n=document.querySelector('#result');n.dataset.t2WorkspaceId='product-ws';n.dataset.t2ObjectId='prebuilt';n.hidden=false;};title.disabled=false;save.disabled=false;})();`);
 // This exact error is reached only after an independent successful read of the actual precreated object.
 try{await assert.rejects(()=>runIndependentSiteWitness({siteRoot:root,buildDirectory:'dist',contract,inventory}),/REAL_UI_KERNEL_COMMIT_MISSING/);}finally{writeFileSync(join(dist,'workspace/app.js'),old);}
});
test('modified runtime bytes fail before executing site code',()=>{
 const path=join(dist,'_iwxa/runtime/'+version+'/runtime.js'),old=readFileSync(path);
 writeFileSync(path,'window.IWXA={connect:async()=>({})};');
 try{assert.throws(()=>assertQualifiedKernelArtifact(dist,contract.runtime),/KERNEL_ARTIFACT_MISMATCH/);}finally{writeFileSync(path,old);}
});
test('a successful UI result cannot hide an undeclared extra Kernel object',async()=>{
 const path=join(dist,'workspace/app.js'),old=readFileSync(path,'utf8');
 writeFileSync(path,old+`
const normal=document.querySelector('#save').onclick;document.querySelector('#save').onclick=async()=>{await normal();const n=document.querySelector('#result');n.hidden=true;const s=await IWXA.connect({service_id:'iwxa.workspace.integration'});await s.t1.putObject({workspace_id:'product-ws',object_id:'undeclared-extra',schema_id:'iwxa.demo.note',schema_version:'1.0.0',base_revision:0,data:{title:'undeclared'},extensions:{},event:{event_type:'test.extra',payload:{}}});n.hidden=false;};`);
 try{await assert.rejects(()=>runIndependentSiteWitness({siteRoot:root,buildDirectory:'dist',contract,inventory}),/UNDECLARED_OBJECT_WRITE/);}finally{writeFileSync(path,old);}
});
test('a later UI operation cannot silently delete an earlier stored result',async()=>{
 const path=join(dist,'workspace/app.js'),old=readFileSync(path,'utf8');
 writeFileSync(path,old+`
const normal=document.querySelector('#save').onclick;document.querySelector('#save').onclick=async()=>{await normal();const n=document.querySelector('#result');n.hidden=true;const s=await IWXA.connect({service_id:'iwxa.workspace.integration'});const objects=await s.t1.listObjects({workspace_id:'product-ws'});for(const o of objects){if(o.object_id!==n.dataset.t2ObjectId)await s.t1.deleteObject({workspace_id:'product-ws',object_id:o.object_id,base_revision:o.revision,event:{event_type:'test.loss',payload:{}}});}n.hidden=false;};`);
 const inventory2={...inventory,persistentFamilies:['note-first','note-second']};const journeys=['note-first','note-second'].map(family=>({...contract.witness.journeys[0],family}));
 try{await assert.rejects(()=>runIndependentSiteWitness({siteRoot:root,buildDirectory:'dist',contract:{...contract,witness:{...contract.witness,journeys}},inventory:inventory2}),/DESTRUCTIVE_OR_UNDECLARED_OPERATION/);}finally{writeFileSync(path,old);}
});
function gitEngineeringInput(domainId,sourceSha256){return {sourceOrigin:'CANONICAL_GIT_HEAD_TREE',genericWriteAuthority:false,productionActivation:false,transformation:{intake:{domainId,productName:'Regression Domain',currentSourceRef:'sha256:'+sourceSha256,authorityStatus:'OWNER_DECISION_REQUIRED',ownerRefs:['owner:regression'],sourceTruthRefs:['source:regression'],schemaRefs:['schema:regression'],schemaMapStatus:'COMPLETE',ownerCommandMapStatus:'COMPLETE',processResultMapStatus:'COMPLETE',compatibilityMapStatus:'COMPLETE',rollbackPlanStatus:'COMPLETE',compatibilityConstraints:[]},schemaMap:{domainId,currentSourceSha256:sourceSha256,targetSchemaIds:['neutral-object'],mappings:[{targetSchemaId:'neutral-object',status:'BOUND',ownerRef:'owner:regression',sourceSchemaRefs:['schema:neutral-object'],migrationRefs:[],evidenceRefs:['evidence:schema']}],genericWriteAuthority:false},ownerCommandMap:{domainId,sourceSha256,entries:[{component:'owner',ownerRef:'owner:regression',status:'BOUND',commandIds:['regression.create'],evidenceRefs:['evidence:command']}],genericWriteAuthority:false,workspaceMayBecomeBusinessOwner:false},resultAcceptanceMap:{domainId,currentSourceSha256:sourceSha256,persistentAuthorityStatus:'OWNER_DECISION_REQUIRED',entries:[{resultKind:'note-result',producerRef:'owner:regression',status:'BOUND',acceptedResultRefs:['result:regression'],inputAcceptanceEvidenceRefs:[],acceptanceCriteriaRefs:['criteria:regression'],provenanceRefs:['provenance:regression'],limitations:[],evidenceRefs:['evidence:result']}],genericWriteAuthority:false,commonProjectProcessResultWriterAllowed:false,commonAcceptanceWriterAllowed:false},compatibilityMap:{domainId,currentSourceSha256:sourceSha256,entries:[{subject:'state',status:'BOUND',guarantees:['identity'],migrationRefs:[],limitations:[],evidenceRefs:['evidence:compat']}],destructiveMigrationAuthorized:false,productionActivation:false},rollbackPlan:{domainId,baselineSourceRef:'sha256:'+sourceSha256,acceptedStateRef:'state:regression',rollbackEvidenceRef:'evidence:rollback',limitations:[],verificationSteps:['verify'],executionAuthorized:false,destructiveCleanupAuthorized:false,productionActivation:false}},candidate:{domainId,evidenceRefs:['evidence:candidate'],rollbackRef:'evidence:rollback',compatibilityVerified:true,genericWriteAuthority:false,aiOutputSourceTruth:false,hiddenWritesAllowed:false,genericPutObjectAllowed:false,productionActivation:false}};}
test('neutral site-only Git D13 completes live product qualification without a logic checkout or Human approval',async()=>{
 const retained=process.env.IWXA_T2_SITE_ONLY_EVIDENCE_ROOT;
 const area=retained?resolve(retained):mkdtempSync(join(tmpdir(),'t2-neutral-site-')),site=join(area,'site'),run=join(area,'run');
 if(retained)mkdirSync(area,{recursive:true});
 const git=(cwd,args)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 mkdirSync(site);cpSync(dist,join(site,'public'),{recursive:true});
 writeFileSync(join(site,'public/index.html'),publicCalculatorHtml);
 writeFileSync(join(site,'.gitignore'),'dist/\nnode_modules/\n*.log\n');
 await build({configFile:false,publicDir:false,resolve:{alias:{'@':join(sourceRoot,'src')}},build:{outDir:join(site,'vendor'),emptyOutDir:true,minify:false,lib:{entry:join(sourceRoot,'src/workspace-host/context/create-kernel-facade.ts'),formats:['es'],fileName:()=> 't2-host.js'}}});
 writeFileSync(join(site,'entry.ts'),code.replace(sourceRoot.replaceAll('\\','/')+'/src/workspace-host/context/create-kernel-facade.ts','./vendor/t2-host.js'));
 writeFileSync(join(site,'build.mjs'),`import fs from 'node:fs';import {build} from ${JSON.stringify(new URL('../node_modules/vite/dist/node/index.js',import.meta.url).href)};
 fs.cpSync('public','dist',{recursive:true});
 await build({configFile:false,publicDir:false,build:{outDir:'dist/workspace',emptyOutDir:false,minify:false,lib:{entry:'entry.ts',formats:['es'],fileName:()=> 'app.js'}}});`);
 const inventoryGit={...inventory,routes:['/','/workspace/'],resultBindings:[{family:'note',resultKind:'note-result'}]};
 writeFileSync(join(site,'witness.json'),JSON.stringify({contract,inventory:inventoryGit}));
 // Every stage executes the real independent UI/Kernel witness before reporting.
 const stageCode=`import fs from 'node:fs';import assert from 'node:assert/strict';
 import {runIndependentSiteWitness} from '${new URL('../src/factory2/products/domain-completion/independent-browser-witness.mjs',import.meta.url).href}';
 const stage=process.argv[2],e=process.env,setup=JSON.parse(fs.readFileSync('witness.json'));
 const verifyPublicCalculator=${verifyPublicCalculator.toString()};
 assert.equal((await verifyPublicCalculator('dist',${JSON.stringify(new URL('../node_modules/playwright/index.mjs',import.meta.url).href)})).withoutKernel,true);
 const result=await runIndependentSiteWitness({siteRoot:process.cwd(),buildDirectory:'dist',...setup});assert.equal(result.status,'PASS');assert.ok(result.observations.every(x=>x.afterKernelRestart&&x.deniedWriteRejected&&x.unrelatedObjectsPreserved));
 const report={schema:'IWXA_T2_PRODUCT_EXECUTION_REPORT_V1',stage,executionChallenge:e.IWXA_T2_PRODUCT_CHALLENGE,domainId:e.IWXA_T2_PRODUCT_DOMAIN_ID,canonicalSourceSha256:e.IWXA_T2_PRODUCT_SOURCE_SHA256,siteHead:e.IWXA_T2_PRODUCT_SITE_HEAD,siteTree:e.IWXA_T2_PRODUCT_SITE_TREE,status:'PASS',productionActivation:false,counts:{pass:result.observations.length,fail:0,skip:0},runner:{nativeKernel:'REAL_BUILT_KERNEL',browser:'REAL_BROWSER_UI',migration:'EXECUTED_MIGRATION_TESTS',regression:'EXECUTED_SITE_REGRESSION'}[stage],kernel:e.IWXA_T2_PRODUCT_KERNEL,contract:e.IWXA_T2_PRODUCT_RUNTIME_CONTRACT,t2Head:e.IWXA_T2_PRODUCT_T2_HEAD??'8253fe06a9530541de5b07a8a205a43271c63fe6',nativeHostMounted:true,sanctionedSurface:'WorkspaceModuleContext.kernel',nativeOperations:result.observations.length,siteHostMounted:true,nativeKernelObserved:true,testedRoutes:['/','/workspace/'],testedServiceIds:['iwxa.workspace.integration'],sourceBytesPreserved:true,unknownObjectsPreserved:true,idempotencyVerified:true,destructiveCleanupPerformed:false,browserConsoleErrors:result.pageErrors.length,privacyLeaks:0};fs.writeFileSync(e.IWXA_T2_PRODUCT_REPORT_PATH,JSON.stringify(report));`;
 writeFileSync(join(site,'stage.mjs'),stageCode);
 const scripts=Object.fromEntries(['build','nativeKernel','browser','migration','regression'].map(k=>[k,k==='build'?'node build.mjs':'node stage.mjs '+k]));
 // Site builds with the already installed, pinned Vite of this exact T2 checkout.
 // No network install and no independent dependency resolution in a throwaway fixture.
 writeFileSync(join(site,'package.json'),JSON.stringify({type:'module',scripts}));
 const remote=join(area,'neutral-site.git');git(area,['init','--bare',remote]);
 git(site,['init','-b','qualification']);git(site,['config','user.name','Neutral test']);git(site,['config','user.email','test@example.invalid']);
 git(site,['remote','add','origin','https://github.com/neutral-fixture/neutral-site.git']);
 git(site,['config','url.'+remote.replaceAll('\\','/')+'.insteadOf','https://github.com/neutral-fixture/neutral-site.git']);
 git(site,['add','.']);git(site,['commit','-m','neutral site source']);git(site,['push','-u','origin','qualification']);
 try{
  const intakeHead=git(site,['rev-parse','HEAD']);
  const start=runDomainCli('init-site',site,'D13',run);
  assert.equal(start.sourceGit,null);assert.equal(start.siteGit.subject.head,intakeHead);assert.equal(start.siteGit.subject.branch,'qualification');
  writeFileSync(join(site,'published-fast-forward.md'),'Published site successor');git(site,['add','.']);git(site,['commit','-m','published fast-forward site update']);git(site,['push','origin','qualification']);
  const input=gitEngineeringInput('D13',start.sourceSha256);writeFileSync(join(run,'engineering-input.json'),JSON.stringify(input));
  const state=runDomainCli('evaluate',run);assert.equal(state.status,'GIT_ENGINEERING_READY');
  assert.equal(state.terminalResult,null);
  const c={...contract,schema:'IWXA_T2_PRODUCT_SITE_CONTRACT_V1',domainId:'D13',canonicalSourceSha256:start.sourceSha256,site:{repository:'neutral-fixture/neutral-site',branch:'qualification',head:git(site,['rev-parse','HEAD']),tree:git(site,['rev-parse','HEAD^{tree}'])},runtime:{...contract.runtime,t2Head:'8253fe06a9530541de5b07a8a205a43271c63fe6',sanctionedSurface:'WorkspaceModuleContext.kernel'},inventory:inventoryGit,scripts:Object.fromEntries(Object.keys(scripts).map(k=>[k,k])),buildDirectory:'dist',productionActivation:false};
  writeFileSync(join(run,'product-site-contract.json'),JSON.stringify(c));
  const result=runDomainCli('qualify-product',run,site);assert.equal(result.factoryStatus,'GIT_ENGINEERING_VERIFIED');
  const verified=runDomainCli('verify-product',run,site);assert.equal(verified.verifiedReadback,true);
  assert.match(rejectDomainCli('qualify-product',run,site,site),/SITE_ONLY_ROUTE_TAKES_ONE_CHECKOUT/);
  assert.match(rejectDomainCli('verify-product',run,site,site),/SITE_ONLY_ROUTE_TAKES_ONE_CHECKOUT/);
  const inputBytes=readFileSync(join(run,'engineering-input.json'));writeFileSync(join(run,'engineering-input.json'),Buffer.concat([inputBytes,Buffer.from(' ')]));
  assert.match(rejectDomainCli('verify-product',run,site),/GIT_ENGINEERING_EVIDENCE_CHANGED|FROZEN_ENGINEERING_INPUT_CHANGED/);writeFileSync(join(run,'engineering-input.json'),inputBytes);
  const originalRemote='https://github.com/neutral-fixture/neutral-site.git',alternateRemote=join(area,'alternate-origin.git');git(area,['clone','--bare',remote,alternateRemote]);
  git(site,['remote','set-url','origin',alternateRemote]);assert.match(rejectDomainCli('verify-product',run,site),/FACTORY2_GIT_SOURCE_CHANGED:remote/);git(site,['remote','set-url','origin',originalRemote]);
  const witnessPath=join(run,'PRODUCT_EXECUTION_EVIDENCE','independent-browser-witness.json'),witnessBytes=readFileSync(witnessPath);writeFileSync(witnessPath,Buffer.concat([witnessBytes,Buffer.from(' ')]));
  assert.match(rejectDomainCli('verify-product',run,site),/FACTORY2_PRODUCT_WITNESS_CHANGED/);writeFileSync(witnessPath,witnessBytes);
  const receiptPath=join(run,'PRODUCT_EXECUTION_EVIDENCE','browser.report.json'),receiptBytes=readFileSync(receiptPath);writeFileSync(receiptPath,Buffer.concat([receiptBytes,Buffer.from(' ')]));
  assert.match(rejectDomainCli('verify-product',run,site),/FACTORY2_PRODUCT_REPORT_CHANGED/);writeFileSync(receiptPath,receiptBytes);
  const runtimePath=join(site,'dist','_iwxa','runtime','0.3.6','runtime.js'),runtimeBytes=readFileSync(runtimePath);writeFileSync(runtimePath,Buffer.concat([runtimeBytes,Buffer.from('\n/* altered */')]));
  assert.match(rejectDomainCli('verify-product',run,site),/FACTORY2_PRODUCT_BUILD_CHANGED/);writeFileSync(runtimePath,runtimeBytes);
  const live=await serveRealKernelHost(join(site,'dist'),{independentWitness:true,previewOrigin:true});
  try{const publicResult=await verifyPublicCalculator(join(site,'dist'),new URL('../node_modules/playwright/index.mjs',import.meta.url).href,live.origin);assert.equal(publicResult.unifiedNavigation,true);writeFileSync(join(run,'PUBLIC_SITE_BROWSER_RESULT.json'),JSON.stringify(publicResult,null,2));}finally{await new Promise(done=>live.server.close(done));}
 }finally{if(!retained)rmSync(area,{recursive:true,force:true});}
});

test('qualify-product and executable verify-product bind exact paired Git subjects; forged JSON cannot replace live UI',async()=>{
 const git=(cwd,args)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 const canonical=join(root,'canonical'),run=join(root,'run');mkdirSync(canonical);mkdirSync(run);
 const init=(dir,origin)=>{git(dir,['init']);git(dir,['config','user.name','Synthetic qualification fixture']);git(dir,['config','user.email','fixture@example.invalid']);git(dir,['remote','add','origin',origin]);};
 init(canonical,'https://github.com/Faust-S/artbazy.git');writeFileSync(join(canonical,'source.txt'),'Synthetic qualification source; no Human authority');git(canonical,['add','.']);git(canonical,['commit','-m','synthetic source']);
 writeFileSync(join(root,'.gitignore'),'dist/\ncanonical/\nrun/\n');
 const stageCode=`import fs from 'node:fs';
import assert from 'node:assert/strict';import crypto from 'node:crypto';
 const stage=process.argv[2];assert.equal(crypto.createHash('sha256').update(fs.readFileSync('dist/_iwxa/runtime/${version}/runtime.js')).digest('hex'),'${createHash('sha256').update(readFileSync(join(dist,'_iwxa/runtime/'+version+'/runtime.js'))).digest('hex')}');
 if(stage==='build')process.exit(0);
 const e=process.env;const report={schema:'IWXA_T2_PRODUCT_EXECUTION_REPORT_V1',stage,executionChallenge:e.IWXA_T2_PRODUCT_CHALLENGE,domainId:e.IWXA_T2_PRODUCT_DOMAIN_ID,canonicalSourceSha256:e.IWXA_T2_PRODUCT_SOURCE_SHA256,siteHead:e.IWXA_T2_PRODUCT_SITE_HEAD,siteTree:e.IWXA_T2_PRODUCT_SITE_TREE,status:'PASS',productionActivation:false,counts:{pass:1,fail:0,skip:0},runner:{nativeKernel:'REAL_BUILT_KERNEL',browser:'REAL_BROWSER_UI',migration:'EXECUTED_MIGRATION_TESTS',regression:'EXECUTED_SITE_REGRESSION'}[stage],kernel:e.IWXA_T2_PRODUCT_KERNEL,contract:e.IWXA_T2_PRODUCT_RUNTIME_CONTRACT,t2Head:'f2fef39e6867712d2d6c4d736ec1fbc068855bf9',nativeHostMounted:true,sanctionedSurface:'WorkspaceModuleContext.kernel',nativeOperations:1,siteHostMounted:true,nativeKernelObserved:true,testedRoutes:['/workspace/'],testedServiceIds:['iwxa.workspace.integration'],sourceBytesPreserved:true,unknownObjectsPreserved:true,idempotencyVerified:true,destructiveCleanupPerformed:false,browserConsoleErrors:0,privacyLeaks:0};fs.writeFileSync(e.IWXA_T2_PRODUCT_REPORT_PATH,JSON.stringify(report));`;
 writeFileSync(join(root,'stage.mjs'),stageCode);
 const scripts=Object.fromEntries(['build','nativeKernel','browser','migration','regression'].map(k=>[k,'node stage.mjs '+k]));writeFileSync(join(root,'package.json'),JSON.stringify({type:'module',scripts}));
 init(root,'https://github.com/Faust-S/artbazy.ru.git');git(root,['add','.']);git(root,['commit','-m','synthetic executable site']);
 const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
 const input=Buffer.from(JSON.stringify({transformation:{resultAcceptanceMap:{entries:[{resultKind:'note-result',status:'BOUND'}]}}}));writeFileSync(join(run,'engineering-input.json'),input);
 const state={schema:'IWXA_T2_FACTORY2_DOMAIN_RUN_STATE_V1',productionActivation:false,status:'T2_READY',terminalResult:'STUDIO_TERMINAL_RESULT.json',domainId:'D03',sourceSha256:'a'.repeat(64),engineeringInputSha256:sha(input)};
 writeFileSync(join(run,'STUDIO_TERMINAL_RESULT.json'),JSON.stringify({schema:'IWXA_T2_FACTORY2_STUDIO_TERMINAL_RESULT_V1',status:'T2_READY',explicitHumanDecision:true,domainId:'D03',sourceSha256:state.sourceSha256,productionActivation:false,fixtureOnly:true,decisionId:'SYNTHETIC_REFERENCE_NOT_REAL_HUMAN_ACCEPTANCE',decidedBy:'SYNTHETIC_TEST_ACTOR',decidedAt:'2026-10-11T00:00:00Z'})+'\n');
 cpSync(join(run,'STUDIO_TERMINAL_RESULT.json'),join(canonical,'SYNTHETIC_TERMINAL_RECEIPT.json'));writeFileSync(join(canonical,'SYNTHETIC_DOMAIN_RUN.json'),JSON.stringify(state)+'\n');git(canonical,['add','.']);git(canonical,['commit','-m','synthetic receipt fixture; no real approval']);
 // A fixture-local bare remote models published canonical authority; no network grant or real Human acceptance.
 const remote=mkdtempSync(join(tmpdir(),'t2-canonical-remote-'));git(remote,['init','--bare']);
 test.after(()=>rmSync(remote,{recursive:true,force:true}));
 git(canonical,['config','url.'+remote.replaceAll('\\','/')+'.insteadOf','https://github.com/Faust-S/artbazy.git']);
 const canonicalBranch=git(canonical,['branch','--show-current']);git(canonical,['push','origin','HEAD:refs/heads/'+canonicalBranch]);
 const c={...contract,factoryQualification:{domainRunPath:'SYNTHETIC_DOMAIN_RUN.json',domainRunSha256:sha(readFileSync(join(canonical,'SYNTHETIC_DOMAIN_RUN.json'))),terminalReceiptPath:'SYNTHETIC_TERMINAL_RECEIPT.json',terminalReceiptSha256:sha(readFileSync(join(run,'STUDIO_TERMINAL_RESULT.json')))},schema:'IWXA_T2_PRODUCT_SITE_CONTRACT_V1',domainId:'D03',canonicalSourceSha256:state.sourceSha256,canonical:{repository:'Faust-S/artbazy',branch:canonicalBranch,head:git(canonical,['rev-parse','HEAD']),tree:git(canonical,['rev-parse','HEAD^{tree}']),sourceSha256:state.sourceSha256},site:{repository:'Faust-S/artbazy.ru',head:git(root,['rev-parse','HEAD']),tree:git(root,['rev-parse','HEAD^{tree}'])},runtime:{...contract.runtime,t2Head:'f2fef39e6867712d2d6c4d736ec1fbc068855bf9',sanctionedSurface:'WorkspaceModuleContext.kernel'},inventory:{...inventory,resultBindings:[{family:'note',resultKind:'note-result'}]},scripts:Object.fromEntries(Object.keys(scripts).map(k=>[k,k])),buildDirectory:'dist',productionActivation:false};
 writeFileSync(join(run,'product-site-contract.json'),JSON.stringify(c));
 const supplied=readFileSync(join(run,'STUDIO_TERMINAL_RESULT.json'));writeFileSync(join(run,'STUDIO_TERMINAL_RESULT.json'),supplied.toString().replace('SYNTHETIC_TEST_ACTOR','COUNTERFEIT_LOCAL_APPROVAL'));
 await assert.rejects(()=>qualifyFactory2DomainProduct({runRoot:run,siteRoot:root,runState:state,canonicalRoot:canonical}),/CANONICAL_HUMAN_EVIDENCE_MISMATCH/);writeFileSync(join(run,'STUDIO_TERMINAL_RESULT.json'),supplied);
 // Even an internally consistent local terminal receipt is rejected if its commit was never published.
 writeFileSync(join(canonical,'unaccepted-local.txt'),'No remote Human acceptance');git(canonical,['add','.']);git(canonical,['commit','-m','unpublished counterfeit canonical subject']);
 const unpublished={...c,canonical:{...c.canonical,head:git(canonical,['rev-parse','HEAD']),tree:git(canonical,['rev-parse','HEAD^{tree}'])}};
 writeFileSync(join(run,'product-site-contract.json'),JSON.stringify(unpublished));
 await assert.rejects(()=>qualifyFactory2DomainProduct({runRoot:run,siteRoot:root,runState:state,canonicalRoot:canonical}),/CANONICAL_REMOTE_SUBJECT_MISMATCH/);
 git(canonical,['checkout','--detach',c.canonical.head]);writeFileSync(join(run,'product-site-contract.json'),JSON.stringify(c));
 const result=await qualifyFactory2DomainProduct({runRoot:run,siteRoot:root,runState:state,canonicalRoot:canonical});assert.equal(result.status,'DOMAIN_T2_PRODUCT_COMPLETE');assert.equal(result.canonical.head,c.canonical.head);
 const verified=await verifyFactory2DomainProduct({runRoot:run,siteRoot:root,runState:state,canonicalRoot:canonical});assert.equal(verified.verifiedReadback,true);assert.equal(verified.verificationWitness.status,'PASS');
 // All previously passing JSON evidence remains intact. Only the actual built UI is counterfeit.
 writeFileSync(join(dist,'workspace/app.js'),`document.querySelector('#save').onclick=()=>{const n=document.querySelector('#result');n.dataset.t2WorkspaceId='product-ws';n.dataset.t2ObjectId='fabricated';n.hidden=false;};`);
 const files=[];function walk(dir,rel=''){for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const next=join(dir,entry.name),path=rel?rel+'/'+entry.name:entry.name;if(entry.isDirectory())walk(next,path);else files.push([path,sha(readFileSync(next))]);}}walk(dist);
 const forged={...result,site:{...result.site,buildSha256:sha(Buffer.from(JSON.stringify(files))),buildFileCount:files.length}};writeFileSync(join(run,'DOMAIN_PRODUCT_RESULT.json'),JSON.stringify(forged));
 await assert.rejects(()=>verifyFactory2DomainProduct({runRoot:run,siteRoot:root,runState:state,canonicalRoot:canonical}),/READBACK|COMMIT/);
});
test.after(()=>rmSync(root,{recursive:true,force:true}));
