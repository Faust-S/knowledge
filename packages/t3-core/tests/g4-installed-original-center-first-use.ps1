# Public knowledge: NEW independent native Windows UIA witness for installed
# private Admin Center first-use. Only UI labels and PASS codes leave runner.
# No browser automation, no private source/logs, no imitation signed owner.
param([Parameter(Mandatory=$true)][string]$InstallRoot,[switch]$RequireD2Read)
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
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
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
  # UIA can locate an accessibility control while a different HWND still
  # owns the foreground. Physical mouse_event must target the installed app,
  # not the runner console; signed native dialogs are activated separately.
  $focus=[G4InstalledModal]::SetForegroundWindow(
    $global:appProcess.MainWindowHandle)
  Start-Sleep -Milliseconds 180
  $foreground=[G4InstalledModal]::GetForegroundWindow()
  Check ($foreground -eq $global:appProcess.MainWindowHandle) 'G4_INSTALLED_FIRST_USE_APP_NOT_FOREGROUND_FOR_PHYSICAL_CLICK'
  if($label -eq 'Подключить организацию'){
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
  # Physical SendKeys can return before WebView2/React commits its controlled
  # input. Never submit a state-changing form until native UIA ValuePattern
  # independently confirms EXACT text; no arbitrary UI values are logged.
  for($attempt=0;$attempt -lt 3;$attempt++){
    $field=FindName $label 'Edit'
    $field.SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait('^a')
    [System.Windows.Forms.SendKeys]::SendWait($value)
    for($poll=0;$poll -lt 16;$poll++){
      $pattern=$null
      try{
        if($field.TryGetCurrentPattern(
          [System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){
          if($pattern.Current.Value -ceq $value){
            Write-Host "G4_INSTALLED_FIRST_USE_NATIVE_EDIT_READBACK_PASS $($script:phase)"
            return
          }
        }
      }catch{}
      Start-Sleep -Milliseconds 180
    }
  }
  throw 'G4_INSTALLED_FIRST_USE_NATIVE_EDIT_VALUE_NOT_ACKNOWLEDGED'
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
function WaitForText([string]$fragment,[int]$maxPolls=55){
  for($poll=0;$poll -lt $maxPolls;$poll++){
    if(HasText $fragment){return $true}
    Start-Sleep -Milliseconds 250
  }
  return $false
}
function NativeD2BoundedRefusal(){
  # UI Automation reads only the installed public UI. Never print source
  # rows, object metadata, private Native Owner stderr, or user content.
  $root=DesktopRoot
  $found=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition)
  foreach($element in $found){
    try{
      $name=[string]$element.Current.Name
      $match=[regex]::Match($name,
        'Код:\s*((?:CEN_D2|CEN_D3|T3_D1|T3_D2|T3_D3|T3_OWNER|T3_SUBJECT|T3_ACCESS|T3_KERNEL|T3_HOST|INTEROP|WORKSPACE|SOURCE|OPERATION)_[A-Z0-9_]{4,90})')
      if($match.Success){
        Write-Host ('D2_INSTALLED_NATIVE_SOURCE_REFUSAL '+$match.Groups[1].Value)
        return
      }
    }catch{}
  }
  # A not-yet-attached native D2 reader and an in-flight read are distinct
  # from a rejected signed grant. Report only fixed UI states, not source
  # Object/Event text or the original owner's private stderr.
  $signals=@(
    'T3 DATA: исходный Kernel подключён к нативному читателю',
    'T3 DATA: нативный читатель Object/Event ещё не подключён',
    'Читаем исходный Kernel...',
    'Исходные Object/Event не прочитаны.',
    'Оригинальный T3 не подтвердил чтение корпоративного контекста.'
  )
  for($i=0;$i -lt $signals.Count;$i++){
    Write-Host "D2_INSTALLED_NATIVE_READ_FAILURE_SIGNAL_$i $(HasText $signals[$i])"
  }
  Write-Host 'D2_INSTALLED_NATIVE_SOURCE_REFUSAL UNCLASSIFIED'
}
function NativeD2RefusalStage(){
  # Observe only one of three fixed public UI states. No private strings,
  # original signed grant contents, user data, or native stderr are read.
  foreach($stage in @('SIGNED_CONTEXT','ORIGINAL_KERNEL_READ','SIGNED_ENUMERATION')){
    if(HasText ('Этап: '+$stage)){
      Write-Host ('D2_INSTALLED_NATIVE_REFUSAL_STAGE '+$stage)
      return
    }
  }
  Write-Host 'D2_INSTALLED_NATIVE_REFUSAL_STAGE UNCLASSIFIED'
}
function WaitForOriginalKernelReady(){
  # The isolated T3 child is asynchronous. A visible Center toolbar button
  # only means the child was created, NOT that original T2 Kernel/JIT attached.
  # Observe the genuine Workspace Header's KernelStatus before hiding it.
  for($i=0;$i -lt 160;$i++){
    if((HasText 'Ядро готово') -or
       (HasText 'Ядро: ограниченный режим') -or
       (HasText 'Ядро: только чтение')){
      return $true
    }
    if((HasText 'Ядро недоступно') -or
       (HasText 'Требуется обновление')){
      return $false
    }
    Start-Sleep -Milliseconds 250
  }
  return $false
}
function WaitForOriginalNativeDataReader(){
  # The signed React Workspace can show KernelStatus READY before its
  # asynchronous native D3 relay attaches. Only the ORIGINAL native owner
  # advertises d2ActivityReaderConnected. A UI button, signed Task list or
  # unverified corporate draft cannot substitute this exact observation.
  for($i=0;$i -lt 72;$i++){
    if(HasText 'T3 DATA: исходный Kernel подключён к нативному читателю'){
      Write-Host 'D2_INSTALLED_NATIVE_READER_ATTACHED_PASS'
      return $true
    }
    if($i -eq 20 -and
       (HasText 'T3 DATA: нативный читатель Object/Event ещё не подключён')){
      # A second read of original native STATE is harmless; never repeat a
      # signer command or createWorkspace on an unknown outcome.
      $button=$null
      try{$button=FindName 'Обновить подписанные сведения T3' 'Button' 1}catch{}
      if($button -and $button.Current.IsEnabled){
        ClickButton 'Обновить подписанные сведения T3'
        Write-Host 'D2_INSTALLED_NATIVE_READER_STATE_READ_ONLY_REFRESH'
      }
    }
    Start-Sleep -Milliseconds 250
  }
  if(HasText 'T3 DATA: нативный читатель Object/Event ещё не подключён'){
    Write-Host 'D2_INSTALLED_NATIVE_READER_NOT_ATTACHED'
  }else{
    Write-Host 'D2_INSTALLED_NATIVE_READER_STATE_UNAVAILABLE'
  }
  return $false
}
function EnsureOriginalSignedWorkspaceProvisioned(){
  # Kernel connected != selected corporate Workspace present in T2.
  # The signed owner already grants a SEPARATE workspace.create ACTION.
  # The original SignedSelectedWorkspaceGate owns create and readback.
  # This UIA witness may make ONE explicit physical click, never create
  # by calling T2/native methods directly, and never retry an unknown write.
  $sawMissing=$false
  $clicked=$false
  $buttonObserved=$false
  for($i=0;$i -lt 240;$i++){
    $missing=HasText 'Подписанная Workspace недоступна'
    $denied=HasText 'Подписанный доступ Workspace не подтверждён'
    $checking=HasText 'Проверяем выбранную подписанную Workspace'
    if($denied){
      # A denied signed getWorkspace is NOT a missing Workspace. No create
      # button should be clicked under revoked/absent or mismatched authority.
      NativeD2BoundedRefusal
      NativeD2RefusalStage
      Write-Host 'D2_INSTALLED_ORIGINAL_SIGNED_WORKSPACE_ACCESS_DENIED'
      return $false
    }
    if($missing){$sawMissing=$true}
    if($missing -and (HasText 'Код: T3_D1_KERNEL_CREATE_UNAVAILABLE')){
      Write-Host 'D2_INSTALLED_ORIGINAL_SIGNED_WORKSPACE_T2_CREATE_UNAVAILABLE'
      return $false
    }
    if($missing -and (HasText 'Код: T3_D1_WORKSPACE_CREATE_GRANT_REQUIRED')){
      Write-Host 'D2_INSTALLED_ORIGINAL_SIGNED_WORKSPACE_SIGNED_CREATE_GRANT_REQUIRED'
      return $false
    }
    if($missing -and $i -eq 38){
      # Bounded UIA signals: never emit signed context, native logs, or
      # arbitrary user text. A missing button and a rejected write are
      # independent failures and require different engineering fixes.
      $buttonVisible=HasText 'Создать выбранную Workspace'
      Write-Host "D2_INSTALLED_SIGNED_GATE_CREATE_BUTTON_TEXT_VISIBLE $buttonVisible"
      $button=$null
      try{$button=FindName 'Создать выбранную Workspace' 'Button' 1}catch{}
      $buttonObserved=($null -ne $button)
      Write-Host "D2_INSTALLED_SIGNED_GATE_CREATE_BUTTON_UIA_AVAILABLE $buttonObserved"
    }
    if($missing -and $clicked -and (HasText 'Не удалось подтвердить создание в исходном Kernel')){
      NativeD2BoundedRefusal
      Write-Host 'D2_INSTALLED_SIGNED_GATE_CREATE_ACTION_NOT_CONFIRMED'
      return $false
    }
    if($missing -and $i -ge 38 -and -not $clicked){
      $button=$null
      try{$button=FindName 'Создать выбранную Workspace' 'Button' 1}catch{}
      if($button -and $button.Current.IsEnabled){
        $script:phase='D2_NATIVE_SIGNED_WORKSPACE_EXPLICIT_PROVISION'
        Write-Host 'D2_INSTALLED_ORIGINAL_SELECTED_WORKSPACE_EXPLICIT_ACTION'
        ClickButton 'Создать выбранную Workspace'
        $clicked=$true
      }
    }
    if($sawMissing -and -not $missing -and -not $checking){
      Write-Host 'D2_INSTALLED_ORIGINAL_SIGNED_WORKSPACE_GATE_RESOLVED'
      return $true
    }
    if(-not $sawMissing -and -not $checking -and $i -ge 36){
      # Could already exist, or the signed auto-provisioner could have
      # completed before observation. Only the later D2 Kernel readback
      # proves source readiness; no success claim is made here.
      Write-Host 'D2_INSTALLED_ORIGINAL_SIGNED_WORKSPACE_NO_GATE_OBSERVED'
      return $true
    }
    Start-Sleep -Milliseconds 250
  }
  if(HasText 'Подписанная Workspace недоступна'){
    NativeD2BoundedRefusal
    if(-not $clicked){
      Write-Host 'D2_INSTALLED_SIGNED_GATE_NO_EXPLICIT_CREATE_DISPATCH'
    }else{
      Write-Host 'D2_INSTALLED_SIGNED_GATE_CREATE_DISPATCH_WITHOUT_READBACK'
    }
    Write-Host 'D2_INSTALLED_ORIGINAL_SIGNED_WORKSPACE_GATE_STILL_MISSING'
    return $false
  }
  Write-Host 'D2_INSTALLED_ORIGINAL_SIGNED_WORKSPACE_GATE_NOT_SETTLED'
  return $false
}
function WaitForOrdinaryWorkspace([string]$name){
  # A physical Windows click returns before WebView2 has committed the React
  # update to the accessibility tree. The workspace is NOT accepted on click:
  # require both its visible row and the native no-Atlas state to appear.
  for($poll=0;$poll -lt 75;$poll++){
    if((HasText $name) -and (HasText 'План Atlas пока не указан')){
      return $true
    }
    Start-Sleep -Milliseconds 250
  }
  # Privacy preserving bounded diagnostic: never print arbitrary UI text,
  # organization content, draft values or private signed owner state.
  $signals=@(
    'G4WindowsOrganization',
    'Планы Atlas и рабочие области',
    'G4CorporateWorkspace',
    'План Atlas пока не указан',
    'Черновик изменён.')
  for($index=0;$index -lt $signals.Count;$index++){
    $visible=HasText $signals[$index]
    Write-Host "G4_INSTALLED_WORKSPACE_UI_SIGNAL_$index $visible"
  }
  Write-Host 'G4_INSTALLED_WORKSPACE_NATIVE_UI_READBACK_TIMEOUT'
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
  # The original Setup Core may omit DataLocation: Center then uses
  # app_local_data_dir() for its canonical Tauri identifier. Never read
  # secrets; inspect file presence only, with no raw paths in public logs.
  try{
    $config=Get-ItemProperty -LiteralPath 'HKCU:\Software\IWXA\SetupCore\Products\iwxa.admin-center' -ErrorAction Stop
    $rootPath=''
    if($config.PSObject.Properties.Name -contains 'DataLocation'){
      $rootPath=[string]$config.DataLocation
    }elseif($env:LOCALAPPDATA){
      $rootPath=Join-Path $env:LOCALAPPDATA 'ru.iwxa.admin-center'
      Write-Host 'G4_INSTALLED_FIRST_USE_NATIVE_OWNER_DATA_ROOT_APP_LOCAL_FALLBACK'
    }
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
        $original=@('registry.json','identity.json','vault.json',
          'personal-control/vault.json','personal-control/identity.json',
          'personal-control/trust.json')
        $provisioned=@($original|Where-Object {
          Test-Path -LiteralPath (Join-Path $scopes[0].FullName $_) -PathType Leaf
        })
        Write-Host "G4_INSTALLED_FIRST_USE_NATIVE_OWNER_REQUIRED_FILES $($present.Count)"
        Write-Host "G4_INSTALLED_FIRST_USE_NATIVE_OWNER_ORIGINAL_FILES $($provisioned.Count)"
      }
    }else{
      Write-Host 'G4_INSTALLED_FIRST_USE_NATIVE_OWNER_DATA_ROOT_NOT_FOUND'
    }
  }catch{
    # Diagnostics must never turn the original signed Owner failure into an
    # unrelated PowerShell exception or reveal filesystem/registry paths.
    Write-Host 'G4_INSTALLED_FIRST_USE_NATIVE_OWNER_DIAGNOSTICS_UNAVAILABLE'
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
  Check (WaitForText 'G4WindowsOrganization') 'G4_INSTALLED_ORDINARY_ORGANIZATION_NOT_CREATED'
  $script:phase='CREATE_ORDINARY_WORKSPACE'
  ClickButton 'Планы Atlas'
  Check (WaitForText 'Планы Atlas и рабочие области') 'G4_INSTALLED_WORKSPACE_PAGE_NOT_OPENED'
  TypeText 'Название рабочей области' 'G4CorporateWorkspace'
  ClickButton 'Добавить'
  Check (WaitForOrdinaryWorkspace 'G4CorporateWorkspace') 'G4_INSTALLED_WORKSPACE_WITHOUT_ATLAS_NOT_CREATED'
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
    # A signed child's terminal error is not a slow WebView repaint.
    # Stop observing that failed operation; do NOT automatically re-enroll.
    if($i%6 -eq 0 -and
       ((HasText 'T3_PRODUCT_COMPONENT_') -or
        (HasText 'T3_D3_ORIGINAL_ENROLL_'))){
      Write-Host 'G4_INSTALLED_FIRST_USE_OWNER_TERMINAL_MACHINE_ERROR_OBSERVED'
      break
    }
    Start-Sleep -Milliseconds 350
  }
  if(-not $connected){DiagnoseSignedOwner}
  Check $connected 'G4_INSTALLED_FIRST_USE_ORIGINAL_OWNER_NOT_CONNECTED'
  Write-Host 'G4_INSTALLED_FIRST_USE_NATIVE_WINDOWS_ENROLL_PASS'
  $script:phase='SIGNED_OWNER_COLD_CLOSE'
  CloseCenter
  $script:phase='SIGNED_OWNER_INDEPENDENT_COLD_STATE'
  & (Join-Path $PSScriptRoot 'g4-installed-original-owner-cold-state.ps1') -InstallRoot $installed
  $script:phase='SIGNED_OWNER_COLD_RESTART'
  StartCenter
  Check (WaitForText 'G4WindowsOrganization' 100) 'G4_INSTALLED_COLD_MANAGER_ORGANIZATION_UI_NOT_RESTORED'
  ClickButton 'Результаты'
  $durable=$false
  for($i=0;$i -lt 70;$i++){
    if(HasText 'Подписанный T3 D3 получатель доступен'){$durable=$true;break}
    Start-Sleep -Milliseconds 350
  }
  if(-not $durable){
    Write-Host "G4_INSTALLED_COLD_ORGANIZATION_UI_VISIBLE $(HasText 'G4WindowsOrganization')"
    Write-Host "G4_INSTALLED_COLD_OWNER_NOT_CONNECTED_UI $(HasText 'NOT_CONNECTED:')"
    Write-Host "G4_INSTALLED_COLD_OWNER_READ_FAILED_UI $(HasText 'OWNER_READ_FAILED:')"
    DiagnoseSignedOwner
  }
  Check $durable 'G4_INSTALLED_FIRST_USE_COLD_OWNER_NOT_RESTORED'

  Write-Host 'G4_INSTALLED_FIRST_USE_ORIGINAL_DPAPI_COLD_RESTART_PASS'
  if($RequireD2Read){
    # Only the installed original DPAPI/Ed25519 owner and original T2 Host
    # may satisfy these UIA observations. No direct native command dispatch,
    # mock browser state, or shadow read-only Store can supply the receipt.
    $script:phase='D2_NATIVE_OPEN_ORIGINAL_KERNEL'
    ClickButton 'Открыть Workspace T3'
    Check (WaitForText 'К приёмке' 90) 'D2_INSTALLED_NATIVE_SIGNED_WORKSPACE_NOT_VISIBLE'
    Check (WaitForOriginalKernelReady) 'D2_INSTALLED_NATIVE_ORIGINAL_KERNEL_NOT_READY'
    Check (EnsureOriginalSignedWorkspaceProvisioned) 'D2_INSTALLED_NATIVE_ORIGINAL_WORKSPACE_PROVISION_NOT_CONFIRMED'
    $script:phase='D2_NATIVE_HIDE_SAME_KERNEL'
    ClickButton 'К приёмке'
    Check (WaitForText 'Workspace T3' 60) 'D2_INSTALLED_NATIVE_SIGNED_WORKSPACE_NOT_HIDDEN'
    $script:phase='D2_NATIVE_REVIEW_TO_OVERVIEW'
    ClickButton 'Обзор'
    Check (WaitForText 'Что нужно найти или решить?' 80) 'D2_INSTALLED_NATIVE_OVERVIEW_NOT_OPEN'
    $script:phase='D2_NATIVE_MANAGER_OWNER_REREAD'
    ClickButton 'Обновить подписанные сведения T3'
    Check (WaitForText 'Task в оригинальном T3:' 120) 'D2_INSTALLED_NATIVE_SIGNED_CONTEXT_NOT_READ'
    Check (WaitForOriginalNativeDataReader) 'D2_INSTALLED_NATIVE_ORIGINAL_READER_NOT_ATTACHED'
    $script:phase='D2_NATIVE_READ_ORIGINAL_KERNEL'
    ClickButton 'Перечитать Object/Event через T3 DATA'
    if(-not(WaitForText 'Оригинальный T2 Kernel' 130)){
      NativeD2BoundedRefusal
      throw 'D2_INSTALLED_NATIVE_SIGNED_DATA_READ_FAILED'
    }
    Check (HasText 'Это метаданные исходных записей, не доказательство выполнения хозяйственных действий.') 'D2_INSTALLED_NATIVE_EVIDENCE_SCOPE_MISSING'
    Write-Host 'D2_INSTALLED_ORIGINAL_KERNEL_DATA_READ_UI_PASS'
    $script:phase='D2_NATIVE_SAME_ORGANIZATION_CONTEXT'
    ClickButton 'Контекст организации'
    Check (WaitForText 'Поиск по доступному контексту' 75) 'D2_INSTALLED_NATIVE_CORPORATE_CONTEXT_NOT_OPEN'
    ClickButton 'Обновить подписанные сведения T3'
    Check (WaitForText 'Task в оригинальном T3:' 120) 'D2_INSTALLED_NATIVE_CONTEXT_SIGNED_OWNER_MISSING'
    Check (WaitForOriginalNativeDataReader) 'D2_INSTALLED_NATIVE_CONTEXT_READER_NOT_ATTACHED'
    ClickButton 'Перечитать Object/Event через T3 DATA'
    if(-not(WaitForText 'Оригинальный T2 Kernel' 130)){
      NativeD2BoundedRefusal
      throw 'D2_INSTALLED_NATIVE_CONTEXT_DATA_READ_FAILED'
    }
    Write-Host 'D2_INSTALLED_ORIGINAL_KERNEL_TWO_MANAGER_PAGES_UI_PASS'
    # One more true Windows cold close/restart and separate source read.
    # No persisted React summary can count as a reopened Kernel authority.
    $script:phase='D2_NATIVE_INDEPENDENT_COLD_RESTART'
    CloseCenter
    & (Join-Path $PSScriptRoot 'g4-installed-original-owner-cold-state.ps1') -InstallRoot $installed
    StartCenter
    Check (WaitForText 'G4WindowsOrganization' 100) 'D2_INSTALLED_COLD_ORGANIZATION_LOST'
    ClickButton 'Результаты'
    Check (WaitForText 'Подписанный T3 D3 получатель доступен' 120) 'D2_INSTALLED_COLD_OWNER_NOT_RESTORED'
    ClickButton 'Открыть Workspace T3'
    Check (WaitForText 'К приёмке' 90) 'D2_INSTALLED_COLD_WORKSPACE_NOT_OPEN'
    Check (WaitForOriginalKernelReady) 'D2_INSTALLED_COLD_ORIGINAL_KERNEL_NOT_READY'
    Check (EnsureOriginalSignedWorkspaceProvisioned) 'D2_INSTALLED_COLD_ORIGINAL_WORKSPACE_PROVISION_NOT_CONFIRMED'
    ClickButton 'К приёмке'
    ClickButton 'Обзор'
    ClickButton 'Обновить подписанные сведения T3'
    Check (WaitForText 'Task в оригинальном T3:' 120) 'D2_INSTALLED_COLD_CONTEXT_NOT_READ'
    Check (WaitForOriginalNativeDataReader) 'D2_INSTALLED_COLD_NATIVE_READER_NOT_ATTACHED'
    ClickButton 'Перечитать Object/Event через T3 DATA'
    if(-not(WaitForText 'Оригинальный T2 Kernel' 130)){
      NativeD2BoundedRefusal
      throw 'D2_INSTALLED_COLD_ORIGINAL_KERNEL_DATA_READ_FAILED'
    }
    Write-Host 'D2_INSTALLED_ORIGINAL_KERNEL_TWO_COLD_READS_PASS'
  }
}finally{
  if($global:appProcess){
    try{CloseCenter -strict $false}catch{
      # Preserve the actual UI/owner failure from the primary try block.
      Write-Host 'G4_INSTALLED_FIRST_USE_CLEANUP_NONBLOCKING'
    }
  }
}
