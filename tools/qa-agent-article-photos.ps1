[CmdletBinding()]
param([Parameter(Mandatory=$true)][int]$WindowProcessId,[Parameter(Mandatory=$true)][string]$OutputDir)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class EditorialAgentClick {
    [DllImport("user32.dll", SetLastError=true)]
    public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extraInfo);
}
'@
[void][IO.Directory]::CreateDirectory($OutputDir)
$process=[Diagnostics.Process]::GetProcessById($WindowProcessId)
function Root {
 $process.Refresh()
 if($process.HasExited -or $process.MainWindowHandle -eq [IntPtr]::Zero) { throw 'ARTICLE_NATIVE_WINDOW_NOT_RUNNING' }
 return [Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
}
function Capture([string]$name) {
 $r=Root
 $rect=$r.Current.BoundingRectangle
 $monitor=[Windows.Forms.Screen]::FromHandle($process.MainWindowHandle).Bounds
 $x=[int][Math]::Max($monitor.Left,[Math]::Floor($rect.Left))
 $y=[int][Math]::Max($monitor.Top,[Math]::Floor($rect.Top))
 $right=[int][Math]::Min($monitor.Right,[Math]::Ceiling($rect.Right))
 $bottom=[int][Math]::Min($monitor.Bottom,[Math]::Ceiling($rect.Bottom))
 $w=$right-$x;$h=$bottom-$y
 if($w -lt 650 -or $h -lt 480){throw 'ARTICLE_NATIVE_SCREEN_TOO_SMALL'}
 Start-Sleep -Milliseconds 450
 $bitmap=[Drawing.Bitmap]::new($w,$h)
 $graphics=[Drawing.Graphics]::FromImage($bitmap)
 $destination=Join-Path $OutputDir ($name+'.png')
 try{
   $graphics.CopyFromScreen([Drawing.Point]::new($x,$y),[Drawing.Point]::Empty,[Drawing.Size]::new($w,$h))
   $bitmap.Save($destination,[Drawing.Imaging.ImageFormat]::Png)
 }finally{$graphics.Dispose();$bitmap.Dispose()}
 if((Get-Item -LiteralPath $destination).Length -lt 10000){throw 'ARTICLE_EMPTY_AGENT_IMAGE'}
 Write-Host ('ARTICLE_NATIVE_AGENT_CAPTURE_'+$name.ToUpperInvariant()+'_PASS')
}
function Open-Page([string]$ru,[string]$en) {
 for($i=0;$i -lt 20;$i++){
  $root=Root
  $list=$root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
  foreach($node in $list){
   try{
    if($node.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and
      $node.Current.IsEnabled -and !$node.Current.IsOffscreen -and
      ($node.Current.Name -ceq $ru -or $node.Current.Name -ceq $en)){
      try{$node.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()}
      catch{
       $rect=$node.Current.BoundingRectangle
       [Windows.Forms.Cursor]::Position=[Drawing.Point]::new([int]($rect.Left+$rect.Width/2),[int]($rect.Top+$rect.Height/2))
       [EditorialAgentClick]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
       Start-Sleep -Milliseconds 100
       [EditorialAgentClick]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
      }
      Start-Sleep -Milliseconds 550
      return $true
    }
   }catch{}
  }
  Start-Sleep -Milliseconds 160
 }
 return $false
}
$models=-join([char[]]@(0x41c,0x43e,0x434,0x435,0x43b,0x438))
$programs=-join([char[]]@(0x41f,0x440,0x43e,0x433,0x440,0x430,0x43c,0x43c,0x44b))
$tools=-join([char[]]@(0x418,0x43d,0x441,0x442,0x440,0x443,0x43c,0x435,0x43d,0x442,0x44b))
$home=-join([char[]]@(0x413,0x43b,0x430,0x432,0x43d,0x430,0x44f))
Capture 'agent-01-task-editor'
if(Open-Page $models 'Models'){Capture 'agent-02-models'}
if(Open-Page $programs 'Programs'){Capture 'agent-03-programs'}
if(Open-Page $tools 'Tools'){Capture 'agent-04-tools'}
if(Open-Page $home 'Home'){Capture 'agent-05-home'}
$files=@(Get-ChildItem -LiteralPath $OutputDir -Filter 'agent-*.png')
if($files.Count -lt 3){throw 'ARTICLE_AGENT_THREE_VISUAL_STATES_NOT_FOUND'}
$evidence=[ordered]@{
 schema='IWXA_EDITORIAL_NATIVE_AGENT/1'
 status='GUI_ONLY_NOT_PRODUCT_RELEASE'
 captureCount=$files.Count
 owner=$env:EDITORIAL_AGENT_SHA
}
$evidence|ConvertTo-Json -Depth 4|Set-Content -LiteralPath (Join-Path $OutputDir 'manifest.json') -Encoding ascii
Write-Host ('ARTICLE_AGENT_NATIVE_GUI_PHOTOS_PASS_'+$files.Count)
