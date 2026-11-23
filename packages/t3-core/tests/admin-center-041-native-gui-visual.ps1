# Independent proof of a genuine installed IWXA Admin Center 0.4.1 GUI.
# Use the exact, hash-pinned universal Setup Core 1.0 PE_RESOURCE_V2.
# Capture real Windows pixels, not browser mockups or synthesized screenshots.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$Installer,
 [Parameter(Mandatory=$true)][string]$ExpectedSha256,
 [string]$OutputDir='artifacts/admin-041-native-visual'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Admin041Windows {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool MoveWindow(IntPtr hwnd, int x, int y, int width, int height, bool repaint);
}
'@
function Require([bool]$good,[string]$code){if(!$good){throw $code}}
$setup=(Resolve-Path -LiteralPath $Installer).Path
$sha=(Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
Require ($sha -ceq $ExpectedSha256.ToLowerInvariant()) 'ADMIN041_NATIVE_UI_INSTALLER_SHA256_MISMATCH'
$folder=[IO.Path]::GetFullPath($OutputDir)
[void][IO.Directory]::CreateDirectory($folder)
$receipt=Join-Path $folder 'install.json'
if(Test-Path -LiteralPath $receipt){Remove-Item -LiteralPath $receipt -Force}
$process=Start-Process -FilePath $setup -ArgumentList (
  '--install-file "'+$receipt+'"') -Wait -PassThru
try{Require ($process.ExitCode -eq 0) 'ADMIN041_NATIVE_UI_SETUP_CORE_INSTALL_EXIT'}finally{$process.Dispose()}
Require (Test-Path -LiteralPath $receipt -PathType Leaf) 'ADMIN041_NATIVE_UI_SETUP_CORE_INSTALL_RECEIPT_MISSING'
$installed=Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
Require ($installed.status -ceq 'INSTALLED_NOT_LAUNCHED' -and
         $installed.product -ceq 'iwxa.admin-center' -and
         $installed.version -ceq '0.4.1') 'ADMIN041_NATIVE_UI_WRONG_SETUP_CORE_INSTALL'
$exe=Join-Path $env:LOCALAPPDATA 'Programs/IWXA Admin Center/iwxa-admin-center.exe'
Require (Test-Path -LiteralPath $exe -PathType Leaf) 'ADMIN041_NATIVE_UI_ORIGINAL_CENTER_EXE_MISSING'
$center=$null
try{
  $center=Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe -Parent) -PassThru
  $handle=[IntPtr]::Zero;$ready=$false
  for($i=0;$i -lt 100;$i++){
    Start-Sleep -Milliseconds 450
    $center.Refresh()
    Require (!$center.HasExited) 'ADMIN041_NATIVE_GUI_EXITED_DURING_FIRST_RUN'
    $handle=$center.MainWindowHandle
    if($handle -eq [IntPtr]::Zero){continue}
    $window=[Windows.Automation.AutomationElement]::FromHandle($handle)
    if(!$window){continue}
    $nodes=$window.FindAll([Windows.Automation.TreeScope]::Descendants,
      [Windows.Automation.Condition]::TrueCondition)
    $foundTitle=$false
    foreach($node in $nodes){
      try{
        $name=[string]$node.Current.Name
        if($name -ceq 'IWXA Admin Center' -or
           $name -match 'Главная|Административн|Организация'){
          $foundTitle=$true;break
        }
      }catch{}
    }
    if($foundTitle){$ready=$true;break}
  }
  Require $ready 'ADMIN041_NATIVE_GUI_REAL_WEBVIEW_NOT_READY'
  $screen=[Windows.Forms.Screen]::PrimaryScreen.Bounds
  $layout=@(
    @{Name='desktop';Width=[Math]::Min(1366,$screen.Width-48);Height=[Math]::Min(900,$screen.Height-48)},
    @{Name='compact';Width=820;Height=650}
  )
  foreach($size in $layout){
    Require ($size.Width -ge 820 -and $size.Height -ge 650) 'ADMIN041_NATIVE_GUI_SCREEN_TOO_SMALL'
    Require ([Admin041Windows]::MoveWindow($handle,
      [int]($screen.Left+[Math]::Max(0,($screen.Width-$size.Width)/2)),
      [int]($screen.Top+[Math]::Max(0,($screen.Height-$size.Height)/2)),
      [int]$size.Width,[int]$size.Height,$true)) 'ADMIN041_NATIVE_GUI_RESIZE_FAILED'
    Start-Sleep -Milliseconds 700
    $center.Refresh()
    Require (!$center.HasExited) 'ADMIN041_NATIVE_GUI_FAILED_WHILE_RESIZED'
    $window=[Windows.Automation.AutomationElement]::FromHandle($handle)
    $bounds=$window.Current.BoundingRectangle
    $left=[int][Math]::Max($screen.Left,[Math]::Floor($bounds.Left))
    $top=[int][Math]::Max($screen.Top,[Math]::Floor($bounds.Top))
    $right=[int][Math]::Min($screen.Right,[Math]::Ceiling($bounds.Right))
    $bottom=[int][Math]::Min($screen.Bottom,[Math]::Ceiling($bounds.Bottom))
    $width=$right-$left;$height=$bottom-$top
    Require ($width -ge 720 -and $height -ge 500) 'ADMIN041_NATIVE_GUI_FRAME_TOO_SMALL'
    $bitmap=[Drawing.Bitmap]::new($width,$height)
    $draw=[Drawing.Graphics]::FromImage($bitmap)
    $path=Join-Path $folder ('admin-center-041-'+$size.Name+'-installed.png')
    try{
      $draw.CopyFromScreen([Drawing.Point]::new($left,$top),
        [Drawing.Point]::Empty,[Drawing.Size]::new($width,$height))
      $bitmap.Save($path,[Drawing.Imaging.ImageFormat]::Png)
    }finally{$draw.Dispose();$bitmap.Dispose()}
    Require ((Get-Item -LiteralPath $path).Length -gt 10000) 'ADMIN041_NATIVE_GUI_IMAGE_EMPTY'
    Write-Host ("ADMIN041_NATIVE_GUI_SCREENSHOT "+$size.Name+" "+((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()))
  }
  $proof=[ordered]@{status='NATIVE_INSTALLED_GUI_SCREENSHOTS_PASS';
    product='iwxa.admin-center';version='0.4.1';installerSha256=$sha;
    desktopScreenshot='admin-center-041-desktop-installed.png';
    compactScreenshot='admin-center-041-compact-installed.png'}
  $proof|ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (
    Join-Path $folder 'native-gui-visual.json') -Encoding utf8
  Write-Host 'ADMIN041_NATIVE_REAL_CENTER_DESKTOP_AND_COMPACT_GUI_PASS'
} finally {
  if($center){
    try{
      $center.Refresh()
      if(!$center.HasExited){
        $center.CloseMainWindow()|Out-Null
        if(!$center.WaitForExit(12000)){$center.Kill()}
      }
    }catch{}
    $center.Dispose()
  }
}
