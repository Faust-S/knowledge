#Requires -Version 5.1
# Read-only qualification. Never resolves a hostname or changes OS/VPN state.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$script=Join-Path (Split-Path $PSScriptRoot -Parent) 'runtime\Scripts\Get-DnsExposure.ps1'
$unknown=& $script -VpnAdapterName 'BypassManager_CI_NoSuchAdapter_2026'
$unknownJson=$unknown | ConvertFrom-Json
if($unknownJson.checked -ne $false) { throw 'Missing VPN adapter was accepted as inspected' }
$adapters=@(Get-NetAdapter -ErrorAction Stop | Where-Object { $_.Status -eq 'Up' })
if($adapters.Count -eq 0) { throw 'Windows runner has no connected interface for passive DNS test' }
$raw=& $script -VpnAdapterName ([string]$adapters[0].Name)
$s=$raw | ConvertFrom-Json
if($s.checked -ne $true) { throw 'DNS route inventory was not completed' }
foreach($key in @('vpn_dns_count','other_dns_count','through_vpn_routes','outside_vpn_routes','unknown_routes','local_resolvers')) {
  if([int]$s.$key -lt 0) {throw "Negative DNS inventory count: $key"}
}
if($raw -match '(?i)InterfaceAlias|ServerAddresses|(?:[0-9]{1,3}\.){3}[0-9]{1,3}') {
  throw 'DNS inventory leaked raw DNS IP or adapter metadata'
}
Write-Host 'PASS passive DNS route inventory and missing-adapter fail-closed check; no DNS queries sent.'
