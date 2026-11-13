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
for(const entry of ['isolated-signed-workspace.html','trusted-kernel-realm.html'])
  assert.ok(existsSync(join(core,'dist',entry)),
    'T3_D1_COMPILED_ISOLATED_ENTRY_REQUIRED_'+entry);
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
let origin='',uiOrigin='',installed=false,syntheticOwner=false;
const scopedWorkspace='t3-d1-selected-'+randomUUID();
const eventStreams=new Set();
const eventStreamSources=new Map();
const mockContext=Object.freeze({
  kind:'CORP',context_id:'context:d1-local',actor_id:'actor:local',
  principal_id:'org:d1-local',role_id:'role:local',grant_id:'grant:d1-read',
  realm_id:'realm:d1-local',audience:'local:t3',resource:scopedWorkspace,
  purpose:'workspace.read',workspace_id:scopedWorkspace,
  organization_id:'org:d1-local',scope_revision:1,
});
const mockCreateContext=Object.freeze({
  ...mockContext,grant_id:'grant:d1-create',purpose:'workspace.onboarding',
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
    // Compiled trusted T3 realm: original Control SSE/JIT and original T2
    // loader execute at the pinned kernel origin, not the domain UI origin.
    if(path==='/workspace/t3-kernel-realm.json')
      return send(200,{schema:'IWXA_T3_TRUSTED_KERNEL_REALM/1',
        ui_origin:uiOrigin,service_id:serviceId});
    if(path==='/workspace/trusted-kernel-realm.html'){
      const html=readFileSync(join(output,'workspace/trusted-kernel-realm.html'));
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',
        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors "+uiOrigin});
      res.end(html);return;
    }
    // Test-only trusted original Kernel realm. The real T2 loader and Store
    // remain on their original pinned origin. No application modules are
    // served here; a different UI origin receives only a signed MessagePort.
    if(path==='/__isolated_transport__.mjs')
      return send(200,readFileSync(join(core,'src/t3/origin-isolated-kernel-transport.mjs')),
        'text/javascript; charset=utf-8',true);
    if(path==='/__trusted_kernel_realm__.html'){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',
        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'self'; frame-ancestors "+uiOrigin});
      res.end('<!doctype html><title>Trusted original T2 Kernel realm</title>'+
        '<script src="/_iwxa/loader.js"></script>'+
        '<script type="module" src="/__trusted_kernel_realm__.mjs"></script>');
      return;
    }
    if(path==='/__trusted_kernel_realm__.mjs'){
      const trustedSource=[
        "import {acceptOriginalKernelRealmChannel} from '/__isolated_transport__.mjs';",
        "const selected="+JSON.stringify(scopedWorkspace)+";",
        "const allowed=ws=>{if(ws!==selected){const e=new Error('out of selected scope');e.code='T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE';throw e;}};",
        "let realm=null;",
        "window.addEventListener('message',event=>{",
        " if(realm)return;",
        " realm=acceptOriginalKernelRealmChannel({event,uiOrigin:"+JSON.stringify(uiOrigin)+",parentWindow:window.parent,",
        "  isActive:()=>true,",
        "  describeOriginalSession:async()=>{",
        "   const original=await window.IWXA.connect({service_id:"+JSON.stringify(serviceId)+"});",
        "   return {contract_version:original.contract_version,runtime_version:original.runtime_version,",
        "    service:{...original.service},mode:original.mode,",
        "    granted_levels:[...original.granted_levels],granted_operations:[...original.granted_operations]};",
        "  },",
        "  validateOriginalObjects:async(input)=>{",
        "   const original=await window.IWXA.connect({service_id:"+JSON.stringify(serviceId)+"});",
        "   return original.t0.validate(input);",
        "  },",
        "  createSignedFacade:async()=>{",
        "   const original=await window.IWXA.connect({service_id:"+JSON.stringify(serviceId)+"});",
        "   return Object.freeze({",
        "    async getWorkspace(id){allowed(id);return original.t1.getWorkspace(id);},",
        "    async getObject(ws,id){allowed(ws);return original.t1.getObject(ws,id);},",
        "    async listWorkspaces(){const row=await original.t1.getWorkspace(selected);return row?[row]:[];},",
        "    async authorizationForWorkspace(ws){allowed(ws);return original.authorization.forWorkspace(ws);},",
        "    async hasCapability(ws,cap){allowed(ws);return original.authorization.hasCapability(ws,cap);},",
        "    hasOperation(op){return original.granted_operations.includes(op);},",
        "    async putObject(cmd){allowed(cmd?.workspace_id);return original.t1.putObject(cmd);}",
        "   });",
        "  }",
        " });",
        "});",
      ].join('\n');
      return send(200,trustedSource,'text/javascript; charset=utf-8',true);
    }
    if(path==='/api/t3/owner-events'){
      if(req.headers.authorization!=='Bearer '+token)
        return send(401,{error:'CONTROL_SESSION_REQUIRED'});
      if(!syntheticOwner)return send(503,{error:'CONTROL_INVALIDATION_UNAVAILABLE'});
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8',
        'Cache-Control':'no-store','Connection':'keep-alive'});
      eventStreams.add(res);
      eventStreamSources.set(res,req.headers.referer??"NO_REFERRER");
      res.once('close',()=>{eventStreams.delete(res);eventStreamSources.delete(res);});
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
          if(input?.scope!=='kernel'||
             !['getWorkspace','createWorkspace'].includes(input.operation))
            return send(403,{error:'SYNTHETIC_OWNER_SCOPE_DENIED'});
          const createAction=input.operation==='createWorkspace';
          const selected=createAction?mockCreateContext:mockContext;
          if(input.verb==='select')
            return send(200,{available:true,contextEpoch:0});
          if(input.verb==='context')return send(200,{context:selected});
          if(input.verb==='action'){
            if(input.kernelOperation!==(createAction?'t1.createWorkspace':'t1.getWorkspace'))
              return send(403,{error:'SYNTHETIC_OWNER_OPERATION_DENIED'});
            return send(200,{action:createAction?'workspace.create':'workspace.read'});
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
              organizationId:selected.organization_id,
              workspaceId:scopedWorkspace,grantId:selected.grant_id,
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
const uiServer=createServer((req,res)=>{
  if(!uiOrigin||req.headers.host!==new URL(uiOrigin).host){
    res.writeHead(403);res.end();return;
  }
  const path=new URL(req.url,uiOrigin).pathname;
  // The inherited Workspace schema compiler still uses new Function().
  // Restrict eval to this signed, compiled UI origin. The original Control
  // UI/API and all raw Kernel paths remain completely unavailable here.
  const isolatedCsp="default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; worker-src 'self' blob:; frame-src "+origin+"; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  const uiSend=(status,body,type='application/json')=>{
    res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff','Content-Security-Policy':isolatedCsp});
    res.end(Buffer.isBuffer(body)?body:type==='application/json'?JSON.stringify(body):body);
  };
  if(path==='/workspace/t3-isolated-ui.json')
    return uiSend(200,{schema:'IWXA_T3_ISOLATED_WORKSPACE_UI/1',
      kernel_origin:origin,service_id:serviceId});
  if(path==='/workspace/isolated-signed-workspace.html')
    return uiSend(200,readFileSync(join(output,'workspace/isolated-signed-workspace.html')),
      'text/html; charset=utf-8');
  if(path==='/_iwxa/domain.json'||path==='/_iwxa/domain-shell.json'){
    const document=JSON.parse(readFileSync(join(output,'.'+path),'utf8'));
    document.origin=uiOrigin;
    if(document.domain?.origin)document.domain.origin=uiOrigin;
    if(document.runtime?.origin)document.runtime.origin=uiOrigin;
    return uiSend(200,document);
  }
  if(path==='/workspace/workspace.config.json')
    return uiSend(200,readFileSync(join(output,'workspace/workspace.config.json')),
      'application/json');
  if(path==='/workspace/favicon.ico')
    return uiSend(200,readFileSync(join(output,'workspace/favicon.ico')),
      'image/x-icon');
  if(/^\/workspace\/assets\/[A-Za-z0-9_.\/-]+$/.test(path)&&
     !path.includes('..')&&!path.includes('/.')&&!path.endsWith('.map')){
    const target=resolve(output,'.'+path);
    if(target.startsWith(output+sep)&&existsSync(target)){
      const type=mime[extname(target).toLowerCase()];
      if(type)return uiSend(200,readFileSync(target),type);
    }
  }
  if(path==='/__isolated_transport__.mjs'){
    res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8',
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(readFileSync(join(core,'src/t3/origin-isolated-kernel-transport.mjs')));
    return;
  }
  if(path==='/__isolated_kernel_bootstrap__.mjs'){
    res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8',
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(readFileSync(join(core,'src/t3/origin-isolated-kernel-bootstrap.mjs')));
    return;
  }
  if(path==='/__isolated_ui__.html'){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end('<!doctype html><title>Isolated T3 UI origin</title><main id="app"></main>');
    return;
  }
  res.writeHead(404,{'Content-Type':'text/plain'});res.end('NOT_FOUND');
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
  await new Promise((ok,bad)=>{uiServer.once('error',bad);uiServer.listen(0,'127.0.0.1',ok);});
  uiOrigin='http://127.0.0.1:'+uiServer.address().port;
  assert.notEqual(uiOrigin,origin,'T3_D1_ISOLATED_UI_MUST_USE_DISTINCT_ORIGIN');
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
  assert.match(await missing.innerText(),/пока нет рабочей области/,
    'T3_D1_SIGNED_FIRST_RUN_MUST_EXPLAIN_MISSING_ORIGINAL_WORKSPACE');
  assert.equal(new URL(selected.url()).hash,'');
  await selected.getByTestId('t3-d1-create-selected-workspace').click();
  await selected.getByTestId('t3-d1-selected-workspace-gate')
    .waitFor({state:'detached',timeout:30000});
  // Independently read the workspace from the original Kernel on a
  // separate probe page. That page does NOT create the Workspace.
  const created=await browser.page.evaluate(async({serviceId,workspace_id})=>{
    const kernel=await globalThis.IWXA.connect({service_id:serviceId});
    return kernel.t1.getWorkspace(workspace_id);
  },{serviceId,workspace_id:scopedWorkspace});
  assert.equal(created?.workspace_id,scopedWorkspace);
  assert.equal(created?.profile,'generic');
  assert.deepEqual(selectedErrors,[]);

  // Adversarial D1 witness, NOT a permitted Host operation. The original T2
  // bootstrap is global in the same browser origin as the signed Workspace.
  // Probe another organization's stored object via RAW window.IWXA.connect,
  // without touching the signed KernelFacade. Log any bypass as a release
  // blocker; a green UI regression alone must never imply native enforcement.
  const boundary=await selected.evaluate(async ({serviceId,workspace,object})=>{
    const exposed=typeof globalThis.IWXA?.connect==='function';
    if(!exposed)return {rawConnectExposed:false,foreignReadPossible:false};
    try{
      const raw=await globalThis.IWXA.connect({service_id:serviceId});
      const foreign=await raw.t1.getObject(workspace,object);
      return {
        rawConnectExposed:true,
        foreignReadPossible:foreign?.object?.data?.title==='Real original T2 one-dist',
        foreignObjectId:foreign?.object?.object_id??null,
      };
    }catch{
      return {rawConnectExposed:true,foreignReadPossible:false};
    }
  },{serviceId,workspace,object});
  if(boundary.foreignReadPossible){
    assert.equal(boundary.foreignObjectId,object);
    console.log('T3_D1_RAW_ORIGINAL_KERNEL_BYPASS_CONFIRMED_NOT_ACCEPTED',JSON.stringify({
      signedHostMounted:true,rawConnectExposed:boundary.rawConnectExposed,
      foreignSignedWorkspaceReadWithoutGrant:true,
      nativeStoreBoundaryQualified:false,
      originalKernelVersion:'0.3.6',
    }));
  }else{
    console.log('T3_D1_RAW_ORIGINAL_KERNEL_BYPASS_NOT_REPRODUCED',JSON.stringify({
      signedHostMounted:true,rawConnectExposed:boundary.rawConnectExposed,
      foreignSignedWorkspaceReadWithoutGrant:false,
      nativeStoreBoundaryQualified:false,
    }));
  }
  console.log('T3_D1_SYNTHETIC_SIGNED_CREATE_WORKSPACE_PASS',JSON.stringify({
    compiledSignedHost:true,originalKernel:'0.3.6',
    createdViaSignedKernelFacade:true,independentOriginalKernelReadback:true,
    missingWorkspaceExplained:true,explicitUserAction:true,
    syntheticOwnerOnly:true,authenticPrivateSignerExecuted:false,
  }));

  // Real cross-origin boundary proof, using the SAME original T2 Kernel and
  // Store. The scoped executor inside the trusted realm is synthetic in this
  // public CI; the real private issuer and native Store gate are NOT accepted.
  const isolated=await browser.context.newPage();
  const isolatedErrors=[];
  isolated.on('pageerror',error=>isolatedErrors.push(error.message));
  await isolated.goto(uiOrigin+'/__isolated_ui__.html');
  const isolatedProof=await isolated.evaluate(async({
    kernelOrigin,selectedId,foreignWorkspace,serviceId,
  })=>{
    const noRawInUi=typeof globalThis.IWXA==='undefined';
    const loaderResponse=await fetch('/_iwxa/loader.js',{cache:'no-store'});
    const noLoaderInUi=loaderResponse.status===404;
    const frame=document.createElement('iframe');
    frame.src=kernelOrigin+'/__trusted_kernel_realm__.html';
    document.body.append(frame);
    await new Promise((resolve,reject)=>{
      frame.onload=resolve;
      frame.onerror=()=>reject(new Error('TRUSTED_KERNEL_FRAME_FAILED'));
    });
    let foreignGlobalVisible=false;
    try{foreignGlobalVisible=typeof frame.contentWindow.IWXA!=='undefined';}
    catch{/* Standard browser same-origin policy blocks the read. */}
    const transport=await import('/__isolated_transport__.mjs');
    const client=await transport.openOriginalKernelRealm({
      frame:frame.contentWindow,realmOrigin:kernelOrigin,
      channelFactory:()=>new MessageChannel(),
    });
    try{
      const own=await client.invoke('getWorkspace',selectedId);
      const kernelModule=await import('/__isolated_kernel_bootstrap__.mjs');
      const bootstrap=kernelModule.createIsolatedOriginalKernelBootstrap({
        client,serviceId,
      });
      const originalApi=await bootstrap.connect({service_id:serviceId});
      const throughT1=await originalApi.t1.getWorkspace(selectedId);
      const t0=await originalApi.t0.validate({objects:[]});
      const contractFromOriginal=originalApi.contract_version==='1.3.0'&&
        originalApi.runtime_version==='0.3.6'&&
        originalApi.granted_operations.includes('t1.getWorkspace');
      const originalT1Facade=throughT1?.workspace_id===selectedId&&
        t0?.tier==='t0';
      const originalT2Surface=typeof originalApi.t2.importCommit==='function'&&
        typeof originalApi.authorization.forWorkspace==='function';
      let crossReadDenied=false,crossWriteDenied=false,constructorDenied=false;
      try{await client.invoke('getWorkspace',foreignWorkspace);}
      catch(e){crossReadDenied=e.code==='T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE';}
      try{await client.invoke('putObject',{workspace_id:foreignWorkspace,object_id:'foreign'});}
      catch(e){crossWriteDenied=e.code==='T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE';}
      try{await client.invoke('constructor');}
      catch(e){constructorDenied=e.code==='T3_D1_ORIGINAL_KERNEL_METHOD_FORBIDDEN';}
      const written=await client.invoke('putObject',{
        workspace_id:selectedId,object_id:'item:isolated-bridge',
        schema_id:'iwxa.demo.note',schema_version:'1.0.0',base_revision:0,
        data:{title:'Original Kernel through isolated signed transport'},
        extensions:{},event:{event_type:'t3.d1.isolated.created',payload:{}},
      });
      return {
        noRawInUi,noLoaderInUi,foreignGlobalVisible,
        crossReadDenied,crossWriteDenied,constructorDenied,
        selectedRead:own?.workspace_id===selectedId,
        selectedWrite:written?.object?.workspace_id===selectedId,
        contractFromOriginal,originalT1Facade,originalT2Surface,
      };
    }finally{client.close();}
  },{kernelOrigin:origin,selectedId:scopedWorkspace,
     foreignWorkspace:workspace,serviceId});
  assert.deepEqual(isolatedErrors,[]);
  assert.deepEqual(isolatedProof,{
    noRawInUi:true,noLoaderInUi:true,foreignGlobalVisible:false,
    crossReadDenied:true,crossWriteDenied:true,constructorDenied:true,
    selectedRead:true,selectedWrite:true,
    contractFromOriginal:true,originalT1Facade:true,originalT2Surface:true,
  });
  const isolatedReadback=await browser.page.evaluate(async({serviceId,selectedId})=>{
    const original=await globalThis.IWXA.connect({service_id:serviceId});
    return original.t1.getObject(selectedId,'item:isolated-bridge');
  },{serviceId,selectedId:scopedWorkspace});
  assert.equal(isolatedReadback?.object?.data?.title,
    'Original Kernel through isolated signed transport');
  console.log('T3_D1_TWO_ORIGIN_ORIGINAL_KERNEL_BRIDGE_PASS',JSON.stringify({
    twoDifferentLoopbackOrigins:true,uiCannotLoadOrReadRawKernel:true,
    foreignWorkspaceReadDenied:true,foreignWorkspaceWriteDenied:true,
    inheritedT2ContractPreserved:true,originalKernelReadback:true,syntheticOwnerOnly:true,
    privateSignerExecuted:false,nativeStoreBoundaryIntegrated:false,
  }));
  // FULL compiled React AppShell, not just the transport-demo page.
  // It renders on a different origin and imports no original T2 loader.
  const isolatedApp=await browser.context.newPage();
  const isolatedAppErrors=[];
  isolatedApp.on('pageerror',error=>isolatedAppErrors.push(error.message));
  await isolatedApp.goto(uiOrigin+'/workspace/isolated-signed-workspace.html#'+token);
  // Detached alone is a false positive if React never mounted: prove the
  // actual inherited AppShell rendered and read its selected original Kernel
  // Workspace before declaring a compiled two-origin product PASS.
  const compiledState=()=>isolatedApp.evaluate(()=>({
    shell:!!document.querySelector('[data-t2-ui="workspace"]'),
    selectedGate:!!document.querySelector('[data-testid="t3-d1-selected-workspace-gate"]'),
    reconnect:!!document.querySelector('[data-testid="t3-isolated-control-reconnect"]'),
    errorCode:document.querySelector('#root')?.getAttribute('data-t3-error-code'),
    errorStage:document.querySelector('#root')?.getAttribute('data-t3-error-stage'),
    errorName:document.querySelector('#root')?.getAttribute('data-t3-error-name'),
    runtimeError:!!document.querySelector('[data-t2-ui="product-error"]'),
    rootText:document.querySelector('#root')?.textContent?.slice(0,400)??'',
    iframeCount:document.querySelectorAll('iframe').length,
  }));
  try{
    await isolatedApp.waitForFunction(()=>(
      !!document.querySelector('[data-testid="t3-isolated-control-reconnect"]')||
      (!!document.querySelector('[data-t2-ui="workspace"]')&&
      !document.querySelector('[data-testid="t3-d1-selected-workspace-gate"]')&&
      !document.querySelector('[data-t2-ui="product-error"]'))
    ),null,{timeout:30000});
    const observed=await compiledState();
    if(observed.reconnect)throw Error("T3_D1_COMPILED_REALM_BOOT_DENIED_"+observed.errorStage+"_"+observed.errorName);
  }catch(error){
    console.log('T3_D1_COMPILED_HOST_NOT_READY',JSON.stringify({
      app:await compiledState(),pageErrors:isolatedAppErrors,
      activeSse:Array.from(eventStreamSources.values()),
    }));
    throw error;
  }
  assert.equal(new URL(isolatedApp.url()).hash,'',
    'T3_D1_ISOLATED_UI_BEARER_MUST_BE_ERASED');
  assert.equal(await isolatedApp.evaluate(()=>typeof window.IWXA),'undefined',
    'T3_D1_ISOLATED_APP_MUST_NOT_EXPOSE_RAW_T2_KERNEL');
  assert.equal((await isolatedApp.evaluate(async()=>(
    await fetch('/_iwxa/loader.js',{cache:'no-store'})
  ).status)),404,'T3_D1_ISOLATED_UI_MUST_NEVER_SERVE_RAW_T2_LOADER');
  assert.equal(await isolatedApp.locator('iframe').count(),1,
    'T3_D1_ORIGINAL_TRUSTED_IFRAME_REQUIRED');
  assert.deepEqual(isolatedAppErrors,[]);
  console.log('T3_D1_COMPILED_ISOLATED_SIGNED_WORKSPACE_PASS',JSON.stringify({
    fullOriginalAppShell:true,differentLoopbackOrigins:true,
    originalKernelLoadedOnlyInTrustedRealm:true,
    selectedWorkspaceReadback:true,bearerErased:true,
    syntheticOwnerOnly:true,privateSignerExecuted:false,
  }));
  // Genuine browser-level SSE invalidation from the existing Control must
  // disconnect the UI's only signed realm port and unmount old module access.
  // No React fallback is permitted through the same-origin raw T2 loader.
  assert.ok(eventStreams.size>=1,'T3_D1_TRUSTED_CONTROL_SSE_REQUIRED');
  console.log('T3_D1_SSE_BEFORE_REVOCATION',JSON.stringify({
    app:await compiledState(),activeSse:Array.from(eventStreamSources.values()),
    sseCount:eventStreams.size,
  }));
  for(const stream of eventStreams){
    if(!stream.destroyed&&!stream.writableEnded)
      stream.write('event: invalidated\\ndata: {}\\n\\n'.replace(/\\n/g,'\n'));
  }
  try{
    await isolatedApp.getByTestId('t3-signed-control-reconnect')
      .waitFor({state:'visible',timeout:10000});
  }catch(error){
    console.log('T3_D1_SSE_AFTER_REVOCATION',JSON.stringify({
      app:await compiledState(),
      pageErrors:isolatedAppErrors,
      activeSse:Array.from(eventStreamSources.values()),
      sseCount:eventStreams.size,
    }));
    throw error;
  }
  assert.equal(await isolatedApp.evaluate(()=>typeof window.IWXA),'undefined');
  assert.equal((await isolatedApp.evaluate(async()=>(
    await fetch('/_iwxa/loader.js',{cache:'no-store'})
  ).status)),404);
  assert.deepEqual(isolatedAppErrors,[]);
  console.log('T3_D1_ISOLATED_REALM_SSE_REVOCATION_PASS',JSON.stringify({
    originalControlSse:true,oldAppShellInvalidated:true,
    rawKernelUnavailableInUi:true,signedPortClosed:true,
    syntheticOwnerOnly:true,
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
  uiServer.closeAllConnections();
  if(uiServer.listening)await new Promise(resolve=>uiServer.close(()=>resolve()));
  server.closeAllConnections();
  await new Promise(resolve=>server.close(()=>resolve()));
  rmSync(root,{recursive:true,force:true});
}
