# Smoke-test passive inventory on Windows, without VPN credentials or any packet filter.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$scriptPath=Join-Path (Split-Path $PSScriptRoot -Parent) 'runtime\Scripts\Get-VpnStatus.ps1'
$raw=& $scriptPath
if($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'VPN inventory script failed' }
$state=$raw | ConvertFrom-Json
if($null -eq $state.checked -or $null -eq $state.active_count -or $null -eq $state.candidate_count) {throw 'Missing state fields'}
if(-not $state.checked) {throw 'Read-only Windows VPN inventory unavailable'}
if($state.checked) {
  if($state.active_count -lt 0 -or $state.active_count -gt $state.candidate_count) {throw 'Invalid adapter counts'}
  if($state.active_count -ne 1 -and $state.adapter_name) {throw 'Ambiguous adapter selected'}
}
# Regression: AmneziaWG supports both /0 and paired /1 routes.
Import-Module (Join-Path (Split-Path $PSScriptRoot -Parent) 'runtime\Scripts\Common.psm1') -Force
if (-not (Test-BMFullIPv4Route -Prefixes @('0.0.0.0/0'))) { throw 'Lost single /0 full tunnel detection' }
if (-not (Test-BMFullIPv4Route -Prefixes @('0.0.0.0/1','128.0.0.0/1'))) { throw 'Lost paired /1 full tunnel detection' }
if (Test-BMFullIPv4Route -Prefixes @('0.0.0.0/1')) { throw 'A single /1 is not a full tunnel' }
if (Test-BMFullIPv4Route -Prefixes @('128.0.0.0/1')) { throw 'A single /1 is not a full tunnel' }
if (Test-BMFullIPv4Route -Prefixes @('192.168.0.0/16')) { throw 'Private LAN route is not a full tunnel' }
Write-Host ('PASS read-only Windows VPN status and full IPv4 route variants: checked=' + $state.checked + '; active=' + $state.active_count)
