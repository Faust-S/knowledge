# Read-only, whitelist-only Windows network topology snapshot.
# Never emit interface names, SSID/BSSID, MAC, IP, DNS servers, gateways,
# proxy URLs, usernames, provider names or raw command outputs.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Get-BMNumber {
    param([object]$Value)
    try {
        if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return [long]0 }
        return [long]$Value
    } catch { return [long]0 }
}
function Get-BMLinkMbps {
    param([object]$Value)
    $s = ([string]$Value).Trim().Replace(',', '.')
    $m = [regex]::Match($s, '(?i)(\d+(?:\.\d+)?)\s*(G(?:bit/s|bps|b/s)|M(?:bit/s|bps|b/s)|\u0413\u0431\u0438\u0442/\u0441|\u041c\u0431\u0438\u0442/\u0441)')
    if (-not $m.Success) { return 0 }
    $n = 0.0
    if (-not [double]::TryParse($m.Groups[1].Value, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$n)) { return 0 }
    $unit = $m.Groups[2].Value.ToUpperInvariant()
    if ([regex]::IsMatch($unit, '^(G|\u0413)')) { $n *= 1000 }
    return [int][math]::Round([math]::Min($n, 100000))
}
function Get-BMCounter {
    param([object]$Stats, [string]$Name)
    if ($null -eq $Stats) { return [long]0 }
    $p = $Stats.PSObject.Properties[$Name]
    if ($null -eq $p) { return [long]0 }
    return Get-BMNumber $p.Value
}
function Get-BMIPInterface {
    param([int]$Index)
    $items = @(Get-NetIPInterface -InterfaceIndex $Index -AddressFamily IPv4 -ErrorAction SilentlyContinue)
    if ($items.Count -gt 0) { return $items[0] }
    return $null
}
function Get-BMMtu {
    param([object]$Ipif)
    if ($null -eq $Ipif) { return 0 }
    return [int](Get-BMNumber $Ipif.NlMtu)
}
function Get-BMMetric {
    param([object]$Ipif)
    if ($null -eq $Ipif) { return 0 }
    return [int](Get-BMNumber $Ipif.InterfaceMetric)
}
function Get-BMKind {
    param([object]$Adapter)
    if ($null -eq $Adapter) { return 'UNKNOWN' }
    $medium = [string]$Adapter.NdisPhysicalMedium
    $description = [string]$Adapter.InterfaceDescription
    if ($medium -match '(?i)802\.11|Wireless' -or $description -match '(?i)Wi-Fi|Wireless|WLAN|802\.11') { return 'WIFI' }
    if ($medium -match '(?i)802\.3|Ethernet' -or $description -match '(?i)Ethernet') { return 'ETHERNET' }
    if ($medium -match '(?i)Cellular|WWAN' -or $description -match '(?i)WWAN|Cellular|Mobile Broadband') { return 'CELLULAR' }
    return 'OTHER'
}
function Get-BMWifiSignal {
    try {
        # Output may contain private SSIDs/BSSIDs. NEVER copy or emit it.
        $lines = @(& netsh.exe wlan show interfaces 2>$null)
        foreach ($line in $lines) {
            $m = [regex]::Match([string]$line, '(?i)^\s*(Signal|\u0421\u0438\u0433\u043d\u0430\u043b)\s*:\s*(\d{1,3})\s*%')
            if ($m.Success) {
                $n = [int]$m.Groups[2].Value
                if ($n -ge 0 -and $n -le 100) { return $n }
            }
        }
    } catch { }
    return -1
}
function Get-BMProxyEnabled {
    try {
        $settings = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction Stop
        if ($null -ne $settings.PSObject.Properties['ProxyEnable'] -and [int](Get-BMNumber $settings.ProxyEnable) -ne 0) { return $true }
        if ($null -ne $settings.PSObject.Properties['AutoConfigURL'] -and -not [string]::IsNullOrWhiteSpace([string]$settings.AutoConfigURL)) { return $true }
    } catch { }
    return $false
}
function Write-BMUnavailable {
    [pscustomobject]@{ schema_version='0.3.2'; checked=$false; physical_active=0; physical_ambiguous=$false;
        medium='UNKNOWN'; link_mbps=0; wifi_signal_pct=-1; physical_ipv4_mtu=0; physical_metric=0;
        receive_errors=0; send_errors=0; receive_discards=0; send_discards=0;
        vpn_active=0; vpn_ipv4_mtu=0; vpn_metric=0; vpn_full_route=$false; proxy_enabled=$false } |
        ConvertTo-Json -Compress
}
try {
    $all = @(Get-NetAdapter -ErrorAction Stop)
    $physical = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' })
    $vpn = @($all | Where-Object {
        $_.Status -eq 'Up' -and ($_.Name -match '(?i)amnezia|wireguard|wintun|awg|tun\d*|tap' -or
        $_.InterfaceDescription -match '(?i)amnezia|wireguard|wintun|awg|tunnel')
    })
    # Select a primary physical interface only when the observation is unambiguous.
    # A default route on one physical interface gives stronger evidence than order.
    $routeCandidates = @($physical | Where-Object {
        $r = @(Get-NetRoute -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.DestinationPrefix -eq '0.0.0.0/0' })
        $r.Count -gt 0
    })
    $primary = $null
    $ambiguous = $false
    if ($routeCandidates.Count -eq 1) { $primary = $routeCandidates[0] }
    elseif ($routeCandidates.Count -gt 1) { $ambiguous = $true }
    elseif ($physical.Count -eq 1) { $primary = $physical[0] }
    elseif ($physical.Count -gt 1) { $ambiguous = $true }
    $kind = 'UNKNOWN'; $link = 0; $wifi = -1; $mtu = 0; $metric = 0
    $rxErr = [long]0; $txErr = [long]0; $rxDrop = [long]0; $txDrop = [long]0
    if ($null -ne $primary) {
        $kind = Get-BMKind $primary
        $link = Get-BMLinkMbps $primary.LinkSpeed
        if ($kind -eq 'WIFI') { $wifi = Get-BMWifiSignal }
        $ipif = Get-BMIPInterface -Index ([int]$primary.ifIndex)
        $mtu = Get-BMMtu $ipif
        $metric = Get-BMMetric $ipif
        $stats = Get-NetAdapterStatistics -Name $primary.Name -ErrorAction SilentlyContinue
        $rxErr = Get-BMCounter $stats 'ReceivedPacketErrors'
        $txErr = Get-BMCounter $stats 'OutboundPacketErrors'
        $rxDrop = Get-BMCounter $stats 'ReceivedDiscardedPackets'
        $txDrop = Get-BMCounter $stats 'OutboundDiscardedPackets'
    }
    $vpnMtu = 0; $vpnMetric = 0; $vpnFull = $false
    if ($vpn.Count -eq 1) {
        $vif = Get-BMIPInterface -Index ([int]$vpn[0].ifIndex)
        $vpnMtu = Get-BMMtu $vif
        $vpnMetric = Get-BMMetric $vif
        $vpnRoutes = @(Get-NetRoute -InterfaceIndex $vpn[0].ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            ForEach-Object { [string]$_.DestinationPrefix })
        $vpnFull = ($vpnRoutes -contains '0.0.0.0/0' -or
            (($vpnRoutes -contains '0.0.0.0/1') -and ($vpnRoutes -contains '128.0.0.0/1')))
    }
    [pscustomobject]@{
        schema_version='0.3.2'; checked=$true; physical_active=[int]$physical.Count;
        physical_ambiguous=[bool]$ambiguous; medium=$kind; link_mbps=[int]$link;
        wifi_signal_pct=[int]$wifi; physical_ipv4_mtu=[int]$mtu; physical_metric=[int]$metric;
        receive_errors=$rxErr; send_errors=$txErr; receive_discards=$rxDrop; send_discards=$txDrop;
        vpn_active=[int]$vpn.Count; vpn_ipv4_mtu=[int]$vpnMtu; vpn_metric=[int]$vpnMetric;
        vpn_full_route=[bool]$vpnFull; proxy_enabled=[bool](Get-BMProxyEnabled)
    } | ConvertTo-Json -Compress
} catch {
    # Never export a raw exception: may contain usernames, adapter names or IPs.
    Write-BMUnavailable
}
