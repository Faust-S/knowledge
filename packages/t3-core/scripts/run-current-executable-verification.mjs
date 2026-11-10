#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {basename,dirname,relative,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {npmInvocation} from './run-current-nonwindows-qualification.mjs';
import {assertCurrentLiveHead,gitArgsForWorktree,runNpmCiOnlyAfterLiveHead} from './current-live-head.mjs';

const scriptPath=fileURLToPath(import.meta.url);
const root=dirname(dirname(scriptPath));
const gitTrustPath=resolve(root,'../../../..');

export const CURRENT_EXECUTABLE_TOOLCHAIN=Object.freeze({
  nodeVersion:'v24.18.1',
  npmVersion:'11.16.0',
});

function sha256Bytes(data){
  return createHash('sha256').update(data).digest('hex');
}

function canonicalProspectivePath(path){
  let current=resolve(path);
  const suffix=[];
  while(!existsSync(current)){
    const parent=dirname(current);
    if(parent===current) break;
    suffix.unshift(basename(current));
    current=parent;
  }
  return resolve(realpathSync(current),...suffix);
}

export function verificationOutputOutsideWorktree(outputPath,rootPath=root){
  const output=canonicalProspectivePath(outputPath);
  const canonical=realpathSync(resolve(rootPath));
  const rel=relative(canonical,output);
  return rel!==''&&(rel==='..'||rel.startsWith('..'+sep));
}

function runText(command,args,{cwd=root,label='command'}={}){
  const actualArgs=command.toLowerCase()==='git'?gitArgsForWorktree(gitTrustPath,args):args;
  const result=spawnSync(command,actualArgs,{
    cwd,
    encoding:'utf8',
    shell:false,
    stdio:'pipe',
    maxBuffer:4*1024*1024,
  });
  if(result.error) throw new Error(`CURRENT_EXECUTABLE_VERIFICATION_SPAWN_FAILED:${label}:${result.error.message}`);
  if(result.status!==0){
    throw new Error(`CURRENT_EXECUTABLE_VERIFICATION_COMMAND_FAILED:${label}:${result.status}:${result.stderr||result.stdout}`);
  }
  return String(result.stdout??'').trim();
}

function runStep({name,command,args,cwd=root}){
  const startedAt=new Date().toISOString();
  const childEnv={...process.env};
  const existingConfigCount=Number.parseInt(childEnv.GIT_CONFIG_COUNT??'0',10);
  const configCount=Number.isInteger(existingConfigCount)&&existingConfigCount>=0?existingConfigCount:0;
  childEnv.GIT_CONFIG_KEY_0??='';
  childEnv[`GIT_CONFIG_KEY_${configCount}`]='safe.directory';
  childEnv[`GIT_CONFIG_VALUE_${configCount}`]=gitTrustPath;
  childEnv.GIT_CONFIG_COUNT=String(configCount+1);
  const result=spawnSync(command,args,{
    cwd,
    encoding:'utf8',
    shell:false,
    stdio:'pipe',
    maxBuffer:64*1024*1024,
    env:childEnv,
  });
  if(result.error){
    throw new Error(`CURRENT_EXECUTABLE_VERIFICATION_SPAWN_FAILED:${name}:${result.error.message}`);
  }
  if(result.status!==0){
    const output=[result.stdout,result.stderr].filter(Boolean).join('\n');
    throw new Error(`CURRENT_EXECUTABLE_VERIFICATION_STEP_FAILED:${name}:${result.status}:${output}`);
  }
  return Object.freeze({
    name,
    status:'PASS',
    startedAt,
    completedAt:new Date().toISOString(),
  });
}

