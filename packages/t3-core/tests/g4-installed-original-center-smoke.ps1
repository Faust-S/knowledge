# Public knowledge Windows CI: original private native Center is staged sparsely
# and ephemeral. Never upload the installed EXE, source, packages or screenshots.
param(
  [Parameter(Mandatory=$true)][string]$CenterRoot,
  [Parameter(Mandatory=$true)][string]$OriginalT3Root,
  [Parameter(Mandatory=$true)][string]$ExpectedCenterSha,
  [Parameter(Mandatory=$true)][string]$ExpectedT3Sha,
  [string]$ExpectedVersion='0.3.0-dev.1'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$center=(Resolve-Path -LiteralPath $CenterRoot).Path
$t3=(Resolve-Path -LiteralPath $OriginalT3Root).Path
function Require([bool]$ok,[string]$code) {if (!$ok) {throw $code}}
function ExactHead([string]$root,[string]$expected,[string]$code) {
  $head=(& git -C $root rev-parse HEAD).Trim()
  Require ($LASTEXITCODE -eq 0 -and $head -eq $expected) $code
}
ExactHead $center $ExpectedCenterSha 'G4_INSTALLED_CENTER_SOURCE_PIN_CHANGED'
ExactHead $t3 $ExpectedT3Sha 'G4_INSTALLED_T3_SOURCE_PIN_CHANGED'
$setup=Join-Path $center 'artifacts/iwxa-setup-core-center-private-d3.exe'
Require (Test-Path -LiteralPath $setup -PathType Leaf) 'G4_INSTALLED_PRIVATE_SETUP_NOT_BUILT'
$sourceOwner=Join-Path $center 'src-tauri/private-distribution/iwxa-t3-product-owner.exe'
Require (Test-Path -LiteralPath $sourceOwner -PathType Leaf) 'G4_INSTALLED_ORIGINAL_OWNER_NOT_BUILT'
$sourceDigest=(Get-FileHash -LiteralPath $sourceOwner -Algorithm SHA256).Hash.ToLowerInvariant()
Require ($sourceDigest -match '^[a-f0-9]{64}$') 'G4_INSTALLED_OWNER_DIGEST_INVALID'

$report=Join-Path $env:RUNNER_TEMP 'g4-center-private-setup-report.json'
$proc=$null
$gui=$null
try {
  $proc=Start-Process -FilePath $setup -ArgumentList ('--install-file "{0}"' -f $report) -PassThru
  Require ($proc.WaitForExit(120000)) 'G4_INSTALLED_CENTER_SETUP_TIMEOUT'
  Require ($proc.ExitCode -eq 0) 'G4_INSTALLED_CENTER_SETUP_FAILED'
  Require (Test-Path -LiteralPath $report -PathType Leaf) 'G4_INSTALLED_CENTER_SETUP_RECEIPT_MISSING'
  $r=Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
  Require ($r.status -eq 'INSTALLED_NOT_LAUNCHED' -and
    $r.product -eq 'iwxa.admin-center' -and
    $r.version -eq $ExpectedVersion) 'G4_INSTALLED_CENTER_SETUP_READBACK_INVALID'
  $root=[IO.Path]::GetFullPath([string]$r.installRoot)
  $installedExe=Join-Path $root 'iwxa-admin-center.exe'
  $installedOwner=Join-Path $root 't3/iwxa-t3-product-owner.exe'
  $installedLoader=Join-Path $root 't3/one-dist/_iwxa/loader.js'
  $installedRuntime=Join-Path $root 't3/one-dist/_iwxa/runtime/0.3.6/runtime.js'
  foreach($file in @($installedExe,$installedOwner,$installedLoader,$installedRuntime)){
    Require (Test-Path -LiteralPath $file -PathType Leaf) 'G4_INSTALLED_ONE_DIST_REQUIRED'
  }
  Require ((Get-FileHash -LiteralPath $installedOwner -Algorithm SHA256).Hash.ToLowerInvariant() -eq
    $sourceDigest) 'G4_INSTALLED_ORIGINAL_OWNER_BYTES_CHANGED'
  $catalog=Join-Path $root 't3/one-dist/_iwxa/service-catalog.json'
  Require (Test-Path -LiteralPath $catalog -PathType Leaf) 'G4_INSTALLED_SERVICE_CATALOG_MISSING'
  Write-Host 'G4_INSTALLED_SETUP_CORE_PRIVATE_ONE_DIST_PASS'
  Write-Host 'G4_INSTALLED_ORIGINAL_OWNER_SHA256_PIN_PASS'
  # A genuinely installed Tauri Window, not a mocked React preview:
  $gui=Start-Process -FilePath $installedExe -WorkingDirectory $root -PassThru
  $handle=[IntPtr]::Zero
  for($i=0;$i -lt 50;$i++){
    Start-Sleep -Milliseconds 500
    $gui.Refresh()
    Require (-not $gui.HasExited) 'G4_INSTALLED_CENTER_GUI_PREMATURE_EXIT'
    $handle=$gui.MainWindowHandle
    if($handle -ne [IntPtr]::Zero){break}
  }
  Require ($handle -ne [IntPtr]::Zero) 'G4_INSTALLED_CENTER_NATIVE_WINDOW_MISSING'
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  # A Tauri HWND appears BEFORE WebView2 has built its accessibility tree.
  # Wait for a REAL product control, not a fixed sleep or the HWND alone.
  $rendered=$false
  $descendantCount=0
  for($attempt=0;$attempt -lt 100;$attempt++){
    $gui.Refresh()
    Require (-not $gui.HasExited) 'G4_INSTALLED_CENTER_GUI_EXITED_BEFORE_RENDER'
    try {
      $rootUi=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
      if($null -ne $rootUi){
        $nodes=$rootUi.FindAll(
          [System.Windows.Automation.TreeScope]::Descendants,
          [System.Windows.Automation.Condition]::TrueCondition)
        $descendantCount=$nodes.Count
        foreach($node in $nodes){
          try{
            if($node.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button){
              $label=[string]$node.Current.Name
              if($label.Contains('Добавить организацию') -or
                 $label.Contains('Создать черновик организации')){
                $rendered=$true
                break
              }
            }
          }catch{}
        }
      }
    }catch{}
    if($rendered){break}
    Start-Sleep -Milliseconds 400
  }
  Require ($rendered -and $descendantCount -ge 3) 'G4_INSTALLED_CENTER_WEBVIEW_NOT_RENDERED_WITHIN_BOUND'
  Write-Host 'G4_INSTALLED_CENTER_NATIVE_WINDOW_UIA_PASS'
  # Graceful window-close is an actual Windows WM_CLOSE, not killing the
  # process as a substitute for checking resource/Host teardown.
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class G4InstalledWindow {
 [DllImport("user32.dll", SetLastError=true)]
 public static extern bool PostMessage(IntPtr hWnd,uint msg,IntPtr w,IntPtr l);
}
'@
  Require ([G4InstalledWindow]::PostMessage($handle,0x10,[IntPtr]::Zero,[IntPtr]::Zero)) 'G4_INSTALLED_WINDOW_CLOSE_UNAVAILABLE'
  Require ($gui.WaitForExit(20000)) 'G4_INSTALLED_CENTER_WINDOW_CLOSE_TIMEOUT'
  Require ($gui.ExitCode -eq 0) 'G4_INSTALLED_CENTER_WINDOW_CLOSE_FAILED'
  Write-Host 'G4_INSTALLED_CENTER_NATIVE_GRACEFUL_CLOSE_PASS'
  # This scope is a package/window acceptance only: do not imply installed
  # HUMAN ACCEPT, separate Kernel APPLY, two OS accounts or full G4 readiness.
  Write-Host 'G4_INSTALLED_CENTER_PRIVATE_PACKAGE_GUI_SMOKE_PASS_NOT_D3_E2E'
  # Reuse the exact Setup Core receipt root for the separate first-use
  # Windows UIA process; never assume an installation folder.
  $registry=Get-ItemProperty -LiteralPath 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.admin-center' -ErrorAction Stop
  Require ([IO.Path]::GetFullPath([string]$registry.InstallLocation) -eq
    $root) 'G4_INSTALLED_CENTER_SETUP_REGISTRY_RECEIPT_MISMATCH'
  if($env:GITHUB_ENV){
    "G4_INSTALLED_CENTER_ROOT=$root" | Out-File -LiteralPath $env:GITHUB_ENV -Encoding utf8 -Append
  }
  Write-Host 'G4_INSTALLED_CENTER_SETUP_REGISTRY_READBACK_PASS'
}finally{
  if($gui){
    try {
      $gui.Refresh()
      if(-not $gui.HasExited){$gui.Kill();$gui.WaitForExit(5000)|Out-Null}
    }catch{}
    $gui.Dispose()
  }
  if($proc){$proc.Dispose()}
  Remove-Item -LiteralPath $report -Force -ErrorAction SilentlyContinue
}