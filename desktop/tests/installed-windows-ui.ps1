# Windows UIAutomation witness for the actual installed Tauri/WebView2 window.
# Never uses Chromium, WebDriver, browser tabs, Playwright or JavaScript injection.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Executable)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$exe = [IO.Path]::GetFullPath($Executable)
if (!(Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'INSTALLED_EXE_MISSING' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Open-Window([string]$path) {
    $p = Start-Process -FilePath $path -PassThru
    for ($i = 0; $i -lt 50; $i++) {
        Start-Sleep -Milliseconds 400
        $p.Refresh()
        if ($p.HasExited) { throw 'DESKTOP_PROCESS_EXITED_BEFORE_WINDOW' }
        if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
            $root = [Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
            if ($root -and $p.MainWindowTitle -eq 'IWXA — Анализ деятельности') {
                Write-Host "IWXA_ACTIVITY_NATIVE_WINDOW_CREATED handle=$($p.MainWindowHandle) title=$($p.MainWindowTitle)"
                return @{ Process = $p; Root = $root }
            }
        }
    }
    try { $p.Kill() } catch {}
    throw 'DESKTOP_MAIN_WINDOW_NOT_VISIBLE_ON_RUNNER'
}
function Find-Accessible($root, [string]$name, [int]$attempts = 35) {
    $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, $name)
    for ($i = 0; $i -lt $attempts; $i++) {
        $element = $root.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
        if ($element) { return $element }
        Start-Sleep -Milliseconds 350
    }
    return $null
}
function Close-Window($info) {
    $p = $info.Process
    try {
        if (!$p.HasExited) {
            [void]$p.CloseMainWindow()
            if (!$p.WaitForExit(6000)) { $p.Kill() }
        }
    } finally { $p.Dispose() }
}
$window = $null
try {
    $window = Open-Window $exe
    $button = Find-Accessible $window.Root 'Открыть встроенный пример'
    if (!$button) { throw 'INSTALLED_GUI_ACTION_NOT_ACCESSIBLE_OR_NOT_RENDERED' }
    $invoke = $button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
    if (!$invoke) { throw 'INSTALLED_GUI_ACTION_NOT_INVOKABLE' }
    $invoke.Invoke()
    $processName = Find-Accessible $window.Root 'Процесс 01'
    if (!$processName) { throw 'INSTALLED_GUI_SYNTHETIC_GRAPH_NOT_VISIBLE' }
    $hold = Find-Accessible $window.Root 'HOLD · ВЫПУСК ЗАКРЫТ'
    if (!$hold) { throw 'INSTALLED_GUI_EXPORT_HOLD_NOT_VISIBLE' }
    Write-Host 'IWXA_ACTIVITY_INSTALLED_FIRST_USE_PASS native_window=YES built_in_example=YES processes=YES export=HOLD'
} finally {
    if ($window) { Close-Window $window }
}
# Verify real process cold restart, but not persistence of the T3 source choice.
$second = $null
try {
    $second = Open-Window $exe
    if (!(Find-Accessible $second.Root 'Открыть встроенный пример')) {
        throw 'INSTALLED_GUI_COLD_START_NOT_READY'
    }
    Write-Host 'IWXA_ACTIVITY_INSTALLED_COLD_START_PASS native_window=YES source_selection_persistence=NOT_TESTED'
} finally {
    if ($second) { Close-Window $second }
}