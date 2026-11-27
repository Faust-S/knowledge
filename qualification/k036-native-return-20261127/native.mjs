// Disposable, actual T2 Host + two persistent native browser profiles.
// This is an engineering CI test, not Codex browser acceptance or production data.
import assert from 'node:assert/strict';
import {cpSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [hostArg,artifactsArg,tmpArg]=process.argv.slice(2);
const hostSource=resolve(hostArg),artifacts=resolve(artifactsArg),tmp=resolve(tmpArg);
const {materializeIntegrationHost,serveRealKernelHost}=await import(pathToFileURL(join(hostSource,'scripts/real-kernel-e2e.mjs')).href);
const {chromium}=await import(pathToFileURL(join(hostSource,'node_modules/playwright/index.mjs')).href);
const ws='k036-native-shared-workspace',writer='iwxa.workspace.integration',auditor='iwxa.workspace.k036.auditor';
const say=(name,value='PASS')=>console.log('K036_'+name+'='+value);
let detail='NONE';
const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?
  Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
function contains(actual,expected,key){
  const by=new Map(actual.map(x=>[x[key],x]));
  assert.equal(by.size,actual.length,'DUPLICATE_ID');
  for(const row of expected)assert.equal(canonical(by.get(row[key])),canonical(row),'HISTORY_OR_RECORD_CHANGED');
}
function covers(actual,expected){
  contains(actual.events,expected.events,'event_id');
  contains(actual.objects,expected.objects,'object_id');
  contains(actual.relations,expected.relations,'relation_id');
  contains(actual.assets,expected.assets,'asset_id');
}
function put(root,path,value){writeFileSync(join(root,path),JSON.stringify(value)+'\n');}
async function stage(root,variant){
  mkdirSync(root,{recursive:true});
  cpSync(join(artifacts,variant,'_iwxa'),join(root,'_iwxa'),{recursive:true});
  cpSync(join(hostSource,'dist'),join(root,'workspace'),{recursive:true});
  writeFileSync(join(root,'index.html'),'<!doctype html><meta charset="utf-8"><script src="/_iwxa/loader.js"></script><title>Kernel qualification</title>');
  const live=await serveRealKernelHost(root,{independentWitness:true,previewOrigin:true});
  try{
    const cwd=process.cwd();let s;
    try{process.chdir(hostSource);s=materializeIntegrationHost(root,live.origin);}finally{process.chdir(cwd);}
    s.domain.runtime.kernel_release='0.3.6';s.domain.runtime.runtime_version='0.3.6';
    s.domain.runtime.local_store_version='8';
    s.workspaceConfig.host.required_runtime_version='0.3.6';s.workspaceConfig.host.required_contract_version='1.3.0';
    s.domain.modules.push({service_id:auditor,base_path:'/workspace/'});
    const reader=structuredClone(s.passport);reader.service_id=auditor;reader.supported_levels=['T0','T1'];
    reader.permissions.workspace={list:true,read:true,create:false,soft_delete:false,restore:false,purge:false};
    reader.permissions.objects={read:['iwxa.demo.note'],write:[],delete:[]};
    reader.permissions.events={read_scope:'workspace'};
    reader.permissions.packages={export:false,import:false,export_scope:'readable_objects',import_scope:'writable_objects'};
    s.passport.permissions.packages={export:true,import:true,export_scope:'workspace',import_scope:'workspace'};
    put(root,'_iwxa/services/'+writer+'.json',s.passport);
    s.controlPlane.services.push({schema_version:'0.3.1',service_id:auditor,capability_control:'NONE',capability_ceiling:[],activation_any_of:[],operation_guards:[]});
    put(root,'_iwxa/domain.json',s.domain);put(root,'workspace/workspace.config.json',s.workspaceConfig);
    put(root,'_iwxa/services/'+auditor+'.json',reader);
    put(root,'_iwxa/security/capability-control-plane.json',s.controlPlane);
    return live;
  }catch(e){live.server.close();throw e;}
}
async function launch(side){
  side.context=await chromium.launchPersistentContext(side.profile,{headless:true,ignoreHTTPSErrors:true,serviceWorkers:'block',acceptDownloads:true});
  side.page=await side.context.newPage();side.page.setDefaultTimeout(20000);
}
async function rootPage(side){
  await side.page.goto(side.live.origin+'/');
  await side.page.waitForFunction(()=>typeof globalThis.IWXA?.connect==='function');
}
async function list(side){
  await rootPage(side);
  return side.page.evaluate(async({writer})=>(await (await IWXA.connect({service_id:writer,required_levels:['T1','T2']})).t1.listWorkspaces({})).map(x=>x.workspace_id),{writer});
}
async function seed(side,isA){
  await rootPage(side);
  await side.page.evaluate(async({writer,ws,isA})=>{
    const c=await IWXA.connect({service_id:writer,required_levels:['T1','T2']});
    const required=['t1.createWorkspace','t1.putObject','t1.putRelation','t1.putAsset','t2.exportPreview','t2.exportPackage','t2.confirmExport','t2.importPreview','t2.importCommit'];
    if(required.some(x=>!c.granted_operations.includes(x)))throw Error('WRITER_GRANT_MISSING');
    await c.t1.createWorkspace({workspace_id:ws,profile:'generic',capabilities:[]});
    if(isA){
      for(const id of ['a-one','a-two'])await c.t1.putObject({workspace_id:ws,object_id:id,schema_id:'iwxa.demo.note',schema_version:'1.0.0',base_revision:0,data:{title:id,details:{z:2,a:1}},event:{event_type:'k036.fixture.object',payload:{z:[1,2],a:{z:3,a:null}}}});
      await c.t1.putRelation({workspace_id:ws,relation_id:'a-link',from_object_id:'a-one',to_object_id:'a-two',kind:'related',event:{event_type:'k036.fixture.relation',payload:{z:1,a:2}}});
      await c.t1.putAsset({workspace_id:ws,asset_id:'a-asset',object_id:'a-two',mime:'application/octet-stream',bytes:Uint8Array.from([0,1,2,255]),base_revision:0,event:{event_type:'k036.fixture.asset'}});
    }
  },{writer,ws,isA});
}
async function appendB(side){
  await rootPage(side);
  await side.page.evaluate(async({writer,ws})=>{
    const c=await IWXA.connect({service_id:writer,required_levels:['T1','T2']});
    await c.t1.putObject({workspace_id:ws,object_id:'b-one',schema_id:'iwxa.demo.note',schema_version:'1.0.0',base_revision:0,data:{title:'continued in B'},event:{event_type:'k036.fixture.continued',payload:{z:[9,8],a:1}}});
    await c.t1.putRelation({workspace_id:ws,relation_id:'b-link',from_object_id:'a-two',to_object_id:'b-one',kind:'related',event:{event_type:'k036.fixture.continued-relation'}});
    await c.t1.putAsset({workspace_id:ws,asset_id:'b-asset',object_id:'b-one',mime:'application/octet-stream',bytes:Uint8Array.from([4,5,6,255]),base_revision:0,event:{event_type:'k036.fixture.continued-asset'}});
  },{writer,ws});
}
async function snapshot(side){
  await rootPage(side);
  const data=await side.page.evaluate(async({ws,writer})=>{
    await IWXA.connect({service_id:writer,required_levels:['T1']});
    const info=(await indexedDB.databases()).find(x=>x.name==='iwxa-local');
    if(info?.version!==8)throw Error('NATIVE_DB8_NOT_PRESENT');
    const req=r=>new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
    const db=await req(indexedDB.open('iwxa-local'));
    try{
      const names=['workspaces','objects','events','relations','assets','schemas'];
      const tx=db.transaction(names,'readonly');
      const meta={version:db.version,eventKey:tx.objectStore('events').keyPath,relationKey:tx.objectStore('relations').keyPath};
      const values=await Promise.all(names.map(name=>req(tx.objectStore(name).getAll())));
      // Convert actual native binary values to lossless arrays for comparison.
      const normalize=async x=>{
        if(x instanceof Blob)return {bytes:Array.from(new Uint8Array(await x.arrayBuffer()))};
        if(x instanceof ArrayBuffer)return {bytes:Array.from(new Uint8Array(x))};
        if(ArrayBuffer.isView(x))return {bytes:Array.from(new Uint8Array(x.buffer,x.byteOffset,x.byteLength))};
        if(Array.isArray(x))return Promise.all(x.map(normalize));
        if(x&&typeof x==='object'){const pairs=await Promise.all(Object.entries(x).filter(([,v])=>v!==undefined).map(async([k,v])=>[k,await normalize(v)]));return Object.fromEntries(pairs);}
        return x;
      };
      const rows=Object.fromEntries(await Promise.all(names.map(async(name,i)=>[name,await normalize(name==='schemas'?values[i]:values[i].filter(v=>v.workspace_id===ws))])));
      return {...meta,...rows,wireOrder:values[2].filter(v=>v.workspace_id===ws).map(e=>[e.event_id,JSON.stringify(e)])};
    }finally{db.close();}
  },{ws,writer});
  assert.equal(data.version,8);assert.deepEqual(data.eventKey,['workspace_id','event_id']);assert.deepEqual(data.relationKey,['workspace_id','relation_id']);
  return data;
}
async function exportUi(side,dest){
  const page=side.page;detail='UI_NAVIGATE';await page.goto(side.live.origin+'/workspace/exchange/#/home');
  detail='UI_ROUTE_READY';await page.getByTestId('exchange-home-route').waitFor();
  detail='UI_EXPORT_TAB';await page.getByTestId('packages-tab-export').click();
  const list=page.getByTestId('export-view').locator('fieldset').first().locator('label');
  detail='UI_EXPORT_CATALOG';const selected=list.filter({hasText:ws});await selected.waitFor();
  for(let i=0;i<await list.count();i++){
    const row=list.nth(i),cb=row.locator('input');
    if((await row.innerText()).includes(ws))await cb.check();else await cb.uncheck();
  }
  detail='UI_EXPORT_OPTIONS';for(const key of ['history','relations','assets','schemas'])await page.getByTestId('export-include_'+key).check();
  detail='UI_EXPORT_PREVIEW';await page.getByTestId('export-preview').click();await page.getByTestId('export-preview-result').waitFor();
  detail='UI_EXPORT_PACKAGE';await page.getByTestId('export-package').click();await page.getByTestId('export-artifact').waitFor();
  detail='UI_EXPORT_DOWNLOAD';const download=page.waitForEvent('download');await page.getByTestId('export-download').click();
  const file=await download;assert.match(file.suggestedFilename(),/\.iwxa$/i);await file.saveAs(dest);
  assert.ok(readFileSync(dest).length>100,'EMPTY_ARCHIVE');
  const digest=(await page.getByTestId('export-artifact-digest').innerText()).trim();assert.match(digest,/^[a-f0-9]{64}$/);
  detail='UI_EXPORT_CONFIRM';await page.getByTestId('export-confirm').click();await page.getByTestId('export-receipt').waitFor();
  assert.equal((await page.getByTestId('export-receipt-digest').innerText()).trim(),digest);
  return digest;
}
async function prepareImport(side,file){
  const page=side.page;detail='UI_NAVIGATE';await page.goto(side.live.origin+'/workspace/exchange/#/home');
  detail='UI_ROUTE_READY';await page.getByTestId('exchange-home-route').waitFor();
  detail='UI_IMPORT_TAB';await page.getByTestId('packages-tab-import').click();
  detail='UI_IMPORT_FILE';await page.getByTestId('import-file').setInputFiles(file);
  detail='UI_IMPORT_PREVIEW';await page.getByTestId('import-preview').waitFor();
  detail='UI_IMPORT_MERGE_MODE';await page.getByTestId('import-mode').selectOption('merge');
  await page.getByTestId('import-conflict').selectOption('fail');
  detail='UI_IMPORT_TARGET';await page.getByTestId('import-target-workspace').selectOption(ws);
  for(const key of ['history','relations','assets'])await page.getByTestId('import-include_'+key).check();
  assert.equal(await page.getByTestId('import-scope-blocked').count(),0,'SCOPE_BLOCKED');
  assert.equal(await page.getByTestId('import-commit').isEnabled(),true,'COMMIT_DISABLED');
}
async function commitUi(side,digest){
  const p=side.page;detail='UI_IMPORT_COMMIT';await p.getByTestId('import-commit').click();
  detail='UI_IMPORT_RECEIPT';await p.waitForFunction(()=>['committed','incomplete','error','expired'].includes(document.querySelector('[data-testid="import-view"]')?.getAttribute('data-import-state')));
  const state=await p.getByTestId('import-view').getAttribute('data-import-state');
  if(state==='error'||state==='expired'){
    const err=(await p.getByTestId('import-error').count())?await p.getByTestId('import-error').innerText():'';
    return {state,collision:err.includes('IMPORT_EVENT_ID_COLLISION')};
  }
  await p.getByTestId('import-receipt').waitFor();
  const counts=await p.getByTestId('import-receipt').evaluate(el=>Object.fromEntries([...el.querySelectorAll('dt')].map(dt=>[dt.textContent.trim(),dt.nextElementSibling.textContent.trim()])));
  assert.equal(counts.package_digest,digest,'IMPORT_DIGEST_MISMATCH');
  assert.equal(counts['Режим'],'merge');return {state,counts};
}
async function readonly(side){
  await rootPage(side);
  const got=await side.page.evaluate(async({ws,auditor})=>{
    const c=await IWXA.connect({service_id:auditor,required_levels:['T1']});
    const grants=c.granted_operations;
    const eventCount=(await c.t1.listEventsSince(ws)).length;
    let denied=false;
    try{await c.t1.putObject({workspace_id:ws,object_id:'auditor-forbidden',schema_id:'iwxa.demo.note',schema_version:'1.0.0',base_revision:0,data:{title:'forbidden'}});}catch{denied=true;}
    return {denied,eventCount,write:grants.includes('t1.putObject'),import:grants.includes('t2.importCommit')};
  },{ws,auditor});
  assert.ok(got.denied&&!got.write&&!got.import&&got.eventCount>0);
}
async function corruptOnlyFixture(side,eventId){
  await rootPage(side);
  await side.page.evaluate(async({ws,eventId})=>{
    const req=r=>new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
    const db=await req(indexedDB.open('iwxa-local'));
    try{
      const tx=db.transaction(['events'],'readwrite');
      const done=new Promise((ok,no)=>{tx.oncomplete=ok;tx.onabort=()=>no(tx.error);tx.onerror=()=>no(tx.error);});
      const store=tx.objectStore('events'),row=await req(store.get([ws,eventId]));
      if(!row)throw Error('CONFLICT_FIXTURE_EVENT_MISSING');
      // Deliberate test-only input corruption on isolated B, not a product write.
      row.payload={...row.payload,k036_test_conflict:true};store.put(row);await done;
    }finally{db.close();}
  },{ws,eventId});
}
// Original API witness in the actual browser. This is separate from
// product UI acceptance; no direct writes are used except conflict fixture setup.
async function exportDirect(side,dest){
  detail='API_EXPORT';await rootPage(side);
  const out=await side.page.evaluate(async({ws,writer})=>{
    const c=await IWXA.connect({service_id:writer,required_levels:['T1','T2']});
    const options={workspaces:[ws],include_history:true,include_relations:true,include_assets:true,include_schemas:true};
    const preview=await c.t2.exportPreview(options);
    if(preview.counts.workspaces!==1||preview.counts.objects<2||preview.counts.assets<1)throw Error('EXPORT_INVENTORY');
    const artifact=await c.t2.exportPackage(options);
    const receipt=await c.t2.confirmExport({package_digest:artifact.package_digest,workspace_ids:[ws]});
    if(receipt.package_digest!==artifact.package_digest)throw Error('EXPORT_RECEIPT_DIGEST');
    return {digest:artifact.package_digest,bytes:Array.from(artifact.bytes)};
  },{ws,writer});
  assert.match(out.digest,/^[a-f0-9]{64}$/);assert.ok(out.bytes.length>100);
  writeFileSync(dest,Uint8Array.from(out.bytes));return out.digest;
}
async function prepareDirect(side,file){
  detail='API_IMPORT_PREVIEW';await rootPage(side);
  const p=await side.page.evaluate(async({ws,writer,bytes})=>{
    const c=await IWXA.connect({service_id:writer,required_levels:['T1','T2']});
    const p=await c.t2.importPreview(Uint8Array.from(bytes));
    globalThis.__k036TestSession=c;
    globalThis.__k036TestPreview=p;
    return {allowed:p.allowed_modes,excluded:p.preview.excluded_by_permission,digest:p.package_digest};
  },{ws,writer,bytes:Array.from(readFileSync(file))});
  assert.ok(p.allowed.includes('merge'),'API_MERGE_NOT_ALLOWED');
  assert.ok(['workspaces','objects','events','relations','assets','schemas'].every(k=>p.excluded[k]===0),'API_SCOPE_EXCLUDED');
  side.previewDigest=p.digest;
}
async function commitDirect(side,digest){
  detail='API_IMPORT_COMMIT';assert.equal(side.previewDigest,digest);
  const r=await side.page.evaluate(async({ws,digest})=>{
    const c=globalThis.__k036TestSession,p=globalThis.__k036TestPreview;
    try{
      const receipt=await c.t2.importCommit({preview_token:p.preview_token,package_digest:digest,
        plan:{mode:'merge',include_workspaces:[ws],target_workspace:ws,conflict:'fail',include_history:true,include_relations:true,include_assets:true}});
      return {receipt};
    }catch(e){return {collision:String(e?.code||'').includes('IMPORT_EVENT_ID_COLLISION')||String(e?.message||'').includes('IMPORT_EVENT_ID_COLLISION')};}
    finally{delete globalThis.__k036TestSession;delete globalThis.__k036TestPreview;}
  },{ws,digest});
  if(!r.receipt)return {state:'error',collision:r.collision};
  const x=r.receipt;assert.equal(x.package_digest,digest);assert.equal(x.mode,'merge');assert.equal(x.conflict_policy,'fail');assert.equal(x.workspace_id_map[ws],ws);assert.equal(x.skipped_conflicts.length,0);
  return {state:'committed',counts:{'Объектов создано':x.applied.objects_inserted,'Событий':x.applied.events}};
}

const business=x=>{const {wireOrder,...rest}=x;return canonical(rest);};
async function scenario(variant,useUi){
  const profile=useUi?'UI':'API';
  const emit=(name,value='PASS')=>say(profile+'_'+name,value);
  const exportArchive=useUi?exportUi:exportDirect,prepareImportArchive=useUi?prepareImport:prepareDirect,commitImport=useUi?commitUi:commitDirect;
  const root=join(tmp,variant+'-native-'+profile.toLowerCase());mkdirSync(root,{recursive:true});
  const a={profile:join(root,'profile-a')},b={profile:join(root,'profile-b')};
  let phase='STAGE';
  try{
    a.live=await stage(join(root,'host-a'),variant);b.live=await stage(join(root,'host-b'),variant);
    assert.notEqual(a.live.origin,b.live.origin);await launch(a);await launch(b);
    phase='INDEPENDENT_STORES';assert.deepEqual(await list(a),[]);assert.deepEqual(await list(b),[]);
    await seed(a,true);assert.deepEqual(await list(b),[]);await seed(b,false);
    const initial=await snapshot(a);assert.equal(initial.objects.length,2);assert.equal(initial.relations.length,1);assert.equal(initial.assets.length,1);emit('DB8_AND_INDEPENDENT_ORIGINS');
    phase='UI_A_TO_B';const first=join(root,'a.iwxa'),da=await exportArchive(a,first);
    await prepareImportArchive(b,first);const firstReceipt=await commitImport(b,da);assert.ok(firstReceipt.counts,'FIRST_IMPORT_REJECTED');
    covers(await snapshot(b),initial);
    phase='B_CONTINUATION';await appendB(b);const bBefore=await snapshot(b);
    assert.equal(bBefore.objects.length,3);assert.equal(bBefore.relations.length,2);assert.equal(bBefore.assets.length,2);
    covers(bBefore,initial);
    const by=new Map(bBefore.wireOrder);assert.ok(initial.wireOrder.some(([id,order])=>by.has(id)&&by.get(id)!==order),'NO_WIRE_ORDER_DIFFERENCE');
    phase='UI_B_TO_A';const back=join(root,'b.iwxa'),db=await exportArchive(b,back);
    const preReturn=await snapshot(a);
    await prepareImportArchive(a,back);const returned=await commitImport(a,db);
    if(variant==='base'){
      assert.ok(returned.state==='error'&&returned.collision,'BASELINE_EXPECTED_COLLISION_MISSING');
      assert.equal(business(await snapshot(a)),business(preReturn),'BASELINE_PARTIAL_WRITE');
      emit('NATIVE_BASELINE_COLLISION');return true;
    }
    assert.ok(returned.counts,'CANDIDATE_RETURN_REJECTED');
    const merged=await snapshot(a);covers(merged,initial);covers(merged,bBefore);
    assert.equal(merged.objects.length,3);assert.equal(merged.relations.length,2);assert.equal(merged.assets.length,2);
    emit('NATIVE_DB8');emit('NATIVE_A_B_A_ROUNDTRIP');emit('NATIVE_HISTORY_RELATIONS_ASSETS');
    phase='UI_REIMPORT';await prepareImportArchive(a,back);const repeated=await commitImport(a,db);
    assert.ok(repeated.counts,'REIMPORT_REJECTED');
    const after=await snapshot(a);covers(after,merged);
    for(const kind of ['objects','relations','assets'])assert.equal(canonical(after[kind]),canonical(merged[kind]));
    const oldIds=new Set(merged.events.map(e=>e.event_id));
    assert.ok(after.events.filter(e=>!oldIds.has(e.event_id)).every(e=>e.event_type==='iwxa.import.applied'),'DUPLICATED_BUSINESS_HISTORY');
    assert.equal(Number(repeated.counts['Объектов создано']),0);assert.equal(Number(repeated.counts['Событий']),0);
    emit('NATIVE_REIMPORT');
    const uiOk=!useUi||(firstReceipt.state==='committed'&&returned.state==='committed'&&repeated.state==='committed');
    if(useUi)emit('T2_MERGE_PRESENTATION',uiOk?'PASS':'FAIL');
    phase='ORIGINAL_READ_ONLY';await readonly(a);await readonly(b);emit('T2_ORIGINAL_READ_ONLY_GRANTS');
    phase='COLD';const finalA=await snapshot(a),finalB=await snapshot(b);
    await a.context.close();a.context=null;await b.context.close();b.context=null;
    await launch(a);await launch(b);
    assert.equal(business(await snapshot(a)),business(finalA));assert.equal(business(await snapshot(b)),business(finalB));
    emit('NATIVE_COLD_RESTART');
    phase='NATIVE_REAL_CONFLICT';const event=initial.events.find(e=>e.event_type==='k036.fixture.object');assert.ok(event);
    await corruptOnlyFixture(b,event.event_id);
    const conflictFile=join(root,'conflict.iwxa'),dc=await exportArchive(b,conflictFile),beforeConflict=await snapshot(a);
    await prepareImportArchive(a,conflictFile);const rejected=await commitImport(a,dc);
    assert.ok(rejected.state==='error'&&rejected.collision,'TRUE_COLLISION_NOT_REJECTED');
    assert.equal(business(await snapshot(a)),business(beforeConflict),'TRUE_COLLISION_PARTIAL_WRITE');
    emit('NATIVE_ATOMIC_REAL_CONFLICT');
    emit('NATIVE_KERNEL_EXECUTION');return uiOk;
  }catch(e){
    // Never emit raw private exception messages or archive data.
    emit('NATIVE_'+variant.toUpperCase()+'_FAILED_PHASE',phase);emit('NATIVE_'+variant.toUpperCase()+'_FAILED_DETAIL',detail);
    if(useUi){for(const [label,side] of [['A',a],['B',b]])if(side.page){try{for(const testid of ['exchange-home-route','export-view','export-preview-result','export-artifact','export-receipt','import-view','import-preview','import-error','import-scope-blocked','import-plan-issues','import-receipt','kernel-unavailable-panel','operation-not-granted'])if(await side.page.getByTestId(testid).count())emit('UI_'+label+'_PRESENT',testid.toUpperCase().replaceAll('-','_'));}catch{}}}
    const text=String(e?.message||'');
    for(const code of ['IMPORT_EVENT_ID_COLLISION','WRITER_GRANT_MISSING','NO_WIRE_ORDER_DIFFERENCE','SCOPE_BLOCKED','COMMIT_DISABLED','NATIVE_DB8_NOT_PRESENT','FIRST_IMPORT_REJECTED','CANDIDATE_RETURN_REJECTED','HISTORY_OR_RECORD_CHANGED','TRUE_COLLISION_NOT_REJECTED','TRUE_COLLISION_PARTIAL_WRITE','REIMPORT_REJECTED','DUPLICATED_BUSINESS_HISTORY','BASELINE_EXPECTED_COLLISION_MISSING'])if(text.includes(code))say('NATIVE_FAILURE_CODE',code);
    if(e?.name==='TimeoutError')say('NATIVE_FAILURE_CODE','BROWSER_TIMEOUT');
    return false;
  }finally{
    for(const side of [a,b]){if(side.context)await side.context.close().catch(()=>{});if(side.live)await new Promise(ok=>side.live.server.close(ok));}
    rmSync(root,{recursive:true,force:true});
  }
}
const apiBase=await scenario('base',false),apiCandidate=await scenario('candidate',false);
const uiBase=await scenario('base',true),uiCandidate=await scenario('candidate',true);
say('NATIVE_API_GATE',apiBase&&apiCandidate?'PASS':'FAIL');
say('NATIVE_UI_GATE',uiBase&&uiCandidate?'PASS':'FAIL');
if(!apiBase||!apiCandidate||!uiBase||!uiCandidate)process.exitCode=1;
