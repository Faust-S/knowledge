# Active, consent-gated ICMP samples, with numeric and category-only JSON.
# Gateway IP, provider, DNS, SSID, usernames and interface names NEVER leave this script.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
function Measure-Ping {
 param([string]$Address,[int]$Count=6,[int]$Size=32,[bool]$DF=$false)
 if([string]::IsNullOrWhiteSpace($Address)) {return [pscustomobject]@{status='UNKNOWN';attempted=0;replied=0;median_ms=0;p95_ms=0;jitter_ms=0}}
 $p=[System.Net.NetworkInformation.Ping]::new()
 $latencies=New-Object 'System.Collections.Generic.List[double]'
 $options=[System.Net.NetworkInformation.PingOptions]::new()
 $options.DontFragment=$DF
 $payload=New-Object byte[] $Size
 try {
  for($i=0;$i -lt $Count;$i++) {
   try {
    $reply=$p.Send($Address,850,$payload,$options)
    if($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) { $latencies.Add([double]$reply.RoundtripTime) }
   } catch { }
  }
 } finally { $p.Dispose() }
 $received=$latencies.Count
 if($received -eq 0) {return [pscustomobject]@{status='NO_REPLIES';attempted=$Count;replied=0;median_ms=0;p95_ms=0;jitter_ms=0}}
 $sorted=@($latencies.ToArray() | Sort-Object)
 $middle=[int][math]::Floor(($received-1)/2)
 $median=[double]$sorted[$middle]
 $p95=[double]$sorted[[int][math]::Ceiling(0.95*$received)-1]
 $sum=0.0
 for($i=1;$i -lt $received;$i++) {$sum+=[math]::Abs($latencies[$i]-$latencies[$i-1])}
 $jitter=0.0
 if($received -gt 1) {$jitter=[math]::Round($sum/($received-1),1)}
 $status='PARTIAL';if($received -eq $Count) {$status='OK'}
 return [pscustomobject]@{status=$status;attempted=$Count;replied=$received;median_ms=$median;p95_ms=$p95;jitter_ms=$jitter}
}
function Probe-DF {
 param([string]$Address,[int]$Size)
 if([string]::IsNullOrWhiteSpace($Address)) {return 'UNKNOWN'}
 $sample=Measure-Ping -Address $Address -Count 1 -Size $Size -DF $true
 if($sample.replied -gt 0) {return 'REPLIED'}
 # An ICMP drop cannot prove PMTU/fragmentation. Never auto-change MTU.
 return 'NO_REPLY'
}
try {
 $routes=@(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop |
  Where-Object { $_.NextHop -and $_.NextHop -ne '0.0.0.0' } | Sort-Object RouteMetric)
 $gateway=''
 if($routes.Count -gt 0) {$gateway=[string]$routes[0].NextHop}
 $gw=Measure-Ping -Address $gateway
 $remote=Measure-Ping -Address '1.1.1.1'
 $df1=Probe-DF -Address '1.1.1.1' -Size 1200
 $df2=Probe-DF -Address '1.1.1.1' -Size 1400
 [pscustomobject]@{schema_version='0.3.3';checked=$true;gateway=$gw;remote=$remote;df_1200=$df1;df_1400=$df2} | ConvertTo-Json -Compress -Depth 5
} catch {
 $empty=[pscustomobject]@{status='UNKNOWN';attempted=0;replied=0;median_ms=0;p95_ms=0;jitter_ms=0}
 [pscustomobject]@{schema_version='0.3.3';checked=$true;gateway=$empty;remote=$empty;df_1200='UNKNOWN';df_1400='UNKNOWN'} | ConvertTo-Json -Compress -Depth 5
}
