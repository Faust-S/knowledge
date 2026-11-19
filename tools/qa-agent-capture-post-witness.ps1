# Capture genuine installed Agent in its own disposable Windows profile after native UIA draft proof.
# Never access private source text, task values, model outputs, or any host user profile.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$FixtureRoot,[Parameter(Mandatory=$true)][string]$OutputDir)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
[void][IO.Directory]::CreateDirectory($OutputDir)
$existingImage=Join-Path $OutputDir 'agent-native-current-first-screen.png'
if(Test-Path -LiteralPath $existingImage -PathType Leaf){
  Write-Host 'QA_AGENT_POST_CAPTURE_ALREADY_WITNESSED'
  exit 0
}
$draftFile=Join-Path $FixtureRoot 'native-gui-draft.json'
if(!(Test-Path -LiteralPath $draftFile -PathType Leaf)){
  Write-Host 'QA_AGENT_POST_CAPTURE_NO_GUI_DRAFT_PROOF'
  exit 0
}
try {$draft=Get-Content -LiteralPath $draftFile -Raw -Encoding UTF8 | ConvertFrom-Json}
catch {Write-Host 'QA_AGENT_POST_CAPTURE_DRAFT_PROOF_INVALID';exit 0}
if($draft.status -cne 'PASS' -or $draft.input -cne 'NATIVE_WINDOWS_UI_AUTOMATION'){
  Write-Host 'QA_AGENT_POST_CAPTURE_GUI_DRAFT_NOT_ACCEPTED'
  exit 0
}
$app=Join-Path $FixtureRoot 'application'
$exe=Join-Path $app 'desktop/bin/IWXA Personal.exe'
if(!(Test-Path -LiteralPath $exe -PathType Leaf)){
  Write-Host 'QA_AGENT_POST_CAPTURE_APP_ALREADY_UNINSTALLED'
  exit 0
}
$profile=Join-Path $FixtureRoot 'isolated-profile'
$values=[ordered]@{
  LOCALAPPDATA=(Join-Path $profile 'AppData/Local')
  APPDATA=(Join-Path $profile 'AppData/Roaming')
  USERPROFILE=(Join-Path $profile 'UserProfile')
  TEMP=(Join-Path $profile 'Temp')
  TMP=(Join-Path $profile 'Temp')
}
$before=@{}
$process=$null
try{
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  foreach($key in $values.Keys){
    $before[$key]=[Environment]::GetEnvironmentVariable($key,'Process')
    [void][IO.Directory]::CreateDirectory([string]$values[$key])
    [Environment]::SetEnvironmentVariable($key,[string]$values[$key],'Process')
  }
  $process=Start-Process -FilePath $exe -WorkingDirectory $app -PassThru
  $deadline=[DateTime]::UtcNow.AddSeconds(70)
  $caption=-join([char[]]@(0x413,0x43b,0x430,0x432,0x43d,0x430))
  $request=-join([char[]]@(0x412,0x430,0x448,0x20,0x437,0x430,0x43f,0x440,0x43e,0x441))
  $task=-join([char[]]@(0x422,0x435,0x43a,0x441,0x442,0x20,0x437,0x430,0x434,0x430,0x447,0x438))
  $names=@($caption,$request,$task,'Home','Your request','Task text')
  $captured=$false
  while([DateTime]::UtcNow -lt $deadline){
    Start-Sleep -Milliseconds 450
    $process.Refresh()
    if($process.HasExited){break}
    $handle=$process.MainWindowHandle
    if($handle -eq [IntPtr]::Zero -or $process.MainWindowTitle -cne 'IWXA Personal'){continue}
    $actual=[IO.Path]::GetFullPath([string]$process.MainModule.FileName)
    if(!$actual.Equals([IO.Path]::GetFullPath($exe),[StringComparison]::OrdinalIgnoreCase)){continue}
    $window=[Windows.Automation.AutomationElement]::FromHandle($handle)
    $found=$false
    foreach($name in $names){
      $filter=[Windows.Automation.PropertyCondition]::new(
        [Windows.Automation.AutomationElement]::NameProperty,$name)
      $node=$window.FindFirst([Windows.Automation.TreeScope]::Descendants,$filter)
      if($null -ne $node -and !$node.Current.IsOffscreen){$found=$true;break}
    }
    if(!$found){continue}
    $area=$window.Current.BoundingRectangle
    $monitor=[Windows.Forms.Screen]::FromHandle($handle).Bounds
    $left=[int][Math]::Max($monitor.Left,[Math]::Floor($area.Left))
    $top=[int][Math]::Max($monitor.Top,[Math]::Floor($area.Top))
    $right=[int][Math]::Min($monitor.Right,[Math]::Ceiling($area.Right))
    $bottom=[int][Math]::Min($monitor.Bottom,[Math]::Ceiling($area.Bottom))
    $width=$right-$left;$height=$bottom-$top
    if($width -lt 650 -or $height -lt 470){continue}
    $bitmap=[Drawing.Bitmap]::new($width,$height)
    $graphics=[Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen([Drawing.Point]::new($left,$top),[Drawing.Point]::Empty,[Drawing.Size]::new($width,$height))
      $bitmap.Save($existingImage,[Drawing.Imaging.ImageFormat]::Png)
    } finally {$graphics.Dispose();$bitmap.Dispose()}
    if((Get-Item -LiteralPath $existingImage).Length -lt 6000){
      Remove-Item -LiteralPath $existingImage -Force
      continue
    }
    $sha=(Get-FileHash -LiteralPath $existingImage -Algorithm SHA256).Hash.ToLowerInvariant()
    $receipt=[ordered]@{
      schema='IWXA_AGENT_REAL_NATIVE_CAPTURE/1'
      originalAgentSha='ffa56fee6f971afa74b6b49ccfb891fca0e97225'
      ciSha=$env:GITHUB_SHA
      windowTitle='IWXA Personal'
      mode='Direct screenshot from exact installed EXE after original native UIA draft acceptance'
      screenshotSha256=$sha
      source='Exact installed EXE + original native UIA draft receipt + Windows Graphics.CopyFromScreen'
      status='CAPTURED_REQUIRES_VISUAL_REVIEW'
    }
    $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputDir 'capture-manifest.json') -Encoding ascii
    $state=[ordered]@{
      exactProcessSeen=$true
      exactInstalledExeVerified=$true
      titledWindowSeen=$true
      genuineUiControlsSeen=$true
      screenshotCaptured=$true
    }
    $state | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $OutputDir 'capture-state.json') -Encoding ascii
    Write-Host ('QA_AGENT_POST_CAPTURE_NATIVE_DRAFT_VERIFIED sha256='+$sha)
    $captured=$true
    break
  }
  if(!$captured){Write-Host 'QA_AGENT_POST_CAPTURE_NO_NATIVE_WINDOW_OBSERVED'}
}catch {
  # Never print private exception details or paths.
  Write-Host 'QA_AGENT_POST_CAPTURE_NATIVE_WINDOW_NOT_ACCEPTED'
}finally{
  if($process){
    try{
      $process.Refresh()
      if(!$process.HasExited){
        [void]$process.CloseMainWindow()
        if(!$process.WaitForExit(5000)){$process.Kill()}
      }
    }catch{}
    $process.Dispose()
  }
  foreach($key in $values.Keys){
    [Environment]::SetEnvironmentVariable($key,$before[$key],'Process')
  }
}
