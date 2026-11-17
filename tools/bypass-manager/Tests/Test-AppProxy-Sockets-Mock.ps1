# Inert app-to-loopback-socket fixture. Never looks at real system processes.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$global:BMAppProxyMode='MATCH'
$root=Split-Path $PSScriptRoot -Parent
function global:Get-CimInstance {
    [CmdletBinding()]
    param([string]$ClassName)
    [pscustomobject]@{Name='xray.exe';ExecutablePath='C:\Program Files\AmneziaVPN\xray.exe';ProcessId=4200}
}
function global:Get-NetTCPConnection {
    [CmdletBinding()]
    param([string]$State)
    if($State -eq 'Listen') {
        [pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=10808;OwningProcess=4200}
    } elseif($State -eq 'Established') {
        $port=$(if($global:BMAppProxyMode -eq 'MISMATCH') {19999} else {10808})
        # This is the ordinary client's socket to Amnezia's trusted listener.
        [pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=50000;RemoteAddress='127.0.0.1';RemotePort=$port;OwningProcess=5000}
        [pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=10808;RemoteAddress='127.0.0.1';RemotePort=50000;OwningProcess=4200}
    }
}
function global:Get-NetAdapter {
    [CmdletBinding()]
    param([switch]$IncludeHidden,[switch]$Physical)
    [pscustomobject]@{Name='Ethernet';InterfaceDescription='Ethernet Adapter';ifIndex=10}
}
function global:Get-NetIPAddress {[CmdletBinding()] param()
    [pscustomobject]@{IPAddress='192.168.1.2';InterfaceIndex=10}
}
function global:Get-NetUDPEndpoint {[CmdletBinding()] param()}
function global:Get-Process {[CmdletBinding()] param([int]$Id)
    [pscustomobject]@{ProcessName=$(if($Id -eq 5000){'chrome'}else{'xray'})}
}
function Assert-BMAppProxy([string]$Mode,[int]$Count) {
    $global:BMAppProxyMode=$Mode
    $raw=& (Join-Path $root 'runtime\Scripts\Get-AppSockets.ps1')
    $obj=$raw | ConvertFrom-Json
    if($obj.schema_version -ne '0.3.4' -or -not $obj.proxy_checked -or $obj.proxy_bound -ne $Count) {
        throw "Failed app proxy classification ${Mode}: $raw"
    }
    if($raw -match 'owning_process|remote_address|127\.0\.0\.1|192\.168|5000|4200') {
        throw 'Private network or process identifiers found in exported snapshot'
    }
    Write-Host "PASS app socket $Mode -> $Count trusted proxy-bound connections"
}
Assert-BMAppProxy 'MATCH' 1
Assert-BMAppProxy 'MISMATCH' 0
