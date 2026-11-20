# Original IWXA Agent installed Setup Core under a second REAL Windows SID.
# Public orchestration only: no private source, signer, model output or task
# content is printed or staged outside the runner. This accepts ONLY guest
# native installation, GUI readback and cold launch, never corporate D3.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Setup,
  [Parameter(Mandatory=$true)][string]$AgentSourceSha,
  [string]$OriginalOwnerRoot='',
  [string]$PublicTrustProfile='',
  [string]$EmployeeFirstUseDriver='',
  [string]$EmployeeProofVerifier=''
)
$ErrorActionPreference='Stop'
$phase='PREPARE'
$originalArguments=@($OriginalOwnerRoot,$PublicTrustProfile,
  $EmployeeFirstUseDriver,$EmployeeProofVerifier)
$originalEnabled=($originalArguments|Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count -gt 0
if($originalEnabled -and
   (($originalArguments|Where-Object { -not [IO.Path]::IsPathRooted($_) -or
      -not (Test-Path -LiteralPath $_) }).Count -gt 0)){
  throw 'G4_INSTALLED_GUEST_ORIGINAL_SIGNER_INPUT_INCOMPLETE'
}
$account=$null
$root=$null
$workerProcess=$null
$nativePid=0
try {
  if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){
    throw 'G4_AGENT_GUEST_WINDOWS_REQUIRED'
  }
  if($AgentSourceSha -cnotmatch '^[a-f0-9]{40}$' -or
     !(Test-Path -LiteralPath $Setup -PathType Leaf)){
    throw 'G4_AGENT_GUEST_ORIGINAL_SETUP_REQUIRED'
  }
  $managerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $managerSession=[Diagnostics.Process]::GetCurrentProcess().SessionId
  if($managerSid -notmatch '^S-1-5-21-[0-9-]+$'){
    throw 'G4_AGENT_GUEST_MANAGER_IDENTITY_INVALID'
  }
  $phase='GUEST_WINDOWS_USER'
  $nonce=([guid]::NewGuid().ToString('N')).Substring(0,10)
  $account='iwxag4ag'+$nonce
  $random=New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($random)
  $password=ConvertTo-SecureString (([Convert]::ToBase64String($random))+'Aa1!') -AsPlainText -Force
  $null=New-LocalUser -Name $account -Password $password -Description 'Disposable installed Agent G4 SID fixture' -AccountNeverExpires -PasswordNeverExpires -ErrorAction Stop
  $guestSid=(Get-LocalUser -Name $account -ErrorAction Stop).SID.Value
  if($guestSid -eq $managerSid -or $guestSid -notmatch '^S-1-5-21-[0-9-]+$'){
    throw 'G4_AGENT_GUEST_INDEPENDENT_SID_REQUIRED'
  }
  $phase='GUEST_BUNDLE_SCOPE'
  $root=Join-Path $env:ProgramData ('IWXA-G4-INSTALLED-GUEST-'+$nonce)
  $null=New-Item -ItemType Directory -Path $root -Force
  $acl=Join-Path $env:SystemRoot 'System32\icacls.exe'
  & $acl $root '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' ('*'+$guestSid+':(OI)(CI)M') *> $null
  if($LASTEXITCODE -ne 0){throw 'G4_AGENT_GUEST_BUNDLE_ACL_FAILED'}
  $package=Join-Path $root 'original-setup-core.exe'
  Copy-Item -LiteralPath $Setup -Destination $package -ErrorAction Stop
  $originalHash=(Get-FileHash -LiteralPath $Setup -Algorithm SHA256).Hash
  if((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash -cne $originalHash){
    throw 'G4_AGENT_GUEST_SETUP_BYTES_CHANGED'
  }
  $originalSource=''
  $publicTrust=''
  $pythonDriver=''
  $nodeVerifier=''
  $nodePath=''
  if($originalEnabled){
    # Copy only the original pinned SOURCE modules, never the manager vault.
    # A distinct original manager root stays restricted to Administrators.
    $originalSource=Join-Path $root 'original-owner'
    New-Item -ItemType Directory -Path $originalSource -Force|Out-Null
    foreach($sourcePart in @('interop','access-control','reconciliation')){
      $part=Join-Path $OriginalOwnerRoot $sourcePart
      if(!(Test-Path -LiteralPath $part -PathType Container)){
        throw 'G4_INSTALLED_GUEST_ORIGINAL_SIGNER_SOURCE_INCOMPLETE'
      }
      Copy-Item -LiteralPath $part -Destination $originalSource -Recurse -ErrorAction Stop
    }
    $publicTrust=Join-Path $root 'public-trust.json'
    $pythonDriver=Join-Path $root 'original-employee-first-use.py'
    $nodeVerifier=Join-Path $root 'original-employee-verify.mjs'
    Copy-Item -LiteralPath $PublicTrustProfile -Destination $publicTrust -ErrorAction Stop
    Copy-Item -LiteralPath $EmployeeFirstUseDriver -Destination $pythonDriver -ErrorAction Stop
    Copy-Item -LiteralPath $EmployeeProofVerifier -Destination $nodeVerifier -ErrorAction Stop
    $nodePath=(Get-Command node.exe -ErrorAction Stop).Source
    if(-not [IO.Path]::IsPathRooted($nodePath) -or
       !(Test-Path -LiteralPath $nodePath -PathType Leaf)){
      throw 'G4_INSTALLED_GUEST_ORIGINAL_NODE_MISSING'
    }
  }
  $request=Join-Path $root 'input.json'
  [ordered]@{sourceSha=$AgentSourceSha;setup=$package;scope=$root;
    signedOwner=[bool]$originalEnabled;owner=$originalSource;trust=$publicTrust;
    driver=$pythonDriver;verifier=$nodeVerifier;node=$nodePath
  }|ConvertTo-Json -Compress|Set-Content -LiteralPath $request -Encoding UTF8

  # Executed by the SECOND Windows SID, not the manager. Existing Setup Core
  # CLI is the only installer, product registry owner and uninstaller.
  $script=@'
param([Parameter(Mandatory=$true)][string]$ProofRoot)
$ErrorActionPreference='Stop'
$phase='BEGIN'
$native=$null
try {
  $request=Get-Content -LiteralPath (Join-Path $ProofRoot 'input.json') -Raw -Encoding UTF8|ConvertFrom-Json
  $setup=[string]$request.setup
  # Setup Core intentionally refuses CommonApplicationData (ProgramData) for
  # every install/data location. ProofRoot is shared ONLY for ephemeral CI
  # receipts; the real installed application belongs to this guest SID.
  $guestLocal=[Environment]::GetFolderPath(
    [Environment+SpecialFolder]::LocalApplicationData)
  $guestHome=[Environment]::GetFolderPath(
    [Environment+SpecialFolder]::UserProfile)
  $caseName=Split-Path -Path $ProofRoot -Leaf
  if([string]::IsNullOrWhiteSpace($guestLocal) -or
     [string]::IsNullOrWhiteSpace($guestHome) -or
     $caseName -cnotmatch '^IWXA-G4-INSTALLED-GUEST-[a-f0-9]{10}$' -or
     -not $guestLocal.StartsWith(($guestHome.TrimEnd('\')+'\'),
       [StringComparison]::OrdinalIgnoreCase)){
    throw 'GUEST_LOCAL_USER_PROFILE_INVALID'
  }
  $guestRoot=Join-Path $guestLocal $caseName
  $program=Join-Path $guestRoot 'application'
  $data=Join-Path $guestRoot 'data'
  $locations=Join-Path $ProofRoot 'locations.json'
  $registry='HKCU:\Software\IWXA\SetupCore\Products\iwxa.personal-agent'
  if(Test-Path -LiteralPath $registry){throw 'GUEST_EXISTING_PRODUCT'}
  $script:setupFailureMode='NONE'
  $script:setupFailureCode='NONE'
  $script:setupFailurePhase='NONE'
  function InvokeOriginalSetup([string]$mode,[string]$output,[string]$arg=''){
    $script:setupFailureMode=switch($mode){
      '--inspect-file' {'INSPECT'}
      '--preflight-file' {'PREFLIGHT'}
      '--install-locations-file' {'INSTALL'}
      '--verify-installed-file' {'VERIFY'}
      '--uninstall-file' {'UNINSTALL'}
      default {'UNKNOWN'}
    }
    $argv=if($arg){
      '{0} "{1}" "{2}"' -f $mode,$arg,$output
    }else{
      '{0} "{1}"' -f $mode,$output
    }
    $p=Start-Process -FilePath $setup -ArgumentList $argv -PassThru -WindowStyle Hidden -ErrorAction Stop
    try {
      $exited=$p.WaitForExit(180000)
      $code=if($exited){$p.ExitCode}else{-1}
    }finally{$p.Dispose()}
    if(!(Test-Path -LiteralPath $output -PathType Leaf)){
      throw 'GUEST_SETUP_RECEIPT_MISSING'
    }
    $receipt=Get-Content -LiteralPath $output -Raw -Encoding UTF8|ConvertFrom-Json
    if($receipt.status -ceq 'ERROR'){
      # Setup Core's machine-readable error class is finite and path-free.
      # Never publish its unrestricted raw reason or exception text.
      $reason=[string]$receipt.reason
      $phase=[string]$receipt.installPhase
      if($reason -cmatch '^SETUP_[A-Z0-9_]{3,90}$'){
        $script:setupFailureCode=$reason
      }
      if($phase -cmatch '^[A-Z][A-Z0-9_]{2,45}$'){
        $script:setupFailurePhase=$phase
      }
    }
    if(-not $exited -or $code -ne 0){throw 'GUEST_SETUP_FAILED'}
    return $receipt
  }
  function LaunchNative {
    $exe=Join-Path $program 'desktop\bin\IWXA Personal.exe'
    if(!(Test-Path -LiteralPath $exe -PathType Leaf)){throw 'GUEST_NATIVE_EXE_MISSING'}
    $p=Start-Process -FilePath $exe -WorkingDirectory $program -PassThru -ErrorAction Stop
    for($i=0;$i -lt 160;$i++){
      $p.Refresh()
      if($p.HasExited){throw 'GUEST_NATIVE_WINDOW_EXITED'}
      if($p.MainWindowHandle -ne [IntPtr]::Zero -and
         $p.MainWindowTitle -ceq 'IWXA Personal'){return $p}
      Start-Sleep -Milliseconds 250
    }
    throw 'GUEST_NATIVE_WINDOW_UNAVAILABLE'
  }
  function ConfirmGuestEditor([Diagnostics.Process]$p){
    # A visible HWND precedes the WebView's Core-owned draft restoration.
    # Verify the fresh guest's empty editor on first launch and cold reopen.
    $probe=Join-Path $program 'tools\qualify_setup_core_native_gui.ps1'
    try {
      & $probe -WindowProcessId $p.Id -Mode readback -ExpectedSha256 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' | Out-Null
    }catch{throw 'GUEST_NATIVE_EDITOR_READBACK_FAILED'}
  }
  function StopNative([Diagnostics.Process]$p){
    if($p -eq $null){return}
    $p.Refresh()
    if(-not $p.HasExited){
      if(-not $p.CloseMainWindow()){throw 'GUEST_NATIVE_CLOSE_NOT_ACKNOWLEDGED'}
      # Allow the original WebView2 and local runtime to drain after WM_CLOSE.
      # Still require the *same* original process to exit, never force PASS.
      if(-not $p.WaitForExit(60000)){throw 'GUEST_NATIVE_GRACEFUL_CLOSE_FAILED'}
    }
  }
  $phase='SECOND_SID_SETUP'
  $user=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $session=[Diagnostics.Process]::GetCurrentProcess().SessionId
  $inspect=InvokeOriginalSetup '--inspect-file' (Join-Path $ProofRoot 'identity.json')
  if($inspect.status -cne 'VERIFIED' -or
     $inspect.product -cne 'iwxa.personal-agent' -or
     $inspect.sourceCommit -cne $request.sourceSha){
    throw 'GUEST_SIGNED_ORIGINAL_SETUP_IDENTITY_INVALID'
  }
  $pre=InvokeOriginalSetup '--preflight-file' (Join-Path $ProofRoot 'preflight.json')
  if($pre.status -cne 'READY_FOR_FIRST_INSTALL'){throw 'GUEST_SETUP_PREFLIGHT_FAILED'}
  [ordered]@{
    schema='IWXA_SETUP_LOCATIONS/1';programRoot=$program;dataRoot=$data;
    softwareRoot=(Join-Path $guestRoot 'software');
    modelsRoot=(Join-Path $guestRoot 'models');
    cacheRoot=(Join-Path $guestRoot 'cache');startWithWindows=$false
  }|ConvertTo-Json -Compress|Set-Content -LiteralPath $locations -Encoding UTF8
  $installed=InvokeOriginalSetup '--install-locations-file' (Join-Path $ProofRoot 'installed.json') $locations
  if($installed.status -cne 'INSTALLED_NOT_LAUNCHED' -or
     -not (Test-Path -LiteralPath $registry) -or
     !(Test-Path -LiteralPath $program -PathType Container)){
    throw 'GUEST_ORIGINAL_INSTALL_NOT_REGISTERED'
  }
  $verified=InvokeOriginalSetup '--verify-installed-file' (Join-Path $ProofRoot 'verify.json')
  if($verified.status -cne 'OWNED_FILES_VERIFIED'){throw 'GUEST_SETUP_FILE_VERIFICATION_FAILED'}
  $phase='SECOND_SID_NATIVE_FIRST_GUI'
  $native=LaunchNative
  ConfirmGuestEditor $native
  StopNative $native
  $native=$null
  $phase='SECOND_SID_NATIVE_COLD_GUI'
  $native=LaunchNative
  ConfirmGuestEditor $native
  $reply=[ordered]@{sid=$user;session=$session;pid=$native.Id;
    coldHwnd=[int64]$native.MainWindowHandle}
  [IO.File]::WriteAllText((Join-Path $ProofRoot 'ui-ready.json'),
    (ConvertTo-Json $reply -Compress),[Text.UTF8Encoding]::new($false))
  $ack=Join-Path $ProofRoot 'manager-uia-confirmed'
  $observed=$false
  for($i=0;$i -lt 200;$i++){
    if(Test-Path -LiteralPath $ack){$observed=$true;break}
    Start-Sleep -Milliseconds 250
  }
  if(-not $observed){throw 'GUEST_MANAGER_UIA_ACK_MISSING'}
  StopNative $native
  $native=$null
  $originalEmployeeVerified=$false
  if($request.signedOwner -eq $true){
    $phase='SECOND_SID_ORIGINAL_SIGNER_FIRST_USE'
    $installReceipt=Get-Content -LiteralPath (Join-Path $program 'explorer-install-receipt.json') -Raw -Encoding UTF8|ConvertFrom-Json
    $pythonRelative=[string]$installReceipt.managed_runtime.python_executable
    if([string]::IsNullOrWhiteSpace($pythonRelative) -or
       [IO.Path]::IsPathRooted($pythonRelative) -or
       $pythonRelative.Contains('..') -or $pythonRelative.Contains(':')){
      throw 'GUEST_ORIGINAL_SIGNER_INSTALLED_PYTHON_INVALID'
    }
    $installedPython=[IO.Path]::GetFullPath((Join-Path $program $pythonRelative.Replace('/','\')))
    if(-not $installedPython.StartsWith($program.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase) -or
       !(Test-Path -LiteralPath $installedPython -PathType Leaf)){
      throw 'GUEST_ORIGINAL_SIGNER_INSTALLED_PYTHON_MISSING'
    }
    $env:PYTHONPATH=$program
    $env:PYTHONDONTWRITEBYTECODE='1'
    $env:PYTHONNOUSERSITE='1'
    $env:IWXA_T3_ORIGINAL_OWNER_DIR=[string]$request.owner
    $guestCandidate=Join-Path $guestRoot 'original-employee'
    $guestCandidateReceipt=Join-Path $guestRoot 'original-employee-receipt.json'
    $guestSignedProof=Join-Path $guestRoot 'original-employee-public-proof.json'
    $runArgs=@('--program',$program,'--owner',[string]$request.owner,
      '--node',[string]$request.node,'--profile',[string]$request.trust,
      '--root',$guestCandidate,'--receipt',$guestCandidateReceipt,
      '--proof',$guestSignedProof)
    $firstUseLog=Join-Path $ProofRoot 'original-employee-first-use.status'
    & $installedPython -B ([string]$request.driver) --phase create @runArgs > $firstUseLog 2>&1
    if($LASTEXITCODE -ne 0 -or
       @((Get-Content -LiteralPath $firstUseLog -ErrorAction SilentlyContinue)) -cnotcontains
         'G4_INSTALLED_EMPLOYEE_ORIGINAL_NATIVE_FIRST_USE_PASS'){
      throw 'GUEST_ORIGINAL_SIGNER_FIRST_USE_FAILED'
    }
    $phase='SECOND_SID_ORIGINAL_SIGNER_COLD_READBACK'
    & $installedPython -B ([string]$request.driver) --phase readback @runArgs > $firstUseLog 2>&1
    $readbackRows=@(Get-Content -LiteralPath $firstUseLog -ErrorAction SilentlyContinue)
    if($LASTEXITCODE -ne 0 -or
       $readbackRows -cnotcontains 'G4_INSTALLED_EMPLOYEE_ORIGINAL_DPAPI_COLD_READBACK_PASS' -or
       $readbackRows -cnotcontains 'G4_INSTALLED_EMPLOYEE_SIGNED_PROOF_CREATED_UNVERIFIED'){
      throw 'GUEST_ORIGINAL_SIGNER_COLD_READBACK_FAILED'
    }
    $phase='SECOND_SID_ORIGINAL_SIGNER_PROOF_VERIFY'
    $verifiedLog=Join-Path $ProofRoot 'original-employee-signature.status'
    & ([string]$request.node) ([string]$request.verifier) ([string]$request.owner) $guestSignedProof > $verifiedLog 2>&1
    if($LASTEXITCODE -ne 0 -or
       @((Get-Content -LiteralPath $verifiedLog -ErrorAction SilentlyContinue)) -cnotcontains
          'G4_INSTALLED_EMPLOYEE_ORIGINAL_SIGNED_PROOF_VERIFIED_PASS'){
      throw 'GUEST_ORIGINAL_SIGNER_PROOF_INVALID'
    }
    $originalEmployeeVerified=$true
  }
  $phase='SECOND_SID_UNINSTALL'
  $marker=Join-Path $data 'guest-data-preservation.fixture'
  [IO.File]::WriteAllText($marker,'PRESERVE',[Text.UTF8Encoding]::new($false))
  $uninstall=InvokeOriginalSetup '--uninstall-file' (Join-Path $ProofRoot 'uninstall.json')
  if($uninstall.status -cne 'UNINSTALLED_USER_DATA_PRESERVED' -or
     (Test-Path -LiteralPath $registry) -or
     !(Test-Path -LiteralPath $marker -PathType Leaf) -or
     [IO.File]::ReadAllText($marker) -cne 'PRESERVE'){
    throw 'GUEST_UNINSTALL_OR_DATA_PRESERVATION_FAILED'
  }
  [IO.File]::WriteAllText((Join-Path $ProofRoot 'guest-finished.json'),
    (ConvertTo-Json ([ordered]@{status='PASS';sid=$user;sourceSha=$request.sourceSha;
      originalSetup=$true;nativeGuiCold=$true;uninstallPreservedData=$true;
      originalEmployeeSignerVerified=$originalEmployeeVerified
    }) -Compress),[Text.UTF8Encoding]::new($false))
} catch {
  $allowed=@('GUEST_EXISTING_PRODUCT','GUEST_SETUP_FAILED','GUEST_SETUP_RECEIPT_MISSING',
    'GUEST_NATIVE_EXE_MISSING','GUEST_NATIVE_WINDOW_EXITED',
    'GUEST_NATIVE_WINDOW_UNAVAILABLE','GUEST_NATIVE_CLOSE_NOT_ACKNOWLEDGED',
    'GUEST_NATIVE_GRACEFUL_CLOSE_FAILED','GUEST_NATIVE_EDITOR_READBACK_FAILED','GUEST_SIGNED_ORIGINAL_SETUP_IDENTITY_INVALID',
    'GUEST_SETUP_PREFLIGHT_FAILED','GUEST_ORIGINAL_INSTALL_NOT_REGISTERED',
    'GUEST_SETUP_FILE_VERIFICATION_FAILED','GUEST_MANAGER_UIA_ACK_MISSING',
    'GUEST_UNINSTALL_OR_DATA_PRESERVATION_FAILED',
    'GUEST_LOCAL_USER_PROFILE_INVALID',
    'GUEST_ORIGINAL_SIGNER_INSTALLED_PYTHON_INVALID',
    'GUEST_ORIGINAL_SIGNER_INSTALLED_PYTHON_MISSING',
    'GUEST_ORIGINAL_SIGNER_FIRST_USE_FAILED',
    'GUEST_ORIGINAL_SIGNER_COLD_READBACK_FAILED',
    'GUEST_ORIGINAL_SIGNER_PROOF_INVALID')
  $reason=[string]$_.Exception.Message
  if($reason -cnotin $allowed){$reason='GUEST_UNKNOWN'}
  [IO.File]::WriteAllText((Join-Path $ProofRoot 'guest-failure.json'),
    (ConvertTo-Json ([ordered]@{
      phase=$phase;code=$reason;setupMode=$script:setupFailureMode;
      setupReason=$script:setupFailureCode;setupPhase=$script:setupFailurePhase
    }) -Compress),
    [Text.UTF8Encoding]::new($false))
  exit 1
} finally {
  if($native){
    try{
      $native.Refresh()
      if(-not $native.HasExited){Stop-Process -Id $native.Id -Force -ErrorAction SilentlyContinue}
    }catch{}
  }
}
'@
  $runner=Join-Path $root 'second-user-runner.ps1'
  [IO.File]::WriteAllText($runner,$script,[Text.UTF8Encoding]::new($false))
  $phase='SECOND_SID_ORIGINAL_INSTALL_GUI_COLD'
  $qualified=$env:COMPUTERNAME+'\'+$account
  $credential=[Management.Automation.PSCredential]::new($qualified,$password)
  $powershell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $args='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$runner+'" -ProofRoot "'+$root+'"'
  $workerProcess=Start-Process -FilePath $powershell -ArgumentList $args -Credential $credential -LoadUserProfile -PassThru -WindowStyle Hidden -ErrorAction Stop
  $uiReady=Join-Path $root 'ui-ready.json'
  $failed=Join-Path $root 'guest-failure.json'
  $observed=$false
  for($i=0;$i -lt 340;$i++){
    if(Test-Path -LiteralPath $failed){throw 'G4_AGENT_GUEST_ORIGINAL_NATIVE_CHILD_FAILED'}
    if(Test-Path -LiteralPath $uiReady){$observed=$true;break}
    Start-Sleep -Milliseconds 500
  }
  if(-not $observed){throw 'G4_AGENT_GUEST_GUI_RECEIPT_TIMEOUT'}
  $ready=Get-Content -LiteralPath $uiReady -Raw -Encoding UTF8|ConvertFrom-Json
  if($ready.sid -cne $guestSid -or $ready.sid -ceq $managerSid -or
     $ready.session -ne $managerSession -or
     [int]$ready.pid -le 0){
    throw 'G4_AGENT_GUEST_NATIVE_PROCESS_NOT_SECOND_SID'
  }
  $nativePid=[int]$ready.pid
  $running=Get-Process -Id $nativePid -ErrorAction Stop
  if($running.SessionId -ne $managerSession -or
     $running.MainWindowHandle -eq [IntPtr]::Zero -or
     [int64]$running.MainWindowHandle -ne [int64]$ready.coldHwnd){
    throw 'G4_AGENT_GUEST_INSTALLED_NATIVE_WINDOW_CHANGED'
  }
  Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes -ErrorAction Stop
  $window=[Windows.Automation.AutomationElement]::FromHandle($running.MainWindowHandle)
  if($null -eq $window -or $window.Current.ProcessId -ne $nativePid){
    throw 'G4_AGENT_GUEST_NATIVE_CROSS_SID_UIA_FAILED'
  }
  [IO.File]::WriteAllText((Join-Path $root 'manager-uia-confirmed'),'OK',[Text.UTF8Encoding]::new($false))
  $phase='SECOND_SID_UNINSTALL_PRESERVE_READBACK'
  $done=Join-Path $root 'guest-finished.json'
  $completed=$false
  for($i=0;$i -lt 180;$i++){
    if(Test-Path -LiteralPath $failed){throw 'G4_AGENT_GUEST_ORIGINAL_NATIVE_CHILD_FAILED'}
    if(Test-Path -LiteralPath $done){$completed=$true;break}
    Start-Sleep -Milliseconds 400
  }
  if(-not $completed){throw 'G4_AGENT_GUEST_PRESERVATION_RECEIPT_TIMEOUT'}
  $result=Get-Content -LiteralPath $done -Raw -Encoding UTF8|ConvertFrom-Json
  # The ORIGINAL guest writer must emit typed JSON booleans ($true), not
  # PowerShell barewords (string "true"). Preserve exact identity comparison.
  $finalFailure=if($result.status -cne 'PASS'){
    'STATUS'
  }elseif($result.sid -cne $guestSid){
    'WINDOWS_SID'
  }elseif($result.sourceSha -cne $AgentSourceSha){
    'EXACT_AGENT_SOURCE'
  }elseif(($result.originalSetup -isnot [bool]) -or $result.originalSetup -cne $true){
    'ORIGINAL_SETUP_TYPED_BOOL'
  }elseif(($result.nativeGuiCold -isnot [bool]) -or $result.nativeGuiCold -cne $true){
    'NATIVE_COLD_TYPED_BOOL'
  }elseif(($result.uninstallPreservedData -isnot [bool]) -or $result.uninstallPreservedData -cne $true){
    'PRESERVED_DATA_TYPED_BOOL'
  }elseif($originalEnabled -and
          (($result.originalEmployeeSignerVerified -isnot [bool]) -or
            $result.originalEmployeeSignerVerified -cne $true)){
    'ORIGINAL_EMPLOYEE_SIGNER'
  }else{'NONE'}
  if($finalFailure -cne 'NONE'){
    # Fixed finite enum only; never publish SID, key, path or source bytes.
    Write-Output ('G4_AGENT_GUEST_FINAL_RECEIPT_FAILURE_CLASS '+$finalFailure)
    throw 'G4_AGENT_GUEST_ORIGINAL_SETUP_FINAL_RECEIPT_INVALID'
  }
  Write-Output 'G4_AGENT_INSTALLED_GUEST_SECOND_WINDOWS_SID_PASS'
  Write-Output 'G4_AGENT_INSTALLED_GUEST_ORIGINAL_SETUP_CORE_PASS'
  Write-Output 'G4_AGENT_INSTALLED_GUEST_NATIVE_GUI_COLD_UIA_PASS'
  Write-Output 'G4_AGENT_INSTALLED_GUEST_UNINSTALL_PRESERVE_PASS'
  if($originalEnabled){
    Write-Output 'G4_AGENT_INSTALLED_GUEST_ORIGINAL_SIGNER_FIRST_USE_DPAPI_COLD_PASS'
    Write-Output 'G4_AGENT_INSTALLED_GUEST_ORIGINAL_SIGNED_EMPLOYEE_PROOF_PASS'
    Write-Output 'G4_AGENT_INSTALLED_GUEST_NOT_CROSS_PRODUCT_ACCEPT_APPLY'
  }
  Write-Output 'G4_AGENT_INSTALLED_GUEST_NOT_CORPORATE_ACCEPT_APPLY'
} catch {
  $reason=[string]$_.Exception.Message
  $allowed=@('G4_AGENT_GUEST_WINDOWS_REQUIRED','G4_AGENT_GUEST_ORIGINAL_SETUP_REQUIRED',
    'G4_AGENT_GUEST_MANAGER_IDENTITY_INVALID','G4_AGENT_GUEST_INDEPENDENT_SID_REQUIRED',
    'G4_AGENT_GUEST_BUNDLE_ACL_FAILED','G4_AGENT_GUEST_SETUP_BYTES_CHANGED',
    'G4_AGENT_GUEST_ORIGINAL_NATIVE_CHILD_FAILED','G4_AGENT_GUEST_GUI_RECEIPT_TIMEOUT',
    'G4_AGENT_GUEST_NATIVE_PROCESS_NOT_SECOND_SID',
    'G4_AGENT_GUEST_INSTALLED_NATIVE_WINDOW_CHANGED',
    'G4_AGENT_GUEST_NATIVE_CROSS_SID_UIA_FAILED',
    'G4_AGENT_GUEST_PRESERVATION_RECEIPT_TIMEOUT',
    'G4_AGENT_GUEST_ORIGINAL_SETUP_FINAL_RECEIPT_INVALID')
  if($reason -cnotin $allowed){$reason='G4_AGENT_GUEST_UNCLASSIFIED'}
  Write-Output ('G4_AGENT_GUEST_FAILURE_PHASE '+$phase)
  Write-Output ('G4_AGENT_GUEST_FAILURE_CODE '+$reason)
  if($root){
    $failed=Join-Path $root 'guest-failure.json'
    if(Test-Path -LiteralPath $failed){
      try {
        $row=Get-Content -LiteralPath $failed -Raw -Encoding UTF8|ConvertFrom-Json
        if([string]$row.phase -cmatch '^[A-Z][A-Z0-9_]{2,70}$'){
          Write-Output ('G4_AGENT_GUEST_CHILD_FAILURE_PHASE '+$row.phase)
        }
        if([string]$row.code -cmatch '^GUEST_[A-Z0-9_]{4,90}$'){
          Write-Output ('G4_AGENT_GUEST_CHILD_FAILURE_CODE '+$row.code)
        }
        if([string]$row.setupMode -cin @('INSPECT','PREFLIGHT','INSTALL','VERIFY','UNINSTALL')){
          Write-Output ('G4_AGENT_GUEST_SETUP_FAILURE_MODE '+$row.setupMode)
        }
        if([string]$row.setupReason -cmatch '^SETUP_[A-Z0-9_]{3,90}$'){
          Write-Output ('G4_AGENT_GUEST_SETUP_FAILURE_REASON '+$row.setupReason)
        }
        if([string]$row.setupPhase -cmatch '^[A-Z][A-Z0-9_]{2,45}$' -and
           [string]$row.setupPhase -cne 'NONE'){
          Write-Output ('G4_AGENT_GUEST_SETUP_FAILURE_PHASE '+$row.setupPhase)
        }
      }catch{}
    }
  }
  throw 'G4_AGENT_GUEST_INSTALLED_ACCEPTANCE_FAILED'
} finally {
  if($nativePid -gt 0){Stop-Process -Id $nativePid -Force -ErrorAction SilentlyContinue}
  if($workerProcess){
    try {
      $workerProcess.Refresh()
      if(-not $workerProcess.HasExited){
        Stop-Process -Id $workerProcess.Id -Force -ErrorAction SilentlyContinue
      }
    }catch{}
  }
  if($account){Remove-LocalUser -Name $account -ErrorAction SilentlyContinue}
  if($root){Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue}
}
