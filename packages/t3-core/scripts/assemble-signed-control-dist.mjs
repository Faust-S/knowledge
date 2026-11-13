#!/usr/bin/env node
// T3 D1 local Control packager: extend the ORIGINAL T2 one-dist with the
// compiled signed Workspace entry. No new Kernel, Store or second Host.
import {createHash, randomUUID} from 'node:crypto';
import {cpSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync,
  readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, extname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertQualifiedKernelArtifact}
  from '../src/factory2/products/domain-completion/independent-browser-witness.mjs';
import {registerT3LocalInferenceService}
  from './register-t3-local-inference.mjs';

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
}={}){
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
    assertQualifiedKernelArtifact(source,{
      kernel:'0.3.6',contract:'1.3.0',
      artifactId:'iwxa-kernel-k036-same-store-history-20261019-qualified.1',
    });
  const originalLoader=required(source,'_iwxa/loader.js');
  const originalRuntime=required(source,'_iwxa/runtime/0.3.6/runtime.js');
  const domain=JSON.parse(readFileSync(required(source,'_iwxa/domain.json'),'utf8'));
  const origin=originFrom(domain);
  if(typeof origin!=='string'||!/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/.test(origin)||
     Number(new URL(origin).port)<1||Number(new URL(origin).port)>65535||
     new URL(origin).origin!==origin)fail('PINNED_LOOPBACK_ORIGIN_REQUIRED');
  required(source,'_iwxa/domain-shell.json');
  const catalog=JSON.parse(readFileSync(required(source,'_iwxa/service-catalog.json'),'utf8'));
  const config=JSON.parse(readFileSync(required(source,'workspace/workspace.config.json'),'utf8'));
  if(typeof config.workspace_service_id!=='string'||
     !Array.isArray(catalog.entries)||
     !catalog.entries.some(x=>x.service_id===config.workspace_service_id))
    fail('ORIGINAL_WORKSPACE_SERVICE_REQUIRED');
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
    /^model-worker-[A-Za-z0-9_-]+\\.js$/.test(basename(path)));
  const localInference=marks.some(Boolean)||workers.length>0;
  if(localInference && (workers.length!==1||marks.some(mark=>!mark)||
      !readFileSync(workers[0],'utf8').includes('IWXA_NETWORK_DENIED_IN_WORKER')))
    fail('LOCAL_INFERENCE_COMPILED_MODULE_INCOMPLETE');
  let servicePassport=null,passportPath=null,serviceEntry=null;
  if(localInference){
    serviceEntry=catalog.entries.find(row=>
      row.service_id===config.workspace_service_id);
    passportPath=serviceEntry?.file;
    if(typeof passportPath!=='string'||
       !/^_iwxa\\/services\\/[A-Za-z0-9_.-]+\\.json$/.test(passportPath))
      fail('ORIGINAL_SERVICE_PASSPORT_PATH');
    const passportFile=required(source,passportPath);
    if(serviceEntry.sha256!==hash(passportFile))
      fail('ORIGINAL_SERVICE_PASSPORT_INTEGRITY');
    servicePassport=JSON.parse(readFileSync(passportFile,'utf8'));
    registerT3LocalInferenceService({domain,workspaceConfig:config,
      passport:servicePassport});
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
    if(!existsSync(join(temp,'workspace/favicon.ico')))
      copyFileSync(compiledFavicon,join(temp,'workspace/favicon.ico'));
    if(localInference){
      // Adjust only assembled configuration/permissions and update the
      // original service-catalog integrity digest for the new passport.
      writeFileSync(join(temp,'_iwxa/domain.json'),JSON.stringify(domain));
      writeFileSync(join(temp,'workspace/workspace.config.json'),JSON.stringify(config));
      writeFileSync(join(temp,passportPath),JSON.stringify(servicePassport));
      serviceEntry.sha256=hash(join(temp,passportPath));
      writeFileSync(join(temp,'_iwxa/service-catalog.json'),JSON.stringify({
        ...catalog,count:catalog.entries.length,
      }));
    }
    if(hash(join(temp,'_iwxa/loader.js'))!==hash(originalLoader)||
       hash(join(temp,'_iwxa/runtime/0.3.6/runtime.js'))!==hash(originalRuntime))
      fail('ORIGINAL_KERNEL_CHANGED');
    if(existsSync(output))fail('OUTPUT_ALREADY_EXISTS');
    renameSync(temp,output);
    return {schema:'iwxa.t3.signed-control-one-dist/1',origin,
      workspace_service_id:config.workspace_service_id,
      signed_assets:staged.length,isolated_realm_entries:true,original_kernel:'0.3.6',
      local_inference_registered:localInference,
      original_qualified_artifact:qualified?.artifactId??'TEST_ONLY_UNQUALIFIED',
      original_loader_sha256:hash(originalLoader),
      original_runtime_sha256:hash(originalRuntime),
      original_runtime_unchanged:true,output};
  }catch(error){rmSync(temp,{recursive:true,force:true});throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==5)fail('USAGE_T2_DIST_T3_BUILD_OUTPUT');
  console.log(JSON.stringify(assembleSignedControlDist({
    t2Dist:process.argv[2],t3Build:process.argv[3],outputDir:process.argv[4],
  })));
}
