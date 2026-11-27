// Verify the actual delivered HTTPS directory, not another independently assembled Host.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {createHash,X509Certificate} from "node:crypto";
import https from "node:https";
import {chromium} from "playwright";
const [root,certFile]=process.argv.slice(2);
const origin="https://localhost:18443";
const ca=new X509Certificate(readFileSync(certFile)).toString();
const request=path=>new Promise((ok,bad)=>https.get(origin+path,{ca,family:4},r=>{const chunks=[];r.on("data",c=>chunks.push(c));r.on("end",()=>ok({status:r.statusCode,bytes:Buffer.concat(chunks)}));}).on("error",bad));
const hash=b=>createHash("sha256").update(b).digest("hex");
let ready=false;
for(let i=0;i<40;i++){try{ready=(await request("/workspace/")).status===200;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,500));}
assert.ok(ready,"DELIVERED_HTTPS_HOST_NOT_STARTED");
const receipt=JSON.parse(readFileSync(join(root,"acceptance-receipt.json"),"utf8"));
assert.equal(hash((await request("/t3-offline-manifest.json")).bytes),receipt.offlineManifestSha256);
assert.equal(hash((await request("/_iwxa/runtime/0.3.6/runtime.js")).bytes),receipt.kernelRuntimeSha256);
for(const path of ["/","/workspace/","/workspace/exchange/","/workspace/lifecycle/"])
 assert.equal((await request(path)).status,200);
const browser=await chromium.launch({headless:true});
try{
 // The ephemeral CI user trusts the SAME kind of localhost certificate
 // as the Windows launcher. Do not suppress TLS validation in the browser.
 const context=await browser.newContext();
 const page=await context.newPage();
 const diagnostics=[];
 page.on("pageerror",e=>diagnostics.push("pageerror: "+e.message));
 page.on("console",m=>{if(m.type()==="error")diagnostics.push(m.text());});
 page.on("requestfailed",r=>diagnostics.push(r.url()+": "+r.failure()?.errorText));
 page.on("response",r=>{if(r.status()>=400)diagnostics.push(r.status()+" "+r.url());});
 await page.goto(origin+"/workspace/",{waitUntil:"domcontentloaded"});
 await page.waitForFunction(()=>typeof window.IWXA?.connect==="function");
 const gate=page.getByTestId("t2-first-run-create");
 if(await gate.isVisible().catch(()=>false))await gate.click();
 const launcher=page.getByTestId("t3-local-inference-launcher");
 await launcher.waitFor({state:"visible",timeout:60000});
 await launcher.getByRole("button",{name:"Открыть локальную модель"}).click();
 await page.getByTestId("t3-local-inference-panel").waitFor({state:"visible"});
 // Original Kernel makes a transferable example, rather than a hand-built .iwxa.
 const example=await page.evaluate(async()=>{
  const kernel=await IWXA.connect({service_id:"iwxa.workspace.integration"});
  const workspace="rc2-acceptance-document-review";
  await kernel.t1.createWorkspace({workspace_id:workspace,profile:"generic"});
  const a=await kernel.t1.putObject({workspace_id:workspace,object_id:"review:request",schema_id:"iwxa.demo.note",schema_version:"1.0.0",base_revision:0,data:{title:"Заявка на проверку документа",text:"Согласовать комплект поставки и приложенные замечания."},event:{event_type:"t3.acceptance.request.created",payload:{}}});
  const b=await kernel.t1.putObject({workspace_id:workspace,object_id:"review:conclusion",schema_id:"iwxa.demo.note",schema_version:"1.0.0",base_revision:0,data:{title:"Заключение по комплекту",text:"Комплект содержит заявку и приложение; требуется согласование."},event:{event_type:"t3.acceptance.conclusion.created",payload:{}}});
  await kernel.t1.putRelation({workspace_id:workspace,relation_id:"review-related",from_object_id:"review:request",to_object_id:"review:conclusion",kind:"related",event:{event_type:"t3.acceptance.relation.created",payload:{}}});
  await kernel.t1.putAsset({workspace_id:workspace,asset_id:"review-attachment",object_id:"review:request",mime:"text/plain",bytes:new TextEncoder().encode("Перечень замечаний: проверить состав и дату документа."),event:{event_type:"t3.acceptance.attachment.created",payload:{}}});
  const opts={workspaces:[workspace],include_history:true,include_assets:true,include_relations:true,include_schemas:true};
  const preview=await kernel.t2.exportPreview(opts);
  const archive=await kernel.t2.exportPackage(opts);
  await kernel.t2.confirmExport({package_digest:archive.package_digest,workspace_ids:[workspace]});
  return {counts:preview.counts,bytes:Array.from(archive.bytes),events:[a.event.event_id,b.event.event_id]};
 });
 assert.equal(example.counts.objects,2);assert.equal(example.counts.assets,1);assert.equal(example.counts.relations,1);
 mkdirSync(join(root,"examples"),{recursive:true});
 const bytes=Buffer.from(example.bytes);writeFileSync(join(root,"examples/workspace-original.iwxa"),bytes);
 writeFileSync(join(root,"examples/receipt.json"),JSON.stringify({source:"ORIGINAL_KERNEL_EXPORT",counts:example.counts,sha256:hash(bytes),events:example.events},null,2)+"\n");
 await page.goto(origin+"/workspace/#/workspace/rc2-acceptance-document-review");
 await page.getByTestId("workspace-view").waitFor({state:"visible",timeout:45000});
 assert.equal(await page.getByTestId("module-route-not-found").count(),0);
 // Install only by explicit click; actual served snapshot must be usable.
 page.once("dialog",d=>d.accept());
 await page.locator("#iwxa-t3-domain-switch").check();
 try{
  await page.waitForFunction(()=>document.documentElement.hasAttribute("data-iwxa-t3-autonomous")&&Boolean(navigator.serviceWorker.controller),null,{timeout:60000});
 }catch(error){
  const status=await page.evaluate(async()=>({secure:window.isSecureContext,
    controls:document.getElementById("iwxa-t3-domain-controls")?.innerText,
    registrations:(await navigator.serviceWorker.getRegistrations()).map(r=>({scope:r.scope,active:r.active?.scriptURL})),
    controller:navigator.serviceWorker.controller?.scriptURL})).catch(e=>({probeError:String(e)}));
  throw Error("T3_RC2_DELIVERED_OFFLINE_INSTALL_FAILED "+JSON.stringify({status,diagnostics:diagnostics.slice(-25),wait:String(error)}));
 }
 await context.setOffline(true);
 await page.reload({waitUntil:"domcontentloaded"});
 await page.getByTestId("workspace-view").waitFor({state:"visible",timeout:45000});
 const record=await page.evaluate(async()=>{const k=await IWXA.connect({service_id:"iwxa.workspace.integration"});return k.t1.getObject("rc2-acceptance-document-review","review:request");});
 assert.equal(record?.object?.data?.title,"Заявка на проверку документа");
 console.log("T3_RC2_EXACT_DELIVERED_HOST_HTTPS_BLI_OFFLINE_AND_REAL_IWXA_PASS "+JSON.stringify({modelDownloaded:false,hardwareInferenceQualified:false,exampleSha256:hash(bytes)}));
 await context.close();
}finally{await browser.close();}
