// Addressed native OWNER provider diagnosis. Execute only when explicitly
// requested. Uses the original Windows Credential module and its imports.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {stageOriginal} from './qualify-native-corporate-agent-process.mjs';
import {getExactFile} from './qualify-original-private-d3-owner.mjs';

const PIN='19be10c557618f5c8b476a739c8fc4ca0fa2ac7f';
let phase='FETCH',counter=0;
const sourceRoot=mkdtempSync(join(tmpdir(),'iwxa-original-credential-'));
try{
  if(process.platform!=='win32')throw Error('G4_NATIVE_WINDOWS_REQUIRED');
  const token=process.env.T3_READ_TOKEN;
  if(!token)throw Error('G4_NATIVE_PRIVATE_READ_GRANT_REQUIRED');
  counter=await stageOriginal(sourceRoot,token,(path,value)=>
    getExactFile(path,value,{repository:'Faust-S/T3',sourcePin:PIN}),
    ['access-control/windows-credential.mjs']);
  delete process.env.T3_READ_TOKEN;
  const original=await import(pathToFileURL(
    join(sourceRoot,'access-control','windows-credential.mjs')).href);
  phase='ORIGINAL_IDENTITY';
  const identity=original.windowsIdentity();
  assert.ok(identity.sid&&identity.deviceId);
  console.log('G4_ORIGINAL_PROVIDER_IDENTITY_PASS');
  phase='ORIGINAL_PROTECT';
  const plain=Buffer.from('g4-original-provider-only');
  const entropy=Buffer.from('g4-probe-entropy');
  const wrapped=original.dpapiProtect(plain,entropy);
  assert.ok(wrapped.length>0);
  console.log('G4_ORIGINAL_PROVIDER_PROTECT_PASS');
  phase='ORIGINAL_UNPROTECT';
  const clear=original.dpapiUnprotect(wrapped,entropy);
  assert.deepEqual(clear,plain);
  console.log('G4_ORIGINAL_PROVIDER_UNPROTECT_PASS');
  phase='ORIGINAL_VAULT_SECRET';
  const root=join(sourceRoot,'fixture');
  mkdirSync(root,{recursive:true});
  const created=original.windowsVaultSecret(root,{create:true});
  const recovered=original.windowsVaultSecret(root,{create:false});
  assert.equal(recovered,created);
  console.log('G4_ORIGINAL_PROVIDER_VAULT_SECRET_COLD_READBACK_PASS');
  const osKeys=[
    'PATH','SystemRoot','WINDIR','USERPROFILE','APPDATA','LOCALAPPDATA',
    'HOMEDRIVE','HOMEPATH','PSModulePath','ComSpec','ProgramData','PATHEXT',
    'TEMP','TMP','HOME',
  ];
  const isolatedEnv=Object.fromEntries(osKeys.map(key=>
    [key,process.env[key]??'']));
  const diagnostic=join(process.cwd(),'packages','t3-core','scripts',
    'probe-original-private-windows-credential-child.mjs');
  phase='ORIGINAL_PROVIDER_ISOLATED_CHILD';
  const processCheck=spawnSync(process.execPath,
    [diagnostic,sourceRoot,join(sourceRoot,'isolated-work')],
    {env:isolatedEnv,encoding:'utf8',timeout:110000,maxBuffer:512*1024});
  const childOutput=(processCheck.stdout??'')+'\n'+
    (processCheck.stderr??'');
  if(processCheck.status===0&&childOutput.includes(
    'G4_ORIGINAL_PROVIDER_CHILD_FULL_ROUNDTRIP_PASS')){
    console.log('G4_ORIGINAL_PROVIDER_ISOLATED_CHILD_PASS');
  }else{
    const stage=childOutput.match(/G4_ORIGINAL_PROVIDER_CHILD_FAILURE_PHASE\s+([A-Z_]+)/);
    const code=childOutput.match(/G4_ORIGINAL_PROVIDER_CHILD_FAILURE_CODE\s+([A-Z_]+)/);
    console.log('G4_ORIGINAL_PROVIDER_ISOLATED_CHILD_PHASE',
      stage?.[1]??'UNCLASSIFIED');
    console.log('G4_ORIGINAL_PROVIDER_ISOLATED_CHILD_CODE',
      code?.[1]??'UNCLASSIFIED');
    throw Error('G4_NATIVE_ORIGINAL_PROVIDER_NESTED_PROCESS_NOT_ACCEPTED');
  }

  console.log('G4_ORIGINAL_PROVIDER_SOURCE_FILES_READ',counter);
}catch(error){
  console.error('G4_ORIGINAL_PROVIDER_FAILURE_PHASE',phase);
  const c=error?.message??'';
  console.error('G4_ORIGINAL_PROVIDER_FAILURE_CODE',
    /^[A-Z][A-Z0-9_]{3,119}$/.test(c)?c:'UNCLASSIFIED');
  process.exitCode=1;
}finally{
  rmSync(sourceRoot,{recursive:true,force:true,maxRetries:2});
  console.log('G4_ORIGINAL_PROVIDER_EPHEMERAL_FILES_REMOVED');
}
