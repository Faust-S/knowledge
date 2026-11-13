// Real browser-managed PWA installation and launch, not a shortcut or iframe.
// Uses Chrome DevTools' PWA.install/PWA.launch API against the actual OS/browser.
// Same origin, profile, Domain Mode, and storage. No second T3 Host or Kernel.
// Real original T2 Kernel is qualified by the separate inherited Host workflow.
import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {createServer as createTcpServer} from "node:net";
import {mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,extname,join,resolve,sep,relative} from "node:path";
import {chromium} from "playwright";
import {materializeDomainMode} from "../scripts/materialize-t3-domain-mode.mjs";

function put(root,name,data) {
  const p=join(root,name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,data);
}
function createFixture(root) {
  const page=(title,body)=>'<!doctype html><html lang="ru"><head><title>'+title+
    '</title></head><body><main>'+body+'</main></body></html>';
  put(root,"index.html",page("Установка IWXA T3","<h1>Клуб IWXA</h1><a href='/workspace/'>Workspace</a>"));
  put(root,"workspace/index.html",page("Оригинальная Workspace","<h1>Workspace</h1>"));
  put(root,"_iwxa/domain.json",JSON.stringify({origin:"https://club.iwxa.ru"}));
  put(root,"_iwxa/domain-shell.json","{}");
  put(root,"_iwxa/service-catalog.json","{}");
  put(root,"_iwxa/runtime/0.3.6/runtime.js","/* installation-only fixture, not original Kernel */");
}
function serve(root) {
  return createServer((req,res)=>{
    const url=new URL(req.url||"/","http://127.0.0.1");
    let path;
    try {path=decodeURIComponent(url.pathname);} catch{res.writeHead(400);res.end();return;}
    if(path.includes("..")||path.includes("\\")||path.includes("\0")){
      res.writeHead(400);res.end();return;
    }
    const file=resolve(root,"."+path+(path.endsWith("/")?"index.html":""));
    if(file!==root&&!file.startsWith(root+sep)){res.writeHead(404);res.end();return;}
    const type={".html":"text/html; charset=utf-8",".mjs":"text/javascript; charset=utf-8",
      ".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",
      ".png":"image/png",".css":"text/css; charset=utf-8"};
    try {
      const data=readFileSync(file);
      res.writeHead(200,{"content-type":type[extname(file)]||"application/octet-stream",
        "cache-control":"no-store","x-content-type-options":"nosniff"});
      res.end(data);
    }catch {res.writeHead(404);res.end("not found");}
  });
}
async function listen(server) {
  await new Promise((resolve,reject)=>{
    server.once("error",reject);server.listen(0,"127.0.0.1",resolve);
  });
  return server.address().port;
}
async function openPort() {
  const server=createTcpServer();
  const port=await listen(server);
  await new Promise(resolve=>server.close(resolve));
  return port;
}
async function putRecord(page,value) {
  return page.evaluate(value=>new Promise((resolve,reject)=>{
    const request=indexedDB.open("iwxa-t3-pwa-install-witness",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("objects");
    request.onerror=()=>reject(request.error||Error("OPEN_FAILED"));
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction("objects","readwrite");
      tx.objectStore("objects").put(value,"witness");
      tx.oncomplete=()=>{db.close();resolve(true);};
      tx.onerror=()=>reject(tx.error);
    };
  }),value);
}
async function getRecord(page) {
  return page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open("iwxa-t3-pwa-install-witness",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("objects");
    request.onerror=()=>reject(request.error||Error("OPEN_FAILED"));
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction("objects","readonly");
      const read=tx.objectStore("objects").get("witness");
      read.onsuccess=()=>resolve(read.result||null);
      read.onerror=()=>reject(read.error);
      tx.oncomplete=()=>db.close();
    };
  }));
}
test("browser PWA.install + PWA.launch: actual installed app, same origin data, offline cold restart",{
  timeout:180000
},async()=>{
  const root=mkdtempSync(join(tmpdir(),"iwxa-t3-pwa-os-"));
  const profile=mkdtempSync(join(tmpdir(),"iwxa-t3-pwa-profile-"));
  const site=serve(root);
  let context=null,browser=null,cdp=null;
  try {
    createFixture(root);
    const built=materializeDomainMode(root);
    assert.ok(built.files>0);
    const port=await listen(site);
    const base="http://127.0.0.1:"+port;
    const manifestId=base+"/";
    const debugPort=await openPort();
    const start=async()=>{
      context=await chromium.launchPersistentContext(profile,{
        channel:process.platform==="win32"?"msedge":undefined,
        headless:true,viewport:{width:1200,height:780},
        args:["--remote-debugging-port="+debugPort,"--no-sandbox"],
      });
      browser=await chromium.connectOverCDP("http://127.0.0.1:"+debugPort,{
        timeout:15000
      });
      cdp=await browser.newBrowserCDPSession();
    };
    await start();
    const page=context.pages()[0]||await context.newPage();
    await page.goto(base+"/");
    const pageDevtools=await context.newCDPSession(page);
    const manifest=await pageDevtools.send("Page.getAppManifest");
    assert.equal(manifest.errors?.length,0);
    assert.equal(JSON.parse(manifest.data).display,"standalone");
    await pageDevtools.detach();
    await putRecord(page,{status:"written-in-ordinary-browser",revision:1});
    // Call the actual browser-controlled installation endpoint.
    await cdp.send("PWA.install",{manifestId,installUrlOrBundleUrl:base+"/"});
    const os=await cdp.send("PWA.getOsAppState",{manifestId});
    assert.equal(typeof os.badgeCount,"number","browser must report the installed OS webapp");
    const launch=await cdp.send("PWA.launch",{manifestId});
    assert.equal(typeof launch.targetId,"string","OS PWA launch must create a target");
    let app=context.pages().find(p=>p!==page&&p.url().startsWith(base));
    if(!app)app=await context.waitForEvent("page",{timeout:15000});
    await app.waitForLoadState();
    assert.equal(new URL(app.url()).origin,base);
    assert.equal(await app.evaluate(()=>matchMedia("(display-mode: standalone)").matches),
      true,"installed app must have standalone display mode");
    assert.deepEqual(await getRecord(app),{status:"written-in-ordinary-browser",revision:1},
      "PWA and ordinary browser must share the same origin database");
    // T3 autonomy remains an explicit separate opt-in inside the installed app.
    assert.equal(await app.locator("#iwxa-t3-domain-switch").isChecked(),false);
    app.once("dialog",dialog=>dialog.accept());
    await app.locator("#iwxa-t3-domain-switch").check();
    await app.waitForFunction(()=>document.documentElement.hasAttribute("data-iwxa-t3-autonomous"),
      null,{timeout:30000});
    assert.deepEqual(await getRecord(page),{status:"written-in-ordinary-browser",revision:1},
      "turning on the single T3 offline worker never forks the original database");
    await browser.close();browser=null;cdp=null;
    await context.close();context=null;
    await start();
    const pageAfter=context.pages()[0]||await context.newPage();
    await pageAfter.goto(base+"/");
    assert.deepEqual(await getRecord(pageAfter),{status:"written-in-ordinary-browser",revision:1});
    const relaunch=await cdp.send("PWA.launch",{manifestId});
    assert.equal(typeof relaunch.targetId,"string","installed OS app survives browser restart");
    let installed=context.pages().find(p=>p!==pageAfter&&p.url().startsWith(base));
    if(!installed)installed=await context.waitForEvent("page",{timeout:15000});
    await installed.waitForLoadState();
    assert.equal(await installed.evaluate(()=>matchMedia("(display-mode: standalone)").matches),true);
    await context.setOffline(true);
    await installed.reload({waitUntil:"domcontentloaded"});
    assert.match(await installed.locator("main h1").textContent(),/Клуб IWXA/);
    assert.deepEqual(await getRecord(installed),{status:"written-in-ordinary-browser",revision:1},
      "installed app reopens offline with same data after cold restart");
    await context.setOffline(false);
    await cdp.send("PWA.uninstall",{manifestId});
    console.log(JSON.stringify({status:"PASS",marker:"T3_PWA_OS_INSTALLED_AND_REOPENED",
      browser:process.platform==="win32"?"Microsoft Edge":"Chromium",
      manifestId,standalone:true,sharedProfileData:true,offline:true,
      independentKernelAltered:false,originalKernelTested:false}));
  } finally {
    if(browser)await browser.close().catch(()=>{});
    if(context)await context.close().catch(()=>{});
    if(site.listening)await new Promise(resolve=>site.close(resolve));
    rmSync(root,{recursive:true,force:true});
    rmSync(profile,{recursive:true,force:true});
  }
});
