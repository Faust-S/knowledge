#!/usr/bin/env node
// Product-specific delivery of the EXISTING T2 qualified One Dist to Agent.
// This is only an immutable build recipe around the original T2/T3 assembler.
// It creates no Kernel/Host/Store/Exchange, signer, identity, or archive codec.
import {readFileSync,writeFileSync,existsSync,mkdirSync,rmSync,
  mkdtempSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {dirname,resolve,relative,isAbsolute,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {assembleSignedControlDist} from './assemble-signed-control-dist.mjs';
import {assertInstalledOriginalKernelArtifact,takeQualificationKernelCandidate}
  from './installed-kernel-selection.mjs';
import {BASE_KERNEL_ARTIFACT,qualificationKernelCandidateFields}
  from './installed-kernel-candidate.mjs';
import {stageVerifiedKernelFiles} from './stage-verified-kernel.mjs';

const PRODUCT='iwxa.personal-agent';
const fail=code=>{throw Error('T3_AGENT_ONE_DIST_'+code);};
const inside=(root,child)=>{
  const delta=relative(root,child);
  return delta===''||(!delta.startsWith('..')&&!isAbsolute(delta));
};
const readJson=path=>JSON.parse(readFileSync(path,'utf8'));

/** Validate the *real* Agent T2 product identity, not a qualified
 * integration.workspace.iwxa.test kernel fixture. Original T2 product
 * completion and runtime digest verification remain the assembler's job.
 */
export function requireOriginalAgentT2Product(t2Dist){
  const root=resolve(t2Dist);
  const domain=readJson(resolve(root,'_iwxa/domain.json'));
  const config=readJson(resolve(root,'workspace/workspace.config.json'));
  const service=config?.workspace_service_id;
  if(domain?.domain_id!==PRODUCT||config?.domain_id!==PRODUCT||
     typeof service!=='string'||!service.startsWith(PRODUCT)||
     !Array.isArray(domain?.modules)||
     !domain.modules.some(m=>m?.service_id===service)||
     domain?.runtime?.kernel_release!=='0.3.6'||
     domain?.runtime?.runtime_version!=='0.3.6'||
     config?.host?.required_contract_version!=='1.3.0'||
     config?.host?.required_runtime_version!=='0.3.6')
    fail('ORIGINAL_PRODUCT_IDENTITY_OR_RUNTIME_REQUIRED');
  return Object.freeze({productId:PRODUCT,serviceId:service});
}

/** The product authority lives in the Agent checkout. Only immutable
 * qualified ORIGINAL T2 Kernel bytes come from the shared One Core. These
 * declarations configure an ordinary original T2 service, not a new Host,
 * Kernel, signed policy, publisher, receipt or application Store. */
function originalAgentProfile(path){
  const file=resolve(path);
  if(!existsSync(file)||lstatSync(file).isSymbolicLink()||
     !lstatSync(file).isFile())fail('OWNING_AGENT_PROFILE_REQUIRED');
  const profile=readJson(file);
  const expected=['schema','productId','serviceId','configVersion','origin',
    'workspaceProfile','localStoreName','kernelVersion','runtimeContract',
    'qualifiedArtifactId','authorizedNativeOwner',
    'authorizedResultRecipient','installedAgentT3Mode'];
  if(Object.keys(profile).sort().join()!==expected.sort().join()||
     profile.schema!=='IWXA_AGENT_ORIGINAL_T2_PRODUCT_PROFILE/1'||
     profile.productId!==PRODUCT||
     profile.serviceId!=='iwxa.personal-agent.workspace'||
     profile.configVersion!=='0.6.0'||
     !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(profile.origin)||
     Number(new URL(profile.origin).port)<1||
     Number(new URL(profile.origin).port)>65534||
     profile.workspaceProfile!=='generic'||
     profile.localStoreName!=='iwxa-local'||
     profile.kernelVersion!=='0.3.6'||
     profile.runtimeContract!=='1.3.0'||
     profile.qualifiedArtifactId!==
       'iwxa-kernel-k036-same-store-history-20261019-qualified.1'||
     profile.authorizedNativeOwner!=='ORIGINAL_T3_SIGNED_EMPLOYEE'||
     // Product-neutral One Dist has NO implied Atlas or other recipient.
     // Each native recipient needs original signed D1 and explicit disclosure.
     profile.authorizedResultRecipient!==null||
     profile.installedAgentT3Mode!=='EXPLICIT_OPT_IN')
    fail('OWNING_AGENT_PRODUCT_PROFILE_INVALID');
  return profile;
}

/** Stage an actual Agent T2 product service using the ORIGINAL qualified
 * Runtime 1.3.0, the original T2 config schema and the Agent-owned profile.
 * The prior generic T2 structure provides config syntax only; no synthetic
 * domain identity, test data, mock access, or fake receipt survives staging.
 */
export async function materializeOriginalAgentT2Product({
  qualifiedKernelDist,agentProfile,outputRoot,qualificationKernelCandidate,
}={}){
  if(![qualifiedKernelDist,agentProfile,outputRoot].every(
      x=>typeof x==='string'&&x.trim()))fail('PRODUCT_STAGE_INPUTS_REQUIRED');
  const original=resolve(qualifiedKernelDist),stage=resolve(outputRoot);
  const profile=originalAgentProfile(agentProfile);
  const shared=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const root=resolve(shared,'..','..');
  if(existsSync(stage)||[original,resolve(agentProfile),shared,root]
    .some(p=>inside(p,stage)||inside(stage,p)))
    fail('PRODUCT_STAGE_MUST_BE_FRESH_AND_OUTSIDE_SOURCE');
  const verified=assertInstalledOriginalKernelArtifact(original,qualificationKernelCandidate);
  const templates=resolve(shared,'fixtures/host-configs/generic');
  const domain=readJson(resolve(templates,'domain.json'));
  const shell=readJson(resolve(templates,'domain-shell.json'));
  const config=readJson(resolve(templates,'workspace.config.json'));
  domain.config_version=profile.configVersion;
  domain.status='development';
  domain.domain_id=profile.productId;
  domain.origin=profile.origin;
  domain.local_store_name=profile.localStoreName;
  domain.workspace_profile=profile.workspaceProfile;
  domain.brand='IWXA Personal Agent';
  domain.runtime={...domain.runtime,kernel_release:'0.3.6',
    runtime_version:'0.3.6',local_store_version:'6',
    package_version:'1.1',current_manifest_path:'/_iwxa/current.json'};
  domain.modules=[{service_id:profile.serviceId,base_path:'/workspace/'}];
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
    release_must_exclude:['/tests/','/artifacts/'],
    backup_before_upload:true};
  shell.config_version=profile.configVersion;
  shell.domain_id=profile.productId;
  shell.origin=profile.origin;
  shell.brand={name:'IWXA Personal Agent',short_name:'IWXA',
    descriptor:'Original signed personal Task and Result Workspace',
    home_path:'/workspace/',logo_path:'/workspace/favicon.ico',
    favicon_path:'/workspace/favicon.ico'};
  config.config_version=profile.configVersion;
  config.domain_id=profile.productId;
  config.workspace_service_id=profile.serviceId;
  config.profile=profile.workspaceProfile;
  config.host={required_contract_version:'1.3.0',
    required_runtime_version:'0.3.6',
    local_store_name:profile.localStoreName,
    storage_access:'iwxa-client-only',direct_indexeddb:false};
  const passport={
    service_id:profile.serviceId,service_version:profile.configVersion,
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
  const servicePath='_iwxa/services/'+profile.serviceId+'.json';
  const passportBytes=Buffer.from(JSON.stringify(passport));
  const catalog={count:1,entries:[{
    service_id:profile.serviceId,service_version:profile.configVersion,
    base_path:'/workspace/',supported_levels:['T0','T1','T2'],
    file:servicePath,sha256:createHash('sha256').update(passportBytes)
      .digest('hex'),
  }]};
  const control={
    schema_version:'0.3.1',snapshot_id:'iwxa-personal-agent-original-t2-0.6',
    resolver_id:'iwxa.personal-agent.original-t2',
    trusted_issuers:[],issuance_policies:[],
    services:[{schema_version:'0.3.1',service_id:profile.serviceId,
      capability_control:'NONE',capability_ceiling:[],activation_any_of:[],
      operation_guards:[]}],
  };
  const write=(rel,value)=>{
    const path=resolve(stage,rel);
    mkdirSync(dirname(path),{recursive:true});
    writeFileSync(path,typeof value==='string'?value:JSON.stringify(value),
      {flag:'wx'});
  };
  mkdirSync(stage,{recursive:false});
  try{
    // Original qualified file digests are verified once on source and
    // again after install. The original bytes are not reconstructed.
    stageVerifiedKernelFiles(original,stage,verified.files);
    write('_iwxa/domain.json',domain);
    write('_iwxa/domain-shell.json',shell);
    write('workspace/workspace.config.json',config);
    write(servicePath,passportBytes.toString('utf8'));
    write('_iwxa/service-catalog.json',catalog);
    write('_iwxa/security/capability-control-plane.json',control);
    write('_iwxa/tokens.css',':root{font-family:system-ui,sans-serif;}\n');
    write('workspace/index.html',
      '<!doctype html><html lang="ru"><meta charset="utf-8">'+
      '<title>IWXA Personal Agent</title><p>Откройте подписанную Workspace через приложение IWXA Agent.</p></html>');
    const validator=await import(pathToFileURL(
      resolve(stage,'_iwxa/validator.js')).href);
    const result=validator.validateDomainConfig(domain,{
      current_origin:profile.origin});
    if(result?.ok!==true)fail('ORIGINAL_T2_DOMAIN_VALIDATION_FAILED');
    const final=assertInstalledOriginalKernelArtifact(stage,qualificationKernelCandidate);
    if(final.artifactSha256!==verified.artifactSha256)fail('INHERITED_KERNEL_BYTES_CHANGED');
    return Object.freeze({productId:PRODUCT,serviceId:profile.serviceId,
      origin:profile.origin,verifiedKernel:true,
      originalQualifiedArtifactId:verified.releaseAccepted===false?null:verified.artifactId,
      ...qualificationKernelCandidateFields(verified),
      outputRoot:stage});
  }catch(error){rmSync(stage,{recursive:true,force:true});throw error;}
}

/** Assemble ONE original signed T2/T3 product without manufacturing
 * access, signed receipts, a second runtime, or a synthetic Host.
 */
export async function buildOriginalAgentOneDistFromQualifiedKernel({
  qualifiedKernelDist,agentProfile,t3Build,outputDir,receiptPath,
  desktopAgentControlOnly=false,qualificationKernelCandidate,installedNetworkPilotRole=null,
}={}){
  if(installedNetworkPilotRole!==null&&(installedNetworkPilotRole!=='SOURCE'||desktopAgentControlOnly!==true))
    fail('INSTALLED_T4_PILOT_PROFILE_REQUIRED');
  const staged=mkdtempSync(join(tmpdir(),'iwxa-agent-original-t2-'));
  try{
    const source=resolve(staged,'agent-original-dist');
    const product=await materializeOriginalAgentT2Product({
      qualifiedKernelDist,agentProfile,outputRoot:source,qualificationKernelCandidate});
    const built=buildOriginalAgentOneDist({
      t2Dist:source,t3Build,outputDir,receiptPath,
      desktopAgentControlOnly,qualificationKernelCandidate,installedNetworkPilotRole});
    return Object.freeze({...built,origin:product.origin,
      originalProductId:product.productId,verifiedOriginalT2:true});
  }finally{rmSync(staged,{recursive:true,force:true});}
}

/** Use only the original qualified assembler and return its native receipt.
 * A new recipient never gets implied rights from these build-time bytes.
 */
export function buildOriginalAgentOneDist({
  t2Dist,t3Build,outputDir,receiptPath,desktopAgentControlOnly=false,qualificationKernelCandidate,
  installedNetworkPilotRole=null,
}={}){
  if(typeof desktopAgentControlOnly!=="boolean")
    fail("DESKTOP_AGENT_CONTROL_FLAG_INVALID");
  if(installedNetworkPilotRole!==null&&(installedNetworkPilotRole!=='SOURCE'||!desktopAgentControlOnly))
    fail('INSTALLED_T4_PILOT_PROFILE_REQUIRED');
  if(![t2Dist,t3Build,outputDir,receiptPath].every(
     x=>typeof x==='string'&&x.trim()))fail('FOUR_PATHS_REQUIRED');
  const source=resolve(t2Dist),compiled=resolve(t3Build);
  const output=resolve(outputDir),receipt=resolve(receiptPath);
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..','..','..');
  if([output,receipt].some(p=>inside(root,p)||inside(source,p)||
     inside(compiled,p))||inside(output,receipt)||inside(receipt,output)||
     output===receipt||existsSync(output)||existsSync(receipt))
    fail('IMMUTABLE_OUTPUT_OUTSIDE_SOURCE_REQUIRED');
  requireOriginalAgentT2Product(source);
  const selected=assertInstalledOriginalKernelArtifact(source,qualificationKernelCandidate);
  const candidate=selected.releaseAccepted===false;
  // No testOnlyUnqualifiedFixture. The exact original 0.3.6 Runtime 1.3.0
  // qualified digest, service passport and compiled source are checked by
  // the existing assembler, and the original Agent D6 schema is registered.
  const original=assembleSignedControlDist({t2Dist:source,t3Build:compiled,
    outputDir:output,installedOriginalAgentD6:true,
    desktopAgentControlOnly,qualificationKernelCandidate,installedNetworkPilotRole});
  if(original.original_t4_pilot_role!==installedNetworkPilotRole||original.original_runtime_unchanged!==true||
     original.original_agent_d6_schema_registered!==true||
     original.workspace_service_id!==
       readJson(resolve(output,'workspace/workspace.config.json')).workspace_service_id||
     (candidate?(original.original_qualified_artifact!==null||
       original.original_kernel_candidate_artifact!==selected.artifactId||
       original.original_kernel_candidate_archive_sha256!==selected.archiveSha256||
       original.original_kernel_release_accepted!==false):
       original.original_qualified_artifact!==BASE_KERNEL_ARTIFACT)){
    rmSync(output,{recursive:true,force:true});
    fail('ORIGINAL_QUALIFIED_ASSEMBLY_REQUIRED');
  }
  try{
    mkdirSync(dirname(receipt),{recursive:true});
    writeFileSync(receipt,JSON.stringify(original,null,2)+'\n',
      {encoding:'utf8',flag:'wx'});
  }catch(error){
    rmSync(output,{recursive:true,force:true});
    throw error;
  }
  return Object.freeze({schema:original.schema,productId:PRODUCT,
    original_qualified_artifact:original.original_qualified_artifact,
    ...qualificationKernelCandidateFields(selected),
    original_agent_d6_schema_registered:true,original_runtime_unchanged:true,
    original_t4_pilot_role:installedNetworkPilotRole,
    output,receipt});
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  const qualificationKernelCandidate=takeQualificationKernelCandidate(args);
  const desktopAgentControlOnly=args.at(-1)==='--desktop-agent-control';
  if(desktopAgentControlOnly)args.pop();
  const valid=['--t2-dist','--t3-build','--output','--receipt',
    '--qualified-kernel-dist','--agent-profile','--installed-network-pilot-role'];
  if(![8,10,12].includes(args.length)||
     args.some((v,i)=>i%2===0&&!valid.includes(v))||
     new Set(args.filter((_,i)=>i%2===0)).size!==args.length/2)
    fail('USAGE_T2_DIST_OR_QUALIFIED_KERNEL_WITH_AGENT_PROFILE');
  const opts=Object.fromEntries(args.filter((_,i)=>i%2===0)
    .map((key,i)=>[key,args[2*i+1]]));
  const qualified=Object.hasOwn(opts,'--qualified-kernel-dist');
  const product=Object.hasOwn(opts,'--agent-profile');
  if(qualified!==product||
     (qualified===Object.hasOwn(opts,'--t2-dist'))||
     !['--t3-build','--output','--receipt'].every(k=>Object.hasOwn(opts,k)))
    fail('PRODUCT_INPUT_MODE_INVALID');
  const installedNetworkPilotRole=opts['--installed-network-pilot-role']??null;
  if(installedNetworkPilotRole!==null&&(installedNetworkPilotRole!=='SOURCE'||!desktopAgentControlOnly))
    fail('INSTALLED_T4_PILOT_PROFILE_REQUIRED');
  const argsCommon={t3Build:opts['--t3-build'],
    outputDir:opts['--output'],receiptPath:opts['--receipt'],
    desktopAgentControlOnly,qualificationKernelCandidate,installedNetworkPilotRole};
  const result=qualified
    ?await buildOriginalAgentOneDistFromQualifiedKernel({
      ...argsCommon,qualifiedKernelDist:opts['--qualified-kernel-dist'],
      agentProfile:opts['--agent-profile']})
    :buildOriginalAgentOneDist({...argsCommon,t2Dist:opts['--t2-dist']});
  process.stdout.write(JSON.stringify(result)+'\n');
}
