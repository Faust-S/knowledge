#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,relative,resolve,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {npmInvocation} from './run-current-nonwindows-qualification.mjs';

const scriptPath=fileURLToPath(import.meta.url);
const root=dirname(dirname(scriptPath));
const packagePath=resolve(root,'package.json');
const lockPath=resolve(root,'package-lock.json');

export const CURRENT_CACHE_TOOLCHAIN=Object.freeze({
  nodeVersion:'v24.18.1',
  npmVersion:'11.16.0',
});

function sha256Bytes(bytes){
  return createHash('sha256').update(bytes).digest('hex');
}

function runText(command,args,{cwd=root,label='command'}={}){
  const result=spawnSync(command,args,{
    cwd,
    encoding:'utf8',
    shell:false,
    stdio:'pipe',
    maxBuffer:8*1024*1024,
  });
  if(result.error) throw new Error(`CURRENT_DEPENDENCY_CACHE_SPAWN_FAILED:${label}:${result.error.message}`);
  if(result.status!==0){
    throw new Error(`CURRENT_DEPENDENCY_CACHE_COMMAND_FAILED:${label}:${result.status}:${result.stderr||result.stdout}`);
  }
  return String(result.stdout??'').trim();
}

function runNpm(args,{cwd,label}={}){
  const invocation=npmInvocation(args);
  return runText(invocation.command,invocation.args,{cwd,label});
}

function collectFiles(folder,rootFolder=folder,out=[]){
  if(!existsSync(folder)) return out;
  for(const entry of readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const path=resolve(folder,entry.name);
    if(entry.isDirectory()) collectFiles(path,rootFolder,out);
    else if(entry.isFile()){
      out.push({
        path:relative(rootFolder,path).split(sep).join('/'),
        absolute:path,
        size:statSync(path).size,
      });
    }
  }
  return out;
}

export function digestCache(cacheDir){
  const cacache=resolve(cacheDir,'_cacache');
  if(!existsSync(cacache)) throw new Error('CURRENT_DEPENDENCY_CACHE_CACACHE_MISSING');
  const files=collectFiles(cacache);
  if(files.length===0) throw new Error('CURRENT_DEPENDENCY_CACHE_EMPTY');
  const aggregate=createHash('sha256');
  const entries=files.map((file)=>{
    const sha256=sha256Bytes(readFileSync(file.absolute));
    aggregate.update(file.path).update('\0').update(String(file.size)).update('\0').update(sha256).update('\0');
    return Object.freeze({path:file.path,size:file.size,sha256});
  });
  return Object.freeze({
    schema:'IWXA_T2_CURRENT_DEPENDENCY_CACHE_DIGEST_V1',
    fileCount:entries.length,
    sha256:aggregate.digest('hex'),
    entries:Object.freeze(entries),
  });
}

export function pathOutsideRoot(pathValue,rootValue){
  const rootPath=resolve(rootValue);
  const candidate=resolve(pathValue);
  const rel=relative(rootPath,candidate);
  return rel!==''&&(rel==='..'||rel.startsWith('..'+sep));
}

function assertExactToolchain(){
  if(process.version!==CURRENT_CACHE_TOOLCHAIN.nodeVersion){
    throw new Error(`CURRENT_DEPENDENCY_CACHE_NODE_VERSION_MISMATCH:${process.version}`);
  }
  const npmVersion=runNpm(['--version'],{label:'npm-version'});
  if(npmVersion!==CURRENT_CACHE_TOOLCHAIN.npmVersion){
    throw new Error(`CURRENT_DEPENDENCY_CACHE_NPM_VERSION_MISMATCH:${npmVersion}`);
  }
  return npmVersion;
}

function stageManifest(folder){
  mkdirSync(folder,{recursive:true});
  copyFileSync(packagePath,resolve(folder,'package.json'));
  copyFileSync(lockPath,resolve(folder,'package-lock.json'));
}

