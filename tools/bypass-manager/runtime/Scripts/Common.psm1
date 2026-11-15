# Bypass-Manager common read-only helpers; PowerShell 5.1 compatible.
Set-StrictMode -Version Latest

function Assert-IPv4 {
    param([Parameter(Mandatory=$true)][string]$Address)
    if ($Address -notmatch '^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$') { throw "Invalid IPv4 literal: $Address" }
    foreach ($octet in $Address.Split('.')) {
        if (($octet.Length -gt 1 -and $octet.StartsWith('0')) -or [int]$octet -gt 255) { throw 'IPv4 octets must be 0..255 with no leading zeroes.' }
    }
    $ip = $null
    if (-not [System.Net.IPAddress]::TryParse($Address, [ref]$ip) -or $ip.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
        throw 'IPv4 parse failed.'
    }
    return $Address
}

function Assert-ExternalIPv4 {
    param([Parameter(Mandatory=$true)][string]$Address)
    [void](Assert-IPv4 -Address $Address)
    $o = @($Address.Split('.') | ForEach-Object { [int]$_ })
    $nonpublic = (
        $o[0] -eq 0 -or $o[0] -eq 10 -or $o[0] -eq 127 -or
        ($o[0] -eq 100 -and $o[1] -ge 64 -and $o[1] -le 127) -or
        ($o[0] -eq 169 -and $o[1] -eq 254) -or
        ($o[0] -eq 172 -and $o[1] -ge 16 -and $o[1] -le 31) -or
        ($o[0] -eq 192 -and $o[1] -eq 168) -or
        ($o[0] -eq 192 -and $o[1] -eq 0 -and $o[2] -eq 2) -or
        ($o[0] -eq 198 -and $o[1] -ge 18 -and $o[1] -le 19) -or
        ($o[0] -eq 198 -and $o[1] -eq 51 -and $o[2] -eq 100) -or
        ($o[0] -eq 203 -and $o[1] -eq 0 -and $o[2] -eq 113) -or
        $o[0] -ge 224
    )
    if ($nonpublic) { throw "This IPv4 is not a usable public VPN endpoint: $Address (reserved/private/example)." }
    return $Address
}

function Get-ExactWinDivertFilter {
    param([Parameter(Mandatory=$true)][string]$EndpointIPv4,
          [Parameter(Mandatory=$true)][ValidateRange(1,65535)][int]$Port,
          [ValidateSet('TCP','UDP')][string]$Transport='TCP')
    [void](Assert-IPv4 -Address $EndpointIPv4)
    if ($Transport -eq 'TCP') {
        # TCP packets need outbound payload + connection controls, inbound controls only.
        # Do not intercept bulk inbound ciphertext or empty ACKs.
        return '((outbound&&ip.DstAddr=={0}&&tcp.DstPort=={1}&&(tcp.PayloadLength>0||tcp.Syn||tcp.Fin||tcp.Rst))||(inbound&&ip.SrcAddr=={0}&&tcp.SrcPort=={1}&&(tcp.Syn||tcp.Fin||tcp.Rst)))' -f $EndpointIPv4,$Port
    }
    # UDP inbound copied for strategies that need auto-TTL. Benchmark CPU cost on целевой сети.
    return '((outbound&&ip.DstAddr=={0}&&udp.DstPort=={1})||(inbound&&ip.SrcAddr=={0}&&udp.SrcPort=={1}))' -f $EndpointIPv4,$Port
}

function Assert-LoopbackProxy {
    param([string]$ProxyUrl)
    if ([string]::IsNullOrWhiteSpace($ProxyUrl)) { return }
    $uri = $null
    if (-not [System.Uri]::TryCreate($ProxyUrl, [System.UriKind]::Absolute, [ref]$uri)) { throw 'Invalid proxy URL.' }
    if ($uri.Scheme -notin @('socks5','socks5h','http')) { throw 'Supported local proxy protocols: socks5, socks5h and http.' }
    if ($uri.Host -notin @('127.0.0.1','localhost','[::1]','::1')) { throw 'Proxy must be local (loopback); do not submit credentials.' }
    if ($uri.UserInfo -or $uri.Query -or $uri.Fragment) { throw 'Do not put usernames, passwords or query parameters in the proxy URL.' }
}

