param([string]$SiteDir="site",[string]$Origin="https://127.0.0.1:55407")
$ErrorActionPreference="Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
$profile=Join-Path $env:RUNNER_TEMP "d07-independent-import-profile"
if(!(Test-Path $profile)){throw "D07_WORK_RESULT_INDEPENDENT_PROFILE_MISSING"}
$site=(Resolve-Path $SiteDir).Path
$edge=@((Join-Path ([Environment]::GetFolderPath("ProgramFilesX86")) "Microsoft\Edge\Application\msedge.exe"),
 (Join-Path ([Environment]::GetFolderPath("ProgramFiles")) "Microsoft\Edge\Application\msedge.exe"))|
 Where-Object {Test-Path $_}|Select-Object -First 1
if(!$edge){throw "D07_WORK_RESULT_EDGE_MISSING"}
$scope=[System.Windows.Automation.TreeScope]::Descendants
$server=$null;$browser=$null
function Roots {
 $all=@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'")
 $pidSet=[System.Collections.Generic.HashSet[int]]::new()
 foreach($p in $all){if($p.CommandLine -and $p.CommandLine.Contains("--user-data-dir=$profile")){
  [void]$pidSet.Add([int]$p.ProcessId)
 }}
 for($d=0;$d -lt 9;$d++){
  $new=0
  foreach($p in $all){if($pidSet.Contains([int]$p.ParentProcessId) -and $pidSet.Add([int]$p.ProcessId)){$new++}}
  if(!$new){break}
 }
 foreach($p in @(Get-Process msedge -ErrorAction SilentlyContinue|Where-Object {$_.MainWindowHandle -ne 0})){
  if(!$pidSet.Contains([int]$p.Id)){continue}
  try{
   $x=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
   if($x){$x}
  }catch{}
 }
}
function Locate([string]$name,$type){
 $cond=[System.Windows.Automation.PropertyCondition]::new(
  [System.Windows.Automation.AutomationElement]::NameProperty,$name)
 if($type){$cond=[System.Windows.Automation.AndCondition]::new($cond,
  [System.Windows.Automation.PropertyCondition]::new(
   [System.Windows.Automation.AutomationElement]::ControlTypeProperty,$type))}
 foreach($root in @(Roots)){
  $x=$root.FindFirst($scope,$cond)
  if($x -and $x.Current.IsEnabled){return $x}
 }
 return $null
}
function Await([string]$name,$type,[string]$code){
 for($i=0;$i -lt 110;$i++){
  $x=Locate $name $type
  if($x){return $x}
  Start-Sleep -Milliseconds 350
 }
 throw $code
}
# A submitted/accepted Work has intentionally non-editable evidence fields.
# Read them without requiring IsEnabled; actions and mutations continue to
# use Locate/Await so disabled buttons can never be clicked.
function LocateForRead([string]$name,$type){
 $cond=[System.Windows.Automation.PropertyCondition]::new(
  [System.Windows.Automation.AutomationElement]::NameProperty,$name)
 if($type){$cond=[System.Windows.Automation.AndCondition]::new($cond,
  [System.Windows.Automation.PropertyCondition]::new(
   [System.Windows.Automation.AutomationElement]::ControlTypeProperty,$type))}
 foreach($root in @(Roots)){
  $x=$root.FindFirst($scope,$cond)
  if($x){return $x}
 }
 return $null
}
function AwaitForRead([string]$name,$type,[string]$code){
 for($i=0;$i -lt 110;$i++){
  $x=LocateForRead $name $type
  if($x){return $x}
  Start-Sleep -Milliseconds 350
 }
 throw $code
}
function Click([string]$label){
 $x=Await $label ([System.Windows.Automation.ControlType]::Button) "D07_WORK_RESULT_ACTION_NOT_FOUND"
 try{
  $pattern=[System.Windows.Automation.InvokePattern]$x.GetCurrentPattern(
   [System.Windows.Automation.InvokePattern]::Pattern)
  $pattern.Invoke()
 }catch{
  $x.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
 }
 Start-Sleep -Milliseconds 180
}
function OpenWork([string]$title,[string]$status){
 $name="Работа 1: "+$title+"; состояние: "+$status
 $x=Await $name $null "D07_WORK_RESULT_NAMED_SUMMARY_NOT_FOUND"
 # A previously expanded <details> can be restored by Edge after reload.
 # Never toggle it closed while trying to reveal the Result editor.
 if(LocateForRead "Результат работы 1" ([System.Windows.Automation.ControlType]::Edit)){return}
 try{
  $p=[System.Windows.Automation.ExpandCollapsePattern]$x.GetCurrentPattern(
   [System.Windows.Automation.ExpandCollapsePattern]::Pattern)
  if($p.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Collapsed){
   $p.Expand()
  }
 }catch{
  try{
   $p=[System.Windows.Automation.InvokePattern]$x.GetCurrentPattern(
    [System.Windows.Automation.InvokePattern]::Pattern)
   $p.Invoke()
  }catch{
   $x.SetFocus()
   [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  }
 }
 $null=AwaitForRead "Результат работы 1" ([System.Windows.Automation.ControlType]::Edit) "D07_WORK_RESULT_EDITOR_NOT_EXPANDED"
}
function OpenIndexedWork([int]$n,[string]$title,[string]$status){
 $name="Работа "+$n+": "+$title+"; состояние: "+$status
 $x=Await $name $null "D07_WORK_RESULT_INDEXED_SUMMARY_NOT_FOUND"
 $field="Результат работы "+$n
 if(LocateForRead $field ([System.Windows.Automation.ControlType]::Edit)){return}
 try{
  $expand=[System.Windows.Automation.ExpandCollapsePattern]$x.GetCurrentPattern(
   [System.Windows.Automation.ExpandCollapsePattern]::Pattern)
  if($expand.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Collapsed){
   $expand.Expand()
  }
 }catch{
  try{
   $invoke=[System.Windows.Automation.InvokePattern]$x.GetCurrentPattern(
    [System.Windows.Automation.InvokePattern]::Pattern)
   $invoke.Invoke()
  }catch{
   $x.SetFocus()
   [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  }
 }
 $null=AwaitForRead $field ([System.Windows.Automation.ControlType]::Edit) "D07_WORK_RESULT_INDEXED_EDITOR_NOT_VISIBLE"
}
function AwaitIndexedStatus([int]$n,[string]$title,[string]$status){
 $name="Работа "+$n+": "+$title+"; состояние: "+$status
 $null=Await $name $null "D07_WORK_RESULT_INDEXED_STATUS_NOT_CONFIRMED"
}
function Edit([string]$label,[string]$text){
 $field=Await $label ([System.Windows.Automation.ControlType]::Edit) "D07_WORK_RESULT_INPUT_NOT_FOUND"
 $field.SetFocus()
 Set-Clipboard -Value $text
 [System.Windows.Forms.SendKeys]::SendWait("^a")
 [System.Windows.Forms.SendKeys]::SendWait("^v")
 $ok=$false
 for($i=0;$i -lt 45;$i++){
  $found=Locate $label ([System.Windows.Automation.ControlType]::Edit)
  if($found){
   try{
    $val=[System.Windows.Automation.ValuePattern]$found.GetCurrentPattern(
     [System.Windows.Automation.ValuePattern]::Pattern)
    if($val.Current.Value -ceq $text){$ok=$true;break}
   }catch{}
  }
  Start-Sleep -Milliseconds 200
 }
 if(!$ok){throw "D07_WORK_RESULT_TEXT_INPUT_NOT_COMMITTED"}
}
function Visible(){
 $names=[System.Collections.Generic.List[string]]::new()
 foreach($root in @(Roots)){
  $nodes=$root.FindAll($scope,[System.Windows.Automation.Condition]::TrueCondition)
  foreach($node in $nodes){
   $name=$node.Current.Name
   if($name -and $name.Length -lt 500){$names.Add($name)}
  }
 }
 return [string]::Join([Environment]::NewLine,$names)
}
function SaveRevision([int]$expected){
 Click "Сохранить заказ"
 $ok=$false
 for($i=0;$i -lt 125;$i++){
  $visible=Visible
  if($visible.Contains("Запись T2 не подтверждена:")){throw "D07_WORK_RESULT_KERNEL_WRITE_NOT_CONFIRMED"}
  if($visible.Contains("Заказ сохранён и повторно прочитан.") -and
     $visible.Contains("Редакция "+$expected)){$ok=$true;break}
  Start-Sleep -Milliseconds 250
 }
 if(!$ok){throw "D07_WORK_RESULT_REVISION_RECEIPT_MISSING"}
 Write-Output ("D07_WORK_RESULT_KERNEL_REVISION_"+$expected+"=PASS")
}
function StartEdge {
 Start-Process -FilePath $edge -ArgumentList @(
  "--force-renderer-accessibility","--ignore-certificate-errors",
  "--no-first-run","--no-default-browser-check",
  "--user-data-dir=$profile","--app=$Origin/workspace/"
 ) -PassThru
}
function ColdReopen([int]$expected,[string]$name,[string]$status){
 if($browser){try{$browser.Kill($true)}catch{}}
 Start-Sleep -Milliseconds 1400
 $script:browser=StartEdge
 $null=Await "Мои услуги" $null "D07_WORK_RESULT_REOPEN_UI_MISSING"
 $null=Await ("Работа 1: "+$name+"; состояние: "+$status) $null "D07_WORK_RESULT_STATUS_NOT_PERSISTED"
 $detail=Await "Технические сведения о записи" $null "D07_WORK_RESULT_TECHNICAL_DETAILS_NOT_FOUND"
 # The original Result ID must remain readable after reopening. Do not
 # collapse technical data when the browser restores its expanded state.
 $cold=Visible
 if(!$cold.Contains("Object ID:") -or !$cold.Contains($script:expectedId)){
  try{
   $p=[System.Windows.Automation.ExpandCollapsePattern]$detail.GetCurrentPattern(
    [System.Windows.Automation.ExpandCollapsePattern]::Pattern)
   if($p.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Collapsed){
    $p.Expand()
   }
  }catch{$detail.SetFocus();[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")}
 }
 $matched=$false
 for($i=0;$i -lt 95;$i++){
  $visible=Visible
  # The label and hex Object ID may occupy separate UIA nodes.
  $idMatch=$visible.Contains("Object ID:") -and $visible.Contains($script:expectedId)
  # Current revision is an accessible status derived from the opened T2 Result,
  # not an event from the history or another saved order.
  $revMatch=$visible.Contains("Текущая редакция открытого заказа: "+$expected)
  $worksMatch=(@($script:titles|Where-Object {$visible.Contains($_)}).Count -eq 10)
  if($idMatch -and $revMatch -and $worksMatch){$matched=$true;break}
  Start-Sleep -Milliseconds 300
 }
 if(!$matched){
  Write-Output ("D07_WORK_RESULT_COLD_ID_MATCH="+$idMatch)
  Write-Output ("D07_WORK_RESULT_COLD_REVISION_MATCH="+$revMatch)
  Write-Output ("D07_WORK_RESULT_COLD_TEN_WORKS_MATCH="+$worksMatch)
  throw "D07_WORK_RESULT_COLD_READBACK_ID_REVISION_OR_WORKS_CHANGED"
 }
 Write-Output ("D07_WORK_RESULT_COLD_REVISION_"+$expected+"_EXACT_ID_TEN_WORKS=PASS")
}
try{
 $identityFile=Join-Path $env:RUNNER_TEMP "d07-native-card-order-identity.private.json"
 if(!(Test-Path $identityFile)){throw "D07_WORK_RESULT_SOURCE_PROOF_MISSING"}
 $source=Get-Content $identityFile -Raw|ConvertFrom-Json
 $expectedId=[string]$source.objectId
 if($source.works -ne 10 -or $expectedId -notmatch '^d07:order:[a-f0-9]{64}$'){
  throw "D07_WORK_RESULT_SOURCE_ID_INVALID"
 }
 # The expected titles come from the pinned subject source, not from a generic fixture.
 $code='import {findSubjectProtocol} from "./src/domain/service-subject-protocols.ts";const p=findSubjectProtocol("remont-dom-mastera","zamena-unitaza");process.stdout.write(JSON.stringify(p.operations.filter(x=>x.billing!=="separately-agreed").map(x=>x.title)));'
 Push-Location $site
 try{
  $text=& node --import tsx --input-type=module -e $code
  if($LASTEXITCODE -ne 0){throw "D07_WORK_RESULT_PRIVATE_SUBJECT_UNAVAILABLE"}
  $titles=@($text|ConvertFrom-Json)
 }finally{Pop-Location}
 if($titles.Count -ne 10){throw "D07_WORK_RESULT_SUBJECT_TITLES_INVALID"}
 $server=Start-Process -FilePath node -WorkingDirectory $site -ArgumentList @(
   "scripts/preview-d07-integrated-site.mjs"
 ) -RedirectStandardOutput (Join-Path $env:RUNNER_TEMP "d07-work-result-host.private.log") -RedirectStandardError (
   Join-Path $env:RUNNER_TEMP "d07-work-result-host-error.private.log"
 ) -PassThru
 $ready=$false
 for($i=0;$i -lt 65;$i++){
  Start-Sleep -Milliseconds 500
  try{if((Invoke-WebRequest -Uri ($Origin+"/workspace/") -SkipCertificateCheck -TimeoutSec 2).StatusCode -eq 200){$ready=$true;break}}catch{}
 }
 if(!$ready){throw "D07_WORK_RESULT_REAL_HOST_NOT_READY"}
 ColdReopen 2 $titles[0] "Планируется"
 OpenWork $titles[0] "Планируется"
 Click "Работа 1: Записать согласованные условия"
 $null=Await ("Работа 1: "+$titles[0]+"; состояние: Согласована") $null "D07_WORK_RESULT_AGREED_NOT_VISIBLE"
 Click "Работа 1: Отметить начало"
 $null=Await ("Работа 1: "+$titles[0]+"; состояние: В работе") $null "D07_WORK_RESULT_IN_PROGRESS_NOT_VISIBLE"
 Edit "Результат работы 1" "ТЕСТ: предъявлена первая работа; сведения учебного GUI-сценария, не реальный акт оказания услуги."
 Click "Работа 1: Отметить сдачу результата"
 $null=Await ("Работа 1: "+$titles[0]+"; состояние: Передана на проверку") $null "D07_WORK_RESULT_SUBMITTED_NOT_VISIBLE"
 Edit "Замечания к работе 1" "ТЕСТ: замечание заказчика по контрольному сценарию; требуется доработка."
 Click "Работа 1: Записать замечания"
 $null=Await ("Работа 1: "+$titles[0]+"; состояние: Нужны исправления") $null "D07_WORK_RESULT_NEEDS_FIX_NOT_VISIBLE"
 SaveRevision 3
 ColdReopen 3 $titles[0] "Нужны исправления"
 Write-Output "D07_WORK_RESULT_REJECTION_DURABLE=PASS"
 OpenWork $titles[0] "Нужны исправления"
 Edit "План исправления работы 1" "ТЕСТ: исправить предъявленное замечание и повторить согласованный контроль."
 Click "Работа 1: Вернуть в работу"
 $null=Await ("Работа 1: "+$titles[0]+"; состояние: В работе") $null "D07_WORK_RESULT_REWORK_NOT_VISIBLE"
 Edit "Устранение замечаний к работе 1" "ТЕСТ: повторно сверены условия контрольной приёмки."
 Edit "Результат работы 1" "ТЕСТ: повторно предъявлена исправленная работа; только проверка GUI и T2 Kernel."
 Click "Работа 1: Отметить сдачу результата"
 $null=Await ("Работа 1: "+$titles[0]+"; состояние: Передана на проверку") $null "D07_WORK_RESULT_RESUBMIT_NOT_VISIBLE"
 Edit "Проверка результата работы 1" "ТЕСТ: повторно проверен первый пункт, запись решения пользователя; не договорная приёмка."
 Click "Работа 1: Отметить результат проверенным"
 $null=Await ("Работа 1: "+$titles[0]+"; состояние: Отмечена принятой") $null "D07_WORK_RESULT_MARK_REVIEWED_NOT_VISIBLE"
 SaveRevision 4
 ColdReopen 4 $titles[0] "Отмечена принятой"
 OpenWork $titles[0] "Отмечена принятой"
 $note=AwaitForRead "Проверка результата работы 1" ([System.Windows.Automation.ControlType]::Edit) "D07_WORK_RESULT_ACCEPTANCE_EVIDENCE_LOST"
 $value=[System.Windows.Automation.ValuePattern]$note.GetCurrentPattern(
  [System.Windows.Automation.ValuePattern]::Pattern)
 if(!([string]$value.Current.Value).StartsWith("ТЕСТ: повторно проверен")){
  throw "D07_WORK_RESULT_ACCEPTANCE_EVIDENCE_CHANGED"
 }
 Write-Output "D07_WORK_RESULT_NATIVE_REJECTION_CORRECTION_REVIEW_PERSISTED=PASS"
 Write-Output "D07_WORK_RESULT_CUSTOMER_REVIEW_RECORD=PASS"
 # Complete the nine remaining REAL subject Work records in the same
 # imported T2 Result. These are synthetic UI test annotations, never a
 # declaration that customer services were provided or legally accepted.
 for($n=2;$n -le 10;$n++){
  $title=[string]$titles[$n-1]
  OpenIndexedWork $n $title "Планируется"
  Click ("Работа "+$n+": Записать согласованные условия")
  AwaitIndexedStatus $n $title "Согласована"
  Click ("Работа "+$n+": Отметить начало")
  AwaitIndexedStatus $n $title "В работе"
  Edit ("Результат работы "+$n) ("ТЕСТ: предъявлена работа "+$n+" в контрольном маршруте реального T2.")
  Click ("Работа "+$n+": Отметить сдачу результата")
  AwaitIndexedStatus $n $title "Передана на проверку"
  Edit ("Проверка результата работы "+$n) ("ТЕСТ: проверена работа "+$n+" по исходному критерию, только UIA/T2.")
  Click ("Работа "+$n+": Отметить результат проверенным")
  AwaitIndexedStatus $n $title "Отмечена принятой"
 }
 Write-Output "D07_WORK_RESULT_ALL_TEN_REVIEWED_BEFORE_SAVE=PASS"
 SaveRevision 5
 ColdReopen 5 $titles[0] "Отмечена принятой"
 # Every one of ten accepted records must retain its own test evidence.
 # The completed fields are intentionally disabled and never edited here.
 for($n=1;$n -le 10;$n++){
  $title=[string]$titles[$n-1]
  AwaitIndexedStatus $n $title "Отмечена принятой"
  OpenIndexedWork $n $title "Отмечена принятой"
  $evidence=AwaitForRead ("Проверка результата работы "+$n) (
   [System.Windows.Automation.ControlType]::Edit) "D07_WORK_RESULT_INDEXED_ACCEPTANCE_EVIDENCE_LOST"
  $pattern=[System.Windows.Automation.ValuePattern]$evidence.GetCurrentPattern(
   [System.Windows.Automation.ValuePattern]::Pattern)
  $expected=if($n -eq 1){"ТЕСТ: повторно проверен"}else{"ТЕСТ: проверена работа "+$n+" "}
  if(!([string]$pattern.Current.Value).StartsWith($expected)){
   throw "D07_WORK_RESULT_INDEXED_ACCEPTANCE_EVIDENCE_CHANGED"
  }
  if($evidence.Current.IsEnabled){
   throw "D07_WORK_RESULT_ACCEPTED_EVIDENCE_STILL_EDITABLE"
  }
 }
 Write-Output "D07_WORK_RESULT_ALL_TEN_REVIEWED_COLD_PERSISTED=PASS"
 Write-Output "D07_WORK_RESULT_ALL_TEN_ACCEPTED_EVIDENCE_READ_ONLY=PASS"
 Write-Output "D07_WORK_RESULT_FULL_ORDER_CUSTOMER_RESULT_ACCEPTANCE=NOT_RUN"
}finally{
 if($browser){try{$browser.Kill($true)}catch{}}
 if($server){Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue}
}
