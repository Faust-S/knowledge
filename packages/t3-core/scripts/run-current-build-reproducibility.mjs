#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {dirname,relative,resolve,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const scriptPath=fileURLToPath(import.meta.url);
const canonicalRoot=dirname(dirname(scriptPath));

function sha256Bytes(data){
  return createHash('sha256').update(data).digest('hex');
}

export function buildInvocation(platform=process.platform,comspec=process.env.ComSpec){
  if(platform==='win32'){
    return Object.freeze({
      command:comspec||'cmd.exe',
      args:Object.freeze(['/d','/s','/c','npm run build']),
    });
  }
  return Object.freeze({command:'npm',args:Object.freeze(['run','build'])});
}

export function digestTree(rootArg){
  const root=resolve(rootArg);
  if(!existsSync(root)||!statSync(root).isDirectory()) throw new Error(`BUILD_TREE_MISSING:${root}`);
  const files=[];
  const walk=(dir)=>{
    for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      const full=resolve(dir,entry.name);
      if(entry.isSymbolicLink()) throw new Error(`BUILD_TREE_SYMLINK_FORBIDDEN:${full}`);
      if(entry.isDirectory()) walk(full);
      else if(entry.isFile()) files.push(full);
      else throw new Error(`BUILD_TREE_ENTRY_UNSUPPORTED:${full}`);
    }
  };
  walk(root);
  const aggregate=createHash('sha256');
  const entries=files.map((full)=>{
    const path=relative(root,full).split(sep).join('/');
    const data=readFileSync(full);
    const sha256=sha256Bytes(data);
    aggregate.update(Buffer.from(path,'utf8'));
    aggregate.update(Buffer.from([0]));
    aggregate.update(Buffer.from(String(data.length),'ascii'));
    aggregate.update(Buffer.from([0]));
    aggregate.update(Buffer.from(sha256,'ascii'));
    aggregate.update(Buffer.from([10]));
    return {path,sizeBytes:data.length,sha256};
  });
  return {sha256:aggregate.digest('hex'),fileCount:entries.length,entries};
}

function runBuild(root){
  const dist=resolve(root,'dist');
  rmSync(dist,{recursive:true,force:true});
  const invocation=buildInvocation();
  const result=spawnSync(invocation.command,invocation.args,{cwd:root,encoding:'utf8',shell:false,maxBuffer:32*1024*1024});
  if(result.error) throw new Error(`CURRENT_BUILD_SPAWN_FAILED:${result.error.message}`);
  if(result.status!==0) throw new Error(`CURRENT_BUILD_FAILED:${result.status}:${result.stderr||result.stdout}`);
  return digestTree(dist);
}

export function makeReceipt({root,first,second}){
  const lockPath=resolve(root,'package-lock.json');
  if(!existsSync(lockPath)) throw new Error('CURRENT_BUILD_PACKAGE_LOCK_MISSING');
  if(first.sha256!==second.sha256||first.fileCount!==second.fileCount){
    throw new Error(`CURRENT_BUILD_NOT_REPRODUCIBLE:${first.sha256}:${second.sha256}`);
  }
  return {
    schema:'IWXA_T2_CURRENT_BUILD_REPRODUCIBILITY_V1',
    status:'PASS',
    installAuthority:'NPM_CI_EXACT_PACKAGE_LOCK',
    packageLockSha256:sha256Bytes(readFileSync(lockPath)),
    buildCommand:'npm run build',
    buildCount:2,
    buildTreeSha256:first.sha256,
    buildFileCount:first.fileCount,
    buildsByteEquivalent:true,
    historicalRecoveryRequired:false,
    release_ready:false,
    productionDeploy:false,
    projectProcessWriteActivation:false,
  };
}

function main(){
  const evidenceArg=process.argv[2];
  if(!evidenceArg){
    console.error('usage: node run-current-build-reproducibility.mjs <evidence-json>');
    process.exit(2);
  }
  try{
    if(!existsSync(resolve(canonicalRoot,'node_modules'))) throw new Error('CURRENT_BUILD_NODE_MODULES_MISSING_RUN_NPM_CI_FIRST');
    const first=runBuild(canonicalRoot);
    const second=runBuild(canonicalRoot);
    const receipt=makeReceipt({root:canonicalRoot,first,second});
    const evidence=resolve(evidenceArg);
    mkdirSync(dirname(evidence),{recursive:true});
    writeFileSync(evidence,JSON.stringify(receipt,null,2)+'\n','utf8');
    console.log(JSON.stringify(receipt,null,2));
  }catch(error){
    console.error(error?.stack||String(error));
    process.exit(1);
  }
}

if(process.argv[1]&&resolve(process.argv[1])===scriptPath) main();
