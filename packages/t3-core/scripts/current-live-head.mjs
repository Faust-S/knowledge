#!/usr/bin/env node
import {existsSync,mkdirSync,readFileSync,realpathSync,renameSync,writeFileSync} from 'node:fs';
import {dirname,relative,resolve,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const scriptPath=fileURLToPath(import.meta.url);
const root=dirname(dirname(scriptPath));
export const CURRENT_WORKTREE_ROOT=resolve(root,'../../../..');

export const CURRENT_BRANCH='main';
export const CURRENT_REMOTE='origin';
export const CURRENT_REPOSITORY='Faust-S/T2';
export const CURRENT_REMOTE_URL='https://github.com/Faust-S/T2.git';
export const LIVE_HEAD_EVIDENCE_SCHEMA='IWXA_T2_CURRENT_LIVE_HEAD_FETCH_EVIDENCE_V1';
export const LIVE_HEAD_EVIDENCE_MAX_AGE_MS=15*60*1000;
export const DEFAULT_LIVE_HEAD_EVIDENCE_PATH=resolve(CURRENT_WORKTREE_ROOT,'../evidence/current-live-head.json');

function sha(value,label){
  const normalized=String(value??'').trim().toLowerCase();
  if(!/^[0-9a-f]{40}$/.test(normalized)){
    throw new Error(`CURRENT_LIVE_HEAD_INVALID_${label.toUpperCase()}:${normalized}`);
  }
  return normalized;
}

function canonicalPath(path){
  let current=resolve(path);
  const suffix=[];
  while(!existsSync(current)){
    const parent=dirname(current);
    if(parent===current) break;
    suffix.unshift(current.slice(parent.length+1));
    current=parent;
  }
  return resolve(realpathSync(current),...suffix);
}

function canonicalComparablePath(path){
  return canonicalPath(path).replaceAll('\\','/').replace(/\/$/,'').toLowerCase();
}

function canonicalRemoteUrl(url){
  return String(url??'').trim().replace(/\.git$/,'').toLowerCase();
}

function isOutside(rootPath,targetPath){
  const canonicalRoot=canonicalPath(rootPath);
  const canonicalTarget=canonicalPath(targetPath);
  const rel=relative(canonicalRoot,canonicalTarget);
  return rel!==''&&(rel==='..'||rel.startsWith('..'+sep));
}

export function gitArgsForWorktree(cwd,args){
  const exactPath=resolve(cwd);
  return ['-c',`safe.directory=${exactPath}`,...args];
}

function runGit(args,{cwd=CURRENT_WORKTREE_ROOT,label='git'}={}){
  const result=spawnSync('git',gitArgsForWorktree(cwd,args),{
    cwd,
    encoding:'utf8',
    shell:false,
    stdio:'pipe',
    maxBuffer:4*1024*1024,
  });
  if(result.error) throw new Error(`CURRENT_LIVE_HEAD_SPAWN_FAILED:${label}:${result.error.message}`);
  if(result.status!==0){
    throw new Error(`CURRENT_LIVE_HEAD_COMMAND_FAILED:${label}:${result.status}:${result.stderr||result.stdout}`);
  }
  return String(result.stdout??'').trim();
}

export function assertCurrentLiveHeadEvidenceIdentity({
  localHead,
  localTree,
  trackingHead,
  trackingTree,
  expectedHead,
  evidence,
  repository=CURRENT_REPOSITORY,
  remoteName=CURRENT_REMOTE,
  remoteUrl=CURRENT_REMOTE_URL,
  commonGitDir,
  branch=CURRENT_BRANCH,
  now=Date.now(),
  maxAgeMs=LIVE_HEAD_EVIDENCE_MAX_AGE_MS,
}){
  const local=sha(localHead,'local_head');
  const tree=sha(localTree,'local_tree');
  const tracked=sha(trackingHead,'tracking_head');
  const trackedTree=sha(trackingTree,'tracking_tree');
  const expected=sha(expectedHead,'expected_head');
  if(!evidence||typeof evidence!=='object'||Array.isArray(evidence)){
    throw new Error('CURRENT_LIVE_HEAD_EVIDENCE_INVALID');
  }
  if(evidence.schema!==LIVE_HEAD_EVIDENCE_SCHEMA){
    throw new Error('CURRENT_LIVE_HEAD_EVIDENCE_SCHEMA_INVALID');
  }
  if(evidence.repository!==repository||repository!==CURRENT_REPOSITORY){
    throw new Error('CURRENT_LIVE_HEAD_REPOSITORY_MISMATCH');
  }
  if(evidence.remoteName!==remoteName||remoteName!==CURRENT_REMOTE){
    throw new Error('CURRENT_LIVE_HEAD_REMOTE_MISMATCH');
  }
  if(evidence.branch!==branch||branch!==CURRENT_BRANCH||evidence.fetchRef!==`refs/heads/${CURRENT_BRANCH}`){
    throw new Error('CURRENT_LIVE_HEAD_BRANCH_MISMATCH');
  }
  if(
    evidence.remoteUrl!==remoteUrl||
    canonicalRemoteUrl(remoteUrl)!==canonicalRemoteUrl(CURRENT_REMOTE_URL)
  ){
    throw new Error('CURRENT_LIVE_HEAD_REMOTE_IDENTITY_MISMATCH');
  }
  if(canonicalComparablePath(evidence.commonGitDir)!==canonicalComparablePath(commonGitDir)){
    throw new Error('CURRENT_LIVE_HEAD_REPOSITORY_PATH_MISMATCH');
  }
  const remote=sha(evidence.remoteHead,'evidence_remote_head');
  const remoteTree=sha(evidence.remoteTree,'evidence_remote_tree');
  const fetchedAt=Date.parse(evidence.fetchedAt);
  if(!Number.isFinite(fetchedAt)||new Date(fetchedAt).toISOString()!==evidence.fetchedAt){
    throw new Error('CURRENT_LIVE_HEAD_EVIDENCE_TIMESTAMP_INVALID');
  }
  const age=now-fetchedAt;
  if(age<0||age>maxAgeMs){
    throw new Error(`CURRENT_LIVE_HEAD_EVIDENCE_STALE:${age}`);
  }
  if(tracked!==remote||trackedTree!==remoteTree){
    throw new Error('CURRENT_LIVE_HEAD_TRACKING_REF_MISMATCH');
  }
  if(local!==remote||tree!==remoteTree){
    throw new Error(`CURRENT_LIVE_HEAD_LOCAL_STALE:${local}:${remote}`);
  }
  if(expected!==remote){
    throw new Error(`CURRENT_LIVE_HEAD_EXPECTED_MISMATCH:${expected}:${remote}`);
  }
  return Object.freeze({
    schema:'IWXA_T2_CURRENT_LIVE_HEAD_ASSERTION_V2',
    status:'PASS',
    repository,
    remoteName,
    remoteUrl,
    branch,
    localHead:local,
    remoteHead:remote,
    tree:remoteTree,
    expectedHead:expected,
    fetchedAt:evidence.fetchedAt,
    evidenceSchema:evidence.schema,
  });
}

export function makeCurrentLiveHeadEvidence({
  repository=CURRENT_REPOSITORY,
  remoteName=CURRENT_REMOTE,
  remoteUrl=CURRENT_REMOTE_URL,
  branch=CURRENT_BRANCH,
  remoteHead,
  remoteTree,
  commonGitDir,
  fetchedAt=new Date().toISOString(),
}){
  return Object.freeze({
    schema:LIVE_HEAD_EVIDENCE_SCHEMA,
    repository,
    remoteName,
    remoteUrl,
    branch,
    fetchRef:`refs/heads/${branch}`,
    remoteHead:sha(remoteHead,'remote_head'),
    remoteTree:sha(remoteTree,'remote_tree'),
    commonGitDir:canonicalPath(commonGitDir),
    fetchedAt,
  });
}

export function fetchCurrentLiveHeadEvidence({cwd=CURRENT_WORKTREE_ROOT,outputPath=DEFAULT_LIVE_HEAD_EVIDENCE_PATH,now=()=>new Date()}={}){
  const remoteUrl=runGit(['remote','get-url',CURRENT_REMOTE],{cwd,label:'origin-url'});
  if(remoteUrl.replace(/\.git$/,'').toLowerCase()!==CURRENT_REMOTE_URL.replace(/\.git$/,'').toLowerCase()){
    throw new Error(`CURRENT_LIVE_HEAD_REMOTE_IDENTITY_INVALID:${remoteUrl}`);
  }
  const commonGitDir=canonicalPath(runGit(['rev-parse','--git-common-dir'],{cwd,label:'git-common-dir'}));
  const trackingRef=`refs/remotes/${CURRENT_REMOTE}/${CURRENT_BRANCH}`;
  runGit(['fetch','--no-tags',CURRENT_REMOTE,`refs/heads/${CURRENT_BRANCH}:${trackingRef}`],{cwd,label:'fetch-live-branch'});
  const remoteHead=runGit(['rev-parse',trackingRef],{cwd,label:'remote-head'}).toLowerCase();
  const remoteTree=runGit(['rev-parse',`${remoteHead}^{tree}`],{cwd,label:'remote-tree'}).toLowerCase();
  const evidence=makeCurrentLiveHeadEvidence({remoteUrl,remoteHead,remoteTree,commonGitDir,fetchedAt:now().toISOString()});
  const output=canonicalPath(outputPath);
  if(!isOutside(cwd,output)) throw new Error('CURRENT_LIVE_HEAD_EVIDENCE_INSIDE_WORKTREE_FORBIDDEN');
  mkdirSync(dirname(output),{recursive:true});
  const temporary=`${output}.${process.pid}.tmp`;
  writeFileSync(temporary,`${JSON.stringify(evidence,null,2)}\n`,{encoding:'utf8',flag:'wx'});
  renameSync(temporary,output);
  return Object.freeze({evidence,outputPath:output});
}

export function assertCurrentLiveHead({cwd=CURRENT_WORKTREE_ROOT,expectedHead,evidencePath=DEFAULT_LIVE_HEAD_EVIDENCE_PATH,now=Date.now(),gitRunner=runGit}={}){
  const expected=sha(expectedHead,'expected_head');
  const commonGitDir=canonicalPath(gitRunner(['rev-parse','--git-common-dir'],{cwd,label:'git-common-dir'}));
  const remoteUrl=gitRunner(['remote','get-url',CURRENT_REMOTE],{cwd,label:'origin-url'});
  const localHead=gitRunner(['rev-parse','HEAD'],{cwd,label:'local-head'}).toLowerCase();
  const localTree=gitRunner(['rev-parse','HEAD^{tree}'],{cwd,label:'local-tree'}).toLowerCase();
  const trackingRef=`refs/remotes/${CURRENT_REMOTE}/${CURRENT_BRANCH}`;
  const trackingHead=gitRunner(['rev-parse',trackingRef],{cwd,label:'tracking-head'}).toLowerCase();
  const trackingTree=gitRunner(['rev-parse',`${trackingHead}^{tree}`],{cwd,label:'tracking-tree'}).toLowerCase();
  let evidence;
  try{evidence=JSON.parse(readFileSync(evidencePath,'utf8'));}
  catch(error){throw new Error(`CURRENT_LIVE_HEAD_EVIDENCE_UNREADABLE:${error.message}`);}
  return assertCurrentLiveHeadEvidenceIdentity({
    localHead,localTree,trackingHead,trackingTree,expectedHead:expected,evidence,
    remoteUrl,commonGitDir,now,
  });
}

export function runNpmCiOnlyAfterLiveHead({verifyLiveHead,runNpmCi}){
  if(typeof verifyLiveHead!=='function'||typeof runNpmCi!=='function'){
    throw new Error('CURRENT_LIVE_HEAD_NPM_CI_GUARD_ARGUMENTS_INVALID');
  }
  verifyLiveHead();
  return runNpmCi();
}

function main(){
  const [mode,arg,evidencePathArg]=process.argv.slice(2);
  try{
    if(mode==='fetch'){
      const result=fetchCurrentLiveHeadEvidence({outputPath:arg||DEFAULT_LIVE_HEAD_EVIDENCE_PATH});
      console.log(JSON.stringify({status:'PASS',...result},null,2));
      return;
    }
    const expectedHead=mode;
    if(!expectedHead){
      console.error('usage: current-live-head.mjs <expected-head-sha> [fetch-evidence-path]');
      process.exitCode=2;
      return;
    }
    console.log(JSON.stringify(assertCurrentLiveHead({expectedHead,evidencePath:evidencePathArg||DEFAULT_LIVE_HEAD_EVIDENCE_PATH}),null,2));
  }catch(error){
    console.error(error?.stack||String(error));
    process.exitCode=1;
  }
}

if(process.argv[1]&&resolve(process.argv[1])===scriptPath) main();
