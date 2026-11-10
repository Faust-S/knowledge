[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ToolchainRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$NodeVersion = 'v24.18.1'
$NpmVersion = '11.16.0'
$NodeArchiveName = 'node-v24.18.1-win-x64.zip'
$NodeArchiveSha256 = 'ec56b84a7551893ab2324ebdfdc4ab974a63b4781162600b68a1293cc3e53765'
$NodeArchiveUrl = 'https://nodejs.org/dist/v24.18.1/node-v24.18.1-win-x64.zip'
$NodeFolderName = 'node-v24.18.1-win-x64'
$NpmIntegrity = 'sha512-A74XL8OxmcegZDMWPkWb5bEQppg8HdYwW3rBD2sPoS4UQHVajfaxBkqyzLeJ3wR0kZ+5xoTjItxXaF7eIXUsyw=='

function Fail([string]$Code, [string]$Message) {
  throw ($Code + ':' + $Message)
}

if ($PSVersionTable.PSEdition -eq 'Core' -and -not $IsWindows) {
  Fail 'FACTORY2_EXACT_TOOLCHAIN_WINDOWS_REQUIRED' 'This bootstrap is for Windows only.'
}
if ([Environment]::Is64BitOperatingSystem -ne $true) {
  Fail 'FACTORY2_EXACT_TOOLCHAIN_X64_REQUIRED' 'A 64-bit Windows host is required.'
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CanonicalSourceRoot = Split-Path -Parent $ScriptDir
$WorktreeRoot = (& git -C $CanonicalSourceRoot rev-parse --show-toplevel).Trim()
if (-not $WorktreeRoot) {
  Fail 'FACTORY2_EXACT_TOOLCHAIN_GIT_ROOT_MISSING' 'Unable to resolve git worktree root.'
}

$WorktreeFull = [IO.Path]::GetFullPath($WorktreeRoot).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
$ToolchainFull = [IO.Path]::GetFullPath($ToolchainRoot).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
$WorktreePrefix = $WorktreeFull + [IO.Path]::DirectorySeparatorChar
if ($ToolchainFull.Equals($WorktreeFull, [StringComparison]::OrdinalIgnoreCase) -or
    $ToolchainFull.StartsWith($WorktreePrefix, [StringComparison]::OrdinalIgnoreCase)) {
  Fail 'FACTORY2_EXACT_TOOLCHAIN_INSIDE_WORKTREE_FORBIDDEN' $ToolchainFull
}

New-Item -ItemType Directory -Force -Path $ToolchainFull | Out-Null
$ArchivePath = Join-Path $ToolchainFull $NodeArchiveName
$TempArchivePath = $ArchivePath + '.download'
$NodeHome = Join-Path $ToolchainFull $NodeFolderName
$NodeExe = Join-Path $NodeHome 'node.exe'
$NpmCmd = Join-Path $NodeHome 'npm.cmd'
$ReceiptPath = Join-Path $ToolchainFull 'FACTORY2_EXACT_WINDOWS_TOOLCHAIN_RECEIPT.json'
$ActivatePath = Join-Path $ToolchainFull 'activate-factory2-toolchain.ps1'

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

$ArchiveVerified = $false
if (Test-Path -LiteralPath $ArchivePath -PathType Leaf) {
  $ArchiveVerified = ((Get-Sha256 $ArchivePath) -eq $NodeArchiveSha256)
}
if (-not $ArchiveVerified) {
  if (Test-Path -LiteralPath $TempArchivePath) {
    Remove-Item -LiteralPath $TempArchivePath -Force
  }
  Invoke-WebRequest -Uri $NodeArchiveUrl -OutFile $TempArchivePath
  $DownloadedSha256 = Get-Sha256 $TempArchivePath
  if ($DownloadedSha256 -ne $NodeArchiveSha256) {
    Remove-Item -LiteralPath $TempArchivePath -Force -ErrorAction SilentlyContinue
    Fail 'FACTORY2_EXACT_TOOLCHAIN_NODE_ARCHIVE_SHA256_MISMATCH' $DownloadedSha256
  }
  Move-Item -LiteralPath $TempArchivePath -Destination $ArchivePath -Force
}

if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) {
  if (Test-Path -LiteralPath $NodeHome) {
    Remove-Item -LiteralPath $NodeHome -Recurse -Force
  }
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $ToolchainFull -Force
}

if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) {
  Fail 'FACTORY2_EXACT_TOOLCHAIN_NODE_EXE_MISSING' $NodeExe
}
if (-not (Test-Path -LiteralPath $NpmCmd -PathType Leaf)) {
  Fail 'FACTORY2_EXACT_TOOLCHAIN_BUNDLED_NPM_MISSING' $NpmCmd
}

