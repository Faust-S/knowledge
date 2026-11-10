#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {basename,dirname,relative,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const scriptPath=fileURLToPath(import.meta.url);
const root=dirname(dirname(scriptPath));

function sha256Bytes(data){
  return createHash('sha256').update(data).digest('hex');
}

export function qualificationOutputOutsideRoot(outputPath,rootPath=root){
  const output=resolve(outputPath);
  const canonical=resolve(rootPath);
  const rel=relative(canonical,output);
  return rel!==''&&(rel==='..'||rel.startsWith('..'+sep));
}

function canonicalProspectivePath(path){
  let current=resolve(path);
  const suffix=[];
  while(!existsSync(current)){
    const parent=dirname(current);
    if(parent===current)break;
    suffix.unshift(basename(current));
    current=parent;
  }
  return resolve(realpathSync(current),...suffix);
}

export function qualificationOutputOutsideWorktree(outputPath,rootPath=root){
  const output=canonicalProspectivePath(outputPath);
  const canonical=realpathSync(resolve(rootPath));
  const rel=relative(canonical,output);
  return rel!==''&&(rel==='..'||rel.startsWith('..'+sep));
}

export function npmInvocation(args,platform=process.platform,comspec=process.env.ComSpec){
  if(platform==='win32'){
    return Object.freeze({
      command:comspec||'cmd.exe',
      args:Object.freeze(['/d','/s','/c',['npm',...args].join(' ')]),
    });
  }
  return Object.freeze({
    command:'npm',
    args:Object.freeze([...args]),
  });
}

function runText(command,args,{cwd=root,label='command'}={}){
  const result=spawnSync(command,args,{
    cwd,
    encoding:'utf8',
    shell:false,
    stdio:'pipe',
    maxBuffer:4*1024*1024,
  });
  if(result.error) throw new Error(`CURRENT_NONWINDOWS_QUALIFICATION_SPAWN_FAILED:${label}:${result.error.message}`);
  if(result.status!==0){
    throw new Error(`CURRENT_NONWINDOWS_QUALIFICATION_COMMAND_FAILED:${label}:${result.status}:${result.stderr||result.stdout}`);
  }
  return String(result.stdout??'').trim();
}

function runStep({name,command,args,cwd=root}){
  const startedAt=new Date().toISOString();
  const result=spawnSync(command,args,{
    cwd,
    encoding:'utf8',
    shell:false,
    stdio:'pipe',
    maxBuffer:64*1024*1024,
  });
  if(result.error){
    throw new Error(`CURRENT_NONWINDOWS_QUALIFICATION_SPAWN_FAILED:${name}:${result.error.message}`);
  }
  if(result.status!==0){
    const output=[result.stdout,result.stderr].filter(Boolean).join('\n');
    throw new Error(`CURRENT_NONWINDOWS_QUALIFICATION_STEP_FAILED:${name}:${result.status}:${output}`);
  }
  return Object.freeze({
    name,
    status:'PASS',
    startedAt,
    completedAt:new Date().toISOString(),
  });
}

export function makeCurrentNonWindowsQualificationReceipt({
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
    throw new Error('CURRENT_NONWINDOWS_QUALIFICATION_PLATFORM_IDENTITY_INVALID');
  }
  if(typeof nodeVersion!=='string'||nodeVersion.trim()===''){
    throw new Error('CURRENT_NONWINDOWS_QUALIFICATION_NODE_VERSION_INVALID');
  }
  if(platform==='win32'){
    throw new Error('CURRENT_NONWINDOWS_QUALIFICATION_WINDOWS_FORBIDDEN');
  }
  if(typeof sourceCommitSha!=='string'||!/^[0-9a-f]{40}$/.test(sourceCommitSha)){
    throw new Error('CURRENT_NONWINDOWS_QUALIFICATION_SOURCE_SHA_INVALID');
  }
  if(typeof sourceTreeSha!=='string'||!/^[0-9a-f]{40}$/.test(sourceTreeSha)){
    throw new Error('CURRENT_NONWINDOWS_QUALIFICATION_SOURCE_TREE_SHA_INVALID');
  }
  if(worktreeCleanBefore!==true||worktreeCleanAfter!==true){
    throw new Error('CURRENT_NONWINDOWS_QUALIFICATION_WORKTREE_NOT_CLEAN');
  }
  if(typeof npmVersion!=='string'||npmVersion.trim()===''){
    throw new Error('CURRENT_NONWINDOWS_QUALIFICATION_NPM_VERSION_INVALID');
  }
  if(typeof packageLockSha256!=='string'||!/^[0-9a-f]{64}$/.test(packageLockSha256)){
    throw new Error('CURRENT_NONWINDOWS_QUALIFICATION_PACKAGE_LOCK_SHA_INVALID');
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
    throw new Error('CURRENT_NONWINDOWS_QUALIFICATION_BUILD_RECEIPT_INVALID');
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
    throw new Error('CURRENT_NONWINDOWS_QUALIFICATION_STEPS_INVALID');
  }
  return Object.freeze({
    schema:'IWXA_T2_CURRENT_NONWINDOWS_QUALIFICATION_V1',
    status:'PASS',
    platform:platform.trim(),
    arch:arch.trim(),
    nodeVersion:nodeVersion.trim(),
    npmVersion:npmVersion.trim(),
    sourceCommitSha,
    sourceTreeSha,
    worktreeCleanBefore:true,
    worktreeCleanAfter:true,
    packageLockSha256,
    installAuthority:'NPM_CI_EXACT_PACKAGE_LOCK',
    steps:Object.freeze(steps.map((step)=>Object.freeze({...step}))),
    buildTreeSha256:buildReceipt.buildTreeSha256,
    buildFileCount:buildReceipt.buildFileCount,
    buildsByteEquivalent:true,
    historicalRecoveryRequired:false,
    windowsR11Required:false,
    studioQualificationRequired:false,
    release_ready:false,
    productionDeploy:false,
    projectProcessWriteActivation:false,
  });
}

