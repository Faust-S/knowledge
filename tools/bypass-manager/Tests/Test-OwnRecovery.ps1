# Exercise PID identity protection and stale state cleanup without starting a driver.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$script=Join-Path (Split-Path $PSScriptRoot -Parent) 'runtime\Scripts\Start-Profile.ps1'
$dir=Join-Path $env:TEMP ('bypass-recovery-fixture-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$state=Join-Path $dir 'winws2-owned.json'
try {
    $fake=[pscustomobject]@{Pid=$PID;StartTimeUtc='2000-01-01T00:00:00Z';Exe='C:\nonexistent\winws2.exe';Profile='UDP-FAKE'}
    $fake|ConvertTo-Json|Set-Content -LiteralPath $state -Encoding UTF8
    $refused=$false
    try { & $script -Action Stop -StateFolder $dir } catch { $refused=$true }
    if(-not $refused) { throw 'Manager attempted to stop an unrelated process' }
    if(-not (Test-Path -LiteralPath $state)) {throw 'Identity mismatch removed evidence file'}
    Get-Process -Id $PID -ErrorAction Stop | Out-Null
    Write-Host 'PASS refuses foreign process ownership even when PID is recorded'
    $fake.Pid=[int]::MaxValue
    $fake|ConvertTo-Json|Set-Content -LiteralPath $state -Encoding UTF8
    & $script -Action Stop -StateFolder $dir
    if(Test-Path -LiteralPath $state) {throw 'Stale state was not removed'}
    Write-Host 'PASS stale owned-state cleanup without packet interception'
} finally {
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}