function Get-CurlPath {
    $cmd = Get-Command 'curl.exe' -ErrorAction Stop
    return $cmd.Source
}

function Invoke-CurlText {
    param([string[]]$Arguments)
    $curl = Get-CurlPath
    # Windows PowerShell 5.1 can turn a native program's stderr into NativeCommandError.
    $prior = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $lines = @(& $curl @Arguments 2>$null)
        $status = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prior }
    return [pscustomobject]@{ ExitCode=[int]$status; Text=($lines -join '') }
}

function Get-ProxyArgs {
    param([string]$ProxyUrl)
    Assert-LoopbackProxy -ProxyUrl $ProxyUrl
    if ([string]::IsNullOrWhiteSpace($ProxyUrl)) { return @('--noproxy','*') }
    return @('--proxy',$ProxyUrl)
}

function Get-PublicEgress {
    param([string]$ProxyUrl)
    $observations = @()
    foreach ($url in @('https://api.ipify.org','https://ifconfig.me/ip','https://icanhazip.com/')) {
        $args = @('-4','-sS','--fail','--connect-timeout','7','--max-time','12')
        $args += Get-ProxyArgs -ProxyUrl $ProxyUrl
        $args += @('--url',$url)
        $res = Invoke-CurlText -Arguments $args
        $ip = $res.Text.Trim()
        $valid = ($res.ExitCode -eq 0)
        if ($valid) { try { [void](Assert-IPv4 $ip) } catch { $valid = $false } }
        $observations += [pscustomobject]@{ Provider=$url; Status=$(if ($valid) {'OK'} else {'ERROR'}); ExitCode=$res.ExitCode; IP=$(if ($valid) {$ip} else {$null}) }
    }
    $successful = @($observations | Where-Object { $_.Status -eq 'OK' })
    $consensus = $null
    $groups = @($successful | Group-Object -Property IP | Sort-Object -Property Count -Descending)
    if ($groups.Count -gt 0 -and $groups[0].Count -ge 2) { $consensus = $groups[0].Name }
    return [pscustomobject]@{ Timestamp=(Get-Date).ToUniversalTime().ToString('o'); ConsensusIP=$consensus; Agreement=($null -ne $consensus); Sources=$observations }
}

function Test-EndpointTcp {
    param([string]$IP,[int]$Port,[int]$TimeoutMs=4000)
    [void](Assert-IPv4 -Address $IP)
    $c = New-Object System.Net.Sockets.TcpClient
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $async = $c.BeginConnect($IP, $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMs)) {
            return [pscustomobject]@{Status='TIMEOUT'; Milliseconds=$watch.ElapsedMilliseconds}
        }
        try { $c.EndConnect($async); return [pscustomobject]@{Status='OPEN'; Milliseconds=$watch.ElapsedMilliseconds} }
        catch { return [pscustomobject]@{Status='ERROR'; Milliseconds=$watch.ElapsedMilliseconds} }
    } catch { return [pscustomobject]@{Status='ERROR'; Milliseconds=$watch.ElapsedMilliseconds} }
    finally { $watch.Stop(); $c.Dispose() }
}

function Get-AdapterCounters {
    param([string]$Name)
    if ([string]::IsNullOrWhiteSpace($Name)) { return $null }
    try {
        $a = Get-NetAdapter -Name $Name -ErrorAction Stop
        $s = Get-NetAdapterStatistics -Name $a.Name -ErrorAction Stop
        return [pscustomobject]@{Name=$a.Name; Status=[string]$a.Status; ReceivedBytes=[long]$s.ReceivedBytes; SentBytes=[long]$s.SentBytes; Timestamp=(Get-Date).ToUniversalTime().ToString('o')}
    } catch { return $null }
}


