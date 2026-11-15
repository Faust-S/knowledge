#Requires -Version 5.1
# Does not enable WinDivert or send any VPN packets.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$BundleRoot)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '..\runtime\Scripts\Common.psm1') -Force
$engine=[System.IO.Path]::GetFullPath($BundleRoot)
if (-not (Test-Path -LiteralPath (Join-Path $engine 'winws2.exe') -PathType Leaf)) {throw 'Need pinned upstream winws2'}

# Place original, verified files into a temporary directory containing spaces.
$tempHome=if ($env:RUNNER_TEMP) {$env:RUNNER_TEMP} else {[System.IO.Path]::GetTempPath()}
$folder=Join-Path $tempHome ('bypass engine with spaces-' + [guid]::NewGuid().ToString('N'))
New-Item -Path (Join-Path $folder 'lua') -ItemType Directory -Force | Out-Null
try {
  foreach ($name in @('winws2.exe','cygwin1.dll','WinDivert.dll','WinDivert64.sys','lua/zapret-lib.lua','lua/zapret-antidpi.lua')) {
    $source=Join-Path $engine $name
    $destination=Join-Path $folder $name
    Copy-Item -LiteralPath $source -Destination $destination -ErrorAction Stop
  }
  $exe=Join-Path $folder 'winws2.exe'
  $lib=Join-Path $folder 'lua/zapret-lib.lua'
  $antidpi=Join-Path $folder 'lua/zapret-antidpi.lua'
  $filter=Get-ExactWinDivertFilter -EndpointIPv4 '198.51.100.17' -Port 443 -Transport 'TCP'
  $arguments=@('--intercept=0',"--wf-raw=$filter","--lua-init=@$lib","--lua-init=@$antidpi",'--filter-tcp=443','--filter-l7=tls','--out-range=-d10','--payload=tls_client_hello','--lua-desync=multisplit:pos=1,midsld')
  $line=Format-NativeArgumentList -Arguments $arguments
  if ($line -notmatch '"--lua-init=@[^\"]+bypass engine with spaces-') {throw 'Lua parameter with spaces was not quoted'}
  $stdout=Join-Path $folder 'stdout.log'
  $stderr=Join-Path $folder 'stderr.log'
  $process=Start-Process -FilePath $exe -WorkingDirectory $folder -ArgumentList $line -PassThru -Wait -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  if ($process.ExitCode -ne 0) {
    throw "Native argument quoting failed: code=$($process.ExitCode) stdout=$(Get-Content -LiteralPath $stdout -Raw) stderr=$(Get-Content -LiteralPath $stderr -Raw)"
  }
  $output=Get-Content -LiteralPath $stdout -Raw
  if ($output -notmatch 'LUA v5') {throw "Original Lua was not initialized: $output"}
  Write-Host 'PASS original winws2 invoked via Start-Process in path with spaces, Lua initialized, interception disabled.'
} finally {
  Remove-Item -LiteralPath $folder -Recurse -Force -ErrorAction SilentlyContinue
}
