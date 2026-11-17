# Synthetic, no outbound traffic. Tests Windows' native process/socket
# observation without reading actual Amnezia processes or profiles.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$global:BMProxyScenario='NORMAL'
$root=Split-Path $PSScriptRoot -Parent
function global:Get-CimInstance {
    [CmdletBinding()]
    param([string]$ClassName)
    if($global:BMProxyScenario -eq 'NO_PROCESS') {return}
    $path=$(if($global:BMProxyScenario -eq 'UNTRUSTED_PROCESS'){'C:\NotAmnezia\xray.exe'}else{'C:\Program Files\AmneziaVPN\xray.exe'})
    [pscustomobject]@{Name='xray.exe';ExecutablePath=$path;ProcessId=4200}
}
function global:Get-NetTCPConnection {
    [CmdletBinding()]
    param([string]$State)
    if($global:BMProxyScenario -eq 'FAILED') {throw 'mock network inventory failure'}
    if($State -eq 'Listen') {
        $count=$(if($global:BMProxyScenario -eq 'MANY') {9} else {2})
        foreach($i in 0..($count-1)) {
            [pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=(10808+$i);OwningProcess=4200}
        }
        [pscustomobject]@{LocalAddress='0.0.0.0';LocalPort=22333;OwningProcess=4200}
        [pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=34567;OwningProcess=4201}
    }
}
function Assert-BMProxy([string]$Scenario,[string]$Expected,[int]$Count) {
    $global:BMProxyScenario=$Scenario
    $raw=& (Join-Path $root 'runtime\Scripts\Get-LocalProxyPorts.ps1')
    $obj=$raw | ConvertFrom-Json
    if($obj.schema_version -ne '0.3.7' -or $obj.status -ne $Expected -or @($obj.ports).Count -ne $Count) {
        throw "Unexpected proxy scenario ${Scenario}: $raw"
    }
    if($raw -match 'ProcessId|xray|\.exe|Program Files|C:\\|owning_process') {
        throw "Sensitive process/path leak: ${Scenario}"
    }
    Write-Host "PASS proxy $Scenario -> $Expected ($Count ports)"
}
Assert-BMProxy 'NORMAL' 'CANDIDATES' 2
Assert-BMProxy 'NO_PROCESS' 'NO_TRUSTED_LISTENER' 0
Assert-BMProxy 'UNTRUSTED_PROCESS' 'NO_TRUSTED_LISTENER' 0
Assert-BMProxy 'MANY' 'AMBIGUOUS' 0
Assert-BMProxy 'FAILED' 'UNAVAILABLE' 0
