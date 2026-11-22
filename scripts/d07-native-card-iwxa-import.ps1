param([string]$SiteDir="site",[string]$Origin="https://127.0.0.1:55407")
$ErrorActionPreference="Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class D07NativeImportMouse {
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
}
"@
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
 # The original Exchange may not expose the file control until React
 # finishes switching tabs. This is a native OS file picker, not an API upload.
 $choose=$null
 for($attempt=0;$attempt -lt 50;$attempt++){
   foreach($label in @('Выберите файл .iwxa','Выбрать файл',
     'Choose File','Choose file','Browse...')){
     $choose=Locate $label $null
     if($choose){break}
   }
   if($choose){break}
   Start-Sleep -Milliseconds 250
 }
 Write-Output ('D07_IMPORT_NATIVE_FILE_CONTROL_PRESENT='+[bool]$choose)
 $trigger='none'
 if($choose){
   try{
     $inv=[System.Windows.Automation.InvokePattern]$choose.GetCurrentPattern(
       [System.Windows.Automation.InvokePattern]::Pattern)
     $inv.Invoke()
     $trigger='uia-invoke'
   }catch{
     try{
       $choose.SetFocus()
       [System.Windows.Forms.SendKeys]::SendWait(' ')
       $trigger='keyboard-on-file-control'
     }catch{
       try{
         $point=$choose.GetClickablePoint()
         $px=[int][Math]::Round($point.X)
         $py=[int][Math]::Round($point.Y)
         if(-not [D07NativeImportMouse]::SetCursorPos($px,$py)){
           throw 'D07_IMPORT_NATIVE_MOUSE_LOCATION_DENIED'
         }
         Start-Sleep -Milliseconds 100
         [D07NativeImportMouse]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero)
         [D07NativeImportMouse]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)
         $trigger='native-pointer'
       }catch{throw 'D07_IMPORT_NATIVE_FILE_CONTROL_NOT_ACTIVATED'}
     }
   }
 }else{
   # On Chromium the hidden file input often has no stable UIA name.
   # The first Tab from the selected import panel reaches its chooser.
   $tab.SetFocus()
   [System.Windows.Forms.SendKeys]::SendWait('{TAB}')
   Start-Sleep -Milliseconds 200
   $focus=[System.Windows.Automation.AutomationElement]::FocusedElement
   if(!$focus){throw 'D07_IMPORT_NATIVE_FILE_FOCUS_MISSING'}
   $focusType=$focus.Current.ControlType.ProgrammaticName
   Write-Output ('D07_IMPORT_NATIVE_FIRST_TAB_FOCUS_TYPE='+$focusType)
   if($focusType -notmatch 'Button|Edit|Group|SplitButton'){
     throw 'D07_IMPORT_NATIVE_FILE_FOCUS_WRONG_CONTROL'
   }
   [System.Windows.Forms.SendKeys]::SendWait(' ')
   $trigger='keyboard-tab-from-import'
 }
 Write-Output ('D07_IMPORT_FILE_PICKER_TRIGGER='+$trigger)
 Start-Sleep -Milliseconds 700
 # Use the *real* Windows chooser and keyboard to supply the archive,
 # without reading private file bytes into this public test harness.
 Set-Clipboard -Value $archive
 [System.Windows.Forms.SendKeys]::SendWait('%n')
 Start-Sleep -Milliseconds 300
 [System.Windows.Forms.SendKeys]::SendWait('^v')
 [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
 Write-Output 'D07_IMPORT_NATIVE_FILE_CHOOSER_USED=TRUE'
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
 # The original Host can auto-focus the only imported personal Workspace.
 # Never drive an arbitrary first ComboBox: it may be a service/template
 # selector. The actual Workspace selector has an explicit accessible name.
 $focused=$false
 for($k=0;$k -lt 24;$k++){
   if(Locate 'Рабочая область выбрана' $null){$focused=$true;break}
   Start-Sleep -Milliseconds 350
 }
 if($focused){
   Write-Output 'D07_IMPORT_WORKSPACE_FOCUS_ROUTE=AUTO'
 }else{
   $selector=Await 'Рабочая область Услуговода' (
     [System.Windows.Automation.ControlType]::ComboBox) 'D07_IMPORT_WORKSPACE_SELECTOR_NAMED_CONTROL_MISSING'
   $selector.SetFocus()
   [System.Windows.Forms.SendKeys]::SendWait('{HOME}')
   [System.Windows.Forms.SendKeys]::SendWait('{DOWN}')
   [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
   $null=Await 'Рабочая область выбрана' $null 'D07_IMPORT_IMPORTED_WORKSPACE_NOT_SELECTED'
   Write-Output 'D07_IMPORT_WORKSPACE_FOCUS_ROUTE=EXPLICIT'
 }
 # A split React accessibility label "Сохранённых заказов:" and "1"
 # cannot be matched as a single UIA node. Read the *actual* saved order
 # control; its object identity and all ten works are checked below.
 $orderButton=$null
 $buttonsCondition=[System.Windows.Automation.PropertyCondition]::new(
   [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
   [System.Windows.Automation.ControlType]::Button)
 for($i=0;$i -lt 105;$i++){
   foreach($root in @(Roots)){
     $buttons=$root.FindAll($scope,$buttonsCondition)
     foreach($item in $buttons){
       if($item.Current.IsEnabled -and
          $item.Current.Name.Contains('Заказ: Замена унитаза')){
         $orderButton=$item;break
       }
     }
     if($orderButton){break}
   }
   if($orderButton){break}
   Start-Sleep -Milliseconds 450
 }
 if(!$orderButton){
   $orderSummary=Locate 'Все заказы (1)' $null
   Write-Output ('D07_IMPORT_ORDER_PANEL_SUMMARY_ONE='+[bool]$orderSummary)
   Write-Output ('D07_IMPORT_WORKSPACE_FOCUSED='+[bool](Locate 'Рабочая область выбрана' $null))
   throw 'D07_IMPORT_EXPECTED_SERVICE_ORDER_NOT_LISTED'
 }
 Write-Output 'D07_IWXA_NATIVE_IMPORTED_ORDER_READBACK=PASS'
 # Verify that the independent recipient reopened the exact original T2 Object ID.
 $proofFile=Join-Path $env:RUNNER_TEMP 'd07-native-card-order-identity.private.json'
 if(!(Test-Path $proofFile)){throw 'D07_IMPORT_SOURCE_IDENTITY_WITNESS_MISSING'}
 $proof=Get-Content -Raw $proofFile|ConvertFrom-Json
 $expectedId=[string]$proof.objectId
 if($proof.serviceSlug -ne 'zamena-unitaza' -or
    $proof.protocolId -ne 'toilet-replacement' -or $proof.works -ne 10 -or
    $expectedId -notmatch '^d07:order:[a-f0-9]{64}$'){
   throw 'D07_IMPORT_SOURCE_IDENTITY_WITNESS_INVALID'
 }
 $open=[System.Windows.Automation.InvokePattern]$orderButton.GetCurrentPattern(
   [System.Windows.Automation.InvokePattern]::Pattern)
 $open.Invoke()
 $technical=Await 'Технические сведения о записи' $null 'D07_IMPORT_KERNEL_OBJECT_DETAILS_NOT_FOUND'
 try{
   $pattern=[System.Windows.Automation.InvokePattern]$technical.GetCurrentPattern(
     [System.Windows.Automation.InvokePattern]::Pattern)
   $pattern.Invoke()
 }catch{
   $technical.SetFocus()
   [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
 }
 $importedId=$null
 for($i=0;$i -lt 65;$i++){
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
   $visible=[string]::Join([Environment]::NewLine,$names)
   if($visible -match 'Object ID:\s*(d07:order:[a-f0-9]{64})'){
     $importedId=$Matches[1];break
   }
   Start-Sleep -Milliseconds 400
 }
 if(!$importedId -or $importedId -ne $expectedId){
   throw 'D07_IMPORT_OBJECT_IDENTITY_MISMATCH'
 }
 Write-Output 'D07_IWXA_NATIVE_ORIGINAL_OBJECT_ID_ROUNDTRIP=PASS'
 # Also verify that all exact subject works survived the physical archive.
 # Read expected titles from the pinned private subject protocol, not from
 # this public qualification script or a newly generated generic template.
 $code='import {findSubjectProtocol} from "./src/domain/service-subject-protocols.ts";const p=findSubjectProtocol("remont-dom-mastera","zamena-unitaza");if(!p)process.exit(3);process.stdout.write(JSON.stringify(p.operations.filter(x=>x.billing!=="separately-agreed").map(x=>x.title)));'
 Push-Location $site
 try{
   $titlesJson=& node --import tsx --input-type=module -e $code
   if($LASTEXITCODE -ne 0){throw 'D07_IMPORT_PRIVATE_SUBJECT_PROTOCOL_UNAVAILABLE'}
   $titles=@($titlesJson|ConvertFrom-Json)
 }finally{Pop-Location}
 if($titles.Count -ne 10){throw 'D07_IMPORT_PRIVATE_SUBJECT_OPERATIONS_INVALID'}
 $matchCount=0
 for($attempt=0;$attempt -lt 45;$attempt++){
   $visibleNames=[System.Collections.Generic.List[string]]::new()
   foreach($root in @(Roots)){
     $nodes=$root.FindAll($scope,[System.Windows.Automation.Condition]::TrueCondition)
     foreach($node in $nodes){
       $name=$node.Current.Name
       if($name -and $name.Length -lt 400){$visibleNames.Add($name)}
     }
   }
   $fullText=[string]::Join([Environment]::NewLine,$visibleNames)
   $matchCount=@($titles|Where-Object{$fullText.Contains($_)}).Count
   if($matchCount -eq $titles.Count){break}
   Start-Sleep -Milliseconds 350
 }
 Write-Output ('D07_IWXA_NATIVE_IMPORTED_EXACT_WORKS='+$matchCount)
 if($matchCount -ne 10){throw 'D07_IMPORT_EXACT_TEN_WORKS_NOT_PRESERVED'}
 Write-Output 'D07_IWXA_NATIVE_EXACT_SUBJECT_WORKS_ROUNDTRIP=PASS'
 # Resume the genuine imported object and save a new Kernel revision.
 # Source wrote exactly one order to a newly created, empty personal
 # Workspace. The original Kernel first committed Result revision is 1.
 # This fixed isolated fixture remains checked by the *second* real T2
 # receipt and the independent cold re-read of revision 2 below.
 if(!$proof.eventId -or !$expectedId -or $matchCount -ne 10){
  throw 'D07_IMPORT_SOURCE_FIRST_COMMIT_EVIDENCE_MISSING'
 }
 $previousRevision=1
 Write-Output 'D07_IMPORT_SINGLE_SOURCE_COMMIT_BASE_REVISION=1'
 $editor=Await 'Задача текущего заказа' ([System.Windows.Automation.ControlType]::Edit) 'D07_IMPORT_SAVED_TASK_EDITOR_MISSING'
 $pattern=[System.Windows.Automation.ValuePattern]$editor.GetCurrentPattern(
  [System.Windows.Automation.ValuePattern]::Pattern)
 $oldTask=[string]$pattern.Current.Value
 $marker='Проверка новой редакции после независимого переноса.'
 if($oldTask.Contains($marker) -or $oldTask.Length -gt 6000){throw 'D07_IMPORT_TASK_UNSAFE_FOR_TEST'}
 $nextTask=if($oldTask.Trim()){$oldTask.TrimEnd()+[Environment]::NewLine+$marker}else{$marker}
 $editor.SetFocus()
 Set-Clipboard -Value $nextTask
 [System.Windows.Forms.SendKeys]::SendWait('^a')
 [System.Windows.Forms.SendKeys]::SendWait('^v')
 $edited=$false
 for($i=0;$i -lt 45;$i++){
  $current=Locate 'Задача текущего заказа' ([System.Windows.Automation.ControlType]::Edit)
  if($current){
   try{
    $value=[System.Windows.Automation.ValuePattern]$current.GetCurrentPattern(
     [System.Windows.Automation.ValuePattern]::Pattern)
    if($value.Current.Value -ceq $nextTask){$edited=$true;break}
   }catch{}
  }
  Start-Sleep -Milliseconds 200
 }
 if(!$edited){throw 'D07_IMPORT_TASK_KEYBOARD_EDIT_NOT_APPLIED'}
 Write-Output 'D07_IWXA_NATIVE_IMPORTED_TASK_EDIT=PASS'
 Click 'Сохранить заказ' 'D07_IMPORT_NEXT_REVISION_SAVE_BUTTON_DISABLED'
 $newRevision=$previousRevision+1
 $receipt=$false
 for($i=0;$i -lt 110;$i++){
  $names=[System.Collections.Generic.List[string]]::new()
  foreach($root in @(Roots)){
   foreach($node in $root.FindAll($scope,[System.Windows.Automation.Condition]::TrueCondition)){
    $name=$node.Current.Name
    if($name -and $name.Length -lt 500){$names.Add($name)}
   }
  }
  $visible=[string]::Join([Environment]::NewLine,$names)
  if($visible.Contains('Запись T2 не подтверждена:')){throw 'D07_IMPORT_POST_IMPORT_KERNEL_SAVE_FAILED'}
  # UI Automation may expose the receipt and its revision as separate
  # accessible nodes. The receipt is generated by the original T2 save/readback.
  # Exact revision, Object ID and all subject works are verified independently
  # after the second cold browser start, below.
  if($visible.Contains('Заказ сохранён и повторно прочитан.')){
   $receipt=$true;break
  }
  Start-Sleep -Milliseconds 300
 }
 if(!$receipt){
   # Report only public UI state flags, never order contents, IDs or other
   # private data. A missing receipt is not proof of a failed Kernel write.
   Write-Output ('D07_IMPORT_SAVE_BUTTON_ENABLED='+[bool](Locate 'Сохранить заказ' ([System.Windows.Automation.ControlType]::Button)))
   Write-Output ('D07_IMPORT_SAVE_NOTICE_CONFIRMED='+[bool]($visible.Contains('Заказ сохранён и повторно прочитан.')))
   Write-Output ('D07_IMPORT_SAVE_NOTICE_KERNEL_ERROR='+[bool]($visible.Contains('Запись T2 не подтверждена:')))
   Write-Output ('D07_IMPORT_SAVE_NOTICE_IMPORT_REVIEW='+[bool]($visible.Contains('Нужно сверить импортированные данные')))
   Write-Output ('D07_IMPORT_SAVE_NOTICE_PENDING='+[bool]($visible.Contains('Проверьте прежнее сохранение')))
   Write-Output ('D07_IMPORT_SAVE_NOTICE_INVALID='+[bool]($visible.Contains('Проверьте заполнение заказа')))
   $revisionMatches=[regex]::Matches($visible,'Редакция\s+(\d+)|редакция:\s*(\d+);')
   $revisions=@($revisionMatches|ForEach-Object{if($_.Groups[1].Success){$_.Groups[1].Value}else{$_.Groups[2].Value}}|Select-Object -Unique)
   Write-Output ('D07_IMPORT_VISIBLE_REVISION_NUMBERS='+($revisions -join ','))
   throw 'D07_IMPORT_POST_IMPORT_REVISION_RECEIPT_MISSING'
 }
 Write-Output 'D07_IWXA_NATIVE_POST_IMPORT_KERNEL_REVISION=PASS'
 # A second cold open must read the new task, revision and original works.
 try{$reopened.Kill($true)}catch{}
 $reopened=$null
 Start-Sleep -Milliseconds 1300
 $reopened=StartEdge ($Origin+'/workspace/')
 $null=Await 'Мои услуги' $null 'D07_IMPORT_SECOND_COLD_HOST_NOT_OPENED'
 $taskRecovered=$false
 for($i=0;$i -lt 105;$i++){
  $task=Locate 'Задача текущего заказа' ([System.Windows.Automation.ControlType]::Edit)
  if($task){
   try{
    $value=[System.Windows.Automation.ValuePattern]$task.GetCurrentPattern(
     [System.Windows.Automation.ValuePattern]::Pattern)
    if($value.Current.Value -ceq $nextTask){$taskRecovered=$true;break}
   }catch{}
  }
  Start-Sleep -Milliseconds 380
 }
 if(!$taskRecovered){throw 'D07_IMPORT_SECOND_COLD_TASK_NOT_PERSISTED'}
 Write-Output 'D07_IWXA_NATIVE_POST_IMPORT_SECOND_COLD_REOPEN=PASS'
 $details=Await 'Технические сведения о записи' $null 'D07_IMPORT_SECOND_COLD_DETAILS_MISSING'
 # A cold Edge session can restore <details> in either state. Blind Invoke
 # may collapse already-open technical data and create a false Object ID loss.
 # First search the exact order witness; expand only when it is not exposed.
 function VisibleColdWitness {
  $values=[System.Collections.Generic.List[string]]::new()
  foreach($root in @(Roots)){
   foreach($node in $root.FindAll($scope,[System.Windows.Automation.Condition]::TrueCondition)){
    $name=$node.Current.Name
    if($name -and $name.Length -lt 500){$values.Add($name)}
   }
  }
  return [string]::Join([Environment]::NewLine,$values)
 }
 function EnsureColdTechnicalVisible {
  $current=VisibleColdWitness
  if($current.Contains('Object ID:') -and $current.Contains($expectedId)){return}
  try{
   $expander=[System.Windows.Automation.ExpandCollapsePattern]$details.GetCurrentPattern(
    [System.Windows.Automation.ExpandCollapsePattern]::Pattern)
   if($expander.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Collapsed){
    $expander.Expand()
   }
  }catch{
   $details.SetFocus()
   [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  }
 }
 EnsureColdTechnicalVisible
 $sameId=$false;$sameWorks=$false;$sameRevision=$false
 $sawIdLabel=$false;$sawExactId=$false
 for($i=0;$i -lt 85;$i++){
  $visible=VisibleColdWitness
  $sawIdLabel=$visible.Contains('Object ID:')
  $sawExactId=$visible.Contains($expectedId)
  # UIA sometimes represents the label and its React text node separately.
  # The *exact* original ID and label must both be present in this order UI.
  $sameId=$sawIdLabel -and $sawExactId
  $sameWorks=(@($titles|Where-Object{$visible.Contains($_)}).Count -eq 10)
  $sameRevision=$visible.Contains('редакция: '+$newRevision+';')
  if($sameId -and $sameWorks -and $sameRevision){break}
  if($i -eq 25 -or $i -eq 55){EnsureColdTechnicalVisible}
  Start-Sleep -Milliseconds 320
 }
 if(!$sameId -or !$sameRevision -or !$sameWorks){
  # Only booleans are logged; no private IDs, titles or order text.
  Write-Output ('D07_IMPORT_SECOND_COLD_ID_LABEL_VISIBLE='+$sawIdLabel)
  Write-Output ('D07_IMPORT_SECOND_COLD_EXACT_ID_VISIBLE='+$sawExactId)
  Write-Output ('D07_IMPORT_SECOND_COLD_REVISION_2_VISIBLE='+$sameRevision)
  Write-Output ('D07_IMPORT_SECOND_COLD_TEN_WORKS_VISIBLE='+$sameWorks)
 }
 if(!$sameId){throw 'D07_IMPORT_POST_IMPORT_OBJECT_ID_CHANGED'}
 if(!$sameRevision){throw 'D07_IMPORT_POST_IMPORT_REVISION_LOST'}
 if(!$sameWorks){throw 'D07_IMPORT_POST_IMPORT_TEN_WORKS_LOST'}
 Write-Output 'D07_IWXA_NATIVE_POST_IMPORT_ID_TEN_WORKS_PRESERVED=PASS'
 Write-Output 'D07_IWXA_NATIVE_POST_IMPORT_DURABLE_CONTINUATION=PASS'
 Write-Output 'D07_IWXA_NATIVE_CUSTOMER_RESULT_ACCEPTANCE=NOT_RUN'
}finally{
 if($browser){try{$browser.Kill($true)}catch{}}
 if($reopened){try{$reopened.Kill($true)}catch{}}
 if($server){Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue}
}
