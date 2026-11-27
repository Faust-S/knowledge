#!/usr/bin/env node
// T3 D1 local Control packager: extend the ORIGINAL T2 one-dist with the
// compiled signed Workspace entry. No new Kernel, Store or second Host.
import {createHash, randomUUID} from 'node:crypto';
import {cpSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync,
  readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, extname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertInstalledOriginalKernelArtifact,takeQualificationKernelCandidate}
  from './installed-kernel-selection.mjs';
import {qualificationKernelCandidateFields,selectQualificationKernelCandidate}
  from './installed-kernel-candidate.mjs';
import {registerT3LocalInferenceService}
  from './register-t3-local-inference.mjs';
import {materializeDomainMode} from './materialize-t3-domain-mode.mjs';
import {companyExchangeServiceId,originalCompanyExchangePassport} from "../src/t3/company-exchange-profile.mjs";

// The original D3 recipient writes this exact Object through T2
// commitObjectGraph. Register only in an installed original Admin D3 dist.
// This is the inherited service passport, NOT another Kernel or Store.
const ADMIN_APPLIED_SCHEMA="iwxa.admin.applied-results";
const ADMIN_ACCESS_SCHEMA="iwxa.t3.access.signed-registry";
// Only the INSTALLED Admin D3 service receives this ORIGINAL signed
// AccessRegistry Object/Event schema, never normative T2 or other domains.
const ADMIN_ACCESS_DECLARATION=Object.freeze({
  // Reuse the ORIGINAL signed-state schema already declared by the
  // inherited T2 host. Its AccessRegistry verifies signed policy/grant/
  // STATUS and Kernel Event history; JSON Schema is only serialization.
  schema_version:"1.0.0",preserve_unknown:true,
  json_schema:{type:"object"},embedded:{},
});
const ADMIN_RESULT_FIELDS=["taskId","taskRevisionId","resultRevisionId",
  "organizationId","workspaceId","executorId","result","acceptanceId"];
const ADMIN_APPLIED_DECLARATION=Object.freeze({
  schema_version:"1.0.0",preserve_unknown:false,
  json_schema:{
    type:"object",
    properties:{
      schema:{const:"IWXA_T3_ADMIN_APPLIED_RESULTS/1"},
      records:{type:"array",minItems:1,items:{
        type:"object",
        properties:Object.fromEntries(ADMIN_RESULT_FIELDS.map(field=>
          [field,field==="result"?{type:"string"}:
            {type:"string",minLength:1}])),
        required:ADMIN_RESULT_FIELDS,additionalProperties:false,
      }},
    },
    required:["schema","records"],additionalProperties:false,
  },embedded:{},
});
// Keep ORIGINAL T2's service-specific scope. Universal Workspace mode
// would require wildcard object/delete and lifecycle purge permissions.
// Both installed products may transfer their complete BUSINESS inventory
// only through the signed Host's original subject binding.
function enableInstalledBusinessExchange(passport,service){
  if(passport.service_id!==service)return;
  const p=passport.permissions.packages;
  if(!p||p.export!==false||p.import!==false||
     p.export_scope!=="readable_objects"||p.import_scope!=="writable_objects")
    fail("ORIGINAL_CORPORATE_EXCHANGE_SOURCE_SCOPE_INVALID");
  passport.permissions.packages={...p,export:true,import:true};
}
function registerInstalledAdminAppliedResult({domain,config,passport}){
  if(config?.base_path!=="/workspace/"||
     passport?.service_id!==config.workspace_service_id||
     !passport?.supported_levels?.includes("T1")||
     !passport?.supported_levels?.includes("T2")||
     passport.permissions?.workspace?.read!==true||
     typeof passport.permissions?.workspace?.create!=="boolean"||
     !passport.schemas||typeof passport.schemas!=="object"||
     Array.isArray(passport.schemas))
    fail("ORIGINAL_ADMIN_D3_SERVICE_REQUIRED");
  const rows=[domain?.security?.allowed_object_classes,
    passport.input_object_types,passport.output_object_types,
    passport.permissions?.objects?.read,passport.permissions?.objects?.write];
  if(rows.some(row=>!Array.isArray(row)))
    fail("ORIGINAL_ADMIN_D3_SCHEMA_PERMISSIONS_REQUIRED");
  const declarations=[
    [ADMIN_APPLIED_SCHEMA,ADMIN_APPLIED_DECLARATION],
    [ADMIN_ACCESS_SCHEMA,ADMIN_ACCESS_DECLARATION]];
  if(passport.service_id==="iwxa.admin-center.workspace")
    declarations.push([COMPANY_WORK_SCHEMA,COMPANY_WORK_DECLARATION],
      [AGENT_D6_RESULT_SCHEMA,AGENT_D6_RESULT_DECLARATION]);
  for(const [schema,declaration] of declarations){
    const existing=passport.schemas[schema];
    if(existing!==undefined&&
       JSON.stringify(existing)!==JSON.stringify(declaration))
      fail("ORIGINAL_ADMIN_D3_SCHEMA_CONFLICT");
    for(const row of rows)if(!row.includes(schema))row.push(schema);
    if(existing===undefined)passport.schemas[schema]=declaration;
  }
  // Original T2 refuses commitObjectGraph without this exact service
  // permission. Register its INHERITED atomic operation in the assembled
  // Admin passport only; do not modify the normative T2 or other domains.
  // Private signed application.apply and separate Human approval remain
  // mandatory before any graph write.
  const originalOps=passport.permissions.operations;
  if(originalOps!==undefined&&(!Array.isArray(originalOps)||
      originalOps.length>1||
      originalOps.some(op=>op!=="t1.commitObjectGraph")))
    fail("ORIGINAL_ADMIN_D3_ATOMIC_OPERATION_CONFLICT");
  passport.permissions.operations=["t1.commitObjectGraph"];
  // First-run Workspace creation remains a separate signed ACTION. There
  // is no automatic Workspace creation on ACCEPT or during APPLY.
  passport.permissions.workspace.create=true;
  enableInstalledBusinessExchange(passport,"iwxa.admin-center.workspace");
}

