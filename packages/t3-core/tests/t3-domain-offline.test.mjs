import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, dirname} from "node:path";
import {createHash, webcrypto} from "node:crypto";
import vm from "node:vm";
import {materializeDomainMode} from "../scripts/materialize-t3-domain-mode.mjs";
import {MODELS,modelInstallSources} from "../integration-sources/bli1/catalog.mjs";

const ORIGIN = "https://club.iwxa.ru";
const sha = value => createHash("sha256").update(value).digest("hex");
const write = (root,path,value) => {
  const file=join(root,path);mkdirSync(dirname(file),{recursive:true});
  writeFileSync(file,value);
};
function specimen() {
  const root=mkdtempSync(join(tmpdir(),"iwxa-t3-domain-"));
  write(root,"index.html",'<html><body><main>Club page</main></body></html>');
  write(root,"profile/index.html",'<html><body><main>Profile page</main></body></html>');
  write(root,"workspace/index.html",'<html><body><main>Original Workspace</main></body></html>');
  write(root,"_iwxa/domain.json",JSON.stringify({origin:ORIGIN,security:{allowed_object_classes:[]}}));
  write(root,"_iwxa/domain-shell.json","{}");
  write(root,"_iwxa/service-catalog.json","{\"entries\":[]}");
  write(root,"_iwxa/runtime/0.3.6/runtime.js","/* original Kernel */");
  write(root,".htaccess","Options -Indexes\n");
  write(root,"workspace/assets/shell.js","export const kernel = true;");
  write(root,"assets/site.css","body{font:16px system-ui}");
  return root;
}
function cleanup(root){rmSync(root,{recursive:true,force:true});}
test("T3 domain switch covers ALL public routes and the original Workspace in one dist",()=>{
  const root=specimen();
  try{
    const result=materializeDomainMode(root);
    const data=JSON.parse(readFileSync(join(root,"t3-offline-manifest.json"),"utf8"));
    assert.equal(data.schema,"iwxa.t3.domain-offline/1");
    assert.equal(data.complete_static_tree,true);
    assert.equal(result.local_model_installation_separate,true);
    assert.equal(result.original_kernel_unchanged,true);
    assert.ok(result.site_pages>=3);
    assert.equal(data.domain_origin,ORIGIN);
    assert.equal(data.files.some(x=>x.path==="/.htaccess"),false,
      "Apache config is shipped but is not a retrievable browser resource");
    assert.equal(data.pages.some(x=>x.path==="/profile/"),true);
    assert.equal(data.pages.some(x=>x.path==="/workspace/"),true);
    const paths=new Set(data.files.map(x=>x.path));
    for(const path of ["/","/index.html","/profile/","/profile/index.html",
      "/workspace/","/workspace/index.html","/workspace/assets/shell.js",
      "/_iwxa/runtime/0.3.6/runtime.js","/t3-domain-mode.mjs","/t3-sw.js"]){
      assert.equal(paths.has(path),true,"offline file: "+path);
    }
    for(const file of data.files){
      const real=file.source || file.path;
      const bytes=readFileSync(join(root,real.slice(1)));
      assert.equal(file.sha256,sha(bytes));
      assert.equal(file.bytes,bytes.length);
    }
    assert.match(readFileSync(join(root,"index.html"),"utf8"),/data-iwxa-t3-domain-mode/);
    assert.match(readFileSync(join(root,"profile/index.html"),"utf8"),/data-iwxa-t3-domain-mode/);
    assert.match(readFileSync(join(root,"workspace/index.html"),"utf8"),/data-iwxa-t3-domain-mode/);
    const worker=readFileSync(join(root,"t3-sw.js"),"utf8");
    const records=worker.match(/const PINNED_MODEL_INSTALL_SOURCES = Object\.freeze\((\[.*\])\);/);
    assert.ok(records,"generated worker contains exact catalog");
    assert.deepEqual(JSON.parse(records[1]),modelInstallSources());
    assert.ok(!worker.includes("/* IWXA_MODEL_INSTALL_SOURCES */"));
    const again=materializeDomainMode(root);
    assert.equal(again.version,result.version,"idempotent final domain bundle");
    assert.equal((readFileSync(join(root,"index.html"),"utf8").match(/data-iwxa-t3-domain-mode/g)||[]).length,1);
  }finally{cleanup(root);}
});
test("Site-wide assistant is bundled INTO the same dist only when explicitly provided",()=>{
  const root=specimen(),assistant=mkdtempSync(join(tmpdir(),"iwxa-t3-bli-"));
  try{
    write(assistant,"assistant.js","export const assistant=true;");
    write(assistant,"assets/model-worker.js","export const worker=true;");
    const result=materializeDomainMode(root,assistant);
    assert.equal(result.assistant_installed_in_single_dist,true);
    assert.equal(readFileSync(join(root,"_iwxa/t3-assistant/assistant.js"),"utf8"),
      "export const assistant=true;");
    for(const html of ["index.html","profile/index.html","workspace/index.html"]){
      assert.match(readFileSync(join(root,html),"utf8"),/data-iwxa-t3-assistant/);
    }
    const manifest=JSON.parse(readFileSync(join(root,"t3-offline-manifest.json"),"utf8"));
    assert.equal(manifest.files.some(x=>x.path==="/_iwxa/t3-assistant/assets/model-worker.js"),true);
  }finally{cleanup(root);cleanup(assistant);}
});
test("No T3 mode on incomplete Host or sites requiring external runtime resources",()=>{
  const root=specimen();
  try{
    rmSync(join(root,"_iwxa/runtime"),{recursive:true,force:true});
    assert.throws(()=>materializeDomainMode(root),/ORIGINAL_KERNEL_RUNTIME_MISSING/);
    write(root,"_iwxa/runtime/0.3.6/runtime.js","/* original */");
    write(root,"profile/index.html",'<html><body><script src="https://cloud.example/model.js"></script></body></html>');
    assert.throws(()=>materializeDomainMode(root),/CROSS_ORIGIN_ASSET/);
    assert.doesNotMatch(readFileSync(join(root,"index.html"),"utf8"),/data-iwxa-t3-domain-mode/);
  }finally{cleanup(root);}
});

