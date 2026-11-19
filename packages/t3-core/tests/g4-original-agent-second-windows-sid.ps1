# IWXA G4: ORIGINAL T3 employee DPAPI custody through central Agent IPC
# under a second Windows logon SID. Public source qualification ONLY.
# This is NOT native installed Agent Tauri GUI or human-operated ACCEPT/APPLY.
param(
  [Parameter(Mandatory=$true)][string]$T3Root,
  [Parameter(Mandatory=$true)][string]$AgentRoot,
  [Parameter(Mandatory=$true)][string]$PythonDriver,
  [Parameter(Mandatory=$true)][string]$PublicProfilePath
)
$ErrorActionPreference = 'Stop'
$phase = 'START'
$root = $null
$user = $null
try {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'G4_ORIGINAL_EMPLOYEE_WINDOWS_REQUIRED'
  }
  foreach ($path in @($T3Root,$AgentRoot,$PythonDriver,$PublicProfilePath)) {
    if (-not [IO.Path]::IsPathRooted($path) -or -not (Test-Path -LiteralPath $path)) {
      throw 'G4_ORIGINAL_EMPLOYEE_SOURCE_PATH_REQUIRED'
    }
  }
  $managerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $nonce = ([guid]::NewGuid().ToString('N')).Substring(0,12)
  $phase = 'CREATE_WINDOWS_EMPLOYEE'
  $user = 'iwxag4' + $nonce
  $random = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($random)
  $password = [Convert]::ToBase64String($random) + 'Aa1!'
  $secure = ConvertTo-SecureString $password -AsPlainText -Force
  $null = New-LocalUser -Name $user -Password $secure -Description 'Ephemeral T3 original employee source witness' -AccountNeverExpires -PasswordNeverExpires
  $employeeSid = (Get-LocalUser -Name $user).SID.Value
  if ($employeeSid -eq $managerSid -or $employeeSid -notmatch '^S-1-5-21-[0-9-]+$') {
    throw 'G4_ORIGINAL_EMPLOYEE_WINDOWS_SID_NOT_DISTINCT'
  }
  $qualifiedUser = $env:COMPUTERNAME + '\' + $user
  $translated = $null
  # Local SAM membership appears asynchronously on hosted Windows runners.
  # Read-only identity resolution may retry, but never duplicate first-use.
  for ($attempt=0; $attempt -lt 12; $attempt++) {
    try {
      $translated = (New-Object Security.Principal.NTAccount($env:COMPUTERNAME,$user)).Translate([Security.Principal.SecurityIdentifier]).Value
      break
    } catch [System.Security.Principal.IdentityNotMappedException] {
      Start-Sleep -Milliseconds 300
    }
  }
  if ($translated -ne $employeeSid) {
    throw 'G4_ORIGINAL_EMPLOYEE_WINDOWS_SID_NOT_RESOLVED'
  }
  $phase = 'STAGE_ONLY_PUBLIC_TRUST_AND_NATIVE_PORT'
  $root = Join-Path $env:ProgramData ('IWXA-T3-Employee-SID-' + $nonce)
  $null = New-Item -ItemType Directory -Path $root -Force
  # First grant exact explicit access while inherited administrator authority
  # still exists; only THEN remove inheritance. Reversing the order can
  # remove the caller's ability to set the final explicit ACL.
  & icacls.exe $root /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' ("*" + $employeeSid + ':(OI)(CI)M') *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Output ('G4_ORIGINAL_EMPLOYEE_SHARED_ROOT_GRANT_EXIT ' + $LASTEXITCODE)
    throw 'G4_ORIGINAL_EMPLOYEE_SHARED_ROOT_ACL_FAILED'
  }
  & icacls.exe $root /inheritance:r *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Output ('G4_ORIGINAL_EMPLOYEE_SHARED_ROOT_ISOLATE_EXIT ' + $LASTEXITCODE)
    throw 'G4_ORIGINAL_EMPLOYEE_SHARED_ROOT_ACL_FAILED'
  }
  # Original private SOURCE may be executable by the second account; ORIGINAL
  # Admin Manager DPAPI vault never enters these two source directories.
  foreach ($source in @($T3Root,$AgentRoot)) {
    & icacls.exe $source /grant ("*" + $employeeSid + ':(OI)(CI)RX') /T *> $null
    if ($LASTEXITCODE -ne 0) { throw 'G4_ORIGINAL_EMPLOYEE_SOURCE_READ_ACL_FAILED' }
  }
  & icacls.exe $PythonDriver /grant ("*" + $employeeSid + ':R') *> $null
  if ($LASTEXITCODE -ne 0) { throw 'G4_ORIGINAL_EMPLOYEE_DRIVER_READ_ACL_FAILED' }
  $profile = Get-Content -LiteralPath $PublicProfilePath -Raw | ConvertFrom-Json
  if ($profile.organizationId -notmatch '^org:' -or
      $profile.issuerPublicKey -notmatch 'BEGIN PUBLIC KEY' -or
      $profile.reviewPublicKey -notmatch 'BEGIN PUBLIC KEY') {
    throw 'G4_ORIGINAL_EMPLOYEE_PUBLIC_TRUST_REQUIRED'
  }
  $publicCopy = Join-Path $root 'trust-profile.json'
  Copy-Item -LiteralPath $PublicProfilePath -Destination $publicCopy
  $candidateRoot = Join-Path $root 'original-employee'
  $worker = Join-Path $root 'run-one-original-agent-call.ps1'
  $workerSource = @'