export function makeCurrentExecutableVerificationReceipt({
  platform=process.platform,
  arch=process.arch,
  nodeVersion=process.version,
  npmVersion,
  sourceCommitSha,
  sourceTreeSha,
  worktreeCleanBefore,
  worktreeCleanAfter,
  packageLockSha256,
  buildReceipt,
  steps,
}){
  if(typeof platform!=='string'||platform.trim()===''||typeof arch!=='string'||arch.trim()===''){
    throw new Error('CURRENT_EXECUTABLE_VERIFICATION_PLATFORM_IDENTITY_INVALID');
  }
  if(nodeVersion!==CURRENT_EXECUTABLE_TOOLCHAIN.nodeVersion){
    throw new Error(`CURRENT_EXECUTABLE_VERIFICATION_NODE_VERSION_MISMATCH:${nodeVersion}`);
  }
  if(npmVersion!==CURRENT_EXECUTABLE_TOOLCHAIN.npmVersion){
    throw new Error(`CURRENT_EXECUTABLE_VERIFICATION_NPM_VERSION_MISMATCH:${npmVersion}`);
  }
  if(typeof sourceCommitSha!=='string'||!/^[0-9a-f]{40}$/.test(sourceCommitSha)){
    throw new Error('CURRENT_EXECUTABLE_VERIFICATION_SOURCE_SHA_INVALID');
  }
  if(typeof sourceTreeSha!=='string'||!/^[0-9a-f]{40}$/.test(sourceTreeSha)){
    throw new Error('CURRENT_EXECUTABLE_VERIFICATION_SOURCE_TREE_SHA_INVALID');
  }
  if(worktreeCleanBefore!==true||worktreeCleanAfter!==true){
    throw new Error('CURRENT_EXECUTABLE_VERIFICATION_WORKTREE_NOT_CLEAN');
  }
  if(typeof packageLockSha256!=='string'||!/^[0-9a-f]{64}$/.test(packageLockSha256)){
    throw new Error('CURRENT_EXECUTABLE_VERIFICATION_PACKAGE_LOCK_SHA_INVALID');
  }
  if(
    !buildReceipt ||
    buildReceipt.schema!=='IWXA_T2_CURRENT_BUILD_REPRODUCIBILITY_V1' ||
    buildReceipt.status!=='PASS' ||
    buildReceipt.packageLockSha256!==packageLockSha256 ||
    typeof buildReceipt.buildTreeSha256!=='string' ||
    !/^[0-9a-f]{64}$/.test(buildReceipt.buildTreeSha256) ||
    !Number.isInteger(buildReceipt.buildFileCount) ||
    buildReceipt.buildFileCount<1 ||
    buildReceipt.buildsByteEquivalent!==true
  ){
    throw new Error('CURRENT_EXECUTABLE_VERIFICATION_BUILD_RECEIPT_INVALID');
  }
  const expectedStepNames=[
    'npm-ci',
    'source-preflight',
    'test-all',
    'typecheck',
    'lint',
    'build-reproducibility',
  ];
  if(
    !Array.isArray(steps) ||
    steps.length!==expectedStepNames.length ||
    steps.some((step,index)=>step?.status!=='PASS'||step?.name!==expectedStepNames[index])
  ){
    throw new Error('CURRENT_EXECUTABLE_VERIFICATION_STEPS_INVALID');
  }
  return Object.freeze({
    schema:'IWXA_T2_CURRENT_EXECUTABLE_VERIFICATION_V1',
    status:'PASS',
    verificationKind:'CURRENT_PRODUCT_DEVELOPMENT_GATE',
    platformQualification:false,
    platform:platform.trim(),
    arch:arch.trim(),
    nodeVersion,
    npmVersion,
    exactToolchain:Object.freeze({...CURRENT_EXECUTABLE_TOOLCHAIN}),
    sourceCommitSha,
    sourceTreeSha,
    worktreeCleanBefore:true,
    worktreeCleanAfter:true,
    packageLockSha256,
    installAuthority:'NPM_CI_EXACT_PACKAGE_LOCK',
    dependencyAcquisition:'AMBIENT_REGISTRY_OR_CACHE_ALLOWED',
    npmCiArgs:Object.freeze(['ci','--no-audit','--no-fund']),
    steps:Object.freeze(steps.map((step)=>Object.freeze({...step}))),
    buildTreeSha256:buildReceipt.buildTreeSha256,
    buildFileCount:buildReceipt.buildFileCount,
    buildsByteEquivalent:true,
    historicalRecoveryRequired:false,
    nonWindowsPortabilityQualificationRequired:false,
    windowsR11QualificationRequired:false,
    studioQualificationRequired:false,
    release_ready:false,
    productionDeploy:false,
    projectProcessWriteActivation:false,
  });
}

