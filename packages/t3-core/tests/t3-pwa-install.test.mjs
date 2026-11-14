import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync,copyFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,dirname} from "node:path";
import {materializeDomainMode} from "../scripts/materialize-t3-domain-mode.mjs";

const write=(root,path,data)=>{
  const absolute=join(root,path);mkdirSync(dirname(absolute),{recursive:true});
  writeFileSync(absolute,data);
};
function fixture() {
  const root=mkdtempSync(join(tmpdir(),"iwxa-t3-pwa-"));
  write(root,"index.html",'<html><head><title>Клуб IWXA</title><link rel="manifest" href="/site.webmanifest"></head><body><main>Club</main></body></html>');
  write(root,"workspace/index.html",'<html><head><title>Workspace</title></head><body>Kernel</body></html>');
  write(root,"_iwxa/domain.json",JSON.stringify({origin:"https://club.iwxa.ru"}));
  write(root,"_iwxa/domain-shell.json","{}");
  write(root,"_iwxa/service-catalog.json","{}");
  write(root,"_iwxa/runtime/0.3.6/runtime.js","/* pinned Kernel */");
  return root;
}
const clean=root=>rmSync(root,{recursive:true,force:true});
const manifest=root=>JSON.parse(readFileSync(join(root,"t3-app-manifest.json"),"utf8"));
test("T3 install app: one dist, standalone identity and two valid PNG icon sizes",()=>{
  const root=fixture();
  try {
    write(root,"site.webmanifest",JSON.stringify({name:"Клуб IWXA",short_name:"Клуб",
      display:"browser",theme_color:"#287647",icons:[]}));
    const original=readFileSync(join(root,"site.webmanifest"),"utf8");
    const a=materializeDomainMode(root),m=manifest(root);
    assert.equal(m.id,"/");
    assert.equal(m.start_url,"/");
    assert.equal(m.scope,"/");
    assert.equal(m.display,"standalone");
    assert.equal(m.name,"Клуб IWXA");
    assert.equal(m.short_name,"Клуб");
    assert.equal(m.theme_color,"#287647");
    assert.equal(m.prefer_related_applications,false);
    for(const size of [192,512]) {
      const icon=m.icons.find(x=>x.sizes===size+"x"+size&&x.type==="image/png");
      assert.ok(icon);
      const bytes=readFileSync(join(root,icon.src.slice(1)));
      assert.equal(bytes.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
      assert.equal(bytes.readUInt32BE(16),size);
      assert.equal(bytes.readUInt32BE(20),size);
    }
    const html=readFileSync(join(root,"index.html"),"utf8");
    assert.equal((html.match(/rel="manifest"/g)||[]).length,1);
    assert.match(html,/<head>[^]*href="\/t3-app-manifest.json"/);
    assert.match(html,/<link rel="apple-touch-icon" href="\/_iwxa\/pwa\/icon-192.png"/);
    assert.match(html,/<meta name="apple-mobile-web-app-capable" content="yes"/);
    assert.match(readFileSync(join(root,"workspace/index.html"),"utf8"),/t3-app-manifest.json/);
    assert.equal(readFileSync(join(root,"site.webmanifest"),"utf8"),original);
    const offline=JSON.parse(readFileSync(join(root,"t3-offline-manifest.json"),"utf8"));
    for(const path of ["/t3-app-manifest.json","/_iwxa/pwa/icon-192.png",
        "/_iwxa/pwa/icon-512.png"]) {
      assert.ok(offline.files.some(item=>item.path===path),"single-dist cache "+path);
    }
    const b=materializeDomainMode(root);
    assert.equal(a.version,b.version,"rebuild does not change the installed version");
    assert.equal((readFileSync(join(root,"index.html"),"utf8").match(/rel="manifest"/g)||[]).length,1);
  }finally{clean(root);}
});
test("T3 install app preserves existing domain brand icons and creates only missing sizes",()=>{
  const root=fixture();
  try {
    materializeDomainMode(root);
    copyFileSync(join(root,"_iwxa/pwa/icon-192.png"),
      join(root,"android-chrome-192x192.png"));
    write(root,"site.webmanifest",JSON.stringify({name:"Domain",icons:[
      {src:"https://club.iwxa.ru/android-chrome-192x192.png",
        sizes:"192x192",type:"image/png"},
      {src:"https://evil.example/icon.png",sizes:"512x512",type:"image/png"}]}));
    materializeDomainMode(root);
    const m=manifest(root);
    assert.equal(m.icons.find(x=>x.sizes==="192x192").src,"/android-chrome-192x192.png");
    assert.equal(m.icons.find(x=>x.sizes==="512x512").src,"/_iwxa/pwa/icon-512.png");
    assert.equal(existsSync(join(root,"_iwxa/pwa/icon-192.png")),false);
  }finally{clean(root);}
});

test("T3 install app rejects corrupt icon bytes instead of shipping broken OS branding",()=>{
  const root=fixture();
  try {
    write(root,"corrupt-192.png",Buffer.from("not a PNG"));
    write(root,"site.webmanifest",JSON.stringify({name:"Domain",icons:[
      {src:"/corrupt-192.png",sizes:"192x192",type:"image/png"}]}));
    materializeDomainMode(root);
    const m=manifest(root);
    assert.equal(m.icons.some(x=>x.src==="/corrupt-192.png"),false,
      "a wrong source icon must never replace a valid generated install icon");
    assert.equal(m.icons.find(x=>x.sizes==="192x192").src,
      "/_iwxa/pwa/icon-192.png");
  }finally{clean(root);}
});

test("T3 install app preserves the domain's existing Apple home-screen icon",()=>{
  const root=fixture();
  try{
    write(root,"index.html",'<html><head><title>Own brand</title>'+
      '<link rel="apple-touch-icon" href="/original-apple.png">'+
      '<meta name="apple-mobile-web-app-capable" content="yes">'+
      '</head><body><main>Site</main></body></html>');
    materializeDomainMode(root);
    const html=readFileSync(join(root,"index.html"),"utf8");
    assert.equal((html.match(/rel="apple-touch-icon"/g)||[]).length,1);
    assert.match(html,/href="\/original-apple.png"/);
    assert.equal((html.match(/apple-mobile-web-app-capable/g)||[]).length,1);
    const before=readFileSync(join(root,"index.html"),"utf8");
    materializeDomainMode(root);
    assert.equal(readFileSync(join(root,"index.html"),"utf8"),before,
      "iOS metadata is stable across domain rebuilds");
  }finally{clean(root);}
});

test("T3 installed PWA associates .iwxa only with active original Exchange route",()=>{
  const root=fixture();
  try {
    assert.equal(materializeDomainMode(root).original_kernel_unchanged,true);
    assert.equal(manifest(root).file_handlers,undefined);
    write(root,"workspace/exchange/index.html",
      '<html><head><title>Перенос данных</title></head><body><main>Exchange</main></body></html>');
    write(root,"workspace/workspace.config.json",JSON.stringify({modules:[
      {module_id:"iwxa.workspace.exchange",state:"planned"}]}));
    materializeDomainMode(root);
    assert.equal(manifest(root).file_handlers,undefined);
    write(root,"workspace/workspace.config.json",JSON.stringify({modules:[
      {module_id:"iwxa.workspace.exchange",state:"active"}]}));
    materializeDomainMode(root);
    assert.deepEqual(manifest(root).file_handlers,[{
      action:"/workspace/exchange/",name:"Пакеты IWXA",
      accept:{"application/octet-stream":[".iwxa",".iwxa.age"]},
      launch_type:"single-client",
    }]);
    const snapshot=JSON.parse(readFileSync(join(root,"t3-offline-manifest.json"),"utf8"));
    assert.equal(snapshot.files.some(file=>file.path==="/workspace/exchange/"),true);
  }finally{clean(root);}
});
