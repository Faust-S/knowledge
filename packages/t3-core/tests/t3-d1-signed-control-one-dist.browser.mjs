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
import {createSubjectKernelBinding} from '../src/t3/subject-access-binding.mjs';
import {createTemporaryOriginalPersonalAuthority}
  from './support/t3-original-personal-authority.mjs';
import {createOriginalControlHttpHandler}
  from '../src/t3/original-control-http-handler.mjs';
import {createOriginalKernelRegistryStatePort,ORIGINAL_REGISTRY_SCHEMA}
  from '../src/t3/access/original-kernel-registry-state.mjs';
import {createOrganizationalOperationGate}
  from '../src/t3/access/organizational-operation.mjs';
import {createSignedAccessHostPort}
  from '../src/t3/signed-access-host-port.mjs';
import {digest,iso,signRecord} from '../src/t3/access/core.mjs';
import {emptyVault,importVaultKey,encryptVault}
  from '../src/t3/access/local-vault.mjs';
import {createOriginalVaultProofSigner}
  from '../src/t3/access/original-vault-proof.mjs';
import {materializeIntegrationHost} from '../scripts/real-kernel-e2e.mjs';
import {assertQualifiedKernelArtifact}
  from '../src/factory2/products/domain-completion/independent-browser-witness.mjs';