function main(){
  const outputArg=process.argv[2];
  const expectedHeadArg=process.argv[3];
  if(!outputArg||!expectedHeadArg){
    console.error('usage: node scripts/run-current-executable-verification.mjs <verification-json> <expected-head-sha>');
    process.exit(2);
  }
  const expectedHead=String(expectedHeadArg).trim().toLowerCase();
  if(!/^[0-9a-f]{40}$/.test(expectedHead)){
    console.error('CURRENT_EXECUTABLE_VERIFICATION_EXPECTED_HEAD_INVALID');
    process.exit(2);
  }
  if(process.version!==CURRENT_EXECUTABLE_TOOLCHAIN.nodeVersion){
    console.error(`CURRENT_EXECUTABLE_VERIFICATION_NODE_VERSION_MISMATCH:${process.version}`);
    process.exit(2);
  }
  try{
    assertCurrentLiveHead({expectedHead});
  }catch(error){
    console.error(error?.stack||String(error));
    process.exit(2);
  }
  const output=canonicalProspectivePath(outputArg);
  if(existsSync(output)){
    console.error('CURRENT_EXECUTABLE_VERIFICATION_OUTPUT_ALREADY_EXISTS');
    process.exit(2);
  }
  const lockPath=resolve(root,'package-lock.json');
  if(!existsSync(lockPath)){
    console.error('CURRENT_EXECUTABLE_VERIFICATION_PACKAGE_LOCK_MISSING');
    process.exit(2);
  }
  const tempDir=mkdtempSync(resolve(tmpdir(),'iwxa-t2-current-verification-'));
  const buildReceiptPath=resolve(tempDir,'current-build-reproducibility.json');

  try{
    const gitWorktreeRoot=runText('git',['rev-parse','--show-toplevel'],{label:'git-worktree-root'});
    if(!verificationOutputOutsideWorktree(output,gitWorktreeRoot)){
      throw new Error('CURRENT_EXECUTABLE_VERIFICATION_OUTPUT_INSIDE_WORKTREE_FORBIDDEN');
    }
    const sourceCommitSha=runText('git',['rev-parse','HEAD'],{label:'git-head'}).toLowerCase();
    if(sourceCommitSha!==expectedHead){
      throw new Error(`CURRENT_EXECUTABLE_VERIFICATION_HEAD_MISMATCH:${sourceCommitSha}:${expectedHead}`);
    }
    const sourceTreeSha=runText('git',['rev-parse','HEAD^{tree}'],{label:'git-tree'}).toLowerCase();
    const worktreeStatusBefore=runText('git',['status','--porcelain'],{label:'git-status-before'});
    if(worktreeStatusBefore!=='') throw new Error('CURRENT_EXECUTABLE_VERIFICATION_WORKTREE_NOT_CLEAN');

    const npmVersionInvocation=npmInvocation(['--version']);
    const npmVersion=runText(npmVersionInvocation.command,npmVersionInvocation.args,{label:'npm-version'});
    if(npmVersion!==CURRENT_EXECUTABLE_TOOLCHAIN.npmVersion){
      throw new Error(`CURRENT_EXECUTABLE_VERIFICATION_NPM_VERSION_MISMATCH:${npmVersion}`);
    }

    const packageLockSha256Before=sha256Bytes(readFileSync(lockPath));
    const steps=[];
    const npmCiInvocation=npmInvocation(['ci','--no-audit','--no-fund']);
    steps.push(runNpmCiOnlyAfterLiveHead({
      verifyLiveHead:()=>assertCurrentLiveHead({expectedHead}),
      runNpmCi:()=>runStep({name:'npm-ci',command:npmCiInvocation.command,args:npmCiInvocation.args}),
    }));
    steps.push(runStep({name:'source-preflight',command:process.execPath,args:[resolve(root,'scripts/source-preflight.mjs')]}));

    for(const [name,npmArgs] of [
      ['test-all',['run','test:all']],
      ['typecheck',['run','typecheck']],
      ['lint',['run','lint']],
    ]){
      const invocation=npmInvocation(npmArgs);
      steps.push(runStep({name,command:invocation.command,args:invocation.args}));
    }

    steps.push(runStep({
      name:'build-reproducibility',
      command:process.execPath,
      args:[resolve(root,'scripts/run-current-build-reproducibility.mjs'),buildReceiptPath],
    }));

    const packageLockSha256=sha256Bytes(readFileSync(lockPath));
    if(packageLockSha256!==packageLockSha256Before){
      throw new Error('CURRENT_EXECUTABLE_VERIFICATION_PACKAGE_LOCK_MUTATED');
    }
    const worktreeStatusAfter=runText('git',['status','--porcelain'],{label:'git-status-after'});
    if(worktreeStatusAfter!=='') throw new Error('CURRENT_EXECUTABLE_VERIFICATION_WORKTREE_MUTATED');
    const sourceCommitShaAfter=runText('git',['rev-parse','HEAD'],{label:'git-head-after'}).toLowerCase();
    const sourceTreeShaAfter=runText('git',['rev-parse','HEAD^{tree}'],{label:'git-tree-after'}).toLowerCase();
    if(sourceCommitShaAfter!==sourceCommitSha||sourceTreeShaAfter!==sourceTreeSha){
      throw new Error('CURRENT_EXECUTABLE_VERIFICATION_SOURCE_IDENTITY_MUTATED');
    }

    const buildReceipt=JSON.parse(readFileSync(buildReceiptPath,'utf8'));
    const receipt=makeCurrentExecutableVerificationReceipt({
      npmVersion,
      sourceCommitSha,
      sourceTreeSha,
      worktreeCleanBefore:true,
      worktreeCleanAfter:true,
      packageLockSha256,
      buildReceipt,
      steps,
    });
    mkdirSync(dirname(output),{recursive:true});
    writeFileSync(output,JSON.stringify(receipt,null,2)+'\n','utf8');
    console.log(JSON.stringify(receipt,null,2));
  }catch(error){
    console.error(error?.stack||String(error));
    process.exit(1);
  }finally{
    rmSync(tempDir,{recursive:true,force:true});
  }
}

if(process.argv[1]&&resolve(process.argv[1])===scriptPath) main();
