// IWXA G4: original private owner SOURCE qualification, strictly inside public knowledge CI.
// Fetch only transitive .mjs/.js imports used by one original D3 test; no git clone.
// This file contains no private source. The token is used solely for authenticated GET.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,posix,dirname,isAbsolute,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const REPO='Faust-S/T3';
export const ORIGINAL_PRIVATE_SOURCE_PIN='44405553affa7fc90c6fb645a241a1ecb9c3efd3';
// Final source candidate is a fast-forward of the accepted installed owner.
// It is qualified independently; do not inherit Center installed proof.
export const ORIGINAL_FINAL_OWNER_CANDIDATE_PIN='44405553affa7fc90c6fb645a241a1ecb9c3efd3';
const TEST='tests/admin-original-host-port.test.mjs';
const MULTI_EMPLOYEE_TESTS=Object.freeze([
  'tests/multi-employee-provisioning.test.mjs',
  'tests/multi-employee-admin.test.mjs',
]);
const DEFAULT_TEST_FILES=Object.freeze([TEST,...MULTI_EMPLOYEE_TESTS]);
const COMPANY_GRAPH_TEST='tests/t3-company-atomic-graph-owner.test.mjs';
const EXPECT='native D3 compares every signed field independent of original JSON key order';
const ROOTS=new Set(['interop','reconciliation','access-control','tests']);
const MAX_FILES=130;
const MAX_BYTES=6*1024*1024;
const MAX_FILE_BYTES=512*1024;

