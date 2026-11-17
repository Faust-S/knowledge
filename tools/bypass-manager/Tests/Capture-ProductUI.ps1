# Native visual QA: two actual Win32 frames captured on the public Windows
# runner. No Amnezia, winws2, VPN account, packet filter or network action.
[CmdletBinding()]
param([string]$OutputRoot=$env:RUNNER_TEMP)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$exe=Join-Path $root 'Bypass-Manager.exe'
if(-not (Test-Path -LiteralPath $exe)) { throw 'Windows EXE missing' }
$outDir=Join-Path $OutputRoot 'bypass-ui'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
Add-Type -AssemblyName System.Drawing
$native=@"
using System;
using System.Runtime.InteropServices;
public static class BypassProductCapture {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {public int Left;public int Top;public int Right;public int Bottom;}
  [DllImport("user32.dll")] [return:MarshalAs(UnmanagedType.Bool)]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr hWnd, int id);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}
"@
Add-Type -TypeDefinition $native -ErrorAction Stop
$proc=Start-Process -FilePath $exe -WorkingDirectory $root -PassThru
try {
    $deadline=(Get-Date).AddSeconds(15)
    while((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 250
        $proc.Refresh()
        if($proc.HasExited) {throw "GUI exited unexpectedly"}
        if($proc.MainWindowHandle -ne 0) {break}
    }
    if($proc.MainWindowHandle -eq 0) {throw 'Main window not found'}
    $hwnd=[IntPtr]$proc.MainWindowHandle
    [void][BypassProductCapture]::ShowWindow($hwnd,3)
    Start-Sleep -Milliseconds 500
    function Save-ProductFrame([string]$Name) {
        $r=[BypassProductCapture+RECT]::new()
        if(-not [BypassProductCapture]::GetWindowRect($hwnd,[ref]$r)) {throw 'GetWindowRect failed'}
        $w=$r.Right-$r.Left
        $h=$r.Bottom-$r.Top
        if($w -lt 700 -or $h -lt 500 -or $w -gt 5000 -or $h -gt 4000) {
            throw "Unexpected native window size: $w x $h"
        }
        $bmp=[System.Drawing.Bitmap]::new($w,$h)
        try {
            $graphics=[System.Drawing.Graphics]::FromImage($bmp)
            try {
                $graphics.CopyFromScreen($r.Left,$r.Top,0,0,[System.Drawing.Size]::new($w,$h))
            } finally { $graphics.Dispose() }
            $path=Join-Path $outDir $Name
            $bmp.Save($path,[System.Drawing.Imaging.ImageFormat]::Png)
            Write-Host "CAPTURED $Name: $w x $h, $((Get-Item $path).Length) bytes"
        } finally {$bmp.Dispose()}
    }
    Save-ProductFrame 'main-collapsed.png'
    $details=[BypassProductCapture]::GetDlgItem($hwnd,2010)
    if($details -eq [IntPtr]::Zero) {throw 'Details control missing'}
    [void][BypassProductCapture]::SendMessage($details,[uint32]0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)
    Start-Sleep -Milliseconds 300
    Save-ProductFrame 'details-expanded.png'
} finally {
    $proc.Refresh()
    if(-not $proc.HasExited) {
        [void]$proc.CloseMainWindow()
        if(-not $proc.WaitForExit(7000)) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    }
    $proc.Dispose()
}
