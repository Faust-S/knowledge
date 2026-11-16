# Starts/stops only the instance it owns. Never creates services or network configuration.
[CmdletBinding()]
param(
  [ValidateSet('Start','Stop','Status')][string]$Action='Status',
  [string]$EndpointIPv4,
  [ValidateRange(1,65535)][int]$Port=443,
  [ValidateSet('TCP','UDP')][string]$Transport='TCP',
  [ValidateSet('TLS-SPLIT','TLS-FAKESEQ','TLS-FAKETTL','TLS-DISORDER','UDP-FAKE','UDP-REPEAT')][string]$Profile='TLS-SPLIT',
  [string]$BundleRoot=(Join-Path $env:LOCALAPPDATA 'BypassManager\engine'),
  [string]$StateFolder=(Join-Path $PSScriptRoot '..\Results\active'),
  [switch]$DryRun
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'Common.psm1') -Force
$stateFolder=[System.IO.Path]::GetFullPath($StateFolder)
$stateFile=Join-Path $stateFolder 'winws2-owned.json'

if ($Action -eq 'Status' -or $Action -eq 'Stop') {
  if (-not (Test-Path -LiteralPath $stateFile -PathType Leaf)) {
    Write-Host 'No lab-owned winws2 process recorded.'
    return
  }
  $saved=Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  $running=Get-Process -Id ([int]$saved.Pid) -ErrorAction SilentlyContinue
  $same=$false
  if ($null -ne $running) {
    try {
      $delta=([datetime]$running.StartTime.ToUniversalTime()-[datetime]$saved.StartTimeUtc).TotalSeconds
      $same=([math]::Abs($delta) -lt 2 -and [string]::Equals([string]$running.Path,[string]$saved.Exe,[StringComparison]::OrdinalIgnoreCase))
    } catch { $same=$false }
  }
  if ($Action -eq 'Status') {
    Write-Host $(if ($same) { "Owned winws2 running; PID $($saved.Pid); profile $($saved.Profile)" } else { 'Owned process not verified; no process will be killed.' })
    return
  }
  if ($DryRun) { Write-Host "DRY RUN stop; verified owned=$same; PID=$($saved.Pid)"; return }
  if ($same) {
    Stop-Process -Id ([int]$saved.Pid) -ErrorAction Stop
    try { Wait-Process -Id ([int]$saved.Pid) -Timeout 7 -ErrorAction SilentlyContinue } catch {}
    Write-Host "Stopped owned PID $($saved.Pid)"
  } elseif ($null -ne $running) {
    throw "PID $($saved.Pid) exists but its identity has changed. Refusing to stop it. Inspect $stateFile manually."
  }
  Remove-Item -LiteralPath $stateFile -Force
  return
}

[void](Assert-IPv4 $EndpointIPv4)
if (($Transport -eq 'UDP') -ne ($Profile -in @('UDP-FAKE','UDP-REPEAT'))) { throw 'UDP requires UDP profile, TCP requires one TLS profile.' }
$root=[System.IO.Path]::GetFullPath($BundleRoot)
$exe=Join-Path $root 'winws2.exe'
$luaLib=Join-Path $root 'lua\zapret-lib.lua'
$luaDpi=Join-Path $root 'lua\zapret-antidpi.lua'
$luaAuto=Join-Path $root 'lua\zapret-auto.lua'
$needed=@($exe,$luaLib,$luaDpi,(Join-Path $root 'WinDivert64.sys'),(Join-Path $root 'cygwin1.dll'))
if ($Profile -eq 'UDP-REPEAT') { $needed += $luaAuto }
foreach($f in $needed) { if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { throw "Missing original bundle component: $f" } }
if (Test-Path -LiteralPath $stateFile) { throw 'Existing lab-owned process state. Stop/reconcile it first.' }
$conflicts=@(Get-Process -Name 'winws2','winws','goodbyedpi','byedpi' -ErrorAction SilentlyContinue)
if ($conflicts.Count -gt 0) { throw ('Existing DPI processes: ' + (($conflicts | Select-Object -ExpandProperty ProcessName) -join ', ')) }

# One canonical builder shared with the independent filter compiler test.
# Prevent accidental drift between the tested and executed rule.
$filter=Get-ExactWinDivertFilter -EndpointIPv4 $EndpointIPv4 -Port $Port -Transport $Transport
if (-not $DryRun) { [void](Assert-ExternalIPv4 -Address $EndpointIPv4) }
$argsList=@("--wf-raw=$filter", "--lua-init=@$luaLib", "--lua-init=@$luaDpi")
if ($Profile -eq 'UDP-REPEAT') { $argsList += "--lua-init=@$luaAuto" }
if ($Transport -eq 'TCP') {
  $argsList+=@("--filter-tcp=$Port",'--filter-l7=tls','--out-range=-d10','--payload=tls_client_hello')
} else {
  $argsList+=@("--filter-udp=$Port",'--out-range=-d2')
}
$profiles=Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\Profiles\profiles.json') -Raw | ConvertFrom-Json
$selected=$profiles.profiles.$Profile
if ($null -eq $selected) { throw 'Unknown profile in manifest.' }
$argsList+=('--lua-desync=' + [string]$selected.desync)
Write-Host "Selected profile: $Profile; outer endpoint: $EndpointIPv4`:$Port/$Transport"
Write-Host "WinDivert exact filter: $filter"
Write-Host "Engine: $exe"
Write-Host ('Arguments: ' + ($argsList -join ' '))
if ($DryRun) {
  Write-Host 'Checking original winws2 option parsing using --dry-run (no WinDivert interception).'
  & $exe --dry-run @argsList
  if ($LASTEXITCODE -ne 0) { throw "winws2 --dry-run returned $LASTEXITCODE. Reject the profile." }
  Write-Host 'Checking original Lua initialization using --intercept=0 (no WinDivert interception).'
  & $exe --intercept=0 @argsList
  if ($LASTEXITCODE -ne 0) { throw "winws2 Lua initialization returned $LASTEXITCODE. Reject the profile." }
  Write-Host 'DRY RUN PASS: winws2 options and Lua initialization. Packet manipulation/operational behaviour NOT tested.'
  return
}
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run an elevated PowerShell to use WinDivert.' }
New-Item -ItemType Directory -Path $stateFolder -Force | Out-Null
$stdout=Join-Path $stateFolder 'winws2.stdout.log'
$stderr=Join-Path $stateFolder 'winws2.stderr.log'
$p=Start-Process -FilePath $exe -WorkingDirectory $root -ArgumentList (Format-NativeArgumentList -Arguments $argsList) -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
Start-Sleep -Milliseconds 1200
$p.Refresh()
if ($p.HasExited) { throw "winws2 exited immediately ($($p.ExitCode)). Check $stderr and $stdout; WinDivert or arguments may be invalid." }
try {
  $saved=[pscustomobject]@{Pid=$p.Id; StartTimeUtc=$p.StartTime.ToUniversalTime().ToString('o'); Exe=$exe; Profile=$Profile; Port=$Port; Transport=$Transport; StartedUtc=(Get-Date).ToUniversalTime().ToString('o')}
  Save-Json -Object $saved -Path $stateFile
} catch {
  Stop-Process -Id $p.Id -ErrorAction SilentlyContinue
  throw
}
Write-Host "Started owned PID $($p.Id); state $stateFile"
