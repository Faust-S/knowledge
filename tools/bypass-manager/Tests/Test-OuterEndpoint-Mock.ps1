# Pure synthetic Windows tests: replace network cmdlets with fixtures.
# Never connect to a destination, change routing, enable WFP or read VPN keys.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$global:BMFixture='VLESS_OK'
function global:Get-CimInstance {
  [CmdletBinding()]param([string]$ClassName)
  if($global:BMFixture -eq 'NO_PROCESS') { return }
  if($global:BMFixture -eq 'UNTRUSTED_PROCESS') {
    [pscustomobject]@{Name='xray.exe';ExecutablePath='C:\Portable\xray.exe';ProcessId=4200}
    return
  }
  if($global:BMFixture -in @('AWG_OK','STALE_WFP','ONE_WFP')) {
    [pscustomobject]@{Name='AmneziaVPN-service.exe';ExecutablePath='C:\Program Files\AmneziaVPN\AmneziaVPN-service.exe';ProcessId=4200}
    return
  }
  [pscustomobject]@{Name='xray.exe';ExecutablePath='C:\Program Files\AmneziaVPN\xray.exe';ProcessId=4200}
}
function global:Get-NetTCPConnection {
  [CmdletBinding()]param()
  $remote=$(if($global:BMFixture -eq 'PRIVATE_REMOTE'){'10.1.1.1'}else{'9.9.9.9'})
  $ownerPid=$(if($global:BMFixture -eq 'WRONG_OWNER') {4201}else{4200})
  $state=$(if($global:BMFixture -eq 'SYN_SENT'){'SynSent'}else{'Established'})
  [pscustomobject]@{State=$state;OwningProcess=$ownerPid;RemoteAddress=$remote;RemotePort=8443}
  if($global:BMFixture -eq 'AMBIGUOUS') {
    [pscustomobject]@{State='SynSent';OwningProcess=4200;RemoteAddress='1.1.1.1';RemotePort=8443}
  }
}
function global:Find-NetRoute {
  [CmdletBinding()]param([string]$RemoteIPAddress)
  [pscustomobject]@{InterfaceIndex=10;DestinationPrefix='0.0.0.0/0';InterfaceAlias='Ethernet'}
}
function global:Get-NetAdapter {
  [CmdletBinding()]param([switch]$Physical)
  if($global:BMFixture -ne 'NO_ROUTE') {
    [pscustomobject]@{ifIndex=10;Status='Up'}
  }
}
function global:Get-WinEvent {
  [CmdletBinding()]param([hashtable]$FilterHashtable,[int]$MaxEvents)
  if($global:BMFixture -notin @('AWG_OK','STALE_WFP','ONE_WFP')) { throw 'WFP disabled (simulated)' }
  $out=@()
  $amount=$(if($global:BMFixture -eq 'ONE_WFP'){@(1)}else{@(1,2)})
  foreach($i in $amount) {
    $age=$(if($global:BMFixture -eq 'STALE_WFP'){-180}else{-$i})
    $ev=[pscustomobject]@{TimeCreated=(Get-Date).AddSeconds($age)}
    $ev | Add-Member -MemberType ScriptMethod -Name ToXml -Value {
      return '<Event><EventData><Data Name="Protocol">17</Data><Data Name="ProcessID">4200</Data><Data Name="DestAddress">9.9.9.9</Data><Data Name="DestPort">51820</Data></EventData></Event>'
    }
    $out += $ev
  }
  return $out
}
function Assert-BMFixture([string]$Scenario,[string]$Protocol,[string]$Expected) {
  $global:BMFixture=$Scenario
  $raw=@(& (Join-Path $root 'runtime\Scripts\Get-OuterEndpoint.ps1') -Protocol $Protocol)
  if($raw.Count -ne 1) { throw "expected one JSON object: $Scenario" }
  $r=$raw[0] | ConvertFrom-Json
  if($r.status -ne $Expected) { throw "failed $Scenario/${Protocol}: got $($r.status), expected $Expected" }
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

# The native parser never exposes a peer public identifier to the output.
Import-Module (Join-Path $root 'runtime\Scripts\Common.psm1') -Force
$nativeSample=@(
  'Tunnel-A peer-public-identifier 9.9.9.9:51820',
  'Tunnel-B other-public-identifier 1.1.1.1:443',
  'Tunnel-A peer-without-endpoint (none)',
  'Tunnel-A malformed-endpoint 192.0.2.2:0'
)
$native=@(Get-BMAwgEndpointMetadata -Lines $nativeSample -InterfaceName 'Tunnel-A')
if($native.Count -ne 1 -or $native[0].IPv4 -ne '9.9.9.9' -or $native[0].Port -ne 51820) {
  throw 'Native awg CLI endpoint parser failed the isolated peer fixture'
}
if(($native | ConvertTo-Json -Compress) -match 'peer-') {
  throw 'Native awg CLI parser exposed peer identifier'
}
Write-Host 'PASS native AWG endpoint parsing: matching interface, public peer identifier discarded'
