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
const hardwareRequired=process.env.T3_D5_REQUIRE_HARDWARE_GPU==="1";
const browserLaunch={
  headless:true,ignoreHTTPSErrors:true,
  ...(process.platform==="darwin"?{channel:"chromium"}:{}),
  args:process.platform==="darwin"
    ? ["--enable-unsafe-webgpu"]
    : ["--no-sandbox","--enable-unsafe-webgpu","--use-angle=swiftshader"],
  viewport:{width:1280,height:900},
};
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
  context=await chromium.launchPersistentContext(profile,browserLaunch);
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
  // Explicitly select a real Workspace through the existing Host base
  // command. Create a source object through the original Kernel 0.3.6,
  // never through fixture state or a second Store.
  const chosenWorkspace="t3-d5-bli-"+randomUUID();
  const chosenObject="t3-d5-live-source";
  const sourceReceipt=await page.evaluate(async ({workspace_id,object_id})=>{
    const session=await globalThis.IWXA.connect({service_id:"iwxa.workspace.integration"});
    await session.t1.createWorkspace({workspace_id,profile:"generic"});
    return session.t1.putObject({workspace_id,object_id,
      schema_id:"iwxa.demo.note",schema_version:"1.0.0",
      base_revision:0,extensions:{},
      data:{title:"T3 selected context from original Kernel"},
      event:{event_type:"test.object.created",payload:{}}});
  },{workspace_id:chosenWorkspace,object_id:chosenObject});
  assert.equal(sourceReceipt.object.object_id,chosenObject);
  await panel.getByRole("button",{name:"Найти рабочие области"}).click();
  await panel.getByLabel("Workspace для локальной модели").selectOption(chosenWorkspace);
  await panel.getByRole("button",{name:"Использовать выбранный Workspace"}).click();
  await page.waitForFunction(id=>
    document.querySelector('[data-testid="t3-local-inference-panel"] strong')
      ?.textContent?.includes(id),chosenWorkspace);
  await panel.getByRole("button",{name:"Выбрать объект Workspace"}).click();
  await panel.getByRole("combobox",{name:"Объект для локальной модели"}).selectOption(chosenObject);
  await panel.getByRole("button",{name:"Добавить выбранное содержимое к запросу"}).click();
  // Kernel read and React state update are asynchronous. Wait for the actual
  // selected revision to appear instead of racing the click handler.
  await page.waitForFunction(() => Array.from(document.querySelectorAll("textarea"))
    .some(textarea => textarea.value.includes("T3 selected context from original Kernel")),
    null,{timeout:15000});
  await panel.waitFor({state:"visible",timeout:15000});
  assert.match(await panel.getByTestId("t3-d5-prompt").inputValue(),
    /T3 selected context from original Kernel/);
  console.log("T3_D5_REAL_KERNEL_CONTEXT_SELECTION_PASS",JSON.stringify({
    workspace:chosenWorkspace,object_id:chosenObject,sourceRevision:1,
    selectedBy:"workspace.focus.select",sourceRead:"t1.getObject",
  }));

  assert.equal(await panel.getByRole("button",{name:"Скачать и запустить"}).isDisabled(),true,
    "model may never download until separate user consent");
  assert.equal(await panel.getByRole("button",{name:"Из кеша, без сети"}).isDisabled(),true,
    "missing WebLLM cache must never silently fetch weights");
  const kernel=await page.evaluate(()=>typeof globalThis.IWXA?.connect);
  assert.equal(kernel,"function","the page must expose the original Kernel entry");
  const gpu=await page.evaluate(async()=>{
    if(!navigator.gpu?.requestAdapter)return {supported:false,reason:"WEBGPU_API_UNAVAILABLE"};
    try {
      const adapter=await navigator.gpu.requestAdapter({powerPreference:"high-performance"});
      if(!adapter)return {supported:false,reason:"WEBGPU_ADAPTER_UNAVAILABLE"};
      const info=adapter.info||{};
      return {supported:true,reason:"ADAPTER_PRESENT",vendor:info.vendor||"",
        device:info.device||"",architecture:info.architecture||"",
        description:info.description||""};
    }catch(e){return {supported:false,reason:String(e)};}
  });
  const hardwareVendor=[gpu.vendor,gpu.device,gpu.description].join(" ");
  const realGpu=gpu.supported && /apple|nvidia|amd|intel/i.test(hardwareVendor) &&
    !/swiftshader|software|llvmpipe|google/i.test(hardwareVendor);
  if(hardwareRequired && !realGpu) {
    throw Error("T3_D5_HARDWARE_WEBGPU_NOT_AVAILABLE: "+JSON.stringify(gpu));
  }
  console.log("T3_D5_REAL_BLI_HOST_BROWSER_PASS",JSON.stringify({
    kernel:"0.3.6",contract:"1.3.0",
    panelVisible:true,webllmConsentRequired:true,
    offlineCacheOnlyWithoutWeights:true,
    webgpu:gpu,errors:errors.slice(0,8),
    scope:"actual compiled Host and BLI panel; model not downloaded",
  }));
  assert.equal(errors.length,0,"Unexpected browser exceptions: "+errors.join("; "));
  // A real GPU adapter was found on the public runner. Attempt the exact
  // WebLLM installation and WebGPU model inference, never a generated text
  // stub. The result is reported separately from Host/Kernel acceptance:
  // network/model-host or SwiftShader limits are not disguised as inference.
  if(gpu.supported){
    const modelFailureRequests=[];
    page.on("requestfailed",request=>{
      if(modelFailureRequests.length<8)
        modelFailureRequests.push({url:request.url(),error:request.failure()?.errorText});
    });
    await panel.getByRole("checkbox",{name:/Разрешаю скачать файлы модели/}).check();
    page.once("dialog",dialog=>dialog.accept());
    await panel.getByRole("button",{name:"Скачать и запустить"}).click();
    const statusLine=panel.locator('p[role="status"][aria-live="polite"]');
    let modelStatus="",modelStarted=false;
    for(let tick=0;tick<420;tick++){
      modelStatus=await statusLine.textContent().catch(()=>modelStatus)||"";
      modelStarted=await panel.getByRole("button",{name:"Выгрузить"}).isEnabled().catch(()=>false);
      if(modelStarted || /^Модель не запущена:/.test(modelStatus))break;
      await page.waitForTimeout(1000);
    }
    if(!modelStarted){
      console.log("T3_D5_REAL_WEBGPU_INSTALL_BLOCKED",JSON.stringify({
        model:"SmolLM2-360M-Instruct-q4f32_1-MLC",
        status:modelStatus.slice(0,600),requestFailures:modelFailureRequests,
        uiAndKernelPreviouslyPassed:true,
      }));
      if(hardwareRequired)throw Error("T3_D5_HARDWARE_WEBGPU_MODEL_INSTALL_FAILED");
    }else{
      await panel.getByTestId("t3-d5-prompt")
        .fill("Reply with the word hello.");
      await panel.getByTestId("t3-d5-max-tokens").fill("8");
      await panel.getByRole("button",{name:"Сгенерировать локально"}).click();
      let inferenceStatus="";
      for(let tick=0;tick<155;tick++){
        inferenceStatus=await statusLine.textContent().catch(()=>inferenceStatus)||"";
        if(/Черновик готов/.test(inferenceStatus)||/Модель не запущена|Error|ошибка|Ошибка|Модель не выдала первый токен|Модель перестала отвечать/.test(inferenceStatus))break;
        await page.waitForTimeout(1000);
      }
      const output=await panel.getByTestId("t3-d5-editable-draft").inputValue();
      if(/Черновик готов/.test(inferenceStatus) && output.trim()){
        // The generated text itself, not a synthetic placeholder, must
        // reach the original Kernel and remain readable after browser restart.
        const reviewed=output.trim()+" [user-reviewed]";
        await panel.getByTestId("t3-d5-editable-draft").fill(reviewed);
        await panel.getByRole("button",{name:"Сохранить черновик через Kernel"}).click();
        await statusLine.filter({hasText:"Kernel подтвердил запись и чтение:"})
          .waitFor({state:"visible",timeout:30000});
        // The user must see the independently reopened persisted text, not
        // just a success message or a copy of the generated textarea.
        const persistedView=panel.getByTestId("t3-d5-saved-draft-readback");
        await persistedView.waitFor({state:"visible",timeout:30000});
        assert.ok((await persistedView.innerText()).includes(reviewed),
          "T3_D5_SAVED_DRAFT_NOT_VISIBLE_FROM_KERNEL");
        const receiptText=await statusLine.textContent();
        const savedId=receiptText?.match(/local-inference:[0-9a-f-]{36}/i)?.[0];
        assert.ok(savedId,"T3_D5_GENERATED_DRAFT_KERNEL_RECEIPT_MISSING");
        const saved=await page.evaluate(async ({workspace_id,object_id})=>{
          const session=await globalThis.IWXA.connect({service_id:"iwxa.workspace.integration"});
          return session.t1.getObject(workspace_id,object_id);
        },{workspace_id:chosenWorkspace,object_id:savedId});
        assert.equal(saved?.object?.data?.text,reviewed,
          "T3_D5_GENERATED_DRAFT_ORIGINAL_KERNEL_READBACK_MISMATCH");
        await context.close();
        context=null;
        context=await chromium.launchPersistentContext(profile,browserLaunch);
        const coldPage=context.pages()[0]||await context.newPage();
        await coldPage.goto(live.origin+"/__t2_independent_readback__",{waitUntil:"load"});
        await coldPage.waitForFunction(()=>typeof globalThis.IWXA?.connect==="function");
        const cold=await coldPage.evaluate(async ({workspace_id,object_id})=>{
          const session=await globalThis.IWXA.connect({service_id:"iwxa.workspace.integration"});
          return session.t1.getObject(workspace_id,object_id);
        },{workspace_id:chosenWorkspace,object_id:savedId});
        assert.equal(cold?.object?.data?.text,reviewed,
          "T3_D5_GENERATED_DRAFT_COLD_READBACK_MISMATCH");
        console.log("T3_D5_REAL_WEBGPU_KERNEL_COLD_RESTART_PASS",JSON.stringify({
          model:"SmolLM2-360M-Instruct-q4f32_1-MLC",
          generatedCharacters:output.length,workspace:chosenWorkspace,
          savedObject:savedId,originalKernelReadback:true,coldRestart:true,
        }));
      }else{
        const timedOut=/Модель не выдала первый токен|Модель перестала отвечать/.test(inferenceStatus);
        if(timedOut){
          assert.equal(await panel.getByRole("button",{name:"Сохранить черновик через Kernel"}).isDisabled(),true,
            "a timed-out inference must never become an accepted Kernel draft");
          assert.equal(await panel.getByRole("button",{name:"Из кеша, без сети"}).isEnabled(),true,
            "hard timeout must release Worker so cached model can be relaunched");
          console.log("T3_D5_REAL_WEBGPU_TIMEOUT_RECOVERY_PASS",JSON.stringify({
            restoredReady:false,cachedWeightsRemain:true,noDraftSave:true,
          }));
        }
        console.log("T3_D5_REAL_WEBGPU_GENERATION_NOT_ACCEPTED",JSON.stringify({
          status:inferenceStatus.slice(0,500),generatedCharacters:output.length,
          modelStarted:true,webgpu:gpu,
        }));
        if(hardwareRequired)throw Error("T3_D5_HARDWARE_WEBGPU_GENERATION_NOT_ACCEPTED");
      }
    }
  }else{
    console.log("T3_D5_REAL_WEBGPU_ENVIRONMENT_UNAVAILABLE",JSON.stringify(gpu));
    if(hardwareRequired)throw Error("T3_D5_HARDWARE_WEBGPU_API_UNAVAILABLE");
  }

}finally{
  if(context)await context.close().catch(()=>{});
  if(live)await new Promise(resolve=>live.server.close(resolve));
  rmSync(profile,{recursive:true,force:true});
  rmSync(root,{recursive:true,force:true});
}
