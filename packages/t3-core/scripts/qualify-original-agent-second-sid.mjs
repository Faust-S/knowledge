// Dedicated, focused SOURCE proof of original Agent D3 employee DPAPI custody
// under a distinct real Windows SID. Does not execute model, installed GUI,
// Human ACCEPT/APPLY, nor original Kernel. No private code or keys published.
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {getExactFile} from './qualify-original-private-d3-owner.mjs';
import {stageOriginal,stageAgent,T3_ORIGINAL_NATIVE_EMPLOYEE_PIN}
  from './qualify-native-corporate-agent-process.mjs';
import {AGENT_ORIGINAL_PIN} from './qualify-original-agent-d3-port.mjs';
const code=source=>source&&/^[A-Z][A-Z0-9_]{3,119}$/.test(source)
  ?source:'UNCLASSIFIED';
export async function qualifyOriginalTwoSid({
  t3Token=process.env.T3_READ_TOKEN,
  agentToken=process.env.AGENT_READ_TOKEN,
}={}){
  if(process.platform!=='win32')throw Error('G4_NATIVE_WINDOWS_REQUIRED');
  if(!t3Token||!agentToken)throw Error('G4_NATIVE_PRIVATE_READ_GRANTS_REQUIRED');
  const root=mkdtempSync(join(tmpdir(),'iwxa-g4-two-user-'),{mode:0o700});
  let phase='STAGE';
  try{
    const t3=join(root,'original-owner'),agent=join(root,'original-agent');
    const t3Count=await stageOriginal(t3,t3Token,(path,token)=>
      getExactFile(path,token,{repository:'Faust-S/T3',
        sourcePin:T3_ORIGINAL_NATIVE_EMPLOYEE_PIN}));
    const agentCount=await stageAgent(agent,agentToken);
    phase='ISSUE_ORIGINAL_MANAGER_PUBLIC_TRUST';
    const original=await import(pathToFileURL(
      join(t3,'interop','native-admin-d3.mjs')).href);
    const owner=join(root,'original-manager');
    const org='org:g4-two-sid-native-employee';
    const ws='workspace:g4-two-sid-native-employee';
    const request=join(root,'manager-first-use.json');
    writeFileSync(request,JSON.stringify({
      organizationId:org,workspaceId:ws,
      organizationName:'IWXA G4 Two SID Signed Employee Qualification',
    }),{flag:'wx',mode:0o600});
    const registration=original.runNativeAdminD3([
      'd3-enroll',owner,org,request]);
    if(registration?.ownerMode!=='ORIGINAL_SIGNED_CORPORATE_D3'||
       registration?.view?.status!=='D3_OWNER_READY')
      throw Error('G4_ORIGINAL_MANAGER_ISSUER_NOT_READY');
    const identity=JSON.parse(readFileSync(join(owner,'identity.json'),'utf8'));
    const registry=JSON.parse(readFileSync(join(owner,'registry.json'),'utf8')).state;
    const issuer=registry.policy.keys[identity.issuer].publicKey;
    const reviewer=registry.policy.keys[identity.reviewKey].publicKey;
    const profile={
      audience:identity.audience,authorityId:identity.authority,
      confirmedIssuerSha256:createHash('sha256').update(issuer).digest('hex'),
      issuerKeyId:identity.issuer,issuerPublicKey:issuer,
      managerPersonId:identity.reviewer,
      organizationDataRootId:identity.organizationDataRootId,
      organizationId:identity.org,
      organizationName:identity.organizationName,
      realmId:identity.realm,reviewKeyId:identity.reviewKey,
      reviewPublicKey:reviewer,workspaceId:identity.workspace,
    };
    const publicProfile=join(root,'manager-public-trust.json');
    writeFileSync(publicProfile,JSON.stringify(profile),{
      flag:'wx',mode:0o600});
    phase='RUN_SECOND_WINDOWS_ACCOUNT_ORIGINAL_AGENT';
    const source=join(process.cwd(),'packages','t3-core','tests');
    const driver=join(source,'g4-original-employee-bootstrap-driver.py');
    const script=join(source,'g4-original-agent-second-windows-sid.ps1');
    const windowsRoot=process.env.SystemRoot??'C:\\Windows';
    const psModules=[process.env.PSModulePath??'',
      join(windowsRoot,'System32','WindowsPowerShell','v1.0','Modules')]
      .filter(Boolean).join(';');
    const env={
      PATH:process.env.PATH??'',SystemRoot:windowsRoot,
      PSModulePath:psModules,
      WINDIR:process.env.WINDIR??'',USERPROFILE:process.env.USERPROFILE??'',
      APPDATA:process.env.APPDATA??'',LOCALAPPDATA:process.env.LOCALAPPDATA??'',
      HOMEDRIVE:process.env.HOMEDRIVE??'',HOMEPATH:process.env.HOMEPATH??'',
      TEMP:process.env.TEMP??'',TMP:process.env.TMP??'',
      ProgramData:process.env.ProgramData??'',
      COMPUTERNAME:process.env.COMPUTERNAME??'',
      ComSpec:process.env.ComSpec??'',
    };
    const result=spawnSync(join(windowsRoot,'System32','WindowsPowerShell',
      'v1.0','powershell.exe'),[
      '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',
      script,'-T3Root',t3,'-AgentRoot',agent,
      '-PythonDriver',driver,'-PublicProfilePath',publicProfile,
    ],{cwd:root,env,encoding:'utf8',windowsHide:true,
      timeout:220000,maxBuffer:256*1024});
    const output=(result.stdout??'')+'\n'+(result.stderr??'');
    const expected=[
      'G4_ORIGINAL_AGENT_SECOND_SID_NATIVE_FIRST_USE_PASS',
      'G4_ORIGINAL_AGENT_SECOND_SID_NATIVE_DPAPI_COLD_PASS',
      'G4_ORIGINAL_AGENT_SECOND_SID_NATIVE_SIGNED_PROOF_PASS',
      'G4_ORIGINAL_AGENT_SECOND_SID_CRYPTO_PROOF_VERIFIED_PASS',
    ];
    console.log('G4_ORIGINAL_TWO_SID_OWNER_STAGED_FILES',t3Count);
    console.log('G4_ORIGINAL_TWO_SID_AGENT_STAGED_FILES',agentCount);
    for(const marker of expected)
      console.log(marker,output.includes(marker)?'PASS':'NOT_CONFIRMED');
    if(result.status!==0||!expected.every(x=>output.includes(x))){
      const extract=(key)=>output.match(new RegExp(
        key+'\\s+([A-Z0-9_]{3,119})'))?.[1];
      console.log('G4_ORIGINAL_TWO_SID_FAILURE_PHASE',
        code(extract('G4_ORIGINAL_AGENT_TWO_SID_FAILURE_PHASE')));
      console.log('G4_ORIGINAL_TWO_SID_FAILURE_CODE',
        code(extract('G4_ORIGINAL_AGENT_TWO_SID_FAILURE_CODE')));
      console.log('G4_ORIGINAL_TWO_SID_ACL_STATUS',
        output.match(/G4_ORIGINAL_EMPLOYEE_SHARED_ROOT_(GRANT|ISOLATE)_EXIT\s+([0-9]{1,6})/)
          ?.slice(1).join('_')??'NOT_OBSERVED');
      const klass=extract('G4_ORIGINAL_EMPLOYEE_OS_FAILURE_CLASS');
      const fqid=extract('G4_ORIGINAL_EMPLOYEE_OS_FAILURE_FQID');
      const kind=extract('G4_ORIGINAL_EMPLOYEE_OS_FAILURE_KIND');
      if(klass)console.log('G4_ORIGINAL_TWO_SID_OS_ERROR_CLASS',code(klass.toUpperCase()));
      if(fqid)console.log('G4_ORIGINAL_TWO_SID_OS_ERROR_ID',code(fqid.toUpperCase()));
      if(kind)console.log('G4_ORIGINAL_TWO_SID_OS_ERROR_KIND',code(kind));
      const nativeCode=extract('G4_ORIGINAL_AGENT_SECOND_SID_NATIVE_CODE');
      if(nativeCode)console.log('G4_ORIGINAL_TWO_SID_BRIDGE_CODE',code(nativeCode));
      throw Error('G4_ORIGINAL_SECOND_SID_AGENT_SOURCE_NOT_ACCEPTED');
    }
    console.log('G4_ORIGINAL_AGENT_SECOND_SID_SOURCE_PASS_NOT_INSTALLED');
    return {t3Count,agentCount};
  }catch(error){
    console.log('G4_ORIGINAL_TWO_SID_FAILURE_OUTER_PHASE',phase);
    throw error;
  }finally{
    rmSync(root,{recursive:true,force:true,maxRetries:2});
    console.log('G4_ORIGINAL_TWO_SID_EPHEMERAL_SOURCE_REMOVED');
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  qualifyOriginalTwoSid().catch(error=>{
    console.error(code(error?.message));
    process.exitCode=1;
  });
}
