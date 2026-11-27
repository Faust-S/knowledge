#!/usr/bin/env node
import { existsSync,writeFileSync } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync,spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { qualifyProjectProcessSourceOwner } from '../src/modules/base/owners/project-process-qualification.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const args=process.argv.slice(2);
const exact=args[0]==='--exact-git-head';
const expectedHead=exact?args[1]:null;
const outputArg=exact?args[2]:args[0];
if(!outputArg || args.length!==(exact?3:1) || (exact&&!/^[0-9a-f]{40}$/.test(expectedHead))){
  console.error('usage: node scripts/run-c3-project-process-qualification.mjs [--exact-git-head <commit-sha>] <new-output.json>');
  process.exit(2);
}

function git(...args){
  return execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:2*1024*1024}).trim();
}
function currentSourceIdentity(){
  const head=git('rev-parse','HEAD');
  if(head!==expectedHead)throw new Error('C3_CURRENT_SOURCE_HEAD_MISMATCH:'+head);
  if(git('status','--porcelain=v1','--untracked-files=all','--','.')){
    throw new Error('C3_CURRENT_SOURCE_WORKTREE_DIRTY');
  }
  const prefix=git('rev-parse','--show-prefix').replace(/\/$/,'');
  const tree=git('rev-parse',prefix?'HEAD:'+prefix:'HEAD^{tree}');
  if(!/^[0-9a-f]{40}$/.test(tree))throw new Error('C3_CURRENT_SOURCE_TREE_INVALID');
  return Object.freeze({commit:head,sourceTree:tree,sourcePath:prefix||'.'});
}
function runCurrentNativeSourceTests(){
  const gate=spawnSync(process.execPath,['scripts/check-active-runtime-contract.mjs'],{cwd:root,encoding:'utf8'});
  process.stdout.write(gate.stdout??'');process.stderr.write(gate.stderr??'');
  if(gate.error||gate.status!==0)throw new Error('C3_CURRENT_RUNTIME_SOURCE_CONTRACT_FAILED');
  const tests=spawnSync(process.execPath,['--test','--test-reporter=tap',
    'tests/c3-project-process-owner.test.mjs',
    'tests/c3-project-process-history.test.mjs',
    'tests/c3-project-process-source-contract.test.mjs',
    'tests/c3-project-process-source-owner.test.mjs',
    'tests/c3-project-process-bridge-preview.test.mjs',
    'tests/c3-project-process-migration.test.mjs',
    'tests/c3-project-process-owner-adoption-candidate.test.mjs',
    'tests/c3-process-intelligence.test.mjs',
    'tests/c3-project-process-qualification.test.mjs',
    'tests/c3-workspace-method-source-lifecycle.test.mjs',
    'tests/c3-workspace-method-comparison.test.mjs',
    'tests/c3-workspace-method-revision-apply.test.mjs'],
    {cwd:root,encoding:'utf8',maxBuffer:12*1024*1024});
  process.stdout.write(tests.stdout??'');process.stderr.write(tests.stderr??'');
  if(tests.error||tests.status!==0)throw new Error('C3_CURRENT_NATIVE_SOURCE_TESTS_FAILED');
  const counts={};
  for(const name of ['tests','pass','fail','cancelled','skipped','todo']){
    const rows=[...(tests.stdout??'').matchAll(new RegExp('^# '+name+' (\\d+)\\s*$','gm'))];
    if(rows.length!==1)throw new Error('C3_NATIVE_TEST_SUMMARY_INVALID:'+name);
    counts[name]=Number(rows[0][1]);
  }
  if(counts.tests<146||counts.pass!==counts.tests||counts.fail||counts.cancelled||counts.skipped||counts.todo){
    throw new Error('C3_NATIVE_SOURCE_TEST_COUNTS_INVALID');
  }
  return Object.freeze(counts);
}

try {
  const output=resolve(outputArg);
  if(existsSync(output))throw new Error('C3_QUALIFICATION_OUTPUT_ALREADY_EXISTS');
  const source=exact?currentSourceIdentity():null;
  const nativeTests=exact?runCurrentNativeSourceTests():null;
  const result=await qualifyProjectProcessSourceOwner();
  if(result.status!=='PASS'||result.methodQualification?.status!=='PASS')throw new Error('C3_QUALIFICATION_STATUS_NOT_PASS');
  if(result.productionWriteActivation!==false)throw new Error('C3_QUALIFICATION_ACTIVATED_PRODUCTION_WRITE');
  if(result.qualificationHarnessPersistent!==false)throw new Error('C3_QUALIFICATION_HARNESS_BECAME_PERSISTENT');
  if(result.d4ExactRelease!=='PENDING')throw new Error('C3_D4_BOUNDARY_INVALID');
  if(!Array.isArray(result.sourceFamiliesQualified)||result.sourceFamiliesQualified.length!==8){
    throw new Error('C3_QUALIFIED_FAMILY_COUNT_INVALID');
  }
  if(exact&&JSON.stringify(currentSourceIdentity())!==JSON.stringify(source))throw new Error('C3_CURRENT_SOURCE_CHANGED');
  // The current T3 report is intentionally NOT an old K035 activation input.
  // It binds native source qualification only; real D1/Host, persistence,
  // Exchange, D4 and the current owner approval are still separate gates.
  const body=exact?{
    schema:'IWXA_T3_C3_PROJECT_PROCESS_SOURCE_QUALIFICATION_V1',
    status:'PASS',source,requiredKernel:'0.3.6',requiredRuntimeContract:'1.3.0',
    qualificationScope:'CANONICAL_SOURCE_MEMORY_ONLY',nativeTests,
    runtimeSourceContract:'PASS',productionWriteActivation:false,
    persistentHostQualified:false,exchangeQualified:false,d4ExactRelease:'PENDING',result,
  }:{
    schema:'IWXA_T2_C3_PROJECT_PROCESS_EXACT_HEAD_QUALIFICATION_RECEIPT_V1',
    status:'PASS',productionWriteActivation:false,d4ExactRelease:'PENDING',result,
  };
  const receipt=exact?{...body,reportSha256:createHash('sha256').update(JSON.stringify(body)).digest('hex')}:body;
  writeFileSync(output,JSON.stringify(receipt,null,2)+'\n',{encoding:'utf8',flag:'wx'});
  console.log('C3 Project/Process qualification PASS: families='+result.sourceFamiliesQualified.length+
    ' originalRecords='+result.recordCount+' methodRecords='+result.methodQualification.recordCount);
}catch(error){
  console.error(error?.message??String(error));process.exit(1);
}
