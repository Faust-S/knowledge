// Windows runner capability probe. No private source, credentials or keys.
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
const exe=join(process.env.SystemRoot??'C:\\Windows',
  'System32','WindowsPowerShell','v1.0','powershell.exe');
const probe=(name,body)=>{
  const encoded=Buffer.from("$ErrorActionPreference='Stop';"+body,
    'utf16le').toString('base64');
  const result=spawnSync(exe,[
    '-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded,
  ],{input:'',encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:256*1024});
  const ok=result.status===0&&!result.error;
  console.log('G4_WINDOWS_PROVIDER_'+name,ok?'PASS':'FAIL',
    result.error?'SPAWN_ERROR':result.signal?'PROCESS_SIGNAL':
    result.status===null?'NO_EXIT_STATUS':'EXIT_'+result.status);
  return ok;
};
const checks={
  EXECUTABLE:existsSync(exe),
};
console.log('G4_WINDOWS_PROVIDER_EXECUTABLE',checks.EXECUTABLE?'PASS':'FAIL');
if(checks.EXECUTABLE){
  checks.POWERSHELL=probe('POWERSHELL',"Write-Output 'PASS'");
  checks.IDENTITY=probe('IDENTITY',"$id=[System.Security.Principal.WindowsIdentity]::GetCurrent();if(-not $id.User.Value){throw 'NO_SID'}");
  checks.DEVICE=probe('DEVICE',"$m=(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography').MachineGuid;if(-not $m){throw 'NO_MACHINE_GUID'}");
  checks.DPAPI=probe('DPAPI',[
    'Add-Type -AssemblyName System.Security;',
    '$b=[byte[]](7,2,9);$e=[byte[]](8,6);',
    '$p=[System.Security.Cryptography.ProtectedData]::Protect($b,$e,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);',
    '$u=[System.Security.Cryptography.ProtectedData]::Unprotect($p,$e,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);',
    'if($u.Length -ne 3 -or $u[0] -ne 7){throw "NO_ROUNDTRIP"}'
  ].join(''));
}
const passed=Object.values(checks).every(Boolean);
console.log('G4_WINDOWS_PROVIDER_CURRENT_USER_RESULT',passed?'PASS':'HOLD');
if(!passed)process.exitCode=1;