function fakeBrowser(root,store=null,clock=Date,origin=ORIGIN) {
  const entries=new Map();
  const handlers={};
  const caches=store||new Map();
  let liveFetches=0;
  let networkDown=false;
  let ownerAlive=true;
  const toKey=value=>new URL(typeof value==="string"?value:value.url,origin).href;
  const cacheAPI={
    async open(name){
      if(!caches.has(name))caches.set(name,new Map());
      const records=caches.get(name);
      return {
        async put(key,response){records.set(toKey(key),response.clone());},
        async match(key){return records.get(toKey(key))?.clone();},
        async delete(key){return records.delete(toKey(key));},
        async keys(){return [...records.keys()].map(url=>new Request(url));}
      };
    },
    async keys(){return [...caches.keys()];},
    async delete(name){return caches.delete(name);}
  };
  const fetch=async request=>{
    liveFetches++;
    if(networkDown) throw Error("SIMULATED_NETWORK_UNAVAILABLE");
    const path=new URL(toKey(request)).pathname;
    if(path==="/t3-offline-manifest.json"){
      return new Response(readFileSync(join(root,path.slice(1))),{status:200});
    }
    const original=join(root,path.slice(1));
    try{return new Response(readFileSync(original),{status:200});}
    catch{return new Response("not found",{status:404});}
  };
  const self={
    location:{origin,protocol:new URL(origin).protocol},
    clients:{claim:async()=>{},get:async id=>id==="model-owner" && ownerAlive
      ? {id,type:"window",url:origin+"/workspace/"} : undefined},
    skipWaiting:async()=>{},
    addEventListener(kind,fn){handlers[kind]=fn;}
  };
  const script=readFileSync(join(root,"t3-sw.js"),"utf8");
  vm.runInNewContext(script,{self,caches:cacheAPI,fetch,crypto:webcrypto,Response,Request,URL,
    Uint8Array,Set,Array,Number,String,Map,Error,Promise,Date:clock,console}, {filename:"t3-sw.js"});
  const dispatch=async (type,port={postMessage(){}},extra={},source=null)=>{
    const waits=[];
    handlers.message({data:{type,...extra},source,ports:[port],
      waitUntil:p=>waits.push(p)});
    await Promise.all(waits);
  };
  const fetchPage=async(url,method="GET",options={})=>{
    let result;
    handlers.fetch({request:new Request(url,{method,...options}),
      respondWith:p=>{result=p;}});
    return result;
  };
  return {dispatch,fetchPage,caches,
    setNetworkDown(value){networkDown=!!value;},
    setOwnerAlive(value){ownerAlive=!!value;},
    get liveFetches(){return liveFetches;}};
}
const artifactBase=model=>model.modelSource.endsWith("/")?model.modelSource:model.modelSource+"/resolve/main/";
for(const model of MODELS.filter(m=>!m.retiredForProfile)) test("D5 consent, restart, denial and expiry for "+model.id,async()=>{
  const root=specimen();
  try {
    materializeDomainMode(root);
    const browser=fakeBrowser(root);
    const install=[];
    await browser.dispatch("T3_INSTALL",{postMessage:value=>install.push(value)});
    assert.equal(install.at(-1)?.type,"READY");
    const source={type:"window",id:"model-owner",
      url:ORIGIN+"/workspace/"};
    const pinned={model_url:model.modelSource,wasm_url:model.modelLib};
    const other=MODELS.find(x=>x.id!==model.id);
    const mixed=[];
    await browser.dispatch("T3_MODEL_INSTALL_BEGIN",{postMessage:v=>mixed.push(v)},
      {...pinned,wasm_url:other.modelLib},source);
    assert.equal(mixed.at(-1)?.type,"FAILED","another model library cannot be substituted");
    const base=artifactBase(model);
    const weights=base+"params_shard_0.bin";
    const blocked="https://example.org/telemetry";
    const before=browser.liveFetches;
    assert.equal((await browser.fetchPage(weights)).status,503);
    assert.equal(browser.liveFetches,before);
    const rejected=[];
    await browser.dispatch("T3_MODEL_INSTALL_BEGIN",
      {postMessage:value=>rejected.push(value)},
      {...pinned,wasm_url:"https://example.org/any.wasm"},source);
    assert.equal(rejected.at(-1)?.type,"FAILED");
    assert.equal((await browser.fetchPage(blocked)).status,503);
    const permitted=[];
    await browser.dispatch("T3_MODEL_INSTALL_BEGIN",
      {postMessage:value=>permitted.push(value)},pinned,source);
    assert.equal(permitted.at(-1)?.type,"MODEL_INSTALL_ALLOWED");
    const token=permitted.at(-1).token;
    assert.equal(typeof token,"string");
    const count=browser.liveFetches;
    assert.equal((await browser.fetchPage(artifactBase(other)+"params_shard_0.bin")).status,503);
    assert.equal((await browser.fetchPage(other.modelLib)).status,503);
    if(model.modelRevision){
      assert.equal((await browser.fetchPage(model.upstreamModelSource+"/resolve/main/params_shard_0.bin")).status,503,
        "a pinned release cannot fetch mutable main weights");
      assert.equal((await browser.fetchPage(model.upstreamModelLib)).status,503,
        "a pinned release cannot fetch mutable main WASM");
      assert.equal((await browser.fetchPage(base.replace(model.modelRevision,"0".repeat(40))+"params_shard_0.bin")).status,503,
        "a different model revision is not consented");
    }
    assert.equal((await browser.fetchPage(blocked)).status,503);
    assert.equal((await browser.fetchPage(base+"../private")).status,503);
    assert.equal((await browser.fetchPage(base+"user-workspace-secret")).status,503,
      "a model URL must not carry arbitrary private Workspace data");
    assert.equal((await browser.fetchPage(base+"params_shard_fake.bin")).status,503);
    assert.equal((await browser.fetchPage(base+"vocab.dat")).status,503);
    assert.equal((await browser.fetchPage(base+"tokenizer_private.json")).status,503);
    assert.equal((await browser.fetchPage(weights+"?token=private")).status,503);
    assert.equal((await browser.fetchPage(weights,"POST")).status,503);
    assert.equal(browser.liveFetches,count);
    for (const asset of [
      weights,
      base+"mlc-chat-config.json",
      base+"tokenizer.json",
      base+"tokenizer_config.json",
      base+"vocab.json",
      base+"merges.txt",
      base+"tensor-cache.json",
      pinned.wasm_url,
    ]) {
      assert.equal((await browser.fetchPage(asset)).status,404,
        "only pinned upstream model artifacts can reach the network: "+asset);
    }
    assert.equal(browser.liveFetches,count+8);
    // SW termination during a multi-shard WebLLM download must not lose
    // the explicit consent. It is stored only in the existing mode cache,
    // bounded to a live original window, exact files and a 15-minute lease.
    const resumed=fakeBrowser(root,browser.caches);
    assert.equal((await resumed.fetchPage(weights)).status,404,
      "a restarted SW may continue the consented model download");
    const wrong=[];
    await resumed.dispatch("T3_MODEL_INSTALL_END",
      {postMessage:value=>wrong.push(value)},{token},"other");
    assert.equal(wrong.at(-1)?.type,"FAILED");
    const ended=[];
    await resumed.dispatch("T3_MODEL_INSTALL_END",
      {postMessage:value=>ended.push(value)},{token},source);
    assert.equal(ended.at(-1)?.type,"MODEL_INSTALL_ENDED");
    assert.equal((await browser.fetchPage(weights)).status,503);
    assert.equal((await resumed.fetchPage(weights)).status,503);

    // Closing the consenting window revokes the lease even after a restart.
    const second=[];
    await resumed.dispatch("T3_MODEL_INSTALL_BEGIN",
      {postMessage:value=>second.push(value)},pinned,source);
    assert.equal(second.at(-1)?.type,"MODEL_INSTALL_ALLOWED");
    resumed.setOwnerAlive(false);
    assert.equal((await resumed.fetchPage(weights)).status,503,
      "a closed owner cannot leave remote model access enabled");
    resumed.setOwnerAlive(true);
    const afterRestart=fakeBrowser(root,resumed.caches);
    assert.equal((await afterRestart.fetchPage(weights)).status,503,
      "a revoked installation does not silently reactivate after cold restart");

    // The cached consent must also expire without relying on a timer running
    // inside a Service Worker (which browsers may terminate at any moment).
    const fresh=[];
    await afterRestart.dispatch("T3_MODEL_INSTALL_BEGIN",
      {postMessage:value=>fresh.push(value)},pinned,source);
    assert.equal(fresh.at(-1)?.type,"MODEL_INSTALL_ALLOWED");
    class AfterExpiry extends Date {
      static now(){return Date.now()+61*60*1000;}
    }
    const expired=fakeBrowser(root,afterRestart.caches,AfterExpiry);
    assert.equal((await expired.fetchPage(weights)).status,503,
      "model downloads cannot continue after the one-hour consent expires");
    const noRevival=fakeBrowser(root,expired.caches);
    assert.equal((await noRevival.fetchPage(weights)).status,503,
      "expired authority stays revoked after a new Service Worker starts");
  }finally {cleanup(root);}
});

