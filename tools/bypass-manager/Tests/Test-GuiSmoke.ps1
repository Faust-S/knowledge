# Windows-only smoke: create the native Win32 window and close it normally.
# Never clicks Autoselect and never opens a WinDivert driver handle.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$exe=Join-Path $root 'Bypass-Manager.exe'
if(-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Missing built Windows GUI executable' }
$proc=Start-Process -FilePath $exe -WorkingDirectory $root -PassThru
$found=$false
try {
    $deadline=(Get-Date).AddSeconds(15)
    while((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 300
        $proc.Refresh()
        if($proc.HasExited) {throw "GUI exited unexpectedly ($($proc.ExitCode))"}
        if($proc.MainWindowHandle -ne 0) { $found=$true; break }
    }
    if(-not $found) { throw 'GUI process alive but native top-level window not observed on the Windows runner desktop' }
    Write-Host "PASS GUI main window created; PID=$($proc.Id)"
    if(-not $proc.CloseMainWindow()) {throw 'GUI window refused normal close request'}
    if(-not $proc.WaitForExit(6000)) {throw 'GUI did not exit cleanly after WM_CLOSE'}
    if($proc.ExitCode -ne 0) {throw "GUI returned failure exit code $($proc.ExitCode)"}
    Write-Host 'PASS GUI native close; no network interception or VPN test was executed'
} finally {
    $proc.Refresh()
    if(-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    $proc.Dispose()
}
