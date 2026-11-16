# Pure synthetic Windows tests: replace network cmdlets with fixtures.
# Never connect to a destination, change routing, enable WFP or read VPN keys.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$script:fixture='VLESS_OK'
function global:Get-CimInstance {
  [CmdletBinding()]param([string]$ClassName)
  if($script:fixture -eq 'NO_PROCESS') { return }
  if($script:fixture -eq 'UNTRUSTED_PROCESS') {
    [pscustomobject]@{Name='xray.exe';ExecutablePath='C:\Portable\xray.exe';ProcessId=4200}
    return
  }
  if($script:fixture -in @('AWG_OK','STALE_WFP','ONE_WFP')) {
    [pscustomobject]@{Name='AmneziaVPN-service.exe';ExecutablePath='C:\Program Files\AmneziaVPN\AmneziaVPN-service.exe';ProcessId=4200}
    return
  }
  [pscustomobject]@{Name='xray.exe';ExecutablePath='C:\Program Files\AmneziaVPN\xray.exe';ProcessId=4200}
}
function global:Get-NetTCPConnection {
  [CmdletBinding()]param()
  $remote=$(if($script:fixture -eq 'PRIVATE_REMOTE'){'10.1.1.1'}else{'9.9.9.9'})
  $pid=$(if($script:fixture -eq 'WRONG_OWNER') {4201}else{4200})
  $state=$(if($script:fixture -eq 'SYN_SENT'){'SynSent'}else{'Established'})
  [pscustomobject]@{State=$state;OwningProcess=$pid;RemoteAddress=$remote;RemotePort=8443}
  if($script:fixture -eq 'AMBIGUOUS') {
    [pscustomobject]@{State='SynSent';OwningProcess=4200;RemoteAddress='1.1.1.1';RemotePort=8443}
  }
}
function global:Find-NetRoute {
  [CmdletBinding()]param([string]$RemoteIPAddress)
  [pscustomobject]@{InterfaceIndex=10;DestinationPrefix='0.0.0.0/0';InterfaceAlias='Ethernet'}
}
function global:Get-NetAdapter {
  [CmdletBinding()]param([switch]$Physical)
  if($script:fixture -ne 'NO_ROUTE') {
    [pscustomobject]@{ifIndex=10;Status='Up'}
  }
}
function global:Get-WinEvent {
  [CmdletBinding()]param([hashtable]$FilterHashtable,[int]$MaxEvents)
  if($script:fixture -notin @('AWG_OK','STALE_WFP','ONE_WFP')) { throw 'WFP disabled (simulated)' }
  $out=@()
  $amount=$(if($script:fixture -eq 'ONE_WFP'){@(1)}else{@(1,2)})
  foreach($i in $amount) {
    $age=$(if($script:fixture -eq 'STALE_WFP'){-180}else{-$i})
    $ev=[pscustomobject]@{TimeCreated=(Get-Date).AddSeconds($age)}
    $ev | Add-Member -MemberType ScriptMethod -Name ToXml -Value {
      return '<Event><EventData><Data Name="Protocol">17</Data><Data Name="ProcessID">4200</Data><Data Name="DestAddress">9.9.9.9</Data><Data Name="DestPort">51820</Data></EventData></Event>'
    }
    $out += $ev
  }
  return $out
}
function Assert-BMFixture([string]$Scenario,[string]$Protocol,[string]$Expected) {
  $script:fixture=$Scenario
  $raw=@(& (Join-Path $root 'runtime\Scripts\Get-OuterEndpoint.ps1') -Protocol $Protocol)
  if($raw.Count -ne 1) { throw "expected one JSON object: $Scenario" }
  $r=$raw[0] | ConvertFrom-Json
  if($r.status -ne $Expected) { throw "failed $Scenario/$Protocol: got $($r.status), expected $Expected" }
  if($Expected -eq 'OBSERVED') {
    if($r.port -lt 1 -or !$r.physical_route_confirmed) { throw "invalid observed route: $Scenario" }
  } else {
    if($r.ipv4 -or $r.port -ne 0) { throw "non-success leaked endpoint: $Scenario" }
  }
  Write-Host "PASS $Scenario / $Protocol / $Expected"
}
Assert-BMFixture 'VLESS_OK' 'VLESS' 'OBSERVED'
Assert-BMFixture 'AWG_OK' 'AMNEZIAWG' 'OBSERVED'
Assert-BMFixture 'AMBIGUOUS' 'VLESS' 'AMBIGUOUS'
Assert-BMFixture 'NO_PROCESS' 'AMNEZIAWG' 'NO_TRUSTED_PROCESS'
Assert-BMFixture 'NO_ROUTE' 'VLESS' 'NO_OUTER_TRANSPORT'

Assert-BMFixture 'SYN_SENT' 'VLESS' 'OBSERVED'
Assert-BMFixture 'UNTRUSTED_PROCESS' 'VLESS' 'NO_TRUSTED_PROCESS'
Assert-BMFixture 'WRONG_OWNER' 'VLESS' 'NO_OUTER_TRANSPORT'
Assert-BMFixture 'PRIVATE_REMOTE' 'VLESS' 'NO_OUTER_TRANSPORT'
Assert-BMFixture 'ONE_WFP' 'AMNEZIAWG' 'INSUFFICIENT_SIGNALS'
Assert-BMFixture 'STALE_WFP' 'AMNEZIAWG' 'NO_OUTER_TRANSPORT'
