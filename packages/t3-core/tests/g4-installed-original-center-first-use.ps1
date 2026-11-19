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
public static class G4InstalledModal {
  public delegate bool EnumWindowCallback(IntPtr hwnd,IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(
    EnumWindowCallback callback,IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(
    IntPtr hwnd,out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll",EntryPoint="GetWindowTextW",CharSet=CharSet.Unicode)]
  static extern int GetText(IntPtr hwnd,
    System.Text.StringBuilder buffer,int length);
  [DllImport("user32.dll",EntryPoint="GetClassNameW",CharSet=CharSet.Unicode)]
  static extern int GetClass(IntPtr hwnd,
    System.Text.StringBuilder buffer,int length);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(
    IntPtr hwnd,int itemId);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(
    IntPtr hwnd);
  [StructLayout(LayoutKind.Sequential)]
  public struct Rect {
    public int Left,Top,Right,Bottom;
  }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(
    IntPtr hwnd,out Rect bounds);
  public static IntPtr FindExact(int processId,string exactTitle){
    IntPtr found=IntPtr.Zero;
    EnumWindows((hwnd,state)=>{
      uint actual;GetWindowThreadProcessId(hwnd,out actual);
      if(actual==(uint)processId && IsWindowVisible(hwnd)){
        var text=new System.Text.StringBuilder(256);
        GetText(hwnd,text,text.Capacity);
        if(text.ToString().Equals(exactTitle,StringComparison.Ordinal)){
          found=hwnd;
          return false;
        }
      }
      return true;
    },IntPtr.Zero);
    return found;
  }
  public static int CountOwnedDialogs(int processId){
    int found=0;
    EnumWindows((hwnd,state)=>{
      uint actual;GetWindowThreadProcessId(hwnd,out actual);
      if(actual==(uint)processId && IsWindowVisible(hwnd)){
        var kind=new System.Text.StringBuilder(80);
        GetClass(hwnd,kind,kind.Capacity);
        if(kind.ToString().Equals("#32770",StringComparison.Ordinal))
          found++;
      }
      return true;
    },IntPtr.Zero);
    return found;
  }
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
  # One physical native Windows click on the exact signed enrollment
  # button; InvokePattern can focus without dispatching the React action.
  if($label -eq 'Подключить организацию'){
    $focus=[G4InstalledModal]::SetForegroundWindow(
      $global:appProcess.MainWindowHandle)
    Write-Host "G4_INSTALLED_FIRST_USE_FOREGROUND_REQUEST $focus"
  }
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
function RequireDialogDismissed([IntPtr]$dialog){
  for($poll=0;$poll -lt 90;$poll++){
    if(-not [G4InstalledModal]::IsWindow($dialog) -or
       -not [G4InstalledModal]::IsWindowVisible($dialog)){
      Write-Host 'G4_INSTALLED_FIRST_USE_NATIVE_DIALOG_CLOSED_CONFIRMED'
      return
    }
    Start-Sleep -Milliseconds 120
  }
  throw 'G4_INSTALLED_FIRST_USE_NATIVE_DIALOG_CLICK_NOT_ACKNOWLEDGED'
}
function ClickNativeChoice([bool]$confirm){
  # This is a genuine on-screen native rfd 0.15 TaskDialog, never a
  # direct admin-d3 CLI, stubbed human decision, or an arbitrary HWND.
  for($i=0;$i -lt 100;$i++){
    $dialog=[G4InstalledModal]::FindExact(
      $global:appProcess.Id,'IWXA T3: подключить организацию')
    if($dialog -ne [IntPtr]::Zero){
      Write-Host 'G4_INSTALLED_FIRST_USE_WIN32_DIALOG_VISIBLE_PASS'
      $activated=[G4InstalledModal]::SetForegroundWindow($dialog)
      Write-Host "G4_INSTALLED_FIRST_USE_DIALOG_FOREGROUND_REQUEST $activated"
      $target=[G4InstalledModal]::GetDlgItem($dialog,
        $(if($confirm){6}else{7}))
      Check ($target -ne [IntPtr]::Zero) 'G4_INSTALLED_FIRST_USE_NATIVE_DIALOG_BUTTON_MISSING'
      $r=[G4InstalledModal+Rect]::new()
      Check ([G4InstalledModal]::GetWindowRect($target,[ref]$r)) 'G4_INSTALLED_FIRST_USE_NATIVE_DIALOG_BUTTON_RECT_MISSING'
      Check (($r.Right-$r.Left) -ge 4 -and
        ($r.Bottom-$r.Top) -ge 4) 'G4_INSTALLED_FIRST_USE_NATIVE_DIALOG_BUTTON_RECT_INVALID'
      [System.Windows.Forms.Cursor]::Position=[System.Drawing.Point]::new(
        [int][Math]::Round(($r.Left+$r.Right)/2),
        [int][Math]::Round(($r.Top+$r.Bottom)/2))
      [G4NativeMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
      Start-Sleep -Milliseconds 80
      [G4NativeMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
      Write-Host 'G4_INSTALLED_FIRST_USE_NATIVE_DIALOG_PHYSICAL_EVENT_SENT'
      RequireDialogDismissed $dialog
      Write-Host 'G4_INSTALLED_FIRST_USE_NATIVE_DIALOG_DECISION_CONFIRMED'
      return
    }
    Start-Sleep -Milliseconds 220
  }
  $count=[G4InstalledModal]::CountOwnedDialogs($global:appProcess.Id)
  Write-Host "G4_INSTALLED_FIRST_USE_WIN32_MODAL_WINDOW_COUNT $count"
  throw 'G4_INSTALLED_FIRST_USE_NATIVE_MESSAGE_DIALOG_MISSING'
}
function DiagnoseSignedOwner(){
  # Emit bounded machine codes only. Organization names, user data,
  # vault files, private paths and raw UI text MUST NOT be logged.
  $root=DesktopRoot
  $all=$root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition)
  $codes=New-Object System.Collections.Generic.HashSet[string]
  foreach($item in $all){
    try {
      $name=[string]$item.Current.Name
      $found=[regex]::Matches($name,
        '(?<![A-Z0-9_])(?:T3_D3|T3_PRODUCT|CEN_D3|CEN_OWNER)_[A-Z0-9_]{3,85}(?![A-Z0-9_])')
      foreach($value in $found){$null=$codes.Add([string]$value.Value)}
    }catch{}
  }
  foreach($code in @($codes|Sort-Object)){
    Write-Host "G4_INSTALLED_FIRST_USE_NATIVE_OWNER_ERROR_CODE $code"
  }
  foreach($class in @(
    'NOT_CONNECTED:','OWNER_READ_FAILED:',
    'Подключение T3 не началось:',
    'Оригинальный подписанный T3-владелец организации подключён.')){
    if(HasText $class){
      Write-Host "G4_INSTALLED_FIRST_USE_NATIVE_OWNER_UI_CLASS $([Array]::IndexOf(@('NOT_CONNECTED:','OWNER_READ_FAILED:','Подключение T3 не началось:','Оригинальный подписанный T3-владелец организации подключён.'),$class))"
    }
  }
  # Presence only, never open or print private DPAPI/Ed25519 files.
  $config=Get-ItemProperty -LiteralPath
    'HKCU:\Software\IWXA\SetupCore\Products\iwxa.admin-center' -ErrorAction Stop
  $rootPath=[string]$config.DataLocation
  if($rootPath -and (Test-Path -LiteralPath $rootPath)){
    $organizations=Join-Path $rootPath 't3-admin/organizations'
    $scopes=@(Get-ChildItem -LiteralPath $organizations -Directory -ErrorAction SilentlyContinue)
    Write-Host "G4_INSTALLED_FIRST_USE_NATIVE_OWNER_SCOPE_COUNT $($scopes.Count)"
    if($scopes.Count -eq 1){
      $expected=@('registry.json','identity.json','vault.json',
        'operators.json','master-secret.dpapi.json')
      $present=@($expected|Where-Object {
        Test-Path -LiteralPath (Join-Path $scopes[0].FullName $_) -PathType Leaf
      })
      Write-Host "G4_INSTALLED_FIRST_USE_NATIVE_OWNER_REQUIRED_FILES $($present.Count)"
    }
  }
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
  # Original Windows PRODUCTION enrollment includes DPAPI and signing; the
  # native child has its own bounded 90-second execution. Never conclude
  # failure after an arbitrary 25-second React repaint timeout.
  for($i=0;$i -lt 310;$i++){
    if(HasText 'Подписанный T3 D3 получатель доступен'){
      $connected=$true;break
    }
    Start-Sleep -Milliseconds 350
  }
  if(-not $connected){DiagnoseSignedOwner}
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
