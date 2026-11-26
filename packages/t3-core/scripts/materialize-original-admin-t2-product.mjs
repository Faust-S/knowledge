#!/usr/bin/env node
// Installed Admin Center product's ORIGINAL T2 service/configuration stage.
// Exactly the inherited qualified 0.3.6 Kernel/Host/validator bytes are copied
// and reverified. Neither a TEST integration.workspace identity nor a second
// Core, IAM, Store, Registry, signed key or .iwxa codec is created.
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,rmSync,writeFileSync}
  from 'node:fs';
import {dirname,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {assertInstalledOriginalKernelArtifact,takeQualificationKernelCandidate}
  from './installed-kernel-selection.mjs';
import {qualificationKernelCandidateFields} from './installed-kernel-candidate.mjs';
import {stageVerifiedKernelFiles} from './stage-verified-kernel.mjs';

const PRODUCT='iwxa.admin-center';
const SERVICE='iwxa.admin-center.workspace';
const ARTIFACT='iwxa-kernel-k036-same-store-history-20261019-qualified.1';
const fail=code=>{throw Error('T3_ADMIN_ORIGINAL_T2_'+code);};
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const inside=(root,child)=>{
  const diff=relative(root,child);
  return diff===''||(!diff.startsWith('..')&&!isAbsolute(diff));
};
function requireAdminProfile(file){
  if(!existsSync(file)||!lstatSync(file).isFile()||
     lstatSync(file).isSymbolicLink())fail('OWNING_CENTER_PROFILE_REQUIRED');
  const p=json(file);
  const keys=['schema','productId','serviceId','configVersion','origin',
    'workspaceProfile','localStoreName','kernelVersion','runtimeContract',
    'qualifiedArtifactId','authorizedNativeOwner','installedAdminT3Mode'];
  if(!p||typeof p!=='object'||Array.isArray(p)||
     JSON.stringify(Object.keys(p).sort())!==JSON.stringify([...keys].sort())||
     p.schema!=='IWXA_ADMIN_ORIGINAL_T2_PRODUCT_PROFILE/1'||
     p.productId!==PRODUCT||p.serviceId!==SERVICE||
     p.configVersion!=='0.3.0-dev.1'||
     typeof p.origin!=='string'||
     !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(p.origin)||
     Number(new URL(p.origin).port)>65535||
     new URL(p.origin).origin!==p.origin||
     p.workspaceProfile!=='generic'||p.localStoreName!=='iwxa-local'||
     p.kernelVersion!=='0.3.6'||p.runtimeContract!=='1.3.0'||
     p.qualifiedArtifactId!==ARTIFACT||
     p.authorizedNativeOwner!=='ORIGINAL_T3_SIGNED_ADMIN'||
     p.installedAdminT3Mode!=='EXPLICIT_OPT_IN')
    fail('OWNING_CENTER_PROFILE_INVALID');
  return p;
}
export async function materializeOriginalAdminT2Product({
  qualifiedKernelDist,centerProfile,outputRoot,qualificationKernelCandidate,
}={}){
  if(![qualifiedKernelDist,centerProfile,outputRoot].every(
    value=>typeof value==='string'&&value.trim()))
    fail('SOURCE_PROFILE_OUTPUT_REQUIRED');
  const original=resolve(qualifiedKernelDist);
  const profilePath=resolve(centerProfile);
  const target=resolve(outputRoot);
  const shared=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const publicRoot=resolve(shared,'..','..');
  if(existsSync(target)||[original,profilePath,shared,publicRoot].some(
      source=>inside(source,target)||inside(target,source)))
    fail('FRESH_TARGET_OUTSIDE_SOURCES_REQUIRED');
  const profile=requireAdminProfile(profilePath);
  const verified=assertInstalledOriginalKernelArtifact(original,qualificationKernelCandidate);
  const templates=resolve(shared,'fixtures/host-configs/generic');
  const domain=json(resolve(templates,'domain.json'));
  const shell=json(resolve(templates,'domain-shell.json'));
  const config=json(resolve(templates,'workspace.config.json'));
  domain.config_version=profile.configVersion;
  domain.status='development';
  domain.domain_id=PRODUCT;
  domain.origin=profile.origin;
  domain.local_store_name=profile.localStoreName;
  domain.workspace_profile=profile.workspaceProfile;
  domain.brand='IWXA Admin Center';
  domain.runtime={...domain.runtime,kernel_release:'0.3.6',
    runtime_version:'0.3.6',local_store_version:'6',
    package_version:'1.1',current_manifest_path:'/_iwxa/current.json'};
  domain.modules=[{service_id:SERVICE,base_path:'/workspace/'}];
  domain.enabled_profiles=['generic'];
  domain.enabled_capabilities=['T0','T1','T2'];
  domain.handoff={enabled:false,receive_path:'/_iwxa/handoff/receive',
    allowed_origins:[],require_preview:true,default_expiry_seconds:3600};
  domain.service_worker={mode:'disabled',future_path:'/iwxa-sw.js',
    future_scope:'/'};
  domain.diagnostics={enabled:false,path:'/_iwxa/diagnostics/'};
  domain.security={allow_secrets:false,publish_source_maps:false,
    directory_listing:false,robots_indexing:false,
    direct_indexeddb_for_modules:false,module_service_worker:false,
    allowed_object_classes:[]};
  domain.release={deployment_mode:'overlay',
    preserve_paths:['/_iwxa/domain.json','/workspace/'],
    release_must_exclude:['/tests/','/artifacts/'],backup_before_upload:true};
  shell.config_version=profile.configVersion;
  shell.domain_id=PRODUCT;
  shell.origin=profile.origin;
  shell.brand={name:'IWXA Admin Center',short_name:'IWXA',
    descriptor:'Подписанная рабочая область руководителя',
    home_path:'/workspace/',logo_path:'/workspace/favicon.ico',
    favicon_path:'/workspace/favicon.ico'};
  config.config_version=profile.configVersion;
  config.domain_id=PRODUCT;
  config.workspace_service_id=SERVICE;
  config.profile='generic';
  config.host={required_contract_version:'1.3.0',
    required_runtime_version:'0.3.6',
    local_store_name:'iwxa-local',
    storage_access:'iwxa-client-only',direct_indexeddb:false};
  const passport={
    service_id:SERVICE,service_version:profile.configVersion,
    base_path:'/workspace/',supported_levels:['T0','T1','T2'],
    input_object_types:[],output_object_types:[],schemas:{},
    permissions:{
      workspace:{list:true,read:true,create:true,soft_delete:false,
        restore:false,purge:false},
      objects:{read:[],write:[],delete:[]},
      events:{read_scope:'workspace'},
      packages:{export:false,import:false,
        export_scope:'readable_objects',import_scope:'writable_objects'},
    },
  };
  const servicePath='_iwxa/services/'+SERVICE+'.json';
  const serviceBytes=Buffer.from(JSON.stringify(passport));
  const catalog={count:1,entries:[{
    service_id:SERVICE,service_version:profile.configVersion,
    base_path:'/workspace/',supported_levels:['T0','T1','T2'],
    file:servicePath,
    sha256:createHash('sha256').update(serviceBytes).digest('hex'),
  }]};
  const control={
    schema_version:'0.3.1',
    snapshot_id:'iwxa-admin-center-original-t2-0.3',
    resolver_id:'iwxa.admin-center.original-t2',
    trusted_issuers:[],issuance_policies:[],
    services:[{schema_version:'0.3.1',service_id:SERVICE,
      capability_control:'NONE',capability_ceiling:[],
      activation_any_of:[],operation_guards:[]}],
  };
  const write=(name,value)=>{
    const path=resolve(target,name);
    mkdirSync(dirname(path),{recursive:true});
    writeFileSync(path,typeof value==='string'?value:JSON.stringify(value),
      {flag:'wx'});
  };
  mkdirSync(target,{recursive:false});
  try{
    stageVerifiedKernelFiles(original,target,verified.files);
    write('_iwxa/domain.json',domain);
    write('_iwxa/domain-shell.json',shell);
    write('workspace/workspace.config.json',config);
    write(servicePath,serviceBytes.toString('utf8'));
    write('_iwxa/service-catalog.json',catalog);
    write('_iwxa/security/capability-control-plane.json',control);
    write('_iwxa/tokens.css',':root{font-family:system-ui,sans-serif;}\n');
    write('workspace/index.html',
      '<!doctype html><html lang="ru"><meta charset="utf-8">'+
      '<title>IWXA Admin Center</title>'+
      '<p>Откройте подписанную Workspace в установленном Admin Center.</p></html>');
    const validator=await import(pathToFileURL(
      resolve(target,'_iwxa/validator.js')).href);
    const check=validator.validateDomainConfig(domain,{
      current_origin:profile.origin});
    if(check?.ok!==true)fail('INHERITED_DOMAIN_VALIDATION_FAILED');
    const final=assertInstalledOriginalKernelArtifact(target,qualificationKernelCandidate);
    if(final.artifactSha256!==verified.artifactSha256)
      fail('INHERITED_KERNEL_BYTES_CHANGED');
    return Object.freeze({
      productId:PRODUCT,serviceId:SERVICE,origin:profile.origin,
      originalQualifiedArtifactId:verified.releaseAccepted===false?null:verified.artifactId,
      ...qualificationKernelCandidateFields(verified),
      originalKernelBytesUnchanged:true,installedAdminT3Mode:'EXPLICIT_OPT_IN',
      outputRoot:target,
    });
  }catch(error){rmSync(target,{recursive:true,force:true});throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  const qualificationKernelCandidate=takeQualificationKernelCandidate(args);
  if(args.length!==3)fail('USAGE_KERNEL_CENTER_PROFILE_OUTPUT');
  materializeOriginalAdminT2Product({
    qualifiedKernelDist:args[0],centerProfile:args[1],
    outputRoot:args[2],qualificationKernelCandidate,
  }).then(result=>console.log(JSON.stringify(result)),
    error=>{const msg=String(error?.message??'');
      console.error(/^T3_ADMIN_ORIGINAL_T2_[A-Z0-9_]+$/.test(msg)
        ?msg:'T3_ADMIN_ORIGINAL_T2_STAGE_FAILED');
      process.exitCode=1;});
}
