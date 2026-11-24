# Package a local Windows Tauri executable using the independent IWXA Setup Core.
# Setup Core is supplied as a separately pinned public Center checkout.
[CmdletBinding()]
param(
    [string]$SetupCoreRoot = 'setup-core-source',
    [string]$Output = 'artifacts/IWXA-Activity-0.4.0-dev.1-Setup.exe',
    [switch]$InstallForQualification
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$expectedSetupCore = '24d6a0d898e18fef29012735e0ff59da0d3ee182'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$core = if ([IO.Path]::IsPathRooted($SetupCoreRoot)) { [IO.Path]::GetFullPath($SetupCoreRoot) } else {
    [IO.Path]::GetFullPath((Join-Path $root $SetupCoreRoot))
}
$outputPath = if ([IO.Path]::IsPathRooted($Output)) { [IO.Path]::GetFullPath($Output) } else {
    [IO.Path]::GetFullPath((Join-Path $root $Output))
}
$setupHead = (& git -C $core rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $setupHead -ne $expectedSetupCore) { throw 'IWXA_SETUP_CORE_PIN_MISMATCH' }
$profile = Join-Path $PSScriptRoot 'product.json'
$build = Join-Path $core 'installer/build_bundle.py'
$stubBuilder = Join-Path $core 'installer/windows/build-stub.ps1'
$icon = Join-Path $root 'desktop/src-tauri/icons/icon.ico'
$exe = Join-Path $root 'desktop/src-tauri/target/release/iwxa-activity-base-desktop.exe'
$conf = Join-Path $root 'desktop/src-tauri/tauri.conf.json'
# Build the already existing React Host surface as inert distributable files.
# No Control keys, D2 records or signed native provider enter this payload.
$hostDir = Join-Path $root 'desktop/dist-host-surface'
$hostFiles = @('iwxa-activity-host-surface.js','iwxa-activity-host-surface.css','brand.svg')
if (!(Test-Path -LiteralPath $hostDir -PathType Container)) { throw 'IWXA_ACTIVITY_HOST_SURFACE_BUILD_MISSING' }
$found = @(Get-ChildItem -LiteralPath $hostDir -File -Recurse | ForEach-Object {
    $_.FullName.Substring($hostDir.Length + 1).Replace([IO.Path]::DirectorySeparatorChar, '/')
})
if ($found.Count -ne $hostFiles.Count -or
    @($found | Where-Object { $hostFiles -cnotcontains $_ }).Count -gt 0) {
    throw 'IWXA_ACTIVITY_HOST_SURFACE_OUTPUT_UNEXPECTED'
}
foreach ($asset in $hostFiles) {
    $file = Join-Path $hostDir $asset
    if (!(Test-Path -LiteralPath $file -PathType Leaf) -or
        (Get-Item -LiteralPath $file).Length -eq 0) {
        throw 'IWXA_ACTIVITY_HOST_SURFACE_ASSET_MISSING'
    }
}
foreach ($file in @($profile,$build,$stubBuilder,$icon,$exe,$conf)) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "IWXA_ACTIVITY_SETUP_INPUT_MISSING $file" }
}
$product = Get-Content -LiteralPath $profile -Raw | ConvertFrom-Json
$tauri = Get-Content -LiteralPath $conf -Raw | ConvertFrom-Json
if ($product.id -ne 'iwxa.activity-base' -or $product.data_namespace -ne $tauri.identifier -or
    $product.version -ne $tauri.version -or $product.entrypoint -ne 'iwxa-activity-base-desktop.exe' -or
    $product.architecture -ne 'windows-x64' -or $product.install_dir -ne 'IWXA Activity') {
    throw 'IWXA_ACTIVITY_SETUP_IDENTITY_MISMATCH'
}
$head = (& git -C $root rev-parse HEAD).Trim()
$tree = (& git -C $root rev-parse 'HEAD^{tree}').Trim()
if ($head -notmatch '^[0-9a-f]{40}$' -or $tree -notmatch '^[0-9a-f]{40}$') { throw 'SOURCE_REVISION_MISSING' }
$tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$temporary = Join-Path $tempRoot ('iwxa-activity-setup-' + [Guid]::NewGuid().ToString('N'))
$payload = Join-Path $temporary 'payload'
New-Item -ItemType Directory -Path $payload -Force | Out-Null
try {
    Copy-Item -LiteralPath $exe -Destination (Join-Path $payload $product.entrypoint)
    # The EXISTING Setup Core package manifest hashes and owns all three
    # files. Install them alongside the standalone executable, not as a
    # separate T3 app/Host or a writable credential directory.
    $hostPayload = Join-Path $payload 'host-surface'
    New-Item -ItemType Directory -Path $hostPayload -Force | Out-Null
    foreach ($asset in $hostFiles) {
        Copy-Item -LiteralPath (Join-Path $hostDir $asset) -Destination (Join-Path $hostPayload $asset)
    }
    $stub = Join-Path $temporary 'setup-core.exe'
    & $stubBuilder -Output $stub -Icon $icon
    if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $stub -PathType Leaf)) { throw 'SETUP_CORE_STUB_BUILD_FAILED' }
    New-Item -ItemType Directory -Path (Split-Path -Parent $outputPath) -Force | Out-Null
    $result = & python $build build-resource --product $profile --payload $payload --stub $stub `
        --output $outputPath --source-commit $head --source-tree $tree
    if ($LASTEXITCODE -ne 0) { throw 'SETUP_CORE_PACKAGE_BUILD_FAILED' }
    $receipt = ($result | Out-String) | ConvertFrom-Json
    if ($receipt.status -ne 'VERIFIED' -or $receipt.format -ne 'PE_RESOURCE_V2' -or
        $receipt.product -ne $product.id -or $receipt.version -ne $product.version -or
        $receipt.source.commit -ne $head -or $receipt.source.tree -ne $tree) {
        throw 'SETUP_CORE_PACKAGE_RECEIPT_INVALID'
    }
    function ReadNative([string]$arg, [string]$path) {
        $native = Start-Process -FilePath $outputPath -ArgumentList ('{0} "{1}"' -f $arg,$path) -PassThru
        try {
            if (!$native.WaitForExit(90000)) { Stop-Process -Id $native.Id -Force -ErrorAction SilentlyContinue; throw 'SETUP_CORE_TIMEOUT' }
            if ($native.ExitCode -ne 0) { throw "SETUP_CORE_EXIT $($native.ExitCode)" }
        } finally { $native.Dispose() }
        if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw 'SETUP_CORE_RECEIPT_MISSING' }
        return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    }
    $inspect = ReadNative '--inspect-file' (Join-Path $temporary 'inspect.json')
    if ($inspect.status -ne 'VERIFIED' -or $inspect.packageFormat -ne 'PE_RESOURCE_V2' -or
        $inspect.product -ne $product.id -or $inspect.sourceCommit -ne $head) {
        throw 'SETUP_CORE_NATIVE_INSPECT_FAILED'
    }
    $staged = ReadNative '--stage-test-file' (Join-Path $temporary 'staged.json')
    if ($staged.status -ne 'STAGED_VERIFIED' -or $staged.product -ne $product.id) {
        throw 'SETUP_CORE_NATIVE_STAGE_FAILED'
    }
    $sha = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText($outputPath + '.sha256', "$sha *$([IO.Path]::GetFileName($outputPath))" + [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false))
    Write-Host "IWXA_ACTIVITY_SETUP_CORE_PASS product=$($product.id) source=$head setupCore=$setupHead SHA256=$sha"
    if ($InstallForQualification) {
        $preflight = ReadNative '--preflight-file' (Join-Path $temporary 'preflight.json')
        if ($preflight.status -ne 'READY_FOR_FIRST_INSTALL') { throw "CLEAN_INSTALL_HOST_REQUIRED $($preflight.status)" }
        $installed = ReadNative '--install-file' (Join-Path $temporary 'installed.json')
        if ($installed.status -ne 'INSTALLED_NOT_LAUNCHED' -or $installed.product -ne $product.id) { throw 'INSTALL_RECEIPT_INVALID' }
        $verified = ReadNative '--verify-installed-file' (Join-Path $temporary 'verified.json')
        if ($verified.status -ne 'OWNED_FILES_VERIFIED' -or $verified.product -ne $product.id) { throw 'INSTALLED_FILES_INVALID' }
        $locations = ReadNative '--locations-file' (Join-Path $temporary 'locations.json')
        $installedExe = Join-Path $locations.programRoot $product.entrypoint
        if ($locations.status -ne 'LOCATIONS_VERIFIED' -or !(Test-Path -LiteralPath $installedExe -PathType Leaf)) {
            throw 'INSTALLED_EXECUTABLE_UNAVAILABLE'
        }
        foreach ($asset in $hostFiles) {
            $original = Join-Path $hostDir $asset
            $installedAsset = Join-Path (Join-Path $locations.programRoot 'host-surface') $asset
            if (!(Test-Path -LiteralPath $installedAsset -PathType Leaf) -or
                (Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash -ne
                (Get-FileHash -LiteralPath $installedAsset -Algorithm SHA256).Hash) {
                throw 'IWXA_ACTIVITY_INSTALLED_HOST_SURFACE_INTEGRITY_FAILED'
            }
        }
        Write-Host "IWXA_ACTIVITY_INSTALLED_HOST_SURFACE_PASS files=$($hostFiles.Count) signedOwner=NOT_CONNECTED"
        Write-Host "IWXA_ACTIVITY_NATIVE_INSTALL_PASS exe=$installedExe"
    }
} finally {
    Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
}