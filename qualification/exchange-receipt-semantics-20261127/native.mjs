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
const requiredAsset=['asset_id','workspace_id','service_id','mime','size','created_at'];
const optionalAsset=['object_id','path','updated_at','updated_by_service','revision'];
let assetIssues=new Set();
let rawAssetDifferences=0;
function coversAssets(actual,expected){
  const map=new Map(actual.assets.map(x=>[x.asset_id,x]));
  assert.equal(map.size,actual.assets.length,'DUPLICATE_ASSET_ID');
  for(const e of expected.assets){
    const a=map.get(e.asset_id);
    if(!a){assetIssues.add('ASSET_MISSING');continue;}
    if(canonical(a.bytes)!==canonical(e.bytes))assetIssues.add('BYTES');
    for(const key of [...requiredAsset,...optionalAsset])if(canonical(a.meta[key])!==canonical(e.meta[key]))assetIssues.add(key.toUpperCase());
    const ar=actual.assetRows.find(x=>x.asset_id===e.asset_id),er=expected.assetRows.find(x=>x.asset_id===e.asset_id);
    if(canonical(ar)!==canonical(er))rawAssetDifferences++;
  }
}
const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?
  Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
function contains(actual,expected,key){
  const by=new Map(actual.map(x=>[x[key],x]));
  assert.equal(by.size,actual.length,'DUPLICATE_ID');
  for(const row of expected)assert.equal(canonical(by.get(row[key])),canonical(row),'HISTORY_OR_RECORD_CHANGED_'+key.toUpperCase());
}
function covers(actual,expected){
  contains(actual.events,expected.events,'event_id');
  contains(actual.objects,expected.objects,'object_id');
  contains(actual.relations,expected.relations,'relation_id');
  coversAssets(actual,expected);
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
    s.controlPlane.services.push({schema_version:'0.3.1',service_id:auditor,capability_control:'NONE',capability_ceiling:[],activation_any_of:[],operation_guards:[]});
    put(root,'_iwxa/domain.json',s.domain);put(root,'workspace/workspace.config.json',s.workspaceConfig);
    put(root,'_iwxa/services/'+auditor+'.json',reader);
    put(root,'_iwxa/security/capability-control-plane.json',s.controlPlane);
    return live;
  }catch(e){live.server.close();throw e;}
}
async function launch(side){
  side.context=await chromium.launchPersistentContext(side.profile,{headless:true,ignoreHTTPSErrors:true,serviceWorkers:'block',acceptDownloads:true});
  await side.context.route('**/*',route=>{const u=route.request().url();return u.startsWith(side.live.origin+'/')||u===side.live.origin||u.startsWith('blob:')||u.startsWith('data:')?route.continue():route.abort();});
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
    const client=await IWXA.connect({service_id:writer,required_levels:['T1']});
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
      const assetRows=rows.assets;
      const assets=await Promise.all(assetRows.map(async row=>{
        const read=await client.t1.getAsset(ws,row.asset_id);
        if(!read?.asset||!read.bytes)throw Error('ASSET_API_MISSING');
        return {asset_id:row.asset_id,meta:await normalize(read.asset),bytes:Array.from(read.bytes)};
      }));
      return {...meta,...rows,assets,assetRows,wireOrder:values[2].filter(v=>v.workspace_id===ws).map(e=>[e.event_id,JSON.stringify(e)])};
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
  const receiptDigest=await page.getByTestId('export-receipt').evaluate(el=>Array.from(el.querySelectorAll('dt')).find(dt=>dt.textContent.trim()==='package_digest')?.nextElementSibling?.textContent?.trim());
  assert.equal(receiptDigest,digest,'EXPORT_RECEIPT_DIGEST');
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
async function scenario(variant){
  const root=join(tmp,variant+'-ordinary-repeat');mkdirSync(root,{recursive:true});
  const a={profile:join(root,'profile-a')},b={profile:join(root,'profile-b')};
  let phase='STAGE';assetIssues=new Set();rawAssetDifferences=0;
  const emit=(name,value='PASS')=>say(variant.toUpperCase()+'_'+name,value);
  try{
    a.live=await stage(join(root,'host-a'),variant);b.live=await stage(join(root,'host-b'),variant);
    assert.notEqual(a.live.origin,b.live.origin);await launch(a);await launch(b);
    phase='DB8_AND_ISOLATION';
    assert.deepEqual(await list(a),[]);assert.deepEqual(await list(b),[]);
    await seed(a,true);assert.deepEqual(await list(b),[]);await seed(b,false);
    const initial=await snapshot(a);emit('DB8_ISOLATED');
    phase='FIRST_UI_IMPORT';
    const archive=join(root,'a.iwxa'),digest=await exportUi(a,archive);
    await prepareImport(b,archive);const first=await commitUi(b,digest);
    assert.equal(first.state,'committed','FIRST_IMPORT_NOT_COMMITTED');
    const before=await snapshot(b);covers(before,initial);
    assert.equal(assetIssues.size,0,'FIRST_ASSET_CONTRACT');
    emit('FIRST_UI_IMPORT');
    phase='REPEAT_SAME_FILE';
    await prepareImport(b,archive);const repeated=await commitUi(b,digest);
    if(!repeated.counts){emit('REPEAT_REFUSED',repeated.collision?'EVENT_COLLISION':'OTHER');return false;}
    assert.equal(repeated.state,'committed','REPEAT_FALSE_INCOMPLETE');
    assert.equal(Number(repeated.counts['Объектов создано']),0,'REPEAT_OBJECT_INSERT');
    assert.equal(Number(repeated.counts['Объектов обновлено']),0,'REPEAT_OBJECT_UPDATE');
    assert.equal(Number(repeated.counts['Объектов пропущено']),initial.objects.length,'REPEAT_EXISTING_COUNT');
    assert.equal(Number(repeated.counts['Событий']),0,'REPEAT_EVENT_INSERT');
    assert.equal(await b.page.getByTestId('import-incomplete-notice').count(),0,'REPEAT_FALSE_INCOMPLETE');
    assert.equal(await b.page.getByTestId('import-existing-records-notice').count(),1,'REPEAT_NOTICE_MISSING');
    const after=await snapshot(b);covers(after,before);
    assert.equal(canonical(after.objects),canonical(before.objects),'REPEAT_OBJECT_CHANGE');
    assert.equal(canonical(after.relations),canonical(before.relations),'REPEAT_RELATION_CHANGE');
    assert.equal(assetIssues.size,0,'REPEAT_ASSET_CONTRACT');
    const prior=new Set(before.events.map(e=>e.event_id));
    assert.ok(after.events.filter(e=>!prior.has(e.event_id)).every(e=>e.event_type==='iwxa.import.applied'),'DUPLICATE_HISTORY');
    emit('REPEAT_UI_AND_PRESERVED_HISTORY');
    phase='COLD';
    await b.context.close();b.context=null;await launch(b);
    assert.equal(business(await snapshot(b)),business(after),'COLD_READBACK_CHANGE');
    await readonly(b);emit('COLD_READBACK_AND_READ_ONLY');
    phase='CONFLICT_SKIP';
    await rootPage(b);
    await b.page.evaluate(async({writer,ws})=>{
      const c=await IWXA.connect({service_id:writer,required_levels:['T1','T2']});
      const old=await c.t1.getObject(ws,'a-one');
      await c.t1.putObject({workspace_id:ws,object_id:'a-one',schema_id:'iwxa.demo.note',
        schema_version:'1.0.0',base_revision:old.object.revision,data:{title:'local revision'},
        event:{event_type:'k036.fixture.local-edit',payload:{}}});
    },{writer,ws});
    const changed=await snapshot(b);
    await prepareImport(b,archive);
    await b.page.getByTestId('import-conflict').selectOption('skip');
    const conflicted=await commitUi(b,digest);
    assert.equal(conflicted.state,'incomplete','REAL_CONFLICT_NOT_REPORTED');
    assert.equal(await b.page.getByTestId('import-incomplete-notice').count(),1,'REAL_CONFLICT_NOTICE_MISSING');
    const postConflict=await snapshot(b);
    assert.equal(canonical(postConflict.objects.find(o=>o.object_id==='a-one')),
      canonical(changed.objects.find(o=>o.object_id==='a-one')),'CONFLICT_OVERWROTE_LOCAL');
    emit('REAL_SKIPPED_CONFLICT_REPORTED');
    return true;
  }catch(e){
    emit('FAIL_PHASE',phase);emit('FAIL_DETAIL',detail||'NONE');
    const message=String(e?.message||'');
    for(const code of ['FIRST_IMPORT_NOT_COMMITTED','FIRST_ASSET_CONTRACT','REPEAT_FALSE_INCOMPLETE','REPEAT_OBJECT_INSERT','REPEAT_OBJECT_UPDATE','REPEAT_EXISTING_COUNT','REPEAT_EVENT_INSERT','REPEAT_NOTICE_MISSING','REPEAT_OBJECT_CHANGE','REPEAT_RELATION_CHANGE','REPEAT_ASSET_CONTRACT','DUPLICATE_HISTORY','COLD_READBACK_CHANGE','REAL_CONFLICT_NOT_REPORTED','REAL_CONFLICT_NOTICE_MISSING','CONFLICT_OVERWROTE_LOCAL','SCOPE_BLOCKED','COMMIT_DISABLED','HISTORY_OR_RECORD_CHANGED','IMPORT_EVENT_ID_COLLISION'])if(message.includes(code))emit('FAIL_CODE',code);
    if(e?.name==='TimeoutError')emit('FAIL_CODE','BROWSER_TIMEOUT');
    return false;
  }finally{
    for(const side of [a,b]){if(side.context)await side.context.close().catch(()=>{});if(side.live)await new Promise(ok=>side.live.server.close(ok));}
    rmSync(root,{recursive:true,force:true});
  }
}
const baseline=await scenario('base'),candidate=await scenario('candidate');
say('ORDINARY_BASELINE_UI',baseline?'PASS':'FAIL');
say('ORDINARY_CANDIDATE_UI',candidate?'PASS':'FAIL');
if(!baseline||!candidate)process.exitCode=1;
