#Requires -Version 5.1
[CmdletBinding()]
param([string]$BundleRoot='', [switch]$WithUpstream)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$runtime=Join-Path $root 'runtime'
$scripts=@((Get-ChildItem -LiteralPath (Join-Path $runtime 'Scripts') -Filter '*.ps1'),(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1')) | ForEach-Object {$_}
foreach ($file in $scripts) {
  $tokens=$null; $errors=$null
  [void][System.Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors)
  if (@($errors).Count -gt 0) {throw "PowerShell parse failed for $($file.Name): $($errors[0])"}
  Write-Host "PASS parsed $($file.Name)"
}
$module=Join-Path $runtime 'Scripts\Common.psm1'
$tokens=$null;$errors=$null
[void][System.Management.Automation.Language.Parser]::ParseFile($module,[ref]$tokens,[ref]$errors)
if (@($errors).Count -gt 0) {throw "Module parse failed: $($errors[0])"}
Write-Host 'PASS parsed Common.psm1'
if ($WithUpstream) {
  if (-not $BundleRoot) {throw 'WithUpstream requires BundleRoot'}
  & (Join-Path $PSScriptRoot 'Test-WinDivertFilter.ps1') -BundleRoot $BundleRoot -EndpointIPv4 '198.51.100.17' -Port 443 -Transport TCP
  & (Join-Path $PSScriptRoot 'Test-WinDivertFilter.ps1') -BundleRoot $BundleRoot -EndpointIPv4 '198.51.100.17' -Port 51820 -Transport UDP
  & (Join-Path $PSScriptRoot 'Test-NativeArgumentQuoting.ps1') -BundleRoot $BundleRoot
  # New one-button direct filter must be parsed by the ORIGINAL winws2 and Lua.
  # Dry-run does not load WinDivert or create a running process.
  $directState=Join-Path $env:TEMP ('bypass-ci-direct-'+[guid]::NewGuid().ToString('N'))
  try {
    & (Join-Path $runtime 'Scripts\Start-Direct.ps1') -Action Start -BundleRoot $BundleRoot -StateFolder $directState -DryRun
    if($LASTEXITCODE -ne 0) {throw 'Direct one-button dry-run failed'}
    if(Test-Path -LiteralPath (Join-Path $directState 'winws2-owned.json')) {throw 'Dry-run accidentally created an owned process state'}
  } finally {
    Remove-Item -LiteralPath $directState -Recurse -Force -ErrorAction SilentlyContinue
  }
  foreach ($item in @(@('TLS-SPLIT','TCP',443),@('TLS-DISORDER','TCP',443),@('TLS-FAKESEQ','TCP',443),@('TLS-FAKETTL','TCP',443),@('UDP-FAKE','UDP',51820),@('UDP-REPEAT','UDP',51820))) {
    & (Join-Path $runtime 'Scripts\Start-Profile.ps1') -Action Start -EndpointIPv4 '198.51.100.17' -Port $item[2] -Transport $item[1] -Profile $item[0] -BundleRoot $BundleRoot -StateFolder (Join-Path $env:TEMP 'bypass-ci-inert') -DryRun
    if ($LASTEXITCODE -ne 0) {throw "Engine dry-run failed: $($item[0])"}
  }
}
Write-Host 'PASS Windows source qualification. No actual packet interception was performed.'
