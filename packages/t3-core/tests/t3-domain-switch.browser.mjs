/**
 * Browser acceptance for the public T3 autonomous-site switch, with a
 * Club-shaped neutral domain fixture. The Kernel file is a stand-in here:
 * real original T2 Kernel qualification runs separately in this same workflow.
 * No private Club source, model weights, credentials or network service.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {join,dirname,extname} from "node:path";
import {tmpdir} from "node:os";
import {chromium} from "playwright";
import {materializeDomainMode} from "../scripts/materialize-t3-domain-mode.mjs";

function write(root,path,content) {
  const destination=join(root,path);
  mkdirSync(dirname(destination),{recursive:true});
  writeFileSync(destination,content);
}
function fixture(root) {
  const page=(name)=>'<!doctype html><html lang="ru"><head><title>'+name+
    '</title></head><body><main><h1>'+name+
    '</h1><a href="/workspace/">Workspace</a><a href="/tools/">Инструменты</a></main></body></html>';
  write(root,"index.html",page("Тестовый домен"));
  write(root,"tools/index.html",'<!doctype html><html lang="ru"><head>'+
    '<title>Калькулятор домена</title></head><body><main>'+
    '<h1>Калькулятор домена</h1>'+
    '<label>Первое число<input id="a" type="number"></label>'+
    '<label>Второе число<input id="b" type="number"></label>'+
    '<button id="calculate">Рассчитать</button><output id="sum"></output>'+
    '</main><script type="module" src="/assets/calculator.mjs"></script>'+
    '</body></html>');
  write(root,"assets/calculator.mjs",
    'document.querySelector("#calculate").addEventListener("click",()=>{'+
    'document.querySelector("#sum").textContent=String('+
    'Number(document.querySelector("#a").value)+Number(document.querySelector("#b").value));});');
  write(root,"workspace/index.html",page("Исходный Workspace"));
  // No claim that this marker is a qualified Kernel: the workflow separately
  // executes the real 0.3.6 Host and storage witness.
  write(root,"_iwxa/runtime/0.3.6/runtime.js","/* browser switch fixture only */");
  write(root,"_iwxa/domain.json",JSON.stringify({origin:"https://public-domain-fixture.iwxa.invalid"}));
  write(root,"_iwxa/domain-shell.json","{}");
  write(root,"_iwxa/service-catalog.json",JSON.stringify({entries:[]}));
  write(root,".htaccess","Options -MultiViews\nDirectoryIndex index.html\n");
}
function serve(root, control = {blockUpdates:false}) {
  return createServer((req,res)=>{
    const url=new URL(req.url??"/","http://127.0.0.1");
    if (control.blockUpdates && url.pathname === "/t3-offline-manifest.json") {
      res.writeHead(503,{"cache-control":"no-store"});
      res.end("SIMULATED_UPDATE_SERVER_UNAVAILABLE");
      return;
    }
    const path=url.pathname.endsWith("/")?url.pathname+"index.html":url.pathname;
    const name=join(root,path.replace(/^\/+/,""));
    if(path.includes("..")) {res.writeHead(404);res.end();return;}
    let body;
    try {body=readFileSync(name);}catch {res.writeHead(404);res.end("not found");return;}
    const type={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",
      ".mjs":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8"};
    res.writeHead(200,{"content-type":type[extname(name)]||"application/octet-stream",
      "cache-control":"no-store"});
    res.end(body);
  });
}
async function listening(server) {
  await new Promise((resolve,reject)=>{
    server.once("error",reject);
    server.listen(0,"127.0.0.1",resolve);
  });
  return "http://127.0.0.1:"+server.address().port;
}
test("real Chromium: explicit switch, full-site offline, cold restart and persistent opt-out",{
  timeout:180000,
},async()=>{
  const root=mkdtempSync(join(tmpdir(),"t3-domain-chromium-"));
  const profile=mkdtempSync(join(tmpdir(),"t3-domain-browser-profile-"));
  const updateServer={blockUpdates:false};
  const server=serve(root, updateServer);
  let context;
  try {
    fixture(root);
    const built=materializeDomainMode(root);
    assert.ok(built.site_pages>=3);
    const base=await listening(server);
    const launch=()=>chromium.launchPersistentContext(profile,{
      headless:true,args:["--no-sandbox"],viewport:{width:1280,height:800},
    });
    context=await launch();
    let page=context.pages()[0]||await context.newPage();
    await page.goto(base+"/");
    const appManifest=await page.evaluate(async()=> {
      const link=document.querySelector('link[rel="manifest"]');
      if(!link)return null;
      return {href:new URL(link.href).pathname,data:await (await fetch(link.href)).json()};
    });
    assert.equal(appManifest?.href,"/t3-app-manifest.json");
    assert.equal(appManifest.data.display,"standalone");
    assert.equal(appManifest.data.scope,"/");
    assert.ok(appManifest.data.icons.some(icon=>icon.sizes==="192x192"));
    assert.ok(appManifest.data.icons.some(icon=>icon.sizes==="512x512"));
    const installButton=page.locator("#iwxa-t3-install-app");
    await installButton.waitFor();
    assert.equal(await installButton.isVisible(),true,"PWA installation is offered separately from T3 autonomy");
    const toggle=page.locator("#iwxa-t3-domain-switch");
    await toggle.waitFor();
    await page.waitForFunction(()=>!document.querySelector("#iwxa-t3-domain-switch").disabled);
    assert.equal(await toggle.isChecked(),false,"normal site is initial default");
    assert.equal(await page.evaluate(()=>navigator.serviceWorker.getRegistrations()
      .then(rows=>rows.length)),0,"T3 does not silently register a worker");

    // Rejecting the explicit installation must leave ordinary site unaffected.
    // A checkbox "check()" waits for a permanently checked state, but a
    // dismissed consent intentionally and immediately reverts the switch.
    // Trigger a real click, then assert the resulting cancelled state.
    page.once("dialog",dialog=>dialog.dismiss());
    await toggle.click();
    await page.waitForFunction(()=>!document.querySelector("#iwxa-t3-domain-switch").disabled);
    assert.equal(await toggle.isChecked(),false,"user can decline the entire site snapshot");

    page.once("dialog",dialog=>{
      assert.match(dialog.message(),/офлайн|автономн/i);
      return dialog.accept();
    });
    await toggle.check();
    await page.waitForFunction(()=>document.documentElement
      .hasAttribute("data-iwxa-t3-autonomous"),null,{timeout:60000});
    assert.equal(await toggle.isChecked(),true,"T3 is visibly enabled after full install");
    assert.match(await page.locator("#iwxa-t3-domain-controls").innerText(),/Модель ИИ устанавливается отдельно/);

    await context.setOffline(true);
    await page.goto(base+"/tools/");
    assert.match(await page.locator("main h1").textContent(),/Калькулятор домена/);
    await page.locator("#a").fill("6");
    await page.locator("#b").fill("7");
    await page.locator("#calculate").click();
    assert.equal(await page.locator("#sum").textContent(),"13","domain JavaScript works without network");
    await page.goto(base+"/workspace/");
    assert.match(await page.locator("main h1").textContent(),/Исходный Workspace/);
    assert.equal(await page.locator("#iwxa-t3-domain-switch").isChecked(),true);

    // Reopen an actual persistent browser profile while the network is down.
    await context.close();context=null;
    context=await launch();
    await context.setOffline(true);
    page=context.pages()[0]||await context.newPage();
    await page.goto(base+"/tools/",{waitUntil:"domcontentloaded",timeout:30000});
    assert.match(await page.locator("main h1").textContent(),/Калькулятор домена/);
    await page.locator("#a").fill("20");
    await page.locator("#b").fill("22");
    await page.locator("#calculate").click();
    assert.equal(await page.locator("#sum").textContent(),"42","domain calculator still works after cold offline restart");
    await page.waitForFunction(()=>document.documentElement
      .hasAttribute("data-iwxa-t3-autonomous"),null,{timeout:10000});
    assert.equal(await page.locator("#iwxa-t3-domain-switch").isChecked(),true,
      "opt-in survives a browser restart with no network");

    // Installing an updated same-origin site is a separate choice. Checking
    // while offline cannot silently fetch or change the currently working site.
    const previous=readFileSync(join(root,"tools/index.html"),"utf8");
    write(root,"tools/index.html",previous.replace(
      "<h1>Калькулятор домена</h1>",
      "<h1>Калькулятор домена — обновлён</h1>"));
    const updated=materializeDomainMode(root);
    assert.notEqual(updated.version,built.version,"a new on-disk site changes the release");
    const check=page.getByRole("button",{name:"Проверить обновление T3"});
    updateServer.blockUpdates=true;
    await check.click();
    await page.getByRole("status").filter({hasText:/Проверка обновления недоступна/}).waitFor();
    await page.reload();
    assert.match(await page.locator("main h1").textContent(),/Калькулятор домена/);
    assert.doesNotMatch(await page.locator("main h1").textContent(),/обновлён/,
      "previous offline release is preserved after failed update check");

    await context.setOffline(false);
    updateServer.blockUpdates=false;
    await check.click();
    const installUpdate=page.getByRole("button",{name:"Установить обновление"});
    await installUpdate.waitFor({state:"visible",timeout:15000});
    const upgradedReload=page.waitForEvent("load",{timeout:45000});
    page.once("dialog",dialog=>{
      assert.match(dialog.message(),/обновление автономного T3/i);
      return dialog.accept();
    });
    await installUpdate.click();
    await upgradedReload;
    await page.goto(base+"/tools/");
    assert.match(await page.locator("main h1").textContent(),/обновлён/,
      "new version is active only after explicit upgrade");
    await page.locator("#a").fill("11");
    await page.locator("#b").fill("31");
    await page.locator("#calculate").click();
    assert.equal(await page.locator("#sum").textContent(),"42");
    await context.close();context=null;
    context=await launch();
    await context.setOffline(true);
    page=context.pages()[0]||await context.newPage();
    await page.goto(base+"/tools/",{waitUntil:"domcontentloaded",timeout:30000});
    assert.match(await page.locator("main h1").textContent(),/обновлён/,
      "updated code survives cold restart without network");
    await page.locator("#a").fill("17");
    await page.locator("#b").fill("25");
    await page.locator("#calculate").click();
    assert.equal(await page.locator("#sum").textContent(),"42");

    // Opt-out does not erase user data and remains off after a new process.
    await context.setOffline(false);
    const ordinaryReload=page.waitForEvent("load",{timeout:30000});
    await page.locator("#iwxa-t3-domain-switch").uncheck();
    await ordinaryReload;
    await page.waitForFunction(()=>document.querySelector("#iwxa-t3-domain-switch") &&
      !document.querySelector("#iwxa-t3-domain-switch").checked,null,{timeout:30000});
    assert.match(await page.locator("#iwxa-t3-domain-controls").innerText(),/обычном режиме/);
    await context.close();context=null;
    context=await launch();
    page=context.pages()[0]||await context.newPage();
    await page.goto(base+"/");
    await page.locator("#iwxa-t3-domain-switch").waitFor();
    assert.equal(await page.locator("#iwxa-t3-domain-switch").isChecked(),false,
      "autonomy is never re-enabled by stale cache after opt-out");
  } finally {
    if(context)await context.close().catch(()=>{});
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    rmSync(root,{recursive:true,force:true});
    rmSync(profile,{recursive:true,force:true});
  }
});