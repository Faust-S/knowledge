// Static loopback-only delivery transport. No certificate or OS policy changes.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,statSync,existsSync} from "node:fs";
import {createServer} from "node:http";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const base=dirname(fileURLToPath(import.meta.url)),dist=join(base,"dist");
const origin="http://localhost:18443";
const receipt=JSON.parse(readFileSync(join(base,"acceptance-receipt.json"),"utf8"));
assert.equal(receipt.schema,"IWXA_T3_RC5_ACCEPTANCE_DELIVERY/1");
const candidatePath=join(base,"platform-candidate-receipt.json");
if(existsSync(candidatePath)){
 const candidate=JSON.parse(readFileSync(candidatePath,"utf8"));
 for(const field of ["version","sourceCommit","archiveSha256","manifestSha256","kernel","contract","kernelArchiveSha256"])
  assert.equal(receipt[field],candidate[field],"DELIVERY_CANDIDATE_MISMATCH:"+field);
}else{
 assert.equal(receipt.sourceCommit,"a50d40dafc2e029fcc7668dece925f7fc38cc510");
 assert.equal(receipt.archiveSha256,"381e9845fea164569d9363dd4e0983b5d9971347450e93246c1ebd5023fb98c4");
}
assert.equal(receipt.origin,origin);
assert.equal(receipt.localAcceptanceOnly,true);
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
const mime={html:"text/html; charset=utf-8",js:"text/javascript; charset=utf-8",mjs:"text/javascript; charset=utf-8",json:"application/json",webmanifest:"application/manifest+json",css:"text/css; charset=utf-8",svg:"image/svg+xml",ico:"image/x-icon",png:"image/png",wasm:"application/wasm",woff2:"font/woff2",txt:"text/plain; charset=utf-8"};
const server=createServer((req,res)=>{
 if(req.socket.remoteAddress!=="127.0.0.1"||req.headers.host!=="localhost:18443"){res.writeHead(421).end();return;}
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
console.log("T3_RC5_LOCAL_LOOPBACK_READY "+origin+"/workspace/ | Ctrl+C to stop");
for(const sig of ["SIGINT","SIGTERM"])process.on(sig,()=>server.close(()=>process.exit(0)));
