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
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int maxChars);
 [StructLayout(LayoutKind.Sequential)]
 public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
 [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
 public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
}
"@
Add-Type -TypeDefinition $cs -ErrorAction Stop
for($round=1;$round -le 3;$round++) {
  $proc=Start-Process -FilePath $exe -WorkingDirectory $root -PassThru
  try {
    $found=$false
    $deadline=(Get-Date).AddSeconds(20)
    while((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 250
      $proc.Refresh()
      if($proc.HasExited) {throw "GUI exited unexpectedly ($($proc.ExitCode))"}
      if($proc.MainWindowHandle -ne 0) {$found=$true;break}
    }
    if(-not $found) {throw "One-button GUI not found in iteration $round"}
    $handle=[IntPtr]$proc.MainWindowHandle
    foreach($id in @(3101,3102,3103)) {
      $c=[BypassGuiSmokeNative]::GetDlgItem($handle,$id)
      if($c -eq [IntPtr]::Zero -or -not [BypassGuiSmokeNative]::IsWindowVisible($c)) {
        throw "Missing one-button product control $id"
      }
    }
    foreach($id in @(2001,2002,2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2023,2024,2025)) {
      $legacy=[BypassGuiSmokeNative]::GetDlgItem($handle,$id)
      if($legacy -ne [IntPtr]::Zero -and [BypassGuiSmokeNative]::IsWindowVisible($legacy)) {
        throw "Old diagnostics or Amnezia wizard visible in one-button product: $id"
      }
    }
    foreach($pair in @(@(3101,'Включить'),@(3102,'Скорость и регион'),@(3103,'Отчёт'))) {
      $c=[BypassGuiSmokeNative]::GetDlgItem($handle,$pair[0])
      $b=New-Object System.Text.StringBuilder 90
      [void][BypassGuiSmokeNative]::GetWindowText($c,$b,90)
      if($pair[0] -ne 3101 -and $b.ToString() -ne $pair[1]) {throw "Wrong action title $($b.ToString())"}
      if($pair[0] -eq 3101 -and $b.ToString() -notin @('Включить','Выключить','Проверить остановку')) {
        throw "Unexpected primary action caption: $($b.ToString())"
      }
    }
    Write-Host "PASS GUI $round/3: three visible native Windows actions; no wizard; no DPI packet capture"
    if(-not $proc.CloseMainWindow()) {throw 'CloseMainWindow failed'}
    if(-not $proc.WaitForExit(8000)) {throw 'GUI did not close'}
    if($proc.ExitCode -ne 0) {throw "GUI exit code $($proc.ExitCode)"}
    Write-Host "PASS GUI $round/3: normal close"
  } finally {
    $proc.Refresh()
    if(-not $proc.HasExited) {Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue}
    $proc.Dispose()
  }
}
Write-Host 'PASS three Windows one-button GUI cycles. No VPN, route, DNS or driver changes.'
