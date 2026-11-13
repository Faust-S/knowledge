import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from "node:fs";
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
const manifest=root=>JSON.parse(readFileSync(join(root,"t3-app.webmanifest"),"utf8"));
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
    assert.match(html,/<head>[^]*href="\/t3-app.webmanifest"/);
    assert.match(readFileSync(join(root,"workspace/index.html"),"utf8"),/t3-app.webmanifest/);
    assert.equal(readFileSync(join(root,"site.webmanifest"),"utf8"),original);
    const offline=JSON.parse(readFileSync(join(root,"t3-offline-manifest.json"),"utf8"));
    for(const path of ["/t3-app.webmanifest","/_iwxa/pwa/icon-192.png",
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
    write(root,"android-chrome-192x192.png",Buffer.from("brand-icon"));
    write(root,"site.webmanifest",JSON.stringify({name:"Domain",icons:[
      {src:"/android-chrome-192x192.png",sizes:"192x192",type:"image/png"},
      {src:"https://evil.example/icon.png",sizes:"512x512",type:"image/png"}]}));
    materializeDomainMode(root);
    const m=manifest(root);
    assert.equal(m.icons.find(x=>x.sizes==="192x192").src,"/android-chrome-192x192.png");
    assert.equal(m.icons.find(x=>x.sizes==="512x512").src,"/_iwxa/pwa/icon-512.png");
    assert.equal(existsSync(join(root,"_iwxa/pwa/icon-192.png")),false);
  }finally{clean(root);}
});
