#Requires -Version 5.1
# Read-only Windows runner qualification; no VPN data or packet interception.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$script = Join-Path $root 'runtime\Scripts\Get-NetworkHealth.ps1'
$raw = & $script
if(-not $raw) { throw 'Missing sanitized network snapshot' }
$h = $raw | ConvertFrom-Json
if($h.schema_version -ne '0.3.2') { throw 'Wrong snapshot schema' }
if(-not $h.checked) { throw 'Network inventory unavailable in Windows CI' }
if($h.physical_active -lt 0 -or $h.vpn_active -lt 0) { throw 'Invalid adapter counts' }
if($h.medium -notin @('ETHERNET','WIFI','CELLULAR','OTHER','UNKNOWN')) { throw 'Unexpected network category' }
if($h.wifi_signal_pct -lt -1 -or $h.wifi_signal_pct -gt 100) { throw 'Invalid signal value' }
if($raw -match '(?i)(ssid|bssid|mac_address|gateway|ip_address|adapter_name|proxy_url|provider_name|username|dns_server)') {
    throw 'Unapproved identity field in network snapshot'
}
Write-Host ('PASS read-only sanitized Windows network inventory: physical=' + $h.physical_active + ', vpn=' + $h.vpn_active + ', medium=' + $h.medium)
