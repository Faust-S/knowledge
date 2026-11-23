# Real accepted 0.3 UIA writes the data; this script only upgrades the
# same Windows profile through original IWXA Setup Core and reads it back.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$CandidateSetup)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$setup=(Resolve-Path -LiteralPath $CandidateSetup).Path
$root=Join-Path $env:LOCALAPPDATA 'Programs/IWXA Admin Center'
$data=Join-Path $env:LOCALAPPDATA 'ru.iwxa.admin-center/atlas-store-v1'
$draftPath=Join-Path $data 'preparation/draft.json'
$reportRoot=Join-Path $env:RUNNER_TEMP 'admin-center-04-upgrade'
New-Item -ItemType Directory -Path $reportRoot -Force | Out-Null
function Require([bool]$yes,[string]$code){if(!$yes){throw $code}}
function Receipt([string]$cmd,[string]$name){
  $dest=Join-Path $reportRoot ($name+'.json')
  $p=Start-Process -FilePath $setup -ArgumentList ($cmd+' "'+$dest+'"') -PassThru
  try{
    Require ($p.WaitForExit(120000)) 'ADMIN04_SETUP_COMMAND_TIMEOUT'
    Require ($p.ExitCode -eq 0) 'ADMIN04_SETUP_COMMAND_REJECTED'
  }finally{$p.Dispose()}
  Require (Test-Path -LiteralPath $dest -PathType Leaf) 'ADMIN04_SETUP_RECEIPT_MISSING'
  return Get-Content -LiteralPath $dest -Raw | ConvertFrom-Json
}
function Fingerprint([string]$folder){
  Require (Test-Path -LiteralPath $folder -PathType Container) 'ADMIN04_DATA_ROOT_MISSING'
  $files=@(Get-ChildItem -LiteralPath $folder -File -Recurse)
  Require ($files.Count -ge 3) 'ADMIN04_ORIGINAL_DATA_INCOMPLETE'
  $rows=@($files | ForEach-Object{
    $rel=$_.FullName.Substring($folder.Length)
    $sha=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    $rel+':'+$sha
  })
  return (($rows | Sort-Object) -join [Environment]::NewLine)
}
Require (Test-Path -LiteralPath $draftPath -PathType Leaf) 'ADMIN04_ACCEPTED_03_DRAFT_MISSING'
$old=Get-ItemProperty -LiteralPath 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.admin-center' -ErrorAction Stop
Require ($old.Version -eq '0.3.0-dev.1') 'ADMIN04_ACCEPTED_03_VERSION_CHANGED'
$draft=Get-Content -LiteralPath $draftPath -Raw | ConvertFrom-Json -Depth 100
Require (@($draft.organizations).Count -eq 2) 'ADMIN04_TWO_ORIGINAL_COMPANIES_MISSING'
$first=@($draft.organizations | Where-Object {$_.name -eq 'CenterGUIOrganization'})
$second=@($draft.organizations | Where-Object {$_.name -eq 'CenterGUISecondOrganization'})
Require ($first.Count -eq 1 -and $second.Count -eq 1) 'ADMIN04_ORIGINAL_ORGANIZATION_IDENTITIES_MISSING'
Require (@($first[0].participants).Count -eq 2 -and
  @($first[0].assignments).Count -eq 1 -and
  @($first[0].participants | Where-Object {$_.personalAgentPlan -eq 'PLANNED'}).Count -eq 1 -and
  $first[0].assignments[0].title -eq 'CenterGUIAssignmentRevised') 'ADMIN04_ORIGINAL_MANAGER_DATA_MISSING'
$before=Fingerprint $data
$plan=Receipt '--upgrade-plan-file' 'plan'
Require ($plan.status -eq 'UPGRADE_CANDIDATE_NOT_ACTIVATED' -and
  $plan.installedVersion -eq '0.3.0-dev.1' -and
  $plan.candidateVersion -eq '0.4.1') 'ADMIN04_UPGRADE_PLAN_INVALID'
