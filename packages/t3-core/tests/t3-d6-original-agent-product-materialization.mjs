// Real ORIGINAL qualified T2 0.3.6 -> Agent 0.6 product-owned service ->
// existing original T3 one-dist assembler. No mock Kernel, signed Access,
// employee, receipt, publisher or recipient is created by this qualification.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,relative,sep,extname} from 'node:path';
import {chromium} from 'playwright';
import {materializeOriginalAgentT2Product,
  buildOriginalAgentOneDistFromQualifiedKernel}
  from '../scripts/build-original-agent-one-dist.mjs';
import {assertQualifiedKernelArtifact}
  from '../src/factory2/products/domain-completion/independent-browser-witness.mjs';

const qualified=process.env.IWXA_T2_QUALIFIED_KERNEL_DIST;
assert.ok(typeof qualified==='string'&&qualified.length>0,
  'T3_AGENT_PRODUCT_ORIGINAL_QUALIFIED_T2_REQUIRED');
const artifactId='iwxa-kernel-k036-same-store-history-20261019-qualified.1';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const dir=mkdtempSync(join(tmpdir(),'iwxa-agent-original-product-'));
const input=join(dir,'agent-profile.json');
const stage=join(dir,'original-t2-agent'),dist=join(dir,'original-one-dist');
const receipt=join(dir,'one-dist-receipt.json');
const origin='http://127.0.0.1:18883';
const serviceId='iwxa.personal-agent.workspace';
const desktopAgentControlOnly=process.env.IWXA_T3_AGENT_BUILD_PROFILE===
  'DESKTOP_SIGNED_ONLY';
const profile={
  schema:'IWXA_AGENT_ORIGINAL_T2_PRODUCT_PROFILE/1',
  productId:'iwxa.personal-agent',serviceId,configVersion:'0.6.0',
  origin,workspaceProfile:'generic',localStoreName:'iwxa-local',
  kernelVersion:'0.3.6',runtimeContract:'1.3.0',
  qualifiedArtifactId:artifactId,
  authorizedNativeOwner:'ORIGINAL_T3_SIGNED_EMPLOYEE',
  authorizedResultRecipient:'iwxa.atlas',
  installedAgentT3Mode:'EXPLICIT_OPT_IN',
};
const mime={'.js':'text/javascript','.mjs':'text/javascript',
  '.html':'text/html','.json':'application/json','.css':'text/css',
  '.ico':'image/x-icon','.wasm':'application/wasm'};
