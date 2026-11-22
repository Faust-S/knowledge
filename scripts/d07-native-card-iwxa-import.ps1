param([string]$SiteDir="site",[string]$Origin="https://127.0.0.1:55407")
$ErrorActionPreference="Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
$site=(Resolve-Path $SiteDir).Path
$edge=@((Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Microsoft\Edge\Application\msedge.exe'),(Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Microsoft\Edge\Application\msedge.exe'))|Where-Object{Test-Path $_}|Select-Object -First 1
if(!$edge){throw 'D07_IMPORT_NATIVE_EDGE_MISSING'}
$download=Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads'
$files=@(Get-ChildItem $download -Filter '*.iwxa' -File -ErrorAction SilentlyContinue|Where-Object{$_.Length -gt 128})
if($files.Count -ne 1){throw 'D07_IMPORT_PHYSICAL_ARCHIVE_NOT_UNIQUE'}
$archive=$files[0].FullName
$hash=(Get-FileHash $archive -Algorithm SHA256).Hash
if($hash.Length -ne 64){throw 'D07_IMPORT_ARCHIVE_SHA_INVALID'}
$profile=Join-Path $env:RUNNER_TEMP 'd07-independent-import-profile'
if(Test-Path $profile){throw 'D07_IMPORT_PROFILE_MUST_BE_FRESH'}
$browser=$null;$reopened=$null;$server=$null
$scope=[System.Windows.Automation.TreeScope]::Descendants
function Roots {
 $all=@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'")
 $pidSet=[System.Collections.Generic.HashSet[int]]::new()
 foreach($p in $all){if($p.CommandLine -and $p.CommandLine.Contains("--user-data-dir=$profile")){[void]$pidSet.Add([int]$p.ProcessId)}}
 for($depth=0;$depth -lt 9;$depth++){
  $added=0
  foreach($p in $all){if($pidSet.Contains([int]$p.ParentProcessId) -and $pidSet.Add([int]$p.ProcessId)){$added++}}
  if(!$added){break}
 }
 foreach($p in @(Get-Process msedge -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle -ne 0})){
  if(!$pidSet.Contains([int]$p.Id)){continue}
  try{$root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle);if($root){$root}}catch{}
 }
}
function Locate([string]$name,$type){
 $cond=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$name)
 if($type){$cond=[System.Windows.Automation.AndCondition]::new($cond,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,$type))}
 foreach($root in @(Roots)){$x=$root.FindFirst($scope,$cond);if($x -and $x.Current.IsEnabled){return $x}}
 return $null
}
function Await([string]$name,$type,[string]$code){
 for($i=0;$i -lt 100;$i++){$x=Locate $name $type;if($x){return $x};Start-Sleep -Milliseconds 500}
 throw $code
}
function Click([string]$name,[string]$code){
 $x=Await $name ([System.Windows.Automation.ControlType]::Button) $code
 $pattern=[System.Windows.Automation.InvokePattern]$x.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
 $pattern.Invoke()
}
function StartEdge([string]$url){
 Start-Process -FilePath $edge -ArgumentList @('--force-renderer-accessibility','--ignore-certificate-errors','--no-first-run','--no-default-browser-check',"--user-data-dir=$profile","--app=$url") -PassThru
}
function ActivateImportTab {
 $tab=Await 'Импортировать' ([System.Windows.Automation.ControlType]::TabItem) 'D07_IMPORT_TAB_NOT_FOUND'
 try{$selection=[System.Windows.Automation.SelectionItemPattern]$tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern);$selection.Select()}
 catch{try{$legacy=[System.Windows.Automation.LegacyIAccessiblePattern]$tab.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern);$legacy.DoDefaultAction()}
  catch{$tab.SetFocus();[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')}}
 for($i=0;$i -lt 35;$i++){
  try{$selection=[System.Windows.Automation.SelectionItemPattern]$tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
   if($selection.Current.IsSelected){return $tab}}catch{}
  Start-Sleep -Milliseconds 250
 }
 throw 'D07_IMPORT_TAB_NOT_SELECTED'
}
try{
 $server=Start-Process -FilePath node -WorkingDirectory $site -ArgumentList @('scripts/preview-d07-integrated-site.mjs') -RedirectStandardOutput (Join-Path $env:RUNNER_TEMP 'd07-import-host.private.log') -RedirectStandardError (Join-Path $env:RUNNER_TEMP 'd07-import-host-error.private.log') -PassThru
 $ready=$false
 for($i=0;$i -lt 65;$i++){
  Start-Sleep -Milliseconds 500
  try{if((Invoke-WebRequest -Uri ($Origin+'/workspace/exchange/') -SkipCertificateCheck -TimeoutSec 2).StatusCode -eq 200){$ready=$true;break}}catch{}
 }
 if(!$ready){throw 'D07_IMPORT_HOST_HTTPS_NOT_READY'}
 $browser=StartEdge ($Origin+'/workspace/exchange/#/home')
 $null=Await 'Перенос данных' $null 'D07_IMPORT_EXCHANGE_NOT_VISIBLE'
 if(Locate 'Операция «Перенос данных» не предоставлена ядром в текущем режиме.' $null){throw 'D07_IMPORT_KERNEL_CAPABILITY_NOT_GRANTED'}
 $tab=ActivateImportTab
 if(Locate 'Скачать .iwxa' $null){throw 'D07_IMPORT_EXPORT_PANEL_STILL_SELECTED'}
 $choose=$null
 foreach($label in @('Выберите файл .iwxa','Выбрать файл','Choose File','Choose file','Browse...')){
  $choose=Locate $label $null
  if($choose){break}
 }
 if($choose){
  try{$inv=[System.Windows.Automation.InvokePattern]$choose.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern);$inv.Invoke()}
  catch{$choose.SetFocus();[System.Windows.Forms.SendKeys]::SendWait(' ')}
 }else{
  $tab.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait('{TAB}')
  [System.Windows.Forms.SendKeys]::SendWait(' ')
 }
 Start-Sleep -Milliseconds 750
 Set-Clipboard -Value $archive
 [System.Windows.Forms.SendKeys]::SendWait('%n')
 Start-Sleep -Milliseconds 300
 [System.Windows.Forms.SendKeys]::SendWait('^v')
 [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
 $null=Await 'Импортировать (1)' ([System.Windows.Automation.ControlType]::Button) 'D07_IMPORT_PREVIEW_NOT_READY'
 Write-Output 'D07_IWXA_NATIVE_INDEPENDENT_PREVIEW=PASS'
 Click 'Импортировать (1)' 'D07_IMPORT_COMMIT_DISABLED'
 $null=Await 'Отчёт' $null 'D07_IMPORT_ORIGINAL_RECEIPT_MISSING'
 if(Locate 'Импорт выполнен не полностью' $null){throw 'D07_IMPORT_PARTIAL_REJECTED'}
 $null=Await 'Объектов создано' $null 'D07_IMPORT_OBJECT_COUNT_MISSING'
 Write-Output 'D07_IWXA_NATIVE_INDEPENDENT_IMPORT=PASS'
 try{$browser.Kill($true)}catch{}
 Start-Sleep -Milliseconds 1100
 $browser=$null
 $reopened=StartEdge ($Origin+'/workspace/')
 $null=Await 'Мои услуги' $null 'D07_IMPORT_USLUGOVOD_HOST_NOT_REOPENED'
 $selector=$null
 foreach($root in @(Roots)){
  $items=$root.FindAll($scope,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::ComboBox))
  if($items.Count -ge 1){$selector=$items.Item(0);break}
 }
 if(!$selector){throw 'D07_IMPORT_SELECTED_WORKSPACE_CONTROL_MISSING'}
 $selector.SetFocus()
 [System.Windows.Forms.SendKeys]::SendWait('{HOME}')
 [System.Windows.Forms.SendKeys]::SendWait('{DOWN}')
 [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
 $null=Await 'Рабочая область выбрана' $null 'D07_IMPORT_IMPORTED_WORKSPACE_NOT_SELECTED'
 $found=$false
 for($k=0;$k -lt 110;$k++){
  foreach($root in @(Roots)){
   $items=$root.FindAll($scope,[System.Windows.Automation.Condition]::TrueCondition)
   foreach($node in $items){
    $name=$node.Current.Name
    if($name -match 'Сохранённых заказов:\s*1'){$found=$true;break}
   }
   if($found){break}
  }
  if($found){break}
  Start-Sleep -Milliseconds 400
 }
 if(!$found){throw 'D07_IMPORT_COLD_READBACK_ORDER_MISSING'}
 Write-Output 'D07_IWXA_NATIVE_IMPORTED_ORDER_READBACK=PASS'
 # A count of one is insufficient: the recipient must reopen the *same*
 # Kernel Object ID as the source order, not merely any saved order.
 $proofFile=Join-Path $env:RUNNER_TEMP 'd07-native-card-order-identity.private.json'
 if(!(Test-Path $proofFile)){throw 'D07_IMPORT_SOURCE_IDENTITY_WITNESS_MISSING'}
 $proof=Get-Content -Raw $proofFile|ConvertFrom-Json
 if($proof.serviceSlug -ne 'zamena-unitaza' -or
    $proof.protocolId -ne 'toilet-replacement' -or $proof.works -ne 10 -or
    $proof.objectId -notmatch '^d07:order:[a-f0-9]{64}
}finally{
 if($browser){try{$browser.Kill($true)}catch{}}
 if($reopened){try{$reopened.Kill($true)}catch{}}
 if($server){Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue}
}
){
   throw 'D07_IMPORT_SOURCE_IDENTITY_WITNESS_INVALID'
 }
 $orderButton=$null
 $buttonType=[System.Windows.Automation.PropertyCondition]::new(
   [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
   [System.Windows.Automation.ControlType]::Button)
 for($i=0;$i -lt 60;$i++){
   foreach($root in @(Roots)){
     $buttons=$root.FindAll($scope,$buttonType)
     foreach($button in $buttons){
       if($button.Current.IsEnabled -and
          $button.Current.Name.Contains('Заказ: Замена унитаза')){
         $orderButton=$button;break
       }
     }
     if($orderButton){break}
   }
   if($orderButton){break}
   Start-Sleep -Milliseconds 400
 }
 if(!$orderButton){throw 'D07_IMPORT_EXPECTED_SERVICE_ORDER_NOT_LISTED'}
 $open=[System.Windows.Automation.InvokePattern]$orderButton.GetCurrentPattern(
   [System.Windows.Automation.InvokePattern]::Pattern)
 $open.Invoke()
 $technical=Await 'Технические сведения о записи' $null 'D07_IMPORT_KERNEL_OBJECT_DETAILS_NOT_FOUND'
 try{
   $p=[System.Windows.Automation.InvokePattern]$technical.GetCurrentPattern(
     [System.Windows.Automation.InvokePattern]::Pattern)
   $p.Invoke()
 }catch{
   $technical.SetFocus()
   [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
 }
 $importedObjectId=$null
 for($i=0;$i -lt 75;$i++){
   $names=[System.Collections.Generic.List[string]]::new()
   foreach($root in @(Roots)){
     $nodes=$root.FindAll($scope,[System.Windows.Automation.PropertyCondition]::new(
       [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
       [System.Windows.Automation.ControlType]::Text))
     foreach($node in $nodes){
       $value=$node.Current.Name
       if($value -and $value.Length -lt 400){$names.Add($value)}
     }
   }
   $display=[string]::Join([Environment]::NewLine,$names)
   if($display -match 'Object ID:\s*(d07:order:[a-f0-9]{64})'){
      $importedObjectId=$Matches[1];break
   }
   Start-Sleep -Milliseconds 350
 }
 if(!$importedObjectId -or $importedObjectId -ne $proof.objectId){
   throw 'D07_IMPORT_OBJECT_IDENTITY_MISMATCH'
 }
 Write-Output 'D07_IWXA_NATIVE_ORIGINAL_OBJECT_ID_ROUNDTRIP=PASS'
 Write-Output 'D07_IWXA_NATIVE_CUSTOMER_RESULT_ACCEPTANCE=NOT_RUN'
}finally{
 if($browser){try{$browser.Kill($true)}catch{}}
 if($reopened){try{$reopened.Kill($true)}catch{}}
 if($server){Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue}
}
