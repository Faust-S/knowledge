param([string]$SiteDir="site",[string]$Origin="https://127.0.0.1:55407")
$ErrorActionPreference="Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
$site=(Resolve-Path $SiteDir).Path
$edge=@(
 (Join-Path ([Environment]::GetFolderPath("ProgramFilesX86")) "Microsoft\Edge\Application\msedge.exe"),
 (Join-Path ([Environment]::GetFolderPath("ProgramFiles")) "Microsoft\Edge\Application\msedge.exe")
) | Where-Object {Test-Path $_} | Select-Object -First 1
if(-not $edge){throw "D07_NATIVE_CARD_EDGE_NOT_FOUND"}
$profile=Join-Path $env:RUNNER_TEMP "d07-native-card-profile"
$server=$null
$browsers=[System.Collections.Generic.List[int]]::new()
function Roots {
 return @(Get-Process msedge -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle -ne 0})
}
function FindUi([string]$name,$kind){
 $match=[System.Windows.Automation.PropertyCondition]::new(
   [System.Windows.Automation.AutomationElement]::NameProperty,$name)
 $cond=if($kind){[System.Windows.Automation.AndCondition]::new($match,
  [System.Windows.Automation.PropertyCondition]::new(
   [System.Windows.Automation.AutomationElement]::ControlTypeProperty,$kind))}else{$match}
 $fallback=$null
 foreach($p in @(Roots)){
  $root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
  if(!$root){continue}
  $found=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$cond)
  for($i=0;$i -lt $found.Count;$i++){
    $node=$found.Item($i)
    if(!$fallback){$fallback=$node}
    # UIA "offscreen" also marks controls below the viewport in Edge;
    # it is NOT a disabled action. InvokePattern supports such controls.
    if($node.Current.IsEnabled){return $node}
  }
 }
 return $fallback
}
function WaitUi([string]$name,$kind,[int]$retries=80){
 for($i=0;$i -lt $retries;$i++){
  $v=FindUi $name $kind
  if($v){return $v}
  Start-Sleep -Milliseconds 450
 }
 throw ("D07_NATIVE_CARD_UI_NOT_FOUND_"+$name)
}
function ClickUi([string]$name,$kind){
 # An element can appear in Edge UIA before React has finished initializing
 # the original T2 Host. Only a genuinely enabled action is clickable.
 $v=$null
 for($attempt=0;$attempt -lt 85;$attempt++){
  $candidate=FindUi $name $kind
  if($candidate -and $candidate.Current.IsEnabled){$v=$candidate;break}
  Start-Sleep -Milliseconds 400
 }
 if(!$v){
   $observed=FindUi $name $kind
   Write-Output ("D07_NATIVE_CARD_ACTION_PRESENT="+[bool]$observed)
   if($observed){
     Write-Output ("D07_NATIVE_CARD_ACTION_ENABLED="+$observed.Current.IsEnabled)
     Write-Output ("D07_NATIVE_CARD_ACTION_OFFSCREEN="+$observed.Current.IsOffscreen)
   }
   throw "D07_NATIVE_CARD_UI_ACTION_NOT_ENABLED"
 }
 # An enabled button may simply be below the fold in the real browser.
 if($v.Current.IsOffscreen){
   try{
     $scroll=[System.Windows.Automation.ScrollItemPattern]$v.GetCurrentPattern(
       [System.Windows.Automation.ScrollItemPattern]::Pattern)
     $scroll.ScrollIntoView()
   }catch{
     # Non-scrollable React buttons remain invokable through native UIA.
   }
 }
 $pattern=[System.Windows.Automation.InvokePattern]$v.GetCurrentPattern(
  [System.Windows.Automation.InvokePattern]::Pattern)
 $pattern.Invoke()
 Start-Sleep -Milliseconds 500
}
function ClickLastButton([string]$name){
 $n=[System.Windows.Automation.PropertyCondition]::new(
  [System.Windows.Automation.AutomationElement]::NameProperty,$name)
 $t=[System.Windows.Automation.PropertyCondition]::new(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Button)
 $cond=[System.Windows.Automation.AndCondition]::new($n,$t)
 for($k=0;$k -lt 60;$k++){
  foreach($p in @(Roots)){
   $root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
   if(!$root){continue}
   $all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$cond)
   for($i=$all.Count-1;$i -ge 0;$i--){
    $v=$all.Item($i)
    if(!$v.Current.IsEnabled -or $v.Current.IsOffscreen){continue}
    $pattern=[System.Windows.Automation.InvokePattern]$v.GetCurrentPattern(
     [System.Windows.Automation.InvokePattern]::Pattern)
    $pattern.Invoke();return
   }
  }
  Start-Sleep -Milliseconds 450
 }
 throw "D07_NATIVE_CARD_CONFIRM_BUTTON_MISSING"
}
function AccessibleText {
 $names=[System.Collections.Generic.List[string]]::new()
 foreach($p in @(Roots)){
  $root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
  if(!$root){continue}
  $items=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
   [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Text))
  for($i=0;$i -lt $items.Count;$i++){
   $v=$items.Item($i).Current.Name
   if($v -and $v.Length -lt 1000){$names.Add($v)}
  }
 }
 return [string]::Join([Environment]::NewLine,$names)
}
function OpenEdge([string]$url){
 $proc=Start-Process -FilePath $edge -ArgumentList @(
  "--force-renderer-accessibility","--ignore-certificate-errors",
  "--no-first-run","--no-default-browser-check",
  "--user-data-dir=$profile","--app=$url") -PassThru
 if($proc){$browsers.Add($proc.Id)}
 return $proc
}
function CloseEdge($proc){
 if($proc){try{$proc.Kill($true)}catch{}}
 Start-Sleep -Milliseconds 750
}
try{
 $server=Start-Process -FilePath "node" -WorkingDirectory $site -ArgumentList @("scripts/preview-d07-integrated-site.mjs") -RedirectStandardOutput (Join-Path $env:RUNNER_TEMP "d07-card-host.private.log") -RedirectStandardError (Join-Path $env:RUNNER_TEMP "d07-card-host-error.private.log") -PassThru
 $alive=$false
 for($i=0;$i -lt 60;$i++){
  Start-Sleep -Milliseconds 600
  try{$r=Invoke-WebRequest -Uri ($Origin+"/workspace/") -SkipCertificateCheck -TimeoutSec 2
   if($r.StatusCode -eq 200){$alive=$true;break}}catch{}
 }
 if(!$alive){throw "D07_NATIVE_CARD_ORIGINAL_T2_HOST_UNAVAILABLE"}
 Write-Output "D07_NATIVE_CARD_REAL_T2_HTTPS=PASS"
 $services=@(
  @("zamena-unitaza","Замена унитаза"),
  @("ustanovka-rakoviny","Установка раковины"),
  @("razvodka-trub","Разводка труб"),
  @("ustranenie-protechki","Устранение протечки"),
  @("prochistka-kanalizacii","Прочистка канализации"))
 $startHref=$null
 foreach($pair in $services){
  $slug=$pair[0];$title=$pair[1]
  $url=$Origin+"/uslugi/remont-dom-mastera/"+$slug+"/"
  $response=Invoke-WebRequest -Uri $url -SkipCertificateCheck -TimeoutSec 15
  if($response.StatusCode -ne 200){throw "D07_NATIVE_CARD_PAGE_HTTP_ERROR"}
  $html=$response.Content -replace "&amp;","&"
  if($html -notmatch "d07-professional-service-card" -or
     $html -notmatch "d07-professional-start-order" -or
     $html -notmatch "/workspace/\?new=1"){
   throw "D07_NATIVE_CARD_PAGE_CONTENT_MISSING"
  }
  if($slug -eq "zamena-unitaza"){
   if($html -notmatch 'href="(?<href>/workspace/\?new=1[^"]+)"'){throw "D07_NATIVE_CARD_URL_SEED_MISSING"}
   $startHref=$Matches["href"]
  }
  $browser=OpenEdge $url
  $null=WaitUi $title ([System.Windows.Automation.ControlType]::Text) 100
  $null=WaitUi "Начать заказ в Workspace" ([System.Windows.Automation.ControlType]::Hyperlink) 65
  Write-Output ("D07_NATIVE_CARD_EDGE_"+$slug+"=PASS")
  CloseEdge $browser
 }
 if(!$startHref){throw "D07_NATIVE_CARD_SEED_NOT_EXTRACTED"}
 Write-Output "D07_NATIVE_CARD_FIVE_EDGE_PAGES=PASS"
 $browser=OpenEdge ($Origin+"/uslugi/remont-dom-mastera/zamena-unitaza/")
 $null=WaitUi "Замена унитаза" $null 90
 ClickUi "Начать заказ в Workspace" ([System.Windows.Automation.ControlType]::Hyperlink)
 $null=WaitUi "Создать рабочую область" ([System.Windows.Automation.ControlType]::Button) 110
 Write-Output "D07_NATIVE_CARD_TO_T2_HOST=PASS"
 ClickUi "Создать рабочую область" ([System.Windows.Automation.ControlType]::Button)
 ClickUi "Новая рабочая область" ([System.Windows.Automation.ControlType]::Button)
 ClickLastButton "Создать рабочую область"
 $created=$false
 for($i=0;$i -lt 80;$i++){Start-Sleep -Milliseconds 450
  if((AccessibleText) -match "Рабочая область\s*·\s*ws-"){$created=$true;break}
 }
 if(!$created){throw "D07_NATIVE_CARD_CREATE_WORKSPACE_FAILED"}
 Write-Output "D07_NATIVE_CARD_WORKSPACE_CREATED=PASS"
 ClickUi "Мои услуги" ([System.Windows.Automation.ControlType]::Hyperlink)
 $null=WaitUi "Сохранённые заказы" $null 70
 $combo=$null
 foreach($p in @(Roots)){
  $root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle)
  if(!$root){continue}
  $all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
   [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::ComboBox))
  if($all.Count -ge 1){$combo=$all.Item(0);break}
 }
 if(!$combo){throw "D07_NATIVE_CARD_WORKSPACE_SELECTOR_MISSING"}
 $combo.SetFocus()
 [System.Windows.Forms.SendKeys]::SendWait("{HOME}")
 [System.Windows.Forms.SendKeys]::SendWait("{DOWN}")
 [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
 $null=WaitUi "Рабочая область выбрана" $null 70
 Write-Output "D07_NATIVE_CARD_WORKSPACE_SELECTED=PASS"
 CloseEdge $browser
 $browser=OpenEdge ($Origin+$startHref)
 $null=WaitUi "Работы для выбранной услуги" $null 110
 # Edge UIA can split the count in "10 основных работ" across separate
 # accessibility text nodes. Verify the exact *ten source operations* instead
 # of accepting a generic template or relying on a fragile text-node join.
 # Read exact operation titles from the PINNED PRIVATE subject model in the
 # disposable runner. The public workflow contains no proprietary methods.
 $program='import {findSubjectProtocol} from "./src/domain/service-subject-protocols.ts";const p=findSubjectProtocol("remont-dom-mastera","zamena-unitaza");if(!p)process.exit(3);process.stdout.write(JSON.stringify(p.operations.filter(o=>o.billing!=="separately-agreed").map(o=>o.title)));'
 Push-Location $site
 try{
   $titlesJson=& node --import tsx --input-type=module -e $program
   if($LASTEXITCODE -ne 0){throw "D07_NATIVE_CARD_PRIVATE_PROTOCOL_UNAVAILABLE"}
   $exactTitles=@($titlesJson|ConvertFrom-Json)
 }finally{Pop-Location}
 if($exactTitles.Count -ne 10 -or
    @($exactTitles|Where-Object{![string]::IsNullOrWhiteSpace($_)}).Count -ne 10){
   throw "D07_NATIVE_CARD_SUBJECT_OPERATION_SET_INVALID"
 }
 # Edge UIA does not expose children of a collapsed <details>. Verify
 # exact authored operations after the genuine "add to order" action instead.
 $initialText=AccessibleText
 if($initialText -notmatch "Замена унитаза" -or
    $initialText -notmatch "Работы для выбранной услуги"){
   throw "D07_NATIVE_CARD_T2_WRONG_SELECTED_SERVICE"
 }
 ClickUi "Добавить работы в заказ" ([System.Windows.Automation.ControlType]::Button)
 $matchedOperations=0;$added=$false
 for($attempt=0;$attempt -lt 65;$attempt++){
   Start-Sleep -Milliseconds 350
   $text=AccessibleText
   $matchedOperations=@($exactTitles|Where-Object{$text.Contains($_)}).Count
   if($matchedOperations -eq 10 -and $text -match 'Работ:\s*10'){
     $added=$true;break
   }
 }
 Write-Output ("D07_NATIVE_CARD_DRAFT_OPERATION_MATCHES="+$matchedOperations)
 if(!$added){throw "D07_NATIVE_CARD_T2_PLAN_NOT_APPLIED"}
 Write-Output "D07_NATIVE_CARD_T2_EXACT_PLAN=PASS"
 Write-Output "D07_NATIVE_CARD_T2_PLAN_APPLIED=PASS"
 # Current T2 Host checks the candidate against Kernel and the current
 # Workspace directly; the obsolete consent checkbox must not be invented.
 $preflight=FindUi "Проверить заказ через Kernel" ([System.Windows.Automation.ControlType]::Button)
 if($preflight -and $preflight.Current.IsEnabled){
   ClickUi "Проверить заказ через Kernel" ([System.Windows.Automation.ControlType]::Button)
 }
 $readyToSave=$false
 for($k=0;$k -lt 70;$k++){
   $saveButton=FindUi "Сохранить заказ" ([System.Windows.Automation.ControlType]::Button)
   if($saveButton -and $saveButton.Current.IsEnabled){$readyToSave=$true;break}
   Start-Sleep -Milliseconds 450
 }
 if(!$readyToSave){throw "D07_NATIVE_CARD_T2_SAVE_BLOCKED_BY_PREFLIGHT"}
 ClickUi "Сохранить заказ" ([System.Windows.Automation.ControlType]::Button)
 $saved=$false
 for($i=0;$i -lt 85;$i++){Start-Sleep -Milliseconds 400
  $text=AccessibleText
  if($text -match "Заказ сохранён и повторно прочитан" -and
     $text -match "Редакция\s+1" -and $text -match "Событие"){$saved=$true;break}
 }
 if(!$saved){throw "D07_NATIVE_CARD_KERNEL_SAVE_UNCONFIRMED"}
 Write-Output "D07_NATIVE_CARD_T2_KERNEL_SAVE=PASS"
 # Preserve the exact original Kernel object identity for an independent
 # recipient readback. The profile is not evidence by itself, and a count of
 # one order after import is insufficient without the same Object ID.
 $details=WaitUi "Технические сведения о записи" $null 45
 try {
   $p=[System.Windows.Automation.InvokePattern]$details.GetCurrentPattern(
     [System.Windows.Automation.InvokePattern]::Pattern)
   $p.Invoke()
 }catch{
   $details.SetFocus()
   [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
 }
 $objectId=$null
 $receiptEvent=$null
 for($i=0;$i -lt 40;$i++){
   Start-Sleep -Milliseconds 300
   $body=AccessibleText
   if($body -match 'Object ID:\s*(d07:order:[a-f0-9]{64})'){$objectId=$Matches[1]}
   if($body -match 'Событие:\s*([^\s\.]{8,200})'){$receiptEvent=$Matches[1]}
   if($objectId -and $receiptEvent){break}
 }
 if(!$objectId -or !$receiptEvent){throw "D07_NATIVE_CARD_KERNEL_IDENTITY_NOT_VISIBLE"}
 $witness=@{
   protocolId="toilet-replacement";serviceSlug="zamena-unitaza"
   objectId=$objectId;eventId=$receiptEvent;works=10
   sourceProfile="d07-native-card-profile"
 }
 $witness|ConvertTo-Json -Compress|Set-Content -Path (
   Join-Path $env:RUNNER_TEMP "d07-native-card-order-identity.private.json") -Encoding UTF8
 Write-Output "D07_NATIVE_CARD_KERNEL_OBJECT_ID_WITNESSED=PASS"
 Write-Output "D07_NATIVE_CARD_T2_RESULT_ACCEPTANCE=NOT_RUN"
 Write-Output "D07_NATIVE_CARD_IWXA_INDEPENDENT_IMPORT=NOT_RUN"
}finally{
 foreach($id in $browsers){Stop-Process -Id $id -Force -ErrorAction SilentlyContinue}
 if($server){Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue}
}
