# Passive Windows transport discovery. Never read Amnezia keys, profiles,
# subscription URLs, command lines, logs or secrets. Never change audit settings.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateSet('AMNEZIAWG','VLESS')][string]$Protocol,
      [string]$AdapterName='')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
Import-Module (Join-Path $PSScriptRoot 'Common.psm1') -Force

function BM-PublicIPv4([string]$Value) {
  try { [void](Assert-ExternalIPv4 -Address $Value); return $true } catch { return $false }
}
function BM-PhysicalRoute([string]$Value) {
  try {
    $routes=@(Find-NetRoute -RemoteIPAddress $Value -ErrorAction Stop | Where-Object {
      $null -ne $_.PSObject.Properties['DestinationPrefix'] -and [int]$_.InterfaceIndex -gt 0
    })
    $physical=@(Get-NetAdapter -Physical -ErrorAction Stop)
    foreach($route in $routes) {
      foreach($nic in $physical) {
        if([int]$route.InterfaceIndex -eq [int]$nic.ifIndex -and [string]$nic.Status -eq 'Up') { return $true }
      }
    }
  } catch {}
  return $false
}
function BM-TrustedOwners([string]$Wanted) {
  $owners=@{}
  try {
    foreach($p in @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)) {
      $name=[string]$p.Name
      $exe=[string]$p.ExecutablePath
      if($exe -notmatch '(?i)\\AmneziaVPN(\\|\.ORG\\|-)') { continue }
      if($Wanted -eq 'VLESS') {
        if($name -notmatch '(?i)^(xray|xray-core|amnezia-xray|amneziaxray)\.exe$') { continue }
      } else {
        if($name -notmatch '(?i)^(amneziavpn-service|amneziawg|amneziawg-tunnel|awg|wireguard)\.exe$') { continue }
      }
      $id=[int64]$p.ProcessId
      if($id -gt 0) { $owners[[string]$id]=$true }
    }
  } catch {}
  return $owners
}
function BM-Add([System.Collections.ArrayList]$Out, [string]$IP, [int]$Port, [string]$Source, [int]$Age) {
  if($Port -le 0 -or $Port -gt 65535 -or $Age -lt 0 -or $Age -gt 90) { return }
  if(-not (BM-PublicIPv4 $IP) -or -not (BM-PhysicalRoute $IP)) { return }
  [void]$Out.Add([pscustomobject]@{ip=$IP;port=$Port;source=$Source;age=$Age})
}
function BM-PID([string]$Value) {
  if($Value -notmatch '^(0x[0-9a-fA-F]+|[0-9]+)$') { return '' }
  try {
    $digits=$(if($Value.StartsWith('0x')){$Value.Substring(2)}else{$Value})
    $base=$(if($Value.StartsWith('0x')){16}else{10})
    return [string][convert]::ToInt64($digits,$base)
  } catch { return '' }
}
function BM-EventData($Event) {
  try {
    $xml=[xml]$Event.ToXml()
    $result=@{}
    foreach($node in @($xml.Event.EventData.Data)) {
      $result[[string]$node.Name]=[string]$node.'#text'
    }
    return $result
  } catch { return @{} }
}
function BM-Emit([string]$State, [string]$IP='', [int]$Port=0,
                 [string]$Source='', [int]$Signals=0, [int]$Age=0) {
  [pscustomobject]@{
    schema_version='0.3.5';status=$State;protocol=$Protocol;
    ipv4=$IP;port=$Port;
    transport=$(if($Protocol -eq 'AMNEZIAWG'){'AWG-UDP'}else{'REALITY-TCP'});
    source=$Source;physical_route_confirmed=($State -eq 'OBSERVED');
    matching_signals=$Signals;observation_age_s=$Age
  } | ConvertTo-Json -Compress -Depth 4
}
try {
  $owners=BM-TrustedOwners $Protocol
  if($owners.Count -eq 0 -and $Protocol -eq 'VLESS') { BM-Emit 'NO_TRUSTED_PROCESS'; return }
  $signals=New-Object System.Collections.ArrayList
  if($Protocol -eq 'AMNEZIAWG' -and -not [string]::IsNullOrWhiteSpace($AdapterName)) {
    # Optional native interface query for the official standalone AWG client.
    # The command exposes public peer identifiers, but they are discarded in
    # memory; no private configuration or keys are read and no raw log saved.
    $roots=@([Environment]::GetFolderPath('ProgramFiles'),
             [Environment]::GetFolderPath('ProgramFilesX86'))
    foreach($root in $roots) {
      if([string]::IsNullOrWhiteSpace($root)) { continue }
      foreach($dir in @('AmneziaWG','AmneziaVPN')) {
        $exe=Join-Path (Join-Path $root $dir) 'awg.exe'
        if(-not (Test-Path -LiteralPath $exe -PathType Leaf)) { continue }
        try {
          $lines=@(& $exe show all endpoints 2>$null)
          if($LASTEXITCODE -ne 0) { continue }
          $peers=@(Get-BMAwgEndpointMetadata -Lines $lines -InterfaceName $AdapterName)
          foreach($peer in $peers) {
            BM-Add $signals ([string]$peer.IPv4) ([int]$peer.Port) 'AWG_NATIVE' 0
          }
        } catch {}
      }
    }
  }
  if($Protocol -eq 'VLESS') {
    # Two passive snapshots are required. Server port is not assumed to be 443.
    for($i=0;$i -lt 2;$i++) {
      try {
        $connections=@(Get-NetTCPConnection -ErrorAction Stop | Where-Object { $_.State -in @('Established','SynSent') })
        foreach($c in $connections) {
          if(-not $owners.ContainsKey([string]([int64]$c.OwningProcess))) { continue }
          BM-Add $signals ([string]$c.RemoteAddress) ([int]$c.RemotePort) 'XRAY_TCP' 0
        }
      } catch {}
      if($i -eq 0) { Start-Sleep -Milliseconds 350 }
    }
  }
  # WFP Security Event 5156: passive, best-effort, only if auditing already on.
  # Never enable auditpol, start ETW capture, or record raw events.
  try {
    $wanted=$(if($Protocol -eq 'AMNEZIAWG'){'17'}else{'6'})
    $since=(Get-Date).AddSeconds(-90)
    $events=@(Get-WinEvent -FilterHashtable @{LogName='Security';Id=5156;StartTime=$since} -MaxEvents 400 -ErrorAction Stop)
    foreach($event in $events) {
      $d=BM-EventData $event
      if($d['Protocol'] -ne $wanted) { continue }
      $id=BM-PID ([string]$d['ProcessID'])
      if(-not $owners.ContainsKey($id)) { continue }
      $port=0
      if(-not [int]::TryParse([string]$d['DestPort'],[ref]$port)) { continue }
      $age=[int][math]::Max(0,(New-TimeSpan -Start $event.TimeCreated -End (Get-Date)).TotalSeconds)
      BM-Add $signals ([string]$d['DestAddress']) $port $(if($Protocol -eq 'AMNEZIAWG'){'WFP_UDP'}else{'WFP_TCP'}) $age
    }
  } catch {}
  if($signals.Count -eq 0) {
    BM-Emit $(if($owners.Count -eq 0){'NO_TRUSTED_PROCESS'}else{'NO_OUTER_TRANSPORT'})
    return
  }
  $groups=@($signals | Group-Object -Property { $_.ip + ':' + [string]$_.port })
  if($groups.Count -ne 1) { BM-Emit 'AMBIGUOUS'; return }
  $observed=@($groups[0].Group)
  if($observed.Count -lt 2 -and @($observed | Where-Object {$_.source -eq 'AWG_NATIVE'}).Count -eq 0) {
    BM-Emit 'INSUFFICIENT_SIGNALS'; return
  }
  $youngest=[int](($observed | Sort-Object age | Select-Object -First 1).age)
  $source=$(if(@($observed | Where-Object {$_.source -eq 'AWG_NATIVE'}).Count -gt 0){'AWG_NATIVE'}elseif(@($observed | Where-Object {$_.source -eq 'XRAY_TCP'}).Count -ge 2){'XRAY_TCP'}else{[string]$observed[0].source})
  BM-Emit 'OBSERVED' ([string]$observed[0].ip) ([int]$observed[0].port) $source $observed.Count $youngest
} catch {
  BM-Emit 'PROBE_ERROR'
}