const core=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const requireHardware=process.env.T3_D1_D5_REQUIRE_HARDWARE_GPU==='1';
if(requireHardware&&process.platform!=='darwin')
  throw Error('T3_D1_D5_SIGNED_HARDWARE_PROFILE_REQUIRED');
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
let authenticHandler=null,authenticEpoch=1;
const authenticInvalidationListeners=new Set();
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
const mockWriteContext=Object.freeze({
  ...mockContext,grant_id:'grant:d1-write',purpose:'workspace.write',
});
const server=createServer(async(req,res)=>{
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
    // The trusted Host owns this single endpoint. For the final compiled
    // PERSONAL product route, use REAL Ed25519 Control, not the synthetic
    // earlier corporate fixture. No extra issuer/HTTP/Kernel server.
    if(authenticHandler){
      // The actual installed Host must dispatch EVERY path to its trusted
      // Control route before static HTML fallback. The handler itself
      // decides what it owns; otherwise unsigned Exchange/Lifecycle/Studio
      // entry points could bypass the isolated signed UI.
      const handled=await authenticHandler(req,res);
      if(handled)return;
    }
    // This test-only probe is not part of Control or the installed product.
    if(path==='/__original_kernel_probe__')
      return send(200,'<!doctype html><title>Original Kernel probe</title>'+
        '<script src="/_iwxa/loader.js"></script>','text/html',true);
    // The original Host pins both ends of the signed Workspace launch.
    if(path==='/workspace/t3-signed-ui.json')
      return send(200,{schema:'IWXA_T3_SIGNED_WORKSPACE_LAUNCH/1',
        kernel_origin:origin,ui_origin:uiOrigin,service_id:serviceId});
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
          if(input?.scope!=='kernel')
            return send(403,{error:'SYNTHETIC_OWNER_SCOPE_DENIED'});
          // Fixture-only rights reflect the independent original Control DATA
          // and ACTION grants. There is no real signer in this public test.
          const policy={
            getWorkspace:{context:mockContext,operation:'t1.getWorkspace',action:'workspace.read'},
            getObject:{context:mockContext,operation:'t1.getObject',action:'workspace.read'},
            listObjects:{context:mockContext,operation:'t1.listObjects',action:'workspace.read'},
            createWorkspace:{context:mockCreateContext,operation:'t1.createWorkspace',action:'workspace.create'},
            putObject:{context:mockWriteContext,operation:'t1.putObject',action:'workspace.write'},
          }[input.operation];
          if(!policy)return send(403,{error:'SYNTHETIC_OWNER_SCOPE_DENIED'});
          const selected=policy.context;
          if(input.verb==='select')
            return send(200,{available:true,contextEpoch:0});
          if(input.verb==='context')return send(200,{context:selected});
          if(input.verb==='action'){
            if(input.kernelOperation!==policy.operation)
              return send(403,{error:'SYNTHETIC_OWNER_OPERATION_DENIED'});
            return send(200,{action:policy.action});
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
// Public model URLs are the single pinned original BLI1/WebLLM 0.2.87
// profile. Only the exact compiled Worker receives this connect-src; the
// signed page, all other chunks and original Control stay same-origin.
const modelWorkerConnect=[
  'https://huggingface.co/mlc-ai/SmolLM2-360M-Instruct-q4f32_1-MLC/resolve/main/',
  'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_87/base/SmolLM2-360M-Instruct-q4f32_1_cs1k-webgpu.wasm',
  'https://cas-server.xethub.hf.co','https://cas-server.xethub-eu.hf.co',
  'https://transfer.xethub.hf.co','https://transfer.xethub-eu.hf.co',
  'https://cas-bridge.xethub.hf.co',
  'https://us.aws.cdn.hf.co','https://us.gcp.cdn.hf.co',
  'https://cdn-lfs-us-1.hf.co','https://cdn-lfs-eu-1.hf.co',
];
const uiServer=createServer((req,res)=>{
  if(!uiOrigin||req.headers.host!==new URL(uiOrigin).host){
    res.writeHead(403);res.end();return;
  }
  const path=new URL(req.url,uiOrigin).pathname;
  // The inherited Workspace schema compiler still uses new Function().
  // Restrict eval to this signed, compiled UI origin. The original Control
  // UI/API and all raw Kernel paths remain completely unavailable here.
  const isolatedCsp="default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; worker-src 'self' blob:; frame-src "+origin+"; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  const uiSend=(status,body,type='application/json',modelWorker=false)=>{
    const csp=modelWorker
      ?isolatedCsp.replace("connect-src 'self';",
        "connect-src 'self' "+modelWorkerConnect.join(' ')+";")
      :isolatedCsp;
    res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff','Content-Security-Policy':csp});
    res.end(Buffer.isBuffer(body)?body:type==='application/json'?JSON.stringify(body):body);
  };
  if(path==='/workspace/t3-isolated-ui.json')
    return uiSend(200,{schema:'IWXA_T3_ISOLATED_WORKSPACE_UI/1',
      kernel_origin:origin,service_id:serviceId});
  if(path==='/workspace/'||path==='/workspace/isolated-signed-workspace.html')
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
      if(type)return uiSend(200,readFileSync(target),type,
        /^\/workspace\/assets\/model-worker-[A-Za-z0-9_-]{6,96}\.js$/.test(path)&&
        type.startsWith('text/javascript'));
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
    ...(requireHardware?{channel:'chromium',
      args:['--enable-unsafe-webgpu','--ignore-certificate-errors']}:{})
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
  // The already ORIGINAL Kernel Store also persists signed corporate STATUS
  // through its existing Object/Event journal. No second database, service or
  // writer is included in the signed one-dist.
  host.domain.security.allowed_object_classes.push(ORIGINAL_REGISTRY_SCHEMA);
  host.passport.input_object_types.push(ORIGINAL_REGISTRY_SCHEMA);
  host.passport.output_object_types.push(ORIGINAL_REGISTRY_SCHEMA);
  host.passport.schemas[ORIGINAL_REGISTRY_SCHEMA]={
    schema_version:'1.0.0',preserve_unknown:true,
    json_schema:{type:'object'},embedded:{},
  };
  host.passport.permissions.objects.read.push(ORIGINAL_REGISTRY_SCHEMA);
  host.passport.permissions.objects.write.push(ORIGINAL_REGISTRY_SCHEMA);
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
  assert.equal(assembled.local_inference_registered,true,
    'T3_D1_D5_SIGNED_DIST_MUST_REGISTER_COMPILED_BLI');
  const installedBli=JSON.parse(readFileSync(
    join(output,'workspace/workspace.config.json'),'utf8'));
  assert.equal(installedBli.modules.filter(row=>
    row.module_id==='iwxa.t3.local-inference'&&row.state==='active').length,1);
  const assembledPassport=JSON.parse(readFileSync(
    join(output,'_iwxa/services/'+serviceId+'.json'),'utf8'));
  assert.ok(assembledPassport.schemas['iwxa.local-inference.draft']);
  const assembledCatalog=JSON.parse(readFileSync(
    join(output,'_iwxa/service-catalog.json'),'utf8'));
  assert.equal(assembledCatalog.entries.find(row=>row.service_id===serviceId).sha256,
    hash(readFileSync(join(output,'_iwxa/services/'+serviceId+'.json'))));
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
  // Real Ed25519 PERSONAL permission, authentic original T3 Access evaluator,
  // AND original T2 0.3.6 Kernel/Store in the same public CI. No second IAM,
  // no fake successful decision, no Control checkout or other repo. The
  // independent original Kernel probe only acts as the test's transport.
  const personalWs='t3-d1-personal-'+randomUUID();
  const personalId='local:ed25519';
  await browser.page.evaluate(async({serviceId,workspaceId})=>{
    const original=await window.IWXA.connect({service_id:serviceId});
    await original.t1.createWorkspace({workspace_id:workspaceId,profile:'generic'});
  },{serviceId,workspaceId:personalWs});
  const personalAccess=createTemporaryOriginalPersonalAuthority({
    workspaceId:personalWs,now:Date.now(),
  });
  let signedKernelWrites=0;
  const signedKernelBridge=Object.freeze({
    sessionInfo:{contract_version:'1.3.0',runtime_version:'0.3.6'},
    hasOperation:op=>op==='t1.putObject',
    async putObject(command){
      signedKernelWrites++;
      return browser.page.evaluate(async({serviceId,command})=>{
        const original=await window.IWXA.connect({service_id:serviceId});
        return original.t1.putObject(command);
      },{serviceId,command});
    },
  });
  const signedPersonal=createSubjectKernelBinding({
    kernel:signedKernelBridge,access:personalAccess.access,
  });
  const signedPersonalCommand=Object.freeze({
    workspace_id:personalWs,object_id:personalId,
    schema_id:'iwxa.local-inference.draft',schema_version:'1.0.0',
    base_revision:0,extensions:{},
    data:{status:'DRAFT_UNTRUSTED',
      text:'Original Ed25519 PERSONAL signed local T3 draft',
      model_id:'SmolLM2-360M-Instruct-q4f32_1-MLC',
      engine:'@mlc-ai/web-llm@0.2.87',
      origin:'BROWSER_LOCAL',source:'USER_EXPLICIT_SAVE',
      model_integrity:'NOT_ATTESTED'},
    event:{event_type:'t3.local-inference.draft.saved',
      payload:{source:'SIGNED_PERSONAL_NODE_HOST'}},
  });
  const signedReceipt=await signedPersonal.putObject(signedPersonalCommand);
  assert.equal(signedReceipt?.object?.workspace_id,personalWs);
  assert.equal(signedReceipt?.object?.revision,1);
  assert.equal(personalAccess.proofCount,1);
  assert.equal(personalAccess.registryReads,1);
  assert.equal(signedKernelWrites,1);

  // Cold browser restart: the signed result remains in the ONE original
  // Kernel Store, not an in-memory synthetic state or secondary registry.
  await browser.context.close();browser=null;
  browser=await launch();
  await browser.page.goto(origin+'/__original_kernel_probe__');
  await browser.page.waitForFunction(()=>typeof window.IWXA?.connect==='function');
  const personalCold=await browser.page.evaluate(async({serviceId,workspaceId,id})=>{
    const original=await window.IWXA.connect({service_id:serviceId});
    const result=await original.t1.getObject(workspaceId,id);
    const events=await original.t1.listEventsSince(workspaceId);
    return {object:result?.object,eventIds:events.map(e=>e.event_id)};
  },{serviceId,workspaceId:personalWs,id:personalId});
  assert.equal(personalCold.object?.data?.text,signedPersonalCommand.data.text);
  assert.equal(personalCold.object?.revision,1);
  assert.ok(personalCold.eventIds.includes(signedReceipt.event.event_id));

  // Existing signer revokes a grant via a newly signed STATUS (higher
  // sequence). The next write MUST stop before the original Kernel.
  personalAccess.revoke();
  await assert.rejects(signedPersonal.putObject({
    ...signedPersonalCommand,object_id:'local:after-revocation',
  }),{code:'T3_ACCESS_NOT_PERMITTED'});
  assert.equal(signedKernelWrites,1);
  console.log('T3_D1_REAL_ED25519_PERSONAL_ORIGINAL_KERNEL_COLD_PASS',JSON.stringify({
    realEd25519Grant:true,realSignedActorProof:true,
    realSignedStatus:true,originalKernel:'0.3.6',
    originalKernelColdReadback:true,revokedAfterCold:true,
    originalKernelWriteCount:signedKernelWrites,privateControlUsed:false,
    completeControlProductAccepted:false,
  }));
  // Protected launch: every unsigned compiled entry is denied on the
  // trusted Kernel origin, including alternate Exchange/Lifecycle/Studio.
  for(const path of ['/','/workspace/','/workspace/exchange/',
    '/workspace/lifecycle/','/workspace/studio/',
    '/workspace/isolated-signed-workspace.html']){
    const response=await browser.page.request.get(origin+path);
    assert.equal(response.status(),403,'unsigned signed-origin HTML must be blocked: '+path);
  }
  // No raw T2 Kernel or React AppShell may mount in that origin.
  const denied=await browser.context.newPage();
  await denied.goto(origin+'/workspace/signed-workspace.html');
  await denied.getByTestId('t3-signed-control-reconnect').waitFor({
    state:'visible',timeout:25000,
  });
  assert.equal(new URL(denied.url()).hash,'');
  assert.equal(await denied.evaluate(()=>typeof globalThis.IWXA),'undefined');

  const signed=await browser.context.newPage();
  const pageErrors=[];
  signed.on('pageerror',err=>pageErrors.push(err.message));
  await signed.goto(origin+'/workspace/signed-workspace.html#'+token);
  await signed.getByTestId('t3-isolated-control-reconnect').waitFor({
    state:'visible',timeout:60000,
  });
  assert.equal(new URL(signed.url()).origin,uiOrigin);
  assert.equal(new URL(signed.url()).hash,'#/overview');
  assert.deepEqual(pageErrors,[]);
  assert.equal(await signed.evaluate(()=>typeof globalThis.IWXA),'undefined',
    'failed Control cannot fall back to raw Kernel');

  // The canonical split-origin entry performs the SAME signed onboarding.
  // This fixture uses synthetic rights only until the later real Ed25519 run.
  syntheticOwner=true;
  const selected=await browser.context.newPage();
  const selectedErrors=[];
  selected.on('pageerror',err=>selectedErrors.push(err.message));
  await selected.goto(origin+'/workspace/signed-workspace.html#'+token);
  const missing=selected.getByTestId('t3-d1-selected-workspace-message');
  await missing.waitFor({state:'visible',timeout:60000});
  assert.equal(new URL(selected.url()).origin,uiOrigin);
  assert.match(await missing.innerText(),/пока нет рабочей области/,
    'T3_D1_SIGNED_FIRST_RUN_MUST_EXPLAIN_MISSING_ORIGINAL_WORKSPACE');
  assert.equal(new URL(selected.url()).hash,'#/overview');
  await selected.getByTestId('t3-d1-create-selected-workspace').click();
  await selected.getByTestId('t3-d1-selected-workspace-gate')
    .waitFor({state:'detached',timeout:30000});
  const created=await browser.page.evaluate(async({serviceId,workspace_id})=>{
    const kernel=await globalThis.IWXA.connect({service_id:serviceId});
    return kernel.t1.getWorkspace(workspace_id);
  },{serviceId,workspace_id:scopedWorkspace});
  assert.equal(created?.workspace_id,scopedWorkspace);
  assert.equal(created?.profile,'generic');
  assert.deepEqual(selectedErrors,[]);

  assert.equal(await selected.evaluate(()=>typeof globalThis.IWXA),'undefined',
    'signed Workspace must NOT inherit raw Kernel from its UI origin');
  assert.equal(await selected.evaluate(async()=>{
    const response=await fetch('/_iwxa/loader.js',{cache:'no-store'});
    return response.status;
  }),404);
  console.log('T3_D1_PROTECTED_SIGNED_LAUNCH_ISOLATED_PASS',JSON.stringify({
    oldEntryForwardedToCanonicalUi:true,originalKernel:'0.3.6',
    signedUiHasNoRawKernel:true,signedWorkspaceCreatedAndReadback:true,
    syntheticOwnerOnly:true,nativeStoreBoundaryQualified:false,
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
  assert.equal(new URL(isolatedApp.url()).hash,'#/overview',
    'T3_D1_ISOLATED_UI_MUST_OPEN_SAFE_OVERVIEW_WITHOUT_BEARER');
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
  // Product-level D1+D5: the actually compiled split-origin signed
  // AppShell must offer the inherited BLI panel before any model download.
  const bliLauncher=isolatedApp.getByTestId('t3-local-inference-launcher');
  await bliLauncher.waitFor({state:'visible',timeout:20000});
  const openBli=bliLauncher.getByRole('button',{name:'Открыть локальную модель'});
  assert.equal(await openBli.isEnabled(),true);
  await openBli.click();
  const bliPanel=isolatedApp.getByTestId('t3-local-inference-panel');
  await bliPanel.waitFor({state:'visible',timeout:20000});
  assert.match(await bliPanel.innerText(),/SmolLM2 360M|WebGPU/);
  assert.equal(await bliPanel.getByRole('button',
    {name:'Скачать и запустить'}).isDisabled(),true,
    'D1+D5 model download must require separate consent');
  // The same public synthetic Control (NOT a private Ed25519 owner)
  // supplies an actual scoped KernelFacade to the compiled BLI panel.
  // A fixture draft is inserted ONLY as a previously saved object; all
  // subsequent user actions, copy-as-new save and readbacks run through
  // the mounted signed AppShell and the ORIGINAL inherited Kernel.
  const seededDraftId='local-inference:'+randomUUID();
  const seededText='Previously saved BLI draft for user continuation';
  const seed=await browser.page.evaluate(async({serviceId,workspaceId,id,text})=>{
    const original=await globalThis.IWXA.connect({service_id:serviceId});
    return original.t1.putObject({
      workspace_id:workspaceId,object_id:id,
      schema_id:'iwxa.local-inference.draft',schema_version:'1.0.0',
      base_revision:0,extensions:{},
      data:{
        status:'DRAFT_UNTRUSTED',text,
        model_id:'SmolLM2-360M-Instruct-q4f32_1-MLC',
        engine:'@mlc-ai/web-llm@0.2.87',origin:'BROWSER_LOCAL',
        source:'USER_EXPLICIT_SAVE',model_integrity:'NOT_ATTESTED',
      },
      event:{event_type:'t3.local-inference.draft.saved',payload:{
        status:'DRAFT_UNTRUSTED',model_id:'SmolLM2-360M-Instruct-q4f32_1-MLC',
      }},
    });
  },{serviceId,workspaceId:scopedWorkspace,id:seededDraftId,text:seededText});
  assert.equal(seed?.object?.object_id,seededDraftId);
  await bliPanel.getByRole('button',{name:'Найти рабочие области'}).click();
  await bliPanel.getByLabel('Workspace для локальной модели')
    .selectOption(scopedWorkspace);
  await bliPanel.getByRole('button',{name:'Использовать выбранный Workspace'}).click();
  await isolatedApp.waitForFunction(id=>
    document.querySelector('[data-testid="t3-local-inference-panel"] strong')
      ?.textContent?.includes(id),scopedWorkspace,{timeout:30000});
  await bliPanel.getByTestId('t3-d5-recover-draft-id').fill(seededDraftId);
  await bliPanel.getByRole('button',
    {name:'Прочитать черновик из Kernel по ID'}).click();
  const originalDraftView=bliPanel.getByTestId('t3-d5-saved-draft-readback');
  await originalDraftView.waitFor({state:'visible',timeout:15000});
  assert.ok((await originalDraftView.innerText()).includes(seededText));
  await bliPanel.getByRole('button',
    {name:'Продолжить редактирование как новый черновик'}).click();
  const copiedText=seededText+'; continued and approved in the signed Workspace';
  await bliPanel.getByTestId('t3-d5-editable-draft').fill(copiedText);
  const copySave=bliPanel.getByRole('button',
    {name:'Сохранить черновик через Kernel'});
  assert.equal(await copySave.isEnabled(),true);
  await copySave.click();
  await isolatedApp.waitForFunction(()=>
    [...document.querySelectorAll(
      '[data-testid="t3-local-inference-panel"] p[role="status"]')]
      .some(p=>p.textContent?.includes('Kernel подтвердил запись и чтение')),
    null,{timeout:30000});
  await originalDraftView.waitFor({state:'visible',timeout:15000});
  assert.ok((await originalDraftView.innerText()).includes(copiedText),
    'T3_D1_D5_SIGNED_BLI_NEW_DRAFT_NOT_REOPENED');
  const copiedStatus=await bliPanel.innerText();
  const copiedIds=[...copiedStatus.matchAll(/local-inference:[0-9a-f-]{36}/gi)]
    .map(row=>row[0]).filter(id=>id!==seededDraftId);
  assert.ok(copiedIds.length>0,'T3_D1_D5_SIGNED_BLI_NEW_RECEIPT_REQUIRED');
  const copiedDraftId=copiedIds[0];
  const copied=await browser.page.evaluate(async({serviceId,workspaceId,id})=>{
    const original=await globalThis.IWXA.connect({service_id:serviceId});
    return original.t1.getObject(workspaceId,id);
  },{serviceId,workspaceId:scopedWorkspace,id:copiedDraftId});
  assert.equal(copied?.object?.data?.text,copiedText);
  assert.equal(copied?.object?.schema_id,'iwxa.local-inference.draft');
  assert.equal(copied?.object?.revision,1);
  const originalUnchanged=await browser.page.evaluate(async({serviceId,workspaceId,id})=>{
    const original=await globalThis.IWXA.connect({service_id:serviceId});
    return original.t1.getObject(workspaceId,id);
  },{serviceId,workspaceId:scopedWorkspace,id:seededDraftId});
  assert.equal(originalUnchanged?.object?.data?.text,seededText);
  assert.deepEqual(isolatedAppErrors,[]);
  console.log('T3_D1_D5_SIGNED_BLI_COPY_SAVE_ORIGINAL_KERNEL_PASS',JSON.stringify({
    signedUiUserAction:true,originalKernel:'0.3.6',
    signedPortSave:true,independentOriginalKernelReadback:true,
    sourceDraftUnchanged:true,secondObjectDistinct:true,
    syntheticOwnerOnly:true,privateIssuerExecuted:false,
  }));
  assert.deepEqual(isolatedAppErrors,[]);
  console.log('T3_D1_D5_SIGNED_ISOLATED_BLI_PANEL_PASS',JSON.stringify({
    compiledSignedAppShell:true,originalKernel:'0.3.6',
    localInferenceModuleRegistered:true,panelOpenedByUser:true,
    modelDownloadRequiresConsent:true,privateIssuerExecuted:false,
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

  if(requireHardware){
    // Mac Metal/WebGPU product route: real BLI1 model in the compiled
    // isolated signed AppShell. The owner is SYNTHETIC for public CI, but
    // BOTH draft receipts and cold reads use the ORIGINAL Kernel 0.3.6.
    // Unlike the Linux check, this branch must generate real model text.
    const openPanel=async()=>{
      const page=await browser.context.newPage();
      await page.goto(uiOrigin+'/workspace/isolated-signed-workspace.html#'+token);
      const launcher=page.getByTestId('t3-local-inference-launcher');
      await launcher.waitFor({state:'visible',timeout:45000});
      await launcher.getByRole('button',{name:'Открыть локальную модель'}).click();
      const panel=page.getByTestId('t3-local-inference-panel');
      await panel.waitFor({state:'visible',timeout:30000});
      await panel.getByRole('button',{name:'Найти рабочие области'}).click();
      await panel.getByLabel('Workspace для локальной модели')
        .selectOption(scopedWorkspace);
      await panel.getByRole('button',{name:'Использовать выбранный Workspace'}).click();
      await page.waitForFunction(id=>
        document.querySelector('[data-testid="t3-local-inference-panel"] strong')
          ?.textContent?.includes(id),scopedWorkspace,{timeout:30000});
      return {page,panel};
    };
    const waitPanelStatus=(page,expected,timeout=180000)=>
      page.waitForFunction(needle=>[...document.querySelectorAll(
        '[data-testid="t3-local-inference-panel"] p[role="status"]')]
        .some(p=>p.textContent?.includes(needle)),expected,{timeout});
    const generateAndSave=async(page,panel,request)=>{
      await panel.getByTestId('t3-d5-prompt').fill(request);
      await panel.getByTestId('t3-d5-max-tokens').fill('18');
      await panel.getByRole('button',{name:'Сгенерировать локально'}).click();
      await waitPanelStatus(page,'Черновик готов');
      const generated=await panel.getByTestId('t3-d5-editable-draft').inputValue();
      assert.ok(generated.trim().length>0,'SIGNED_BLI_HARDWARE_GENERATION_REQUIRED');
      await panel.getByRole('button',{name:'Сохранить черновик через Kernel'}).click();
      await waitPanelStatus(page,'Kernel подтвердил запись и чтение');
      await panel.getByTestId('t3-d5-saved-draft-readback')
        .waitFor({state:'visible',timeout:30000});
      const receiptText=await panel.innerText();
      const id=receiptText.match(/local-inference:[0-9a-f-]{36}/i)?.[0];
      assert.ok(id,'SIGNED_BLI_KERNEL_OBJECT_ID_REQUIRED');
      const detail=await browser.page.evaluate(async({serviceId,workspaceId,id})=>{
        const kernel=await globalThis.IWXA.connect({service_id:serviceId});
        return kernel.t1.getObject(workspaceId,id);
      },{serviceId,workspaceId:scopedWorkspace,id});
      assert.equal(detail?.object?.workspace_id,scopedWorkspace);
      assert.equal(detail?.object?.schema_id,'iwxa.local-inference.draft');
      assert.equal(detail?.object?.data?.status,'DRAFT_UNTRUSTED');
      assert.equal(detail?.object?.data?.text,generated.trim());
      return {id,generated:generated.trim()};
    };
    let {page:hardwarePage,panel:hardwarePanel}=await openPanel();
    const gpu=await hardwarePage.evaluate(async()=>{
      const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
      return adapter?.info??null;
    });
    assert.match([gpu?.vendor,gpu?.device,gpu?.description].join(' '),
      /apple/i,'SIGNED_BLI_REAL_APPLE_GPU_REQUIRED');
    assert.equal(await hardwarePanel.getByRole('button',
      {name:'Скачать и запустить'}).isDisabled(),true);
    await hardwarePanel.getByRole('checkbox',
      {name:'Разрешаю скачать файлы модели по сети'}).check();
    hardwarePage.once('dialog',dialog=>dialog.accept());
    await hardwarePanel.getByRole('button',{name:'Скачать и запустить'}).click();
    await waitPanelStatus(hardwarePage,'Модель доступна');
    const first=await generateAndSave(hardwarePage,hardwarePanel,
      'Напиши одно короткое слово на русском.');
    console.log('T3_D1_D5_APPLE_SIGNED_GENERATION_KERNEL_PASS',JSON.stringify({
      originalKernel:'0.3.6',isolatedUiOrigin:true,webgpu:gpu,
      generatedCharacters:first.generated.length,userApprovedModelInstall:true,
      realOriginalKernelReadback:true,syntheticOwnerOnly:true,
    }));

    // Cold browser restart preserves both 127.0.0.1 origins and upstream
    // WebLLM Cache Storage. Disable ALL external requests for the SECOND
    // inference; never substitute a fake response or remote model.
    await browser.context.close();
    browser=await launch();
    await browser.page.goto(origin+'/__original_kernel_probe__');
    await browser.page.waitForFunction(()=>typeof globalThis.IWXA?.connect==='function');
    let externalRequests=0;
    await browser.context.route('**/*',route=>{
      const target=new URL(route.request().url());
      if(target.origin!==origin&&target.origin!==uiOrigin){
        externalRequests++;
        return route.abort('internetdisconnected');
      }
      return route.continue();
    });
    ({page:hardwarePage,panel:hardwarePanel}=await openPanel());
    await hardwarePanel.getByTestId('t3-d5-recover-draft-id').fill(first.id);
    await hardwarePanel.getByRole('button',
      {name:'Прочитать черновик из Kernel по ID'}).click();
    await hardwarePanel.getByTestId('t3-d5-saved-draft-readback')
      .waitFor({state:'visible',timeout:30000});
    const coldReadback=await hardwarePanel.getByTestId('t3-d5-saved-draft-readback')
      .innerText();
    assert.ok(coldReadback.includes(first.generated.slice(0,20)),
      'SIGNED_BLI_DRAFT_COLD_KERNEL_READBACK_MISMATCH');
    await hardwarePage.waitForFunction(()=>
      [...document.querySelectorAll('[data-testid="t3-local-inference-panel"] p')]
        .some(p=>p.textContent?.includes('Модель и WebGPU-ресурсы найдены в локальном кеше')),
      null,{timeout:30000});
    await hardwarePanel.getByRole('button',{name:'Из кеша, без сети'}).click();
    await waitPanelStatus(hardwarePage,'Модель доступна');
    const second=await generateAndSave(hardwarePage,hardwarePanel,
      'Напиши одно другое короткое слово.');
    assert.notEqual(first.id,second.id);
    assert.equal(externalRequests,0,'SIGNED_BLI_COLD_OFFLINE_MUST_NOT_EGRESS');
    console.log('T3_D1_D5_APPLE_SIGNED_COLD_OFFLINE_REGEN_KERNEL_PASS',JSON.stringify({
      originalKernel:'0.3.6',sameSignedUiOrigin:true,
      browserProcessColdRestart:true,externalRequests,
      independentOriginalKernelReadback:true,secondGeneratedCharacters:second.generated.length,
      syntheticOwnerOnly:true,privateIssuerExecuted:false,
    }));
  }
  // Product qualification with the ACTUALLY COMPILED isolated AppShell:
  // original Control HTTP + real Ed25519 PERSONAL grant/actor proof/signed
  // STATUS. The exact T2/3 KernelFacade in main-trusted-kernel-realm.ts
  // dispatches every call after signed JIT into the original T2 Kernel 0.3.6.
  // Unlike the legacy corporate fixture above, NOT ONE successful decision
  // in this segment is synthetic.
  syntheticOwner=false;
  const authenticWs='t3-authentic-personal-ui-'+randomUUID();
  const authenticOperations=[
    't1.getWorkspace','t1.createWorkspace','t1.listObjects',
    't1.getObject','t1.putObject','t1.listEventsSince',
  ];
  const realAuthority=createTemporaryOriginalPersonalAuthority({
    workspaceId:authenticWs,now:Date.now(),clock:Date.now,
    operations:authenticOperations,
  });
  const knownRealOperations=new Set(authenticOperations.map(op=>op.slice(3)));
  authenticHandler=createOriginalControlHttpHandler({
    origin,token,uiOrigin,serviceId,
    assetForPath:path=>(
      path==='/workspace/trusted-kernel-realm.html'||
      path==='/workspace/signed-workspace.html'
    )?{path:join(output,path.slice(1)),type:'text/html; charset=utf-8'}:null,
    currentEpoch:()=>authenticEpoch,
    subscribeInvalidation:callback=>{
      authenticInvalidationListeners.add(callback);
      return ()=>authenticInvalidationListeners.delete(callback);
    },
    ownerFor:({scope,operation})=>
      scope==='kernel'&&knownRealOperations.has(operation)
        ?realAuthority.access:null,
  });
  const authenticApp=await browser.context.newPage();
  const authenticErrors=[];
  authenticApp.on('pageerror',error=>authenticErrors.push(error.message));
  await authenticApp.goto(uiOrigin+'/workspace/isolated-signed-workspace.html#'+token);
  await authenticApp.getByTestId('t3-d1-selected-workspace-message')
    .waitFor({state:'visible',timeout:45000});
  assert.match(await authenticApp.getByTestId(
    't3-d1-selected-workspace-message').innerText(),/выбранного профиля/,
    'PERSONAL_SIGNED_FIRST_RUN_MUST_USE_COMMON_GATE');
  assert.equal(new URL(authenticApp.url()).hash,'#/overview');
  assert.equal(await authenticApp.evaluate(()=>typeof window.IWXA),
    'undefined','AUTHENTIC_PERSONAL_ORIGINAL_KERNEL_MUST_REMAIN_ISOLATED');
  await authenticApp.getByTestId('t3-d1-create-selected-workspace').click();
  await authenticApp.getByTestId('t3-d1-selected-workspace-gate')
    .waitFor({state:'detached',timeout:45000});
  const realWorkspace=await browser.page.evaluate(async({serviceId,id})=>{
    const original=await window.IWXA.connect({service_id:serviceId});
    return original.t1.getWorkspace(id);
  },{serviceId,id:authenticWs});
  assert.equal(realWorkspace?.workspace_id,authenticWs);
  assert.equal(realWorkspace?.profile,'generic');
  assert.ok(realAuthority.proofCount>=2,'ED25519_PERSONAL_JIT_REQUIRED');

  const realDraft='local-inference:'+randomUUID();
  const realDraftText='Existing signed PERSONAL draft for original T3 BLI';
  const realSeed=await browser.page.evaluate(async({serviceId,ws,id,text})=>{
    const original=await window.IWXA.connect({service_id:serviceId});
    return original.t1.putObject({
      workspace_id:ws,object_id:id,
      schema_id:'iwxa.local-inference.draft',schema_version:'1.0.0',
      base_revision:0,extensions:{},
      data:{status:'DRAFT_UNTRUSTED',text,
        model_id:'SmolLM2-360M-Instruct-q4f32_1-MLC',
        engine:'@mlc-ai/web-llm@0.2.87',
        origin:'BROWSER_LOCAL',source:'USER_EXPLICIT_SAVE',
        model_integrity:'NOT_ATTESTED'},
      event:{event_type:'t3.local-inference.draft.saved',
        payload:{status:'DRAFT_UNTRUSTED',
          model_id:'SmolLM2-360M-Instruct-q4f32_1-MLC'}},
    });
  },{serviceId,ws:authenticWs,id:realDraft,text:realDraftText});
  assert.equal(realSeed.object.object_id,realDraft);
  const realLauncher=authenticApp.getByTestId('t3-local-inference-launcher');
  await realLauncher.waitFor({state:'visible',timeout:25000});
  await realLauncher.getByRole('button',{name:'Открыть локальную модель'}).click();
  const realPanel=authenticApp.getByTestId('t3-local-inference-panel');
  await realPanel.waitFor({state:'visible',timeout:25000});
  assert.equal(await realPanel.getByRole('button',
    {name:'Скачать и запустить'}).isDisabled(),true,
    'AUTHENTIC_SIGNED_BLI_MUST_NOT_DOWNLOAD_A_MODEL');
  await realPanel.getByRole('button',{name:'Найти рабочие области'}).click();
  await realPanel.getByLabel('Workspace для локальной модели')
    .selectOption(authenticWs);
  await realPanel.getByRole('button',{name:'Использовать выбранный Workspace'}).click();
  await authenticApp.waitForFunction(id=>
    document.querySelector('[data-testid="t3-local-inference-panel"] strong')
      ?.textContent?.includes(id),authenticWs,{timeout:30000});
  await realPanel.getByTestId('t3-d5-recover-draft-id').fill(realDraft);
  await realPanel.getByRole('button',
    {name:'Прочитать черновик из Kernel по ID'}).click();
  const realRead=realPanel.getByTestId('t3-d5-saved-draft-readback');
  await realRead.waitFor({state:'visible',timeout:20000});
  assert.ok((await realRead.innerText()).includes(realDraftText));
  await realPanel.getByRole('button',
    {name:'Продолжить редактирование как новый черновик'}).click();
  const realCopyText=realDraftText+'; edited and signed via original Control';
  await realPanel.getByTestId('t3-d5-editable-draft').fill(realCopyText);
  await realPanel.getByRole('button',{name:'Сохранить черновик через Kernel'}).click();
  await authenticApp.waitForFunction(()=>
    [...document.querySelectorAll(
      '[data-testid="t3-local-inference-panel"] p[role="status"]')]
      .some(p=>p.textContent?.includes('Kernel подтвердил запись и чтение')),
    null,{timeout:45000});
  const realStatus=await realPanel.innerText();
  const realCopyId=[...realStatus.matchAll(/local-inference:[0-9a-f-]{36}/gi)]
    .map(x=>x[0]).find(id=>id!==realDraft);
  assert.ok(realCopyId,'AUTHENTIC_PERSONAL_KERNEL_COPY_RECEIPT_REQUIRED');
  const realCopy=await browser.page.evaluate(async({serviceId,ws,id})=>{
    const original=await window.IWXA.connect({service_id:serviceId});
    return original.t1.getObject(ws,id);
  },{serviceId,ws:authenticWs,id:realCopyId});
  assert.equal(realCopy?.object?.data?.text,realCopyText);
  assert.equal(realCopy?.object?.revision,1);
  assert.ok(realAuthority.proofCount>=5,
    'AUTHENTIC_PERSONAL_ALL_WORKSPACE_ACTIONS_MUST_JIT');
  assert.deepEqual(authenticErrors,[]);
  console.log('T3_D1_COMPILED_APP_REAL_PERSONAL_ED25519_BLI_KERNEL_PASS',JSON.stringify({
    originalKernel:'0.3.6',compiledSignedAppShell:true,
    genuineControlHttp:true,realEd25519Grant:true,
    realVaultActorProof:true,realSignedStatus:true,
    userCreatedPersonalWorkspace:true,userCopiedBliDraft:true,
    originalKernelReadback:true,originalKernelOnly:true,
    separateUIOrigin:true,syntheticControl:false,
    proofCount:realAuthority.proofCount,registryReads:realAuthority.registryReads,
    nativeWindowsInstallAccepted:false,
  }));
  realAuthority.revoke();
  authenticEpoch++;
  for(const callback of authenticInvalidationListeners)callback();
  await authenticApp.getByTestId('t3-signed-control-reconnect')
    .waitFor({state:'visible',timeout:15000});
  assert.equal(await authenticApp.evaluate(()=>typeof window.IWXA),'undefined');
  assert.equal((await authenticApp.evaluate(async()=>(
    await fetch('/_iwxa/loader.js',{cache:'no-store'})
  ).status)),404);
  assert.deepEqual(authenticErrors,[]);
  console.log('T3_D1_COMPILED_APP_REAL_PERSONAL_REVOCATION_PASS',JSON.stringify({
    originalControlSse:true,originalKernel:'0.3.6',
    realSignedRevocation:true,compiledAppShellUnmounted:true,
    rawKernelNotExposed:true,syntheticControl:false,
  }));

  // Authentic MULTI-ORG product route, using the same already compiled AppShell,
  // same existing trusted Control HTTP(S), original Kernel/Store and BLI.
  // Unlike the earlier simulated corporate fixture, the two issuers below
  // independently sign enrollment, grants, STATUS and credential proofs.
  // The public test issues temporary TEST-only authorities near execution.
  const {model:twoCorporations,NOW:corpNow,time:corpClock}=await import(
    './support/t3-two-corp-original-authority.mjs');
  const corpOperations=[
    't1.getWorkspace','t1.createWorkspace','t1.listObjects','t1.getObject',
    't1.listEventsSince','t1.putObject',
  ];
  const corporate=twoCorporations({operations:corpOperations});
  // There is ONE ORIGINAL encrypted local vault containing two
  // independently enrolled corporate actor credentials. No in-memory
  // signers are selected by browser or sent to the compiled AppShell.
  const corporateKeyVault=emptyVault();
  for(const entry of Object.values(corporate.all)){
    const keyId=entry.issuedCredential.publicKeyRef;
    importVaultKey(corporateKeyVault,{
      keyId,subjectId:entry.context.actor_id,
      privateKeyPem:entry.credentialPrivateKeyPem,
      expectedPublicKeyPem:corporate.policy.keys[keyId].publicKey,
    });
  }
  const vaultPath=join(root,'corporate-owner-keys.encrypted.json');
  const testPassphrase='CI_TEST_ONLY_CORP_CREDENTIALS_NOT_A_DEFAULT_PASSWORD';
  writeFileSync(vaultPath,JSON.stringify(encryptVault(
    corporateKeyVault,testPassphrase)),{mode:0o600});
  assert.equal(readFileSync(vaultPath,'utf8').includes(
    'BEGIN PRIVATE KEY'),false,'T3_D1_CORP_VAULT_PLAINTEXT_LEAK');
  const newCredentialProvers=()=>Object.fromEntries(
    Object.values(corporate.all).map(entry=>[
      entry.context.organization_id,
      createOriginalVaultProofSigner({
        organizationId:entry.context.organization_id,
        keyId:entry.issuedCredential.publicKeyRef,
        readEncryptedVault:async()=>readFileSync(vaultPath,'utf8'),
        unlockPassphrase:async()=>testPassphrase,
      }),
    ]));
  let credentialProvers=newCredentialProvers();
  const corpRegistryWs='ws:corporate-trusted-access-'+randomUUID();
  await browser.page.evaluate(async({serviceId,workspaceId})=>{
    const original=await window.IWXA.connect({service_id:serviceId});
    await original.t1.createWorkspace({workspace_id:workspaceId,profile:'generic'});
  },{serviceId,workspaceId:corpRegistryWs});
  // Only the TRUSTED Control host holds this original KernelPort; the
  // isolated UI receives no raw T2 session, signer, policy or registry API.
  const originalRegistryKernel={
    sessionInfo:{contract_version:'1.3.0',runtime_version:'0.3.6'},
    hasOperation:op=>[
      't1.getObject','t1.putObject','t1.listEventsSince',
    ].includes(op),
    getObject:(...args)=>browser.page.evaluate(async({serviceId,args})=>{
      const original=await IWXA.connect({service_id:serviceId});
      return original.t1.getObject(...args);
    },{serviceId,args}),
    putObject:input=>browser.page.evaluate(async({serviceId,input})=>{
      const original=await IWXA.connect({service_id:serviceId});
      return original.t1.putObject(input);
    },{serviceId,input}),
    listEventsSince:(...args)=>browser.page.evaluate(async({serviceId,args})=>{
      const original=await IWXA.connect({service_id:serviceId});
      return original.t1.listEventsSince(...args);
    },{serviceId,args}),
  };
  const corpRegistryOptions={
    kernel:originalRegistryKernel,workspaceId:corpRegistryWs,
    trustedPolicy:corporate.policy,clock:corpClock,
  };
  let corporateRegistry=createOriginalKernelRegistryStatePort(corpRegistryOptions);
  assert.equal((await corporateRegistry.commitSignedState(corporate.state)).revision,1);
  const allowedCorpOps=new Map([
    ['getWorkspace','workspace.read'],['createWorkspace','workspace.create'],
    ['listObjects','object.read'],['getObject','object.read'],
    ['listEventsSince','event.read'],['putObject','object.write'],
  ]);
  let selectedCorporation='north';
  const credentialProofs={north:0,south:0};
  const corporationFor=context=>{
    const entry=Object.values(corporate.all).find(item=>
      item.context.organization_id===context.organization_id);
    assert.ok(entry,'UNKNOWN_SIGNED_CORPORATE_SELECTION');
    return entry;
  };
  const buildCorporatePort=registry=>createSignedAccessHostPort({
    currentContext:()=>corporate.all[selectedCorporation].context,
    actionFor:op=>{
      const action=allowedCorpOps.get(op.replace(/^t1\./,''));
      if(!action)throw Error('CORPORATE_KERNEL_OPERATION_UNAVAILABLE');
      return action;
    },
    operationDigest:({operation,input,context})=>digest({operation,input,context}),
    canonicalDigest:digest,clock:corpClock,
    corporate:{
      productId:'IWXA_CONTROL_CENTER',
      gate:createOrganizationalOperationGate({registry}),
      inputFor:async context=>{
        const entry=corporationFor(context);
        return {profile:entry.profile,selection:entry.selection,
          descriptors:entry.descriptors,credential:entry.issuedCredential,
          enrollment:entry.enrollment};
      },
      prove:async({request,challenge,credentialKeyId,context,asOf})=>{
        const entry=corporationFor(context);
        assert.equal(credentialKeyId,entry.issuedCredential.publicKeyRef);
        credentialProofs[selectedCorporation]++;
        return credentialProvers[context.organization_id]({
          request,challenge,credentialKeyId,context,asOf,
        });
      },
    },
  });
  let corporateOwner=buildCorporatePort(corporateRegistry);
  authenticEpoch++;
  authenticHandler=createOriginalControlHttpHandler({
    origin,token,uiOrigin,serviceId,
    assetForPath:path=>(
      path==='/workspace/trusted-kernel-realm.html'||
      path==='/workspace/signed-workspace.html'
    )?{path:join(output,path.slice(1)),type:'text/html; charset=utf-8'}:null,
    currentEpoch:()=>authenticEpoch,
    subscribeInvalidation:listener=>{
      authenticInvalidationListeners.add(listener);
      return ()=>authenticInvalidationListeners.delete(listener);
    },
    ownerFor:({scope,operation})=>
      scope==='kernel'&&allowedCorpOps.has(operation)?corporateOwner:null,
  });
  const switchTo=short=>{
    assert.ok(Object.hasOwn(corporate.all,short));
    selectedCorporation=short;
    authenticEpoch++;
    // The existing original Control owner uses this very same SSE signal
    // on voluntary context changes and cryptographic revocation.
    for(const callback of [...authenticInvalidationListeners])callback();
  };
  const openCorporateApp=async()=>{
    const page=await browser.context.newPage();
    const pageErrors=[];
    page.on('pageerror',error=>pageErrors.push(error.message));
    await page.goto(uiOrigin+'/workspace/isolated-signed-workspace.html#'+token);
    return {page,pageErrors};
  };
  const onboardCorporate=async short=>{
    const {page,pageErrors}=await openCorporateApp();
    const gate=page.getByTestId('t3-d1-selected-workspace-message');
    await gate.waitFor({state:'visible',timeout:45000});
    assert.match(await gate.innerText(),/выбранного профиля/,
      'CORP_SIGNED_FIRST_RUN_REQUIRED');
    assert.equal(new URL(page.url()).hash,'#/overview');
    assert.equal(await page.evaluate(()=>typeof window.IWXA),'undefined');
    await page.getByTestId('t3-d1-create-selected-workspace').click();
    await page.getByTestId('t3-d1-selected-workspace-gate')
      .waitFor({state:'detached',timeout:45000});
    const read=await browser.page.evaluate(async({serviceId,ws})=>{
      const original=await IWXA.connect({service_id:serviceId});
      return original.t1.getWorkspace(ws);
    },{serviceId,ws:'ws:'+short});
    assert.equal(read?.workspace_id,'ws:'+short);
    assert.equal(read?.profile,'generic');
    assert.deepEqual(pageErrors,[]);
    return {page,pageErrors};
  };
  const copyDraftInCorporateUI=async(page,short)=>{
    const ws='ws:'+short,draftId='local-inference:'+randomUUID();
    const draftText='Original independent '+short+' organization input';
    const seed=await browser.page.evaluate(async({serviceId,ws,draftId,draftText})=>{
      const native=await IWXA.connect({service_id:serviceId});
      return native.t1.putObject({
        workspace_id:ws,object_id:draftId,
        schema_id:'iwxa.local-inference.draft',schema_version:'1.0.0',
        base_revision:0,extensions:{},
        data:{status:'DRAFT_UNTRUSTED',text:draftText,
          model_id:'SmolLM2-360M-Instruct-q4f32_1-MLC',
          engine:'@mlc-ai/web-llm@0.2.87',
          origin:'BROWSER_LOCAL',source:'USER_EXPLICIT_SAVE',
          model_integrity:'NOT_ATTESTED'},
        event:{event_type:'t3.local-inference.draft.saved',
          payload:{status:'DRAFT_UNTRUSTED',
            model_id:'SmolLM2-360M-Instruct-q4f32_1-MLC'}},
      });
    },{serviceId,ws,draftId,draftText});
    assert.equal(seed.object.object_id,draftId);
    const launcher=page.getByTestId('t3-local-inference-launcher');
    await launcher.waitFor({state:'visible',timeout:30000});
    await launcher.getByRole('button',{name:'Открыть локальную модель'}).click();
    const panel=page.getByTestId('t3-local-inference-panel');
    await panel.waitFor({state:'visible',timeout:30000});
    assert.equal(await panel.getByRole('button',
      {name:'Скачать и запустить'}).isDisabled(),true);
    await panel.getByRole('button',{name:'Найти рабочие области'}).click();
    // The module performs an async, original signed Kernel read. A DOM
    // snapshot immediately after click races that read on a fast CI runner.
    await panel.getByLabel('Workspace для локальной модели')
      .locator('option[value="'+ws+'"]')
      .waitFor({state:'attached',timeout:30000});
    const options=await panel.getByLabel('Workspace для локальной модели')
      .locator('option').evaluateAll(nodes=>nodes.map(node=>node.value));
    assert.equal(options.includes('ws:'+(short==='north'?'south':'north')),
      false,'CORPORATE_APP_CANNOT_ENUMERATE_OTHER_WORKSPACE');
    assert.equal(options.includes(ws),true,
      'CORPORATE_APP_MUST_DISPLAY_ONLY_SIGNED_WORKSPACE');
    await panel.getByLabel('Workspace для локальной модели').selectOption(ws);
    await panel.getByRole('button',{name:'Использовать выбранный Workspace'}).click();
    // A signed corporate focus change is an asynchronous JIT operation.
    // A stale <strong> from the previous Host focus is NOT proof of success.
    try{
      await page.waitForFunction(id=>{
        const panel=document.querySelector('[data-testid="t3-local-inference-panel"]');
        return panel?.querySelector('strong')?.textContent?.includes(id)&&
          [...panel.querySelectorAll('p[role="status"]')]
            .some(p=>p.textContent?.includes('Рабочая область выбрана через Host'));
      },ws,{timeout:30000});
    }catch(error){
      console.log('T3_D1_CORPORATE_BLI_FOCUS_DIAGNOSTIC',JSON.stringify({
        organization:short, workspace:ws, panel:await panel.innerText(),
      }));
      throw error;
    }
    await panel.getByTestId('t3-d5-recover-draft-id').fill(draftId);
    const readDraft=panel.getByRole('button',
      {name:'Прочитать черновик из Kernel по ID'});
    try{
      await readDraft.waitFor({state:'visible',timeout:5000});
      await page.waitForFunction(()=>{
        const button=[...document.querySelectorAll(
          '[data-testid="t3-local-inference-panel"] button')]
          .find(el=>el.textContent?.includes('Прочитать черновик из Kernel по ID'));
        return button&&!button.disabled;
      },null,{timeout:12000});
    }catch(error){
      console.log('T3_D1_CORPORATE_BLI_READ_DISABLED',JSON.stringify({
        organization:short, workspace:ws,
        recoverId:await panel.getByTestId('t3-d5-recover-draft-id').inputValue(),
        panel:await panel.innerText(),
        html:await readDraft.evaluate(el=>el.outerHTML),
      }));
      throw error;
    }
    await readDraft.click();
    const view=panel.getByTestId('t3-d5-saved-draft-readback');
    await view.waitFor({state:'visible',timeout:30000});
    assert.ok((await view.innerText()).includes(draftText));
    await panel.getByRole('button',
      {name:'Продолжить редактирование как новый черновик'}).click();
    const copiedText=draftText+'; copied via genuine signed corporate Control';
    await panel.getByTestId('t3-d5-editable-draft').fill(copiedText);
    await panel.getByRole('button',{name:'Сохранить черновик через Kernel'}).click();
    await page.waitForFunction(()=>
      [...document.querySelectorAll(
        '[data-testid="t3-local-inference-panel"] p[role="status"]')]
        .some(p=>p.textContent?.includes('Kernel подтвердил запись и чтение')),
      null,{timeout:45000});
    const status=await panel.innerText();
    const copiedId=[...status.matchAll(/local-inference:[0-9a-f-]{36}/gi)]
      .map(m=>m[0]).find(id=>id!==draftId);
    assert.ok(copiedId,'CORPORATE_SIGNED_KERNEL_RECEIPT_REQUIRED');
    const saved=await browser.page.evaluate(async({serviceId,ws,id})=>{
      const original=await IWXA.connect({service_id:serviceId});
      return original.t1.getObject(ws,id);
    },{serviceId,ws,id:copiedId});
    assert.equal(saved?.object?.data?.text,copiedText);
    assert.equal(saved?.object?.revision,1);
    return {ws,draftId,copiedId,copiedText};
  };

  // Explicit trusted Control selection: organization A, first-run, signed
  // BLI read/write; no browser-origin raw original Kernel in the AppShell.
  const northApp=await onboardCorporate('north');
  const northCopy=await copyDraftInCorporateUI(northApp.page,'north');
  assert.ok(credentialProofs.north>=5);
  assert.deepEqual(northApp.pageErrors,[]);
  switchTo('south');
  await northApp.page.getByTestId('t3-signed-control-reconnect')
    .waitFor({state:'visible',timeout:15000});
  assert.equal(await northApp.page.evaluate(()=>typeof window.IWXA),'undefined');

  // A second independent organization uses the SAME compiled AppShell and
  // original runtime; old North operation ports are now stale and detached.
  const southApp=await onboardCorporate('south');
  const southCopy=await copyDraftInCorporateUI(southApp.page,'south');
  assert.ok(credentialProofs.south>=5);
  assert.notEqual(northCopy.ws,southCopy.ws);
  assert.notEqual(northCopy.copiedId,southCopy.copiedId);
  assert.deepEqual(southApp.pageErrors,[]);

  // Signed unilateral withdrawal of NORTH. The other issuer's STATUS
  // remains sequence 1, and its authorized BLI data remain stored intact.
  const oldNorth=corporate.all.north.status;
  const revokedNorth={...oldNorth,sequence:2,issuedAt:iso(corpNow-1000),
    entries:[{grantId:'grant:north',state:'REVOKED',
      effectiveAt:iso(corpNow-1500),evidenceRef:'evidence:revoked-north'}]};
  const revokedState=structuredClone(corporate.state);
  revokedState.statuses['issuer:north']=signRecord(
    revokedNorth,corporate.all.north.issuerSigner);
  revokedState.statusFloor['issuer:north']=2;
  assert.equal((await corporateRegistry.commitSignedState(revokedState)).revision,2);
  switchTo('north');
  await southApp.page.getByTestId('t3-signed-control-reconnect')
    .waitFor({state:'visible',timeout:15000});

  // Complete browser process cold restart, not merely page reload. Reopen
  // exactly the original T2 Store and construct a NEW corporate AccessGate
  // bound to the trusted ORIGINAL persisted policy/status object.
  await browser.context.close();browser=null;
  browser=await launch();
  await browser.page.goto(origin+'/__original_kernel_probe__');
  await browser.page.waitForFunction(()=>
    typeof window.IWXA?.connect==='function');
  corporateRegistry=createOriginalKernelRegistryStatePort(corpRegistryOptions);
  // Reconstruct proof functions from the ENCRYPTED vault bytes as well;
  // no stale in-memory KeyObject survives cold browser and Access restart.
  credentialProvers=newCredentialProvers();
  assert.deepEqual((await corporateRegistry.getStatus()).sequences,{
    'issuer:north':2,'issuer:south':1,
  });
  corporateOwner=buildCorporatePort(corporateRegistry);
  const revokedApp=await openCorporateApp();
  const revokedMessage=revokedApp.page.getByTestId(
    't3-d1-selected-workspace-message');
  await revokedMessage.waitFor({state:'visible',timeout:45000});
  assert.match(await revokedMessage.innerText(),/Control не подтвердил/,
    'REVOKED_CORP_MUST_NOT_RENDER_ITS_WORKSPACE');
  assert.equal(await revokedApp.page.getByTestId(
    't3-local-inference-launcher').count(),0);
  assert.equal(await revokedApp.page.evaluate(()=>typeof window.IWXA),'undefined');
  assert.deepEqual(revokedApp.pageErrors,[]);
  switchTo('south');
  await revokedApp.page.getByTestId('t3-signed-control-reconnect')
    .waitFor({state:'visible',timeout:15000});

  const recoveredSouth=await openCorporateApp();
  const readyLauncher=recoveredSouth.page.getByTestId(
    't3-local-inference-launcher');
  await readyLauncher.waitFor({state:'visible',timeout:45000});
  await readyLauncher.getByRole('button',{name:'Открыть локальную модель'}).click();
  const recoveredPanel=recoveredSouth.page.getByTestId('t3-local-inference-panel');
  await recoveredPanel.waitFor({state:'visible',timeout:30000});
  await recoveredPanel.getByRole('button',{name:'Найти рабочие области'}).click();
  await recoveredPanel.getByLabel('Workspace для локальной модели')
    .selectOption('ws:south');
  await recoveredPanel.getByRole('button',
    {name:'Использовать выбранный Workspace'}).click();
  // The cold original Kernel and corporate JIT focus command both execute
  // asynchronously. Verify Host focus finished before enabling readback.
  try{
    await recoveredSouth.page.waitForFunction(()=>
      [...document.querySelectorAll(
        '[data-testid="t3-local-inference-panel"] p[role="status"]')]
        .some(p=>p.textContent?.includes('Рабочая область выбрана через Host')),
      null,{timeout:30000});
  }catch(error){
    console.log('T3_D1_CORPORATE_COLD_FOCUS_DIAGNOSTIC',
      JSON.stringify({panel:await recoveredPanel.innerText()}));
    throw error;
  }
  await recoveredPanel.getByTestId('t3-d5-recover-draft-id')
    .fill(southCopy.copiedId);
  await recoveredSouth.page.waitForFunction(()=>
    [...document.querySelectorAll(
      '[data-testid="t3-local-inference-panel"] button')]
      .some(button=>button.textContent?.includes(
        'Прочитать черновик из Kernel по ID')&&!button.disabled),
    null,{timeout:12000});
  await recoveredPanel.getByRole('button',
    {name:'Прочитать черновик из Kernel по ID'}).click();
  const coldRead=recoveredPanel.getByTestId('t3-d5-saved-draft-readback');
  await coldRead.waitFor({state:'visible',timeout:30000});
  assert.ok((await coldRead.innerText()).includes(southCopy.copiedText));
  assert.deepEqual(recoveredSouth.pageErrors,[]);
  const originalCold=await browser.page.evaluate(async({serviceId,north,south})=>{
    const original=await IWXA.connect({service_id:serviceId});
    const n=await original.t1.getObject('ws:north',north);
    const s=await original.t1.getObject('ws:south',south);
    return {north:n?.object?.workspace_id,south:s?.object?.workspace_id};
  },{serviceId,north:northCopy.copiedId,south:southCopy.copiedId});
  assert.deepEqual(originalCold,{north:'ws:north',south:'ws:south'});
  console.log('T3_D1_TWO_CORP_COMPILED_APPSHELL_REAL_ED25519_KERNEL_PASS',
    JSON.stringify({
      compiledAppShell:true,originalKernel:'0.3.6',
      independentEd25519Issuers:2,independentSignedEnrollments:2,
      independentCorporateCredentials:2,realCorporateProofs:credentialProofs,
      authenticControlHttp:true,syntheticCorporateOwner:false,
      explicitContextSwitch:true,oldAppDisconnectedOnSwitch:true,
      crossWorkspaceEnumerationDenied:true,
      userCreatedTwoWorkspaces:true,originalKernelBliWrites:2,
      northRevokedAfterSignedStatus:true,
      southActiveAfterColdRestart:true,originalStoreColdReadback:true,
      existingEncryptedCorporateVault:true,
      bothCredentialKeysRestoredAfterCold:true,
      installedWindowsControlAccepted:false,
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
