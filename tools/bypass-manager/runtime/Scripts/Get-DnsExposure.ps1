# Read-only DNS routing inventory. It never sends DNS queries or changes VPN/OS settings.
# Outputs only aggregate counts: no DNS IPs, interface names or user paths.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$VpnAdapterName)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$summary = [ordered]@{
    checked = $false
    vpn_dns_count = 0
    other_dns_count = 0
    through_vpn_routes = 0
    outside_vpn_routes = 0
    unknown_routes = 0
    local_resolvers = 0
    truncated = $false
}
try {
    $active = @(Get-NetAdapter -ErrorAction Stop | Where-Object { $_.Status -eq 'Up' })
    $vpn = @($active | Where-Object { $_.Name -eq $VpnAdapterName })
    if ($vpn.Count -ne 1) {
        $summary | ConvertTo-Json -Compress
        return
    }
    $seen = @{}
    $entries = @(Get-DnsClientServerAddress -ErrorAction Stop)
    $processed = 0
    foreach ($entry in $entries) {
        $alias = [string]$entry.InterfaceAlias
        $isActive = @($active | Where-Object { $_.Name -eq $alias }).Count -gt 0
        if (-not $isActive) { continue }
        foreach ($value in @($entry.ServerAddresses)) {
            if ($null -eq $value) { continue }
            $ipText = [string]$value
            $ip = $null
            if (-not [System.Net.IPAddress]::TryParse($ipText, [ref]$ip)) { continue }
            if ($seen.ContainsKey("$alias|$ipText")) { continue }
            $seen["$alias|$ipText"] = $true
            if ($processed -ge 48) { $summary.truncated = $true; break }
            $processed++
            if ($alias -eq $VpnAdapterName) {
                $summary.vpn_dns_count++
            } else {
                $summary.other_dns_count++
            }
            if ([System.Net.IPAddress]::IsLoopback($ip)) {
                $summary.local_resolvers++
                continue
            }
            # IPv6 link-local addresses need a scope ID; an ambiguous route is UNKNOWN.
            if ($ip.IsIPv6LinkLocal -or $ip.IsIPv6SiteLocal) {
                $summary.unknown_routes++
                continue
            }
            try {
                $best = @(Find-NetRoute -RemoteIPAddress $ipText -ErrorAction Stop | Where-Object { $_.InterfaceAlias } | Select-Object -First 1)
                if ($best.Count -ne 1) { $summary.unknown_routes++; continue }
                if ([string]$best[0].InterfaceAlias -eq $VpnAdapterName) {
                    $summary.through_vpn_routes++
                } else {
                    $summary.outside_vpn_routes++
                }
            } catch {
                $summary.unknown_routes++
            }
        }
        if ($summary.truncated) { break }
    }
    $summary.checked = $true
} catch {
    # Do not serialize arbitrary system error text or mistake a failed check for no risk.
    $summary.checked = $false
}
$summary | ConvertTo-Json -Compress
