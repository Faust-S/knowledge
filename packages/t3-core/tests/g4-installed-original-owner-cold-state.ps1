# Public G4 Windows witness. Independently reopen the INSTALLED original
# signed D3 owner only after native Center has fully exited. Never print
# private paths, draft contents, account IDs, signatures or raw stderr.
param([Parameter(Mandatory=$true)][string]$InstallRoot)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
function Check([bool]$condition,[string]$code){
  if(-not $condition){throw $code}
}
try{
  $config=Get-ItemProperty -LiteralPath 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.admin-center' -ErrorAction Stop
  $dataRoot=if($config.PSObject.Properties.Name -contains 'DataLocation'){
    [string]$config.DataLocation
  }else{
    Join-Path $env:LOCALAPPDATA 'ru.iwxa.admin-center'
  }
}catch{throw 'G4_INSTALLED_COLD_SETUP_CORE_ROOT_UNAVAILABLE'}
Check ($dataRoot -and (Test-Path -LiteralPath $dataRoot -PathType Container)) 'G4_INSTALLED_COLD_DATA_ROOT_UNAVAILABLE'
$draftFile=Join-Path $dataRoot 'atlas-store-v1/preparation/draft.json'
Check (Test-Path -LiteralPath $draftFile -PathType Leaf) 'G4_INSTALLED_COLD_MANAGER_DRAFT_MISSING'
try{
  $draft=Get-Content -LiteralPath $draftFile -Raw -ErrorAction Stop |
    ConvertFrom-Json -AsHashtable -ErrorAction Stop
}catch{throw 'G4_INSTALLED_COLD_MANAGER_DRAFT_INVALID'}
Check ($draft.format -ceq 'iwxa.admin-center.draft' -and $draft.version -eq 1) 'G4_INSTALLED_COLD_MANAGER_DRAFT_SCHEMA_INVALID'
$organizationId=[string]$draft.activeOrganizationId
Check ($organizationId -cmatch '^[A-Za-z0-9_-]{1,100}$') 'G4_INSTALLED_COLD_ORGANIZATION_SCOPE_INVALID'
$matches=@($draft.organizations|Where-Object {$_.id -ceq $organizationId})
Check ($matches.Count -eq 1) 'G4_INSTALLED_COLD_ORGANIZATION_SELECTION_NOT_DURABLE'
Check ($matches[0].name -ceq 'G4WindowsOrganization') 'G4_INSTALLED_COLD_ORGANIZATION_NAME_CHANGED'
Check ($matches[0].kind -ceq 'ORGANIZATION') 'G4_INSTALLED_COLD_ORGANIZATION_KIND_INVALID'
Write-Host 'G4_INSTALLED_COLD_CORPORATE_ORGANIZATION_KIND_PASS'
$workspaces=@($matches[0].workspaces|Where-Object {$_.name -ceq 'G4CorporateWorkspace'})
Check ($workspaces.Count -eq 1) 'G4_INSTALLED_COLD_WORKSPACE_SELECTION_NOT_DURABLE'
$workspaceId=[string]$workspaces[0].id
Check ($workspaceId -cmatch '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$') 'G4_INSTALLED_COLD_WORKSPACE_ID_INVALID'
Write-Host 'G4_INSTALLED_COLD_MANAGER_DRAFT_INDEPENDENT_DISK_READBACK_PASS'
$originalExe=Join-Path $InstallRoot 't3/iwxa-t3-product-owner.exe'
Check (Test-Path -LiteralPath $originalExe -PathType Leaf) 'G4_INSTALLED_COLD_ORIGINAL_EXECUTABLE_MISSING'
$scope=Join-Path $dataRoot ('t3-admin/organizations/'+$organizationId)
$required=@('registry.json','identity.json','vault.json','operators.json','master-secret.dpapi.json')
$present=@($required|Where-Object {Test-Path -LiteralPath (Join-Path $scope $_) -PathType Leaf})
Write-Host "G4_INSTALLED_COLD_OWNER_REQUIRED_FILE_COUNT $($present.Count)"
Check ($present.Count -eq $required.Count) 'G4_INSTALLED_COLD_SIGNED_OWNER_PROVISION_NOT_DURABLE'
$errPath=Join-Path $env:TEMP ('g4-d3-original-cold-'+[guid]::NewGuid().ToString('N')+'.txt')
try{
  # True separate process; no Tauri IPC, no test credentials or synthetic Host.
  # Original owner verifies exact OS-bound DPAPI vault and signed registry.
  $nativeOut=@(& $originalExe 'd3-state' $scope $organizationId 2>$errPath)
  $exitCode=$LASTEXITCODE
  if($exitCode -ne 0){
    foreach($line in @(Get-Content -LiteralPath $errPath -ErrorAction SilentlyContinue)){
      $code=([string]$line).Trim()
      if($code -cmatch '^(T3_D3|INTEROP|WINDOWS|DPAPI|T3_PRODUCT|CEN_D3)_[A-Z0-9_]{4,90}$'){
        Write-Host "G4_INSTALLED_COLD_ORIGINAL_OWNER_ERROR_CODE $code"
      }
    }
    throw 'G4_INSTALLED_COLD_ORIGINAL_OWNER_NATIVE_STATE_FAILED'
  }
  Check ($nativeOut.Count -eq 1) 'G4_INSTALLED_COLD_ORIGINAL_OWNER_JSON_LINE_COUNT_INVALID'
  try{
    $state=[string]$nativeOut[0]|ConvertFrom-Json -AsHashtable -ErrorAction Stop
  }catch{throw 'G4_INSTALLED_COLD_ORIGINAL_OWNER_JSON_INVALID'}
  Check ($state.schema -ceq 'IWXA_T3_ADMIN_D3_NATIVE/1' -and
    $state.operation -ceq 'D3_STATE' -and
    $state.ownerMode -ceq 'ORIGINAL_SIGNED_CORPORATE_D3' -and
    $state.organizationId -ceq $organizationId -and
    $state.productionActivation -eq $false -and
    $state.view.status -ceq 'D3_OWNER_READY' -and
    $state.view.snapshot.organizationId -ceq $organizationId -and
    $state.view.snapshot.workspaceId -ceq $workspaceId) 'G4_INSTALLED_COLD_ORIGINAL_OWNER_STATE_NOT_VERIFIED'
  Write-Host 'G4_INSTALLED_COLD_ORIGINAL_DPAPI_INDEPENDENT_PROCESS_PASS'
}finally{
  Remove-Item -LiteralPath $errPath -Force -ErrorAction SilentlyContinue
}
