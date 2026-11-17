# Read-only inventory of loopback TCP listeners whose owning executable is
# inside an installed AmneziaVPN directory. No process command line, PID,
# executable path, subscriptions or keys are exported to Go.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
function Output-BMProxy([string]$Status,[int[]]$Ports=@()) {
    [pscustomobject]@{schema_version='0.3.7';status=$Status;ports=@($Ports)} | ConvertTo-Json -Compress -Depth 3
}
try {
    $owners=@{}
    foreach($p in @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)) {
        $name=[string]$p.Name
        $exe=[string]$p.ExecutablePath
        # A process name alone is not sufficient. Do not scan arbitrary local ports.
        if($name -notmatch '(?i)^(xray|xray-core|amnezia-xray|amneziaxray|amneziavpn|amneziavpn-service)\.exe$') { continue }
        if($exe -notmatch '(?i)\\AmneziaVPN(\\|\.ORG\\|-)') { continue }
        $owners[[string]([int64]$p.ProcessId)]=$true
    }
    $ports=@{}
    foreach($socket in @(Get-NetTCPConnection -State Listen -ErrorAction Stop)) {
        $local=[string]$socket.LocalAddress
        if($local -notin @('127.0.0.1','::1')) { continue }
        $port=[int]$socket.LocalPort
        if($port -lt 1024 -or $port -gt 65535) { continue }
        if(!$owners.ContainsKey([string]([int64]$socket.OwningProcess))) {continue}
        $ports[[string]$port]=$port
    }
    if($ports.Count -gt 8) {Output-BMProxy 'AMBIGUOUS';return}
    if($ports.Count -eq 0) {Output-BMProxy 'NO_TRUSTED_LISTENER';return}
    Output-BMProxy 'CANDIDATES' ([int[]]@($ports.Values | Sort-Object))
} catch {Output-BMProxy 'UNAVAILABLE'}
