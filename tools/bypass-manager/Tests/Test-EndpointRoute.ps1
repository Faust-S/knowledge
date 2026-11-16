# Windows PowerShell 5.1 regression: Find-NetRoute produces an address and a route.
# ASCII-only: Windows PowerShell 5.1 defaults to ANSI for BOM-less scripts.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'runtime\Scripts\Get-EndpointRoute.ps1'
function Find-NetRoute {
    [CmdletBinding()]
    param([string]$RemoteIPAddress)
    $ipObject = [pscustomobject]@{InterfaceAlias='Ethernet';InterfaceIndex=17;IPAddress='192.0.2.4'}
    if ($RemoteIPAddress -eq '198.51.100.17') {
        $route = [pscustomobject]@{InterfaceAlias='Ethernet';InterfaceIndex=17;
            DestinationPrefix='0.0.0.0/0';NextHop='192.0.2.1'}
        return @($ipObject,$route)
    }
    if ($RemoteIPAddress -eq '198.51.100.18') { return $ipObject }
    throw 'simulated route lookup failure'
}
$found = (& $scriptPath -IPv4 '198.51.100.17') | ConvertFrom-Json
if ($found.status -ne 'ROUTE_FOUND' -or $found.name -ne 'Ethernet' -or
    $found.index -ne 17 -or $found.destination -ne '0.0.0.0/0') {
    throw 'Selected a NetIPAddress instead of the NetRoute object'
}
$missing = (& $scriptPath -IPv4 '198.51.100.18') | ConvertFrom-Json
if ($missing.status -ne 'NO_ROUTE' -or $missing.index -ne 0) {
    throw 'Missing route was accepted or not classified'
}
$broken = (& $scriptPath -IPv4 '198.51.100.19') | ConvertFrom-Json
if ($broken.status -ne 'LOOKUP_ERROR' -or $broken.index -ne 0) {
    throw 'Route API failure was silently accepted'
}
Remove-Item Function:Find-NetRoute -ErrorAction SilentlyContinue
$actual = (& $scriptPath -IPv4 '1.1.1.1') | ConvertFrom-Json
if ($actual.status -ne 'ROUTE_FOUND' -or [string]::IsNullOrWhiteSpace($actual.destination)) {
    throw ('Real Windows route inspection failed: ' + $actual.status)
}
Write-Host 'PASS route selects NetRoute (not NetIPAddress), fail-closed errors, real Windows route read'