test("T3 offline worker installs verified snapshot, blocks remote egress, and survives cold restart",async()=>{
  const root=specimen();
  try{
    materializeDomainMode(root);
    const first=fakeBrowser(root),messages=[];
    await first.dispatch("T3_INSTALL",{postMessage:m=>messages.push(m)});
    assert.equal(messages.at(-1)?.type,"READY");
    assert.ok(messages.some(x=>x.type==="PROGRESS"));
    const pages=[];
    await first.dispatch("T3_PAGES",{postMessage:m=>pages.push(m)});
    assert.equal(pages[0]?.type,"PAGES");
    assert.equal(pages[0]?.pages?.some(x=>x.path==="/profile/"),true);
    const count=first.liveFetches;
    const result=await first.fetchPage(ORIGIN+"/profile/?a=1");
    assert.equal(result.status,200);
    assert.match(await result.text(),/Profile page/);
    assert.equal(first.liveFetches,count);
    assert.equal((await first.fetchPage("https://cloud.example/private")).status,503);
    assert.equal((await first.fetchPage(ORIGIN+"/not-installed")).status,503);
    assert.equal((await first.fetchPage(ORIGIN+"/profile/", "POST")).status,503);
    // A lost cache entry must never be reported as a complete T3 snapshot.
    const stored=[...first.caches.values()].find(cache=>cache.size>4);
    assert.ok(stored);
    const lostKey=[...stored.keys()].find(key=>key.endsWith("/profile/index.html"));
    const saved=stored.get(lostKey);
    stored.delete(lostKey);
    const damaged=fakeBrowser(root,first.caches);
    const statusEvents=[];
    await damaged.dispatch("T3_STATUS",{postMessage:m=>statusEvents.push(m)});
    assert.equal(statusEvents[0].active,true);
    assert.equal(statusEvents[0].complete,false);
    assert.equal((await damaged.fetchPage(ORIGIN+"/profile/index.html")).status,503);
    stored.set(lostKey,saved);
    const afterRestart=fakeBrowser(root,first.caches);
    assert.equal((await afterRestart.fetchPage(ORIGIN+"/workspace/")).status,200);
    assert.equal(afterRestart.liveFetches,0,"offline restart used only verified CacheStorage");
    const acknowledgements=[];
    await afterRestart.dispatch("T3_DISABLE",{postMessage:m=>acknowledgements.push(m)});
    assert.equal(acknowledgements.at(-1)?.type,"DISABLED");
    assert.equal((await afterRestart.fetchPage(ORIGIN+"/workspace/index.html")).status,200);
    assert.equal(afterRestart.liveFetches,1,"normal network restored only after opt-out");
    const afterOptOutRestart=fakeBrowser(root,first.caches);
    const statusAfterRestart=[];
    await afterOptOutRestart.dispatch("T3_STATUS",{postMessage:m=>statusAfterRestart.push(m)});
    assert.equal(statusAfterRestart[0]?.active,false,
      "old cached snapshots never reactivate T3 after user turns it off");
    // Our mock fetch does not emulate Apache DirectoryIndex; request the
    // real file when testing the ordinary, non-SW network route.
    assert.equal((await afterOptOutRestart.fetchPage(ORIGIN+"/workspace/index.html")).status,200);
    assert.equal(afterOptOutRestart.liveFetches,1);
    const afterReinstall=fakeBrowser(root,first.caches), reinstall=[];
    await afterReinstall.dispatch("T3_INSTALL",{postMessage:m=>reinstall.push(m)});
    assert.equal(reinstall.at(-1)?.type,"READY","only explicit reinstall reactivates T3");
    const enabledAgain=fakeBrowser(root,first.caches);
    assert.equal((await enabledAgain.fetchPage(ORIGIN+"/workspace/")).status,200);
    assert.equal(enabledAgain.liveFetches,0);
  }finally{cleanup(root);}
});

