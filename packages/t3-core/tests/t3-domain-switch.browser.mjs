/**
 * Browser acceptance for public T3 autonomous-site installation, with a
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
    '</title><style>:root{--iwxa-assistant-accent:#5e276c;--iwxa-assistant-accent-ink:#fff;--iwxa-assistant-radius:3px}'+
    '.dark{--iwxa-assistant-accent:#d5ade0;--iwxa-assistant-accent-ink:#28132c}</style></head><body><div data-iwxa-update-offer-slot></div><main><h1>'+name+
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

async function profileWitness(page,operation) {
  // Browser storage scope proof, not a substitute for the separate original
  // Kernel/Store receipt and cold restart qualification.
  return page.evaluate(op => new Promise((resolve,reject) => {
    const request=indexedDB.open("iwxa-t3-pwa-profile-witness",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("drafts");
    request.onerror=()=>reject(request.error?.message || "OPEN_FAILED");
    request.onsuccess=()=>{
      const db=request.result;
      const tx=db.transaction("drafts",op==="write"?"readwrite":"readonly");
      const store=tx.objectStore("drafts");
      if(op==="write")store.put("same-origin-persistent-result","selected");
      else {
        const read=store.get("selected");
        read.onsuccess=()=>resolve(read.result ?? null);
        read.onerror=()=>reject(read.error?.message || "READ_FAILED");
      }
      tx.oncomplete=()=>{db.close();if(op==="write")resolve("saved");};
      tx.onerror=()=>reject(tx.error?.message || "TRANSACTION_FAILED");
    };
  }),operation);
}

test("real Chromium: explicit installation, site theme, weekly offer, cold restart and update",{
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
    const cdp=await context.newCDPSession(page);
    const chromeManifest=await cdp.send("Page.getAppManifest");
    assert.equal(chromeManifest.errors?.length,0,
      "Chromium must accept the install metadata without errors");
    assert.equal(JSON.parse(chromeManifest.data).display,"standalone");
    await cdp.detach();
    const openInstall=async p=>{
      const launch=p.locator("#iwxa-t3-install-launcher");
      await launch.waitFor({state:"visible"});
      if(await launch.getAttribute("aria-expanded")==="false")await launch.click();
    };
    const host=page.locator("#iwxa-t3-domain-controls");
    const before=await page.evaluate(()=>({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight,main:document.querySelector("main").getBoundingClientRect().top}));
    assert.equal(await page.locator("#iwxa-t3-install-panel").isVisible(),false);
    assert.equal(await host.evaluate(n=>n.parentElement===document.body&&getComputedStyle(n).position==="fixed"),true);
    await openInstall(page);
    const after=await page.evaluate(()=>({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight,main:document.querySelector("main").getBoundingClientRect().top}));
    assert.deepEqual(after,before,"opening installation never moves domain content");
    assert.equal(await host.evaluate(n=>{const r=n.getBoundingClientRect();return r.width===48&&r.height===48&&Math.abs(innerWidth-r.right-16)<1&&Math.abs(innerHeight-r.bottom-16)<1;}),true);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#iwxa-t3-install-panel").isVisible(),false);
    await openInstall(page);
    const installButton=page.locator("#iwxa-t3-install-app");
    await installButton.waitFor();
    assert.equal(await installButton.isVisible(),true,"PWA installation is offered separately from T3 autonomy");
    // Test in-page Web Install API dispatch, not an OS installation claim.
    await page.evaluate(()=>{
      Object.defineProperty(navigator,"install",{configurable:true,value:()=>{
        window.__iwxaInstallInvocations=(window.__iwxaInstallInvocations||0)+1;
        return Promise.resolve();
      }});
    });
    await installButton.click();
    assert.equal(await page.evaluate(()=>window.__iwxaInstallInvocations),1,
      "native Web Install API is called directly from user activation");
    assert.equal(await installButton.isVisible(),false,
      "successful install confirmation hides the redundant button");
    const toggle=page.locator("#iwxa-t3-install-offline");
    await toggle.waitFor();
    await page.waitForFunction(()=>!document.querySelector("#iwxa-t3-install-offline").disabled);
    assert.equal(await page.evaluate(()=>document.documentElement.hasAttribute("data-iwxa-t3-autonomous")),false,"normal site is initial default");
    // The same ordinary button must follow the site's live theme.
    const design = () => toggle.evaluate(node=>{
      const style=getComputedStyle(node);
      return [style.backgroundColor,style.color,style.borderRadius];
    });
    assert.deepEqual(await design(),["rgb(94, 39, 108)","rgb(255, 255, 255)","3px"]);
    await page.evaluate(()=>document.documentElement.classList.add("dark"));
    assert.deepEqual(await design(),["rgb(213, 173, 224)","rgb(40, 19, 44)","3px"]);
    await page.evaluate(()=>document.documentElement.classList.remove("dark"));
    assert.equal(await page.evaluate(()=>navigator.serviceWorker.getRegistrations()
      .then(rows=>rows.length)),0,"T3 does not silently register a worker");
    let companion=await context.newPage();
    await companion.goto(base+"/tools/");
    await openInstall(companion);
    await companion.locator("#iwxa-t3-install-offline").waitFor();
    assert.equal(await companion.evaluate(()=>document.documentElement.hasAttribute("data-iwxa-t3-autonomous")),false);
    assert.equal(await profileWitness(page,"write"),"saved");
    assert.equal(await profileWitness(companion,"read"),"same-origin-persistent-result",
      "site and separate same-profile window share the original browser storage");
    assert.equal(await page.locator("#iwxa-t3-domain-controls input[type=checkbox]").count(),0);
    assert.equal(await page.locator("#iwxa-t3-update-offer").isVisible(),false);

    // Rejecting the explicit installation must leave ordinary site unaffected.
    // Cancel the real installation action and verify the ordinary site.
    page.once("dialog",dialog=>dialog.dismiss());
    await toggle.click();
    await page.waitForFunction(()=>!document.querySelector("#iwxa-t3-install-offline").disabled);
    assert.equal(await page.evaluate(()=>document.documentElement.hasAttribute("data-iwxa-t3-autonomous")),false,"user can decline the entire site snapshot");

    page.once("dialog",dialog=>{
      assert.match(dialog.message(),/офлайн|автономн/i);
      return dialog.accept();
    });
    await toggle.click();
    await page.waitForFunction(()=>document.documentElement
      .hasAttribute("data-iwxa-t3-autonomous"),null,{timeout:60000});
    assert.equal(await toggle.isVisible(),false,"complete snapshot does not need another installation");
    await openInstall(page);
    assert.match(await page.locator("#iwxa-t3-domain-controls").innerText(),/Модель помощника устанавливается отдельно/);
    assert.equal(await page.locator("#iwxa-t3-update-offer").isVisible(),false,"fresh install is not asked to update");
    await page.evaluate(()=>localStorage.setItem("iwxa.t3.offline.last-update-offer.v2",String(Date.now()-7*86400000)));
    await page.reload();
    await page.locator("#iwxa-t3-weekly-offer").waitFor({state:"visible"});
    assert.equal(await page.locator("#iwxa-t3-weekly-offer").evaluate(n=>n.parentElement.id==="iwxa-t3-domain-controls"&&getComputedStyle(n).position==="absolute"),true);
    await page.locator("#iwxa-t3-weekly-later").click();
    await page.reload();
    await page.waitForFunction(()=>document.documentElement.hasAttribute("data-iwxa-t3-autonomous"));
    assert.equal(await page.locator("#iwxa-t3-weekly-offer").isVisible(),false,"weekly offer is not repeated");

    await openInstall(companion);
    await companion.getByRole("button",{name:"Применить изменения в этом окне"})
      .waitFor({state:"visible",timeout:15000});
    await companion.locator("#a").fill("19");
    assert.equal(await companion.locator("#a").inputValue(),"19",
      "a concurrent unfinished form is not reloaded by the other window");
    const companionReload=companion.waitForEvent("load",{timeout:30000});
    await companion.getByRole("button",{name:"Применить изменения в этом окне"}).click();
    await companionReload;
    await companion.waitForFunction(()=>document.documentElement
      .hasAttribute("data-iwxa-t3-autonomous"),null,{timeout:10000});
    assert.equal(await profileWitness(companion,"read"),"same-origin-persistent-result");

    await context.setOffline(true);
    await page.goto(base+"/tools/");
    assert.match(await page.locator("main h1").textContent(),/Калькулятор домена/);
    await page.locator("#a").fill("6");
    await page.locator("#b").fill("7");
    await page.locator("#calculate").click();
    assert.equal(await page.locator("#sum").textContent(),"13","domain JavaScript works without network");
    await page.goto(base+"/workspace/");
    assert.match(await page.locator("main h1").textContent(),/Исходный Workspace/);
    await page.waitForFunction(()=>document.documentElement.hasAttribute("data-iwxa-t3-autonomous"));
    assert.equal(await page.evaluate(()=>document.documentElement.hasAttribute("data-iwxa-t3-autonomous")),true);

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
    assert.equal(await page.evaluate(()=>document.documentElement.hasAttribute("data-iwxa-t3-autonomous")),true,
      "opt-in survives a browser restart with no network");
    companion=await context.newPage();
    await companion.goto(base+"/tools/",{waitUntil:"domcontentloaded",timeout:30000});
    await companion.locator("#a").fill("123");
    assert.equal(await profileWitness(companion,"read"),"same-origin-persistent-result",
      "same-profile IndexedDB survives a cold offline browser restart");

    // Installing an updated same-origin site is a separate choice. Checking
    // while offline cannot silently fetch or change the currently working site.
    const previous=readFileSync(join(root,"tools/index.html"),"utf8");
    write(root,"tools/index.html",previous.replace(
      "<h1>Калькулятор домена</h1>",
      "<h1>Калькулятор домена — обновлён</h1>"));
    const updated=materializeDomainMode(root);
    assert.notEqual(updated.version,built.version,"a new on-disk site changes the release");
    await openInstall(page);
    const check=page.getByRole("button",{name:"Проверить обновление",exact:true});
    updateServer.blockUpdates=true;
    await check.click();
    await page.getByRole("status").filter({hasText:/Проверка обновления недоступна/}).waitFor();
    await page.reload();
    assert.match(await page.locator("main h1").textContent(),/Калькулятор домена/);
    assert.doesNotMatch(await page.locator("main h1").textContent(),/обновлён/,
      "previous offline release is preserved after failed update check");

    await context.setOffline(false);
    updateServer.blockUpdates=false;
    await openInstall(page);
    await check.click();
    const installUpdate=page.getByRole("button",{name:"Установить обновление"});
    await installUpdate.waitFor({state:"visible",timeout:15000});
    const upgradedReload=page.waitForEvent("load",{timeout:45000});
    page.once("dialog",dialog=>{
      assert.match(dialog.message(),/обновление автономной версии/i);
      return dialog.accept();
    });
    await installUpdate.click();
    await upgradedReload;
    await openInstall(companion);
    await companion.getByRole("button",{name:"Применить изменения в этом окне"})
      .waitFor({state:"visible",timeout:15000});
    assert.equal(await companion.locator("#a").inputValue(),"123",
      "a new release never silently discards an unfinished form");
    const appliedReload=companion.waitForEvent("load",{timeout:30000});
    await companion.getByRole("button",{name:"Применить изменения в этом окне"}).click();
    await appliedReload;
    assert.match(await companion.locator("main h1").textContent(),/обновлён/,
      "other window opts into the same successfully installed release");
    assert.equal(await profileWitness(companion,"read"),"same-origin-persistent-result");
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
    assert.equal(await profileWitness(page,"read"),"same-origin-persistent-result",
      "user data remains readable after two cold offline restarts and a release update");

    // The unchanged worker disable protocol is covered by the offline worker tests.
    assert.equal(await page.locator("#iwxa-t3-domain-controls input[type=checkbox]").count(),0);
    assert.equal(await page.locator("#iwxa-t3-install-offline").isVisible(),false);
  } finally {
    if(context)await context.close().catch(()=>{});
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    rmSync(root,{recursive:true,force:true});
    rmSync(profile,{recursive:true,force:true});
  }
});

// Direct regression for the reported layout defect: the actual original
// assistant source and the actual materialized install controller together.
// No model, mocked assistant, production site or physical phone claim.
if(process.env.T3_ORIGINAL_ASSISTANT_DIR) test("original assistant and autonomous controls stay fixed without changing page geometry",{
  timeout:90000
},async()=>{
  const root=mkdtempSync(join(tmpdir(),"t3-corner-layout-"));
  const stage=mkdtempSync(join(tmpdir(),"t3-corner-assistant-"));
  const server=serve(root);
  let browser;
  try {
    fixture(root);
    const markup='<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Layout</title><style>'+
      ':root{--iwxa-assistant-font:system-ui;--iwxa-assistant-ink:#172f42;--iwxa-assistant-accent:#5e276c;--iwxa-assistant-accent-ink:#fff;--iwxa-assistant-surface:#fff}'+
      ':root.dark{--iwxa-assistant-ink:#f0f2f9;--iwxa-assistant-accent:#d5ade0;--iwxa-assistant-accent-ink:#28132c;--iwxa-assistant-surface:#171a29;background:#111524;color:#f0f2f9}'+
      'body{margin:0;font:16px system-ui}header,footer{padding:24px}main{min-height:1600px;padding:16px;box-sizing:border-box}section{margin:24px auto}'+
      '[data-iwxa-assistant-page-slot]:empty,[data-iwxa-assistant-context-slot]:empty,[data-iwxa-assistant-model-slot]:empty,[data-iwxa-t3-controls]:empty,[data-iwxa-update-offer-slot]:empty{display:none}</style></head>'+
      '<body><header id="header">Menu</header><div data-iwxa-domain-assistant data-assistant-dynamic-dom data-assistant-inline-slots data-assistant-inline-open data-assistant-label="Помощник"></div>'+
      '<main id="main"><div data-iwxa-assistant-page-slot></div><h1>Original domain page</h1><form data-test-order><label>Количество<input name="quantity" type="number" value="7"></label><button type="button" data-iwxa-assistant-form-open="data-test-order">Помочь заполнить</button><div data-iwxa-assistant-context-slot></div></form></main>'+
      '<footer id="footer">Original footer</footer><div data-iwxa-t3-controls></div><div data-iwxa-assistant-model-slot></div><div data-iwxa-update-offer-slot></div></body></html>';
    write(root,"index.html",markup);
    write(root,"tools/index.html",markup.replace("Original domain page","Original tool page"));
    for(const name of ["main.mjs","field-policy.mjs","skill-runtime.mjs","device-policy.mjs"])
      write(stage,"domain-assistant/"+name,readFileSync(join(process.env.T3_ORIGINAL_ASSISTANT_DIR,name)));
    write(stage,"assistant.js",'import "./domain-assistant/main.mjs";');
    write(stage,"src/catalog.mjs",readFileSync(new URL("../integration-sources/bli1/catalog.mjs",import.meta.url)));
    materializeDomainMode(root,stage);
    const base=await listening(server);
    browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
    for(const size of [{width:1440,height:900},{width:375,height:812},{width:320,height:568}]){
      const context=await browser.newContext({viewport:size});
      try{
        await context.addInitScript(()=>{Object.defineProperty(navigator,"gpu",{configurable:true,value:undefined});});
        let external=0,workers=0;
        await context.route("**/*",route=>{
          if(new URL(route.request().url()).origin===base)return route.continue();
          external++;return route.abort();
        });
        const page=await context.newPage();
        page.on("worker",()=>workers++);
        const errors=[];page.on("pageerror",error=>errors.push(error.message));
        await page.goto(base+"/");
        const host=page.locator("#iwxa-t3-assistant"),launch=host.locator("#launcher"),drawer=host.locator("#drawer"),
          install=page.locator("#iwxa-t3-install-launcher"),panel=page.locator("#iwxa-t3-install-panel");
        await launch.waitFor({state:"visible"});await install.waitFor({state:"visible"});
        const geometry=()=>page.evaluate(()=>{
          const assistant=document.getElementById("iwxa-t3-assistant"),offline=document.getElementById("iwxa-t3-domain-controls");
          const rect=n=>{const r=n.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom,r.width,r.height]};
          const root=document.documentElement,scrollY=window.scrollY;
          return {a:rect(assistant),b:rect(offline),w:root.scrollWidth,h:root.scrollHeight,y:scrollY,
            main:document.querySelector("main").getBoundingClientRect().top+scrollY,
            footer:document.querySelector("footer").getBoundingClientRect().top+scrollY,
            direct:assistant.parentElement===document.body&&offline.parentElement===document.body,
            fixed:getComputedStyle(assistant).position==="fixed"&&getComputedStyle(offline).position==="fixed"};
        });
        const baseline=await geometry();
        assert.ok(baseline.direct&&baseline.fixed,"one fixed pair directly in body");
        assert.equal(baseline.w,size.width,"no horizontal page overflow");
        assert.deepEqual(baseline.a.slice(4),[48,48]);assert.deepEqual(baseline.b.slice(4),[48,48]);
        assert.equal(baseline.a[2],baseline.b[2]);assert.equal(size.width-baseline.b[2],16);
        assert.equal(size.height-baseline.b[3],16);assert.equal(baseline.b[1]-baseline.a[3],8);
        assert.equal(await drawer.isVisible(),false);assert.equal(await panel.isVisible(),false);
        assert.equal(await page.locator("[data-iwxa-assistant-page-slot],[data-iwxa-assistant-context-slot],[data-iwxa-assistant-model-slot],[data-iwxa-t3-controls],[data-iwxa-update-offer-slot]").evaluateAll(nodes=>nodes.every(n=>!n.children.length)),true);
        await page.evaluate(()=>scrollTo(0,450));await page.waitForFunction(()=>scrollY===450);
        const scrolled=await geometry();
        assert.deepEqual(scrolled.a,baseline.a);assert.deepEqual(scrolled.b,baseline.b);
        const bounded=async locator=>locator.evaluate(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&n.scrollWidth<=n.clientWidth+1});
        await launch.click();assert.equal(await drawer.isVisible(),true);
        assert.equal(await panel.isVisible(),false);assert.ok(await bounded(drawer));
        assert.deepEqual(await geometry(),scrolled,"assistant opening does not reflow document");
        assert.equal(await host.locator("#model-settings").evaluate(n=>n.parentElement.id==="drawer"&&!n.open),true);
        assert.equal(await host.locator("#prompt").evaluate(n=>n.getRootNode().activeElement===n),true);
        await install.click();assert.equal(await drawer.isVisible(),false);assert.equal(await panel.isVisible(),true);
        assert.ok(await bounded(panel));assert.deepEqual(await geometry(),scrolled,"installation opening does not reflow document");
        await launch.click();assert.equal(await panel.isVisible(),false);assert.equal(await drawer.isVisible(),true);
        await page.keyboard.press("Escape");assert.equal(await drawer.isVisible(),false);
        await install.click();await page.keyboard.press("Escape");assert.equal(await panel.isVisible(),false);
        assert.deepEqual(await geometry(),scrolled,"both close without reflow");
        await page.evaluate(()=>document.documentElement.classList.add("dark"));
        assert.equal(await launch.evaluate(n=>getComputedStyle(n).backgroundColor),"rgb(213, 173, 224)");
        await install.click();
        await page.waitForFunction(()=>!document.querySelector("#iwxa-t3-install-offline").disabled);
        assert.equal(await page.locator("#iwxa-t3-install-offline").evaluate(n=>getComputedStyle(n).backgroundColor),"rgb(213, 173, 224)");
        await page.keyboard.press("Escape");
        await page.emulateMedia({media:"print"});assert.equal(await launch.isVisible(),false);assert.equal(await install.isVisible(),false);
        await page.emulateMedia({media:"screen"});assert.equal(await launch.isVisible(),true);
        await page.evaluate(()=>{history.pushState(null,"","/tools/");document.querySelector("h1").textContent="Updated native route";document.querySelector("[data-iwxa-domain-assistant]").setAttribute("data-assistant-context-key","tool");});
        assert.equal(await host.count(),1);assert.equal(await page.locator("#iwxa-t3-domain-controls").count(),1);
        assert.deepEqual((await geometry()).a,baseline.a);assert.deepEqual((await geometry()).b,baseline.b);
        await page.goto(base+"/tools/");
        await launch.waitFor({state:"visible"});await install.waitFor({state:"visible"});
        assert.equal(await drawer.isVisible(),false);assert.equal(await panel.isVisible(),false);
        assert.equal(await page.locator('[name="quantity"]').inputValue(),"7");
        assert.equal(await page.evaluate(()=>navigator.serviceWorker.getRegistrations().then(x=>x.length)),0);
        assert.equal(external,0);assert.equal(workers,0);assert.equal(errors.length,0);
        console.log("T3_CORNER_LAYOUT_PASS "+size.width+"x"+size.height);
      }finally{await context.close();}
    }
  }finally{
    if(browser)await browser.close();
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    rmSync(root,{recursive:true,force:true});rmSync(stage,{recursive:true,force:true});
  }
});
