# Local acceptance only: no administrator privileges, no permanent system changes.
# Trust a short-lived localhost server certificate ONLY after explicit consent.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$node = Join-Path $root 'runtime\node.exe'
$server = Join-Path $root 'serve-acceptance.mjs'
if (!(Test-Path $node) -or !(Test-Path $server)) { throw 'Extract the complete acceptance ZIP first.' }
Write-Host 'IWXA T3 0.3.1-rc.2 - local HTTPS acceptance'
Write-Host 'The site runs only on localhost:18443. No product data is uploaded.'
Write-Host 'A short-lived localhost server certificate will be trusted in your CurrentUser Root store.'
Write-Host 'The launcher removes its own certificate when it exits normally.'
if ((Read-Host 'Type YES to allow this temporary local certificate') -cne 'YES') { Write-Host 'Cancelled.'; exit 0 }
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ('iwxa-t3-local-' + [Guid]::NewGuid().ToString('N'))
$cert = $null
try {
  New-Item -ItemType Directory -Path $temp | Out-Null
  $cert = New-SelfSignedCertificate -DnsName 'localhost' -Type SSLServerAuthentication -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -NotAfter (Get-Date).AddDays(2) -FriendlyName 'IWXA T3 temporary localhost acceptance'
  $password = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
  $secure = ConvertTo-SecureString $password -AsPlainText -Force
  $pfx = Join-Path $temp 'localhost.pfx'
  $cer = Join-Path $temp 'localhost.cer'
  Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $secure | Out-Null
  Export-Certificate -Cert $cert -FilePath $cer | Out-Null
  Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
  if (!(Test-Path ('Cert:\CurrentUser\Root\' + $cert.Thumbprint))) { throw 'Local certificate trust was not granted.' }
  $env:IWXA_ACCEPTANCE_PFX = $pfx
  $env:IWXA_ACCEPTANCE_PFX_PASSWORD = $password
  Write-Host 'Keep this window open. Open https://localhost:18443/workspace/ in the browser on this computer.'
  & $node $server
  if ($LASTEXITCODE -ne 0) { throw ('Host exited with code ' + $LASTEXITCODE) }
} finally {
  Remove-Item Env:\IWXA_ACCEPTANCE_PFX -ErrorAction SilentlyContinue
  Remove-Item Env:\IWXA_ACCEPTANCE_PFX_PASSWORD -ErrorAction SilentlyContinue
  if ($cert) {
    Remove-Item ('Cert:\CurrentUser\Root\' + $cert.Thumbprint) -ErrorAction SilentlyContinue
    Remove-Item ('Cert:\CurrentUser\My\' + $cert.Thumbprint) -ErrorAction SilentlyContinue
  }
  if (Test-Path $temp) { Remove-Item $temp -Recurse -Force }
}
