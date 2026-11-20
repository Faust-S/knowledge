# Native GUI-to-engine offline acceptance, without VPN or any user profile.
# Uses only the current GitHub Actions runner and the exact packaged binaries.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$exe=Join-Path $root 'Bypass-Manager.exe'
$engine=Join-Path $root 'engine'
if(-not (Test-Path -LiteralPath $exe -PathType Leaf)) {throw 'Missing native GUI'}
foreach($part in @('winws2.exe','WinDivert.dll','WinDivert64.sys','cygwin1.dll','lua/zapret-lib.lua','lua/zapret-antidpi.lua','lua/zapret-auto.lua')) {
  if(-not (Test-Path -LiteralPath (Join-Path $engine $part) -PathType Leaf)) {throw "Offline engine missing $part"}
}
$api=@"
using System;
using System.Runtime.InteropServices;
public static class BypassOfflineGUI {
 [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr hWnd, int id);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd,System.Text.StringBuilder b,int limit);
}
"@
Add-Type -TypeDefinition $api -ErrorAction Stop
$oldAppData=$env:LOCALAPPDATA
$private=Join-Path $env:RUNNER_TEMP ('bypass-e2e-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $private -Force | Out-Null
$env:LOCALAPPDATA=$private
$home=Join-Path $private 'BypassManager'
$results=Join-Path $home 'results'
$proc=$null
try {
  if(Test-Path (Join-Path $home 'engine')) {throw 'Offline engine test root is not cold'}
  $proc=Start-Process -FilePath $exe -WorkingDirectory $root -PassThru
  $deadline=(Get-Date).AddSeconds(20)
  $button=[IntPtr]::Zero
  while((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 200
    $proc.Refresh()
    if($proc.HasExited){throw "GUI exited before interaction: $($proc.ExitCode)"}
    if($proc.MainWindowHandle -ne 0) {
      $button=[BypassOfflineGUI]::GetDlgItem([IntPtr]$proc.MainWindowHandle,3101)
      if($button -ne [IntPtr]::Zero){break}
    }
  }
  if($button -eq [IntPtr]::Zero){throw 'Primary GUI button not found'}
  [void][BypassOfflineGUI]::SendMessage($button,[uint32]0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)
  $deadline=(Get-Date).AddSeconds(110)
  $running=$false
  while((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 300
    $proc.Refresh()
    if($proc.HasExited){throw "GUI exited during start: $($proc.ExitCode)"}
    $stateFile=Join-Path $results 'latest-direct.json'
    $checkFile=Join-Path $results 'latest-direct-check.json'
    if(-not (Test-Path -LiteralPath $stateFile) -or -not (Test-Path -LiteralPath $checkFile)){continue}
    try {
      $state=Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
      $check=Get-Content -LiteralPath $checkFile -Raw | ConvertFrom-Json
      if($state.state -eq 'FAILED' -or $state.state -eq 'STALE_OR_UNVERIFIED'){throw "Native GUI startup reported $($state.state)"}
      if($state.state -ne 'RUNNING'){continue}
      if($check.engine_running -ne $true -or $check.before.total -ne 3 -or $check.after.total -ne 3){throw 'Native GUI did not record pre/post TLS samples'}
      if($check.effect_verified -ne $false){throw 'Unjustified positive DPI effect evidence'}
      if($check.state -notin @('GENERAL_HTTPS_AVAILABLE','GENERAL_HTTPS_CHANGE_OBSERVED','GENERAL_HTTPS_STILL_IMPAIRED','GENERAL_HTTPS_DEGRADED')){throw "Unknown HTTPS verdict $($check.state)"}
      $running=$true
      Write-Host "PASS native one-button offline start, HTTPS checks $($check.before.passed)/3 -> $($check.after.passed)/3, state $($check.state)"
      break
    }catch {
      # Write from the app is atomic. Preserve actual evidence failures, not
      # transient filesystem reads while the first report is being created.
      if($_.Exception.Message -match 'Native GUI|TLS samples|DPI effect|Unknown HTTPS'){throw}
    }
  }
  if(-not $running){throw 'Native GUI did not reach verified running state with offline engine'}
  if(-not (Test-Path -LiteralPath (Join-Path $home 'engine\winws2.exe'))){throw 'Offline engine did not install to the private runtime'}
  $deadline=(Get-Date).AddSeconds(8)
  $expected=-join ([char[]]@(1042,1099,1082,1083,1102,1095,1080,1090,1100))
  do {
    $label=New-Object System.Text.StringBuilder 90
    [void][BypassOfflineGUI]::GetWindowText($button,$label,90)
    if($label.ToString() -eq $expected){break}
    Start-Sleep -Milliseconds 250
  } while((Get-Date) -lt $deadline)
  if($label.ToString() -ne $expected){throw 'One-button GUI did not show Stop after native startup'}
  [void][BypassOfflineGUI]::SendMessage($button,[uint32]0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)
  $deadline=(Get-Date).AddSeconds(35)
  $stopped=$false
  while((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 350
    try {
      $state=Get-Content -LiteralPath (Join-Path $results 'latest-direct.json') -Raw | ConvertFrom-Json
      if($state.state -eq 'OFF') {$stopped=$true;break}
    }catch {}
  }
  if(-not $stopped){throw 'Native GUI did not stop its own filter'}
  if(Test-Path -LiteralPath (Join-Path $home 'active\winws2-owned.json')){throw 'Owned process record remained after stop'}
  Write-Host 'PASS native one-button shutdown: owned WinDivert process stopped, no VPN or Windows route changes'
  if(-not $proc.CloseMainWindow()){throw 'GUI did not accept window close'}
  if(-not $proc.WaitForExit(8000)){throw 'GUI did not exit normally'}
} finally {
  if($null -ne $proc){
    $proc.Refresh()
    if(-not $proc.HasExited){Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue}
    $proc.Dispose()
  }
  $state=Join-Path $home 'active'
  if(Test-Path -LiteralPath (Join-Path $state 'winws2-owned.json')) {
    & (Join-Path $root 'runtime\Scripts\Start-Profile.ps1') -Action Stop -StateFolder $state
  }
  $env:LOCALAPPDATA=$oldAppData
}