// Original company work material remains an Object in the inherited T2
// Workspace. Neither the Agent WorkArea nor this schema becomes a Store.
const COMPANY_WORK_SCHEMA='iwxa.t3.company-work-record';
const COMPANY_WORK_DECLARATION=Object.freeze({
  schema_version:'1.0.0',preserve_unknown:false,
  json_schema:{type:'object',additionalProperties:false,
    properties:{
      schema:{const:'IWXA_T3_ORIGINAL_COMPANY_WORK_RECORD/1'},
      kind:{enum:['TASK','DRAFT','DOCUMENT','RESULT','HISTORY']},
      artifactId:{type:'string',minLength:1},
      operationId:{type:'string',minLength:1},
      organizationId:{type:'string',minLength:1},
      workspaceId:{type:'string',minLength:1},
      executorId:{type:'string',minLength:1},
      taskId:{type:'string',minLength:1},
      taskRevisionId:{type:'string',pattern:'^[a-f0-9]{64}$'},
      taskPackageSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},
      mimeType:{enum:['text/plain','text/markdown','application/json']},
      text:{type:'string',minLength:1,maxLength:2000000},
      sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},
      sourceKind:{enum:['ORIGINAL_SIGNED_TASK',
        'ORIGINAL_COMPANY_WORKAREA','ORIGINAL_AGENT_HUMAN_ACCEPTED']},
    },
    required:['schema','kind','artifactId','operationId','organizationId',
      'workspaceId','executorId','taskId','taskRevisionId',
      'taskPackageSha256','mimeType','text','sha256','sourceKind'],
  },embedded:{},
});

