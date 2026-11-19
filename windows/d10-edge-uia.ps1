$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class D10NativeWindow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd,int command);
}
"@
$origin = "http://127.0.0.1:4461"
$edge = @(
  (Join-Path ([Environment]::GetFolderPath("ProgramFilesX86")) "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe")
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if(-not $edge){throw "D10_WINDOWS_EDGE_NOT_INSTALLED"}
$entries = @(
  @("renovation-ad-to-contract","CASE-001"),
  @("galvanic-equipment-b2b","CASE-002"),
  @("accordance-b2b-saas","CASE-003"),
  @("local-clinic-appointments","CASE-004"),
  @("interior-design-school-attribution","CASE-005"),
  @("seasonal-patio-furniture","CASE-006"),
  @("rebel-aromas-repeat-sales","CASE-007"),
  @("popsockets-search-incrementality","CASE-008"),
  @("meteomatics-pipeline-discipline","CASE-009"),
  @("vesper-quote-to-deal","CASE-010")
)
$server = $null
$edgeProc = $null
$profile = Join-Path $env:RUNNER_TEMP "d10-windows-ui-profile"
function EdgeProcessIds {
  return @(Get-Process -Name msedge -ErrorAction SilentlyContinue | ForEach-Object {$_.Id})
}
function Find-EdgeWindow {
  $ids=EdgeProcessIds
  if($ids.Count -eq 0){return $null}
  $root=[System.Windows.Automation.AutomationElement]::RootElement
  $children=$root.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition)
  foreach($item in $children){
    try{
      $current=$item.Current
      if(($ids -contains $current.ProcessId) -and
         ($current.ControlType -eq [System.Windows.Automation.ControlType]::Window -or
          $current.ClassName -eq "Chrome_WidgetWin_1")){
        return $item
      }
    }catch{}
  }
  return $null
}
function Write-DesktopEnvironmentEvidence {
  $session=[System.Diagnostics.Process]::GetCurrentProcess().SessionId
  $ids=EdgeProcessIds
  $root=[System.Windows.Automation.AutomationElement]::RootElement
  $children=$root.FindAll([System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition)
  $chromeWidgets=0
  $visibleEdge=0
  foreach($item in $children){
    try{
      if($item.Current.ClassName -eq "Chrome_WidgetWin_1"){$chromeWidgets++}
      if($ids -contains $item.Current.ProcessId){$visibleEdge++}
    }catch{}
  }
  Write-Output "D10_WINDOWS_USER_INTERACTIVE=$([Environment]::UserInteractive)"
  Write-Output "D10_WINDOWS_UIA_SESSION=$session"
  Write-Output "D10_WINDOWS_EDGE_PROCESS_COUNT=$($ids.Count)"
  Write-Output "D10_WINDOWS_UIA_TOPLEVEL_COUNT=$($children.Count)"
  Write-Output "D10_WINDOWS_UIA_CHROME_WIDGETS=$chromeWidgets"
  Write-Output "D10_WINDOWS_UIA_EDGE_TOPLEVEL=$visibleEdge"
}
function Has-AccessibleArticleText($window,$expected){
  $textCondition=New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Text)
  $items=$window.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,$textCondition)
  for($i=0;$i -lt $items.Count;$i++){
    try{
      if($items.Item($i).Current.Name.Contains($expected)){return $true}
    }catch{}
  }
  return $false
}
try {
  $server = Start-Process -FilePath "node.exe" -ArgumentList "scripts/tests/d10-gui-static-preview-server.mjs" -WorkingDirectory (Join-Path $env:GITHUB_WORKSPACE "site") -PassThru -WindowStyle Hidden
  $ready = $false
  for($i=0;$i -lt 80;$i++){
    try {
      $response=Invoke-WebRequest -Uri "$origin/workspace/" -UseBasicParsing -TimeoutSec 2
      if($response.StatusCode -eq 200){$ready=$true;break}
    }catch{}
    Start-Sleep -Milliseconds 250
  }
  if(-not $ready){throw "D10_WINDOWS_STATIC_PREVIEW_NOT_AVAILABLE"}
  Write-Output "D10_WINDOWS_INTEGRATED_PREVIEW=PASS"
  $first = "$origin/cases/$($entries[0][0])/"
  $edgeProc = Start-Process -FilePath $edge -ArgumentList @(
    "--new-window","--inprivate","--force-renderer-accessibility",
    "--user-data-dir=$profile",$first) -PassThru
  $window=$null
  for($i=0;$i -lt 100;$i++){
    $window=Find-EdgeWindow
    if($null -ne $window){break}
    Start-Sleep -Milliseconds 300
  }
  if($null -eq $window){
    Write-DesktopEnvironmentEvidence
    throw "D10_WINDOWS_EDGE_UIA_WINDOW_MISSING"
  }
  Write-Output "D10_WINDOWS_EDGE_UIA_ATTACHED=PASS"
  $passed=0
  foreach($case in $entries){
    $slug=[string]$case[0]
    $marker=[string]$case[1]
    $url="$origin/cases/$slug/"
    $window=Find-EdgeWindow
    if($null -eq $window){throw "D10_WINDOWS_EDGE_UIA_LOST"}
    [void][D10NativeWindow]::ShowWindow([IntPtr]$window.Current.NativeWindowHandle,9)
    [void][D10NativeWindow]::SetForegroundWindow(
      [IntPtr]$window.Current.NativeWindowHandle)
    Start-Sleep -Milliseconds 150
    [System.Windows.Forms.Clipboard]::SetText($url)
    [System.Windows.Forms.SendKeys]::SendWait("^l")
    [System.Windows.Forms.SendKeys]::SendWait("^v")
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    $found=$false
    for($i=0;$i -lt 45;$i++){
      Start-Sleep -Milliseconds 300
      $window=Find-EdgeWindow
      if($null -ne $window -and (Has-AccessibleArticleText $window $marker)){
        $found=$true
        break
      }
    }
    if(-not $found){throw "D10_WINDOWS_ROUTE_UIA_NOT_VERIFIED_$marker"}
    $passed++
    Write-Output "D10_WINDOWS_UIA_$marker=PASS"
  }
  if($passed -ne 10){throw "D10_WINDOWS_ARTICLE_COUNT_MISMATCH"}
  Write-Output "D10_WINDOWS_UIA_ROUTES=10/10"
  Write-Output "D10_WINDOWS_UIA_BASELINE=PASS"
}finally{
  if($edgeProc -and -not $edgeProc.HasExited){
    Stop-Process -Id $edgeProc.Id -Force -ErrorAction SilentlyContinue
  }
  if($server -and -not $server.HasExited){
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  }
}
