#!/usr/bin/env node
// A final-release CANDIDATE of the EXISTING original T2/T3 One Dist.
// The only assembler remains assembleSignedControlDist. No new Kernel,
// Store, Exchange, format, signer or copied model weights are introduced.
// Usage: npm run package:t3:candidate -- <qualified-t2-dist> <compiled-t3-build>
//   <new-output-directory> <0.x.y-rc.z> <one-core-source-sha> <t2-source-sha>
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,
  rmSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assembleSignedControlDist} from './assemble-signed-control-dist.mjs';
import {collectDirectoryEntries,readStoredZip,writeStoredZip}
  from './zip-store.mjs';

const id=/^[a-f0-9]{40}$/;
const candidate=/^0\.[0-9]+\.[0-9]+-rc\.[1-9][0-9]*$/;
const fail=code=>{throw Error('T3_ONE_DIST_CANDIDATE_'+code);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
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
export function manifestForOneDist(entries,{version,oneCoreSha,t2Sha,assembled}){
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
  const files=entries.map(x=>({
    path:x.name,bytes:x.bytes.length,sha256:hash(x.bytes),
  })).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  return {
    schema:'IWXA_T3_ONE_DIST_RELEASE_CANDIDATE/1',
    status:'CANDIDATE_NOT_FINAL',
    version,
    releaseSubject:'ONE_ORIGINAL_T2_T3_HOST_KERNEL_STORE_EXCHANGE_LIFECYCLE',
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
}={}){
  if(![qualifiedT2Dist,compiledT3Build,outputRoot].every(
    x=>typeof x==='string'&&x.trim()))
    fail('THREE_SOURCE_PATHS_REQUIRED');
  const t2=resolve(qualifiedT2Dist),t3=resolve(compiledT3Build),
    output=resolve(outputRoot);
  if(existsSync(output)||[t2,t3].some(src=>inside(src,output)||
     inside(output,src))||t2===t3)
    fail('OUTPUT_MUST_BE_NEW_OUTSIDE_SOURCES');
  // Reject malformed release metadata BEFORE performing any writes.
  if(!candidate.test(version)||!id.test(oneCoreSha)||!id.test(t2Sha))
    fail('VERSION_AND_SOURCE_PINS_REQUIRED');
  mkdirSync(dirname(output),{recursive:true});
  mkdirSync(output);
  try{
    const dist=join(output,'one-dist');
    const assembled=assembleSignedControlDist({
      t2Dist:t2,t3Build:t3,outputDir:dist,
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
    const manifest=manifestForOneDist(raw,{
      version,oneCoreSha,t2Sha,assembled,
    });
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
    oneCoreSha,t2Sha]=process.argv.slice(2);
  if(process.argv.length!==8)fail('USAGE_SIX_ARGUMENTS_REQUIRED');
  process.stdout.write(JSON.stringify(prepareT3OneDistCandidate({
    qualifiedT2Dist,compiledT3Build,outputRoot,version,oneCoreSha,t2Sha,
  }))+'\n');
}