// The accepted-result schema already belongs to the ORIGINAL D6 publisher.
// Install it only in an Agent D6 profile of the inherited T2 service passport.
const AGENT_D6_RESULT_SCHEMA='iwxa.agent.accepted-result';
const AGENT_D6_RESULT_DECLARATION=Object.freeze({
  schema_version:'1.0.0',preserve_unknown:false,
  json_schema:{
    type:'object',
    properties:{
      taskId:{type:'string',minLength:1},
      resultId:{type:'string',minLength:1},
      acceptedDigest:{type:'string',pattern:'^[a-f0-9]{64}$'},
      signedTaskId:{type:'string',minLength:1},
      signedTaskRevisionId:{type:'string',minLength:1},
      signedTaskPackageSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},
      contextDigest:{type:'string',pattern:'^[a-f0-9]{64}$'},
      workRef:{
        type:'object',
        properties:{
          projectId:{type:'string',minLength:1},
          workId:{type:'string',minLength:1},
          revision:{type:'string',pattern:'^(0|[1-9][0-9]*)$'},
        },
        required:['projectId','workId','revision'],additionalProperties:false,
      },
    },
    // WorkRef belongs only to an explicitly project-bound recipient. A
    // generic accepted Result has no Atlas project and must still be saved
    // by the ONE original Agent T2 Kernel service. When WorkRef is supplied
    // its precise project/work/revision is verified by the existing schema.
    required:['taskId','resultId','acceptedDigest','signedTaskId',
      'signedTaskRevisionId','signedTaskPackageSha256','contextDigest'],
    additionalProperties:false,
  },embedded:{},
});
function registerInstalledAgentAcceptedResult({domain,config,passport}){
  if(config?.base_path!=='/workspace/'||
     passport?.service_id!==config.workspace_service_id||
     !passport?.supported_levels?.includes('T1')||
     !passport?.supported_levels?.includes('T2')||
     passport.permissions?.workspace?.read!==true||
     typeof passport.permissions?.workspace?.create!=='boolean'||
     !passport.schemas||typeof passport.schemas!=='object'||
     Array.isArray(passport.schemas))
    fail('ORIGINAL_AGENT_D6_SERVICE_REQUIRED');
  const rows=[domain?.security?.allowed_object_classes,
    passport.input_object_types,passport.output_object_types,
    passport.permissions?.objects?.read,passport.permissions?.objects?.write];
  if(rows.some(row=>!Array.isArray(row)))
    fail('ORIGINAL_AGENT_D6_SCHEMA_PERMISSIONS_REQUIRED');
  // Reuse the ONE original D1 signed AccessRegistry schema already used
  // by installed Admin D3, not a second IAM/registry implementation.
  for(const [schema,declaration] of [
    [AGENT_D6_RESULT_SCHEMA,AGENT_D6_RESULT_DECLARATION],
    [COMPANY_WORK_SCHEMA,COMPANY_WORK_DECLARATION],
    [ADMIN_ACCESS_SCHEMA,ADMIN_ACCESS_DECLARATION],
  ]){
    const existing=passport.schemas[schema];
    if(existing!==undefined&&
       JSON.stringify(existing)!==JSON.stringify(declaration))
      fail('ORIGINAL_AGENT_D6_SCHEMA_CONFLICT');
    for(const row of rows)if(!row.includes(schema))row.push(schema);
    if(existing===undefined)passport.schemas[schema]=declaration;
  }
  const operations=passport.permissions.operations;
  if(operations!==undefined&&(!Array.isArray(operations)||
      operations.length>1||
      operations.some(op=>op!=='t1.commitObjectGraph')))
    fail('ORIGINAL_AGENT_D6_ATOMIC_OPERATION_CONFLICT');
  // Reuse the original T2 graph command, never an Agent-side Kernel writer.
  // No implicit Workspace creation or other operation is granted.
  passport.permissions.operations=['t1.commitObjectGraph'];
  enableInstalledBusinessExchange(passport,'iwxa.personal-agent.workspace');
}

