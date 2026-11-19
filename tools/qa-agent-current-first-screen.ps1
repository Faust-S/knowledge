# Read-only witness of a genuine installed Personal Agent window, never a recreated UI.
# Native GUI task-edit/readback receipt is checked independently before the image is shared.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$OutputDir, [int]$TimeoutSeconds=4200)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
[void][IO.Directory]::CreateDirectory($OutputDir)
$statePath=Join-Path $OutputDir 'capture-state.json'
$state=[ordered]@{
  exactProcessSeen=$false
  exactInstalledExeVerified=$false
  titledWindowSeen=$false
  genuineUiControlsSeen=$false
  screenshotCaptured=$false
}
function Save-SafeState {
  $state | ConvertTo-Json -Compress | Set-Content -LiteralPath $statePath -Encoding ascii
}
$expected=[IO.Path]::GetFullPath((Join-Path $env:RUNNER_TEMP 'g4-installed-original-agent06/temporary-installed-fixture/application/desktop/bin/IWXA Personal.exe'))
$end=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
$names=@(
  (-join([char[]]@(0x413,0x43b,0x430,0x432,0x43d,0x430))), # Home
  (-join([char[]]@(0x412,0x430,0x448,0x20,0x437,0x430,0x43f,0x440,0x43e,0x441))), # Your request
  (-join([char[]]@(0x422,0x435,0x43a,0x441,0x442,0x20,0x437,0x430,0x434,0x430,0x447,0x438))), # Task text
  'Home','Your request','Task text'
)
Save-SafeState
while([DateTime]::UtcNow -lt $end) {
  $candidates=@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq 'IWXA Personal' })
  foreach($p in $candidates) {
    $state.exactProcessSeen=$true
    try {
      $p.Refresh()
      if($p.HasExited){continue}
      $actual=[IO.Path]::GetFullPath([string]$p.MainModule.FileName)
      if(!$actual.Equals($expected,[StringComparison]::OrdinalIgnoreCase)){continue}
      $state.exactInstalledExeVerified=$true
      if($p.MainWindowHandle -eq [IntPtr]::Zero -or $p.MainWindowTitle -cne 'IWXA Personal'){continue}
      $state.titledWindowSeen=$true
      $root=[Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
      $found=$false
      foreach($name in $names) {
        $condition=[Windows.Automation.PropertyCondition]::new(
          [Windows.Automation.AutomationElement]::NameProperty,$name)
        $element=$root.FindFirst([Windows.Automation.TreeScope]::Descendants,$condition)
        if($null -ne $element -and !$element.Current.IsOffscreen){
          $found=$true
          break
        }
      }
      if(!$found){continue}
      $state.genuineUiControlsSeen=$true
      Start-Sleep -Milliseconds 400
      $p.Refresh()
      if($p.HasExited -or $p.MainWindowHandle -eq [IntPtr]::Zero){continue}
      $bounds=$root.Current.BoundingRectangle
      $screen=[Windows.Forms.Screen]::FromHandle($p.MainWindowHandle).Bounds
      $left=[int][Math]::Max($screen.Left,[Math]::Floor($bounds.Left))
      $top=[int][Math]::Max($screen.Top,[Math]::Floor($bounds.Top))
      $right=[int][Math]::Min($screen.Right,[Math]::Ceiling($bounds.Right))
      $bottom=[int][Math]::Min($screen.Bottom,[Math]::Ceiling($bounds.Bottom))
      $width=$right-$left;$height=$bottom-$top
      if($width -lt 650 -or $height -lt 470){continue}
      $png=Join-Path $OutputDir 'agent-native-current-first-screen.png'
      $bmp=[Drawing.Bitmap]::new($width,$height)
      $gfx=[Drawing.Graphics]::FromImage($bmp)
      try {
        $gfx.CopyFromScreen([Drawing.Point]::new($left,$top),[Drawing.Point]::Empty,[Drawing.Size]::new($width,$height))
        $bmp.Save($png,[Drawing.Imaging.ImageFormat]::Png)
      } finally {$gfx.Dispose();$bmp.Dispose()}
      if((Get-Item -LiteralPath $png).Length -lt 6000) {
        Remove-Item -LiteralPath $png -Force
        continue
      }
      $digest=(Get-FileHash -LiteralPath $png -Algorithm SHA256).Hash.ToLowerInvariant()
      $manifest=[ordered]@{
        schema='IWXA_AGENT_REAL_NATIVE_CAPTURE/1'
        originalAgentSha='ffa56fee6f971afa74b6b49ccfb891fca0e97225'
        ciSha=$env:GITHUB_SHA
        windowTitle='IWXA Personal'
        mode='Genuine installed Tauri, visible native UIA home/task interface'
        screenshotSha256=$digest
        source='Exact installed EXE identity + UIAutomation + Windows Graphics.CopyFromScreen'
        status='CAPTURED_REQUIRES_VISUAL_REVIEW'
      }
      $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputDir 'capture-manifest.json') -Encoding ascii
      $state.screenshotCaptured=$true
      Save-SafeState
      exit 0
    }catch {
      # A transient native window/readback failure must not publish private values.
    }finally {Save-SafeState}
  }
  Start-Sleep -Milliseconds 250
}
Save-SafeState
exit 1
