/**
 * Real browser launch of the source-identical BLI Workspace module compiled
 * INTO the inherited T2/T3 Host, with the unchanged qualified Kernel 0.3.6.
 * This is an executable product route, not a mock React panel or WebLLM sample.
 */
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";
import {LOCAL_INFERENCE_DRAFT_SCHEMA,LOCAL_INFERENCE_DRAFT_DECLARATION}
  from "../src/t3/local-inference-draft.mjs";
import {materializeIntegrationHost,serveRealKernelHost}
  from "../scripts/real-kernel-e2e.mjs";
import {assertQualifiedKernelArtifact}
  from "../src/factory2/products/domain-completion/independent-browser-witness.mjs";

const core=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const qualified=process.env.IWXA_T2_QUALIFIED_KERNEL_DIST;
if(!qualified || !existsSync(join(qualified,"_iwxa","runtime","0.3.6","runtime.js"))) {
  throw Error("T3_D5_REAL_KERNEL_ARTIFACT_REQUIRED");
}
const root=mkdtempSync(join(tmpdir(),"iwxa-t3-bli-browser-"));
const profile=mkdtempSync(join(tmpdir(),"iwxa-t3-bli-profile-"));
const checksum=bytes=>createHash("sha256").update(bytes).digest("hex");
let context=null,live=null;
try {
  mkdirSync(join(root,"workspace"),{recursive:true});
  cpSync(join(core,"dist","index.html"),join(root,"workspace","index.html"));
  cpSync(join(core,"dist","assets"),join(root,"workspace","assets"),{recursive:true});
  cpSync(join(qualified,"_iwxa"),join(root,"_iwxa"),{recursive:true});
  assertQualifiedKernelArtifact(root,{
    kernel:"0.3.6",contract:"1.3.0",
    artifactId:"iwxa-kernel-k036-same-store-history-20261019-qualified.1",
  });
  const host=materializeIntegrationHost(root,"https://127.0.0.1");
  host.domain.runtime.kernel_release="0.3.6";
  host.domain.runtime.runtime_version="0.3.6";
  host.workspaceConfig.host.required_contract_version="1.3.0";
  host.workspaceConfig.host.required_runtime_version="0.3.6";
  host.workspaceConfig.modules.push({
    module_id:"iwxa.t3.local-inference",state:"active",ui_mode:"standard",
    route_base:"/workspace/",slots:["inspector"],required_levels:["T1"],
    required_operations:["t1.getWorkspace"],
    object_schemas:[LOCAL_INFERENCE_DRAFT_SCHEMA],
    dependencies:["iwxa.workspace.base"],
  });
  host.domain.security.allowed_object_classes.push(LOCAL_INFERENCE_DRAFT_SCHEMA);
  host.passport.input_object_types.push(LOCAL_INFERENCE_DRAFT_SCHEMA);
  host.passport.output_object_types.push(LOCAL_INFERENCE_DRAFT_SCHEMA);
  host.passport.permissions.objects.read.push(LOCAL_INFERENCE_DRAFT_SCHEMA);
  host.passport.permissions.objects.write.push(LOCAL_INFERENCE_DRAFT_SCHEMA);
  host.passport.schemas[LOCAL_INFERENCE_DRAFT_SCHEMA]=LOCAL_INFERENCE_DRAFT_DECLARATION;
  writeFileSync(join(root,"_iwxa","domain.json"),JSON.stringify(host.domain));
  writeFileSync(join(root,"workspace","workspace.config.json"),JSON.stringify(host.workspaceConfig));
  const passFile="_iwxa/services/iwxa.workspace.integration.json";
  const passBytes=Buffer.from(JSON.stringify(host.passport));
  writeFileSync(join(root,passFile),passBytes);
  writeFileSync(join(root,"_iwxa","service-catalog.json"),JSON.stringify({
    count:1,entries:[{
      service_id:host.passport.service_id,
      service_version:host.passport.service_version,
      base_path:host.passport.base_path,
      supported_levels:host.passport.supported_levels,
      file:passFile,sha256:checksum(passBytes),
    }],
  }));
  cpSync(join(root,"favicon.ico"),join(root,"workspace","favicon.ico"));
  live=await serveRealKernelHost(root,{previewOrigin:true,independentWitness:true});
  context=await chromium.launchPersistentContext(profile,{
    headless:true,ignoreHTTPSErrors:true,
    args:["--no-sandbox","--enable-unsafe-webgpu","--use-angle=swiftshader"],
    viewport:{width:1280,height:900},
  });
  const page=context.pages()[0]||await context.newPage();
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto(live.origin+"/workspace/",{waitUntil:"domcontentloaded",timeout:45000});
  // First-run is a genuine original-Kernel user action, never mock seeding.
  const gate=page.getByTestId("t2-first-run-create");
  if(await gate.isVisible().catch(()=>false))await gate.click();
  const launcher=page.getByTestId("t3-local-inference-launcher");
  await launcher.waitFor({state:"visible",timeout:60000});
  const open=launcher.getByRole("button",{name:"Открыть локальную модель"});
  assert.equal(await open.isEnabled(),true,"Host BLI command must be registered");
  await open.click();
  const panel=page.getByTestId("t3-local-inference-panel");
  await panel.waitFor({state:"visible",timeout:30000});
  assert.match(await panel.innerText(),/SmolLM2 360M|WebGPU/);
  assert.equal(await panel.getByRole("button",{name:"Скачать и запустить"}).isDisabled(),true,
    "model may never download until separate user consent");
  assert.equal(await panel.getByRole("button",{name:"Из кеша, без сети"}).isDisabled(),true,
    "missing WebLLM cache must never silently fetch weights");
  const kernel=await page.evaluate(()=>typeof globalThis.IWXA?.connect);
  assert.equal(kernel,"function","the page must expose the original Kernel entry");
  const gpu=await page.evaluate(async()=>{
    if(!navigator.gpu?.requestAdapter)return {supported:false,reason:"WEBGPU_API_UNAVAILABLE"};
    try {
      const adapter=await navigator.gpu.requestAdapter();
      return adapter?{supported:true,reason:"ADAPTER_PRESENT"}:
        {supported:false,reason:"WEBGPU_ADAPTER_UNAVAILABLE"};
    }catch(e){return {supported:false,reason:String(e)};}
  });
  console.log("T3_D5_REAL_BLI_HOST_BROWSER_PASS",JSON.stringify({
    kernel:"0.3.6",contract:"1.3.0",
    panelVisible:true,webllmConsentRequired:true,
    offlineCacheOnlyWithoutWeights:true,
    webgpu:gpu,errors:errors.slice(0,8),
    scope:"actual compiled Host and BLI panel; model not downloaded",
  }));
  assert.equal(errors.length,0,"Unexpected browser exceptions: "+errors.join("; "));
}finally{
  if(context)await context.close().catch(()=>{});
  if(live)await new Promise(resolve=>live.server.close(resolve));
  rmSync(profile,{recursive:true,force:true});
  rmSync(root,{recursive:true,force:true});
}
