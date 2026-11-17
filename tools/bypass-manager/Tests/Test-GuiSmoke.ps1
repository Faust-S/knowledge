# Native Win32 GUI lifecycle and layout checks; ASCII-only for Windows PowerShell 5.1.
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
 [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr hWnd, int id);
 [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindowVisible(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, UInt32 msg, IntPtr wParam, IntPtr lParam);
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
    # Only main product actions are shown before user opens details.
    foreach($id in @(2010,2011,2012,2014,2017,2018,2019,2020,2026,2027,2028)) {
      $c=[BypassGuiSmokeNative]::GetDlgItem($handle,$id)
      if($c -eq [IntPtr]::Zero -or -not [BypassGuiSmokeNative]::IsWindowVisible($c)) {
        throw "Main product control missing or hidden: $id"
      }
    }
    foreach($id in @(2003,2004,2005,2006,2007,2008,2009,2013,2015,2016,2021,2022,2025,110)) {
      $c=[BypassGuiSmokeNative]::GetDlgItem($handle,$id)
      if($c -eq [IntPtr]::Zero) {throw "Missing diagnostic control $id"}
      if([BypassGuiSmokeNative]::IsWindowVisible($c)) {throw "Engineering control visible by default: $id"}
    }
    foreach($id in @(2023,2024)) {
      $c=[BypassGuiSmokeNative]::GetDlgItem($handle,$id)
      if($c -eq [IntPtr]::Zero -or [BypassGuiSmokeNative]::IsWindowVisible($c)) {
        throw "Prompt control not initially hidden: $id"
      }
    }
    $advancedField=[BypassGuiSmokeNative]::GetDlgItem($handle,101)
    $details=[BypassGuiSmokeNative]::GetDlgItem($handle,2010)
    $manual=[BypassGuiSmokeNative]::GetDlgItem($handle,2025)
    $diag=[BypassGuiSmokeNative]::GetDlgItem($handle,2005)
    $log=[BypassGuiSmokeNative]::GetDlgItem($handle,110)
    if($advancedField -eq [IntPtr]::Zero) {throw 'Missing advanced endpoint field'}
    if([BypassGuiSmokeNative]::IsWindowVisible($advancedField)) {throw 'Manual IP shown automatically'}
    # BM_CLICK changes only local control visibility, not the VPN or DPI.
    [void][BypassGuiSmokeNative]::SendMessage($details,[uint32]0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)
    if(-not [BypassGuiSmokeNative]::IsWindowVisible($manual) -or -not [BypassGuiSmokeNative]::IsWindowVisible($diag) -or -not [BypassGuiSmokeNative]::IsWindowVisible($log)) {
      throw 'Details failed to reveal native diagnostic controls'
    }
    if([BypassGuiSmokeNative]::IsWindowVisible($advancedField)) {throw 'Manual config shown before request'}
    [void][BypassGuiSmokeNative]::SendMessage($manual,[uint32]0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)
    if(-not [BypassGuiSmokeNative]::IsWindowVisible($advancedField)) {throw 'Manual settings cannot open'}
    if([BypassGuiSmokeNative]::IsWindowVisible($log) -or [BypassGuiSmokeNative]::IsWindowVisible($diag)) {throw 'Manual settings overlapped by diagnostics'}
    [void][BypassGuiSmokeNative]::SendMessage($manual,[uint32]0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)
    if([BypassGuiSmokeNative]::IsWindowVisible($advancedField) -or -not [BypassGuiSmokeNative]::IsWindowVisible($log)) {throw 'Manual settings did not close'}
    [void][BypassGuiSmokeNative]::SendMessage($details,[uint32]0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)
    if([BypassGuiSmokeNative]::IsWindowVisible($log) -or [BypassGuiSmokeNative]::IsWindowVisible($diag)) {throw 'Details did not collapse'}
    Write-Host "PASS GUI $round/3: product summary, hidden diagnostics, manual fields and restored history"
    if(-not $proc.CloseMainWindow()) {throw "GUI refused WM_CLOSE on iteration $round"}
    if(-not $proc.WaitForExit(7000)) {throw "GUI did not close after WM_CLOSE on iteration $round"}
    if($proc.ExitCode -ne 0) {throw "GUI returned $($proc.ExitCode) on iteration $round"}
    Write-Host "PASS GUI $round/3: clean window shutdown"
  } finally {
    $proc.Refresh()
    if(-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    $proc.Dispose()
  }
}
Write-Host 'PASS three Win32 cycles. No VPN, route change or packet interception.'
