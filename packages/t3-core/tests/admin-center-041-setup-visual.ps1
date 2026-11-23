# Screenshot and native UI proof of the exact unified IWXA Setup Core 1.0.
# Safe: does not install, accept, sign, mutate corporate data or issue T3 rights.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$Installer,
 [Parameter(Mandatory=$true)][string]$ExpectedSha256,
 [Parameter(Mandatory=$true)][string]$ExpectedCenterSha,
 [string]$OutputDir='artifacts/admin-041-visual'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
function Assert([bool]$valid,[string]$reason){if(!$valid){throw $reason}}
$exe=(Resolve-Path -LiteralPath $Installer).Path
$base=[IO.Path]::GetFullPath($OutputDir)
[IO.Directory]::CreateDirectory($base)|Out-Null
$actual=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
Assert ($actual -ceq $ExpectedSha256.ToLowerInvariant()) 'ADMIN041_NATIVE_SETUP_BYTES_NOT_PINNED'
$info=[Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
Assert ($info.ProductName -ceq 'IWXA Setup Core' -and
        $info.ProductVersion -ceq '1.0.0' -and
        $info.FileVersion -ceq '1.0.0.0') 'ADMIN041_NOT_SHARED_SETUP_CORE_1_0'
$probe=Join-Path $base 'native-inspection.json'
if(Test-Path -LiteralPath $probe){Remove-Item -LiteralPath $probe -Force}
$inspection=Start-Process -FilePath $exe -ArgumentList (
  '--inspect-file "'+$probe+'"') -PassThru -Wait
try{Assert ($inspection.ExitCode -eq 0) 'ADMIN041_NATIVE_INSPECTION_EXIT'}finally{$inspection.Dispose()}
Assert (Test-Path -LiteralPath $probe -PathType Leaf) 'ADMIN041_NATIVE_INSPECTION_MISSING'
$readback=Get-Content -LiteralPath $probe -Raw | ConvertFrom-Json
Assert ($readback.status -ceq 'VERIFIED' -and
        $readback.version -ceq '0.4.1' -and
        $readback.product -ceq 'iwxa.admin-center' -and
        $readback.packageFormat -ceq 'PE_RESOURCE_V2' -and
        $readback.sourceCommit -ceq $ExpectedCenterSha) 'ADMIN041_NATIVE_V2_BRANDING_OR_SOURCE_UNVERIFIED'
$process=$null
try{
  $process=Start-Process -FilePath $exe -PassThru
  $ready=$false
  $window=$null
  for($i=0;$i -lt 80;$i++){
    Start-Sleep -Milliseconds 450
    $process.Refresh()
    Assert (!$process.HasExited) 'ADMIN041_SETUP_GUI_EXITED_BEFORE_INSPECTION'
    if($process.MainWindowHandle -eq [IntPtr]::Zero){continue}
    $window=[Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
    if(!$window){continue}
    $nodes=$window.FindAll([Windows.Automation.TreeScope]::Descendants,
      [Windows.Automation.Condition]::TrueCondition)
    $hasBrand=$false;$hasProgram=$false;$hasAction=$false
    foreach($node in $nodes){
      try{
        $name=[string]$node.Current.Name
        $aid=[string]$node.Current.AutomationId
        if($name -match 'IWXA Admin Center' -and $node.Current.ControlType -eq
            [Windows.Automation.ControlType]::Image){$hasBrand=$true}
        if($aid -ceq 'iwxaSetupProductTitle' -and
           $name -match 'IWXA Admin Center'){$hasProgram=$true}
        if($aid -ceq 'iwxaSetupPrimaryAction'){
          $hasAction=$true
        }
      }catch{}
    }
    if($hasBrand -and $hasProgram -and $hasAction){$ready=$true;break}
  }
  Assert $ready 'ADMIN041_UNIFIED_SETUP_BRAND_PRIMARY_ACTION_NOT_OBSERVED'
  $bounds=$window.Current.BoundingRectangle
  $screen=[Windows.Forms.Screen]::PrimaryScreen.Bounds
  $left=[int][Math]::Max($screen.Left,[Math]::Floor($bounds.Left))
  $top=[int][Math]::Max($screen.Top,[Math]::Floor($bounds.Top))
  $right=[int][Math]::Min($screen.Right,[Math]::Ceiling($bounds.Right))
  $bottom=[int][Math]::Min($screen.Bottom,[Math]::Ceiling($bounds.Bottom))
  $width=$right-$left;$height=$bottom-$top
  Assert ($width -ge 700 -and $height -ge 440) 'ADMIN041_UNIFIED_SETUP_WINDOW_NOT_FULL_SIZE'
  $pic=Join-Path $base 'admin-041-unified-setup-core-1.0.png'
  $bitmap=[Drawing.Bitmap]::new($width,$height)
  $graphics=[Drawing.Graphics]::FromImage($bitmap)
  try{
    $graphics.CopyFromScreen([Drawing.Point]::new($left,$top),
      [Drawing.Point]::Empty,[Drawing.Size]::new($width,$height))
    $bitmap.Save($pic,[Drawing.Imaging.ImageFormat]::Png)
  }finally{$graphics.Dispose()}
  Assert ((Get-Item -LiteralPath $pic).Length -ge 10000) 'ADMIN041_UNIFIED_SETUP_SCREENSHOT_EMPTY'
  $pixels=0
  for($y=0;$y -lt [Math]::Min($height,125);$y+=2){
    for($x=0;$x -lt [Math]::Min($width,165);$x+=2){
      $p=$bitmap.GetPixel($x,$y)
      if($p.R -ge 200 -and $p.G -ge 45 -and $p.G -le 140 -and
         $p.B -ge 40 -and $p.B -le 150){$pixels++}
    }
  }
  $bitmap.Dispose()
  Assert ($pixels -ge 25) 'ADMIN041_UNIFIED_SETUP_CANONICAL_RED_MARK_NOT_VISIBLE'
  $proof=[ordered]@{
    status='NATIVE_SHARED_SETUP_1_0_VISUAL_PASS'
    product='iwxa.admin-center'
    version='0.4.1'
    packageFormat='PE_RESOURCE_V2'
    centerSource=$ExpectedCenterSha
    installerSha256=$actual
    screenshot='admin-041-unified-setup-core-1.0.png'
    screenshotSha256=(Get-FileHash -LiteralPath $pic -Algorithm SHA256).Hash.ToLowerInvariant()
    redMarkPixelWitness=$pixels
    windowWidth=$width
    windowHeight=$height
    sideEffects='NONE'
  }
  $proof|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $base 'visual-qualification.json') -Encoding utf8
  Write-Host ('ADMIN041_UNIFIED_SETUP_CORE_NATIVE_RED_BRAND_GUI_PASS '+$proof.screenshotSha256)
}finally{
  if($process){
    try{
      $process.Refresh()
      if(!$process.HasExited){
        $process.CloseMainWindow()|Out-Null
        if(!$process.WaitForExit(5000)){$process.Kill()}
      }
    }catch{}
    $process.Dispose()
  }
}