function Get-EndpointRoute {
    param([string]$IP)
    try {
        $rr = @(Find-NetRoute -RemoteIPAddress $IP -ErrorAction Stop |
            Where-Object { $null -ne $_.PSObject.Properties['DestinationPrefix'] } |
            Select-Object -First 1)
        if ($rr.Count -eq 0) { return $null }
        return [pscustomobject]@{
            InterfaceAlias=[string]$rr[0].InterfaceAlias;
            InterfaceIndex=$rr[0].InterfaceIndex;
            DestinationPrefix=[string]$rr[0].DestinationPrefix;
            NextHop=[string]$rr[0].NextHop
        }
    } catch { return $null }
}

function Get-AwgNative {
    param([string]$AwgExe,[string]$Interface)
    if ([string]::IsNullOrWhiteSpace($AwgExe) -or [string]::IsNullOrWhiteSpace($Interface)) {
        return [pscustomobject]@{Status='NOT_CONFIGURED'; LatestHandshakeUnix=$null; ReceivedBytes=$null; SentBytes=$null}
    }
    if (-not (Test-Path -LiteralPath $AwgExe -PathType Leaf)) {
        return [pscustomobject]@{Status='TOOL_NOT_FOUND'; LatestHandshakeUnix=$null; ReceivedBytes=$null; SentBytes=$null}
    }
    # Never write raw CLI output to files: it may contain peer public keys.
    $old = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $hs = @(& $AwgExe show $Interface latest-handshakes 2>$null)
        $hc = $LASTEXITCODE
        $tr = @(& $AwgExe show $Interface transfer 2>$null)
        $tc = $LASTEXITCODE
    } catch { $hc = 1; $tc = 1; $hs=@(); $tr=@() }
    finally { $ErrorActionPreference = $old }
    if ($hc -ne 0 -or $tc -ne 0) {
        return [pscustomobject]@{Status='UNAVAILABLE'; LatestHandshakeUnix=$null; ReceivedBytes=$null; SentBytes=$null}
    }
    $maxTime = [long]0; $rx=[long]0; $tx=[long]0; $validTime=$false; $validBytes=$false
    foreach ($line in $hs) {
        if ([string]$line -match '^\S+\s+([0-9]{1,12})\s*$') {
            $validTime=$true; $v=[long]$Matches[1]; if ($v -gt $maxTime) {$maxTime=$v}
        }
    }
    foreach ($line in $tr) {
        if ([string]$line -match '^\S+\s+([0-9]+)\s+([0-9]+)\s*$') {
            $validBytes=$true; $rx += [long]$Matches[1]; $tx += [long]$Matches[2]
        }
    }
    $status = if ($validTime -and $validBytes) {'OK'} else {'UNAVAILABLE'}
    return [pscustomobject]@{Status=$status; LatestHandshakeUnix=$(if ($validTime) {$maxTime} else {$null}); ReceivedBytes=$(if ($validBytes) {$rx} else {$null}); SentBytes=$(if ($validBytes) {$tx} else {$null})}
}

