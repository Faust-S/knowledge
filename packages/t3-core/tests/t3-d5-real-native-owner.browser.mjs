import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {cpSync,existsSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {materializeIntegrationHost,serveRealKernelHost} from '../scripts/real-kernel-e2e.mjs';
import {materializeDomainMode} from '../scripts/materialize-t3-domain-mode.mjs';
import {assertQualifiedKernelArtifact} from '../src/factory2/products/domain-completion/independent-browser-witness.mjs';

const SERVICE='iwxa.workspace.integration';
const RUNTIME='0.3.6';
const ARTIFACT='iwxa-kernel-k036-same-store-history-20261019-qualified.1';
const MODEL='Qwen3-0.6B-Q4_0';
const ENGINE='llama.cpp@b12244';
const digest=v=>createHash('sha256').update(v).digest('hex');
const put=(root,path,contents)=>{
  const target=join(root,path);
  mkdirSync(join(target,'..'),{recursive:true});
  writeFileSync(target,contents);
};
function nativeGeneration(request) {
  const cli=process.env.T3_D5_NATIVE_LLAMA_CLI;
  const model=process.env.T3_D5_NATIVE_GGUF;
  assert.ok(cli&&existsSync(cli),'T3_D5_NATIVE_EXECUTOR_MISSING');
  assert.ok(model&&existsSync(model),'T3_D5_NATIVE_MODEL_MISSING');
  const prompt='<|im_start|>system\nReply briefly in Russian. /no_think\n'+
    '<|im_end|>\n<|im_start|>user\n'+request+
    '\n<|im_end|>\n<|im_start|>assistant\n';
  const result=spawnSync(cli,['-m',model,'-p',prompt,'-n','96','-t','4',
    '--temp','0','--no-display-prompt','--no-conversation',
    '--single-turn','--log-disable'],{
    encoding:'utf8',timeout:180000,maxBuffer:2*1024*1024,
    env:{...process.env,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',
      HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',
      ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'*'},
  });
  assert.equal(result.error,undefined,'T3_D5_NATIVE_PROCESS_ERROR '+String(result.error));
  assert.equal(result.status,0,'T3_D5_NATIVE_INFERENCE_FAILED '+String(result.stderr).slice(-1500));
  const output=result.stdout.replace(/\x1b\[[0-9;]*m/g,'').trim();
  assert.ok(output.length>0&&output.length<=64000,'T3_D5_NATIVE_MODEL_OUTPUT_EMPTY');
  return output;
}

test('native installed Qwen3 via llama.cpp -> original Kernel Event -> cold offline local rerun',
  {timeout:540000},async()=>{
  const qualified=process.env.IWXA_T2_QUALIFIED_KERNEL_DIST;
  assert.ok(qualified&&existsSync(join(qualified,'_iwxa/runtime/0.3.6/runtime.js')),
    'T3_D5_ORIGINAL_KERNEL_REQUIRED');
  const temp=mkdtempSync(join(tmpdir(),'t3-native-inference-'));
  const dist=join(temp,'dist'),profile=join(temp,'profile');
  const workspace='t3-native-'+randomUUID();
  let live=null,context=null;
  try{
    const first=nativeGeneration('Напиши одно предложение о локальном хранении данных.');
    mkdirSync(dist,{recursive:true});
    cpSync(join(qualified,'_iwxa'),join(dist,'_iwxa'),{recursive:true});
    assertQualifiedKernelArtifact(dist,{kernel:RUNTIME,contract:'1.3.0',artifactId:ARTIFACT});
    live=await serveRealKernelHost(dist);
    const host=materializeIntegrationHost(dist,live.origin);
    host.domain.runtime.kernel_release=RUNTIME;
    host.domain.runtime.runtime_version=RUNTIME;
    host.workspaceConfig.host.required_runtime_version=RUNTIME;
    host.workspaceConfig.host.required_contract_version='1.3.0';
    put(dist,'_iwxa/domain.json',JSON.stringify(host.domain));
    put(dist,'workspace/workspace.config.json',JSON.stringify(host.workspaceConfig));
    const passport='_iwxa/services/'+SERVICE+'.json';
    const passportBytes=Buffer.from(JSON.stringify(host.passport));
    put(dist,passport,passportBytes);
    put(dist,'_iwxa/service-catalog.json',JSON.stringify({count:1,entries:[{
      service_id:SERVICE,service_version:host.passport.service_version,
      base_path:host.passport.base_path,supported_levels:host.passport.supported_levels,
      file:passport,sha256:digest(passportBytes),
    }]}));
    put(dist,'index.html','<!doctype html><title>T3</title><script src="/_iwxa/loader.js"></script>');
    put(dist,'workspace/index.html','<!doctype html><title>T3 Workspace</title><script src="/_iwxa/loader.js"></script>');
    assert.equal(materializeDomainMode(dist).original_kernel_unchanged,true);
    const launch=()=>chromium.launchPersistentContext(profile,{headless:true,
      ignoreHTTPSErrors:true,args:['--no-sandbox','--ignore-certificate-errors']});
    context=await launch();
    let page=context.pages()[0]||await context.newPage();
    await page.goto(live.origin+'/workspace/');
    await page.waitForFunction(()=>typeof window.IWXA?.connect==='function');
    const save=async(p,id,text,create)=>p.evaluate(async({SERVICE,workspace,id,text,create,MODEL,ENGINE})=>{
      const k=await globalThis.IWXA.connect({service_id:SERVICE});
      if(k.runtime_version!=='0.3.6'||k.contract_version!=='1.3.0')
        throw Error('NOT_ORIGINAL_T2_KERNEL');
      if(create)await k.t1.createWorkspace({workspace_id:workspace,profile:'generic'});
      const receipt=await k.t1.putObject({workspace_id:workspace,object_id:id,
        schema_id:'iwxa.demo.note',schema_version:'1.0.0',base_revision:0,
        data:{title:'Explicit native inference draft',status:'DRAFT_UNTRUSTED',
          origin:'NATIVE_LOCAL',model_id:MODEL,engine:ENGINE,
          source:'USER_EXPLICIT_SAVE',model_integrity:'NOT_ATTESTED',text},
        extensions:{},event:{event_type:'t3.local-inference.native.saved',
          payload:{status:'DRAFT_UNTRUSTED'}},
      });
      const read=await k.t1.getObject(workspace,id);
      return {event:receipt.event.event_id,revision:read?.object?.revision,
        text:read?.object?.data?.text};
    },{SERVICE,workspace,id,text,create,MODEL,ENGINE});
    const firstResult=await save(page,'native-result-1',first,true);
    assert.equal(firstResult.revision,1);
    assert.equal(firstResult.text,first);
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('#iwxa-t3-domain-switch').check();
    await page.waitForFunction(()=>document.documentElement
      .hasAttribute('data-iwxa-t3-autonomous'),null,{timeout:60000});
    await context.close();context=null;

    // Executable and weights remain local after full browser shutdown.
    const second=nativeGeneration('Напиши другое предложение о работе без интернета.');
    context=await launch();
    await context.setOffline(true);
    page=context.pages()[0]||await context.newPage();
    await page.goto(live.origin+'/workspace/',{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>typeof window.IWXA?.connect==='function',null,{timeout:30000});
    const recovered=await page.evaluate(async({SERVICE,workspace,id})=>{
      const k=await IWXA.connect({service_id:SERVICE});
      const first=await k.t1.getObject(workspace,id);
      return {text:first?.object?.data?.text,origin:first?.object?.data?.origin,
        status:first?.object?.data?.status,engine:first?.object?.data?.engine};
    },{SERVICE,workspace,id:'native-result-1'});
    assert.equal(recovered.text,first);
    assert.equal(recovered.origin,'NATIVE_LOCAL');
    assert.equal(recovered.status,'DRAFT_UNTRUSTED');
    assert.equal(recovered.engine,ENGINE);
    const again=await save(page,'native-result-2',second,false);
    assert.equal(again.revision,1);
    assert.equal(again.text,second);
    const events=await page.evaluate(async({SERVICE,workspace})=>{
      const k=await IWXA.connect({service_id:SERVICE});
      return k.t1.listEventsSince(workspace);
    },{SERVICE,workspace});
    assert.ok(events.some(e=>e.event_id===firstResult.event));
    assert.ok(events.some(e=>e.event_id===again.event));
    console.log('T3_D5_NATIVE_QWEN3_ORIGINAL_KERNEL_COLD_PASS',JSON.stringify({
      model:MODEL,engine:ENGINE,originalKernel:RUNTIME,
      originalsWritten:2,coldBrowserRestart:true,offlineBrowser:true,
      newNativeGeneration:true,originalEventsRecovered:true,
      modelBundledInT3:false,installedAgentAccepted:false,
    }));
  } finally {
    if(context)await context.close().catch(()=>{});
    if(live)await new Promise(resolve=>live.server.close(resolve));
    rmSync(temp,{recursive:true,force:true});
  }
});
