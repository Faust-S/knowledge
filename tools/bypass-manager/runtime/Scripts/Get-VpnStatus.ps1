# Read-only Windows adapter and route inventory. Never reads VPN profiles or keys.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    Import-Module (Join-Path $PSScriptRoot 'Common.psm1') -Force
    $all = @(Get-NetAdapter -ErrorAction Stop)
    $candidates = @($all | Where-Object {
        $_.Name -match '(?i)amnezia|wireguard|wintun|awg|tun|tap' -or
        $_.InterfaceDescription -match '(?i)amnezia|wireguard|wintun|awg'
    })
    $active = @($candidates | Where-Object { $_.Status -eq 'Up' })
    $name = ''
    $address = $false
    $route = $false
    if ($active.Count -eq 1) {
        $selected = $active[0]
        $name = [string]$selected.Name
        $ip = @(Get-NetIPAddress -InterfaceIndex $selected.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -notlike '169.254.*' })
        $address = ($ip.Count -gt 0)
        $routes = @(Get-NetRoute -InterfaceIndex $selected.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            ForEach-Object { [string]$_.DestinationPrefix })
        $route = [bool](Test-BMFullIPv4Route -Prefixes $routes)
    }
    $app = @(Get-Process -Name 'AmneziaVPN','AmneziaWG' -ErrorAction SilentlyContinue)
    [pscustomobject]@{
        checked = $true
        app_running = ($app.Count -gt 0)
        candidate_count = $candidates.Count
        active_count = $active.Count
        adapter_name = $name
        address_present = [bool]$address
        route_present = [bool]$route
    } | ConvertTo-Json -Compress
} catch {
    # Do not include Windows usernames, paths or network identifiers in errors.
    [pscustomobject]@{checked=$false;app_running=$false;candidate_count=0;active_count=0;
        adapter_name='';address_present=$false;route_present=$false} | ConvertTo-Json -Compress
}