test("Explicit T3 update is atomic: confirmed version, failed download, offline restart",async()=>{
  const root=specimen();
  try {
    const oldRelease=materializeDomainMode(root);
    const first=fakeBrowser(root), installed=[];
    await first.dispatch("T3_INSTALL",{postMessage:value=>installed.push(value)},
      {expectedVersion:oldRelease.version});
    assert.equal(installed.at(-1)?.type,"READY");
    assert.match(await (await first.fetchPage(ORIGIN+"/profile/index.html")).text(),/Profile page/);

    // Owner publishes a newer complete snapshot while the installed one is live.
    // SHA names have NO chronological ordering. Force the newer release to
    // have the lower hash, which previously made a cold SW restart roll back.
    let updatedRelease;
    for(let variant=0;variant<64;variant++){
      write(root,"profile/index.html",
        '<html><body><main>Updated Profile page '+variant+'</main></body></html>');
      updatedRelease=materializeDomainMode(root);
      if(updatedRelease.version<oldRelease.version)break;
    }
    assert.ok(updatedRelease.version<oldRelease.version,
      "newer release intentionally has a lexicographically lower SHA");
    const check=[];
    await first.dispatch("T3_CHECK_UPDATE",{postMessage:value=>check.push(value)});
    assert.deepEqual([check.at(-1)?.type,check.at(-1)?.available],
      ["UPDATE_STATUS",true]);
    assert.equal(check.at(-1)?.version,updatedRelease.version);
    assert.equal(check.at(-1)?.currentVersion,oldRelease.version);
    assert.match(await (await first.fetchPage(ORIGIN+"/profile/index.html")).text(),
      /Profile page/,"old complete version remains visible before consent");

    // A version that changed after the user's confirmation is rejected.
    const mismatch=[];
    await first.dispatch("T3_INSTALL",{postMessage:value=>mismatch.push(value)},
      {expectedVersion:"0".repeat(64)});
    assert.equal(mismatch.at(-1)?.type,"FAILED");
    assert.match(mismatch.at(-1)?.message,/VERSION_CHANGED_RECONFIRM/);
    assert.match(await (await first.fetchPage(ORIGIN+"/profile/index.html")).text(),
      /Profile page/);

    // Simulate one corrupt file during the updated download.
    write(root,"assets/site.css","body{corrupt:true}");
    const broken=[];
    await first.dispatch("T3_INSTALL",{postMessage:value=>broken.push(value)},
      {expectedVersion:updatedRelease.version});
    assert.equal(broken.at(-1)?.type,"FAILED");
    assert.match(broken.at(-1)?.message,/INTEGRITY_MISMATCH/);
    assert.match(await (await first.fetchPage(ORIGIN+"/profile/index.html")).text(),
      /Profile page/,"old version survives failed upgrade");

    write(root,"assets/site.css","body{font:16px system-ui}");
    const success=[];
    await first.dispatch("T3_INSTALL",{postMessage:value=>success.push(value)},
      {expectedVersion:updatedRelease.version});
    assert.equal(success.at(-1)?.type,"READY");
    assert.equal(success.at(-1)?.version,updatedRelease.version);
    assert.match(await (await first.fetchPage(ORIGIN+"/profile/index.html")).text(),
      /Updated Profile page/);
    const restart=fakeBrowser(root,first.caches);
    restart.setNetworkDown(true);
    const coldStatus=[];
    await restart.dispatch("T3_STATUS",{postMessage:value=>coldStatus.push(value)});
    assert.equal(coldStatus.at(-1)?.version,updatedRelease.version,
      "the exact user-installed Host/BLI version survives a cold SW restart");
    assert.equal(coldStatus.at(-1)?.complete,true);
    assert.match(await (await restart.fetchPage(ORIGIN+"/profile/index.html")).text(),
      /Updated Profile page/,"updated version works after a cold offline restart");
    const beforeCheck=restart.liveFetches, unavailable=[];
    await restart.dispatch("T3_CHECK_UPDATE",{postMessage:value=>unavailable.push(value)});
    assert.equal(unavailable.at(-1)?.type,"FAILED","offline update check is honest");
    assert.equal(restart.liveFetches,beforeCheck+1,
      "the only attempted remote request followed the user's explicit update check");
    assert.match(await (await restart.fetchPage(ORIGIN+"/profile/index.html")).text(),
      /Updated Profile page/,"a failed update check never switches off autonomy");
  } finally {cleanup(root);}
});


