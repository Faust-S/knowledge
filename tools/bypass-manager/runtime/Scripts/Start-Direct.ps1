# Native first-step Windows DPI adaptation without VPN or a remote server.
# Reuses the exact owned-process identity and stop mechanism from Start-Profile.ps1.
[CmdletBinding()]
param(
    [ValidateSet('Start','Status')][string]$Action='Status',
    [string]$BundleRoot=(Join-Path $env:LOCALAPPDATA 'BypassManager\engine'),
    [string]$StateFolder=(Join-Path $env:LOCALAPPDATA 'BypassManager\active'),
    [switch]$DryRun
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
Import-Module (Join-Path $PSScriptRoot 'Common.psm1') -Force
$stateFolder=[System.IO.Path]::GetFullPath($StateFolder)
$stateFile=Join-Path $stateFolder 'winws2-owned.json'

if($Action -eq 'Status') {
    if(-not (Test-Path -LiteralPath $stateFile -PathType Leaf)) {
        [pscustomobject]@{schema_version='1.0';state='OFF';mode='NONE'} | ConvertTo-Json -Compress
        return
    }
    try {
        $saved=Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
        $running=Get-Process -Id ([int]$saved.Pid) -ErrorAction SilentlyContinue
        $same=$false
        if($null -ne $running) {
            $delta=([datetime]$running.StartTime.ToUniversalTime()-[datetime]$saved.StartTimeUtc).TotalSeconds
            $same=([math]::Abs($delta) -lt 2 -and [string]::Equals([string]$running.Path,[string]$saved.Exe,[StringComparison]::OrdinalIgnoreCase))
        }
        $direct=[string]$saved.Profile -eq 'DIRECT-AUTO-TLS'
        $state=$(if($same -and $direct){'RUNNING'}elseif($same){'OTHER_OWNED_PROFILE'}else{'STALE_OR_UNVERIFIED'})
        [pscustomobject]@{schema_version='1.0';state=$state;mode=$(if($direct){'DIRECT_AUTO_TLS'}else{'OTHER'})} | ConvertTo-Json -Compress
    } catch {
        [pscustomobject]@{schema_version='1.0';state='STALE_OR_UNVERIFIED';mode='UNKNOWN'} | ConvertTo-Json -Compress
    }
    return
}

if(Test-Path -LiteralPath $stateFile) { throw 'Owned process state exists. Stop or reconcile it first.' }
$root=[System.IO.Path]::GetFullPath($BundleRoot)
$exe=Join-Path $root 'winws2.exe'
$luaLib=Join-Path $root 'lua\zapret-lib.lua'
$luaDpi=Join-Path $root 'lua\zapret-antidpi.lua'
foreach($p in @($exe,$luaLib,$luaDpi,(Join-Path $root 'WinDivert64.sys'),(Join-Path $root 'WinDivert.dll'),(Join-Path $root 'cygwin1.dll'))) {
    if(-not (Test-Path -LiteralPath $p -PathType Leaf)) {throw 'Pinned native engine component missing'}
}
$conflicts=@(Get-Process -Name 'winws2','winws','goodbyedpi','byedpi' -ErrorAction SilentlyContinue)
if($conflicts.Count -gt 0) {throw 'Another DPI process is running; cannot safely activate this engine.'}
# Automatically learned domains stay ONLY in the private per-user working area.
# No external VPN endpoint, private keys or browser settings are required.
$hosts=Join-Path $stateFolder 'direct-auto-hosts.txt'
New-Item -ItemType Directory -Path $stateFolder -Force | Out-Null
if(-not (Test-Path -LiteralPath $hosts -PathType Leaf)) {
    [System.IO.File]::WriteAllText($hosts,'',[System.Text.UTF8Encoding]::new($false))
}
# The original auto-hostlist evaluates BOTH client requests and server replies.
# The earlier filter omitted inbound TLS payload and could misclassify live
# connections as failed. Capture TCP/443 response payload plus SYN/FIN/RST;
# no UDP, other ports, or user-level payload logs are enabled.
$raw='((outbound&&tcp.DstPort==443&&(tcp.PayloadLength>0||tcp.Syn||tcp.Fin||tcp.Rst))||(inbound&&tcp.SrcPort==443&&(tcp.PayloadLength>0||tcp.Syn||tcp.Fin||tcp.Rst)))'
$argsList=@(
    "--wf-raw=$raw",
    "--lua-init=@$luaLib",
    "--lua-init=@$luaDpi",
    '--filter-tcp=443',
    '--filter-l7=tls',
    "--hostlist-auto=$hosts",
    '--hostlist-auto-fail-threshold=3',
    '--hostlist-auto-fail-time=120',
    '--hostlist-auto-retrans-threshold=3',
    '--out-range=-d10',
    '--payload=tls_client_hello',
    '--lua-desync=multisplit:pos=1,midsld'
)
if($DryRun) {
    & $exe --dry-run @argsList
    if($LASTEXITCODE -ne 0) {throw "Direct winws2 option parser rejected the recipe: $LASTEXITCODE"}
    & $exe --intercept=0 @argsList
    if($LASTEXITCODE -ne 0) {throw "Direct Lua initialization rejected the recipe: $LASTEXITCODE"}
    Write-Host 'DIRECT_DRY_RUN_PASS: original winws2 and Lua accepted the no-VPN recipe; no packets captured.'
    return
}
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'WinDivert requires Windows Administrator (UAC).'
}
$stdout=Join-Path $stateFolder 'direct-winws2.stdout.log'
$stderr=Join-Path $stateFolder 'direct-winws2.stderr.log'
$p=Start-Process -FilePath $exe -WorkingDirectory $root -ArgumentList (Format-NativeArgumentList -Arguments $argsList) -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
try {
    # Record ownership immediately, before the startup delay. A crashing CLI can
    # then reconcile only its own PID and never kill unrelated processes.
    $saved=[pscustomobject]@{Pid=$p.Id;StartTimeUtc=$p.StartTime.ToUniversalTime().ToString('o');Exe=$exe;Profile='DIRECT-AUTO-TLS';Mode='DIRECT_AUTO_TLS';StartedUtc=(Get-Date).ToUniversalTime().ToString('o')}
    Save-Json -Object $saved -Path $stateFile
    Start-Sleep -Milliseconds 950
    $p.Refresh()
    if($p.HasExited) {throw "Direct winws2 stopped on startup ($($p.ExitCode)); driver/recipe may be unavailable"}
} catch {
    try {if(-not $p.HasExited) {Stop-Process -Id $p.Id -ErrorAction SilentlyContinue}} catch {}
    Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
    throw
}
Write-Host 'DIRECT_STARTED: owned native TLS adaptation process is running; successful bypass NOT verified.'
