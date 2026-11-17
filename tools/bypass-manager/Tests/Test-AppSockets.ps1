$ErrorActionPreference = 'Stop'
$path = Join-Path $PSScriptRoot '..\runtime\Scripts\Get-AppSockets.ps1'
$raw = & $path
$obj = $raw | ConvertFrom-Json
if ($obj.schema_version -ne '0.3.4' -or -not $obj.checked -or -not $obj.tcp_checked) { throw 'App inventory unavailable or malformed' }
if ($obj.process_count -lt 0 -or $obj.vpn_bound -lt 0 -or $obj.physical_bound -lt 0 -or $obj.proxy_bound -lt 0) { throw 'Negative counters' }
if ($raw -match 'remote_ip|remote_address|local_ip|process_path|owning_process|\\Users\\') { throw 'Sensitive field detected' }
Write-Host 'PASS read-only process/TCP/UDP snapshot; no remote IP, PID or paths'
