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
  write(root,"tools/index.html",page("Калькулятор домена"));
  write(root,"workspace/index.html",page("Исходный Workspace"));
  // No claim that this marker is a qualified Kernel: the workflow separately
  // executes the real 0.3.6 Host and storage witness.
  write(root,"_iwxa/runtime/0.3.6/runtime.js","/* browser switch fixture only */");
  write(root,"_iwxa/domain.json",JSON.stringify({origin:"https://public-domain-fixture.iwxa.invalid"}));
  write(root,"_iwxa/domain-shell.json","{}");
  write(root,"_iwxa/service-catalog.json",JSON.stringify({entries:[]}));
  write(root,".htaccess","Options -MultiViews\nDirectoryIndex index.html\n");
}
function serve(root) {
  return createServer((req,res)=>{
    const url=new URL(req.url??"/","http://127.0.0.1");
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
  const server=serve(root);
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
    const toggle=page.locator("#iwxa-t3-domain-switch");
    await toggle.waitFor();
    assert.equal(await toggle.isChecked(),false,"normal site is initial default");
    assert.equal(await page.evaluate(()=>navigator.serviceWorker.getRegistrations()
      .then(rows=>rows.length)),0,"T3 does not silently register a worker");

    // Rejecting the explicit installation must leave ordinary site unaffected.
    page.once("dialog",dialog=>dialog.dismiss());
    await toggle.check();
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
    await page.waitForFunction(()=>document.documentElement
      .hasAttribute("data-iwxa-t3-autonomous"),null,{timeout:10000});
    assert.equal(await page.locator("#iwxa-t3-domain-switch").isChecked(),true,
      "opt-in survives a browser restart with no network");

    // Opt-out does not erase user data and remains off after a new process.
    await context.setOffline(false);
    await page.locator("#iwxa-t3-domain-switch").uncheck();
    await page.waitForFunction(()=>document.querySelector("#iwxa-t3-domain-switch") &&
      !document.querySelector("#iwxa-t3-domain-switch").checked,null,{timeout:30000});
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