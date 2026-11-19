// IWXA G4: run the original Agent D3 employee IPC/Result port tests through
// the public knowledge runner using TWO pinned private-source files only.
// No private repository clone, source artifact, test trace or key export.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {getExactFile} from './qualify-original-private-d3-owner.mjs';

export const AGENT_ORIGINAL_PIN='dff16da239882582d305a7fb4fc429ef7d58be3a';
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
