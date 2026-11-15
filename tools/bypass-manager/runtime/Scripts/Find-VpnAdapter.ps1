# A candidate discovery mechanism, never a substitute for data-plane proof.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$candidates=@(Get-NetAdapter -ErrorAction Stop | Where-Object {
    $_.Status -eq 'Up' -and (
      $_.Name -match '(?i)amnezia|wireguard|wintun|awg|tun|tap' -or
      $_.InterfaceDescription -match '(?i)amnezia|wireguard|wintun|awg'
    )
} | Select-Object Name,InterfaceDescription,Status)
ConvertTo-Json -InputObject $candidates -Depth 4 -Compress