let browser=null,server=null;
try{
  writeFileSync(input,JSON.stringify(profile));
  const prepared=await materializeOriginalAgentT2Product({
    qualifiedKernelDist:qualified,agentProfile:input,outputRoot:stage});
  assert.equal(prepared.productId,'iwxa.personal-agent');
  const originalRuntime=readFileSync(
    join(stage,'_iwxa/runtime/0.3.6/runtime.js'));
  const originalLoader=readFileSync(join(stage,'_iwxa/loader.js'));
  assertQualifiedKernelArtifact(stage,{
    kernel:'0.3.6',contract:'1.3.0',artifactId});
  const release=await buildOriginalAgentOneDistFromQualifiedKernel({
    qualifiedKernelDist:qualified,agentProfile:input,t3Build:resolve('dist'),
    outputDir:dist,receiptPath:receipt,desktopAgentControlOnly});
  assert.equal(release.productId,'iwxa.personal-agent');
  assert.equal(release.original_qualified_artifact,artifactId);
  assert.equal(release.original_agent_d6_schema_registered,true);
  const originalReceipt=JSON.parse(readFileSync(receipt,'utf8'));
  assert.equal(originalReceipt.original_runtime_unchanged,true);
  assert.equal(originalReceipt.original_agent_d6_schema_registered,true);
  assert.equal(originalReceipt.original_qualified_artifact,artifactId);
  assert.equal(originalReceipt.local_inference_registered,
    !desktopAgentControlOnly);
  if(desktopAgentControlOnly){
    assert.equal(readdirSync(join(dist,'workspace/assets')).some(name=>
      /^model-worker-[A-Za-z0-9_-]+\.js$/.test(name)),false);
  }
  assert.equal(originalReceipt.output,dist);
  // Exercise the EXACT build-time CLI consumed by Windows Setup Core,
  // not only a direct in-process function call.
  const cliDist=join(dir,'cli-one-dist'),cliReceipt=join(dir,'cli-one-dist-receipt.json');
  const cli=spawnSync(process.execPath,[
    resolve('scripts/build-original-agent-one-dist.mjs'),
    '--qualified-kernel-dist',qualified,'--agent-profile',input,
    '--t3-build',resolve('dist'),'--output',cliDist,'--receipt',cliReceipt,
    ...(desktopAgentControlOnly?['--desktop-agent-control']:[]),
  ],{encoding:'utf8',timeout:45000});
  assert.equal(cli.status,0,
    'Original T2 product builder CLI failed: '+String(cli.stderr).slice(0,350));
  const installed=JSON.parse(cli.stdout);
  assert.equal(installed.original_qualified_artifact,artifactId);
  assert.equal(installed.original_agent_d6_schema_registered,true);
  assert.equal(JSON.parse(readFileSync(cliReceipt,'utf8'))
    .local_inference_registered,!desktopAgentControlOnly);
  assert.equal(JSON.parse(readFileSync(cliReceipt,'utf8')).output,cliDist);
  const domain=JSON.parse(readFileSync(join(dist,'_iwxa/domain.json'),'utf8'));
  const config=JSON.parse(readFileSync(
    join(dist,'workspace/workspace.config.json'),'utf8'));
  const catalog=JSON.parse(readFileSync(
    join(dist,'_iwxa/service-catalog.json'),'utf8'));
  assert.equal(domain.domain_id,'iwxa.personal-agent');
  assert.equal(domain.origin,origin);
  assert.equal(domain.status,'development');
  assert.equal(config.workspace_service_id,serviceId);
  assert.equal(config.host.required_contract_version,'1.3.0');
  assert.ok(!JSON.stringify(domain).includes('synthetic.generic'));
  assert.ok(!JSON.stringify(config).includes('synthetic.generic'));
  const entry=catalog.entries.find(x=>x.service_id===serviceId);
  assert.ok(entry&&entry.file==='_iwxa/services/'+serviceId+'.json');
  const bytes=readFileSync(join(dist,entry.file));
  assert.equal(sha(bytes),entry.sha256);
  const passport=JSON.parse(bytes);
  assert.deepEqual(passport.permissions.operations,['t1.commitObjectGraph']);
  assert.equal(passport.permissions.workspace.create,true);
  assert.deepEqual(passport.permissions.objects.delete,[]);
  assert.ok(passport.schemas['iwxa.agent.accepted-result']);
  assert.ok(passport.schemas['iwxa.t3.access.signed-registry']);
  assert.equal(sha(readFileSync(join(dist,'_iwxa/loader.js'))),
    sha(originalLoader));
  assert.equal(sha(readFileSync(
    join(dist,'_iwxa/runtime/0.3.6/runtime.js'))),sha(originalRuntime));
  assertQualifiedKernelArtifact(dist,{
    kernel:'0.3.6',contract:'1.3.0',artifactId});
  // Original signed recipient belongs to the installed PRIVATE native
  // T3 owner. This public browser probe opens only ORIGINAL T2 bytes.
  server=createServer((request,response)=>{
    const path=new URL(request.url,origin).pathname;
    if(request.headers.host!==new URL(origin).host){
      response.writeHead(403);response.end('WRONG_ORIGIN');return;
    }
    if(path==='/__original_agent_product_kernel__'){
      response.writeHead(200,{'content-type':'text/html',
        'content-security-policy':"script-src 'self' 'unsafe-eval'; connect-src 'self'"});
      response.end('<!doctype html><title>Agent T2 product</title>'+
        '<script src="/_iwxa/loader.js"></script>');return;
    }
    const target=resolve(dist,'.'+path);
    if(!relative(resolve(dist),target)||
       relative(resolve(dist),target).startsWith('..'+sep)){
      response.writeHead(404);response.end('DENIED');return;
    }
    try{
      const data=readFileSync(target);
      response.writeHead(200,{'content-type':
        mime[extname(target)]??'application/octet-stream'});
      response.end(data);
    }catch{
      response.writeHead(404);response.end('MISSING');
    }
  });
  await new Promise((ok,bad)=>{server.once('error',bad);
    server.listen(18883,'127.0.0.1',ok);});
  browser=await chromium.launchPersistentContext(join(dir,'browser-profile'),{
    headless:true,serviceWorkers:'block'});
  const page=browser.pages()[0]??await browser.newPage();
  await page.goto(origin+'/__original_agent_product_kernel__');
  await page.waitForFunction(()=>typeof window.IWXA?.connect==='function');
  const connected=await page.evaluate(async service_id=>{
    const kernel=await window.IWXA.connect({service_id});
    return {contract:kernel.contract_version,
      granted:kernel.granted_operations};
  },serviceId);
  assert.equal(connected.contract,'1.3.0');
  assert.ok(connected.granted.includes('t1.commitObjectGraph'));
  console.log('AGENT06_ORIGINAL_PRODUCT_T2_KERNEL_0_3_6_RUNTIME_1_3_PASS');
  console.log('AGENT06_ONE_DIST_OWN_PRODUCT_ORIGINAL_RECEIPT_PASS');
}finally{
  if(browser)await browser.close().catch(()=>{});
  if(server){
    server.closeAllConnections();
    if(server.listening)await new Promise(ok=>server.close(()=>ok()));
  }
  rmSync(dir,{recursive:true,force:true});
}
