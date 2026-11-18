# Public knowledge: NEW independent native Windows UIA witness for installed
# private Admin Center first-use. Only UI labels and PASS codes leave runner.
# No browser automation, no private source/logs, no imitation signed owner.
param([Parameter(Mandatory=$true)][string]$InstallRoot)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class G4NativeMouse {
  [DllImport("user32.dll")] public static extern void mouse_event(
    uint flags,uint dx,uint dy,uint data,UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool PostMessage(
    IntPtr handle,uint msg,IntPtr w,IntPtr l);
}
'@
function Check([bool]$condition,[string]$code){
  if(-not $condition){throw $code}
}
$installed=(Resolve-Path -LiteralPath $InstallRoot).Path
$exe=Join-Path $installed 'iwxa-admin-center.exe'
Check (Test-Path -LiteralPath $exe -PathType Leaf) 'G4_INSTALLED_FIRST_USE_EXE_MISSING'
$global:appProcess=$null
$script:phase='INIT'
function DesktopRoot(){
  $global:appProcess.Refresh()
  Check (-not $global:appProcess.HasExited) 'G4_INSTALLED_FIRST_USE_WINDOW_EXITED'
  $handle=$global:appProcess.MainWindowHandle
  Check ($handle -ne [IntPtr]::Zero) 'G4_INSTALLED_FIRST_USE_HANDLE_MISSING'
  return [System.Windows.Automation.AutomationElement]::FromHandle($handle)
}
function FindName([string]$name,[string]$controlType='Button',[int]$retries=65){
  $target=if($controlType -eq 'Edit') {
    [System.Windows.Automation.ControlType]::Edit
  }else{[System.Windows.Automation.ControlType]::Button}
  for($i=0;$i -lt $retries;$i++){
    $root=DesktopRoot
    $items=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::NameProperty,$name))
    foreach($item in $items){
      try{if($item.Current.ControlType -eq $target){return $item}}catch{}
    }
    Start-Sleep -Milliseconds 320
  }
  throw ('G4_INSTALLED_FIRST_USE_UI_MISSING_'+$controlType.ToUpperInvariant()+'_'+$script:phase)
}
function ClickButton([string]$label){
  $control=FindName $label 'Button'
  $scroll=$null
  if($control.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern,[ref]$scroll)){
    $scroll.ScrollIntoView()
    Start-Sleep -Milliseconds 170
  }
  $bounds=$control.Current.BoundingRectangle
  Check ($control.Current.IsEnabled -and -not $control.Current.IsOffscreen -and
    $bounds.Width -ge 2 -and $bounds.Height -ge 2) 'G4_INSTALLED_FIRST_USE_UI_BUTTON_NOT_CLICKABLE'
  [System.Windows.Forms.Cursor]::Position=[System.Drawing.Point]::new(
    [int][Math]::Round($bounds.Left+$bounds.Width/2),
    [int][Math]::Round($bounds.Top+$bounds.Height/2))
  [G4NativeMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [G4NativeMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 420
}
function TypeText([string]$label,[string]$value){
  $field=FindName $label 'Edit'
  $field.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  [System.Windows.Forms.SendKeys]::SendWait($value)
  Start-Sleep -Milliseconds 250
}
function HasText([string]$fragment){
  $root=DesktopRoot
  $elements=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition)
  foreach($element in $elements){
    try{if(([string]$element.Current.Name).Contains($fragment)){return $true}}catch{}
  }
  return $false
}
function ClickNativeChoice([bool]$confirm){
  for($i=0;$i -lt 90;$i++){
    $windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition)
    foreach($window in $windows){
      try{
        $title=[string]$window.Current.Name
        $ownsProcess=($window.Current.ProcessId -eq $global:appProcess.Id)
        $expectedTitle=$title.Contains('IWXA T3: подключить организацию')
        if(-not $ownsProcess -and -not $expectedTitle){continue}
        $buttons=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,
          [System.Windows.Automation.Condition]::TrueCondition)
        if(-not $expectedTitle){
          # Native Windows TaskDialog can expose its title in a static
          # descendant instead of as the top-level window name. Accept it
          # only under the exact installed Center PID, never another app.
          $expectedTitle=$false
          foreach($content in $buttons){
            $message=[string]$content.Current.Name
            if($message.Contains('IWXA T3: подключить организацию') -or
               $message.Contains('Создать подписанную организацию T3')){
              $expectedTitle=$true;break
            }
          }
        }
        if(-not $expectedTitle){continue}
        foreach($button in $buttons){
          if($button.Current.ControlType -ne [System.Windows.Automation.ControlType]::Button){continue}
          $label=[string]$button.Current.Name
          $wanted=if($confirm){$label -match '^(?:&?Да|&?Yes|OK)$'}
                  else{$label -match '^(?:&?Нет|&?No|Cancel|Отмена)$'}
          if(-not $wanted){continue}
          $p=$button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
          $p.Invoke()
          return
        }
      }catch{}
    }
    Start-Sleep -Milliseconds 250
  }
  # The native handler may refuse before showing a dialog (for example
  # when the manager draft is still being saved). Report only known product
  # machine codes. Never print the organization name or private UI content.
  foreach($code in @(
    'CEN_D3_SIGNED_ENROLLMENT_DRAFT_NOT_READY',
    'CEN_D3_SIGNED_ENROLLMENT_DRAFT_SAVE_UNCONFIRMED',
    'CEN_D3_SIGNED_ENROLLMENT_DRAFT_READBACK_MISMATCH',
    'CEN_D3_ORIGINAL_OWNER_NOT_BUNDLED',
    'CEN_D3_ENROLLMENT_CANCELLED')){
    if(HasText $code){Write-Host "G4_INSTALLED_FIRST_USE_MODAL_PREREQUISITE_CODE $code"}
  }
  throw 'G4_INSTALLED_FIRST_USE_NATIVE_MESSAGE_DIALOG_MISSING'
}
function StartCenter(){
  $global:appProcess=Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru
  for($i=0;$i -lt 90;$i++){
    Start-Sleep -Milliseconds 400
    $global:appProcess.Refresh()
    Check (-not $global:appProcess.HasExited) 'G4_INSTALLED_FIRST_USE_PREMATURE_EXIT'
    if($global:appProcess.MainWindowHandle -ne [IntPtr]::Zero){return}
  }
  throw 'G4_INSTALLED_FIRST_USE_NATIVE_WINDOW_MISSING'
}
function CloseCenter([bool]$strict=$true){
  if(!$global:appProcess){return}
  try{
    $global:appProcess.Refresh()
    if(!$global:appProcess.HasExited){
      $h=$global:appProcess.MainWindowHandle
      if($h -ne [IntPtr]::Zero){
        $sent=[G4NativeMouse]::PostMessage($h,0x10,[IntPtr]::Zero,[IntPtr]::Zero)
        if($strict){Check $sent 'G4_INSTALLED_FIRST_USE_WM_CLOSE_FAILED'}
      }
      $closed=$global:appProcess.WaitForExit($(if($strict){15000}else{2500}))
      if($strict){Check $closed 'G4_INSTALLED_FIRST_USE_GRACEFUL_CLOSE_FAILED'}
    }
  }finally{
    # When the tested native UI has legitimately refused WM_CLOSE because of
    # an unsaved editor, cleanup may kill ONLY the CI fixture process. Never
    # treat that as a passed graceful close or overwrite the first failure.
    try{$global:appProcess.Refresh();if(!$global:appProcess.HasExited){$global:appProcess.Kill()}}catch{}
    $global:appProcess.Dispose()
    $global:appProcess=$null
  }
}
try{
  StartCenter
  $script:phase='CREATE_ORGANIZATION'
  TypeText 'Название' 'G4WindowsOrganization'
  ClickButton 'Создать черновик организации'
  $script:phase='CREATE_ORDINARY_WORKSPACE'
  ClickButton 'Планы Atlas'
  TypeText 'Название рабочей области' 'G4CorporateWorkspace'
  ClickButton 'Добавить'
  Check (HasText 'G4CorporateWorkspace') 'G4_INSTALLED_WORKSPACE_WITHOUT_ATLAS_NOT_CREATED'
  Write-Host 'G4_INSTALLED_ORDINARY_WORKSPACE_WITHOUT_ATLAS_PASS'
  # Persist the real manager draft before the cold installed reopen.
  # The signed owner and the ordinary Center organization remain
  # distinct; neither silently reconstructs the other's storage.
  $script:phase='SAVE_MANAGER_DRAFT'
  ClickButton 'Сохранить на компьютере'
  Write-Host 'G4_INSTALLED_FIRST_USE_MANAGER_SAVE_CLICKED'
  $script:phase='WAIT_DRAFT_SAVE_READBACK'
  $draftSaved=$false
  for($i=0;$i -lt 90;$i++){
    if(HasText 'Черновики сохранены на этом компьютере'){
      $draftSaved=$true;break
    }
    Start-Sleep -Milliseconds 250
  }
  Check $draftSaved 'G4_INSTALLED_FIRST_USE_MANAGER_SAVE_READBACK_MISSING'
  Write-Host 'G4_INSTALLED_FIRST_USE_MANAGER_SAVE_READBACK_PASS'
  $script:phase='OPEN_RESULT_PANEL'
  ClickButton 'Результаты'
  Write-Host 'G4_INSTALLED_FIRST_USE_RESULTS_OPENED'
  $script:phase='FIND_NATIVE_T3_ENROLL'
  $enroll=FindName 'Подключить организацию' 'Button'
  Check $enroll.Current.IsEnabled 'G4_INSTALLED_FIRST_USE_ENROLL_NOT_AVAILABLE'
  $script:phase='CANCEL_T3_ENROLL'
  ClickButton 'Подключить организацию'
  ClickNativeChoice $false
  Start-Sleep -Milliseconds 450
  Check (HasText 'NOT_CONNECTED') 'G4_INSTALLED_FIRST_USE_CANCEL_ISSUED_OWNER'
  Write-Host 'G4_INSTALLED_FIRST_USE_NATIVE_CANCEL_NO_OWNER_PASS'
  $script:phase='CONFIRM_T3_ENROLL'
  ClickButton 'Подключить организацию'
  ClickNativeChoice $true
  $connected=$false
  for($i=0;$i -lt 70;$i++){
    if(HasText 'Подписанный T3 D3 получатель доступен'){$connected=$true;break}
    Start-Sleep -Milliseconds 350
  }
  Check $connected 'G4_INSTALLED_FIRST_USE_ORIGINAL_OWNER_NOT_CONNECTED'
  Write-Host 'G4_INSTALLED_FIRST_USE_NATIVE_WINDOWS_ENROLL_PASS'
  $script:phase='SIGNED_OWNER_COLD_CLOSE'
  CloseCenter
  $script:phase='SIGNED_OWNER_COLD_RESTART'
  StartCenter
  ClickButton 'Результаты'
  $durable=$false
  for($i=0;$i -lt 70;$i++){
    if(HasText 'Подписанный T3 D3 получатель доступен'){$durable=$true;break}
    Start-Sleep -Milliseconds 350
  }
  Check $durable 'G4_INSTALLED_FIRST_USE_COLD_OWNER_NOT_RESTORED'
  Write-Host 'G4_INSTALLED_FIRST_USE_ORIGINAL_DPAPI_COLD_RESTART_PASS'
}finally{
  if($global:appProcess){
    try{CloseCenter -strict $false}catch{
      # Preserve the actual UI/owner failure from the primary try block.
      Write-Host 'G4_INSTALLED_FIRST_USE_CLEANUP_NONBLOCKING'
    }
  }
}
