# G4 OS-only precondition for a future genuine installed Agent/Center
# two-Windows-SID GUI acceptance. This does NOT qualify either IWXA product.
# All credentials, account names, SID values, screenshots, UI labels and
# window handles remain on the disposable Windows runner. Only finite codes
# are printed. Never weaken D1/D3 to make this check pass.
$ErrorActionPreference='Stop'
$phase='START'
$localUser=$null
$probeRoot=$null
$worker=$null
$nativeChild=$null
$notepadId=0
try {
  if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){
    throw 'G4_SECOND_SID_NATIVE_GUI_WINDOWS_REQUIRED'
  }
  $managerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $managerSession=[Diagnostics.Process]::GetCurrentProcess().SessionId
  if($managerSid -notmatch '^S-1-5-21-[0-9-]+$'){
    throw 'G4_SECOND_SID_NATIVE_GUI_MANAGER_SID_REQUIRED'
  }
  $phase='SECOND_USER_CREATE'
  $nonce=([guid]::NewGuid().ToString('N')).Substring(0,10)
  $localUser='iwxag4gui'+$nonce
  $random=New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($random)
  $plainPassword=[Convert]::ToBase64String($random)+'Aa1!'
  $secure=ConvertTo-SecureString $plainPassword -AsPlainText -Force
  $null=New-LocalUser -Name $localUser -Password $secure -Description 'Disposable G4 second SID GUI probe' -AccountNeverExpires -PasswordNeverExpires -ErrorAction Stop
  $employeeSid=(Get-LocalUser -Name $localUser -ErrorAction Stop).SID.Value
  if($employeeSid -eq $managerSid -or $employeeSid -notmatch '^S-1-5-21-[0-9-]+$'){
    throw 'G4_SECOND_SID_NATIVE_GUI_IDENTITY_NOT_INDEPENDENT'
  }
  $phase='PRIVATE_FIXTURE_ACL'
  $probeRoot=Join-Path $env:ProgramData ('IWXA-G4-SECOND-SID-GUI-'+$nonce)
  $null=New-Item -ItemType Directory -Path $probeRoot -Force
  $nativeAcl=Join-Path $env:SystemRoot 'System32\icacls.exe'
  & $nativeAcl $probeRoot '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' ('*'+$employeeSid+':(OI)(CI)M') *> $null
  if($LASTEXITCODE -ne 0){throw 'G4_SECOND_SID_NATIVE_GUI_ACL_INVALID'}
  $worker=Join-Path $probeRoot 'worker.ps1'
  $child=@'