const allowedAssetExtensions=new Set([
  '.js','.mjs','.css','.json','.wasm','.png','.svg','.webp','.ico','.woff2',
]);
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const fail=code=>{throw Error('T3_D1_DIST_'+code);};
function inside(root,path){
  const diff=relative(root,path);
  return diff!==''&&diff!=='..'&&!diff.startsWith('..'+sep)&&!isAbsolute(diff);
}
function files(root){
  const result=[];
  const visit=dir=>{
    for(const item of readdirSync(dir,{withFileTypes:true})){
      const path=join(dir,item.name);
      if(item.isSymbolicLink())fail('SYMLINK_FORBIDDEN');
      if(item.isDirectory())visit(path);
      else if(item.isFile())result.push(path);
      else fail('UNSUPPORTED_ENTRY');
      if(result.length>50000)fail('TOO_MANY_FILES');
    }
  };
  visit(root);
  return result.sort();
}
function originFrom(domain){
  return domain?.domain?.origin||domain?.runtime?.origin||domain?.origin||null;
}
function required(root,path){
  const target=join(root,path);
  if(!existsSync(target)||!statSync(target).isFile())fail('MISSING_'+path);
  return target;
}
export function assembleSignedControlDist({
  t2Dist,t3Build,outputDir,testOnlyUnqualifiedFixture=false,
  installedOriginalAdminD3=false,installedOriginalAgentD6=false,
  desktopAgentControlOnly=false,desktopAdminControlOnly=false,qualificationKernelCandidate,
  androidAgentAssets=false,
}={}){
  // The installed Capacitor asset origin is not an externally deployed
  // website or the desktop signed native owner. Its original T2/T3 Host
  // must use the same qualified Kernel at exactly https://localhost.
  if(typeof androidAgentAssets!=="boolean"||
      (androidAgentAssets&&(qualificationKernelCandidate||testOnlyUnqualifiedFixture||installedOriginalAdminD3||
        installedOriginalAgentD6||desktopAgentControlOnly||desktopAdminControlOnly)))
    fail("ANDROID_AGENT_ASSET_PROFILE_INVALID");
  // A signed desktop Agent hosts T3 D1/D6 but owns native model execution
  // independently. An inert optional BLI marker is not permission to ship
  // a partially compiled WebGPU Worker. This explicit Agent-only profile
  // remains separate from the standard fail-closed browser BLI profile.
  if(typeof desktopAgentControlOnly!=="boolean"||
      (desktopAgentControlOnly&&
        (!installedOriginalAgentD6||installedOriginalAdminD3||
         testOnlyUnqualifiedFixture)))
    fail("DESKTOP_AGENT_SIGNED_CONTROL_PROFILE_INVALID");
  // Desktop Admin D3 is another ORIGINAL signed Windows product: its
  // browser Workspace remains a Control surface. WebGPU/BLI belongs to
  // browser domain D5, not the Windows Admin product's native signing flow.
  // The opt-in profile never relaxes the ordinary domain or Agent builds.
  if(typeof desktopAdminControlOnly!=="boolean"||
      (desktopAdminControlOnly&&
        (!installedOriginalAdminD3||installedOriginalAgentD6||
         desktopAgentControlOnly||testOnlyUnqualifiedFixture)))
    fail("DESKTOP_ADMIN_SIGNED_CONTROL_PROFILE_INVALID");
  if(typeof installedOriginalAdminD3!=="boolean")
    fail("INSTALLED_ADMIN_D3_FLAG_INVALID");
  if(typeof installedOriginalAgentD6!=="boolean")
    fail("INSTALLED_AGENT_D6_FLAG_INVALID");
  if(installedOriginalAdminD3&&installedOriginalAgentD6)
    fail("INSTALLED_OWNER_PROFILES_MUST_BE_SEPARATE");
  const candidate=selectQualificationKernelCandidate(qualificationKernelCandidate);
  if(candidate&&(testOnlyUnqualifiedFixture||!(desktopAgentControlOnly||desktopAdminControlOnly)))
    fail('CANDIDATE_NATIVE_CORPORATE_QUALIFICATION_ONLY');
  if(![t2Dist,t3Build,outputDir].every(x=>typeof x==='string'&&x.trim()))
    fail('THREE_PATHS_REQUIRED');
  const source=realpathSync(resolve(t2Dist));
  const compiled=realpathSync(resolve(t3Build));
  const output=resolve(outputDir);
  if(source===compiled||output===source||output===compiled||
      inside(source,output)||inside(compiled,output)||
      inside(output,source)||inside(output,compiled))fail('OVERLAPPING_PATHS');
  if(existsSync(output))fail('OUTPUT_ALREADY_EXISTS');
  files(source); // reject symlinks before copying the inherited runtime
  // Do not label an arbitrary runtime "original T2" just because copying
  // preserves its bytes. Reuse the exact inherited T2 qualified verifier and
  // release pin. The test-only fixture switch is never available from CLI.
  const qualified=testOnlyUnqualifiedFixture ? null :
    assertInstalledOriginalKernelArtifact(source,qualificationKernelCandidate);
  const originalLoader=required(source,'_iwxa/loader.js');
  const originalRuntime=required(source,'_iwxa/runtime/0.3.6/runtime.js');
  const domain=JSON.parse(readFileSync(required(source,'_iwxa/domain.json'),'utf8'));
  const origin=originFrom(domain);
  // Ordinary HTTPS domains use their OWN product origin; native Windows
  // signers remain on their original loopback origin.
  let parsed;
  try{parsed=new URL(origin);}catch{fail('PRODUCT_ORIGIN_REQUIRED');}
  const loopback=parsed.protocol==='http:'&&parsed.hostname==='127.0.0.1'&&
    Number(parsed.port)>=1&&Number(parsed.port)<=65535;
  const web=parsed.protocol==='https:'&&Boolean(parsed.hostname)&&
    parsed.hostname!=='localhost';
  if(parsed.origin!==origin||
     (androidAgentAssets?origin!=='https://localhost':
       (!loopback&&((installedOriginalAgentD6||installedOriginalAdminD3)||!web))))
    fail('PRODUCT_PINNED_HTTPS_OR_NATIVE_LOOPBACK_ORIGIN_REQUIRED');
  const domainShell=JSON.parse(readFileSync(
    required(source,'_iwxa/domain-shell.json'),'utf8'));
  if((web||androidAgentAssets)&&domainShell.origin!==origin)
    fail('WEB_DOMAIN_SHELL_ORIGIN_MISMATCH');
  const catalog=JSON.parse(readFileSync(required(source,'_iwxa/service-catalog.json'),'utf8'));
  const config=JSON.parse(readFileSync(required(source,'workspace/workspace.config.json'),'utf8'));
  if(candidate){
    const expected=desktopAgentControlOnly?'iwxa.personal-agent':'iwxa.admin-center';
    if(!loopback||domain.domain_id!==expected||config.domain_id!==expected||
       config.workspace_service_id!==expected+'.workspace'||domain.status==='production')
      fail('CANDIDATE_NATIVE_CORPORATE_PROFILE_REQUIRED');
  }
  if(typeof config.workspace_service_id!=='string'||
     !Array.isArray(catalog.entries)||
     !catalog.entries.some(x=>x.service_id===config.workspace_service_id))
    fail('ORIGINAL_WORKSPACE_SERVICE_REQUIRED');
  if(androidAgentAssets&&(
      domain.domain_id!=='iwxa.personal-agent'||
      domainShell.domain_id!==domain.domain_id||
      config.domain_id!==domain.domain_id||
      config.workspace_service_id!=='iwxa.personal-agent.workspace'||
      domain.service_worker?.mode!=='disabled'||
      domain.security?.module_service_worker!==false||
      domain.security?.allow_secrets!==false||
      config.host?.direct_indexeddb!==false||
      config.host?.required_contract_version!=='1.3.0'||
      config.host?.required_runtime_version!=='0.3.6'))
    fail('ANDROID_AGENT_ORIGINAL_PRODUCT_REQUIRED');
  const signedHtml=readFileSync(required(compiled,'signed-workspace.html'),'utf8');
  const isolatedHtml=readFileSync(required(compiled,'isolated-signed-workspace.html'),'utf8');
  const trustedHtml=readFileSync(required(compiled,'trusted-kernel-realm.html'),'utf8');
  for(const [kind,html]of [['SIGNED',signedHtml],['ISOLATED',isolatedHtml],['TRUSTED_REALM',trustedHtml]]){
    if(!html.includes('<base href="/workspace/"')||
       !/\b(?:src|href)="\/workspace\/assets\/[A-Za-z0-9_.\/-]+"/.test(html))
      fail('COMPILED_'+kind+'_ENTRY_REQUIRED');
  }
  const assetRoot=join(compiled,'assets');
  if(!existsSync(assetRoot)||!lstatSync(assetRoot).isDirectory())
    fail('COMPILED_ASSETS_REQUIRED');
  const assets=files(assetRoot);
  if(!assets.length)fail('COMPILED_ASSETS_REQUIRED');
  for(const path of assets){
    if(!allowedAssetExtensions.has(extname(path).toLowerCase())||path.endsWith('.map'))
      fail('UNSUPPORTED_SIGNED_ASSET');
  }
  // A compiled Worker is not an activated Workspace module. Declare BLI
  // only when the complete source-pinned module + Worker are in this build.
  // Fail closed on partial builds rather than publishing a dead launcher.
  const jsBodies=assets.filter(path=>extname(path)==='.js')
    .map(path=>readFileSync(path,'utf8'));
  const markers=['iwxa.t3.local-inference.panel',
    'iwxa.t3.local-inference.launcher','iwxa.t3.local-inference.open'];
  const marks=markers.map(marker=>jsBodies.some(body=>body.includes(marker)));
  const workers=assets.filter(path=>
    /^model-worker-[A-Za-z0-9_-]+\.js$/.test(basename(path)));
  if(desktopAgentControlOnly&&workers.length!==0)
    fail("DESKTOP_AGENT_WEBGPU_WORKER_FORBIDDEN");
  if(desktopAdminControlOnly&&workers.length!==0)
    fail("DESKTOP_ADMIN_WEBGPU_WORKER_FORBIDDEN");
  // The Agent-owned Android module contributes the EXISTING D5 panel IDs,
  // but uses the installed Capacitor plugin, not WebLLM or a second engine.
  const androidNativeMarker=jsBodies.some(body=>body.includes("IWXA_ANDROID_NATIVE_INFERENCE_V1"));
  if(androidNativeMarker&&!androidAgentAssets)
    fail("ANDROID_NATIVE_INFERENCE_WRONG_PRODUCT");
  const androidNativeInference=androidAgentAssets&&androidNativeMarker;
  const androidConversationArchive=jsBodies.some(body=>body.includes("IWXA_ANDROID_CONVERSATION_ARCHIVE_V1"));
  if(androidConversationArchive&&!androidNativeInference)fail("ANDROID_CONVERSATION_ARCHIVE_WRONG_PRODUCT");
  if(androidAgentAssets&&(workers.length!==0||
      (androidNativeInference?marks.some(mark=>!mark):marks.some(Boolean))))
    fail("ANDROID_AGENT_BROWSER_OR_INCOMPLETE_INFERENCE_FORBIDDEN");
  const localInference=(desktopAgentControlOnly||desktopAdminControlOnly||androidAgentAssets)
    ?false:marks.some(Boolean)||workers.length>0;
  if(localInference && (workers.length!==1||marks.some(mark=>!mark)||
      !readFileSync(workers[0],'utf8').includes('IWXA_NETWORK_DENIED_IN_WORKER')))
    fail('LOCAL_INFERENCE_COMPILED_MODULE_INCOMPLETE');
  let servicePassport=null,passportPath=null,serviceEntry=null;
  if(localInference||androidNativeInference||installedOriginalAdminD3||installedOriginalAgentD6){
    serviceEntry=catalog.entries.find(row=>
      row.service_id===config.workspace_service_id);
    passportPath=serviceEntry?.file;
    if(typeof passportPath!=='string'||
       !/^_iwxa\/services\/[A-Za-z0-9_.-]+\.json$/.test(passportPath))
      fail('ORIGINAL_SERVICE_PASSPORT_PATH');
    const passportFile=required(source,passportPath);
    if(serviceEntry.sha256!==hash(passportFile))
      fail('ORIGINAL_SERVICE_PASSPORT_INTEGRITY');
    servicePassport=JSON.parse(readFileSync(passportFile,'utf8'));
    if(localInference||androidNativeInference)
      registerT3LocalInferenceService({domain,workspaceConfig:config,
        passport:servicePassport,androidNativeInference,androidConversationArchive});
    if(installedOriginalAdminD3)
      registerInstalledAdminAppliedResult({domain,config,passport:servicePassport});
    if(installedOriginalAgentD6)
      registerInstalledAgentAcceptedResult({domain,config,passport:servicePassport});
  }
  // Keep the original product entry first. Only exact installed product IDs
  // get the second original T2 service connection. Web domains are unchanged.
  const exchangeServiceId=!androidAgentAssets&&servicePassport&&companyExchangeServiceId(servicePassport.service_id);
  let exchangePassport=null,exchangePath=null,exchangeControl=null;
  if(exchangeServiceId){
    if(!Array.isArray(domain.modules)||!domain.modules.some(m=>m.service_id===servicePassport.service_id)||
       domain.modules.some(m=>m.service_id===exchangeServiceId)||
       catalog.entries.some(m=>m.service_id===exchangeServiceId))fail("COMPANY_EXCHANGE_CONFIG_COLLISION");
    exchangePassport=originalCompanyExchangePassport(servicePassport);
    exchangePath="_iwxa/services/"+exchangeServiceId+".json";
    if(existsSync(join(source,exchangePath)))fail("COMPANY_EXCHANGE_PASSPORT_COLLISION");
    exchangeControl=JSON.parse(readFileSync(required(source,"_iwxa/security/capability-control-plane.json"),"utf8"));
    if(!Array.isArray(exchangeControl.services)||exchangeControl.services.some(s=>s.service_id===exchangeServiceId)||
       !exchangeControl.services.some(s=>s.service_id===servicePassport.service_id))fail("COMPANY_EXCHANGE_CONTROL_REQUIRED");
    domain.modules.push({service_id:exchangeServiceId,base_path:"/workspace/"});
    exchangeControl.services.push({schema_version:"0.3.1",service_id:exchangeServiceId,
      capability_control:"NONE",capability_ceiling:[],activation_any_of:[],operation_guards:[]});
  }
  const staged=[];
  for(const path of assets){
    const dest=join('workspace','assets',relative(assetRoot,path));
    if(!inside(resolve(source),resolve(source,dest)))fail('ASSET_PATH_ESCAPE');
    const existing=join(source,dest);
    if(existsSync(existing)){
      if(!statSync(existing).isFile()||hash(existing)!==hash(path))
        fail('SIGNED_ASSET_COLLISION');
    }
    staged.push({source:path,dest});
  }
  for(const [file,html]of [
    ['signed-workspace.html',signedHtml],
    ['isolated-signed-workspace.html',isolatedHtml],
    ['trusted-kernel-realm.html',trustedHtml],
  ]){
    const target=join(source,'workspace',file);
    if(existsSync(target)&&readFileSync(target,'utf8')!==html)
      fail('SIGNED_ENTRY_COLLISION');
  }
  // A web product receives the actual T3 Workspace, Exchange, Lifecycle
  // and Studio pages. Preserve its ORIGINAL site index.html and original T2
  // Host/Store; never reuse the native Agent placeholder as a domain shell.
  const webEntries=(web||androidAgentAssets)?[
    ['index.html','index.html','/workspace/'],
    ['exchange/index.html','exchange/index.html','/workspace/exchange/'],
    ['lifecycle/index.html','lifecycle/index.html','/workspace/lifecycle/'],
    ['studio/index.html','studio/index.html','/workspace/studio/'],
  ]:[];
  const compiledWebEntries=webEntries.map(([from,to,base])=>{
    const html=readFileSync(required(compiled,from),'utf8');
    if(!html.includes('<base href="'+base+'"')||
       (!html.includes('src="/workspace/assets/')&&
        !html.includes('href="/workspace/assets/')))
      fail('COMPILED_WEB_WORKSPACE_ENTRY_REQUIRED:'+from);
    return {to,html};
  });
  const favicon=join(source,'workspace/favicon.ico');
  const compiledFavicon=join(compiled,'favicon.ico');
  if(!existsSync(favicon)&&!existsSync(compiledFavicon))fail('SIGNED_FAVICON_REQUIRED');

  // Only publish after ALL source/preflight checks and copy operations pass.
  const temp=output+'.building-'+randomUUID();
  mkdirSync(dirname(output),{recursive:true});
  try{
    cpSync(source,temp,{recursive:true,errorOnExist:true,force:false});
    mkdirSync(join(temp,'workspace/assets'),{recursive:true});
    writeFileSync(join(temp,'workspace/signed-workspace.html'),signedHtml);
    writeFileSync(join(temp,'workspace/isolated-signed-workspace.html'),isolatedHtml);
    writeFileSync(join(temp,'workspace/trusted-kernel-realm.html'),trustedHtml);
    for(const item of staged){
      mkdirSync(dirname(join(temp,item.dest)),{recursive:true});
      copyFileSync(item.source,join(temp,item.dest));
    }
    for(const page of compiledWebEntries){
      const destination=join(temp,'workspace',page.to);
      mkdirSync(dirname(destination),{recursive:true});
      writeFileSync(destination,page.html);
    }
    if(!existsSync(join(temp,'workspace/favicon.ico')))
      copyFileSync(compiledFavicon,join(temp,'workspace/favicon.ico'));
    if(localInference||androidNativeInference||installedOriginalAdminD3||installedOriginalAgentD6){
      // Adjust only assembled configuration/permissions and update the
      // original service-catalog integrity digest for the new passport.
      writeFileSync(join(temp,'_iwxa/domain.json'),JSON.stringify(domain));
      writeFileSync(join(temp,'workspace/workspace.config.json'),JSON.stringify(config));
      writeFileSync(join(temp,passportPath),JSON.stringify(servicePassport));
      serviceEntry.sha256=hash(join(temp,passportPath));
      if(exchangePassport){
        writeFileSync(join(temp,exchangePath),JSON.stringify(exchangePassport),{flag:"wx"});
        catalog.entries.push({service_id:exchangePassport.service_id,
          service_version:exchangePassport.service_version,base_path:exchangePassport.base_path,
          supported_levels:exchangePassport.supported_levels,file:exchangePath,
          sha256:hash(join(temp,exchangePath))});
        writeFileSync(join(temp,"_iwxa/security/capability-control-plane.json"),JSON.stringify(exchangeControl));
      }
      writeFileSync(join(temp,'_iwxa/service-catalog.json'),JSON.stringify({
        ...catalog,count:catalog.entries.length,
      }));
    }
    if(hash(join(temp,'_iwxa/loader.js'))!==hash(originalLoader)||
       hash(join(temp,'_iwxa/runtime/0.3.6/runtime.js'))!==hash(originalRuntime))
      fail('ORIGINAL_KERNEL_CHANGED');
    // Browser domains leave this SAME dist with its final site, Workspace,
    // original Kernel/Exchange and one explicit offline T3 switch.
    // No native Agent or Admin signer is staged into a browser domain.
    if(web&&!androidAgentAssets)materializeDomainMode(temp);
    if(candidate){
      const readback=assertInstalledOriginalKernelArtifact(temp,qualificationKernelCandidate);
      if(readback.artifactSha256!==qualified.artifactSha256)fail('ORIGINAL_KERNEL_CHANGED');
    }
    if(existsSync(output))fail('OUTPUT_ALREADY_EXISTS');
    renameSync(temp,output);
    return {schema:'iwxa.t3.signed-control-one-dist/1',origin,
      workspace_service_id:config.workspace_service_id,
      signed_assets:staged.length,isolated_realm_entries:true,original_kernel:'0.3.6',
      local_inference_registered:localInference,
      original_admin_d3_schema_registered:installedOriginalAdminD3,
      original_agent_d6_schema_registered:installedOriginalAgentD6,
      original_qualified_artifact:candidate?null:(qualified?.artifactId??'TEST_ONLY_UNQUALIFIED'),
      ...qualificationKernelCandidateFields(qualified),
      original_loader_sha256:hash(originalLoader),
      original_runtime_sha256:hash(originalRuntime),
      original_runtime_unchanged:true,
      autonomous_domain_mode_staged:web&&!androidAgentAssets,
      ...(androidAgentAssets?{android_agent_assets_staged:true,
        native_model_bridge_registered:androidNativeInference,
        ...(androidConversationArchive?{conversation_archive_registered:true}:{}),
        signed_native_owner_registered:false}:{}),output};
  }catch(error){rmSync(temp,{recursive:true,force:true});throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  const qualificationKernelCandidate=takeQualificationKernelCandidate(args);
  if(args.length!==3&&
      !(args.length===4&&
        ['--installed-admin-d3','--installed-agent-d6',
         '--installed-admin-d3-control-only'].includes(args[3])))
    fail('USAGE_T2_DIST_T3_BUILD_OUTPUT');
  console.log(JSON.stringify(assembleSignedControlDist({
    t2Dist:args[0],t3Build:args[1],outputDir:args[2],qualificationKernelCandidate,
    installedOriginalAdminD3:
      ['--installed-admin-d3','--installed-admin-d3-control-only']
        .includes(args[3]),
    desktopAdminControlOnly:
      args[3]==='--installed-admin-d3-control-only',
    installedOriginalAgentD6:args[3]==='--installed-agent-d6',
  })));
}