$ActualNodeVersion = (& $NodeExe --version).Trim()
if ($ActualNodeVersion -ne $NodeVersion) {
  Fail 'FACTORY2_EXACT_TOOLCHAIN_NODE_VERSION_MISMATCH' $ActualNodeVersion
}

$BundledNpmVersion = (& $NpmCmd --version).Trim()
$NpmAdjusted = $false
if ($BundledNpmVersion -ne $NpmVersion) {
  $ObservedIntegrity = (& $NpmCmd view ("npm@" + $NpmVersion) dist.integrity).Trim()
  if ($ObservedIntegrity -ne $NpmIntegrity) {
    Fail 'FACTORY2_EXACT_TOOLCHAIN_NPM_REGISTRY_INTEGRITY_MISMATCH' $ObservedIntegrity
  }
  & $NpmCmd install --global ("npm@" + $NpmVersion) --prefix $NodeHome --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) {
    Fail 'FACTORY2_EXACT_TOOLCHAIN_NPM_INSTALL_FAILED' ([string]$LASTEXITCODE)
  }
  $NpmAdjusted = $true
}

$ActualNpmVersion = (& $NpmCmd --version).Trim()
if ($ActualNpmVersion -ne $NpmVersion) {
  Fail 'FACTORY2_EXACT_TOOLCHAIN_NPM_VERSION_MISMATCH' $ActualNpmVersion
}

$EscapedNodeHome = $NodeHome.Replace("'", "''")
$ActivationLines = @(
  ('$env:PATH = ''' + $EscapedNodeHome + ';'' + $env:PATH'),
  ("if ((node --version).Trim() -ne '" + $NodeVersion + "') { throw 'FACTORY2_EXACT_TOOLCHAIN_ACTIVATION_NODE_MISMATCH' }"),
  ("if ((npm --version).Trim() -ne '" + $NpmVersion + "') { throw 'FACTORY2_EXACT_TOOLCHAIN_ACTIVATION_NPM_MISMATCH' }"),
  ("Write-Host 'Factory 2 exact toolchain active: Node " + $NodeVersion + " / npm " + $NpmVersion + "'")
)
Set-Content -LiteralPath $ActivatePath -Value $ActivationLines -Encoding UTF8

$Receipt = [ordered]@{
  schema = 'IWXA_T2_FACTORY2_EXACT_WINDOWS_TOOLCHAIN_RECEIPT_V1'
  status = 'PASS'
  platform = 'win32'
  arch = 'x64'
  nodeVersion = $ActualNodeVersion
  npmVersion = $ActualNpmVersion
  bundledNpmVersion = $BundledNpmVersion
  npmAdjustedInsidePortableToolchain = $NpmAdjusted
  npmRegistryIntegrity = $NpmIntegrity
  nodeArchive = [ordered]@{
    file = $NodeArchiveName
    source = $NodeArchiveUrl
    sha256 = $NodeArchiveSha256
    verified = $true
  }
  nodeHome = $NodeHome
  activationScript = $ActivatePath
  worktreeRoot = $WorktreeFull
  toolchainOutsideWorktree = $true
  systemToolchainModified = $false
  githubActions = $false
  productionActivation = $false
}
$Receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReceiptPath -Encoding UTF8
$Receipt | ConvertTo-Json -Depth 8
