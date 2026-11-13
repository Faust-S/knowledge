// Actual compiled signed Workspace + genuine qualified T2 0.3.6 Kernel over
// the HTTP loopback origin supported by the original Control. No private
// signer or mock Kernel is loaded; inability to contact Control must be
// visible and must never silently mount unsigned Workspace.
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,extname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {assembleSignedControlDist} from '../scripts/assemble-signed-control-dist.mjs';
import {materializeIntegrationHost} from '../scripts/real-kernel-e2e.mjs';
import {assertQualifiedKernelArtifact}
  from '../src/factory2/products/domain-completion/independent-browser-witness.mjs';

const core=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const qualified=process.env.IWXA_T2_QUALIFIED_KERNEL_DIST;
assert.ok(qualified && existsSync(join(qualified,'_iwxa/runtime/0.3.6/runtime.js')),
  'T3_D1_ORIGINAL_QUALIFIED_T2_REQUIRED');
assert.ok(existsSync(join(core,'dist/signed-workspace.html')),
  'T3_D1_COMPILED_SIGNED_ENTRY_REQUIRED');
const root=mkdtempSync(join(tmpdir(),'t3-d1-actual-dist-'));
const source=join(root,'original-t2-dist');
const output=join(root,'one-dist');
const profile=join(root,'browser-profile');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const serviceId='iwxa.workspace.integration';
const token=randomBytes(32).toString('base64url');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8',
  '.css':'text/css; charset=utf-8','.svg':'image/svg+xml',
  '.wasm':'application/wasm','.ico':'image/x-icon','.png':'image/png',
  '.webp':'image/webp','.woff2':'font/woff2'};
const safeAssets=path=>path==='/workspace/signed-workspace.html'||
  path==='/workspace/workspace.config.json'||path==='/workspace/favicon.ico'||
  /^\/workspace\/assets\/[A-Za-z0-9_.\/-]+$/.test(path)||
  /^\/_iwxa\/[A-Za-z0-9_.\/-]+$/.test(path);