function verifyStagedLock(folder,expected){
  const actual=sha256Bytes(readFileSync(resolve(folder,'package-lock.json')));
  if(actual!==expected) throw new Error('CURRENT_DEPENDENCY_CACHE_STAGED_LOCK_MUTATED');
}

function main(){
  const cacheArg=process.argv[2];
  const receiptArg=process.argv[3];
  if(!cacheArg||!receiptArg){
    console.error('usage: node scripts/prepare-current-dependency-cache.mjs <cache-dir-outside-worktree> <receipt-json-outside-worktree>');
    process.exit(2);
  }
  const cacheDir=resolve(cacheArg);
  const receiptPath=resolve(receiptArg);
  const gitRoot=runText('git',['rev-parse','--show-toplevel'],{label:'git-worktree-root'});
  if(!pathOutsideRoot(cacheDir,gitRoot)) throw new Error('CURRENT_DEPENDENCY_CACHE_INSIDE_WORKTREE_FORBIDDEN');
  if(!pathOutsideRoot(receiptPath,gitRoot)) throw new Error('CURRENT_DEPENDENCY_CACHE_RECEIPT_INSIDE_WORKTREE_FORBIDDEN');
  if(existsSync(receiptPath)) throw new Error('CURRENT_DEPENDENCY_CACHE_RECEIPT_ALREADY_EXISTS');

  const originalLockSha256=sha256Bytes(readFileSync(lockPath));
  const npmVersion=assertExactToolchain();
  mkdirSync(cacheDir,{recursive:true});

  const onlineStage=mkdtempSync(resolve(tmpdir(),'iwxa-t2-cache-online-'));
  const offlineStage=mkdtempSync(resolve(tmpdir(),'iwxa-t2-cache-offline-'));
  try{
    stageManifest(onlineStage);
    runNpm([
      'ci',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--prefer-offline',
      '--cache',
      cacheDir,
    ],{cwd:onlineStage,label:'online-cache-warm'});
    verifyStagedLock(onlineStage,originalLockSha256);

    runNpm(['cache','verify','--cache',cacheDir],{label:'cache-verify-after-warm'});

    stageManifest(offlineStage);
    runNpm([
      'ci',
      '--offline',
      '--no-audit',
      '--no-fund',
      '--cache',
      cacheDir,
    ],{cwd:offlineStage,label:'offline-install-probe'});
    verifyStagedLock(offlineStage,originalLockSha256);

    const rootLockSha256After=sha256Bytes(readFileSync(lockPath));
    if(rootLockSha256After!==originalLockSha256){
      throw new Error('CURRENT_DEPENDENCY_CACHE_ROOT_LOCK_MUTATED');
    }
    const cacheDigest=digestCache(cacheDir);
    const receipt=Object.freeze({
      schema:'IWXA_T2_CURRENT_DEPENDENCY_CACHE_PREPARATION_V1',
      status:'PASS',
      purpose:'ONE_TIME_ONLINE_CACHE_WARM_FOR_SANDBOX_OFFLINE_CURRENT_VERIFICATION',
      platform:process.platform,
      arch:process.arch,
      nodeVersion:process.version,
      npmVersion,
      packageLockSha256:originalLockSha256,
      cacheDir,
      cacheDigestSha256:cacheDigest.sha256,
      cacheFileCount:cacheDigest.fileCount,
      onlineWarmPass:true,
      offlineInstallProbePass:true,
      sourceMutation:false,
      packageLockMutation:false,
      githubActions:false,
      productionDeploy:false,
    });
    mkdirSync(dirname(receiptPath),{recursive:true});
    writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n','utf8');
    console.log(JSON.stringify(receipt,null,2));
  }finally{
    rmSync(onlineStage,{recursive:true,force:true});
    rmSync(offlineStage,{recursive:true,force:true});
  }
}

if(process.argv[1]&&resolve(process.argv[1])===scriptPath){
  try{ main(); }
  catch(error){
    console.error(error?.stack||String(error));
    process.exit(1);
  }
}