param([Parameter(Mandatory=$true)][string]$ConfigPath,
      [Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
try {
  $cfg = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  $env:PATH = $cfg.executablePath
  $env:PYTHONPATH = $cfg.agentRoot
  $env:IWXA_T3_ORIGINAL_OWNER_DIR = $cfg.t3Root
  $env:PYTHONDONTWRITEBYTECODE = '1'
  $env:PYTHONNOUSERSITE = '1'
  $env:G4_EMPLOYEE_BOOTSTRAP_ROOT = $cfg.candidateRoot
  $env:G4_EMPLOYEE_BOOTSTRAP_MODE = $cfg.mode
  $env:G4_EMPLOYEE_PUBLIC_PROFILE_PATH = $cfg.profilePath
  if ($cfg.requestPath) {
    $env:G4_EMPLOYEE_PUBLIC_REQUEST_PATH = $cfg.requestPath
    $env:G4_EMPLOYEE_ORIGINAL_CHALLENGE = $cfg.challenge
  }
  $raw = & $cfg.python $cfg.driver 2>$null
  $exit = $LASTEXITCODE
  $reply = [string]::Join([Environment]::NewLine,@($raw))
  $response = @{sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
    exitCode=$exit;output=$reply}
  [IO.File]::WriteAllText($OutputPath,(ConvertTo-Json $response -Compress -Depth 12),[Text.Encoding]::UTF8)
} catch {
  $fallback = @{sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
    exitCode=1;output='';error='G4_ORIGINAL_AGENT_SECOND_SID_CHILD_FAILED'}
  [IO.File]::WriteAllText($OutputPath,(ConvertTo-Json $fallback -Compress),[Text.Encoding]::UTF8)
  exit 1
}
'@
  [IO.File]::WriteAllText($worker,$workerSource,[Text.Encoding]::UTF8)
  $pythonCommand = (Get-Command python -ErrorAction Stop).Source
  $credential = [System.Management.Automation.PSCredential]::new($qualifiedUser,$secure)
  $exe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $phase = 'INDEPENDENT_AGENT_IPC_COLD_PROCESSES'
  $sequence = 0
  function Invoke-OriginalEmployee {
    param([string]$Mode,[string]$RequestPath='',[string]$Challenge='')
    $script:sequence++
    $requestFile = Join-Path $root ('call-' + $script:sequence + '.json')
    $replyFile = Join-Path $root ('reply-' + $script:sequence + '.json')
    $configuration = @{
      python=$pythonCommand;driver=$PythonDriver;agentRoot=$AgentRoot;
      t3Root=$T3Root;candidateRoot=$candidateRoot;mode=$Mode;
      profilePath=$publicCopy;requestPath=$RequestPath;challenge=$Challenge;
      executablePath=$env:PATH
    }
    [IO.File]::WriteAllText($requestFile,(ConvertTo-Json $configuration -Compress -Depth 6),[Text.Encoding]::UTF8)
    $args = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
      $worker + '" -ConfigPath "' + $requestFile + '" -OutputPath "' + $replyFile + '"'
    $process = Start-Process -FilePath $exe -ArgumentList $args -Credential $credential -LoadUserProfile -PassThru -Wait -WindowStyle Hidden -ErrorAction Stop
    if (-not (Test-Path -LiteralPath $replyFile)) {
      throw 'G4_ORIGINAL_AGENT_SECOND_SID_RESPONSE_MISSING'
    }
    $readback = Get-Content -LiteralPath $replyFile -Raw | ConvertFrom-Json
    if ($readback.sid -ne $employeeSid -or $readback.sid -eq $managerSid) {
      throw 'G4_ORIGINAL_AGENT_SECOND_SID_IDENTITY_CHANGED'
    }
    if ($process.ExitCode -ne 0 -or $readback.exitCode -ne 0) {
      $shape = [string]$readback.output
      if ($shape -match 'G4_EMPLOYEE_BOOTSTRAP_FAILURE_CODE ([A-Z0-9_]{3,119})') {
        Write-Output ('G4_ORIGINAL_AGENT_SECOND_SID_NATIVE_CODE ' + $Matches[1])
      }
      throw 'G4_ORIGINAL_AGENT_SECOND_SID_BRIDGE_FAILED'
    }
    try { return ($readback.output | ConvertFrom-Json -ErrorAction Stop) }
    catch { throw 'G4_ORIGINAL_AGENT_SECOND_SID_JSON_RESPONSE_INVALID' }
  }
  $created = Invoke-OriginalEmployee -Mode 'CREATE'
  $candidate = $created.candidate
  if ($candidate.schema -ne 'IWXA_T3_ORIGINAL_EMPLOYEE_WINDOWS_CANDIDATE/1' -or
      $candidate.state -ne 'AWAITING_ORIGINAL_MANAGER_ENROLLMENT' -or
      $candidate.originalKernelEnrollment -ne $false -or
      $candidate.employeePersonId -eq $profile.managerPersonId) {
    throw 'G4_ORIGINAL_AGENT_SECOND_SID_FIRST_USE_INVALID'
  }
  $phase = 'INDEPENDENT_AGENT_IPC_DPAPI_COLD_READ'
  $cold = Invoke-OriginalEmployee -Mode 'READ_CANDIDATE'
  if ($cold.candidate.employeePersonId -ne $candidate.employeePersonId -or
      $cold.candidate.credentialKeyId -ne $candidate.credentialKeyId -or
      $cold.candidate.employeeProofKeyRecord.publicKey -ne $candidate.employeeProofKeyRecord.publicKey) {
    throw 'G4_ORIGINAL_AGENT_SECOND_SID_DPAPI_COLD_CHANGED'
  }
  $phase = 'INDEPENDENT_ORIGINAL_PROOF_CHALLENGE'
  $grantId = 'proof-key:prospective'
  $request = @{
    id='proof-key:employee:' + [guid]::NewGuid().ToString()
    actorId=$candidate.employeePersonId;principalId=$profile.organizationId
    roleId='worker';grantId=$grantId;audience='t3.employee.enrollment'
    resource=$profile.workspaceId;action='work.prepare';purpose='work'
    realmId=$profile.realmId
    operationDigest='1' * 64
  }
  $requestFile = Join-Path $root 'proof-request.json'
  [IO.File]::WriteAllText($requestFile,(ConvertTo-Json $request -Compress -Depth 4),[Text.Encoding]::UTF8)
  $salt = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($salt)
  $challenge = -join ($salt | ForEach-Object { $_.ToString('x2') })
  $proved = Invoke-OriginalEmployee -Mode 'COLD_PROOF' -RequestPath $requestFile -Challenge $challenge
  if ($proved.candidate.employeePersonId -ne $candidate.employeePersonId -or
      $proved.proof.keyId -ne $candidate.credentialKeyId -or
      $proved.proof.payload.environment -ne 'PRODUCTION' -or
      $proved.proof.payload.kind -ne 'PROOF' -or
      $proved.proof.payload.challenge -ne $challenge) {
    throw 'G4_ORIGINAL_AGENT_SECOND_SID_PROOF_CHANGED'
  }
  # The manager can verify the employee's public proof, but never receives
  # either original private employee key, encrypted vault or plaintext.
  $public = Join-Path $root 'cross-sid-original-proof.json'
  $verified = @{schema='G4_ORIGINAL_AGENT_TWO_SID_PROOF/1';
    managerSid=$managerSid;employeeSid=$employeeSid;
    candidate=$candidate;proof=$proved.proof;challenge=$challenge;request=$request}
  [IO.File]::WriteAllText($public,(ConvertTo-Json $verified -Compress -Depth 16),[Text.Encoding]::UTF8)
  $proofVerifier = Join-Path $root 'verify-original-employee-proof.mjs'
  $verifyCode = @'
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {verify,createPublicKey} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [proofPath,t3Root]=process.argv.slice(2);
const p=JSON.parse(readFileSync(proofPath,'utf8'));
const {canonical,digest}=await import(pathToFileURL(
  join(t3Root,'access-control','core.mjs')).href);
if(p.schema!=='G4_ORIGINAL_AGENT_TWO_SID_PROOF/1'||
   p.managerSid===p.employeeSid||
   p.proof.keyId!==p.candidate.credentialKeyId||
   p.proof.payload.requestDigest!==digest(p.request)||
   p.proof.payload.challenge!==p.challenge)process.exit(2);
const bytes=Buffer.from('IWXA-T3-ACCESS-SIGNED-V1\0'+canonical({
  schema:p.proof.schema,keyId:p.proof.keyId,payload:p.proof.payload}));
const okay=verify(null,bytes,createPublicKey(
  p.candidate.employeeProofKeyRecord.publicKey),
  Buffer.from(p.proof.signature,'base64url'));
if(!okay)process.exit(3);
'@
  [IO.File]::WriteAllText($proofVerifier,$verifyCode,[Text.Encoding]::UTF8)
  & node $proofVerifier $public $T3Root *> $null
  if ($LASTEXITCODE -ne 0) { throw 'G4_ORIGINAL_AGENT_SECOND_SID_CRYPTO_PROOF_INVALID' }
  Write-Output 'G4_ORIGINAL_AGENT_SECOND_SID_CRYPTO_PROOF_VERIFIED_PASS'
  Write-Output 'G4_ORIGINAL_AGENT_SECOND_SID_NATIVE_FIRST_USE_PASS'
  Write-Output 'G4_ORIGINAL_AGENT_SECOND_SID_NATIVE_DPAPI_COLD_PASS'
  Write-Output 'G4_ORIGINAL_AGENT_SECOND_SID_NATIVE_SIGNED_PROOF_PASS'
  Write-Output 'G4_ORIGINAL_AGENT_SECOND_SID_SOURCE_ONLY_NOT_INSTALLED'
} catch {
  $code = [string]$_.Exception.Message
  if ($code -notmatch '^G4_[A-Z0-9_]{5,110}$') { $code='G4_ORIGINAL_AGENT_SECOND_SID_NOT_QUALIFIED' }
  if ($phase -in @('CREATE_WINDOWS_EMPLOYEE','STAGE_ONLY_PUBLIC_TRUST_AND_NATIVE_PORT')) {
    $failureClass = $_.Exception.GetType().Name
    if ($failureClass -match '^[A-Za-z]{3,45}$') {
      Write-Output ('G4_ORIGINAL_EMPLOYEE_OS_FAILURE_CLASS ' + $failureClass)
    }
    $fqid = [string]$_.FullyQualifiedErrorId
    if ($fqid -match '^[A-Za-z][A-Za-z0-9_,.:-]{1,110}$') {
      Write-Output ('G4_ORIGINAL_EMPLOYEE_OS_FAILURE_FQID ' + $fqid)
    }
    $message = [string]$_.Exception.Message
    if ($message -match '(?i)no mapping|identitynotmapped|cannot be mapped') {
      Write-Output 'G4_ORIGINAL_EMPLOYEE_OS_FAILURE_KIND ACCOUNT_RESOLUTION'
    } elseif ($message -match '(?i)account exists|already exists') {
      Write-Output 'G4_ORIGINAL_EMPLOYEE_OS_FAILURE_KIND ACCOUNT_EXISTS'
    } elseif ($message -match '(?i)account name|account could|account identity') {
      Write-Output 'G4_ORIGINAL_EMPLOYEE_OS_FAILURE_KIND ACCOUNT_RESOLUTION'
    } elseif ($message -match '(?i)privilege|administrat') {
      Write-Output 'G4_ORIGINAL_EMPLOYEE_OS_FAILURE_KIND PRIVILEGE_REQUIRED'
    } elseif ($message -match '(?i)password') {
      Write-Output 'G4_ORIGINAL_EMPLOYEE_OS_FAILURE_KIND PASSWORD_POLICY'
    } elseif ($message -match '(?i)not recognized|not found|not available') {
      Write-Output 'G4_ORIGINAL_EMPLOYEE_OS_FAILURE_KIND COMMAND_UNAVAILABLE'
    } elseif ($message -match '(?i)access is denied|unauthoriz|permission') {
      Write-Output 'G4_ORIGINAL_EMPLOYEE_OS_FAILURE_KIND ACCESS_DENIED'
    } elseif ($message -match '(?i)parameter|invalid argument') {
      Write-Output 'G4_ORIGINAL_EMPLOYEE_OS_FAILURE_KIND INVALID_ARGUMENT'
    } else {
      Write-Output 'G4_ORIGINAL_EMPLOYEE_OS_FAILURE_KIND OTHER'
    }
  }
  Write-Output ('G4_ORIGINAL_AGENT_TWO_SID_FAILURE_PHASE ' + $phase)
  Write-Output ('G4_ORIGINAL_AGENT_TWO_SID_FAILURE_CODE ' + $code)
  throw 'G4_ORIGINAL_AGENT_TWO_SID_SOURCE_NOT_ACCEPTED'
} finally {
  if ($user) { Remove-LocalUser -Name $user -ErrorAction SilentlyContinue }
  if ($root) { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
}
