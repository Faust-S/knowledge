// Public knowledge qualification only: stage the smallest original private
// T3 and Agent modules needed to run the REAL Windows employee IPC worker.
// No private git clone, code artifact, new owner or alternative Kernel.
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {getExactFile,originalImportPaths,originalImportTarget}
  from './qualify-original-private-d3-owner.mjs';
import {AGENT_ORIGINAL_PIN} from './qualify-original-agent-d3-port.mjs';

export const T3_ORIGINAL_NATIVE_EMPLOYEE_PIN='44405553affa7fc90c6fb645a241a1ecb9c3efd3';
const T3_SEEDS=Object.freeze([
  'interop/provision.mjs','interop/runtime.mjs',
  'interop/native-admin-d3.mjs','interop/native-employee-d3.mjs',
  'reconciliation/contracts.mjs','interop/task-revisions.mjs',
  'interop/result-contract.mjs','access-control/windows-credential.mjs',
  'access-control/domain-registry.json',
]);
// Current central Agent 0.6 employee worker imports these three PURE
// binding/recovery modules at startup. Every file comes from the SAME pinned
// private Agent checkout; no alternative Agent runtime, ledger or signer.
const AGENT_SEEDS=Object.freeze([
  'runtime/t3_original_employee_port.py',
  'runtime/t3_original_employee_worker.mjs',
  'runtime/t3_original_employee_cold_guard.mjs',
  'runtime/t3_original_transfer_readback.mjs',
  'runtime/t3_original_atlas_selected_summary.mjs',
]);
const MAX_FILES=125,MAX_BYTES=8*1024*1024,MAX_FILE=512*1024;