Write-Host 'ADMIN04_ACCEPTED_03_TO_04_PLAN_PASS'
$result=Receipt '--upgrade-file' 'upgrade'
Require ($result.status -eq 'UPGRADED_BACKUP_RETAINED' -and
  $result.version -eq '0.4.1') 'ADMIN04_UPGRADE_NOT_APPLIED'
$registered=Get-ItemProperty -LiteralPath 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.admin-center' -ErrorAction Stop
Require ($registered.Version -eq '0.4.1' -and
  (Test-Path -LiteralPath ($root+'.iwxa-previous') -PathType Container)) 'ADMIN04_UPGRADE_NOT_REGISTERED'
$required=@('iwxa-admin-center.exe','t3/iwxa-t3-product-owner.exe',
  't3/iwxa-t3-product-consumer.exe','t3/iwxa-t3-age-desktop.exe',
  't3/age.exe','t3/age-keygen.exe','t3/age-toolchain.json',
  't3/one-dist/_iwxa/loader.js','t3/one-dist/_iwxa/runtime/0.3.6/runtime.js')
foreach($rel in $required){
  Require (Test-Path -LiteralPath (Join-Path $root $rel) -PathType Leaf) 'ADMIN04_ORIGINAL_T3_COMPONENT_NOT_INSTALLED'
}
Require ((Fingerprint $data) -ceq $before) 'ADMIN04_DATA_CHANGED_ON_UPGRADE'
Write-Host 'ADMIN04_TWO_COMPANIES_AND_NATIVE_ATLAS_PRESERVED_PASS'
$exe=Join-Path $root 'iwxa-admin-center.exe'
$gui=Start-Process -FilePath $exe -WorkingDirectory $root -PassThru
try{
  $visible=$false
  for($i=0;$i -lt 90;$i++){
    Start-Sleep -Milliseconds 400
    $gui.Refresh()
    Require (!$gui.HasExited) 'ADMIN04_UPGRADED_GUI_EXITED'
    if($gui.MainWindowHandle -eq [IntPtr]::Zero){continue}
    $window=[System.Windows.Automation.AutomationElement]::FromHandle($gui.MainWindowHandle)
    $nodes=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    foreach($node in $nodes){
      try{
        if(([string]$node.Current.Name).Contains('CenterGUIOrganization')){$visible=$true;break}
      }catch{}
    }
    if($visible){break}
  }
  Require $visible 'ADMIN04_UPGRADED_GUI_ORGANIZATION_NOT_VISIBLE'
  Write-Host 'ADMIN04_COLD_INSTALLED_GUI_REOPEN_COMPANY_PASS'
}finally{
  if(!$gui.HasExited){
    $gui.CloseMainWindow() | Out-Null
    if(!$gui.WaitForExit(12000)){
      Stop-Process -Id $gui.Id -Force -ErrorAction SilentlyContinue
      throw 'ADMIN04_GUI_GRACEFUL_CLOSE_REQUIRED'
    }
  }
  $gui.Dispose()
}
Require ((Fingerprint $data) -ceq $before) 'ADMIN04_DATA_CHANGED_ON_REOPEN'
$confirmed=Receipt '--confirm-upgrade-file' 'confirmed'
Require ($confirmed.status -eq 'UPGRADE_CONFIRMED_OLD_RELEASE_REMOVED' -and
  !(Test-Path -LiteralPath ($root+'.iwxa-previous'))) 'ADMIN04_UPGRADE_CONFIRM_FAILED'
Require ((Fingerprint $data) -ceq $before) 'ADMIN04_DATA_CHANGED_ON_CONFIRM'
Write-Host 'ADMIN04_ACCEPTED_03_TO_ORIGINAL_FULL_04_SETUP_CORE_UPGRADE_PASS'
Write-Host 'ADMIN04_TWO_COMPANIES_ATLAS_STAFF_ASSIGNMENT_AGENT_PLAN_HASHES_PASS'
