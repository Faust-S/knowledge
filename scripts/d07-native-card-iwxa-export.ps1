param([string]$SiteDir="site",[string]$Origin="https://127.0.0.1:55407")
$ErrorActionPreference="Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$site=(Resolve-Path $SiteDir).Path
$edge=@((Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Microsoft\Edge\Application\msedge.exe'),(Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Microsoft\Edge\Application\msedge.exe'))|Where-Object{Test-Path $_}|Select-Object -First 1
if(!$edge){throw 'D07_IWXA_EDGE_NOT_FOUND'}
$profile=Join-Path $env:RUNNER_TEMP 'd07-native-card-profile'
if(!(Test-Path $profile)){throw 'D07_IWXA_ORIGINAL_PROFILE_MISSING'}
$download=Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads'
New-Item -ItemType Directory -Force $download|Out-Null
if(@(Get-ChildItem $download -Filter '*.iwxa' -File -ErrorAction SilentlyContinue).Count -ne 0){throw 'D07_IWXA_DOWNLOAD_NOT_EMPTY'}
$browser=$null;$server=$null
function Roots {
 foreach($p in @(Get-Process msedge -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle -ne 0})){
  try{$root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$p.MainWindowHandle);if($root){$root}}catch{}
 }
}
function Locate([string]$name,$controlType){
 $scope=[System.Windows.Automation.TreeScope]::Descendants
 $condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$name)
 if($controlType){$condition=[System.Windows.Automation.AndCondition]::new($condition,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,$controlType))}
 foreach($root in @(Roots)){$x=$root.FindFirst($scope,$condition);if($x -and $x.Current.IsEnabled){return $x}}
 return $null
}
function Await([string]$name,$controlType,[string]$code){
 for($i=0;$i -lt 80;$i++){$x=Locate $name $controlType;if($x){return $x};Start-Sleep -Milliseconds 500}
 throw $code
}
function Click([string]$name,[string]$code){
 $x=Await $name ([System.Windows.Automation.ControlType]::Button) $code
 $pattern=[System.Windows.Automation.InvokePattern]$x.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
 $pattern.Invoke()
}
try{
 $server=Start-Process -FilePath node -WorkingDirectory $site -ArgumentList @('scripts/preview-d07-integrated-site.mjs') -RedirectStandardOutput (Join-Path $env:RUNNER_TEMP 'd07-iwxa-export-server.private.log') -RedirectStandardError (Join-Path $env:RUNNER_TEMP 'd07-iwxa-export-server-error.private.log') -PassThru
 $ready=$false
 for($i=0;$i -lt 65;$i++){Start-Sleep -Milliseconds 500;try{if((Invoke-WebRequest -Uri ($Origin+'/workspace/exchange/') -SkipCertificateCheck -TimeoutSec 2).StatusCode -eq 200){$ready=$true;break}}catch{}}
 if(!$ready){throw 'D07_IWXA_NATIVE_HOST_NOT_READY'}
 $browser=Start-Process -FilePath $edge -ArgumentList @('--force-renderer-accessibility','--ignore-certificate-errors','--no-first-run','--no-default-browser-check',"--user-data-dir=$profile","--app=$Origin/workspace/exchange/#/home") -PassThru
 $null=Await 'Перенос данных' $null 'D07_IWXA_NATIVE_EXCHANGE_MISSING'
 if(Locate 'Операция «Перенос данных» не предоставлена ядром в текущем режиме.' $null){throw 'D07_IWXA_EXCHANGE_NOT_GRANTED'}
 $null=Await 'Экспортировать' $null 'D07_IWXA_EXPORT_TAB_MISSING'
 $cond=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::CheckBox)
 $choice=$null
 for($k=0;$k -lt 50;$k++){
  foreach($root in @(Roots)){
   $items=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$cond)
   foreach($item in $items){
    if($item.Current.IsOffscreen -or !$item.Current.IsEnabled){continue}
    $name=$item.Current.Name
    if($name -and $name -notmatch '^(?:История событий|Ассеты$|Связи$|Схемы$)'){
     if($choice){throw 'D07_IWXA_MULTIPLE_WORKSPACES_UNSCOPED'}
     $choice=$item
    }
   }
  }
  if($choice){break}
  Start-Sleep -Milliseconds 500
 }
 if(!$choice){throw 'D07_IWXA_SOURCE_WORKSPACE_NOT_FOUND'}
 $toggle=[System.Windows.Automation.TogglePattern]$choice.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
 if($toggle.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::On){$toggle.Toggle()}
 Click 'Предпросмотр' 'D07_IWXA_EXPORT_PREVIEW_FAILED'
 Click 'Собрать архив' 'D07_IWXA_EXPORT_PACK_FAILED'
 Click 'Скачать .iwxa' 'D07_IWXA_DOWNLOAD_DISABLED'
 $file=$null
 for($i=0;$i -lt 70;$i++){
  $found=@(Get-ChildItem $download -Filter '*.iwxa' -File -ErrorAction SilentlyContinue|Where-Object{$_.Length -gt 128})
  if($found.Count -eq 1){$file=$found[0];break}
  Start-Sleep -Milliseconds 500
 }
 if(!$file){throw 'D07_IWXA_NO_PHYSICAL_ARCHIVE'}
 $hash=(Get-FileHash -Path $file.FullName -Algorithm SHA256).Hash
 if($hash.Length -ne 64){throw 'D07_IWXA_ARCHIVE_SHA_INVALID'}
 Write-Output 'D07_IWXA_PHYSICAL_EXPORT=PASS'
 Click 'Подтвердить приём' 'D07_IWXA_CONFIRM_RECEIPT_MISSING'
 $null=Await 'Приём подтверждён' $null 'D07_IWXA_ORIGINAL_RECEIPT_MISSING'
 Write-Output 'D07_IWXA_ORIGINAL_EXPORT_RECEIPT=PASS'
}finally{
 if($browser){try{$browser.Kill($true)}catch{}}
 if($server){Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue}
}
