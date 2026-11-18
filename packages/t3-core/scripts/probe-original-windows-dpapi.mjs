// Windows runner capability probe. No private source, credentials or keys.
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const exe=join(process.env.SystemRoot??'C:\\Windows',
  'System32','WindowsPowerShell','v1.0','powershell.exe');
const probe=(name,body,env=process.env,input='')=>{
  const encoded=Buffer.from("$ErrorActionPreference='Stop';"+body,
    'utf16le').toString('base64');
  const result=spawnSync(exe,[
    '-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded,
  ],{input,env,encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:256*1024});
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
const keys=[
  'PATH','SystemRoot','WINDIR','USERPROFILE','APPDATA','LOCALAPPDATA',
  'HOMEDRIVE','HOMEPATH','PSModulePath','ComSpec','ProgramData','PATHEXT',
  'TEMP','TMP','HOME',
];
const narrowed=Object.fromEntries(keys.filter(k=>typeof process.env[k]==='string')
  .map(k=>[k,process.env[k]]));
const originalIdentity="$i=[System.Security.Principal.WindowsIdentity]::GetCurrent();"+
  "$m=(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography').MachineGuid;"+
  "@{sid=$i.User.Value;name=$i.Name;deviceId=$m}|ConvertTo-Json -Compress";
if(checks.EXECUTABLE){
  checks.EXACT_IDENTITY_FULL=probe('EXACT_IDENTITY_FULL',originalIdentity);
  checks.EXACT_IDENTITY_NARROW=probe('EXACT_IDENTITY_NARROW',originalIdentity,narrowed);
  const input=JSON.stringify({
    data:Buffer.from('synthetic-g4-only').toString('base64'),
    entropy:Buffer.from('native-source-probe').toString('base64'),
  });
  const exactProtection="Add-Type -AssemblyName System.Security;"+
    "$v=ConvertFrom-Json ([Console]::In.ReadToEnd());"+
    "$b=[Convert]::FromBase64String($v.data);"+
    "$e=[Convert]::FromBase64String($v.entropy);"+
    "[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect($b,$e,[System.Security.Cryptography.DataProtectionScope]::CurrentUser))";
  checks.EXACT_PROTECT_FULL=probe('EXACT_PROTECT_FULL',exactProtection,process.env,input);
  checks.EXACT_PROTECT_NARROW=probe('EXACT_PROTECT_NARROW',exactProtection,narrowed,input);
}

function rawProcess(body,env,input=''){
  return spawnSync(exe,[
    '-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',
    Buffer.from("$ErrorActionPreference='Stop';"+body,'utf16le').toString('base64'),
  ],{input,env,encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:256*1024});
}
function verifySeparateDPAPIProcesses(environment,name){
  const bytes=Buffer.from('synthetic-public-dpapi-roundtrip-only');
  const entropy=Buffer.from('original-current-user-fixture');
  const payload=JSON.stringify({data:bytes.toString('base64'),
    entropy:entropy.toString('base64')});
  const protect="Add-Type -AssemblyName System.Security;"+
    "$v=ConvertFrom-Json ([Console]::In.ReadToEnd());"+
    "$b=[Convert]::FromBase64String($v.data);"+
    "$e=[Convert]::FromBase64String($v.entropy);"+
    "[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect($b,$e,[System.Security.Cryptography.DataProtectionScope]::CurrentUser))";
  const unprotect=protect.replace('::Protect($b,$e','::Unprotect($b,$e');
  const produced=rawProcess(protect,environment,payload);
  const sealed=produced.stdout?.trim()??'';
  const created=produced.status===0&&!produced.error&&
    /^[A-Za-z0-9+/=]+$/.test(sealed)&&sealed.length>10;
  let confirmed=false;
  if(created){
    const root=mkdtempSync(join(tmpdir(),'g4-dpapi-public-probe-'));
    try{
      const pathname=join(root,'synthetic.json');
      writeFileSync(pathname,JSON.stringify({blob:sealed}));
      const stored=JSON.parse(readFileSync(pathname,'utf8'));
      const read=rawProcess(unprotect,environment,JSON.stringify({
        data:stored.blob,entropy:entropy.toString('base64'),
      }));
      confirmed=read.status===0&&!read.error&&
        read.stdout.trim()===bytes.toString('base64');
    }finally{rmSync(root,{recursive:true,force:true});}
  }
  console.log('G4_WINDOWS_PROVIDER_TWO_PROCESS_'+name,
    created?'PROTECT_PASS':'PROTECT_FAIL',
    confirmed?'UNPROTECT_PASS':'UNPROTECT_FAIL');
  return created&&confirmed;
}
if(checks.EXECUTABLE){
  checks.SEPARATE_FULL=verifySeparateDPAPIProcesses(process.env,'FULL');
  checks.SEPARATE_NARROW=verifySeparateDPAPIProcesses(narrowed,'NARROW');
}

const passed=Object.values(checks).every(Boolean);
console.log('G4_WINDOWS_PROVIDER_CURRENT_USER_RESULT',passed?'PASS':'HOLD');
if(!passed)process.exitCode=1;
