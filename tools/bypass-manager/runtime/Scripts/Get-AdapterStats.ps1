[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Name)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$a=Get-NetAdapter -Name $Name -ErrorAction Stop
$s=Get-NetAdapterStatistics -Name $a.Name -ErrorAction Stop
[pscustomobject]@{name=[string]$a.Name;status=[string]$a.Status;received_bytes=[long]$s.ReceivedBytes;sent_bytes=[long]$s.SentBytes} | ConvertTo-Json -Compress