export function originalImportPaths(source){
  if(typeof source!=='string')throw Error('T3_SOURCE_TEXT_REQUIRED');
  const paths=new Set();
  const re=/\b(?:from\s*|import\s*(?:\(\s*)?)["'](\.{1,2}\/[^"']+)["']/g;
  for(const hit of source.matchAll(re))paths.add(hit[1]);
  return [...paths];
}
export function originalImportTarget(from,specifier){
  if(typeof from!=='string'||typeof specifier!=='string'||
     !/^\.\.?\//.test(specifier)||/[?#]/.test(specifier))
    throw Error('T3_PRIVATE_IMPORT_PATH_INVALID');
  const path=posix.normalize(posix.join(posix.dirname(from),specifier));
  if(!ROOTS.has(path.split('/')[0])||
     !/^[a-zA-Z0-9_./-]+\.(?:mjs|js|json)$/.test(path)||
     path.includes('..')||path.startsWith('/'))
    throw Error('T3_PRIVATE_IMPORT_OUTSIDE_BOUNDED_SOURCE');
  return path;
}

export async function getExactFile(path,token,{repository=REPO,sourcePin=ORIGINAL_PRIVATE_SOURCE_PIN}={}){
  const url=`https://api.github.com/repos/${repository}/contents/`+
    path.split('/').map(encodeURIComponent).join('/')+`?ref=${encodeURIComponent(sourcePin)}`;
  let response;
  try{
    response=await fetch(url,{headers:{
      Accept:'application/vnd.github+json',
      Authorization:`Bearer ${token}`,
      'X-GitHub-Api-Version':'2022-11-28',
      'User-Agent':'iwxa-knowledge-bounded-private-original-d3-qualification',
    },signal:AbortSignal.timeout(20000)});
  }catch{throw Error('T3_PRIVATE_SOURCE_API_UNAVAILABLE');}
  if(!response.ok){
    if([403,429].includes(response.status)&&
      (response.headers.get('retry-after')||
       response.headers.get('x-ratelimit-remaining')==='0'))
      throw Error('T3_PRIVATE_SOURCE_RATE_LIMITED');
    throw Error(`T3_PRIVATE_SOURCE_FETCH_${response.status}`);
  }
  let item;
  try{item=await response.json();}catch{throw Error('T3_PRIVATE_SOURCE_RESPONSE_INVALID');}
  if(item?.type!=='file'||item.encoding!=='base64'||
     typeof item.content!=='string'||!Number.isInteger(item.size)||
     item.size<0||item.size>MAX_FILE_BYTES)
    throw Error('T3_PRIVATE_SOURCE_FILE_NOT_ALLOWED');
  const bytes=Buffer.from(item.content.replace(/\s/g,''),'base64');
  if(bytes.length!==item.size)throw Error('T3_PRIVATE_SOURCE_SIZE_MISMATCH');
  return bytes;
}

export async function runOriginalPrivateOwnerSourceCheck({
  token,fetchFile=getExactFile,assets=['access-control/domain-registry.json'],
  testFiles=DEFAULT_TEST_FILES,
}={}){
  if(!Array.isArray(testFiles)||testFiles.length===0||
     testFiles.some(path=>![TEST,...MULTI_EMPLOYEE_TESTS,COMPANY_GRAPH_TEST].includes(path)))
    throw Error('T3_PRIVATE_D3_UNAPPROVED_TEST_FILE');
  if(typeof token!=='string'||!token.trim())throw Error('T3_KNOWLEDGE_READ_TOKEN_NOT_AVAILABLE');
  const root=mkdtempSync(join(tmpdir(),'iwxa-t3-original-d3-'),{mode:0o700});
  // Keep the ORIGINAL signed policy JSON in the bounded source checkout.
  // The installed Bun Owner bundles it via a static ESM JSON import.
  // Bounded Admin invitation UI fixture only for original company test.
  // This prevents API-only default-key tests masking the old client flags.
  const companyUi=testFiles.includes(COMPANY_GRAPH_TEST)
    ?['interop/index.html','interop/app.js']:[];
  const visited=new Set(),pending=[...testFiles,...assets,...companyUi];
  let count=0,totalBytes=0;
  try{
    while(pending.length){
      const batch=pending.splice(0,8).filter(path=>!visited.has(path));
      if(!batch.length)continue;
      // Never ask for anything outside the bounded existing original owner.
      for(const path of batch){
        if(!ROOTS.has(path.split('/')[0]))
          throw Error('T3_PRIVATE_SOURCE_PATH_UNAUTHORIZED');
        visited.add(path);
      }
      if(visited.size>MAX_FILES)throw Error('T3_PRIVATE_SOURCE_FILE_LIMIT');
      const results=await Promise.all(batch.map(path=>fetchFile(path,token)));
      for(let i=0;i<batch.length;i++){
        const path=batch[i],bytes=results[i];
        if(!Buffer.isBuffer(bytes)||bytes.length>MAX_FILE_BYTES)
          throw Error('T3_PRIVATE_SOURCE_RESPONSE_INVALID');
        totalBytes+=bytes.length;
        if(totalBytes>MAX_BYTES)throw Error('T3_PRIVATE_SOURCE_TOTAL_LIMIT');
        const local=join(root,...path.split('/'));
        mkdirSync(dirname(local),{recursive:true,mode:0o700});
        writeFileSync(local,bytes,{mode:0o600,flag:'wx'});
        count++;
        if(/\.(?:mjs|js)$/.test(path)){
          for(const specifier of originalImportPaths(bytes.toString('utf8'))){
            const child=originalImportTarget(path,specifier);
            if(!visited.has(child)&&!pending.includes(child))pending.push(child);
          }
        }
      }
    }
    // Original test code receives no token or CI credential environment.
    const env={PATH:process.env.PATH??'',HOME:process.env.HOME??'',
      TMPDIR:process.env.RUNNER_TEMP??tmpdir(),LANG:'C.UTF-8',CI:'true'};
    const child=spawnSync(process.execPath,['--test','--test-reporter=tap',...testFiles],{
      cwd:root,env,encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024,
    });
    // Original source, Task texts, fixture details and test output are PRIVATE.
    // Only declassified counts and exact target regression execution leave CI.
    const stdout=child.stdout??'';
    const metrics=['tests','pass','fail'].map(key=>{
      const found=stdout.match(new RegExp(`^# ${key} (\\d+)$`,'m'));
      return found?Number(found[1]):null;
    });
    const [tests,passed,failed]=metrics;
    const targeted=stdout.includes(EXPECT);
    const multiEmployee=testFiles.includes(MULTI_EMPLOYEE_TESTS[0])&&
      testFiles.includes(MULTI_EMPLOYEE_TESTS[1]);
    const multiEmployeeExecuted=!multiEmployee||[
      'shared real Registry separates staff grants',
      'one Admin Registry and ledger receive two independent staff results',
    ].every(text=>stdout.includes(text));
    const companyGraph=testFiles.includes(COMPANY_GRAPH_TEST);
    const companyGraphExecuted=!companyGraph||
      stdout.includes('original corporate atomic graph JIT uses exactly the signed object.write grant, cold and revoke');
    const rawFailure=stdout+'\n'+(child.stderr??'');
    const knownFailure=[
      ['ERR_MODULE_NOT_FOUND','MISSING_IMPORT'],
      ['Cannot find package','MISSING_PACKAGE'],
      ['ENOENT','MISSING_RUNTIME_FILE'],
      ['ERR_INVALID_PACKAGE_CONFIG','INVALID_PACKAGE_CONFIG'],
      ['SyntaxError','SYNTAX_ERROR'],
      ['ReferenceError','RUNTIME_REFERENCE_ERROR'],
      ['AssertionError','TEST_ASSERTION'],
      ['ERR_MODULE','MODULE_LOADING_ERROR'],
      ['ERR_','NODE_RUNTIME_ERROR'],
    ].find(([needle])=>rawFailure.includes(needle))?.[1]??
      'UNCLASSIFIED_NATIVE_TEST_FAILURE';
    if(child.status!==0||child.error||!targeted){
      console.log('T3_PRIVATE_D3_SOURCE_FAILURE_CLASS',knownFailure);
      if(knownFailure==='MISSING_RUNTIME_FILE'){
        const hit=rawFailure.match(/ENOENT: no such file or directory, (?:open|stat|scandir) ['"]([^'"]+)['"]/);
        const missing=hit?.[1];
        const local=missing&&isAbsolute(missing)&&missing.startsWith(root+sep);
        const relative=local?missing.slice(root.length+1).split(sep).join('/'):null;
        const hash=value=>{
          let h=2166136261;
          for(let i=0;i<value.length;i++)h=Math.imul(h^value.charCodeAt(i),16777619);
          return (h>>>0).toString(16).padStart(8,'0');
        };
        console.log('T3_PRIVATE_D3_MISSING_RUNTIME_LOCATION',
          relative?'SOURCE_RELATIVE':missing?'OUTSIDE_BOUNDED_SOURCE':'NO_PATH');
        if(relative)console.log('T3_PRIVATE_D3_MISSING_RUNTIME_FINGERPRINT',hash(relative));
      }
    }
    const failedTests=[...stdout.matchAll(/^not ok (\d+) - [^\n]*$/gm)].map(hit=>{
      const begin=hit.index+hit[0].length;
      const after=stdout.slice(begin);
      const end=after.search(/^\s*(?:not ok|ok|# Subtest:) /m);
      const block=end>=0?after.slice(0,end):after;
      const error=block.match(/^\s*error: ['"]([^'"\n]+)['"]/m)?.[1]??'';
      const code=/^[A-Z][A-Z0-9_]{3,119}$/.test(error)?error:
        /Expected values to be strictly equal|deepStrictEqual|AssertionError/.test(block)
          ?'ASSERTION_MISMATCH':'REDACTED_NON_CODE_FAILURE';
      return [Number(hit[1]),code];
    });
    if(failedTests.length)console.log('T3_PRIVATE_D3_FAILED_TEST_ORDINALS_AND_CODES',
      JSON.stringify(failedTests));
    console.log('T3_PRIVATE_D3_SOURCE_MODULES_READ',count);
    console.log('T3_PRIVATE_D3_ORIGINAL_SUITE',
      `tests=${tests??'unknown'} pass=${passed??'unknown'} fail=${failed??'unknown'}`);
    console.log('T3_PRIVATE_D3_SIGNED_CONTEXT_REGRESSION',targeted?'EXECUTED':'NOT_EXECUTED');
    console.log('T3_PRIVATE_D3_INDEPENDENT_STAFF_SOURCE_REGRESSIONS',
      multiEmployeeExecuted?'EXECUTED':'NOT_EXECUTED');
    if(companyGraph)console.log('T3_COMPANY_ORIGINAL_ATOMIC_GRAPH_WRITE_RIGHT',
      companyGraphExecuted&&passed===tests?'PASS':'NOT_ACCEPTED');
    if(child.status!==0||child.error||!targeted||!multiEmployeeExecuted||
       !companyGraphExecuted||!tests||passed!==tests||failed!==0)
      throw Error('T3_PRIVATE_D3_ORIGINAL_OWNER_SOURCE_NOT_ACCEPTED');
    console.log('T3_PRIVATE_D3_ORIGINAL_OWNER_SOURCE_PASS_NOT_INSTALLED');
    return {tests,passed,failed,count};
  }finally{
    rmSync(root,{recursive:true,force:true,maxRetries:2});
    console.log('T3_PRIVATE_D3_EPHEMERAL_SOURCE_REMOVED');
  }
}

export async function qualifyOriginalWithAuthorizedTokens({tokens=[],fetchFile,
  testFiles=DEFAULT_TEST_FILES}={}){
  const available=tokens.filter(token=>typeof token==='string'&&token.trim());
  if(!available.length)throw Error('T3_KNOWLEDGE_READ_TOKEN_NOT_AVAILABLE');
  for(const token of available){
    try{return await runOriginalPrivateOwnerSourceCheck({token,fetchFile,testFiles});}
    catch(error){
      if(['T3_PRIVATE_SOURCE_FETCH_403','T3_PRIVATE_SOURCE_FETCH_404'].includes(error?.message))
        continue;
      throw error;
    }
  }
  throw Error('T3_ORIGINAL_PRIVATE_SOURCE_NOT_AUTHORIZED_IN_KNOWLEDGE');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const finalCandidate=process.argv.includes('--candidate');
  const companyGraph=process.argv.includes('--company-graph');
  qualifyOriginalWithAuthorizedTokens({
    tokens:[process.env.T3_READ_TOKEN,process.env.DOMEN_PRIVATE_READ_TOKEN],
    ...(finalCandidate?{fetchFile:(path,token)=>getExactFile(path,token,{
      sourcePin:ORIGINAL_FINAL_OWNER_CANDIDATE_PIN,
    })}:{}),
    ...(companyGraph?{testFiles:[...DEFAULT_TEST_FILES,COMPANY_GRAPH_TEST]}:{}),
  }).then(result=>{
    if(finalCandidate){
      console.log('T3_FINAL_ORIGINAL_D3_OWNER_CANDIDATE_PIN',
        ORIGINAL_FINAL_OWNER_CANDIDATE_PIN);
      console.log('T3_FINAL_ORIGINAL_D3_OWNER_SOURCE_PASS',result.tests);
      console.log('T3_FINAL_OWNER_SOURCE_ONLY_NOT_INSTALLED');
    }
  }).catch(error=>{
    const code=typeof error?.message==='string'&&/^T3_[A-Z0-9_]+$/.test(error.message)
      ?error.message:'T3_PRIVATE_D3_QUALIFICATION_FAILED';
    console.error(code);
    process.exitCode=1;
  });
}
