// Stage the EXISTING original signed T3 employee owner for an installed G4
// Windows qualification. Nothing is packaged, published or copied to an artifact.
// The source closure and immutable SHA are already owned and checked by the
// original native employee SOURCE qualification; reuse them verbatim.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,rmSync,realpathSync,lstatSync,appendFileSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {stageOriginal,T3_ORIGINAL_NATIVE_EMPLOYEE_PIN} from './qualify-native-corporate-agent-process.mjs';
import {getExactFile,ORIGINAL_PRIVATE_SOURCE_PIN} from './qualify-original-private-d3-owner.mjs';

const code=e=>typeof e?.message==='string'&&/^G4_[A-Z0-9_]{3,100}$/.test(e.message)
  ?e.message:'G4_INSTALLED_ORIGINAL_OWNER_STAGE_FAILED';
const fail=message=>{throw Error(message);};
const childEnv=ownerRoot=>Object.fromEntries(Object.entries({
  PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??'',
  WINDIR:process.env.WINDIR??'',USERPROFILE:process.env.USERPROFILE??'',
  LOCALAPPDATA:process.env.LOCALAPPDATA??'',APPDATA:process.env.APPDATA??'',
  TEMP:process.env.TEMP??'',TMP:process.env.TMP??'',
  HOMEDRIVE:process.env.HOMEDRIVE??'',HOMEPATH:process.env.HOMEPATH??'',
  ProgramData:process.env.ProgramData??'',ComSpec:process.env.ComSpec??'',
  IWXA_T3_ORIGINAL_OWNER_DIR:ownerRoot,
}).filter(([,value])=>typeof value==='string'));
export async function stageInstalledOriginalEmployeeOwner({
  destination,agentRoot,token=process.env.T3_READ_TOKEN,runnerTemp=process.env.RUNNER_TEMP,
  fetchFile=(relative,secret)=>getExactFile(relative,secret,{
    repository:'Faust-S/T3',sourcePin:T3_ORIGINAL_NATIVE_EMPLOYEE_PIN,
  }),
}={}){
  if(process.platform!=='win32')fail('G4_INSTALLED_ORIGINAL_OWNER_WINDOWS_REQUIRED');
  if(T3_ORIGINAL_NATIVE_EMPLOYEE_PIN!==ORIGINAL_PRIVATE_SOURCE_PIN)
    fail('G4_INSTALLED_ORIGINAL_OWNER_PIN_PARITY_FAILED');
  if(typeof token!=='string'||!token.trim())
    fail('G4_INSTALLED_ORIGINAL_OWNER_READ_GRANT_REQUIRED');
  if(typeof destination!=='string'||!isAbsolute(destination)||
     typeof runnerTemp!=='string'||!isAbsolute(runnerTemp)||
     typeof agentRoot!=='string'||!isAbsolute(agentRoot))
    fail('G4_INSTALLED_ORIGINAL_OWNER_PATH_REQUIRED');
  const runner=realpathSync(runnerTemp);
  const target=resolve(destination);
  if(dirname(target).toLowerCase()!==runner.toLowerCase()||
     basename(target)!=='g4-installed-original-employee-owner'||
     existsSync(target))
    fail('G4_INSTALLED_ORIGINAL_OWNER_STAGE_SCOPE_INVALID');
  const agent=realpathSync(agentRoot);
  const worker=join(agent,'runtime','t3_original_employee_worker.mjs');
  if(!existsSync(worker)||lstatSync(worker).isSymbolicLink()||
     !lstatSync(worker).isFile())
    fail('G4_INSTALLED_ORIGINAL_AGENT_WORKER_MISSING');
  mkdirSync(target,{mode:0o700});
  try {
    const count=await stageOriginal(target,token,fetchFile);
    if(count<30||count>125)fail('G4_INSTALLED_ORIGINAL_OWNER_CLOSURE_INVALID');
    const module=await import(pathToFileURL(
      join(target,'interop','native-employee-d3.mjs')).href);
    if(typeof module.originalWindowsEmployeeCandidate!=='function'||
       typeof module.enrollOriginalWindowsEmployeeCandidate!=='function'||
       typeof module.proveOriginalWindowsEmployeeChallenge!=='function')
      fail('G4_INSTALLED_ORIGINAL_OWNER_EXPORTS_INVALID');
    // This is an actual ORIGINAL employee module error from the SAME Agent
    // worker that ships in Setup Core, not a synthetic signer or a test stub.
    // The non-existing candidate cannot create keys, grant rights or write.
    const native=spawnSync(process.execPath,[worker],{
      input:JSON.stringify({id:1,operation:'employee_candidate',
        params:{root:join(realpathSync(target),'never-enrolled')}})+'\n',
      encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:128*1024,
      env:childEnv(target),
    });
    let reply;
    try {
      const lines=(native.stdout??'').trim().split(/\r?\n/).filter(Boolean);
      if(lines.length!==1)throw Error('response-count');
      reply=JSON.parse(lines[0]);
    }catch{fail('G4_INSTALLED_ORIGINAL_AGENT_WORKER_RESPONSE_INVALID');}
    if(native.status!==0||native.error||reply?.id!==1||reply?.ok!==false||
       reply?.code!=='T3_EMPLOYEE_WINDOWS_CANDIDATE_NOT_FOUND'||
       reply?.outcomeUnknown!==false)
      fail('G4_INSTALLED_ORIGINAL_AGENT_SIGNER_BINDING_FAILED');
    const envfile=process.env.GITHUB_ENV;
    if(typeof envfile!=='string'||!isAbsolute(envfile))
      fail('G4_INSTALLED_ORIGINAL_OWNER_GITHUB_ENV_REQUIRED');
    appendFileSync(envfile,'IWXA_T3_ORIGINAL_OWNER_DIR='+target+'\n','utf8');
    console.log('G4_INSTALLED_ORIGINAL_OWNER_EXACT_PRIVATE_SOURCE_PASS');
    console.log('G4_INSTALLED_AGENT_ORIGINAL_SIGNER_WORKER_BOUND_PASS');
    console.log('G4_INSTALLED_ORIGINAL_OWNER_NOT_YET_CROSS_PRODUCT_D3');
    return {count,ownerSha:T3_ORIGINAL_NATIVE_EMPLOYEE_PIN};
  }catch(e){
    rmSync(target,{recursive:true,force:true,maxRetries:2});
    throw e;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  stageInstalledOriginalEmployeeOwner({
    destination:process.argv[2],agentRoot:process.argv[3],
  }).catch(e=>{console.error(code(e));process.exitCode=1;});
}