function Invoke-DownloadProbe {
    param([int]$Bytes,[string]$ProxyUrl,[string]$OutputFolder,[int]$TimeoutSec=90,[string]$UrlTemplate='https://speed.cloudflare.com/__down?bytes={bytes}')
    if ($Bytes -lt 1024 -or $Bytes -gt 104857600) { throw 'Download size outside 1KiB..100MiB.' }
    $filename = Join-Path $OutputFolder ('payload-' + [guid]::NewGuid().ToString('N') + '.tmp')
    if (-not $UrlTemplate.Contains('{bytes}')) { throw 'Download URL template must include {bytes} placeholder.' }
    $url = $UrlTemplate.Replace('{bytes}', [string]$Bytes)
    $uri = $null
    if (-not [System.Uri]::TryCreate($url,[System.UriKind]::Absolute,[ref]$uri) -or $uri.Scheme -ne 'https' -or $uri.UserInfo) { throw 'Download URL must be HTTPS without credentials.' }
    $fmt = 'HTTP=%{http_code};CONNECT=%{time_connect};TLS=%{time_appconnect};TTFB=%{time_starttransfer};TOTAL=%{time_total};BYTES=%{size_download}'
    $args = @('-4','-sS','--fail','--location','--max-redirs','3','--connect-timeout','10','--max-time',[string]$TimeoutSec)
    $args += Get-ProxyArgs -ProxyUrl $ProxyUrl
    $args += @('--output',$filename,'--write-out',$fmt,'--url',$url)
    try {
        $res = Invoke-CurlText -Arguments $args
        $disk = [long]0
        if (Test-Path -LiteralPath $filename) { $disk = (Get-Item -LiteralPath $filename).Length }
        $http=0; $total=0.0; $tls=0.0; $connect=0.0; $ttfb=0.0
        if ($res.Text -match 'HTTP=([0-9]{3});CONNECT=([0-9.]+);TLS=([0-9.]+);TTFB=([0-9.]+);TOTAL=([0-9.]+);BYTES=([0-9.]+)') {
            $http=[int]$Matches[1]
            $connect=[double]::Parse($Matches[2],[cultureinfo]::InvariantCulture)
            $tls=[double]::Parse($Matches[3],[cultureinfo]::InvariantCulture)
            $ttfb=[double]::Parse($Matches[4],[cultureinfo]::InvariantCulture)
            $total=[double]::Parse($Matches[5],[cultureinfo]::InvariantCulture)
        }
        $ok=($res.ExitCode -eq 0 -and $http -ge 200 -and $http -lt 300 -and $disk -eq $Bytes)
        return [pscustomobject]@{
            Timestamp=(Get-Date).ToUniversalTime().ToString('o'); Target=$uri.Host; RequestedBytes=$Bytes;
            ReceivedBytes=$disk; ExitCode=$res.ExitCode; HttpStatus=$http; Success=$ok;
            TcpSeconds=$connect; TlsSeconds=$tls; TtfbSeconds=$ttfb; TotalSeconds=$total;
            Mbps=$(if($ok -and $total -gt 0) {[math]::Round(($disk*8.0)/($total*1000000),3)} else {$null})
        }
    } finally { Remove-Item -LiteralPath $filename -Force -ErrorAction SilentlyContinue }
}


function Test-IcmpProbe {
    param([string]$Target,[int]$Count=8,[int]$TimeoutMs=1000)
    [void](Assert-IPv4 $Target)
    $ping=New-Object System.Net.NetworkInformation.Ping
    $times=@(); $fail=0
    try {
        for($i=0;$i -lt $Count;$i++) {
            try {
                $reply=$ping.Send($Target,$TimeoutMs)
                if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) {
                    $times+= [int]$reply.RoundtripTime
                } else { $fail++ }
            } catch { $fail++ }
        }
    } finally { $ping.Dispose() }
    $sorted=@($times | Sort-Object)
    $median=$null
    if ($sorted.Count -gt 0) { $median=$sorted[[int][math]::Floor(($sorted.Count-1)/2)] }
    return [pscustomobject]@{Target=$Target;Sent=$Count;Replies=$times.Count;Lost=$fail;
        LossPercent=([math]::Round(100.0*$fail/$Count,2)); MedianRttMs=$median;
        Caveat='ICMP may be filtered independently; missing replies do not prove VPN packet loss. Local SOCKS/HTTP proxy does not tunnel ping.'}
}

function Save-Json {
    param($Object,[string]$Path)
    $Object | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Path -Encoding UTF8
}

Export-ModuleMember -Function Assert-IPv4,Assert-ExternalIPv4,Get-ExactWinDivertFilter,Assert-LoopbackProxy,Get-CurlPath,Invoke-CurlText,Get-ProxyArgs,Get-PublicEgress,Test-EndpointTcp,Get-AdapterCounters,Get-EndpointRoute,Get-AwgNative,Invoke-DownloadProbe,Test-IcmpProbe,Save-Json
