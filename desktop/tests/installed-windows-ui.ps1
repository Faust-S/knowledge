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
# WebView2 disclosure/pressed buttons can expose ExpandCollapse or Toggle,
# rather than Invoke. Resolve an actionable element, not a same-name text node.
function Invoke-ActivityAction($root, [string]$name, [int]$attempts = 15) {
    $condition = [Windows.Automation.PropertyCondition]::new(
        [Windows.Automation.AutomationElement]::NameProperty, $name)
    for ($i = 0; $i -lt $attempts; $i++) {
        $matches = $root.FindAll([Windows.Automation.TreeScope]::Descendants, $condition)
        foreach ($element in $matches) {
            if (!$element.Current.IsEnabled) { continue }
            $pattern = $null
            if ($element.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
                $pattern.Invoke()
                Write-Host "IWXA_ACTIVITY_UIA_ACTION name=$name pattern=Invoke"
                return
            }
            if ($element.TryGetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) {
                if ($pattern.Current.ExpandCollapseState -eq [Windows.Automation.ExpandCollapseState]::Collapsed) {
                    $pattern.Expand()
                    Write-Host "IWXA_ACTIVITY_UIA_ACTION name=$name pattern=ExpandCollapse"
                    return
                }
            }
            if ($element.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {
                $pattern.Toggle()
                Write-Host "IWXA_ACTIVITY_UIA_ACTION name=$name pattern=Toggle"
                return
            }
            if ($element.TryGetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
                $pattern.Select()
                Write-Host "IWXA_ACTIVITY_UIA_ACTION name=$name pattern=SelectionItem"
                return
            }
        }
        Start-Sleep -Milliseconds 350
    }
    throw "INSTALLED_ACTIVITY_UIA_ACTION_NOT_INVOKABLE: $name"
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
    if (!(Find-Accessible $window.Root 'Различаются заявленные требования качества' 10)) {
        throw 'INSTALLED_ACTIVITY_A41_QUALITY_DIFFERENCE_MISSING'
    }
    Write-Host 'IWXA_ACTIVITY_A41_NATIVE_QUALITY_DIFFERENCE_PASS'
    Invoke-ActivityAction $window.Root 'Открыть технологический кандидат'
    if (!(Find-Accessible $window.Root 'Технологический кандидат' 10)) {
        throw 'INSTALLED_ACTIVITY_A43_DRAFT_NOT_VISIBLE'
    }
    if (!(Find-Accessible $window.Root 'Исходный вариант 1' 10)) {
        throw 'INSTALLED_ACTIVITY_A43_PROFILE_MISSING'
    }
    if (!(Find-Accessible $window.Root 'Контрольная точка 1: Контроль ширины детали' 10)) {
        throw 'INSTALLED_ACTIVITY_A43_QUALITY_CHECK_MISSING'
    }
    if (!(Find-Accessible $window.Root 'Нижняя граница: 99.8' 10)) {
        throw 'INSTALLED_ACTIVITY_A43_FIRST_TOLERANCE_MISSING'
    }
    Invoke-ActivityAction $window.Root 'Исходный вариант 2'
    if (!(Find-Accessible $window.Root 'Нижняя граница: 99.5' 10)) {
        throw 'INSTALLED_ACTIVITY_A43_SECOND_TOLERANCE_MISSING'
    }
    if (Find-Accessible $window.Root 'Нижняя граница: 99.8' 2) {
        throw 'INSTALLED_ACTIVITY_A43_STALE_VARIANT_VALUE'
    }
    Write-Host 'IWXA_ACTIVITY_A43_NATIVE_TECHNOLOGY_DRAFT_PASS variants=2'
    Invoke-ActivityAction $window.Root 'Уточнить технологию'
    Invoke-ActivityAction $window.Root 'Подготовить локальное предложение'
    if (!(Find-Accessible $window.Root 'Нужны дополнительные сведения' 10)) {
        throw 'INSTALLED_ACTIVITY_A43_PROPOSAL_GAPS_MISSING'
    }
    Write-Host 'IWXA_ACTIVITY_A43_NATIVE_PROPOSAL_GAPS_PASS'
    Invoke-ActivityAction $window.Root 'Подготовить к обезличиванию'
    Invoke-ActivityAction $window.Root 'Сохранить известные параметры этой области'
    Invoke-ActivityAction $window.Root 'Сформировать кандидат для проверки раскрытия'
    if (!(Find-Accessible $window.Root 'Кандидат содержит незавершённые требования' 10)) {
        throw 'INSTALLED_ACTIVITY_A43_DISCLOSURE_CANDIDATE_GAPS_MISSING'
    }
    Write-Host 'IWXA_ACTIVITY_A43_NATIVE_DISCLOSURE_CANDIDATE_PASS'
    $clearRoutes = Find-Accessible $window.Root 'Очистить выборку' 10
    if (!$clearRoutes) { throw 'INSTALLED_ACTIVITY_A41_CLEAR_MISSING' }
    $clearRoutes.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    Write-Host 'IWXA_ACTIVITY_A41_NATIVE_ROUTE_GROUPING_PASS models=3 groups=2 repeated=1'
    # A4.2: real installed comparison using a labelled illustrative pair.
    $miningPage = Find-Accessible $window.Root 'Результаты Process Mining' 10
    if (!$miningPage) { throw 'INSTALLED_ACTIVITY_A42_NAV_MISSING' }
    $miningPage.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    $miningExample = Find-Accessible $window.Root 'Открыть пример сравнения' 10
    if (!$miningExample) { throw 'INSTALLED_ACTIVITY_A42_EXAMPLE_MISSING' }
    $miningExample.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    if (!(Find-Accessible $window.Root 'Отличия операций: 1 · Отличия переходов: 3' 10)) {
        throw 'INSTALLED_ACTIVITY_A42_COMPARISON_MISSING'
    }
    if (!(Find-Accessible $window.Root 'Сравнение двух выборок' 10)) {
        throw 'INSTALLED_ACTIVITY_A42_COMPARISON_CARD_MISSING'
    }
    $clearMining = Find-Accessible $window.Root 'Очистить результат' 10
    if (!$clearMining) { throw 'INSTALLED_ACTIVITY_A42_CLEAR_MISSING' }
    $clearMining.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    Start-Sleep -Milliseconds 500
    if (Find-Accessible $window.Root 'Сравнение двух выборок' 2) {
        throw 'INSTALLED_ACTIVITY_A42_STALE_COMPARISON'
    }
    Write-Host 'IWXA_ACTIVITY_A42_NATIVE_COMPARISON_PASS synthetic_example=YES activity_differences=1 transition_differences=3 stale=NO'
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