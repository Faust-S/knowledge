// IWXA G4: run the original Agent D3 employee IPC/Result port tests through
// the public knowledge runner using TWO pinned private-source files only.
// No private repository clone, source artifact, test trace or key export.
// Requalify exact original Agent source whenever its immutable pinned SHA moves;
// previous 26/26 results remain historical rather than transferable.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {getExactFile} from './qualify-original-private-d3-owner.mjs';

export const AGENT_ORIGINAL_PIN='39a4f49ed9a5c0781c4a4769e9603ca8fb1e8d23';
const REPO='Faust-S/iwxa-personal-agent';
const FILES=Object.freeze([
  'runtime/t3_original_employee_port.py',
  'tests/test_agent06_corporate_t3_employee.py',
]);
const MAX_FILE_BYTES=128*1024;
const MAX_TOTAL_BYTES=256*1024;
const TARGET='test_unknown_prepare_recovers_original_receipt_read_only';

export async function qualifyOriginalAgentD3Source({
  token,
  fetchFile=(path,secret)=>getExactFile(path,secret,{
    repository:REPO,sourcePin:AGENT_ORIGINAL_PIN,
  }),
  python='python',
}={}){
  if(typeof token!=='string'||!token.trim())
    throw Error('T3_AGENT_PRIVATE_SOURCE_TOKEN_UNAVAILABLE');
  const root=mkdtempSync(join(tmpdir(),'iwxa-agent-original-d3-'),{mode:0o700});
  try{
    let used=0;
    for(const path of FILES){
      const bytes=await fetchFile(path,token);
      if(!Buffer.isBuffer(bytes)||bytes.length>MAX_FILE_BYTES)
        throw Error('T3_AGENT_PRIVATE_SOURCE_FILE_INVALID');
      used+=bytes.length;
      if(used>MAX_TOTAL_BYTES)
        throw Error('T3_AGENT_PRIVATE_SOURCE_TOTAL_LIMIT');
      const local=join(root,...path.split('/'));
      mkdirSync(dirname(local),{recursive:true,mode:0o700});
      writeFileSync(local,bytes,{mode:0o600,flag:'wx'});
    }
    const safeEnvironment={
      PATH:process.env.PATH??'',
      HOME:process.env.HOME??'',
      USERPROFILE:process.env.USERPROFILE??'',
      SystemRoot:process.env.SystemRoot??'',
      WINDIR:process.env.WINDIR??'',
      TMP:process.env.TMP??tmpdir(),
      TEMP:process.env.TEMP??tmpdir(),
      TMPDIR:process.env.RUNNER_TEMP??tmpdir(),
      LANG:'C.UTF-8',
      CI:'true',PYTHONDONTWRITEBYTECODE:'1',
      PYTHONNOUSERSITE:'1',
    };
    const run=spawnSync(python,[
      '-m','unittest','discover','-s','tests',
      '-p','test_agent06_corporate_t3_employee.py','-v',
    ],{cwd:root,env:safeEnvironment,encoding:'utf8',
      timeout:90000,maxBuffer:1024*1024});
    const output=(run.stdout??'')+'\n'+(run.stderr??'');
    const count=output.match(/\bRan (\d+) tests? in \d+(?:\.\d+)?s\b/);
    const passed=run.status===0&&/^\s*OK\s*$/m.test(output);
    // unittest -v emits a test docstring on a separate line before
    // "... ok". The full 11-test suite must succeed; do not require an
    // individual test name and its result marker on the SAME output line.
    const targetListed=output.split(/\r?\n/).some(line=>
      line.trimStart().startsWith(TARGET+' ('));
    const noSkipped= !/\bskipped=\d+\b/.test(output)&&
      !/\.\.\.\s+skipped\b/i.test(output);
    const targeted=passed&&targetListed&&noSkipped;
    const targetStatus=targetListed?
      targeted?'PASS':'SUITE_FAILED_OR_SKIPPED':'NOT_FOUND';
    const testLines=output.split(/\r?\n/).filter(line=>
      /^test_[A-Za-z0-9_]+\s+\(.+\)\s+\.\.\.\s+(?:ok|FAIL|ERROR)$/.test(line));
    const failedIndices=testLines.flatMap((line,index)=>
      /\.\.\.\s+(?:FAIL|ERROR)$/.test(line)?[index+1]:[]);
    const summaryStatus=run.status===0?'PYTHON_EXIT_SUCCESS':
      /FAILED\s+\(failures=/.test(output)?'PYTHON_ASSERTION_FAILURE':
      /FAILED\s+\(errors=/.test(output)?'PYTHON_TEST_ERROR':
      /Traceback \(most recent call last\)/.test(output)?
        'PYTHON_EXCEPTION':'PYTHON_NONZERO_EXIT';
    // The complete original test log is deliberately NEVER emitted.
    console.log('T3_AGENT_PRIVATE_D3_FILES_READ',FILES.length);
    console.log('T3_AGENT_PRIVATE_D3_ORIGINAL_TESTS',
      count?.[1]??'unknown');
    console.log('T3_AGENT_PRIVATE_D3_UNKNOWN_ACK_REGRESSION',
      targeted?'PASS':'NOT_CONFIRMED');
    if(!passed||!targeted){
      console.log('T3_AGENT_PRIVATE_D3_TEST_STATUS',summaryStatus);
      console.log('T3_AGENT_PRIVATE_D3_TARGET_STATUS',targetStatus);
      console.log('T3_AGENT_PRIVATE_D3_FAILED_TEST_POSITIONS',JSON.stringify(failedIndices));
    }
    if(!count||Number(count[1])<11||!passed||!targeted)
      throw Error('T3_AGENT_PRIVATE_D3_SOURCE_NOT_ACCEPTED');
    console.log('T3_AGENT_PRIVATE_D3_SOURCE_PASS_NOT_INSTALLED');
    return {tests:Number(count[1]),files:FILES.length};
  }finally{
    rmSync(root,{recursive:true,force:true,maxRetries:2});
    console.log('T3_AGENT_PRIVATE_D3_EPHEMERAL_SOURCE_REMOVED');
  }
}


/** Optional NEXT Agent source acceptance, kept separate from the already
 * installed c68387bd evidence. Uses existing Python suites and Node parse
 * check, without staging a second Agent Core or exposing private files. */
export const AGENT_COMPANY_DEV_PIN='39a4f49ed9a5c0781c4a4769e9603ca8fb1e8d23';
export async function qualifyOriginalAgentCompanyCandidate({
  token,
  fetchFile=(path,secret)=>getExactFile(path,secret,{
    repository:REPO,sourcePin:AGENT_COMPANY_DEV_PIN,
  }),
  python='python',
}={}){
  if(typeof token!=='string'||!token.trim())
    throw Error('T3_AGENT_PRIVATE_SOURCE_TOKEN_UNAVAILABLE');
  const roots=[
    'runtime/t3_original_employee_port.py',
    'runtime/t3_original_employee_worker.mjs',
    'runtime/t3_result_projection.py',
    'tests/test_agent06_corporate_t3_employee.py',
    'tests/test_t3_result_projection.py',
    'tests/test_agent06_original_t3_large_ipc.test.mjs',
    'runtime/t3_original_employee_cold_guard.mjs',
    'runtime/t3_original_transfer_readback.mjs',
    'runtime/t3_original_atlas_selected_summary.mjs',
    'runtime/t3_original_result_owner.py',
    'tests/test_agent06_company_original_core_result.py',
    'tests/test_agent06_original_t3_reentrant_ipc.py',
    'tools/t3_one_core_payload.py',
    'tools/k03_public_sources.py',
    'tests/test_agent06_t3_setup_payload.py',
  ];
  const root=mkdtempSync(join(tmpdir(),'iwxa-agent-company-next-'),{mode:0o700});
  try{
    let total=0;
    for(const path of roots){
      const bytes=await fetchFile(path,token);
      if(!Buffer.isBuffer(bytes)||bytes.length>128*1024)
        throw Error('T3_COMPANY_CANDIDATE_SOURCE_INVALID');
      total+=bytes.length;
      if(total>512*1024)
        throw Error('T3_COMPANY_CANDIDATE_SOURCE_TOO_LARGE');
      const target=join(root,...path.split('/'));
      mkdirSync(dirname(target),{recursive:true,mode:0o700});
      writeFileSync(target,bytes,{mode:0o600,flag:'wx'});
    }
    const environment={
      PATH:process.env.PATH??'',HOME:process.env.HOME??'',
      USERPROFILE:process.env.USERPROFILE??'',
      SystemRoot:process.env.SystemRoot??'',WINDIR:process.env.WINDIR??'',
      TMP:process.env.TMP??tmpdir(),TEMP:process.env.TEMP??tmpdir(),
      TMPDIR:process.env.RUNNER_TEMP??tmpdir(),
      LANG:'C.UTF-8',CI:'true',PYTHONDONTWRITEBYTECODE:'1',
      PYTHONNOUSERSITE:'1',
    };
    const syntax=spawnSync(process.execPath,
      ['--check',join(root,'runtime/t3_original_employee_worker.mjs')],
      {cwd:root,env:environment,encoding:'utf8',timeout:30000});
    if(syntax.status!==0||syntax.error)
      throw Error('T3_COMPANY_CANDIDATE_EMPLOYEE_SYNTAX_FAILED');
    const plans=[
      ['test_agent06_corporate_t3_employee.py',
        'test_company_area_opens_on_signed_selection_before_any_task'],
      ['test_t3_result_projection.py',
        'test_company_complete_result_uses_existing_fields_only'],
      ['test_agent06_company_original_core_result.py',
        'test_complete_acceptance_is_one_result_without_manual_selection'],
      ['test_agent06_original_t3_reentrant_ipc.py',
        'test_company_complete_result_uses_same_nested_core_reader'],
      ['test_agent06_t3_setup_payload.py',
        'test_qualified_original_source_and_d6_dist_are_packaged_byte_exact'],
    ];
    let totalTests=0;
    for(const [pattern,required]of plans){
      const run=spawnSync(python,[
        '-m','unittest','discover','-s','tests','-p',pattern,'-v',
      ],{cwd:root,env:environment,encoding:'utf8',
        timeout:90000,maxBuffer:1024*1024});
      const output=(run.stdout??'')+'\n'+(run.stderr??'');
      const match=output.match(/\bRan (\d+) tests? in \d+(?:\.\d+)?s\b/);
      const present=output.split(/\r?\n/).some(s=>
        s.trimStart().startsWith(required+' ('));
      if(run.status!==0||run.error||!match||
         !/^\s*OK\s*$/m.test(output)||!present||
         /\bskipped=\d+\b/.test(output)){
        // Never publish a private test traceback, prompt, source or result.
        const labels={
          'test_agent06_corporate_t3_employee.py':'ORIGINAL_EMPLOYEE',
          'test_t3_result_projection.py':'ORIGINAL_RESULT_PROJECTION',
          'test_agent06_company_original_core_result.py':'ORIGINAL_COMPLETE_ACCEPTED_CORE',
          'test_agent06_original_t3_reentrant_ipc.py':'ORIGINAL_NESTED_COMPANY_IPC',
          'test_agent06_t3_setup_payload.py':'ORIGINAL_ONE_DIST_SETUP',
        };
        console.log('T3_COMPANY_CANDIDATE_FAILED_SUITE',
          labels[pattern]??'UNRECOGNIZED_SUITE');
        const all=output.split(/\r?\n/).filter(line=>
          line.trim().startsWith('test_')&&line.includes(' ... '));
        console.log('T3_COMPANY_CANDIDATE_FAILED_TEST_POSITIONS',
          JSON.stringify(all.flatMap((line,i)=>
            /\.\.\. (?:FAIL|ERROR)$/.test(line)?[i+1]:[])));
        console.log('T3_COMPANY_CANDIDATE_TEST_COUNT',match?.[1]??'unknown');
        throw Error('T3_COMPANY_CANDIDATE_SOURCE_NOT_ACCEPTED');
      }
      totalTests+=Number(match[1]);
    }
    if(totalTests<38)
      throw Error('T3_COMPANY_CANDIDATE_TEST_COVERAGE_REGRESSED');
    const bridge=spawnSync(process.execPath,[
      '--test',join(root,'tests/test_agent06_original_t3_large_ipc.test.mjs'),
    ],{cwd:root,env:environment,encoding:'utf8',timeout:90000,
      maxBuffer:1024*1024});
    if(bridge.status!==0||bridge.error||
       !/^# pass 3\s*$/m.test(bridge.stdout??'')||
       !/^# fail 0\s*$/m.test(bridge.stdout??'')){
      console.log('T3_COMPANY_CANDIDATE_FAILED_SUITE','COMPLETE_DOCUMENT_IPC');
      // Only public numeric TAP positions. Never print the private test
      // output, request bytes or stack traces into public CI logs.
      const lines=(bridge.stdout??'').split(/\r?\n/);
      console.log('T3_COMPANY_IPC_NODE_EXIT',bridge.status??'unknown');
      console.log('T3_COMPANY_IPC_TAP_FAIL_POSITIONS',JSON.stringify(
        lines.filter(x=>/^\s*not ok \d+ /.test(x)).map(x=>
          Number(x.trim().match(/^not ok (\d+)/)?.[1])).filter(Number.isSafeInteger)));
      throw Error('T3_COMPANY_CANDIDATE_IPC_NOT_ACCEPTED');
    }
    console.log('T3_COMPANY_NEXT_SHA',AGENT_COMPANY_DEV_PIN);
    console.log('T3_COMPANY_EXISTING_SOURCE_TESTS_PASS',totalTests);
    console.log('T3_COMPANY_EMPLOYEE_WORKER_SYNTAX_PASS');
    console.log('T3_COMPANY_COMPLETE_DOCUMENT_IPC_3_PASS');
    console.log('T3_COMPANY_CORE_ACCEPTED_RESULT_AND_REENTRANT_CALLBACK_SOURCE_PASS');
    console.log('T3_AGENT_ONE_DIST_COMPANY_SCHEMA_ADMISSION_PASS');
    console.log('T3_COMPANY_CANDIDATE_NOT_INSTALLED_NOT_FINAL_T3');
    return {candidate:AGENT_COMPANY_DEV_PIN,tests:totalTests};
  }finally{
    rmSync(root,{recursive:true,force:true,maxRetries:2});
    console.log('T3_COMPANY_EPHEMERAL_PRIVATE_SOURCE_REMOVED');
  }
}

export async function qualifyOriginalAgentWithAllowedTokens({tokens=[],fetchFile,python='python'}={}){
  const available=tokens.filter(token=>typeof token==='string'&&token.trim());
  if(!available.length)throw Error('T3_AGENT_PRIVATE_SOURCE_TOKEN_UNAVAILABLE');
  for(const token of available){
    try{return await qualifyOriginalAgentD3Source({token,fetchFile,python});}
    catch(error){
      // Read-only GitHub Contents returns 404 for an unauthorized private
      // repository. Try a second already-configured scoped credential without
      // printing values, origins or the private source.
      if(['T3_PRIVATE_SOURCE_FETCH_403','T3_PRIVATE_SOURCE_FETCH_404'].includes(error?.message))
        continue;
      throw error;
    }
  }
  throw Error('T3_AGENT_PRIVATE_SOURCE_NOT_AUTHORIZED_IN_KNOWLEDGE');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  qualifyOriginalAgentWithAllowedTokens({
    tokens:[process.env.AGENT_PRIVATE_READ_TOKEN,
      process.env.DOMEN_PRIVATE_READ_TOKEN,process.env.T3_PRIVATE_READ_TOKEN],
    python:process.env.PYTHON_COMMAND??'python',
  }).catch(error=>{
    const code=/^T3_[A-Z0-9_]+$/.test(error?.message??'')
      ?error.message:'T3_AGENT_PRIVATE_D3_QUALIFICATION_FAILED';
    console.error(code);
    process.exitCode=1;
  });
}
