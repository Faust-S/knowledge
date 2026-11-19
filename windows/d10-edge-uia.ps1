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
  # Edge may expose article paragraphs through its Document TextPattern
  # instead of individual ControlType.Text nodes, especially while scrolled.
  try {
    $docCondition=New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Document)
    $documents=$window.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,$docCondition)
    foreach($document in $documents) {
      try {
        $pattern=[System.Windows.Automation.TextPattern]$document.GetCurrentPattern(
          [System.Windows.Automation.TextPattern]::Pattern)
        if($pattern.DocumentRange.GetText(-1).Contains($expected)){return $true}
      }catch{}
    }
  }catch{}
  # React aria-live regions are sometimes exposed as UIA Group/Custom,
  # not ControlType.Text. Only accept names containing the exact displayed
  # dynamic phrase, never infer a pass from the selected menu option.
  try {
    $named=$window.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    for($i=0;$i -lt $named.Count;$i++){
      try {
        $candidate=$named.Item($i).Current
        if($candidate.Name -and $candidate.Name.Contains($expected)){
          return $true
        }
      }catch{}
    }
  }catch{}
  return $false
}
function ComboOptionName($combo) {
  try {
    $pattern=[System.Windows.Automation.SelectionPattern]$combo.GetCurrentPattern(
      [System.Windows.Automation.SelectionPattern]::Pattern)
    $items=$pattern.Current.GetSelection()
    if($items -and $items.Length -gt 0){return [string]$items[0].Current.Name}
  }catch{}
  try {
    $pattern=[System.Windows.Automation.ValuePattern]$combo.GetCurrentPattern(
      [System.Windows.Automation.ValuePattern]::Pattern)
    return [string]$pattern.Current.Value
  }catch{}
  try{return [string]$combo.Current.Name}catch{}
  return ""
}
function MetricState($combo) {
  $name=ComboOptionName $combo
  if($name -match "После изменения работы"){return "AFTER"}
  if($name -match "До изменения работы"){return "BEFORE"}
  return "UNREADABLE"
}
function Verify-NativeCaseSelect($slug,$caseId,$controlId,$expectedBefore,$expectedAfter,$expectedDynamic) {
  $url="$origin/cases/$slug/"
  $window=Find-EdgeWindow
  if($null -eq $window){throw "D10_WINDOWS_CASE_NATIVE_WINDOW_MISSING"}
  [void][D10NativeWindow]::ShowWindow([IntPtr]$window.Current.NativeWindowHandle,9)
  [void][D10NativeWindow]::SetForegroundWindow(
    [IntPtr]$window.Current.NativeWindowHandle)
  [System.Windows.Forms.Clipboard]::SetText($url)
  [System.Windows.Forms.SendKeys]::SendWait("^l")
  [System.Windows.Forms.SendKeys]::SendWait("^v")
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  $ready=$false
  for($i=0;$i -lt 50;$i++){
    Start-Sleep -Milliseconds 250
    $window=Find-EdgeWindow
    if($null -ne $window -and (Has-AccessibleArticleText $window $caseId)){
      $ready=$true;break
    }
  }
  if(-not $ready){throw "D10_WINDOWS_CASE_NATIVE_ROUTE_UNAVAILABLE"}
  $comboCondition=New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::ComboBox)
  $combo=$null
  for($t=0;$t -lt 30;$t++){
    $window=Find-EdgeWindow
    $elements=$window.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,$comboCondition)
    foreach($element in $elements){
      if($element.Current.AutomationId -eq $controlId){$combo=$element;break}
    }
    if($combo){break}
    Start-Sleep -Milliseconds 200
  }
  if($null -eq $combo){throw "D10_WINDOWS_CASE_NATIVE_CONTROL_NOT_FOUND"}
  $initial=ComboOptionName $combo
  if($initial -ne $expectedBefore){throw "D10_WINDOWS_CASE_NATIVE_INITIAL_OPTION_CHANGED"}
  $selected=$false
  $repainted=$false
  for($attempt=0;$attempt -lt 3;$attempt++){
    $combo.SetFocus()
    Start-Sleep -Milliseconds 250
    [System.Windows.Forms.SendKeys]::SendWait("{HOME}{DOWN}{ENTER}{TAB}")
    for($i=0;$i -lt 30;$i++){
      Start-Sleep -Milliseconds 200
      if((ComboOptionName $combo) -eq $expectedAfter){$selected=$true}
      $window=Find-EdgeWindow
      if($null -ne $window -and
         (Has-AccessibleArticleText $window $expectedDynamic)){$repainted=$true}
      if($selected -and $repainted){break}
    }
    if($selected -and $repainted){break}
  }
  if(-not $selected){throw "D10_WINDOWS_CASE_NATIVE_SELECTION_UNCONFIRMED"}
  if(-not $repainted){throw "D10_WINDOWS_CASE_NATIVE_RESULT_NOT_REPAINTED"}
  Write-Output "D10_WINDOWS_NATIVE_$caseId=PASS"
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
  # Exercise an actual user decision after navigating CASE-010, not just a
  # page title. Chrome exposes the native <select> as a UIA ComboBox.
  $window=Find-EdgeWindow
  if($null -eq $window){throw "D10_WINDOWS_CASE010_WINDOW_NOT_AVAILABLE"}
  $comboCondition=New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::ComboBox)
  $combos=$window.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,$comboCondition)
  Write-Output "D10_WINDOWS_CASE010_COMBO_COUNT=$($combos.Count)"
  if($combos.Count -lt 2){throw "D10_WINDOWS_CASE010_METRIC_CONTROL_NOT_ACCESSIBLE"}
  $metric=$null
  $metricSource="UNKNOWN"
  foreach($item in $combos){
    try {
      $id=$item.Current.AutomationId
      $name=$item.Current.Name
      if($id -eq "case010-metric"){
        $metric=$item;$metricSource="AUTOMATION_ID";break
      }
      if($name -match "длительность переговорного"){
        $metric=$item;$metricSource="ACCESSIBLE_LABEL";break
      }
    }catch{}
  }
  if($null -eq $metric){
    $metric=$combos.Item(0);$metricSource="FIRST_COMBO_FALLBACK"
  }
  Write-Output "D10_WINDOWS_CASE010_METRIC_LOCATOR=$metricSource"
  $metric.SetFocus()
  Start-Sleep -Milliseconds 350
  $window=Find-EdgeWindow
  $before=($null -ne $window -and
    (Has-AccessibleArticleText $window "Переговорная стадия до изменений"))
  Write-Output "D10_WINDOWS_CASE010_INITIAL_DYNAMIC_TEXT=$before"
  Write-Output "D10_WINDOWS_CASE010_INITIAL_OPTION=$(MetricState $metric)"
  $repainted=$false
  $selectedAfter=$false
  for($i=0;$i -lt 3;$i++){
    $metric.SetFocus()
    Start-Sleep -Milliseconds 300
    # Explicit native keyboard interaction. Tab commits the select's change
    # in Edge as well as moving focus so React can repaint.
    [System.Windows.Forms.SendKeys]::SendWait("{HOME}{DOWN}{ENTER}{TAB}")
    Start-Sleep -Milliseconds 150
    $state=MetricState $metric
    Write-Output "D10_WINDOWS_CASE010_AFTER_KEYBOARD_STATE=$state"
    if($state -eq "AFTER"){$selectedAfter=$true}
    for($t=0;$t -lt 25;$t++){
      Start-Sleep -Milliseconds 250
      $window=Find-EdgeWindow
      if($null -ne $window -and (Has-AccessibleArticleText $window "Переговорная стадия после изменений")){
        $repainted=$true
        break
      }
    }
    if($repainted){break}
  }
  Write-Output "D10_WINDOWS_CASE010_SELECTION_CONFIRMED=$selectedAfter"
  Write-Output "D10_WINDOWS_CASE010_DYNAMIC_REPAINT_CONFIRMED=$repainted"
  if(-not $selectedAfter){throw "D10_WINDOWS_CASE010_METRIC_SELECTION_UNCONFIRMED"}
  if(-not $repainted){throw "D10_WINDOWS_CASE010_METRIC_NOT_REPAINTED"}
  Write-Output "D10_WINDOWS_CASE010_NATIVE_METRIC_INTERACTION=PASS"
  Verify-NativeCaseSelect "popsockets-search-incrementality" "CASE-008" "case008-lens" "Выручка" "Заказы" "Оценка выпавших заказов, а не экспорт индивидуальных покупок."
  Verify-NativeCaseSelect "meteomatics-pipeline-discipline" "CASE-009" "case009-metric" "Цикл до изменений" "Цикл после изменений" "После структурирования"
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
