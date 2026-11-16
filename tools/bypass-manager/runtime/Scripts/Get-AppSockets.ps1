# Read-only local process/socket inventory. Output contains process BASE names,
# not IDs, filesystem paths, remote addresses, or adapter names. Go never
# serializes these names to a support bundle; they are shown locally only.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    $allAdapters = @(Get-NetAdapter -IncludeHidden -ErrorAction SilentlyContinue)
    $physical = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue)
    $vpnIndices = @{}
    $physicalIndices = @{}
    foreach ($n in $allAdapters) {
        $label = [string]$n.Name + ' ' + [string]$n.InterfaceDescription
        if ($label -match '(?i)amnezia|wireguard|wintun|\bawg\b|\btun\d*\b|tap-windows') { $vpnIndices[[int]$n.ifIndex] = $true }
    }
    foreach ($n in $physical) { $physicalIndices[[int]$n.ifIndex] = $true }
    $addresses = @{}
    foreach ($entry in @(Get-NetIPAddress -ErrorAction SilentlyContinue)) {
        if ($null -eq $entry.IPAddress) { continue }
        $key = ([string]$entry.IPAddress).Split('%')[0].ToLowerInvariant()
        $ifIndex = [int]$entry.InterfaceIndex
        if ($vpnIndices.ContainsKey($ifIndex)) { $addresses[$key] = 'VPN' }
        elseif ($physicalIndices.ContainsKey($ifIndex)) { $addresses[$key] = 'PHYSICAL' }
    }
    $rows = @{}
    function Get-BMCategory([string]$Name) {
        if ($Name -match '(?i)^(chrome|firefox|msedge|brave|opera|vivaldi|browser|waterfox|tor|yandex)$') { return 'BROWSER' }
        if ($Name -match '(?i)(amnezia|wireguard|openvpn|vpn|wintun|xray)') { return 'VPN_CLIENT' }
        return 'OTHER'
    }
    function Ensure-BMRow([int]$PIDValue) {
        $key = [string]$PIDValue
        if (-not $rows.ContainsKey($key)) {
            $name = 'unknown'
            try { $name = [string](Get-Process -Id $PIDValue -ErrorAction Stop).ProcessName } catch { }
            if ($name -notmatch '^[A-Za-z0-9_.-]{1,64}$') { $name = 'hidden' }
            $rows[$key] = [pscustomobject]@{name=$name; category=(Get-BMCategory $name);
                vpn_bound=0; physical_bound=0; loopback=0; uncertain=0; udp_bound=0}
        }
        return $rows[$key]
    }
    $tcp = @(Get-NetTCPConnection -State Established -ErrorAction Stop)
    foreach ($conn in $tcp) {
        $row = Ensure-BMRow -PIDValue ([int]$conn.OwningProcess)
        $local = ([string]$conn.LocalAddress).Split('%')[0].ToLowerInvariant()
        $remote = ([string]$conn.RemoteAddress).Split('%')[0].ToLowerInvariant()
        if ($remote -eq '127.0.0.1' -or $remote -eq '::1' -or $local -eq '127.0.0.1' -or $local -eq '::1') {
            $row.loopback++
        } elseif ($addresses.ContainsKey($local) -and $addresses[$local] -eq 'VPN') {
            $row.vpn_bound++
        } elseif ($addresses.ContainsKey($local) -and $addresses[$local] -eq 'PHYSICAL') {
            $row.physical_bound++
        } else { $row.uncertain++ }
    }
    $udpChecked = $false
    try {
        $udp = @(Get-NetUDPEndpoint -ErrorAction Stop)
        $udpChecked = $true
        foreach ($socket in $udp) {
            $row = Ensure-BMRow -PIDValue ([int]$socket.OwningProcess)
            $row.udp_bound++
        }
    } catch { }
    $all = @($rows.Values)
    $top = @($all | Sort-Object -Property name | Select-Object -First 50)
    $totalVpn = 0; $totalPhysical = 0; $totalLoopback = 0; $totalUnknown = 0; $totalUdp = 0
    foreach ($r in $all) {
        $totalVpn += [int]$r.vpn_bound
        $totalPhysical += [int]$r.physical_bound
        $totalLoopback += [int]$r.loopback
        $totalUnknown += [int]$r.uncertain
        $totalUdp += [int]$r.udp_bound
    }
    [pscustomobject]@{
        schema_version='0.3.4'; checked=$true; tcp_checked=$true; udp_checked=[bool]$udpChecked;
        process_count=[int]$all.Count; programs=$top; vpn_bound=[int]$totalVpn;
        physical_bound=[int]$totalPhysical; loopback=[int]$totalLoopback;
        uncertain=[int]$totalUnknown; udp_bound=[int]$totalUdp
    } | ConvertTo-Json -Depth 5 -Compress
} catch {
    # No raw network/IP/PowerShell exception text leaves this process.
    [pscustomobject]@{schema_version='0.3.4';checked=$false;tcp_checked=$false;
        udp_checked=$false;process_count=0;programs=@();vpn_bound=0;
        physical_bound=0;loopback=0;uncertain=0;udp_bound=0} |
      ConvertTo-Json -Compress
}