test("Exact released origin prevents unchanged autonomous bundle installation on another HTTPS domain",async()=>{
  const root=specimen();
  try {
    const release=materializeDomainMode(root);
    const manifestPath=join(root,"t3-offline-manifest.json");
    const manifest=JSON.parse(readFileSync(manifestPath,"utf8"));
    const copied=fakeBrowser(root,null,Date,"https://copy.example");
    const rejected=[];
    await copied.dispatch("T3_INSTALL",{postMessage:m=>rejected.push(m)});
    assert.equal(rejected.at(-1)?.type,"FAILED");
    assert.match(rejected.at(-1)?.message,/RELEASE_ORIGIN_MISMATCH/);
    assert.equal(copied.liveFetches,1,"no assets fetched from an unauthorized host");
    writeFileSync(manifestPath,JSON.stringify({...manifest,domain_origin:"https://copy.example"}));
    const forged=[];
    await copied.dispatch("T3_INSTALL",{postMessage:m=>forged.push(m)});
    assert.match(forged.at(-1)?.message,/RELEASE_ORIGIN_MISMATCH/,"rewriting only manifest is insufficient");
    writeFileSync(manifestPath,JSON.stringify(manifest));
    const local=fakeBrowser(root,null,Date,"http://127.0.0.1:18443"),ready=[];
    await local.dispatch("T3_INSTALL",{postMessage:m=>ready.push(m)},{expectedVersion:release.version});
    assert.equal(ready.at(-1)?.type,"READY");
    const cold=fakeBrowser(root,local.caches,Date,"http://127.0.0.1:18443");
    cold.setNetworkDown(true);
    assert.equal((await cold.fetchPage("http://127.0.0.1:18443/workspace/")).status,200);
    const official=fakeBrowser(root),officialReady=[];
    await official.dispatch("T3_INSTALL",{postMessage:m=>officialReady.push(m)});
    assert.equal(officialReady.at(-1)?.type,"READY");
    // Even if copied CacheStorage entries are manually re-keyed to the
    // destination origin, the original release metadata cannot authorize it.
    const cloned=new Map([...official.caches].map(([name,entries])=>[name,new Map(
      [...entries].map(([url,response])=>[url.replace(ORIGIN,"https://copy.example"),response.clone()])
    )]));
    const foreignCold=fakeBrowser(root,cloned,Date,"https://copy.example"),status=[];
    await foreignCold.dispatch("T3_STATUS",{postMessage:m=>status.push(m)});
    assert.equal(status.at(-1)?.active,false,"re-keyed foreign-origin cache cannot be activated");
    assert.equal(foreignCold.liveFetches,0,"cold rejection does not consult the network");
    // The same manifest verification applies to explicit updates on the
    // official origin. The already installed, legitimate version survives.
    writeFileSync(manifestPath,JSON.stringify({...manifest,domain_origin:"https://copy.example"}));
    const rejectedUpdate=[];
    await official.dispatch("T3_CHECK_UPDATE",{postMessage:m=>rejectedUpdate.push(m)});
    assert.match(rejectedUpdate.at(-1)?.message,/RELEASE_ORIGIN_MISMATCH/);
    assert.equal((await official.fetchPage(ORIGIN+"/workspace/")).status,200);
  }finally{cleanup(root);}
});


