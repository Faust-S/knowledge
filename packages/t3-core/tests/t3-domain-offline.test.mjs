import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, dirname} from "node:path";
import {createHash, webcrypto} from "node:crypto";
import vm from "node:vm";
import {materializeDomainMode} from "../scripts/materialize-t3-domain-mode.mjs";

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

function fakeBrowser(root,store=null) {
  const entries=new Map();
  const handlers={};
  const caches=store||new Map();
  let liveFetches=0;
  const toKey=value=>new URL(typeof value==="string"?value:value.url,ORIGIN).href;
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
    const path=new URL(toKey(request)).pathname;
    if(path==="/t3-offline-manifest.json"){
      return new Response(readFileSync(join(root,path.slice(1))),{status:200});
    }
    const original=join(root,path.slice(1));
    try{return new Response(readFileSync(original),{status:200});}
    catch{return new Response("not found",{status:404});}
  };
  const self={
    location:{origin:ORIGIN},
    clients:{claim:async()=>{}},skipWaiting:async()=>{},
    addEventListener(kind,fn){handlers[kind]=fn;}
  };
  const script=readFileSync(join(root,"t3-sw.js"),"utf8");
  vm.runInNewContext(script,{self,caches:cacheAPI,fetch,crypto:webcrypto,Response,Request,URL,
    Uint8Array,Set,Array,Number,String,Map,Error,Promise,console}, {filename:"t3-sw.js"});
  const dispatch=async (type,port={postMessage(){}})=>{
    const waits=[];
    handlers.message({data:{type},ports:[port],waitUntil:p=>waits.push(p)});
    await Promise.all(waits);
  };
  const fetchPage=async(url,method="GET")=>{
    let result;
    handlers.fetch({request:new Request(url,{method}),
      respondWith:p=>{result=p;}});
    return result;
  };
  return {dispatch,fetchPage,caches,get liveFetches(){return liveFetches;}};
}
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
    assert.equal((await afterOptOutRestart.fetchPage(ORIGIN+"/workspace/")).status,200);
    assert.equal(afterOptOutRestart.liveFetches,1);
    const afterReinstall=fakeBrowser(root,first.caches), reinstall=[];
    await afterReinstall.dispatch("T3_INSTALL",{postMessage:m=>reinstall.push(m)});
    assert.equal(reinstall.at(-1)?.type,"READY","only explicit reinstall reactivates T3");
    const enabledAgain=fakeBrowser(root,first.caches);
    assert.equal((await enabledAgain.fetchPage(ORIGIN+"/workspace/")).status,200);
    assert.equal(enabledAgain.liveFetches,0);
  }finally{cleanup(root);}
});