param([Parameter(Mandatory=$true)][string]$ProofRoot)
$ErrorActionPreference='Stop'
$childProcess=$null
try {
  $me=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $session=[Diagnostics.Process]::GetCurrentProcess().SessionId
  $exe=Join-Path $env:SystemRoot 'System32\notepad.exe'
  if(-not (Test-Path -LiteralPath $exe -PathType Leaf)){
    throw 'OS_NOTEPAD_NOT_FOUND'
  }
  $childProcess=Start-Process -FilePath $exe -PassThru -ErrorAction Stop
  $record=[ordered]@{sid=$me;session=$session;pid=$childProcess.Id}
  [IO.File]::WriteAllText((Join-Path $ProofRoot 'child-ready.json'),
    (ConvertTo-Json $record -Compress),[Text.UTF8Encoding]::new($false))
  Start-Sleep -Seconds 35
} catch {
  [IO.File]::WriteAllText((Join-Path $ProofRoot 'child-failed'),'FAILED',
    [Text.UTF8Encoding]::new($false))
  exit 1
} finally {
  if($childProcess){Stop-Process -Id $childProcess.Id -Force -ErrorAction SilentlyContinue}
}
'@
  [IO.File]::WriteAllText($worker,$child,[Text.UTF8Encoding]::new($false))
  $phase='SECOND_USER_PROCESS'
  $qualified=$env:COMPUTERNAME+'\'+$localUser
  $nativeCredential=[Management.Automation.PSCredential]::new($qualified,$secure)
  $pwsh=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $args='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$worker+'" -ProofRoot "'+$probeRoot+'"'
  $nativeChild=Start-Process -FilePath $pwsh -ArgumentList $args -Credential $nativeCredential -LoadUserProfile -PassThru -WindowStyle Hidden -ErrorAction Stop
  $ready=Join-Path $probeRoot 'child-ready.json'
  $failure=Join-Path $probeRoot 'child-failed'
  $observed=$false
  for($i=0;$i -lt 30;$i++){
    if(Test-Path -LiteralPath $failure){throw 'G4_SECOND_SID_NATIVE_GUI_CHILD_FAILED'}
    if(Test-Path -LiteralPath $ready){$observed=$true;break}
    Start-Sleep -Milliseconds 350
  }
  if(-not $observed){throw 'G4_SECOND_SID_NATIVE_GUI_CHILD_NOT_READY'}
  $record=Get-Content -LiteralPath $ready -Raw -Encoding UTF8 | ConvertFrom-Json
  if($record.sid -cne $employeeSid -or $record.sid -ceq $managerSid -or
     -not ($record.pid -is [int]) -or $record.pid -le 0){
    throw 'G4_SECOND_SID_NATIVE_GUI_TOKEN_IDENTITY_CHANGED'
  }
  $notepadId=[int]$record.pid
  Write-Output 'G4_SECOND_SID_NATIVE_GUI_DIFFERENT_WINDOWS_SID_PASS'
  $phase='SECOND_USER_WINDOW'
  $handle=[IntPtr]::Zero
  $session=-1
  for($i=0;$i -lt 55;$i++){
    $current=Get-Process -Id $notepadId -ErrorAction SilentlyContinue
    if(-not $current){throw 'G4_SECOND_SID_NATIVE_GUI_PROCESS_EXITED'}
    $handle=$current.MainWindowHandle
    $session=$current.SessionId
    if($handle -ne [IntPtr]::Zero){break}
    Start-Sleep -Milliseconds 250
  }
  if($handle -eq [IntPtr]::Zero){throw 'G4_SECOND_SID_NATIVE_GUI_WINDOW_UNAVAILABLE'}
  if($session -ne $managerSession -or $record.session -ne $managerSession){
    throw 'G4_SECOND_SID_NATIVE_GUI_DIFFERENT_DESKTOP_SESSION'
  }
  Write-Output 'G4_SECOND_SID_NATIVE_GUI_SAME_INTERACTIVE_SESSION_PASS'
  $phase='SECOND_USER_UI_AUTOMATION'
  Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes -ErrorAction Stop
  $element=[Windows.Automation.AutomationElement]::FromHandle($handle)
  if($null -eq $element -or $element.Current.ProcessId -ne $notepadId){
    throw 'G4_SECOND_SID_NATIVE_GUI_UIA_NOT_READABLE'
  }
  Write-Output 'G4_SECOND_SID_NATIVE_GUI_CROSS_ACCOUNT_UIA_PASS'
  Write-Output 'G4_SECOND_SID_NATIVE_GUI_OS_PRECONDITION_ONLY_NOT_INSTALLED_D3'
} catch {
  $allowed=@(
    'G4_SECOND_SID_NATIVE_GUI_WINDOWS_REQUIRED',
    'G4_SECOND_SID_NATIVE_GUI_MANAGER_SID_REQUIRED',
    'G4_SECOND_SID_NATIVE_GUI_IDENTITY_NOT_INDEPENDENT',
    'G4_SECOND_SID_NATIVE_GUI_ACL_INVALID',
    'G4_SECOND_SID_NATIVE_GUI_CHILD_FAILED',
    'G4_SECOND_SID_NATIVE_GUI_CHILD_NOT_READY',
    'G4_SECOND_SID_NATIVE_GUI_TOKEN_IDENTITY_CHANGED',
    'G4_SECOND_SID_NATIVE_GUI_PROCESS_EXITED',
    'G4_SECOND_SID_NATIVE_GUI_WINDOW_UNAVAILABLE',
    'G4_SECOND_SID_NATIVE_GUI_DIFFERENT_DESKTOP_SESSION',
    'G4_SECOND_SID_NATIVE_GUI_UIA_NOT_READABLE'
  )
  $code=[string]$_.Exception.Message
  if($code -cnotin $allowed){$code='G4_SECOND_SID_NATIVE_GUI_OS_UNCLASSIFIED'}
  Write-Output ('G4_SECOND_SID_NATIVE_GUI_FAILURE_PHASE '+$phase)
  Write-Output ('G4_SECOND_SID_NATIVE_GUI_FAILURE_CODE '+$code)
  throw 'G4_SECOND_SID_NATIVE_GUI_OS_PRECONDITION_FAILED'
} finally {
  if($notepadId -gt 0){Stop-Process -Id $notepadId -Force -ErrorAction SilentlyContinue}
  if($nativeChild){
    try{
      $nativeChild.Refresh()
      if(-not $nativeChild.HasExited){
        Stop-Process -Id $nativeChild.Id -Force -ErrorAction SilentlyContinue
      }
    }catch{}
  }
  if($localUser){Remove-LocalUser -Name $localUser -ErrorAction SilentlyContinue}
  if($probeRoot){Remove-Item -LiteralPath $probeRoot -Recurse -Force -ErrorAction SilentlyContinue}
}
