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
$script:fakeMTU=1500
$script:changes=0
$script:watchdogFail=$false
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
    [pscustomobject]@{NlMtu=[int]$script:fakeMTU}
}
function Set-NetIPInterface {
    [CmdletBinding()]
    param([int]$InterfaceIndex,[string]$AddressFamily,[string]$PolicyStore,[uint32]$NlMtuBytes)
    if ($InterfaceIndex -ne 77 -or $AddressFamily -ne 'IPv4' -or $PolicyStore -ne 'ActiveStore') { throw 'Wrong interface or store for mutation' }
    $script:fakeMTU=[int]$NlMtuBytes
    $script:changes++
}
function Start-Process {
    [CmdletBinding()]
    param([string]$FilePath,[string]$ArgumentList,[string]$WindowStyle,[switch]$PassThru)
    if ($script:watchdogFail) { throw 'Simulated watchdog spawn failure' }
    if ($ArgumentList -notmatch '\-Token ([0-9a-f]{32})') { throw 'Missing watchdog token' }
    $token=$Matches[1]
    $ready=Join-Path $env:LOCALAPPDATA 'BypassManager\private-mtu-ready'
    [System.IO.File]::WriteAllText($ready,$token,[System.Text.UTF8Encoding]::new($false))
    [pscustomobject]@{HasExited=$false}
}
try {
    $journal=Join-Path $env:LOCALAPPDATA 'BypassManager\private-mtu-trial.json'
    $start=(& $mtuScript -Mode Start | ConvertFrom-Json)
    if ($start.status -ne 'TRIAL_STARTED' -or $script:fakeMTU -ne 1420 -or -not (Test-Path -LiteralPath $journal)) {throw 'Start failed in mock'}
    $restore=(& $mtuScript -Mode Restore | ConvertFrom-Json)
    if ($restore.status -ne 'RESTORED' -or $script:fakeMTU -ne 1500 -or (Test-Path -LiteralPath $journal)) {throw 'Restore failed in mock'}
    $start=(& $mtuScript -Mode Start | ConvertFrom-Json)
    if ($start.status -ne 'TRIAL_STARTED') {throw 'Second mock start failed'}
    # A concurrent owner changed the MTU; restoration MUST NOT overwrite it.
    $script:fakeMTU=1380
    $restore=(& $mtuScript -Mode Restore | ConvertFrom-Json)
    if ($restore.status -ne 'ROLLBACK_NOT_CONFIRMED' -or $script:fakeMTU -ne 1380 -or -not (Test-Path -LiteralPath $journal)) {throw 'Concurrent-owner guard failed'}
    # Return to our trial value to permit a verified recovery.
    $script:fakeMTU=1420
    $restore=(& $mtuScript -Mode Restore | ConvertFrom-Json)
    if ($restore.status -ne 'RESTORED' -or $script:fakeMTU -ne 1500) {throw 'Recovery after conflict failed'}
    $before=$script:changes
    $script:watchdogFail=$true
    $start=(& $mtuScript -Mode Start | ConvertFrom-Json)
    if ($start.status -ne 'TRIAL_NOT_CONFIRMED' -or $script:fakeMTU -ne 1500 -or $script:changes -ne $before -or (Test-Path -LiteralPath $journal)) {throw 'Failed watchdog left a stranded trial or changed network'}
    Write-Host 'PASS mock MTU start/restore, foreign mutation refusal and watchdog failure cleanup; no real interface touched'
} finally {
    $env:LOCALAPPDATA=$savedLocalAppData
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
