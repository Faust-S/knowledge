$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class D07PickerProbeNative {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll", CharSet=CharSet.Unicode)]
 public static extern int GetClassName(IntPtr hWnd, StringBuilder name, int max);
}
"@
$path=Join-Path $env:RUNNER_TEMP 'd07-os-picker-probe.html'
Set-Content -Path $path -Encoding UTF8 -Value @'
<!doctype html><html><head><title>D07 file chooser probe</title></head>
<body><h1>File chooser probe</h1>
<input type="file" id="upload" aria-label="Выберите файл .iwxa" accept=".iwxa">
<button onclick="document.querySelector('#upload').click()">Открыть файл</button>
</body></html>
'@
$edge=@((Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Microsoft\Edge\Application\msedge.exe'),(Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Microsoft\Edge\Application\msedge.exe'))|Where-Object{Test-Path $_}|Select-Object -First 1
if(!$edge){throw 'D07_PROBE_EDGE_MISSING'}
$profile=Join-Path $env:RUNNER_TEMP 'd07-picker-probe-profile'
$url=[uri]$path
Start-Process -FilePath $edge -ArgumentList @('--force-renderer-accessibility','--no-first-run','--no-default-browser-check',("--user-data-dir="+$profile),("--app="+$url.AbsoluteUri))|Out-Null
$root=$null
for($retry=0;$retry -lt 70;$retry++){
 foreach($p in @(Get-Process msedge -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle -ne 0})){
  try{
   $candidate=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
   if($candidate -and $candidate.Current.Name -match 'D07 file chooser probe|File chooser probe'){
    $root=$candidate;break
   }
  }catch{}
 }
 if($root){break}
 Start-Sleep -Milliseconds 300
}
if(!$root){throw 'D07_PROBE_APP_WINDOW_MISSING'}
$cond=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,'Открыть файл')
$button=$null
for($retry=0;$retry -lt 60;$retry++){
 $button=$root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$cond)
 if($button){break}
 Start-Sleep -Milliseconds 200
}
if(!$button){throw 'D07_PROBE_BUTTON_UNAVAILABLE'}
function Snapshot([string]$stage){
 $desktop=[System.Windows.Automation.AutomationElement]::RootElement
 $windows=$desktop.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
 $class32770=0;$namedDialog=0;$otherWinClasses=[System.Collections.Generic.HashSet[string]]::new()
 foreach($window in $windows){
  try{
   $c=$window.Current.ClassName;$name=$window.Current.Name
   if($c -eq '#32770'){$class32770++}
   if($name -match '^(Open|Открыт.*|Выбор файла|Select file)$'){$namedDialog++}
   [void]$otherWinClasses.Add($c)
  }catch{}
 }
 $handle=[D07PickerProbeNative]::GetForegroundWindow()
 $builder=[System.Text.StringBuilder]::new(200)
 $null=[D07PickerProbeNative]::GetClassName($handle,$builder,200)
 Write-Output ('D07_PROBE_'+$stage+'_OS_DIALOG_32770='+$class32770)
 Write-Output ('D07_PROBE_'+$stage+'_NAMED_DIALOG='+$namedDialog)
 Write-Output ('D07_PROBE_'+$stage+'_FOREGROUND_CLASS='+$builder.ToString())
 Write-Output ('D07_PROBE_'+$stage+'_WINDOW_CLASSES='+($otherWinClasses.Count))
 return ($class32770 -gt 0 -or $namedDialog -gt 0)
}
$trigger='InvokePattern'
try{
 $inv=[System.Windows.Automation.InvokePattern]$button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
 $inv.Invoke()
}catch{
 $trigger='KeyboardEnter'
 $button.SetFocus()
 [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
}
Write-Output ('D07_PROBE_FIRST_TRIGGER='+$trigger)
Start-Sleep -Milliseconds 1200
$first=Snapshot 'FIRST'
if(!$first){
 [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
 $button.SetFocus()
 [System.Windows.Forms.SendKeys]::SendWait(' ')
 Start-Sleep -Milliseconds 1200
 $second=Snapshot 'SECOND'
 Write-Output ('D07_PROBE_SECOND_TRIGGER_SPACE='+$second)
}else{
 Write-Output 'D07_PROBE_FIRST_TRIGGER_DIALOG=PASS'
}
[System.Windows.Forms.SendKeys]::SendWait('{ESC}')
Write-Output 'D07_PROBE_OS_DIALOG=OBSERVED'
