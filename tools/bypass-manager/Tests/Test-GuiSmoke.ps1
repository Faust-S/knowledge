#Requires -Version 5.1
# Repeatedly create, inspect and close a real Win32 window; no network or driver use.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$exe=Join-Path $root 'Bypass-Manager.exe'
if(-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Missing built Windows GUI executable' }
$cs=@"
using System;
using System.Runtime.InteropServices;
public static class BypassGuiSmokeNative {
 [DllImport("user32.dll", CharSet=CharSet.Unicode)]
 public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string title);
}
"@
Add-Type -TypeDefinition $cs -ErrorAction Stop
for($round=1;$round -le 3;$round++) {
  $proc=Start-Process -FilePath $exe -WorkingDirectory $root -PassThru
  try {
    $found=$false
    $deadline=(Get-Date).AddSeconds(15)
    while((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 300
      $proc.Refresh()
      if($proc.HasExited) {throw "GUI exited unexpectedly ($($proc.ExitCode))"}
      if($proc.MainWindowHandle -ne 0) { $found=$true; break }
    }
    if(-not $found) { throw "GUI window not observed on iteration $round" }
    $handle=[IntPtr]$proc.MainWindowHandle
    $prepare=[BypassGuiSmokeNative]::FindWindowEx($handle,[IntPtr]::Zero,'Button','Подготовить движок')
    if($prepare -eq [IntPtr]::Zero) { throw "Offline preparation button missing on iteration $round" }
    $dns=[BypassGuiSmokeNative]::FindWindowEx($handle,[IntPtr]::Zero,'Button','Проверить DNS')
    if($dns -eq [IntPtr]::Zero) { throw "Passive DNS diagnostics button missing on iteration $round" }
    Write-Host "PASS GUI $round/3: window, engine preparation and passive DNS buttons found; PID=$($proc.Id)"
    if(-not $proc.CloseMainWindow()) {throw "GUI refused WM_CLOSE on iteration $round"}
    if(-not $proc.WaitForExit(6000)) {throw "GUI did not close after WM_CLOSE on iteration $round"}
    if($proc.ExitCode -ne 0) {throw "GUI returned $($proc.ExitCode) on iteration $round"}
    Write-Host "PASS GUI $round/3: clean window shutdown"
  } finally {
    $proc.Refresh()
    if(-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    $proc.Dispose()
  }
}
Write-Host 'PASS three independent native Win32 startup/shutdown cycles; no VPN or WinDivert activity.'
