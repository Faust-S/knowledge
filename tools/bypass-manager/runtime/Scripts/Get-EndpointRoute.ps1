[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$IPv4)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
 $r=@(Find-NetRoute -RemoteIPAddress $IPv4 -ErrorAction Stop | Where-Object { $_.InterfaceAlias } | Select-Object -First 1)
 if ($r.Count -eq 0) { return }
 [pscustomobject]@{name=[string]$r[0].InterfaceAlias;index=[int]$r[0].InterfaceIndex;destination=[string]$r[0].DestinationPrefix} | ConvertTo-Json -Compress
} catch {
 # No route evidence, do not fake one.
}