function main(){
  if(process.platform==='win32'){
    console.error('CURRENT_NONWINDOWS_QUALIFICATION_WINDOWS_FORBIDDEN');
    process.exit(2);
  }
  const outputArg=process.argv[2];
  const expectedHeadArg=process.argv[3];
  if(!outputArg||!expectedHeadArg){
    console.error('usage: node scripts/run-current-nonwindows-qualification.mjs <qualification-json> <expected-head-sha>');
    process.exit(2);
  }
  const expectedHead=String(expectedHeadArg).trim().toLowerCase();
  if(!/^[0-9a-f]{40}$/.test(expectedHead)){
    console.error('CURRENT_NONWINDOWS_QUALIFICATION_EXPECTED_HEAD_INVALID');
    process.exit(2);
  }
  const output=canonicalProspectivePath(outputArg);
  if(existsSync(output)){
    console.error('CURRENT_NONWINDOWS_QUALIFICATION_OUTPUT_ALREADY_EXISTS');
    process.exit(2);
  }
  const lockPath=resolve(root,'package-lock.json');
  if(!existsSync(lockPath)){
    console.error('CURRENT_NONWINDOWS_QUALIFICATION_PACKAGE_LOCK_MISSING');
    process.exit(2);
  }
  const tempDir=mkdtempSync(resolve(tmpdir(),'iwxa-t2-current-qualification-'));
  const buildReceiptPath=resolve(tempDir,'current-build-reproducibility.json');

  try{
    const gitWorktreeRoot=runText(
      'git',
      ['rev-parse','--show-toplevel'],
      {label:'git-worktree-root'},
    );
    if(!qualificationOutputOutsideWorktree(output,gitWorktreeRoot)){
      throw new Error('CURRENT_NONWINDOWS_QUALIFICATION_OUTPUT_INSIDE_WORKTREE_FORBIDDEN');
    }
    const sourceCommitSha=runText('git',['rev-parse','HEAD'],{label:'git-head'}).toLowerCase();
    if(sourceCommitSha!==expectedHead){
      throw new Error(`CURRENT_NONWINDOWS_QUALIFICATION_HEAD_MISMATCH:${sourceCommitSha}:${expectedHead}`);
    }
    const sourceTreeSha=runText('git',['rev-parse','HEAD^{tree}'],{label:'git-tree'}).toLowerCase();
    if(!/^[0-9a-f]{40}$/.test(sourceTreeSha)){
      throw new Error('CURRENT_NONWINDOWS_QUALIFICATION_SOURCE_TREE_SHA_INVALID');
    }
    const worktreeStatusBefore=runText('git',['status','--porcelain'],{label:'git-status-before'});
    if(worktreeStatusBefore!==''){
      throw new Error('CURRENT_NONWINDOWS_QUALIFICATION_WORKTREE_NOT_CLEAN');
    }
    const packageLockSha256Before=sha256Bytes(readFileSync(lockPath));
    const npmVersionInvocation=npmInvocation(['--version']);
    const npmVersion=runText(
      npmVersionInvocation.command,
      npmVersionInvocation.args,
      {label:'npm-version'},
    );
    const steps=[];
    const npmCiInvocation=npmInvocation(['ci']);
    steps.push(runStep({
      name:'npm-ci',
      command:npmCiInvocation.command,
      args:npmCiInvocation.args,
    }));
    steps.push(runStep({
      name:'source-preflight',
      command:process.execPath,
      args:[resolve(root,'scripts/source-preflight.mjs')],
    }));

    for(const [name,npmArgs] of [
      ['test-all',['run','test:all']],
      ['typecheck',['run','typecheck']],
      ['lint',['run','lint']],
    ]){
      const invocation=npmInvocation(npmArgs);
      steps.push(runStep({
        name,
        command:invocation.command,
        args:invocation.args,
      }));
    }

    steps.push(runStep({
      name:'build-reproducibility',
      command:process.execPath,
      args:[
        resolve(root,'scripts/run-current-build-reproducibility.mjs'),
        buildReceiptPath,
      ],
    }));

    const packageLockSha256=sha256Bytes(readFileSync(lockPath));
    if(packageLockSha256!==packageLockSha256Before){
      throw new Error('CURRENT_NONWINDOWS_QUALIFICATION_PACKAGE_LOCK_MUTATED');
    }
    const worktreeStatusAfter=runText('git',['status','--porcelain'],{label:'git-status-after'});
    if(worktreeStatusAfter!==''){
      throw new Error('CURRENT_NONWINDOWS_QUALIFICATION_WORKTREE_MUTATED');
    }
    const sourceCommitShaAfter=runText('git',['rev-parse','HEAD'],{label:'git-head-after'}).toLowerCase();
    const sourceTreeShaAfter=runText('git',['rev-parse','HEAD^{tree}'],{label:'git-tree-after'}).toLowerCase();
    if(sourceCommitShaAfter!==sourceCommitSha||sourceTreeShaAfter!==sourceTreeSha){
      throw new Error('CURRENT_NONWINDOWS_QUALIFICATION_SOURCE_IDENTITY_MUTATED');
    }
    const buildReceipt=JSON.parse(readFileSync(buildReceiptPath,'utf8'));
    const receipt=makeCurrentNonWindowsQualificationReceipt({
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
