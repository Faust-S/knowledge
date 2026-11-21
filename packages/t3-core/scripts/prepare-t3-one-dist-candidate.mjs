#!/usr/bin/env node
// A final-release CANDIDATE of the EXISTING original T2/T3 One Dist.
// The only assembler remains assembleSignedControlDist. No new Kernel,
// Store, Exchange, format, signer or copied model weights are introduced.
// Usage: npm run package:t3:candidate -- <qualified-t2-dist> <compiled-t3-build>
//   <new-output-directory> <0.x.y-rc.z> <one-core-source-sha> <t2-source-sha>
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,
  rmSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assembleSignedControlDist} from './assemble-signed-control-dist.mjs';
import {collectDirectoryEntries,readStoredZip,writeStoredZip}
  from './zip-store.mjs';

const id=/^[a-f0-9]{40}$/;
const candidate=/^0\.[0-9]+\.[0-9]+-rc\.[1-9][0-9]*$/;
const PRODUCT_AGENT='iwxa.personal-agent';
const fail=code=>{throw Error('T3_ONE_DIST_CANDIDATE_'+code);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
// Check the code we are packaging, not a historical SHA supplied by CI.
// This does not claim to verify the original T2 source pin: the inherited
// runtime still uses its own qualified original T2 artifact verifier.
function requireExactOneCoreSource(sha){
  const checkout=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
  let actual;
  try{
    actual=execFileSync('git',['rev-parse','HEAD'],{
      cwd:checkout,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  }catch{fail('EXACT_SOURCE_CHECKOUT_REQUIRED');}
  if(actual!==sha)fail('EXECUTABLE_SOURCE_PIN_MISMATCH');
}
function inside(root,child){
  const path=relative(root,child);
  return path===''||(
    path!=='..'&&!path.startsWith('..'+sep)&&!isAbsolute(path));
}
function noSymlinks(root){
  let count=0;
  function walk(path){
    const stat=lstatSync(path);
    if(stat.isSymbolicLink())fail('SYMLINK_IN_RELEASE');
    if(stat.isDirectory()){
      for(const name of readdirSync(path))walk(join(path,name));
    }else if(!stat.isFile())fail('NONFILE_IN_RELEASE');
    else if(++count>65500)fail('ZIP_ENTRY_COUNT_EXCEEDED');
  }
  walk(root);
  return count;
}
export function manifestForOneDist(entries,{version,oneCoreSha,t2Sha,assembled,product}){
  if(!candidate.test(version)||!id.test(oneCoreSha)||!id.test(t2Sha)||
     assembled?.original_runtime_unchanged!==true||
     assembled?.original_qualified_artifact!==
       'iwxa-kernel-k036-same-store-history-20261019-qualified.1')
    fail('VERIFIED_SOURCE_AND_RUNTIME_REQUIRED');
  if(!Array.isArray(entries)||entries.length===0||entries.length>65500||
     entries.some(x=>typeof x?.name!=='string'||
       !x.name.startsWith('one-dist/')||
       !Buffer.isBuffer(x.bytes)))
    fail('ARCHIVE_ENTRY_INVALID');
  const names=entries.map(x=>x.name);
  if(new Set(names).size!==names.length||
     names.some(p=>p.includes('..')||p.includes('\\')||p.startsWith('/')))
    fail('ARCHIVE_PATH_INVALID');
  for(const path of [
    'one-dist/_iwxa/loader.js',
    'one-dist/_iwxa/runtime/0.3.6/runtime.js',
    'one-dist/workspace/workspace.config.json',
    'one-dist/workspace/signed-workspace.html',
  ])if(!names.includes(path))fail('INCOMPLETE_ORIGINAL_ONE_DIST');
  let originValid=false;
  try{
    const url=new URL(product?.origin);
    const localhost=url.protocol==='http:'&&url.hostname==='127.0.0.1'&&
      Number(url.port)>=1&&Number(url.port)<=65535;
    const web=product?.assemblyProfile==='signed-control'&&
      url.protocol==='https:'&&Boolean(url.hostname)&&
      url.hostname!=='localhost';
    originValid=url.origin===product.origin&&(localhost||web);
  }catch{/* invalid product origin stays rejected */}
  if(!product||typeof product.id!=='string'||!product.id.trim()||
     !originValid||
     typeof product.serviceId!=='string'||!product.serviceId.trim()||
     typeof product.assemblyProfile!=='string'||
     !['signed-control','agent-d6','agent-d6-desktop'].includes(product.assemblyProfile)||
     (product.assemblyProfile.startsWith('agent-d6')&&
       (product.id!==PRODUCT_AGENT||
        assembled.original_agent_d6_schema_registered!==true))||
     (product.assemblyProfile==='agent-d6-desktop'&&
       assembled.local_inference_registered!==false))
    fail('PRODUCT_OWNED_T2_SERVICE_REQUIRED');
  // A browser deployment is a full product with its site, original T2
  // Kernel, and built T3 Workspace/Exchange/Lifecycle/Studio. The installed
  // Agent and Admin profiles deliberately keep their native launch pages.
  if(product.assemblyProfile==='signed-control'&&
     product.origin.startsWith('https://')){
    const requiredWeb=[
      'one-dist/index.html','one-dist/workspace/index.html',
      'one-dist/workspace/exchange/index.html',
      'one-dist/workspace/lifecycle/index.html',
      'one-dist/workspace/studio/index.html',
    ];
    if(requiredWeb.some(path=>!names.includes(path)))
      fail('INCOMPLETE_WEB_ONE_DIST');
  }
  const files=entries.map(x=>({
    path:x.name,bytes:x.bytes.length,sha256:hash(x.bytes),
  })).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  return {
    schema:'IWXA_T3_ONE_DIST_RELEASE_CANDIDATE/1',
    status:'CANDIDATE_NOT_FINAL',
    version,
    releaseSubject:'PRODUCT_OWNED_ONE_ORIGINAL_T2_T3_HOST_KERNEL_STORE_EXCHANGE_LIFECYCLE',
    productId:product.id,
    productOrigin:product.origin,
    workspaceServiceId:product.serviceId,
    assemblyProfile:product.assemblyProfile,
    sourcePins:{executableOneCore:oneCoreSha,originalT2:t2Sha},
    provenanceStatus:'PIN_ASSERTED_REQUIRES_INDEPENDENT_SOURCE_CI',
    originalKernel:'0.3.6',runtimeContract:'1.3.0',
    qualifiedOriginalArtifact:assembled.original_qualified_artifact,
    originalRuntimeSha256:assembled.original_runtime_sha256,
    originalLoaderSha256:assembled.original_loader_sha256,
    modelWeightsEmbedded:false,
    domainMigrationAllowed:false,
    fileCount:files.length,
    totalBytes:files.reduce((acc,x)=>acc+x.bytes,0),
    files,
  };
}
export function prepareT3OneDistCandidate({
  qualifiedT2Dist,compiledT3Build,outputRoot,version,oneCoreSha,t2Sha,
  assemblyProfile='signed-control',
}={}){
  if(![qualifiedT2Dist,compiledT3Build,outputRoot].every(
    x=>typeof x==='string'&&x.trim()))
    fail('THREE_SOURCE_PATHS_REQUIRED');
  const t2=resolve(qualifiedT2Dist),t3=resolve(compiledT3Build),
    output=resolve(outputRoot);
  if(existsSync(output)||[t2,t3].some(src=>inside(src,output)||
     inside(output,src))||t2===t3)
    fail('OUTPUT_MUST_BE_NEW_OUTSIDE_SOURCES');
  // An original T2 Kernel ZIP is not itself a deployable product. Require
  // the product-owned domain, service passport and pinned origin. This
  // prevents manufacturing a misleading cross-domain "universal ZIP".
  if(!candidate.test(version)||!id.test(oneCoreSha)||!id.test(t2Sha))
    fail('VERSION_AND_SOURCE_PINS_REQUIRED');
  if(!['signed-control','agent-d6','agent-d6-desktop'].includes(assemblyProfile))
    fail('ASSEMBLY_PROFILE_INVALID');
  requireExactOneCoreSource(oneCoreSha);
  let originalDomain,originalConfig;
  try{
    originalDomain=JSON.parse(readFileSync(join(t2,'_iwxa/domain.json'),'utf8'));
    originalConfig=JSON.parse(readFileSync(join(t2,'workspace/workspace.config.json'),'utf8'));
  }catch{fail('ORIGINAL_PRODUCT_T2_STAGE_REQUIRED');}
  if(typeof originalDomain?.domain_id!=='string'||
     typeof originalConfig?.workspace_service_id!=='string'||
     originalDomain.domain_id!==originalConfig.domain_id||
     (assemblyProfile.startsWith('agent-d6')&&originalDomain.domain_id!==PRODUCT_AGENT))
    fail('ORIGINAL_PRODUCT_IDENTITY_MISMATCH');
  mkdirSync(dirname(output),{recursive:true});
  mkdirSync(output);
  try{
    const dist=join(output,'one-dist');
    const assembled=assembleSignedControlDist({
      t2Dist:t2,t3Build:t3,outputDir:dist,
      installedOriginalAgentD6:assemblyProfile.startsWith('agent-d6'),
      desktopAgentControlOnly:assemblyProfile==='agent-d6-desktop',
    });
    if(!assembled||assembled.original_runtime_unchanged!==true)
      fail('ORIGINAL_RUNTIME_CHANGED');
    noSymlinks(dist);
    const raw=collectDirectoryEntries(dist,'one-dist/');
    if(raw.reduce((n,x)=>n+x.bytes.length,0)>256*1024*1024)
      fail('RELEASE_TOO_LARGE');
    // Explicitly do not ship model weights. Installation is opt-in and local.
    if(raw.some(x=>/\.(?:gguf|safetensors|pt|pth|onnx)$/i.test(x.name)))
      fail('MODEL_WEIGHTS_EMBEDDED');
    if(assemblyProfile==='agent-d6-desktop'&&raw.some(x=>
      /\/model-worker-[A-Za-z0-9_-]+\.js$/.test(x.name)))
      fail('DESKTOP_AGENT_WEBGPU_WORKER_FORBIDDEN');
    const domain=JSON.parse(readFileSync(join(dist,'_iwxa/domain.json'),'utf8'));
    const config=JSON.parse(readFileSync(join(dist,'workspace/workspace.config.json'),'utf8'));
    const manifest=manifestForOneDist(raw,{
      version,oneCoreSha,t2Sha,assembled,
      product:{id:domain.domain_id,origin:domain.origin,
        serviceId:config.workspace_service_id,assemblyProfile},
    });
    // The original T2 source SHA is still an external pin; the inherited
    // qualified T2 artifact and exact executable T3 Git checkout are checked.
    // Do not label this candidate a final, independently accepted release.
    manifest.provenanceStatus=
      'EXECUTABLE_ONE_CORE_GIT_HEAD_VERIFIED_T2_SOURCE_PIN_ASSERTED';
    const zipPath=join(output,'t3-one-dist-'+version+'.zip');
    writeStoredZip(zipPath,raw);
    const zipEntries=readStoredZip(zipPath);
    if(zipEntries.size!==raw.length)fail('ZIP_FILE_COUNT_CHANGED');
    for(const row of manifest.files){
      const data=zipEntries.get(row.path);
      if(!data||data.length!==row.bytes||hash(data)!==row.sha256)
        fail('ZIP_READBACK_CHANGED');
    }
    const manifestPath=join(output,'t3-one-dist-manifest.json');
    const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n','utf8');
    writeFileSync(manifestPath,bytes,{flag:'wx'});
    const zipHash=hash(readFileSync(zipPath)),manifestHash=hash(bytes);
    writeFileSync(join(output,'SHA256SUMS.txt'),
      zipHash+'  '+zipPath.split(sep).at(-1)+'\n'+
      manifestHash+'  t3-one-dist-manifest.json\n',{flag:'wx'});
    return Object.freeze({
      schema:manifest.schema,status:manifest.status,
      version,files:manifest.fileCount,bytes:manifest.totalBytes,
      archiveSha256:zipHash,manifestSha256:manifestHash,
      outputRoot:output,
    });
  }catch(error){
    rmSync(output,{recursive:true,force:true});
    throw error;
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [qualifiedT2Dist,compiledT3Build,outputRoot,version,
    oneCoreSha,t2Sha,flag]=process.argv.slice(2);
  if(![8,9].includes(process.argv.length)||
     (flag!==undefined&&!['--installed-agent-d6',
       '--installed-agent-d6-control-only'].includes(flag)))
    fail('USAGE_PRODUCT_T2_DIST_T3_BUILD_OUTPUT_AND_OPTIONAL_AGENT');
  process.stdout.write(JSON.stringify(prepareT3OneDistCandidate({
    qualifiedT2Dist,compiledT3Build,outputRoot,version,oneCoreSha,t2Sha,
    assemblyProfile:flag==='--installed-agent-d6-control-only'
      ?'agent-d6-desktop':flag==='--installed-agent-d6'
        ?'agent-d6':'signed-control',
  }))+'\n');
}
