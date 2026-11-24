# Windows UIAutomation witness for the actual installed Tauri/WebView2 window.
# Never uses Chromium, WebDriver, browser tabs, Playwright or JavaScript injection.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Executable)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$exe = [IO.Path]::GetFullPath($Executable)
if (!(Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'INSTALLED_EXE_MISSING' }
$hostAssets = @('iwxa-activity-host-surface.js','iwxa-activity-host-surface.css','brand.svg')
foreach ($name in $hostAssets) {
    $asset=Join-Path (Join-Path (Split-Path -Parent $exe) 'host-surface') $name
    if (!(Test-Path -LiteralPath $asset -PathType Leaf) -or
        (Get-Item -LiteralPath $asset).Length -eq 0) {
        throw 'INSTALLED_ACTIVITY_TRUSTED_SURFACE_ASSET_MISSING'
    }
}
Write-Host 'IWXA_ACTIVITY_INSTALLED_HOST_ASSETS_PASS trusted_owner_connection=NOT_ESTABLISHED'
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
    # V7 starts on the real user-configurable dashboard, not the old source form.
    if (!(Find-Accessible $window.Root 'Моя панель деятельности')) {
        throw 'INSTALLED_ACTIVITY_V7_DASHBOARD_NOT_VISIBLE'
    }
    if (!(Find-Accessible $window.Root 'Добавить блок')) {
        throw 'INSTALLED_ACTIVITY_V7_WIDGET_LIBRARY_MISSING'
    }
    # Qualify the actual dashboard configuration in installed Tauri/WebView2.
    # UIAutomation only: no JS injection, browser driver or simulated Store data.
    $addButton = Find-Accessible $window.Root 'Добавить блок' 10
    $addButton.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    $libraryDialog = Find-Accessible $window.Root 'Библиотека блоков' 10
    if (!$libraryDialog) { throw 'INSTALLED_ACTIVITY_V7_WIDGET_LIBRARY_NOT_OPEN' }
    $addOcel = Find-Accessible $libraryDialog 'Добавить: Объекты и события' 10
    if (!$addOcel) { throw 'INSTALLED_ACTIVITY_V7_OCEL_WIDGET_NOT_AVAILABLE' }
    $addOcel.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    $configDialog = Find-Accessible $window.Root 'Настройка блока' 10
    if (!$configDialog) { throw 'INSTALLED_ACTIVITY_V7_WIDGET_SETTINGS_NOT_OPEN' }
    $finishConfig = Find-Accessible $configDialog 'Готово' 10
    if (!$finishConfig) { throw 'INSTALLED_ACTIVITY_V7_WIDGET_SETTINGS_DONE_MISSING' }
    $finishConfig.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    if (!(Find-Accessible $window.Root 'Перетащить блок: Объекты и события' 10)) {
        throw 'INSTALLED_ACTIVITY_V7_OCEL_WIDGET_NOT_ADDED'
    }
    Write-Host 'IWXA_ACTIVITY_V7_NATIVE_WIDGET_ADDED_PASS source=OCEL'
    # Adding a widget puts the dashboard in Edit mode, with explicit move controls.
    $overview = Find-Accessible $window.Root 'Перетащить блок: Сводка источника' 10
    $processes = Find-Accessible $window.Root 'Перетащить блок: Реконструированные процессы' 10
    if (!$overview -or !$processes) { throw 'INSTALLED_ACTIVITY_V7_DEFAULT_WIDGETS_MISSING' }
    $oldOverviewTop = $overview.Current.BoundingRectangle.Top
    $oldProcessTop = $processes.Current.BoundingRectangle.Top
    if ($oldOverviewTop -ge $oldProcessTop) { throw 'INSTALLED_ACTIVITY_V7_WIDGET_BASE_ORDER_BAD' }
    $moveNext = Find-Accessible $window.Root 'Позже →' 10
    if (!$moveNext) { throw 'INSTALLED_ACTIVITY_V7_WIDGET_MOVE_NOT_VISIBLE' }
    $moveNext.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    Start-Sleep -Milliseconds 500
    $newOverviewTop = (Find-Accessible $window.Root 'Перетащить блок: Сводка источника' 10).Current.BoundingRectangle.Top
    $newProcessTop = (Find-Accessible $window.Root 'Перетащить блок: Реконструированные процессы' 10).Current.BoundingRectangle.Top
    if ($newOverviewTop -le $newProcessTop) {
        throw 'INSTALLED_ACTIVITY_V7_WIDGET_ORDER_DID_NOT_CHANGE'
    }
    Write-Host 'IWXA_ACTIVITY_V7_NATIVE_REORDER_PASS real_window=YES'
    # Native 820x650 single-window check. No browser, screenshot or second app.
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class IwxaActivityWin32 {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool MoveWindow(IntPtr handle, int x, int y, int w, int h, bool repaint);
}
'@
    if (![IwxaActivityWin32]::MoveWindow($window.Process.MainWindowHandle, 15, 15, 820, 650, $true)) {
        throw 'INSTALLED_ACTIVITY_V7_COMPACT_RESIZE_FAILED'
    }
    Start-Sleep -Milliseconds 500
    if (!(Find-Accessible $window.Root 'Моя панель деятельности' 5)) {
        throw 'INSTALLED_ACTIVITY_V7_COMPACT_DASHBOARD_NOT_VISIBLE'
    }
    if (![IwxaActivityWin32]::MoveWindow($window.Process.MainWindowHandle, 15, 15, 1280, 860, $true)) {
        throw 'INSTALLED_ACTIVITY_V7_RESTORE_RESIZE_FAILED'
    }
    # A4.1: installed comparison of reproducible D05 route models.
    $reconstruct = Find-Accessible $window.Root 'Реконструкция' 10
    if (!$reconstruct) { throw 'INSTALLED_ACTIVITY_A41_RECONSTRUCTION_NAV_MISSING' }
    $reconstruct.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    $routes = Find-Accessible $window.Root 'Группировка маршрутов' 10
    if (!$routes) { throw 'INSTALLED_ACTIVITY_A41_ROUTE_NAV_MISSING' }
    $routes.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    $example = Find-Accessible $window.Root 'Открыть пример маршрутов CehoVod' 10
    if (!$example) { throw 'INSTALLED_ACTIVITY_A41_EXAMPLE_MISSING' }
    $example.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    if (!(Find-Accessible $window.Root 'Моделей: 3 · Групп: 2 · Повторяющихся групп: 1' 10)) {
        throw 'INSTALLED_ACTIVITY_A41_GROUP_RESULT_MISSING'
    }
    if (!(Find-Accessible $window.Root 'Группы структурных кандидатов' 10)) {
        throw 'INSTALLED_ACTIVITY_A41_GROUP_CARD_MISSING'
    }
    $clearRoutes = Find-Accessible $window.Root 'Очистить выборку' 10
    if (!$clearRoutes) { throw 'INSTALLED_ACTIVITY_A41_CLEAR_MISSING' }
    $clearRoutes.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    Write-Host 'IWXA_ACTIVITY_A41_NATIVE_ROUTE_GROUPING_PASS models=3 groups=2 repeated=1'
    # A4.2 uses two actual files produced by the pinned original Rust4PM.
    # No special product command, injected JavaScript or test-only data in the EXE.
    if ($env:IWXA_ACTIVITY_EXTERNAL_OCEL_FIXTURE -or $env:IWXA_ACTIVITY_EXTERNAL_OCDFG_FIXTURE) {
        $ocelFile = $env:IWXA_ACTIVITY_EXTERNAL_OCEL_FIXTURE
        $graphFile = $env:IWXA_ACTIVITY_EXTERNAL_OCDFG_FIXTURE
        if (!$ocelFile -or !$graphFile -or !(Test-Path -LiteralPath $ocelFile -PathType Leaf) -or
            !(Test-Path -LiteralPath $graphFile -PathType Leaf)) { throw 'A42_NATIVE_FIXTURE_MISSING' }
        function Select-ActivityNativeFile($button, [string]$file) {
            $root = [Windows.Automation.AutomationElement]::RootElement
            $windowType = [Windows.Automation.PropertyCondition]::new(
                [Windows.Automation.AutomationElement]::ControlTypeProperty,
                [Windows.Automation.ControlType]::Window)
            $known = @($root.FindAll([Windows.Automation.TreeScope]::Children,$windowType) |
                ForEach-Object { $_.Current.NativeWindowHandle })
            $button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
            $nameCondition = [Windows.Automation.PropertyCondition]::new(
                [Windows.Automation.AutomationElement]::AutomationIdProperty,'1148')
            $openCondition = [Windows.Automation.PropertyCondition]::new(
                [Windows.Automation.AutomationElement]::AutomationIdProperty,'1')
            $dialog=$null;$filename=$null;$openButton=$null
            for($attempt=0;$attempt -lt 40;$attempt++){
                foreach($candidate in $root.FindAll([Windows.Automation.TreeScope]::Children,$windowType)){
                    if($known -contains $candidate.Current.NativeWindowHandle){continue}
                    if($candidate.Current.Name -notin @('Open','Открыть')){continue}
                    $edit=$candidate.FindFirst([Windows.Automation.TreeScope]::Descendants,$nameCondition)
                    $open=$candidate.FindFirst([Windows.Automation.TreeScope]::Descendants,$openCondition)
                    if($edit -and $open){$dialog=$candidate;$filename=$edit;$openButton=$open;break}
                }
                if($dialog){break}
                Start-Sleep -Milliseconds 350
            }
            if(!$dialog){throw 'A42_NATIVE_OPEN_DIALOG_NOT_FOUND'}
            $filename.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).SetValue([IO.Path]::GetFullPath($file))
            $openButton.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
        }
        $ocelNav=Find-Accessible $window.Root 'OCEL 2.0' 10
        if(!$ocelNav){throw 'A42_NATIVE_OCEL_NAV_MISSING'}
        $ocelNav.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
        $externalNav=Find-Accessible $window.Root 'Внешняя модель' 10
        if(!$externalNav){throw 'A42_NATIVE_EXTERNAL_NAV_MISSING'}
        $externalNav.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
        $pickLog=Find-Accessible $window.Root 'Выбрать журнал OCEL' 10
        $pickGraph=Find-Accessible $window.Root 'Выбрать граф OC-DFG' 10
        $compare=Find-Accessible $window.Root 'Сопоставить модель и журнал' 10
        if(!$pickLog -or !$pickGraph -or !$compare -or $compare.Current.IsEnabled){throw 'A42_NATIVE_INITIAL_STATE_INVALID'}
        Select-ActivityNativeFile $pickLog $ocelFile
        if(!(Find-Accessible $window.Root 'Журнал: выбран · Граф: не выбран' 25)){throw 'A42_NATIVE_OCEL_SELECTION_NOT_CONFIRMED'}
        Select-ActivityNativeFile $pickGraph $graphFile
        if(!(Find-Accessible $window.Root 'Журнал: выбран · Граф: выбран' 25)){throw 'A42_NATIVE_GRAPH_SELECTION_NOT_CONFIRMED'}
        $compare=Find-Accessible $window.Root 'Сопоставить модель и журнал' 10
        if(!$compare.Current.IsEnabled){throw 'A42_NATIVE_COMPARE_DISABLED'}
        $compare.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
        if(!(Find-Accessible $window.Root 'Структура совпадает с журналом' 30)){throw 'A42_NATIVE_MATCH_NOT_DISPLAYED'}
        if(!(Find-Accessible $window.Root 'Полные варианты объектных траекторий' 10)){throw 'A42_NATIVE_VARIANTS_NOT_DISPLAYED'}
        if(!(Find-Accessible $window.Root '1. registered' 10)){throw 'A42_NATIVE_REAL_TRAJECTORY_NOT_DISPLAYED'}
        $clearExternal=Find-Accessible $window.Root 'Очистить выборку' 10
        $clearExternal.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
        if(Find-Accessible $window.Root 'Структура совпадает с журналом' 3){throw 'A42_NATIVE_STALE_REVIEW'}
        Write-Host 'IWXA_ACTIVITY_A42_NATIVE_EXTERNAL_MODEL_PASS original_r4pm=YES file_picker=YES variants=YES reset=YES'
    }
    $sourcePage = Find-Accessible $window.Root 'Источники'
    if (!$sourcePage) { throw 'INSTALLED_ACTIVITY_V7_SOURCE_NAV_MISSING' }
    $sourcePage.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    $t3 = Find-Accessible $window.Root 'Подключить выбранную базу T3'
    if (!$t3) { throw 'INSTALLED_T3_SOURCE_ACTION_MISSING' }
    $t3Pattern = $t3.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
    if (!$t3Pattern) { throw 'INSTALLED_T3_SOURCE_ACTION_NOT_INVOKABLE' }
    $t3Pattern.Invoke()
    if (!(Find-Accessible $window.Root 'HOLD: T3_TRUSTED_HOST_NOT_CONNECTED')) {
        throw 'INSTALLED_T3_UNBOUND_HOST_MUST_HOLD'
    }
    $button = Find-Accessible $window.Root 'Открыть встроенный пример'
    if (!$button) { throw 'INSTALLED_GUI_ACTION_NOT_ACCESSIBLE_OR_NOT_RENDERED' }
    $invoke = $button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
    if (!$invoke) { throw 'INSTALLED_GUI_ACTION_NOT_INVOKABLE' }
    $invoke.Invoke()
    $processName = Find-Accessible $window.Root 'Процесс 01'
    if (!$processName) { throw 'INSTALLED_GUI_SYNTHETIC_GRAPH_NOT_VISIBLE' }
    $hold = Find-Accessible $window.Root 'HOLD · ВЫПУСК ЗАКРЫТ'
    if (!$hold) { throw 'INSTALLED_GUI_EXPORT_HOLD_NOT_VISIBLE' }
    $ocel = Find-Accessible $window.Root 'Открыть пример OCEL 2.0'
    if (!$ocel) { throw 'INSTALLED_OCEL2_ACTION_NOT_ACCESSIBLE' }
    $ocelPattern = $ocel.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
    if (!$ocelPattern) { throw 'INSTALLED_OCEL2_ACTION_NOT_INVOKABLE' }
    $ocelPattern.Invoke()
    if (!(Find-Accessible $window.Root 'OCEL 2.0 · связи объектов и событий')) {
        throw 'INSTALLED_OCEL2_EVIDENCE_NOT_VISIBLE'
    }
    if (!(Find-Accessible $window.Root 'Объектная траектория 1')) {
        throw 'INSTALLED_OCEL2_OBJECT_VIEW_NOT_VISIBLE'
    }
    if (!(Find-Accessible $window.Root 'HOLD · ВЫПУСК ЗАКРЫТ')) {
        throw 'INSTALLED_OCEL2_HOLD_NOT_VISIBLE'
    }
    # Selecting a disconnected T3 base MUST remove the previously rendered OCEL graph.
    $t3Pattern.Invoke()
    if (!(Find-Accessible $window.Root 'HOLD: T3_TRUSTED_HOST_NOT_CONNECTED')) {
        throw 'INSTALLED_T3_SOURCE_SWITCH_MUST_HOLD'
    }
    Start-Sleep -Milliseconds 700
    if (Find-Accessible $window.Root 'OCEL 2.0 · связи объектов и событий' 2) {
        throw 'INSTALLED_T3_SOURCE_SWITCH_STALE_OCEL_PREVIEW'
    }
    Write-Host 'IWXA_ACTIVITY_INSTALLED_FIRST_USE_PASS native_window=YES built_in_example=YES processes=YES ocel2=YES t3_host_unbound=HOLD source_switch=NO_STALE export=HOLD'
} finally {
    if ($window) { Close-Window $window }
}
# Verify real process cold restart, but not persistence of the T3 source choice.
$second = $null
try {
    $second = Open-Window $exe
    if (!(Find-Accessible $second.Root 'Моя панель деятельности')) {
        throw 'INSTALLED_ACTIVITY_V7_COLD_DASHBOARD_NOT_READY'
    }
    if (!(Find-Accessible $second.Root 'Перетащить блок: Объекты и события' 10)) {
        throw 'INSTALLED_ACTIVITY_V7_WIDGET_ADDITION_NOT_PERSISTED'
    }
    $savedOverview = Find-Accessible $second.Root 'Перетащить блок: Сводка источника' 10
    $savedProcesses = Find-Accessible $second.Root 'Перетащить блок: Реконструированные процессы' 10
    if (!$savedOverview -or !$savedProcesses) { throw 'INSTALLED_ACTIVITY_V7_SAVED_ORDER_MISSING' }
    if ($savedOverview.Current.BoundingRectangle.Top -le $savedProcesses.Current.BoundingRectangle.Top) {
        throw 'INSTALLED_ACTIVITY_V7_SAVED_WIDGET_ORDER_NOT_PERSISTED'
    }
    Write-Host 'IWXA_ACTIVITY_V7_NATIVE_COLD_LAYOUT_PASS widget=OCEL reordered=YES'
    $sourcePage = Find-Accessible $second.Root 'Источники'
    if (!$sourcePage) { throw 'INSTALLED_ACTIVITY_V7_COLD_SOURCE_NAV_MISSING' }
    $sourcePage.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    if (!(Find-Accessible $second.Root 'Открыть встроенный пример')) {
        throw 'INSTALLED_GUI_COLD_START_NOT_READY'
    }
    Write-Host 'IWXA_ACTIVITY_INSTALLED_COLD_START_PASS native_window=YES source_selection_persistence=NOT_TESTED'
} finally {
    if ($second) { Close-Window $second }
}