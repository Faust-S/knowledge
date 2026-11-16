# Windows PowerShell 5.1 source smoke. ICMP may be filtered; never require replies.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$raw=& (Join-Path $root 'runtime\Scripts\Get-PathEvidence.ps1')
$report=$raw | ConvertFrom-Json
if(-not $report.checked -or $report.schema_version -ne '0.3.3') { throw 'Missing network latency diagnosis' }
if($null -eq $report.gateway.replied -or $null -eq $report.remote.replied) {throw 'Missing ICMP counters'}
$valid=@('REPLIED','NO_REPLY','UNKNOWN')
if($valid -notcontains [string]$report.df_1200 -or $valid -notcontains [string]$report.df_1400) {throw 'Invalid DF state'}
$rawText=[string]($raw -join '')
foreach($field in @('ssid','mac_address','gateway_ip','provider_name','local_ip')) {
 if($rawText.Contains('"'+$field+'"')) {throw 'Sensitive identity in path report'}
}
Write-Host ('PASS read-only ICMP/DF evidence, gateway replies: '+$report.gateway.replied+', remote replies: '+$report.remote.replied)
