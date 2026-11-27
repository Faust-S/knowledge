// Targeted final engineering user route on the exact downloaded rc.5 delivery.
// No reconstruction, product modifications, mock service, direct data writes or certificate flags.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,existsSync,mkdirSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {spawn} from "node:child_process";
import {once} from "node:events";
import http from "node:http";
import {chromium} from "playwright";
const [rootArg,resultsArg]=process.argv.slice(2);
const root=resolve(rootArg),results=resolve(resultsArg),origin="http://localhost:18443";
mkdirSync(results,{recursive:true});
const ws="rc5-acceptance-document-review",ids=["review:request","review:conclusion"],service="iwxa.workspace.integration";
const example=join(root,"examples/workspace-original.iwxa");
const sha=b=>createHash("sha256").update(b).digest("hex");
const originalReceipt=JSON.parse(readFileSync(join(root,"examples/receipt.json"),"utf8"));
assert.equal(sha(readFileSync(example)),"5ba186c640054d8d4108242fc123f4506470bc63982193321d31c4096e52c51e");
assert.equal(originalReceipt.sha256,sha(readFileSync(example)));
assert.equal(originalReceipt.counts.objects,2);
assert.equal(originalReceipt.counts.assets,1);
assert.equal(originalReceipt.counts.relations,1);
const delivery=JSON.parse(readFileSync(join(root,"acceptance-receipt.json"),"utf8"));
assert.equal(delivery.sourceCommit,"a50d40dafc2e029fcc7668dece925f7fc38cc510");
assert.equal(delivery.origin,origin);
assert.equal(delivery.offlineManifestSha256,"4c2e7d80116a9bef8c7d75591de97595fe72d4d34898587935f7e25aac9e3d1e");
const request=path=>new Promise((ok,bad)=>{
 const req=http.get(origin+path,{family:4},r=>{const chunks=[];r.on("data",c=>chunks.push(c));r.on("end",()=>ok({status:r.statusCode,bytes:Buffer.concat(chunks)}));r.on("error",bad);});
 req.setTimeout(2500,()=>req.destroy(Error("HTTP_TIMEOUT:"+path)));req.on("error",bad);
});
const child=spawn(join(root,"runtime/node.exe"),[join(root,"serve-acceptance.mjs")],{cwd:root,windowsHide:true,stdio:["ignore","pipe","pipe"]});
child.stdout.on("data",d=>process.stdout.write(d));child.stderr.on("data",d=>process.stderr.write(d));
let phase="START",a,b,current;const passed=[];
const pass=(name,detail={})=>{passed.push(name);console.log("T3_RC5_FINAL_"+name+"_PASS "+JSON.stringify(detail));};
async function stopHost(){
 if(child.exitCode===null&&child.signalCode===null){const ended=once(child,"exit");child.kill();await ended;}
}
async function launch(profile,offline=false){
 const c=await chromium.launchPersistentContext(profile,{headless:true,acceptDownloads:true,viewport:{width:1280,height:820}});
 if(offline)await c.setOffline(true);
 const page=c.pages()[0]||await c.newPage();page.setDefaultTimeout(20000);current=page;
 return {context:c,page,profile};
}
async function host(page,path="/workspace/"){
 await page.goto(origin+path,{waitUntil:"domcontentloaded"});
 assert.equal(await page.evaluate(()=>isSecureContext),true);
 await page.waitForFunction(()=>typeof window.IWXA?.connect==="function");
}
async function openExchange(page,tab){
 await host(page,"/workspace/exchange/#/home");
 const gate=page.getByTestId("t2-first-run-create");
 if(await gate.isVisible().catch(()=>false))await gate.click();
 await page.getByTestId("exchange-home-route").waitFor();
 await page.getByTestId("packages-tab-"+tab).click();
}
const counts=(page,testid)=>page.getByTestId(testid).evaluate(el=>Object.fromEntries([...el.querySelectorAll("dt")].map(dt=>[dt.textContent.trim(),dt.nextElementSibling.textContent.trim()])));
async function selectArchive(page,file){
 await openExchange(page,"import");
 const input=page.getByTestId("import-file");
 await input.waitFor({state:"visible"});
 // Use the actual file input event, no direct Kernel import.
 const choosing=page.waitForEvent("filechooser");await input.click();
 await (await choosing).setFiles(file);
 await page.getByTestId("import-preview").waitFor();
 const preview=await counts(page,"import-preview");
 assert.equal(Number(preview["Рабочих областей"]),1);
 assert.equal(Number(preview["Объектов"]),2);
 assert.equal(Number(preview["Связей"]),1);
 assert.equal(Number(preview["Ассетов"]),1);
 assert.ok(Number(preview["Событий"])>=2&&Number(preview["Схем"])>=1);
 const text=await page.getByTestId("import-preview").innerText();
 const digest=text.match(/package_digest:\s*([a-f0-9]{64})/i)?.[1];
 assert.ok(digest,"PREVIEW_DIGEST_MISSING");
 return digest;
}
async function commit(page,mode,digest){
 const menu=page.getByTestId("import-mode");
 // Full restoration follows the original Kernel's advertised permissions.
 if(mode==="restore"){
  const full=await menu.locator('option[value="full"]').isEnabled();
  mode=full?"full":"selective";
 }
 await menu.selectOption(mode);
 await page.getByTestId("import-conflict").selectOption("fail");
 if(mode==="merge")await page.getByTestId("import-target-workspace").selectOption(ws);
 for(const key of ["history","assets","relations"])await page.getByTestId("import-include_"+key).check();
 assert.equal(await page.getByTestId("import-scope-blocked").count(),0);
 await page.getByTestId("import-commit").click();
 await page.waitForFunction(()=>["committed","incomplete","unconfirmed","error","expired"].includes(document.querySelector('[data-testid="import-view"]')?.getAttribute("data-import-state")));
 const state=await page.getByTestId("import-view").getAttribute("data-import-state");
 assert.equal(state,"committed","IMPORT_NOT_COMMITTED: "+await page.getByTestId("import-view").innerText());
 const receipt=await counts(page,"import-receipt");
 assert.equal(receipt.package_digest,digest);assert.equal(receipt["Режим"],mode);
 assert.equal(await page.getByTestId("import-incomplete-notice").count(),0);
 return receipt;
}
// Original public Kernel APIs for readback only. No direct fixture writes.
async function read(page){
 await host(page,"/workspace/#/workspace/"+ws);
 await page.getByTestId("workspace-view").waitFor({state:"visible"});
 assert.equal(await page.getByTestId("module-route-not-found").count(),0);
 return page.evaluate(async({ws,ids,service})=>{
  const k=await IWXA.connect({service_id:service});
  if(k.runtime_version!=="0.3.6"||k.contract_version!=="1.3.0")throw Error("NOT_ORIGINAL_KERNEL");
  const docs=await Promise.all(ids.map(async id=>{const r=await k.t1.getObject(ws,id);return {id,revision:r?.object?.revision,data:r?.object?.data};}));
  const asset=await k.t1.getAsset(ws,"review-attachment");
  const events=await k.t1.listEventsSince(ws);
  const inventory=await k.t2.exportPreview({workspaces:[ws],include_history:true,include_assets:true,include_relations:true,include_schemas:true});
  return {docs,asset:{mime:asset?.asset?.mime,text:new TextDecoder().decode(asset.bytes)},eventIds:events.map(e=>e.event_id).sort(),eventTypes:events.map(e=>({id:e.event_id,type:e.event_type})),counts:inventory.counts};
 },{ws,ids,service});
}
function verifyData(s){
 assert.deepEqual(s.docs.map(d=>d.revision),[1,1]);
 assert.deepEqual(s.docs.map(d=>d.data.title),["Заявка на проверку документа","Заключение по комплекту"]);
 assert.deepEqual(s.docs.map(d=>d.data.text),["Согласовать комплект поставки и приложенные замечания.","Комплект содержит заявку и приложение; требуется согласование."]);
 assert.deepEqual(s.asset,{mime:"text/plain",text:"Перечень замечаний: проверить состав и дату документа."});
 assert.equal(s.counts.workspaces,1);assert.equal(s.counts.objects,2);assert.equal(s.counts.assets,1);assert.equal(s.counts.relations,1);assert.ok(s.counts.schemas>=1);
 assert.ok(originalReceipt.events.every(id=>s.eventIds.includes(id)),"ORIGINAL_EVENT_HISTORY_MISSING");
}
async function exportFile(page,dest){
 await openExchange(page,"export");
 const list=page.getByTestId("export-view").locator("fieldset").first().locator("label");
 await list.filter({hasText:ws}).waitFor();
 for(let i=0;i<await list.count();i++){const row=list.nth(i),cb=row.locator('input');const wanted=(await row.innerText()).includes(ws);if(await cb.isChecked()!==wanted){if(wanted)await cb.check();else await cb.uncheck();}}
 for(const k of ["history","assets","relations","schemas"])await page.getByTestId("export-include_"+k).check();
 await page.getByTestId("export-preview").click();await page.getByTestId("export-preview-result").waitFor();
 const n=await counts(page,"export-preview-result");
 assert.equal(Number(n["Объектов"]),2);assert.equal(Number(n["Связей"]),1);assert.equal(Number(n["Ассетов"]),1);assert.ok(Number(n["Схем"])>=1);
 await page.getByTestId("export-ack-sensitive").check();
 await page.getByTestId("export-package").click();await page.getByTestId("export-artifact").waitFor();
 const digest=(await page.getByTestId("export-artifact-digest").innerText()).trim();assert.match(digest,/^[a-f0-9]{64}$/);
 const pending=page.waitForEvent("download");await page.getByTestId("export-download").click();const file=await pending;
 assert.match(file.suggestedFilename(),/\.iwxa$/i);await file.saveAs(dest);assert.equal(await file.failure(),null);
 assert.ok(existsSync(dest)&&readFileSync(dest).length>100);
 assert.equal(await page.getByTestId("export-confirm").isEnabled(),false,"DOWNLOAD_ALONE_IS_NOT_SAVED");
 await page.getByTestId("export-confirm-saved-file").check();await page.getByTestId("export-confirm").click();await page.getByTestId("export-receipt").waitFor();
 assert.equal((await counts(page,"export-receipt")).package_digest,digest);
 return {digest,fileSha256:sha(readFileSync(dest))};
}
try{
 let ready=false;
 for(let i=0;i<40;i++){try{if((await request("/workspace/")).status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
 assert.ok(ready,"EXACT_HOST_NOT_LISTENING");
 assert.equal(sha((await request("/t3-offline-manifest.json")).bytes),delivery.offlineManifestSha256);
 assert.equal(sha((await request("/_iwxa/runtime/0.3.6/runtime.js")).bytes),delivery.kernelRuntimeSha256);
 pass("EXACT_LOCAL_HOST");
 phase="FIRST_IMPORT";a=await launch(join(results,"profile-a"));
 let digest=await selectArchive(a.page,example);
 const first=await commit(a.page,"restore",digest);
 assert.equal(Number(first["Объектов создано"]),2);
 const before=await read(a.page);verifyData(before);
 pass("FIRST_FILE_CHOOSER_IMPORT",{receipt:first,counts:before.counts});
 phase="REPEAT_IMPORT";
 assert.equal(await selectArchive(a.page,example),digest);
 const repeated=await commit(a.page,"merge",digest);
 assert.equal(Number(repeated["Объектов создано"]),0);assert.equal(Number(repeated["Объектов обновлено"]),0);
 assert.equal(Number(repeated["Объектов пропущено"]),2);assert.equal(Number(repeated["Событий"]),0);
 assert.equal(await a.page.getByTestId("import-existing-records-notice").count(),1);
 const after=await read(a.page);verifyData(after);
 assert.deepEqual(after.docs,before.docs);assert.deepEqual(after.asset,before.asset);
 assert.ok(before.eventIds.every(id=>after.eventIds.includes(id)));
 const beforeIds=new Set(before.eventIds);
 assert.ok(after.eventTypes.filter(e=>!beforeIds.has(e.id)).every(e=>e.type==="iwxa.import.applied"),"DUPLICATE_HISTORY");
 pass("REPEAT_IMPORT_NO_DUPLICATES",{receipt:repeated});
 phase="EXPORT";const dest=join(results,"workspace-exported.iwxa");const exported=await exportFile(a.page,dest);
 pass("EXPORT_REAL_DOWNLOAD_AND_CONFIRM",exported);
 phase="INDEPENDENT_PROFILE";b=await launch(join(results,"profile-b"));
 await host(b.page);
 const empty=await b.page.evaluate(async service=>(await (await IWXA.connect({service_id:service})).t1.listWorkspaces({})).map(w=>w.workspace_id),service);
 assert.ok(!empty.includes(ws),"RECIPIENT_NOT_INDEPENDENT");
 assert.equal(await selectArchive(b.page,dest),exported.digest);
 await commit(b.page,"restore",exported.digest);
 const received=await read(b.page);verifyData(received);
 assert.deepEqual(received.docs,after.docs);assert.deepEqual(received.asset,after.asset);
 assert.ok(after.eventIds.every(id=>received.eventIds.includes(id)),"EXPORTED_HISTORY_NOT_RESTORED");
 pass("INDEPENDENT_PROFILE_RESTORE",{counts:received.counts});
 phase="OFFLINE_INSTALL";current=b.page;
 const sw=b.page.locator("#iwxa-t3-domain-switch");await sw.waitFor({state:"visible"});
 await b.page.waitForFunction(()=>!document.querySelector("#iwxa-t3-domain-switch")?.disabled);
 assert.equal(await sw.isChecked(),false);
 b.page.once("dialog",d=>d.accept());await sw.check();
 await b.page.waitForFunction(()=>document.documentElement.hasAttribute("data-iwxa-t3-autonomous")&&Boolean(navigator.serviceWorker.controller),null,{timeout:60000});
 pass("EXPLICIT_AUTONOMY_INSTALL");
 phase="COLD_OFFLINE";await a.context.close();a=null;await b.context.close();const profile=b.profile;b=null;
 await stopHost();
 let reachable=false;try{await request("/workspace/");reachable=true;}catch{}assert.equal(reachable,false,"SERVER_STILL_REACHABLE");
 b=await launch(profile,true);const cold=await read(b.page);verifyData(cold);
 assert.equal(await b.page.evaluate(()=>navigator.onLine),false);
 assert.deepEqual(cold.docs,received.docs);assert.deepEqual(cold.asset,received.asset);assert.deepEqual(cold.eventIds,received.eventIds);
 pass("COLD_OFFLINE_SERVER_STOPPED",{newBrowserProcess:true,networkDisabled:true,serverStopped:true,counts:cold.counts});
 writeFileSync(join(results,"result.json"),JSON.stringify({status:"PASS",source:delivery.sourceCommit,phase,passed,exported,originalExampleSha256:originalReceipt.sha256},null,2)+"\n");
}catch(e){
 console.error("T3_RC5_FINAL_FAIL "+phase+" "+(e?.stack||String(e)));
 if(current&&!current.isClosed())await current.screenshot({path:join(results,"failure.png"),fullPage:true}).catch(()=>{});
 writeFileSync(join(results,"result.json"),JSON.stringify({status:"FAIL",phase,passed,error:String(e)},null,2)+"\n");process.exitCode=1;
}finally{for(const side of [a,b])if(side)await side.context.close().catch(()=>{});await stopHost();}