let origin='',installed=false;
const server=createServer((req,res)=>{
  const send=(status,body,type='application/json',workspace=false)=>{
    const csp=workspace
      ? "default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      : "default-src 'none'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'";
    res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff','Content-Security-Policy':csp});
    res.end(Buffer.isBuffer(body)?body:type==='application/json'?JSON.stringify(body):body);
  };
  try{
    if(req.headers.host!==new URL(origin).host)return send(403,{error:'HOST_DENIED'});
    const path=new URL(req.url,origin).pathname;
    // This test-only probe is not part of Control or the installed product.
    if(path==='/__original_kernel_probe__')
      return send(200,'<!doctype html><title>Original Kernel probe</title>'+
        '<script src="/_iwxa/loader.js"></script>','text/html',true);
    if(path==='/api/t3/owner-events'){
      if(req.headers.authorization!=='Bearer '+token)
        return send(401,{error:'CONTROL_SESSION_REQUIRED'});
      return send(503,{error:'CONTROL_INVALIDATION_UNAVAILABLE'});
    }
    if(path.startsWith('/api/'))return send(503,{error:'CONTROL_OWNER_UNAVAILABLE'});
    if(!installed||!safeAssets(path)||path.includes('..')||path.includes('/.')||
       path.endsWith('.map'))return send(404,{error:'NOT_FOUND'});
    const target=resolve(output,'.'+path);
    if(!target.startsWith(output+sep))return send(404,{error:'NOT_FOUND'});
    if(!existsSync(target))return send(404,{error:'NOT_FOUND'});
    const type=mime[extname(target).toLowerCase()];
    if(!type)return send(404,{error:'NOT_FOUND'});
    return send(200,readFileSync(target),type,true);
  }catch(error){
    if(!res.headersSent)send(500,{error:'TEST_SERVER_FAILED',detail:String(error)});
  }
});
let browser=null;
const launch=async()=>{
  const context=await chromium.launchPersistentContext(profile,{
    headless:true,serviceWorkers:'block',
  });
  return {context,page:context.pages()[0]||await context.newPage()};
};
try{
  await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
  origin='http://127.0.0.1:'+server.address().port;
  mkdirSync(join(source,'workspace/assets'),{recursive:true});
  cpSync(join(qualified,'_iwxa'),join(source,'_iwxa'),{recursive:true});
  assertQualifiedKernelArtifact(source,{kernel:'0.3.6',contract:'1.3.0',
    artifactId:'iwxa-kernel-k036-same-store-history-20261019-qualified.1'});
  const host=materializeIntegrationHost(source,origin);
  host.domain.runtime.kernel_release='0.3.6';
  host.domain.runtime.runtime_version='0.3.6';
  host.workspaceConfig.host.required_runtime_version='0.3.6';
  host.workspaceConfig.host.required_contract_version='1.3.0';
  writeFileSync(join(source,'_iwxa/domain.json'),JSON.stringify(host.domain));
  writeFileSync(join(source,'workspace/workspace.config.json'),
    JSON.stringify(host.workspaceConfig));
  const passportPath='_iwxa/services/'+serviceId+'.json';
  const passportBytes=Buffer.from(JSON.stringify(host.passport));
  writeFileSync(join(source,passportPath),passportBytes);
  writeFileSync(join(source,'_iwxa/service-catalog.json'),JSON.stringify({
    count:1,entries:[{service_id:serviceId,service_version:host.passport.service_version,
      base_path:host.passport.base_path,supported_levels:host.passport.supported_levels,
      file:passportPath,sha256:hash(passportBytes)}],
  }));
  writeFileSync(join(source,'workspace/index.html'),
    '<!doctype html><title>Original T2 Workspace source</title>');
  cpSync(join(core,'public/favicon.ico'),join(source,'workspace/favicon.ico'));

  const assembled=assembleSignedControlDist({
    t2Dist:source,t3Build:join(core,'dist'),outputDir:output,
  });
  assert.equal(assembled.original_runtime_unchanged,true);
  assert.equal(assembled.origin,origin);
  assert.equal(hash(readFileSync(join(source,'_iwxa/runtime/0.3.6/runtime.js'))),
    hash(readFileSync(join(output,'_iwxa/runtime/0.3.6/runtime.js'))));
  assert.equal(readFileSync(join(output,'workspace/index.html'),'utf8'),
    '<!doctype html><title>Original T2 Workspace source</title>');
  installed=true;

  browser=await launch();
  const workspace='t3-d1-original-'+randomUUID(),object='t3-d1-object';
  await browser.page.goto(origin+'/__original_kernel_probe__');
  await browser.page.waitForFunction(()=>typeof globalThis.IWXA?.connect==='function');
  const first=await browser.page.evaluate(async({serviceId,workspace,object})=>{
    const session=await globalThis.IWXA.connect({service_id:serviceId});
    if(session.contract_version!=='1.3.0'||session.runtime_version!=='0.3.6')
      throw Error('T3_D1_WRONG_ORIGINAL_KERNEL');
    await session.t1.createWorkspace({workspace_id:workspace,profile:'generic'});
    const written=await session.t1.putObject({
      workspace_id:workspace,object_id:object,schema_id:'iwxa.demo.note',
      schema_version:'1.0.0',base_revision:0,
      data:{title:'Real original T2 one-dist'},extensions:{},
      event:{event_type:'t3.d1.original.created',payload:{}},
    });
    return {event:written.event.event_id,revision:written.object.revision,
      secure:window.isSecureContext};
  },{serviceId,workspace,object});
  assert.equal(first.secure,true);
  assert.equal(first.revision,1);
  assert.ok(first.event);
  await browser.context.close();browser=null;

  browser=await launch();
  await browser.page.goto(origin+'/__original_kernel_probe__');
  await browser.page.waitForFunction(()=>typeof globalThis.IWXA?.connect==='function');
  const cold=await browser.page.evaluate(async({serviceId,workspace,object})=>{
    const session=await globalThis.IWXA.connect({service_id:serviceId});
    const record=await session.t1.getObject(workspace,object);
    const events=await session.t1.listEventsSince(workspace);
    return {title:record?.object?.data?.title,revision:record?.object?.revision,
      eventPresent:events.some(e=>e.event_id===record?.event?.event_id),
      events:events.map(e=>e.event_id)};
  },{serviceId,workspace,object});
  assert.equal(cold.title,'Real original T2 one-dist');
  assert.equal(cold.revision,1);
  assert.ok(cold.events.includes(first.event));
  // Raw T2 original service is deliberately only exercised by the isolated
  // probe page. It does NOT establish corporate signed authority.
  const denied=await browser.context.newPage();
  await denied.goto(origin+'/workspace/signed-workspace.html');
  await denied.waitForFunction(()=>
    document.querySelector('#root')?.textContent?.includes('Не удалось подключить'),
    null,{timeout:25000});
  assert.equal(new URL(denied.url()).hash,'');
  const signed=await browser.context.newPage();
  const pageErrors=[];
  signed.on('pageerror',err=>pageErrors.push(err.message));
  await signed.goto(origin+'/workspace/signed-workspace.html#'+token);
  await signed.getByTestId('t3-signed-control-reconnect').waitFor({
    state:'visible',timeout:60000,
  });
  assert.equal(new URL(signed.url()).hash,'',
    'signed Control bearer must be erased before any Workspace module imports');
  assert.match(await signed.getByTestId('t3-signed-control-reconnect').innerText(),
    /Откройте Workspace.*повторно/i);
  assert.deepEqual(pageErrors,[]);
  console.log('T3_D1_ACTUAL_ONE_DIST_ORIGINAL_HTTP_PASS',JSON.stringify({
    originalKernel:'0.3.6',runtimeContract:'1.3.0',
    originalLoaderSha256:assembled.original_loader_sha256,
    originalRuntimeSha256:assembled.original_runtime_sha256,
    signedAssets:assembled.signed_assets,
    coldOriginalReadback:true,signedEntryCompiled:true,
    bearerFragmentErased:true,controlAbsentDeniesMountedWorkspace:true,
    authenticPrivateIssuerExecuted:false,
  }));
}finally{
  if(browser)await browser.context.close().catch(()=>{});
  server.closeAllConnections();
  await new Promise(resolve=>server.close(()=>resolve()));
  rmSync(root,{recursive:true,force:true});
}
