# Opt-in, read-only preview or short ActiveStore IPv4 MTU experiment.
# A separate watchdog PowerShell process restores the old value after a TTL,
# including after a GUI crash. Reboot also discards ActiveStore changes.
# NEVER changes DNS, routes, firewall, persistent NIC configuration or VPN keys.
[CmdletBinding()]
param([ValidateSet('SelfTest','Preview','Start','Restore','Watchdog')][string]$Mode='Preview',
      [string]$Token='')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$root=Join-Path $env:LOCALAPPDATA 'BypassManager'
$statePath=Join-Path $root 'private-mtu-trial.json'
$readyPath=Join-Path $root 'private-mtu-ready'
function Write-BMResult([string]$Status,[int]$Before,[int]$After) {
    [pscustomobject]@{schema_version='0.3.4';status=$Status;before_mtu=$Before;after_mtu=$After} | ConvertTo-Json -Compress
}
function Test-BMState($s) {
    if ($null -eq $s -or $s.schema_version -ne '0.3.4' -or
        [int]$s.interface_index -lt 1 -or [int]$s.interface_index -gt 1000000 -or
        [int]$s.original_mtu -lt 1280 -or [int]$s.original_mtu -gt 9000 -or
        [int]$s.trial_mtu -lt 1280 -or [int]$s.trial_mtu -ge [int]$s.original_mtu -or
        [string]$s.token -notmatch '^[a-f0-9]{32}$') { throw 'Invalid MTU trial journal' }
}
function Read-BMState {
    if (-not (Test-Path -LiteralPath $statePath)) { return $null }
    $s = Get-Content -LiteralPath $statePath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    Test-BMState $s
    return $s
}
function Restore-BMMTU($s) {
    Test-BMState $s
    $ifIndex=[int]$s.interface_index
    try {
        $curr=Get-NetIPInterface -InterfaceIndex $ifIndex -AddressFamily IPv4 -PolicyStore ActiveStore -ErrorAction Stop | Select-Object -First 1
        if ($null -eq $curr) { throw 'Interface absent' }
        if ([int]$curr.NlMtu -eq [int]$s.trial_mtu) {
            Set-NetIPInterface -InterfaceIndex $ifIndex -AddressFamily IPv4 -PolicyStore ActiveStore -NlMtuBytes ([uint32]$s.original_mtu) -ErrorAction Stop
        } elseif ([int]$curr.NlMtu -ne [int]$s.original_mtu) {
            throw 'MTU changed by another owner; refusing overwrite'
        }
        $readback=Get-NetIPInterface -InterfaceIndex $ifIndex -AddressFamily IPv4 -PolicyStore ActiveStore -ErrorAction Stop | Select-Object -First 1
        if ([int]$readback.NlMtu -ne [int]$s.original_mtu) { throw 'MTU rollback not confirmed' }
        Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $readyPath -Force -ErrorAction SilentlyContinue
        return $true
    } catch { return $false }
}
function Get-BMTarget {
    $physical=@(Get-NetAdapter -Physical -ErrorAction Stop | Where-Object { $_.Status -eq 'Up' })
    if ($physical.Count -ne 1) { return $null }
    $idx=[int]$physical[0].ifIndex
    # The physical adapter must actually carry an IPv4 default route.
    $defaultRoutes=@(Get-NetRoute -InterfaceIndex $idx -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.DestinationPrefix -eq '0.0.0.0/0' })
    if ($defaultRoutes.Count -lt 1) { return $null }
    $ipif=Get-NetIPInterface -InterfaceIndex $idx -AddressFamily IPv4 -PolicyStore ActiveStore -ErrorAction Stop | Select-Object -First 1
    if ($null -eq $ipif) { return $null }
    $original=[int]$ipif.NlMtu
    # One conservative reduction; no attempt to alter VPN-owned adapters.
    if ($original -lt 1360 -or $original -gt 9000) { return $null }
    $candidate=[math]::Max(1280, $original - 80)
    return [pscustomobject]@{index=$idx;original=$original;candidate=[int]$candidate}
}
if ($Mode -eq 'SelfTest') {
    $s=[pscustomobject]@{schema_version='0.3.4';interface_index=10;original_mtu=1500;trial_mtu=1420;token='0123456789abcdef0123456789abcdef'}
    Test-BMState $s
    Write-BMResult 'SELF_TEST_PASS' 1500 1420
    exit 0
}
if ($Mode -eq 'Watchdog') {
    # A separate elevated helper, not a Windows service. A TTL guarantees a
    # best-effort rollback even if the GUI or trial process is terminated.
    try {
        $s=Read-BMState
        if ($null -eq $s -or $Token -ne [string]$s.token) { exit 1 }
        [System.IO.File]::WriteAllText($readyPath,[string]$s.token,[System.Text.UTF8Encoding]::new($false))
        $deadline=[datetime]::Parse([string]$s.expires_utc,[System.Globalization.CultureInfo]::InvariantCulture,[System.Globalization.DateTimeStyles]::AdjustToUniversal)
        while ([datetime]::UtcNow -lt $deadline) {
            if (-not (Test-Path -LiteralPath $statePath)) { exit 0 }
            Start-Sleep -Seconds 1
        }
        if (-not (Restore-BMMTU $s)) { exit 2 }
        exit 0
    } catch { exit 3 }
}
if ($Mode -eq 'Restore') {
    try {
        $state=Read-BMState
        if ($null -eq $state) { Write-BMResult 'NO_PENDING_TRIAL' 0 0;exit 0 }
        if (Restore-BMMTU $state) { Write-BMResult 'RESTORED' ([int]$state.trial_mtu) ([int]$state.original_mtu); exit 0 }
        Write-BMResult 'ROLLBACK_NOT_CONFIRMED' ([int]$state.trial_mtu) 0;exit 1
    } catch { Write-BMResult 'ROLLBACK_NOT_CONFIRMED' 0 0;exit 1 }
}
if ($Mode -eq 'Preview') {
    try {
        if (Test-Path -LiteralPath $statePath) { Write-BMResult 'PENDING_ROLLBACK' 0 0;exit 0 }
        $target=Get-BMTarget
        if ($null -eq $target) { Write-BMResult 'NO_UNAMBIGUOUS_PHYSICAL_INTERFACE' 0 0;exit 0 }
        Write-BMResult 'TRIAL_AVAILABLE' ([int]$target.original) ([int]$target.candidate)
    } catch { Write-BMResult 'PREVIEW_UNAVAILABLE' 0 0 }
    exit 0
}
# Mode Start. Privileged trial is opt-in from an explicit GUI confirmation.
try {
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    if (Test-Path -LiteralPath $statePath) { Write-BMResult 'PENDING_ROLLBACK' 0 0;exit 1 }
    $target=Get-BMTarget
    if ($null -eq $target) { Write-BMResult 'NO_UNAMBIGUOUS_PHYSICAL_INTERFACE' 0 0;exit 1 }
    $token=[guid]::NewGuid().ToString('N')
    $s=[ordered]@{schema_version='0.3.4';interface_index=[int]$target.index;original_mtu=[int]$target.original;trial_mtu=[int]$target.candidate;token=$token;expires_utc=([datetime]::UtcNow.AddSeconds(90).ToString('o'))}
    [System.IO.File]::WriteAllText($statePath,($s | ConvertTo-Json -Compress),[System.Text.UTF8Encoding]::new($false))
    Remove-Item -LiteralPath $readyPath -Force -ErrorAction SilentlyContinue
    $powershellExe=Join-Path $PSHOME 'powershell.exe'
    $args='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Mode Watchdog -Token ' + $token
    $watcher=Start-Process -FilePath $powershellExe -ArgumentList $args -WindowStyle Hidden -PassThru -ErrorAction Stop
    $ready=$false
    for ($i=0;$i -lt 40;$i++) {
        if (Test-Path -LiteralPath $readyPath) {
            $text=[System.IO.File]::ReadAllText($readyPath)
            if ($text -eq $token) { $ready=$true;break }
        }
        if ($watcher.HasExited) { break }
        Start-Sleep -Milliseconds 100
    }
    if (-not $ready) { Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue; Write-BMResult 'WATCHDOG_NOT_READY' 0 0;exit 1 }
    Set-NetIPInterface -InterfaceIndex ([int]$target.index) -AddressFamily IPv4 -PolicyStore ActiveStore -NlMtuBytes ([uint32]$target.candidate) -ErrorAction Stop
    $actual=Get-NetIPInterface -InterfaceIndex ([int]$target.index) -AddressFamily IPv4 -PolicyStore ActiveStore -ErrorAction Stop | Select-Object -First 1
    if ([int]$actual.NlMtu -ne [int]$target.candidate) { throw 'Trial value not confirmed' }
    Write-BMResult 'TRIAL_STARTED' ([int]$target.original) ([int]$target.candidate)
} catch {
    # Even if interrupted here, the independent watchdog attempts restoration.
    Write-BMResult 'TRIAL_NOT_CONFIRMED' 0 0
    exit 1
}
