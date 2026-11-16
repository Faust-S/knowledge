$ErrorActionPreference='Stop'
$path=Join-Path $PSScriptRoot '..\runtime\Scripts\Temporary-MTU.ps1'
$before = @(Get-NetIPInterface -AddressFamily IPv4 -ErrorAction Stop | Select-Object -Property InterfaceIndex, NlMtu | ConvertTo-Json -Compress)
$self = & $path -Mode SelfTest | ConvertFrom-Json
if ($self.status -ne 'SELF_TEST_PASS' -or $self.before_mtu -ne 1500 -or $self.after_mtu -ne 1420) { throw 'MTU self test failed' }
$preview = & $path -Mode Preview | ConvertFrom-Json
if ($preview.status -notin @('TRIAL_AVAILABLE','NO_UNAMBIGUOUS_PHYSICAL_INTERFACE','PREVIEW_UNAVAILABLE','PENDING_ROLLBACK')) { throw 'Unexpected preview' }
$after = @(Get-NetIPInterface -AddressFamily IPv4 -ErrorAction Stop | Select-Object -Property InterfaceIndex, NlMtu | ConvertTo-Json -Compress)
if ([string]$before -ne [string]$after) { throw 'Read-only preview changed interface MTU' }
Write-Host 'PASS temporary MTU self-test and preview; no interface configuration changed'
