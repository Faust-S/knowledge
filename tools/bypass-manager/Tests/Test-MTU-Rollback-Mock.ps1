#Requires -Version 5.1
# Real Start/Restore logic against fake Windows network cmdlets.
# NEVER modifies a real adapter; the fake Get/Set functions are scoped to this test.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$mtuScript=Join-Path $PSScriptRoot '..\runtime\Scripts\Temporary-MTU.ps1'
$savedLocalAppData=$env:LOCALAPPDATA
$testRoot=Join-Path $env:TEMP ('bm-mtu-mock-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$env:LOCALAPPDATA=$testRoot
$global:BM_Mock_MTU=1500
$global:BM_Mock_Changes=0
$global:BM_Mock_WatchdogFail=$false
function Get-NetAdapter {
    [CmdletBinding()]
    param([switch]$Physical)
    if ($Physical) { [pscustomobject]@{Status='Up';ifIndex=77} }
}
function Get-NetRoute {
    [CmdletBinding()]
    param([int]$InterfaceIndex,[string]$AddressFamily)
    if ($InterfaceIndex -ne 77) { throw 'Unexpected route lookup' }
    [pscustomobject]@{DestinationPrefix='0.0.0.0/0'}
}
function Get-NetIPInterface {
    [CmdletBinding()]
    param([int]$InterfaceIndex,[string]$AddressFamily,[string]$PolicyStore)
    if ($InterfaceIndex -ne 77 -or $AddressFamily -ne 'IPv4' -or $PolicyStore -ne 'ActiveStore') { throw 'Wrong interface or store' }
    [pscustomobject]@{NlMtu=[int]$global:BM_Mock_MTU}
}
function Set-NetIPInterface {
    [CmdletBinding()]
    param([int]$InterfaceIndex,[string]$AddressFamily,[string]$PolicyStore,[uint32]$NlMtuBytes)
    if ($InterfaceIndex -ne 77 -or $AddressFamily -ne 'IPv4' -or $PolicyStore -ne 'ActiveStore') { throw 'Wrong interface or store for mutation' }
    $global:BM_Mock_MTU=[int]$NlMtuBytes
    $global:BM_Mock_Changes++
}
function Start-Process {
    [CmdletBinding()]
    param([string]$FilePath,[string]$ArgumentList,[string]$WindowStyle,[switch]$PassThru)
    if ($global:BM_Mock_WatchdogFail) { throw 'Simulated watchdog spawn failure' }
    if ($ArgumentList -notmatch '\-Token ([0-9a-f]{32})') { throw 'Missing watchdog token' }
    $token=$Matches[1]
    $ready=Join-Path $env:LOCALAPPDATA 'BypassManager\private-mtu-ready'
    [System.IO.File]::WriteAllText($ready,$token,[System.Text.UTF8Encoding]::new($false))
    [pscustomobject]@{HasExited=$false}
}
try {
    $journal=Join-Path $env:LOCALAPPDATA 'BypassManager\private-mtu-trial.json'
    $start=(& $mtuScript -Mode Start | ConvertFrom-Json)
    if ($start.status -ne 'TRIAL_STARTED' -or $global:BM_Mock_MTU -ne 1420 -or -not (Test-Path -LiteralPath $journal)) {throw ('Start failed in mock: status=' + $start.status + ', mtu=' + $global:BM_Mock_MTU + ', journal=' + (Test-Path -LiteralPath $journal))}
    $restore=(& $mtuScript -Mode Restore | ConvertFrom-Json)
    if ($restore.status -ne 'RESTORED' -or $global:BM_Mock_MTU -ne 1500 -or (Test-Path -LiteralPath $journal)) {throw 'Restore failed in mock'}
    $start=(& $mtuScript -Mode Start | ConvertFrom-Json)
    if ($start.status -ne 'TRIAL_STARTED') {throw 'Second mock start failed'}
    # A concurrent owner changed the MTU; restoration MUST NOT overwrite it.
    $global:BM_Mock_MTU=1380
    $restore=(& $mtuScript -Mode Restore | ConvertFrom-Json)
    if ($restore.status -ne 'ROLLBACK_NOT_CONFIRMED' -or $global:BM_Mock_MTU -ne 1380 -or -not (Test-Path -LiteralPath $journal)) {throw 'Concurrent-owner guard failed'}
    # Return to our trial value to permit a verified recovery.
    $global:BM_Mock_MTU=1420
    $restore=(& $mtuScript -Mode Restore | ConvertFrom-Json)
    if ($restore.status -ne 'RESTORED' -or $global:BM_Mock_MTU -ne 1500) {throw 'Recovery after conflict failed'}
    $before=$global:BM_Mock_Changes
    $global:BM_Mock_WatchdogFail=$true
    $start=(& $mtuScript -Mode Start | ConvertFrom-Json)
    if ($start.status -ne 'TRIAL_NOT_CONFIRMED' -or $global:BM_Mock_MTU -ne 1500 -or $global:BM_Mock_Changes -ne $before -or (Test-Path -LiteralPath $journal)) {throw 'Failed watchdog left a stranded trial or changed network'}
    Write-Host 'PASS mock MTU start/restore, foreign mutation refusal and watchdog failure cleanup; no real interface touched'
} finally {
    $env:LOCALAPPDATA=$savedLocalAppData
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Variable -Scope Global -Name BM_Mock_MTU, BM_Mock_Changes, BM_Mock_WatchdogFail -ErrorAction SilentlyContinue
    # Expected negative script paths use `exit 1`, which sets LASTEXITCODE
    # even though the test verified them successfully. Prevent a stale
    # expected status from failing the whole GitHub Actions PowerShell step.
    # A real thrown assertion still propagates to the caller as a failure.
    $global:LASTEXITCODE=0
}
