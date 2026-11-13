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
let origin='',installed=false,syntheticOwner=false;
const scopedWorkspace='t3-d1-selected-'+randomUUID();
const eventStreams=new Set();
const mockContext=Object.freeze({
  kind:'CORP',context_id:'context:d1-local',actor_id:'actor:local',
  principal_id:'org:d1-local',role_id:'role:local',grant_id:'grant:d1-read',
  realm_id:'realm:d1-local',audience:'local:t3',resource:scopedWorkspace,
  purpose:'workspace.read',workspace_id:scopedWorkspace,
  organization_id:'org:d1-local',scope_revision:1,
});
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
      if(!syntheticOwner)return send(503,{error:'CONTROL_INVALIDATION_UNAVAILABLE'});
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8',
        'Cache-Control':'no-store','Connection':'keep-alive'});
      eventStreams.add(res);
      res.once('close',()=>eventStreams.delete(res));
      res.write('event: ready\\ndata: {}\\n\\n'.replace(/\\n/g,'\n'));
      return;
    }
    if(path==='/api/t3/context-epoch'&&syntheticOwner){
      if(req.headers.authorization!=='Bearer '+token)
        return send(401,{error:'CONTROL_SESSION_REQUIRED'});
      return send(200,{contextEpoch:0});
    }
    if(path==='/api/t3/owner'&&syntheticOwner){
      if(req.method!=='POST'||req.headers.origin!==origin ||
          req.headers.authorization!=='Bearer '+token ||
          req.headers['x-iwxa-context-epoch']!=='0')
        return send(403,{error:'SYNTHETIC_OWNER_REQUEST_DENIED'});
      const chunks=[];
      req.on('data',chunk=>chunks.push(chunk));
      req.on('end',()=>{
        try{
          const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if(input?.scope!=='kernel'||input?.operation!=='getWorkspace')
            return send(403,{error:'SYNTHETIC_OWNER_SCOPE_DENIED'});
          if(input.verb==='select')
            return send(200,{available:true,contextEpoch:0});
          if(input.verb==='context')return send(200,{context:mockContext});
          if(input.verb==='action'){
            if(input.kernelOperation!=='t1.getWorkspace')
              return send(403,{error:'SYNTHETIC_OWNER_OPERATION_DENIED'});
            return send(200,{action:'workspace.read'});
          }
          if(input.verb==='digest')
            return send(200,{digest:hash(Buffer.from(JSON.stringify(input.command)))});
          if(input.verb==='authorize'){
            const request=input.request;
            return send(200,{decision:{
              schema:'IWXA_T3_ORGANIZATION_OPERATION_DECISION/1',
              allowed:true,outcome:'PERMITTED',evidenceOnly:true,
              requestDigest:hash(Buffer.from(JSON.stringify(request))),
              policyDigest:hash(Buffer.from('SYNTHETIC_POLICY_ONLY')),
              operationDigest:request.operationDigest,
              evidenceDigest:hash(Buffer.from('SYNTHETIC_EVIDENCE_ONLY')),
              organizationId:mockContext.organization_id,
              workspaceId:scopedWorkspace,grantId:mockContext.grant_id,
              statusSequence:0,
              validUntil:new Date(Date.now()+600000).toISOString(),
              productionActivation:false,doesNotTransferData:true,
              doesNotAcceptCorporateCopy:true,
            }});
          }
          return send(400,{error:'SYNTHETIC_OWNER_VERB_INVALID'});
        }catch{
          return send(400,{error:'SYNTHETIC_OWNER_REQUEST_INVALID'});
        }
      });
      return;
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
  assert.equal(assembled.original_qualified_artifact,
    'iwxa-kernel-k036-same-store-history-20261019-qualified.1');
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
  assert.equal(await signed.evaluate(()=>typeof globalThis.IWXA),'undefined',
    'T3_D1_CONTROL_ABSENT_MUST_NOT_BOOT_RAW_T2_KERNEL');
  // Functional signed onboarding through the compiled SAME React Host and
  // original T2 Store. This is a test-only synthetic authorization response:
  // it does NOT qualify the private Ed25519 issuer or enrollment.
  syntheticOwner=true;
  const selected=await browser.context.newPage();
  const selectedErrors=[];
  selected.on('pageerror',err=>selectedErrors.push(err.message));
  await selected.goto(origin+'/workspace/signed-workspace.html#'+token);
  const missing=selected.getByTestId('t3-d1-selected-workspace-message');
  await missing.waitFor({state:'visible',timeout:60000});
  assert.match(await missing.innerText(),/ещё нет рабочей области/,
    'T3_D1_SIGNED_FIRST_RUN_MUST_EXPLAIN_MISSING_ORIGINAL_WORKSPACE');
  assert.equal(new URL(selected.url()).hash,'');
  await browser.page.evaluate(async({serviceId,workspace_id})=>{
    const kernel=await globalThis.IWXA.connect({service_id:serviceId});
    return kernel.t1.createWorkspace({workspace_id,profile:'generic'});
  },{serviceId,workspace_id:scopedWorkspace});
  await selected.getByRole('button',{name:'Проверить повторно'}).click();
  await selected.getByTestId('t3-d1-selected-workspace-gate')
    .waitFor({state:'detached',timeout:30000});
  assert.deepEqual(selectedErrors,[]);
  console.log('T3_D1_SYNTHETIC_SIGNED_SELECTED_WORKSPACE_PASS',JSON.stringify({
    compiledSignedHost:true,originalKernel:'0.3.6',createdOriginalWorkspace:true,
    missingWorkspaceExplained:true,explicitRetryReadback:true,
    syntheticOwnerOnly:true,authenticPrivateSignerExecuted:false,
  }));

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
