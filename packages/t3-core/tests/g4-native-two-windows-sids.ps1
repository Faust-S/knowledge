# IWXA G4: independent Windows SID + Windows CurrentUser DPAPI boundary.
# Public runner preflight ONLY, not installed Agent/Center or Human ACCEPT/APPLY.
$ErrorActionPreference = 'Stop'
$phase = 'START'
$root = $null
$user = $null
$taskName = $null
try {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'G4_TWO_SID_WINDOWS_REQUIRED'
  }
  $phase = 'CURRENT_MANAGER_SID'
  $managerSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if ($managerSid -notmatch '^S-1-5-21-[0-9-]+$') {
    throw 'G4_MANAGER_NATIVE_WINDOWS_SID_REQUIRED'
  }
  $phase = 'CREATE_SEPARATE_WINDOWS_ACCOUNT'
  $nonce = ([guid]::NewGuid().ToString('N')).Substring(0,12)
  $user = 'iwxag4' + $nonce
  $random = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($random)
  $password = [Convert]::ToBase64String($random) + 'Aa1!'
  $secure = ConvertTo-SecureString $password -AsPlainText -Force
  $null = New-LocalUser -Name $user -Password $secure -Description 'Disposable IWXA G4 SID proof' -AccountNeverExpires -PasswordNeverExpires
  $employeeSid = (Get-LocalUser -Name $user).SID.Value
  if ($employeeSid -eq $managerSid -or $employeeSid -notmatch '^S-1-5-21-[0-9-]+$') {
    throw 'G4_WINDOWS_EMPLOYEE_SID_NOT_INDEPENDENT'
  }
  $phase = 'ISOLATE_TEMPORARY_WORKSPACE'
  $root = Join-Path $env:ProgramData ('IWXA-G4-SID-' + $nonce)
  $null = New-Item -ItemType Directory -Path $root -Force
  # Grant the local employee only this disposable directory. Do not share
  # any manager vault, original checkout, GitHub token, default TEMP or build.
  & icacls.exe $root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' ("*" + $employeeSid + ':(OI)(CI)M') *> $null
  if ($LASTEXITCODE -ne 0) { throw 'G4_WINDOWS_EMPLOYEE_TEMP_ACL_FAILED' }
  $phase = 'MANAGER_DPAPI_ENCRYPT'
  Add-Type -AssemblyName System.Security
  $plain = [Text.Encoding]::UTF8.GetBytes('IWXA G4 manager isolation ' + $nonce)
  $entropy = [Text.Encoding]::UTF8.GetBytes('IWXA G4 native two-SID proof')
  $cipher = [Security.Cryptography.ProtectedData]::Protect($plain,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  [IO.File]::WriteAllBytes((Join-Path $root 'manager-currentuser.bin'),$cipher)
  $phase = 'STAGE_CHILD_PROOF'
  $worker = Join-Path $root 'employee-cold-proof.ps1'
  $child = @'
param([Parameter(Mandatory=$true)][string]$ProofRoot)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $entropy = [Text.Encoding]::UTF8.GetBytes('IWXA G4 native two-SID proof')
  $parent = [IO.File]::ReadAllBytes((Join-Path $ProofRoot 'manager-currentuser.bin'))
  $managerReadable = $false
  try {
    $null = [Security.Cryptography.ProtectedData]::Unprotect($parent,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    $managerReadable = $true
  } catch [System.Security.Cryptography.CryptographicException] {}
  if ($managerReadable) { throw 'G4_SECOND_SID_MANAGER_DPAPI_DECRYPTED' }
  $selfPath = Join-Path $ProofRoot 'employee-currentuser.bin'
  if (Test-Path -LiteralPath $selfPath) {
    $protected = [IO.File]::ReadAllBytes($selfPath)
    $opened = [Security.Cryptography.ProtectedData]::Unprotect($protected,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    if ([Text.Encoding]::UTF8.GetString($opened) -ne 'IWXA G4 employee cold DPAPI') {
      throw 'G4_SECOND_SID_EMPLOYEE_DPAPI_COLD_MISMATCH'
    }
  } else {
    $self = [Text.Encoding]::UTF8.GetBytes('IWXA G4 employee cold DPAPI')
    $encrypted = [Security.Cryptography.ProtectedData]::Protect($self,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    [IO.File]::WriteAllBytes($selfPath,$encrypted)
  }
  $proof = @{sid=$sid;managerUnreadable=$true;coldSelfReadback=$true}
  [IO.File]::WriteAllText((Join-Path $ProofRoot 'employee-proof.json'),(ConvertTo-Json $proof -Compress),[Text.Encoding]::UTF8)
} catch {
  [IO.File]::WriteAllText((Join-Path $ProofRoot 'employee-failure'),'G4_SECOND_SID_CHILD_PROOF_FAILED',[Text.Encoding]::UTF8)
  exit 1
}
'@
  [IO.File]::WriteAllText($worker,$child,[Text.Encoding]::UTF8)
  $taskName = 'IWXAG4SID' + $nonce
  $exe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $args = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $worker + '" -ProofRoot "' + $root + '"'
  $action = New-ScheduledTaskAction -Execute $exe -Argument $args
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 3) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
  $phase = 'REGISTER_SECOND_USER_BATCH_PROCESS'
  # Task Scheduler requires a resolvable machine-qualified NTAccount, not
  # PowerShell's local shorthand ".\name" on hosted Windows runners.
  $qualifiedUser = $env:COMPUTERNAME + '\' + $user
  $resolvedSid = $null
  for ($attempt = 0; $attempt -lt 10; $attempt++) {
    try {
      $resolvedSid = (New-Object Security.Principal.NTAccount($env:COMPUTERNAME,$user)).Translate([Security.Principal.SecurityIdentifier]).Value
      break
    } catch [System.Security.Principal.IdentityNotMappedException] {
      Start-Sleep -Milliseconds 300
    }
  }
  if ($resolvedSid -ne $employeeSid) { throw 'G4_EMPLOYEE_WINDOWS_NTACCOUNT_NOT_MAPPED' }
  $null = Register-ScheduledTask -TaskName $taskName -Action $action -Settings $settings -User $qualifiedUser -Password $password -Force -ErrorAction Stop
  for ($pass=1;$pass -le 2;$pass++) {
    $phase = 'COLD_SECOND_USER_PROCESS_' + $pass
    foreach($filename in @('employee-proof.json','employee-failure')) {
      Remove-Item -LiteralPath (Join-Path $root $filename) -Force -ErrorAction SilentlyContinue
    }
    Start-ScheduledTask -TaskName $taskName
    $response = Join-Path $root 'employee-proof.json'
    $failure = Join-Path $root 'employee-failure'
    $observed = $false
    for ($tick=0;$tick -lt 90;$tick++) {
      if (Test-Path -LiteralPath $failure) { throw 'G4_SECOND_SID_CHILD_PROOF_FAILED' }
      if (Test-Path -LiteralPath $response) { $observed = $true; break }
      Start-Sleep -Seconds 1
    }
    if (-not $observed) { throw 'G4_TWO_SID_COLD_PROCESS_NO_RESPONSE' }
    $record = Get-Content -LiteralPath $response -Raw | ConvertFrom-Json
    if ($record.sid -ne $employeeSid -or $record.sid -eq $managerSid -or $record.managerUnreadable -ne $true -or $record.coldSelfReadback -ne $true) {
      throw 'G4_TWO_SID_COLD_PROCESS_PROOF_CHANGED'
    }
  }
  $phase = 'MANAGER_CANNOT_DECRYPT_EMPLOYEE_CURRENTUSER'
  $childCipher = [IO.File]::ReadAllBytes((Join-Path $root 'employee-currentuser.bin'))
  $parentReadable = $false
  try {
    $null = [Security.Cryptography.ProtectedData]::Unprotect($childCipher,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    $parentReadable = $true
  } catch [System.Security.Cryptography.CryptographicException] {}
  if ($parentReadable) { throw 'G4_MANAGER_DECRYPTED_SECOND_SID_DPAPI' }
  Write-Output 'G4_ORIGINAL_WINDOWS_TWO_INDEPENDENT_SIDS_PASS'
  Write-Output 'G4_ORIGINAL_WINDOWS_DPAPI_BIDIRECTIONAL_ISOLATION_PASS'
  Write-Output 'G4_ORIGINAL_WINDOWS_EMPLOYEE_TWO_COLD_PROCESSES_PASS'
  Write-Output 'G4_WINDOWS_SID_PROOF_PRECONDITION_ONLY_NOT_INSTALLED_AGENT'
} catch {
  $code = [string]$_.Exception.Message
  if ($code -notmatch '^G4_[A-Z0-9_]{5,110}$') { $code = 'G4_TWO_SID_NATIVE_PRECONDITION_FAILED' }
  # Public OS-only fixture: bounded Windows HRESULT/category, never credentials.
  $hresult = $_.Exception.HResult
  if ($hresult -is [int]) { Write-Output ('G4_TWO_SID_FAILURE_HRESULT 0x' + $hresult.ToString('X8')) }
  $category = [string]$_.CategoryInfo.Category
  if ($category -match '^[A-Za-z]{3,35}$') { Write-Output ('G4_TWO_SID_FAILURE_CATEGORY ' + $category) }
  $id = [string]$_.FullyQualifiedErrorId
  if ($id -match '^[a-zA-Z0-9_.:-]{1,100}$') {
    Write-Output ('G4_TWO_SID_FAILURE_FQID ' + $id)
  }
  # Only an OS-only disposable account is involved in this phase; redact
  # user, password and all possible absolute paths before the public log.
  $osReason = [string]$_.Exception.Message
  if ($password) { $osReason = $osReason.Replace($password,'REDACTED') }
  if ($user) { $osReason = $osReason.Replace($user,'SECOND_ACCOUNT') }
  if ($root) { $osReason = $osReason.Replace($root,'TEMP_PATH') }
  $osReason = [regex]::Replace($osReason,'[A-Za-z]:\\[^\s"'';]+','PATH')
  if ($osReason.Length -gt 190) { $osReason = $osReason.Substring(0,190) }
  Write-Output ('G4_TWO_SID_FAILURE_OS_REASON ' + $osReason)
  Write-Output ('G4_TWO_SID_FAILURE_PHASE ' + $phase)
  Write-Output ('G4_TWO_SID_FAILURE_CODE ' + $code)
  throw 'G4_TWO_SID_NATIVE_PRECONDITION_NOT_ACCEPTED'
} finally {
  if ($taskName) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue }
  if ($user) { Remove-LocalUser -Name $user -ErrorAction SilentlyContinue }
  if ($root) { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
}
