// Genuine signed PERSONAL Control -> existing trusted Host HTTPS endpoint ->
// inherited ORIGINAL T2 0.3.6 Kernel/Store. No parallel server, Core or IAM.
// This is an integration witness, not acceptance of the installed Windows app.
import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {cpSync,existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync}
  from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {chromium} from "playwright";
import {createOriginalControlHttpHandler}
  from "../src/t3/original-control-http-handler.mjs";
import {createTemporaryOriginalPersonalAuthority}
  from "./support/t3-original-personal-authority.mjs";
import {materializeIntegrationHost,serveRealKernelHost}
  from "../scripts/real-kernel-e2e.mjs";
import {assertQualifiedKernelArtifact}
  from "../src/factory2/products/domain-completion/independent-browser-witness.mjs";

const SERVICE="iwxa.workspace.integration";
const ARTIFACT="iwxa-kernel-k036-same-store-history-20261019-qualified.1";
const sha=p=>createHash("sha256").update(readFileSync(p)).digest("hex");
function put(root,path,content){
  const full=join(root,path);mkdirSync(join(full,".."),{recursive:true});
  writeFileSync(full,content);
}
test("real HTTPS Host Control verifies Ed25519 PERSONAL on original Kernel; revocation and cold browser restart",{
  timeout:120000
},async()=>{
  const qualified=process.env.IWXA_T2_QUALIFIED_KERNEL_DIST;
  assert.ok(qualified&&existsSync(join(qualified,"_iwxa/runtime/0.3.6/runtime.js")),
    "T3_D1_ORIGINAL_QUALIFIED_KERNEL_REQUIRED");
  const tmp=mkdtempSync(join(tmpdir(),"t3-original-control-kernel-"));
  const dist=join(tmp,"dist"),profile=join(tmp,"profile");
  mkdirSync(dist);
  let live=null,context=null,handler=null;
  const token=randomBytes(32).toString("base64url");
  const ws="t3-d1-real-"+randomUUID();
  const authority=createTemporaryOriginalPersonalAuthority({workspaceId:ws,now:Date.now()});
  let epoch=1;
  const listeners=new Set();
  try {
    cpSync(join(qualified,"_iwxa"),join(dist,"_iwxa"),{recursive:true});
    assertQualifiedKernelArtifact(dist,{kernel:"0.3.6",contract:"1.3.0",
      artifactId:ARTIFACT});
    const runtimeHash=sha(join(dist,"_iwxa/runtime/0.3.6/runtime.js"));
    live=await serveRealKernelHost(dist,{
      controlHandler:async(req,res)=>handler?handler(req,res):false,
    });
    handler=createOriginalControlHttpHandler({
      origin:live.origin,token,
      currentEpoch:()=>epoch,
      subscribeInvalidation:listener=>{
        listeners.add(listener);
        return ()=>listeners.delete(listener);
      },
      ownerFor:({scope,operation})=>scope==="kernel"&&operation==="putObject"
        ?authority.access:null,
    });
    const host=materializeIntegrationHost(dist,live.origin);
    host.domain.runtime.kernel_release="0.3.6";
    host.domain.runtime.runtime_version="0.3.6";
    host.workspaceConfig.host.required_runtime_version="0.3.6";
    host.workspaceConfig.host.required_contract_version="1.3.0";
    put(dist,"_iwxa/domain.json",JSON.stringify(host.domain));
    put(dist,"workspace/workspace.config.json",JSON.stringify(host.workspaceConfig));
    const pass="_iwxa/services/"+SERVICE+".json";
    put(dist,pass,JSON.stringify(host.passport));
    put(dist,"_iwxa/service-catalog.json",JSON.stringify({
      count:1,entries:[{
        service_id:SERVICE,service_version:host.passport.service_version,
        base_path:host.passport.base_path,
        supported_levels:host.passport.supported_levels,
        file:pass,sha256:sha(join(dist,pass)),
      }],
    }));
    // Test-only client entry. Original code bytes; no signer/registry present
    // in the browser and no parallel Kernel. The installed signed AppShell
    // compiles these very same two client modules.
    cpSync(join(process.cwd(),"src/t3/control-loopback-owner.mjs"),
      join(dist,"control-loopback-owner.mjs"));
    cpSync(join(process.cwd(),"src/t3/subject-access-binding.mjs"),
      join(dist,"subject-access-binding.mjs"));
    put(dist,"workspace/index.html",'<!doctype html><html lang="ru"><head>'+
      '<title>Signed T3 integration Host</title></head><body>'+
      '<main>Оригинальная IWXA Workspace</main>'+
      '<script src="/_iwxa/loader.js"></script></body></html>');
    const launch=()=>chromium.launchPersistentContext(profile,{
      headless:true,ignoreHTTPSErrors:true,
      args:["--no-sandbox","--ignore-certificate-errors"],
    });
    context=await launch();
    let page=context.pages()[0]||await context.newPage();
    await page.goto(live.origin+"/workspace/");
    await page.waitForFunction(()=>typeof window.IWXA?.connect==="function");
    const initial=await page.evaluate(async({SERVICE,ws,token})=>{
      const raw=await window.IWXA.connect({service_id:SERVICE});
      if(raw.runtime_version!=="0.3.6"||raw.contract_version!=="1.3.0")
        throw Error("ORIGINAL_KERNEL_REQUIRED");
      await raw.t1.createWorkspace({workspace_id:ws,profile:"generic"});
      const {createControlLoopbackOwner}=await import("/control-loopback-owner.mjs");
      const {createSubjectKernelBinding}=await import("/subject-access-binding.mjs");
      const owner=createControlLoopbackOwner({origin:location.origin,token});
      const stop=owner.subscribeSignedAccessInvalidation(
        ()=>{window.__originalControlInvalidated=true;});
      window.__stopOriginalOwner=stop;
      const access=await owner.signedKernelAccess("putObject");
      if(!access)throw Error("SIGNED_OWNER_NOT_SELECTED");
      const originalFacade={
        sessionInfo:{contract_version:raw.contract_version,
          runtime_version:raw.runtime_version},
        hasOperation:operation=>raw.granted_operations.includes(operation),
        putObject:cmd=>raw.t1.putObject(cmd),
      };
      const binding=createSubjectKernelBinding({
        kernel:originalFacade,access,
      });
      window.__subjectBound=binding;
      const saved=await binding.putObject({
        workspace_id:ws,object_id:"document:one",
        schema_id:"iwxa.demo.note",schema_version:"1.0.0",
        base_revision:0,data:{title:"True original Ed25519 local Host receipt"},
        extensions:{},
        event:{event_type:"t3.d1.signed.original",payload:{}},
      });
      let foreignDenied=null;
      try{
        await binding.putObject({workspace_id:"ws:foreign",
          object_id:"document:alien",schema_id:"iwxa.demo.note",
          schema_version:"1.0.0",base_revision:0,
          data:{title:"Unauthorized"},extensions:{},
          event:{event_type:"t3.d1.unauthorized",payload:{}}});
      }catch(e){foreignDenied=e.code||e.message;}
      return {receipt:saved,event:saved.event.event_id,foreignDenied};
    },{SERVICE,ws,token});
    assert.equal(initial.receipt?.object?.revision,1);
    assert.equal(initial.receipt?.object?.workspace_id,ws);
    assert.equal(initial.foreignDenied,"T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE");
    assert.equal(authority.proofCount,1);
    assert.equal(authority.registryReads,1);
    authority.revoke();
    const forbidden=await page.evaluate(async ws=>{
      try{
        await window.__subjectBound.putObject({
          workspace_id:ws,object_id:"document:after-revoke",
          schema_id:"iwxa.demo.note",schema_version:"1.0.0",
          base_revision:0,data:{title:"Must be denied"},
          extensions:{},event:{event_type:"t3.d1.revoked",payload:{}},
        });
        return {denied:false};
      }catch(e){return {denied:true,code:e.code||e.message};}
    },ws);
    assert.deepEqual(forbidden,{denied:true,code:"T3_ACCESS_NOT_PERMITTED"});
    epoch++;
    for(const listener of listeners)listener();
    await page.waitForFunction(()=>window.__originalControlInvalidated===true);
    await page.evaluate(()=>window.__stopOriginalOwner?.());
    await context.close();context=null;

    // Browser/profile cold restart, same original Store, no second DB.
    context=await launch();
    page=context.pages()[0]||await context.newPage();
    await page.goto(live.origin+"/workspace/");
    await page.waitForFunction(()=>typeof window.IWXA?.connect==="function");
    const cold=await page.evaluate(async({SERVICE,ws})=>{
      const original=await window.IWXA.connect({service_id:SERVICE});
      const old=await original.t1.getObject(ws,"document:one");
      const denied=await original.t1.getObject(ws,"document:after-revoke");
      const events=await original.t1.listEventsSince(ws);
      return {title:old?.object?.data?.title,revision:old?.object?.revision,
        denied:denied?.object??null,events:events.map(x=>x.event_id)};
    },{SERVICE,ws});
    assert.equal(cold.title,"True original Ed25519 local Host receipt");
    assert.equal(cold.revision,1);
    assert.equal(cold.denied,null);
    assert.ok(cold.events.includes(initial.event));
    assert.equal(sha(join(dist,"_iwxa/runtime/0.3.6/runtime.js")),runtimeHash);
    // Previously revoked STATUS stays authoritative in trusted Host memory
    // through browser restart (Host process restart remains NOT_ACCEPTED).
    const renewed=await page.evaluate(async({ws,token})=>{
      const {createControlLoopbackOwner}=await import("/control-loopback-owner.mjs");
      const owner=createControlLoopbackOwner({origin:location.origin,token});
      const stop=owner.subscribeSignedAccessInvalidation(()=>{});
      try{
        const port=await owner.signedKernelAccess("putObject");
        if(!port)return "NOT_SELECTED";
        const {createSubjectKernelBinding}=await import("/subject-access-binding.mjs");
        const original=await window.IWXA.connect({service_id:"iwxa.workspace.integration"});
        const bound=createSubjectKernelBinding({
          kernel:{
            sessionInfo:{contract_version:original.contract_version},
            hasOperation:op=>original.granted_operations.includes(op),
            putObject:cmd=>original.t1.putObject(cmd),
          },
          access:port,
        });
        try{
          await bound.putObject({workspace_id:ws,
            object_id:"document:revoked-after-restart",
            schema_id:"iwxa.demo.note",schema_version:"1.0.0",
            base_revision:0,data:{title:"Must not persist"},
            extensions:{},event:{event_type:"t3.d1.revoked",payload:{}}});
          return "WRONG_ALLOWED";
        }catch(e){return e.code||e.message;}
      }finally{stop();}
    },{ws,token});
    assert.equal(renewed,"T3_ACCESS_NOT_PERMITTED");
    console.log("T3_D1_AUTHENTIC_PERSONAL_CONTROL_ORIGINAL_KERNEL_HTTPS_PASS",JSON.stringify({
      originalKernel:"0.3.6",trueEd25519Grant:true,trueEd25519ActorProof:true,
      trueSignedStatus:true,originalControlHttpProtocol:true,
      singleTrustedHost:true,browserColdRestart:true,originalKernelStore:true,
      revokedBeforeAndAfterCold:true,foreignWorkspaceDenied:true,
      realInstalledControlAccepted:false,hostProcessRestartAccepted:false,
    }));
  } finally {
    if(context)await context.close().catch(()=>{});
    if(live?.server?.listening){
      live.server.closeAllConnections();
      await new Promise(resolve=>live.server.close(resolve));
    }
    rmSync(tmp,{recursive:true,force:true});
  }
});
