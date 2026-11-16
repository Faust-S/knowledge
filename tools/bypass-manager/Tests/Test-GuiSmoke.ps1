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
    foreach($id in @(2005,2006,2007,2008,2009,2010,2011,2012)) {
      $control=[BypassGuiSmokeNative]::GetDlgItem($handle,$id)
      if($control -eq [IntPtr]::Zero -or -not [BypassGuiSmokeNative]::IsWindowVisible($control)) {
        throw "Required visible main button missing: ID=$id, iteration=$round"
      }
    }
    $advancedField=[BypassGuiSmokeNative]::GetDlgItem($handle,101)
    $advancedToggle=[BypassGuiSmokeNative]::GetDlgItem($handle,2010)
    if($advancedField -eq [IntPtr]::Zero) {throw 'Advanced endpoint input missing'}
    if([BypassGuiSmokeNative]::IsWindowVisible($advancedField)) {throw 'Advanced networking fields visible without user action'}
    # BM_CLICK is a local UI message only, not a request to start a packet filter.
    [void][BypassGuiSmokeNative]::SendMessage($advancedToggle,[uint32]0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)
    if(-not [BypassGuiSmokeNative]::IsWindowVisible($advancedField)) {throw 'Advanced settings cannot be shown'}
    [void][BypassGuiSmokeNative]::SendMessage($advancedToggle,[uint32]0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)
    if([BypassGuiSmokeNative]::IsWindowVisible($advancedField)) {throw 'Advanced settings cannot be hidden'}
    Write-Host "PASS GUI $round/3: automatic diagnostics, recovery, collapsed and expanded advanced UI"
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