test("autonomous snapshot permits only the explicitly scoped local Agent model transport",async()=>{
  const root=specimen();
  try{
    materializeDomainMode(root);
    const browser=fakeBrowser(root);
    const replies=[];await browser.dispatch("T3_INSTALL",{postMessage:x=>replies.push(x)});
    assert.equal(replies.at(-1)?.type,"READY");
    const options={mode:"cors",credentials:"omit",redirect:"error",headers:{"Content-Type":"application/json","X-IWXA-Model-Token":"a".repeat(43)},body:"{}"};
    const local="http://127.0.0.1:8765/api/t3-local-model/";
    const before=browser.liveFetches;
    await browser.fetchPage(local+"status","POST",options);
    await browser.fetchPage(local+"invoke","POST",options);
    assert.equal(browser.liveFetches,before+2,"two exact local routes reach the local transport");
    for(const [url,init] of [[local+"list",options],[local+"invoke?x=1",options],[local+"invoke",{...options,credentials:"include"}],[local+"invoke",{...options,redirect:"follow"}],[local+"invoke",{...options,headers:{"Content-Type":"application/json"}}],["https://example.com/api/t3-local-model/invoke",options],["http://localhost:8765/api/t3-local-model/invoke",options]]){
      const reply=await browser.fetchPage(url,"POST",init);
      assert.equal(reply.type,"error");
    }
    assert.equal(browser.liveFetches,before+2,"no unauthorized route reaches network");
  }finally{cleanup(root);}
});