export async function stageOriginal(root,token,fetchT3,seeds=T3_SEEDS){
  const pending=[...seeds],seen=new Set();
  let total=0;
  while(pending.length){
    const path=pending.shift();
    if(seen.has(path))continue;
    seen.add(path);
    if(seen.size>MAX_FILES)throw Error('G4_NATIVE_T3_SOURCE_FILE_LIMIT');
    const bytes=await fetchT3(path,token);
    if(!Buffer.isBuffer(bytes)||bytes.length>MAX_FILE)throw Error('G4_NATIVE_T3_SOURCE_FILE_INVALID');
    total+=bytes.length;
    if(total>MAX_BYTES)throw Error('G4_NATIVE_T3_SOURCE_BYTE_LIMIT');
    const target=join(root,...path.split('/'));
    mkdirSync(dirname(target),{recursive:true});
    writeFileSync(target,bytes,{flag:'wx',mode:0o600});
    if(/\.(mjs|js)$/.test(path)){
      for(const relative of originalImportPaths(bytes.toString('utf8'))){
        const child=originalImportTarget(path,relative);
        if(!seen.has(child)&&!pending.includes(child))pending.push(child);
      }
    }
  }
  return seen.size;
}
const AGENT_CORE_SPARSE_ROOTS=Object.freeze([
  'runtime','adapters','cells','providers','surfaces',
  'schemas','profiles','config','skills','operational-skills',
]);
// Stage the installed Agent's EXISTING Core, never a second Core, with a
// partial, blob-filtered, pinned Git checkout. No private repo Actions,
// complete checkout, published source, artifacts, caches or log output.
export async function stageAgent(root,token){
  if(!token)throw Error('G4_NATIVE_AGENT_READ_GRANT_REQUIRED');
  const auth=Buffer.from('x-access-token:'+token).toString('base64');
  const env={
    PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??'',
    WINDIR:process.env.WINDIR??'',HOME:process.env.HOME??'',
    USERPROFILE:process.env.USERPROFILE??'',APPDATA:process.env.APPDATA??'',
    LOCALAPPDATA:process.env.LOCALAPPDATA??'',
    TEMP:process.env.TEMP??'',TMP:process.env.TMP??'',
    GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:'echo',
    GIT_CONFIG_COUNT:'1',
    GIT_CONFIG_KEY_0:'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0:'AUTHORIZATION: basic '+auth,
  };
  const git=(args)=>{
    const run=spawnSync('git',['-C',root,...args],{
      env,encoding:'utf8',windowsHide:true,timeout:125000,
      maxBuffer:256*1024,
    });
    // Git might include private file paths or credentials in diagnostics.
    // No Git output, especially stderr, is ever sent to public Actions.
    if(run.status!==0||run.error)
      throw Error('G4_NATIVE_AGENT_SPARSE_CHECKOUT_FAILED');
    return (run.stdout??'').trim();
  };
  mkdirSync(root,{recursive:true,mode:0o700});
  git(['init','--quiet']);
  git(['remote','add','origin','https://github.com/Faust-S/iwxa-personal-agent.git']);
  git(['sparse-checkout','init','--cone']);
  git(['sparse-checkout','set',...AGENT_CORE_SPARSE_ROOTS]);
  git(['fetch','--quiet','--depth=1','--filter=blob:none','--no-tags',
    'origin',AGENT_ORIGINAL_PIN]);
  git(['checkout','--quiet','--detach','FETCH_HEAD']);
  if(git(['rev-parse','HEAD'])!==AGENT_ORIGINAL_PIN)
    throw Error('G4_NATIVE_AGENT_SPARSE_SOURCE_PIN_CHANGED');
  const paths=git(['ls-files','--cached']).split(/\r?\n/).filter(Boolean);
  const allowed=paths.filter(p=>AGENT_CORE_SPARSE_ROOTS.some(dir=>p.startsWith(dir+'/')));
  if(allowed.length<150||allowed.length>1000||allowed.some(p=>
    !/^[a-zA-Z0-9_./-]+$/.test(p)||p.includes('..')))
    throw Error('G4_NATIVE_AGENT_SPARSE_SOURCE_SCOPE_INVALID');
  for(const path of AGENT_SEEDS)
    if(!allowed.includes(path))throw Error('G4_NATIVE_AGENT_REQUIRED_SOURCE_MISSING');
  // A pinned native Agent must ship EXACTLY the One Core that passed the
  // public original T2/Host CI. This is a build-input integrity check, not
  // permission for the browser to select or authorize a recipient.
  let lock,profile;
  try{
    lock=JSON.parse(readFileSync(join(root,'config/public-module-sources.json'),'utf8'));
    profile=JSON.parse(readFileSync(join(root,'config/original-t2-agent-product.json'),'utf8'));
  }catch{
    throw Error('G4_AGENT_ONE_CORE_PRODUCT_SOURCE_LOCK_UNREADABLE');
  }
  const original=Array.isArray(lock.modules)
    ?lock.modules.filter(x=>x?.id==='t3'):[];
  if(original.length!==1||original[0].repository!=='Faust-S/knowledge'||
    original[0].revision!=='2f65931cd70e0c64e29b31e1824b7af0c0baf6d1'||
    profile.schema!=='IWXA_AGENT_ORIGINAL_T2_PRODUCT_PROFILE/1'||
    profile.productId!=='iwxa.personal-agent'||
    profile.authorizedNativeOwner!=='ORIGINAL_T3_SIGNED_EMPLOYEE'||
    profile.authorizedResultRecipient!==null||
    profile.installedAgentT3Mode!=='EXPLICIT_OPT_IN')
    throw Error('G4_AGENT_ORIGINAL_PRODUCT_NEUTRAL_ONE_CORE_PIN_MISMATCH');

  // The Core is loaded directly by Python in its own child process. The
  // temporary private checkout is removed by the existing finally block.
  return allowed.length;
}
export async function qualifyNativeOriginalEmployee({
  t3Token,agentToken,
  fetchT3=(path,token)=>getExactFile(path,token,{
    repository:'Faust-S/T3',sourcePin:T3_ORIGINAL_NATIVE_EMPLOYEE_PIN}),
  python='python',
}={}){
  if(process.platform!=='win32')throw Error('G4_NATIVE_WINDOWS_REQUIRED');
  if(!t3Token||!agentToken)throw Error('G4_NATIVE_PRIVATE_READ_GRANTS_REQUIRED');
  const root=mkdtempSync(join(tmpdir(),'iwxa-g4-native-'),{mode:0o700});
  try{
    const t3=join(root,'original-t3'),agent=join(root,'employee-agent');
    const t3Count=await stageOriginal(t3,t3Token,fetchT3);
    const agentCount=await stageAgent(agent,agentToken);
    // Fail early on a damaged original private source before credential
    // issuance. Only fixed machine codes leave this public Windows job.
    // The original code and syntax diagnostics never enter the CI output.
    for(const [base,relative] of [
      [t3,'interop/native-employee-d3.mjs'],
      [t3,'interop/native-admin-d3.mjs'],
      [agent,'runtime/t3_original_employee_worker.mjs']
    ]){
      const syntax=spawnSync(process.execPath,['--check',join(base,...relative.split('/'))],{
        encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:128*1024,
        env:{PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??'',
          WINDIR:process.env.WINDIR??''},
      });
      if(syntax.status!==0)
        throw Error('G4_NATIVE_PRIVATE_OWNER_SYNTAX_PRECHECK_FAILED');
    }

    // Separate child receives ONLY directory paths and a synthetic project
    // root. Neither PAT nor an original private source is printed.
    const env={
      PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??'',
      WINDIR:process.env.WINDIR??'',USERPROFILE:process.env.USERPROFILE??'',
      APPDATA:process.env.APPDATA??'',LOCALAPPDATA:process.env.LOCALAPPDATA??'',
      HOMEDRIVE:process.env.HOMEDRIVE??'',HOMEPATH:process.env.HOMEPATH??'',
      PSModulePath:process.env.PSModulePath??'',ComSpec:process.env.ComSpec??'',
      COMPUTERNAME:process.env.COMPUTERNAME??'',
      ProgramData:process.env.ProgramData??'',PATHEXT:process.env.PATHEXT??'',
      TEMP:process.env.TEMP??tmpdir(),TMP:process.env.TMP??tmpdir(),
      HOME:process.env.HOME??'',PYTHON_COMMAND:python,CI:'true',
      G4_ORIGINAL_PYTHON_COMMAND:process.env.pythonLocation
        ?join(process.env.pythonLocation,'python.exe'):'',
      G4_ORIGINAL_NODE_COMMAND:process.execPath,
      G4_ORIGINAL_QUALIFIED_T2_DIST:process.env.G4_ORIGINAL_QUALIFIED_T2_DIST??'',
      G4_AGENT_OLLAMA_BASE_URL:process.env.G4_AGENT_OLLAMA_BASE_URL??'',
      G4_AGENT_OLLAMA_MODEL:process.env.G4_AGENT_OLLAMA_MODEL??'',
      OLLAMA_HOST:process.env.OLLAMA_HOST??'',
      OLLAMA_MODELS:process.env.OLLAMA_MODELS??'',
    };
    const driver=join(process.cwd(),'packages','t3-core','tests',
      'g4-original-agent-native-windows.mjs');
    const employee=join(process.cwd(),'packages','t3-core','tests',
      'g4-original-agent-native-driver.py');
    const run=spawnSync(process.execPath,
      [driver,t3,agent,join(root,'fixture'),employee],
      {env,encoding:'utf8',timeout:900000,maxBuffer:1024*1024});
    const output=(run.stdout??'')+'\n'+(run.stderr??'');
    const markers=[
      'G4_ORIGINAL_AGENT_CORE_REAL_LOCAL_MODEL_SOURCE_PASS',
      'G4_ORIGINAL_AGENT_CORE_ACCEPTED_RESULT_PROOF_SOURCE_PASS',
      'G4_ORIGINAL_NATIVE_EMPLOYEE_SIGNED_TASK_PASS',
      'G4_ORIGINAL_NATIVE_EMPLOYEE_SIGNED_RESULT_PASS',
      'G4_ORIGINAL_NATIVE_ADMIN_ACCEPTED_READBACK_PASS',
      'G4_ORIGINAL_NATIVE_EMPLOYEE_COLD_NO_REEXPORT_PASS',
      'G4_ORIGINAL_PRODUCTION_OWNER_COLD_READBACK_PASS',
      'G4_ORIGINAL_AGENT_SECOND_SID_NATIVE_FIRST_USE_PASS',
      'G4_ORIGINAL_AGENT_SECOND_SID_NATIVE_DPAPI_COLD_PASS',
      'G4_ORIGINAL_AGENT_SECOND_SID_NATIVE_SIGNED_PROOF_PASS',
      'G4_ORIGINAL_AGENT_SECOND_SID_CRYPTO_PROOF_VERIFIED_PASS',
      'G4_ORIGINAL_PRODUCTION_INDEPENDENT_EMPLOYEE_CREDENTIAL_COLD_PASS',
      'G4_ORIGINAL_PRODUCTION_INDEPENDENT_AGENT_IPC_FIRST_USE_PASS',
      'G4_ORIGINAL_PRODUCTION_AGENT_FIRST_USE_NO_REPLAY_PASS',
      'G4_ORIGINAL_PRODUCTION_AGENT_MEMBERSHIP_CHALLENGE_PASS',
      'G4_ORIGINAL_PRODUCTION_EMPLOYEE_REAL_T2_KERNEL_ENROLLED_PASS',
      'G4_ORIGINAL_PRODUCTION_EMPLOYEE_REAL_T2_TASK_ISSUED_PASS',
      'G4_ORIGINAL_PRODUCTION_LEGACY_CLI_REVIEW_DENIED_PASS',
      'G4_ORIGINAL_PRODUCTION_EMPLOYEE_REAL_T2_AGENT_RESULT_PASS',
      'G4_ORIGINAL_PRODUCTION_EMPLOYEE_ADMIN_RESULT_RECEIVE_PASS',
      'G4_ORIGINAL_PRODUCTION_EMPLOYEE_ADMIN_HUMAN_ACCEPT_PASS',
      'G4_ORIGINAL_PRODUCTION_EMPLOYEE_REAL_T2_KERNEL_APPLY_PASS',
      'G4_ORIGINAL_PRODUCTION_EMPLOYEE_REAL_T2_COLD_READBACK_ONE_PASS',
      'G4_ORIGINAL_PRODUCTION_EMPLOYEE_REAL_T2_COLD_READBACK_TWO_PASS',
      'G4_ORIGINAL_PRODUCTION_EMPLOYEE_AGENT_SIGNED_TASK_RECEIVE_PASS',
      'G4_ORIGINAL_PRODUCTION_EMPLOYEE_AGENT_TASK_COLD_READBACK_PASS',
    ];
    const passed=run.status===0&&markers.every(x=>output.includes(x));
    console.log('G4_NATIVE_ORIGINAL_T3_FILES_READ',t3Count);
    console.log('G4_NATIVE_ORIGINAL_AGENT_FILES_READ',agentCount);
    for(const marker of markers)
      console.log(marker,output.includes(marker)?'PASS':'NOT_CONFIRMED');
    if(!passed){
      const step=output.match(/G4_NATIVE_FAILURE_PHASE\s+([A-Z_]{3,80})/);
      console.log('G4_NATIVE_FAILURE_PHASE',step?.[1]??'UNCLASSIFIED');
      const code=output.match(/G4_NATIVE_FAILURE_CODE\s+([A-Z0-9_]{3,120})/);
      console.log('G4_NATIVE_FAILURE_CODE',code?.[1]??'REDACTED');
      const secondSidStage=output.match(
        /G4_ORIGINAL_AGENT_TWO_SID_FAILURE_PHASE\s+([A-Z0-9_]{3,119})/);
      const secondSidCode=output.match(
        /G4_ORIGINAL_AGENT_TWO_SID_FAILURE_CODE\s+([A-Z0-9_]{3,119})/);
      const secondSidOriginal=output.match(
        /G4_ORIGINAL_AGENT_SECOND_SID_NATIVE_CODE\s+([A-Z0-9_]{3,119})/);
      if(secondSidStage||secondSidCode||secondSidOriginal){
        console.log('G4_NATIVE_SECOND_SID_FAILURE_PHASE',
          secondSidStage?.[1]??'UNCLASSIFIED');
        console.log('G4_NATIVE_SECOND_SID_FAILURE_CODE',
          secondSidCode?.[1]??'UNCLASSIFIED');
        console.log('G4_NATIVE_SECOND_SID_ORIGINAL_BRIDGE_CODE',
          secondSidOriginal?.[1]??'UNCLASSIFIED');
        const aclStatus=output.match(
          /G4_ORIGINAL_AGENT_TWO_SID_ACL_STATUS\s+((?:GRANT|ISOLATE)_[0-9]{1,5})/);
        if(aclStatus)console.log('G4_NATIVE_SECOND_SID_ACL_STATUS',aclStatus[1]);
      }
      const employeeStage=output.match(
        /G4_NATIVE_EMPLOYEE_FAILURE_PHASE\s+([A-Z_]{3,80})/);
      const employeeReason=output.match(
        /G4_NATIVE_EMPLOYEE_FAILURE_CODE\s+([A-Z0-9_]{3,120})/);
      if(employeeStage||employeeReason){
        console.log('G4_NATIVE_EMPLOYEE_FAILURE_PHASE',
          employeeStage?.[1]??'UNCLASSIFIED');
        console.log('G4_NATIVE_EMPLOYEE_FAILURE_CODE',
          employeeReason?.[1]??'UNCLASSIFIED');
        const cls=output.match(/G4_NATIVE_EMPLOYEE_FAILURE_CLASS\s+(KeyError|TypeError|ValueError|AssertionError|CorporateT3Error|OSError|TimeoutError|AttributeError|RuntimeError|IndexError)/);
        console.log('G4_NATIVE_EMPLOYEE_FAILURE_CLASS',
          cls?.[1]??'UNCLASSIFIED');
      }
      throw Error('G4_NATIVE_ORIGINAL_EMPLOYEE_SOURCE_PROCESS_NOT_ACCEPTED');
    }
    console.log('G4_NATIVE_PROCESS_SOURCE_PASS_NOT_INSTALLED_GUI');
    return {privateT3Files:t3Count,privateAgentFiles:agentCount};
  }finally{
    rmSync(root,{recursive:true,force:true,maxRetries:2});
    console.log('G4_NATIVE_PRIVATE_SOURCE_AND_EVIDENCE_REMOVED');
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  qualifyNativeOriginalEmployee({
    t3Token:process.env.T3_READ_TOKEN,
    agentToken:process.env.AGENT_READ_TOKEN,
  }).catch(e=>{
    console.error(/^G4_[A-Z0-9_]+$/.test(e?.message??'')?
      e.message:'G4_NATIVE_QUALIFICATION_FAILED');
    process.exitCode=1;
  });
}
