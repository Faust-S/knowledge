// Static HTTPS delivery transport ONLY. The application lives in the qualified dist.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,statSync} from "node:fs";
import {createServer} from "node:https";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const base=dirname(fileURLToPath(import.meta.url)),dist=join(base,"dist");
const origin="https://localhost:18443";
const receipt=JSON.parse(readFileSync(join(base,"acceptance-receipt.json"),"utf8"));
assert.equal(receipt.schema,"IWXA_T3_RC2_ACCEPTANCE_DELIVERY/1");
assert.equal(receipt.sourceCommit,"4dc21f8439b6988eed043bbe74dc34d8a7e7d875");
assert.equal(receipt.archiveSha256,"c142597c759d6689c0298d0ec6abc7ee66b2eefbb1d5abb086efff6f0dea891e");
assert.equal(receipt.origin,origin);
const sha=b=>createHash("sha256").update(b).digest("hex");
const manifestBytes=readFileSync(join(dist,"t3-offline-manifest.json"));
assert.equal(sha(manifestBytes),receipt.offlineManifestSha256);
const manifest=JSON.parse(manifestBytes);
assert.equal(manifest.domain_origin,origin);
assert.equal(manifest.version,receipt.offlineVersion);
const paths=new Map();
for(const row of manifest.files){
 const name=row.source||row.path;
 assert.ok(/^\/[A-Za-z0-9_.\/-]+$/.test(name)&&!name.split("/").some(x=>x==="."||x===".."));
 assert.ok(!paths.has(row.path));
 const p=join(dist,name.slice(1)),bytes=readFileSync(p);
 assert.equal(bytes.length,row.bytes);assert.equal(sha(bytes),row.sha256,"DIST_CHANGED:"+name);
 paths.set(row.path,p);
}
paths.set("/t3-offline-manifest.json",join(dist,"t3-offline-manifest.json"));
const pfx=process.env.IWXA_ACCEPTANCE_PFX,passphrase=process.env.IWXA_ACCEPTANCE_PFX_PASSWORD;
assert.ok(pfx&&passphrase,"START_WITH_LOCAL_TLS_LAUNCHER");
const mime={html:"text/html; charset=utf-8",js:"text/javascript; charset=utf-8",mjs:"text/javascript; charset=utf-8",json:"application/json",webmanifest:"application/manifest+json",css:"text/css; charset=utf-8",svg:"image/svg+xml",ico:"image/x-icon",png:"image/png",wasm:"application/wasm",woff2:"font/woff2",txt:"text/plain; charset=utf-8"};
const server=createServer({pfx:readFileSync(pfx),passphrase},(req,res)=>{
 if(req.headers.host!=="localhost:18443"){res.writeHead(421).end();return;}
 if(req.method!=="GET"&&req.method!=="HEAD"){res.writeHead(405).end();return;}
 let path;
 try{path=new URL(req.url,origin).pathname;}catch{res.writeHead(400).end();return;}
 if(!paths.has(path)&&paths.has(path+"/")){res.writeHead(308,{location:path+"/"}).end();return;}
 const file=paths.get(path);
 if(!file){res.writeHead(404).end("Not found");return;}
 try{
  const bytes=readFileSync(file);
  res.writeHead(200,{"content-type":mime[file.split(".").at(-1)]||"application/octet-stream",
   "content-length":bytes.length,"cache-control":"no-store","x-content-type-options":"nosniff"});
  res.end(req.method==="HEAD"?undefined:bytes);
 }catch{res.writeHead(500).end("Local delivery file unavailable");}
});
await new Promise((ok,bad)=>{server.once("error",bad);server.listen(18443,"127.0.0.1",ok);});
console.log("IWXA T3 0.3.1-rc.2 | Open "+origin+"/workspace/ | Ctrl+C to stop");
for(const sig of ["SIGINT","SIGTERM"])process.on(sig,()=>server.close(()=>process.exit(0)));
