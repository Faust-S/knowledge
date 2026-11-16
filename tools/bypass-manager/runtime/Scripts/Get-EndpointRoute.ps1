# Read-only route inspection. Find-NetRoute emits NetIPAddress THEN NetRoute.
# Selecting the first InterfaceAlias alone yields an IP object without DestinationPrefix.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$IPv4)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    $routes = @(Find-NetRoute -RemoteIPAddress $IPv4 -ErrorAction Stop |
        Where-Object {
            $null -ne $_.PSObject.Properties['DestinationPrefix'] -and
            -not [string]::IsNullOrWhiteSpace([string]$_.DestinationPrefix) -and
            -not [string]::IsNullOrWhiteSpace([string]$_.InterfaceAlias) -and
            [int]$_.InterfaceIndex -gt 0
        } | Select-Object -First 1)
    if ($routes.Count -eq 0) {
        [pscustomobject]@{status='NO_ROUTE';name='';index=0;destination=''} | ConvertTo-Json -Compress
        return
    }
    $route=$routes[0]
    [pscustomobject]@{status='ROUTE_FOUND';name=[string]$route.InterfaceAlias;
        index=[int]$route.InterfaceIndex;destination=[string]$route.DestinationPrefix} | ConvertTo-Json -Compress
} catch {
    # Never expose a local Windows username or endpoint address in a public report.
    [pscustomobject]@{status='LOOKUP_ERROR';name='';index=0;destination=''} | ConvertTo-Json -Compress
}
