//go:build windows

package main

import (
	"context"
	"errors"
	"io"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

// Native Win32 UI: no embedded browser, background services, or third-party UI DLLs.
// The external VPN application is never started or controlled by this program.
const (
	wmCreate           = 0x0001
	wmDestroy          = 0x0002
	wmSize             = 0x0005
	wmClose            = 0x0010
	wmCommand          = 0x0111
	wmSetFont          = 0x0030
	wmAppLog           = 0x8001
	wmAppDone          = 0x8002
	wmAppBoot          = 0x8003
	wmAppRefresh       = 0x8004
	wmAppVPNState      = 0x8005
	wmAppInternet      = 0x8006
	wmAppGuideStep     = 0x8007
	wmAppLive          = 0x8008
	wmAppGuidePrompt   = 0x8009
	wsOverlappedWindow = 0x00CF0000
	wsVisible          = 0x10000000
	wsChild            = 0x40000000
	wsTabStop          = 0x00010000
	wsBorder           = 0x00800000
	wsVScroll          = 0x00200000
	esAutoHScroll      = 0x0080
	esMultiline        = 0x0004
	esReadOnly         = 0x0800
	esAutoVScroll      = 0x0040
	cbDropdownList     = 0x0003
	cbAddString        = 0x0143
	cbGetCurSel        = 0x0147
	cbSetCurSel        = 0x014E
	emSetSel           = 0x00B1
	emReplaceSel       = 0x00C2
	idSave             = 2001
	idStart            = 2002
	idStop             = 2003
	idReport           = 2004
	idPrepare          = 2005
	idDNS              = 2006
	idRefresh          = 2007
	idInternet         = 2008
	idRecover          = 2009
	idAdvanced         = 2010
	idGuide            = 2011
	idGuideInstruction = 2012
	idNetworkHealth    = 2013
	idLive             = 2014
	idPath             = 2015
	idStability        = 2016
	idPublicIP         = 2017
	idGeoLine          = 2018
	idSpeedLine        = 2019
	idRiskLine         = 2020
	idApplications     = 2021
	idMTUTrial         = 2022
	idGuideConfirm     = 2023
	idGuideSkip        = 2024
	idProductManual    = 2025
	idProductEffect    = 2026
	idProductReason    = 2027
	idProductAge       = 2028
)

type winClassEx struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   uintptr
	Icon       uintptr
	Cursor     uintptr
	Background uintptr
	MenuName   *uint16
	ClassName  *uint16
	IconSmall  uintptr
}

type winPoint struct{ X, Y int32 }
type winMessage struct {
	Window  uintptr
	Message uint32
	_       uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Point   winPoint
	Private uint32
}
type winRect struct{ L, T, R, B int32 }

var (
	userDLL        = syscall.NewLazyDLL("user32.dll")
	kernelDLL      = syscall.NewLazyDLL("kernel32.dll")
	gdiDLL         = syscall.NewLazyDLL("gdi32.dll")
	procRegister   = userDLL.NewProc("RegisterClassExW")
	procCreate     = userDLL.NewProc("CreateWindowExW")
	procDefault    = userDLL.NewProc("DefWindowProcW")
	procGetMessage = userDLL.NewProc("GetMessageW")
	procTranslate  = userDLL.NewProc("TranslateMessage")
	procDispatch   = userDLL.NewProc("DispatchMessageW")
	procShow       = userDLL.NewProc("ShowWindow")
	procUpdate     = userDLL.NewProc("UpdateWindow")
	procPostQuit   = userDLL.NewProc("PostQuitMessage")
	procDestroy    = userDLL.NewProc("DestroyWindow")
	procMessageBox = userDLL.NewProc("MessageBoxW")
	procSend       = userDLL.NewProc("SendMessageW")
	procPost       = userDLL.NewProc("PostMessageW")
	procSetText    = userDLL.NewProc("SetWindowTextW")
	procGetTextLen = userDLL.NewProc("GetWindowTextLengthW")
	procGetText    = userDLL.NewProc("GetWindowTextW")
	procEnable     = userDLL.NewProc("EnableWindow")
	procMove       = userDLL.NewProc("MoveWindow")
	procClientRect = userDLL.NewProc("GetClientRect")
	procLoadCursor = userDLL.NewProc("LoadCursorW")
	procGetModule  = kernelDLL.NewProc("GetModuleHandleW")
	procDpiAware   = userDLL.NewProc("SetProcessDpiAwarenessContext")
	procGuiFont    = gdiDLL.NewProc("GetStockObject")
)

func wstr(s string) *uint16            { p, _ := syscall.UTF16PtrFromString(s); return p }
func loword(v uintptr) int             { return int(v & 0xffff) }
func post(window uintptr, msg uintptr) { procPost.Call(window, msg, 0, 0) }
func send(window uintptr, msg, w, l uintptr) uintptr {
	r, _, _ := procSend.Call(window, msg, w, l)
	return r
}
func winSetText(window uintptr, s string) { procSetText.Call(window, uintptr(unsafe.Pointer(wstr(s)))) }
func winText(window uintptr) string {
	n, _, _ := procGetTextLen.Call(window)
	if n > 8192 {
		n = 8192
	}
	v := make([]uint16, int(n)+1)
	procGetText.Call(window, uintptr(unsafe.Pointer(&v[0])), n+1)
	return syscall.UTF16ToString(v)
}
func winMessageBox(parent uintptr, message, title string, flags uintptr) int {
	r, _, _ := procMessageBox.Call(parent, uintptr(unsafe.Pointer(wstr(message))), uintptr(unsafe.Pointer(wstr(title))), flags)
	return int(r)
}

// GUI diagnostics have the same privacy rules as exported reports.
func cleanLog(s string) string { return redactText(s) }

type managerUI struct {
	hwnd                                                                                                                                                     uintptr
	home                                                                                                                                                     string
	cfg                                                                                                                                                      Config
	endpoint, port, adapter, engine, transport, preferred                                                                                                    uintptr
	logs, status, startButton, stopButton, saveButton, prepareButton, dnsButton                                                                              uintptr
	refreshButton, internetButton, recoverButton, advancedButton, guideButton, networkButton, liveButton, pathButton, stabilityButton, appsButton, mtuButton uintptr
	vpnLine, netLine, dpiLine, guideLine, publicLine, geoLine, speedLine, riskLine, productEffect, productReason, productAge, productManual                                                                           uintptr
	advancedControls                                                                                                                                         []uintptr
	advanced, details                                                                                                                                                 bool
	autoAdapter                                                                                                                                              string
	mu                                                                                                                                                       sync.Mutex
	queue                                                                                                                                                    []string
	cancel                                                                                                                                                   context.CancelFunc
	running, preparing, inspectingDNS, closing                                                                                                               bool
	guiding                                                                                                                                                  bool
	liveBusy                                                                                                                                                 bool
	liveView                                                                                                                                                 PublicView
	liveAudit                                                                                                                                                LiveAudit
	guideStep                                                                                                                                                string
	guidePrompt                                                                                                                                              chan bool
	guidePromptMode string
	guideConfirm, guideSkip                                                                                                                                  uintptr
	refreshing, recovering                                                                                                                                   bool
	stopError                                                                                                                                                string
	lastSnapshot                                                                                                                                             VPNState
	snapshotError                                                                                                                                            bool
	lastOnline                                                                                                                                               bool
	pollStop                                                                                                                                                 chan struct{}
	lifetimeCtx                                                                                                                                              context.Context
	lifetimeCancel                                                                                                                                           context.CancelFunc
}

var activeUI *managerUI // one window, one manager process, no resident daemon

func (ui *managerUI) write(s string) {
	ui.mu.Lock()
	ui.queue = append(ui.queue, cleanLog(s))
	ui.mu.Unlock()
	if ui.hwnd != 0 {
		post(ui.hwnd, wmAppLog)
	}
}

type uiWriter struct{ ui *managerUI }

func (w uiWriter) Write(b []byte) (int, error) { w.ui.write(string(b)); return len(b), nil }

func (ui *managerUI) flush() {
	ui.mu.Lock()
	chunks := ui.queue
	ui.queue = nil
	ui.mu.Unlock()
	for _, chunk := range chunks {
		// Multiline edit appends text only to the last cursor position, never replaces log content.
		chunk = strings.ReplaceAll(chunk, "\n", "\r\n")
		send(ui.logs, emSetSel, ^uintptr(0), ^uintptr(0))
		send(ui.logs, emReplaceSel, 0, uintptr(unsafe.Pointer(wstr(chunk))))
	}
	// Cap GUI memory without touching retained local JSON reports.
	if n, _, _ := procGetTextLen.Call(ui.logs); n > 48000 {
		existing := winText(ui.logs)
		runes := []rune(existing)
		if len(runes) > 23000 {
			winSetText(ui.logs, string(runes[len(runes)-20000:]))
		}
	}
}
func (ui *managerUI) setStatus(s string) { winSetText(ui.status, s) }
func (ui *managerUI) toggleRun(r bool) {
	ui.running = r
	if r {
		ui.setStatus("Идут испытания. VPN подключается отдельно.")
	} else {
		ui.setStatus("Остановлено / ожидание.")
	}
	value := uintptr(1)
	if r {
		value = 0
	}
	procEnable.Call(ui.startButton, value)
	procEnable.Call(ui.saveButton, value)
	procEnable.Call(ui.prepareButton, value)
	procEnable.Call(ui.dnsButton, value)
	procEnable.Call(ui.refreshButton, value)
	procEnable.Call(ui.internetButton, value)
	procEnable.Call(ui.recoverButton, value)
	procEnable.Call(ui.advancedButton, 1) // Read-only details remain available during tests
	procEnable.Call(ui.productManual, value)
	procEnable.Call(ui.guideButton, value)
	procEnable.Call(ui.networkButton, value)
	procEnable.Call(ui.pathButton, value)
	procEnable.Call(ui.appsButton, value)
	procEnable.Call(ui.mtuButton, value)
	procEnable.Call(ui.stabilityButton, value)
	// The independent speed check is available even while a DPI wizard is running.
	if r {
		procEnable.Call(ui.stopButton, 1)
		procShow.Call(ui.stopButton, 5)
	} else {
		procEnable.Call(ui.stopButton, 0)
		procShow.Call(ui.stopButton, 0)
	}
}
func (ui *managerUI) capture() (Config, error) {
	c := ui.cfg
	c.EndpointIPv4 = strings.TrimSpace(winText(ui.endpoint))
	n, err := strconv.Atoi(strings.TrimSpace(winText(ui.port)))
	if err != nil {
		return c, errors.New("введите числовой порт 1..65535")
	}
	c.Port = n
	i := send(ui.transport, cbGetCurSel, 0, 0)
	switch i {
	case 0:
		c.Transport = "AWG-UDP"
	case 1:
		c.Transport = "REALITY-TCP"
	case 2:
		c.Transport = "XHTTP-TCP"
	default:
		return c, errors.New("не выбран транспорт")
	}
	c.AdapterName = strings.TrimSpace(winText(ui.adapter))
	preferredNames := []string{"", "NONE", "UDP-FAKE", "UDP-REPEAT", "TLS-SPLIT", "TLS-DISORDER", "TLS-FAKESEQ", "TLS-FAKETTL"}
	idx := int(send(ui.preferred, cbGetCurSel, 0, 0))
	if idx >= 0 && idx < len(preferredNames) {
		c.PreferredProfile = preferredNames[idx]
	}
	c.BundleRoot = strings.TrimSpace(winText(ui.engine))
	if c.PreferredProfile != "" && c.PreferredProfile != "NONE" {
		selectedUDP := strings.HasPrefix(c.PreferredProfile, "UDP-")
		if selectedUDP != (c.Transport == "AWG-UDP") {
			return c, errors.New("приоритетная стратегия не соответствует выбранному транспорту")
		}
	}
	if err := validateConfig(c); err != nil {
		return c, err
	}
	if c.EndpointIPv4 != ui.cfg.EndpointIPv4 || c.Port != ui.cfg.Port || c.Transport != ui.cfg.Transport || c.AdapterName != ui.cfg.AdapterName || c.BundleRoot != ui.cfg.BundleRoot {
		c.LastConfirmedProfile = ""
		c.LastConfirmedAt = ""
	}
	return c, nil
}
func (ui *managerUI) save() (Config, error) {
	c, err := ui.capture()
	if err != nil {
		return c, err
	}
	if err = saveJSON(filepath.Join(ui.home, "settings.json"), c); err != nil {
		return c, err
	}
	ui.cfg = c
	return c, nil
}
func (ui *managerUI) ask(text string) (string, error) {
	text = cleanLog(text)
	if strings.Contains(text, "[д/н]") || strings.Contains(text, "[y/n]") {
		if winMessageBox(ui.hwnd, text, "Bypass Manager: подтверждение", 0x24) == 6 {
			return "д", nil
		}
		return "н", nil
	}
	// Prompt is not automatic VPN control: human must operate the separate client.
	if winMessageBox(ui.hwnd, text+"\n\nOK — выполнено; Отмена — остановить испытание.", "Bypass Manager", 0x21) == 1 {
		return "", nil
	}
	return "", errors.New("пользователь отменил испытание")
}
func (ui *managerUI) start() {
	if strings.TrimSpace(winText(ui.endpoint)) == "" || strings.TrimSpace(winText(ui.port)) == "" {
		winMessageBox(ui.hwnd, "No verified server and port from Amnezia Premium. This advanced mode will not guess or intercept packets. First use Check internet.", "Bypass Manager", 0x30)
		return
	}
	if winMessageBox(ui.hwnd, "Confirm that this external VPN server IP and port are current. A wrong endpoint could interrupt access. Continue?", "Bypass Manager: DPI", 0x24) != 6 {
		return
	}
	c, err := ui.save()
	if err != nil {
		winMessageBox(ui.hwnd, err.Error(), "Ошибка настроек", 0x30)
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	ui.cancel = cancel
	ui.toggleRun(true)
	ui.write("Запуск: " + utc() + "\n")
	go func() {
		m := &Manager{cfg: c, home: ui.home, runtimeRoot: filepath.Join(ui.home, "runtime"), stateFolder: filepath.Join(ui.home, "active"), logDir: filepath.Join(ui.home, "results"), output: uiWriter{ui}, ask: ui.ask}
		err := m.run(ctx)
		// Always stop only the process that belongs to this manager, never the VPN client.
		if m.ownStateExists() {
			if stopErr := m.stopFilter(); stopErr != nil {
				ui.mu.Lock()
				ui.stopError = stopErr.Error()
				ui.mu.Unlock()
				ui.write("ВНИМАНИЕ: не удалось снять собственный DPI-фильтр: " + stopErr.Error() + "\n")
			}
		}
		m.report.EndedUTC = utc()
		m.persist()
		if err != nil && ctx.Err() == nil {
			ui.write("Ошибка испытания: " + err.Error() + "\n")
		}
		if err == nil {
			ui.write("Завершено. Результат: " + m.report.Status + "\n")
		}
		post(ui.hwnd, wmAppDone)
	}()
}

// Allows the owner to prepare the verified upstream files before knowing a
// specific VPN endpoint. It never launches the VPN client or a packet filter.
func (ui *managerUI) prepareEngine() {
	if ui.running {
		return
	}
	root := strings.TrimSpace(winText(ui.engine))
	if root == "" || !filepath.IsAbs(root) {
		winMessageBox(ui.hwnd, "Укажите полный путь к папке движка.", "Проверка пути", 0x30)
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	ui.cancel = cancel
	ui.preparing = true
	ui.toggleRun(true)
	ui.setStatus("Подготовка оригинального winws2 без запуска DPI...")
	ui.write("Проверка файлов движка. VPN-клиент не используется.\n")
	go func() {
		defer post(ui.hwnd, wmAppDone)
		if enginePresent(root) {
			ui.write("Оригинальный движок уже подготовлен и проверен. Можно работать без загрузки.\n")
			return
		}
		if err := installUpstream(ctx, root, ui.ask, uiWriter{ui}); err != nil {
			ui.write("Подготовка движка не завершена: " + err.Error() + "\n")
			return
		}
		ui.write("Движок подготовлен. Отдельная установка Zapret не требуется.\n")
	}()
}

// Passive DNS diagnostics are intentionally separate from the DPI trial.
// The action requires only an already-connected adapter name; it does not
// prompt for or change VPN profiles, routes, DNS, firewall or proxy settings.
func (ui *managerUI) inspectDNS() {
	if ui.running {
		return
	}
	adapter := strings.TrimSpace(winText(ui.adapter))
	if adapter == "" {
		ui.refreshVPN()
		winMessageBox(ui.hwnd, "VPN-адаптер пока не обнаружен автоматически. Подключите Amnezia и нажмите Обновить.", "Диагностика DNS", 0x30)
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	ui.cancel = cancel
	ui.inspectingDNS = true
	ui.toggleRun(true)
	ui.setStatus("Пассивная проверка маршрутов DNS без изменения настроек...")
	ui.write("Проверка DNS-маршрутов Windows. Реальные DNS-запросы не отправляются.\n")
	go func() {
		defer post(ui.hwnd, wmAppDone)
		m := &Manager{cfg: Config{AdapterName: adapter}, home: ui.home,
			runtimeRoot: filepath.Join(ui.home, "runtime"), output: uiWriter{ui}}
		if err := m.ensureRuntime(); err != nil {
			ui.write("Ошибка подготовки DNS-диагностики. Проверьте доступ к папке приложения.\n")
			return
		}
		snapshot := m.dnsExposure(ctx)
		risk, note := assessDNSExposure(snapshot)
		if ctx.Err() != nil {
			ui.write("Проверка DNS отменена.\n")
			return
		}
		if snapshot == nil {
			ui.write("DNS: маршрут проверить не удалось, статус приватности НЕИЗВЕСТЕН.\n")
			return
		}
		ui.write("DNS: серверов VPN " + strconv.Itoa(snapshot.VPNDNSCount) + ", других " + strconv.Itoa(snapshot.OtherDNSCount) +
			", маршрутов вне VPN " + strconv.Itoa(snapshot.OutsideVPNRoutes) + ", неизвестных " + strconv.Itoa(snapshot.UnknownRoutes) + ".\n")
		if risk {
			ui.write("ВНИМАНИЕ: возможен выход DNS вне VPN. Реальная утечка не подтверждена.\n")
		}
		ui.write("Итог: " + note + ". Браузерный DoH, WebRTC и фактические DNS-запросы не проверены.\n")
	}()
}

func (ui *managerUI) stop() {
	if ui.cancel != nil {
		ui.cancel()
	}
	if ui.guiding {
		ui.setStatus("Остановка помощника подключения...")
	} else if ui.inspectingDNS {
		ui.setStatus("Отмена диагностики DNS...")
	} else if ui.preparing {
		ui.setStatus("Отмена подготовки движка...")
	} else {
		ui.setStatus("Завершение и остановка собственного winws2...")
	}
}

// Startup and refresh only read Windows interfaces. No VPN profile/keys are read,
// no WinDivert filter is installed, and there are no external requests.
func (ui *managerUI) refreshVPN() {
	if ui.running || ui.refreshing || ui.closing {
		return
	}
	ui.refreshing = true
	go func() {
		ctx, cancel := context.WithTimeout(ui.lifetimeCtx, 12*time.Second)
		defer cancel()
		m := &Manager{home: ui.home, runtimeRoot: filepath.Join(ui.home, "runtime"), output: uiWriter{ui}}
		err := m.ensureRuntime()
		var s VPNState
		if err == nil {
			s, err = m.vpnState(ctx)
		}
		ui.mu.Lock()
		ui.lastSnapshot, ui.snapshotError = s, err != nil
		ui.mu.Unlock()
		post(ui.hwnd, wmAppVPNState)
	}()
}

func (ui *managerUI) applyVPNStatus() {
	ui.mu.Lock()
	s, failed := ui.lastSnapshot, ui.snapshotError
	ui.mu.Unlock()
	ui.refreshing = false
	if failed {
		winSetText(ui.vpnLine, "VPN: \u0434\u0438\u0430\u0433\u043d\u043e\u0441\u0442\u0438\u043a\u0430 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430")
		return
	}
	if name, ok := detectedAdapter(s); ok {
		// Do not overwrite a manually edited adapter field.
		old := strings.TrimSpace(winText(ui.adapter))
		if old == "" || (ui.autoAdapter != "" && old == ui.autoAdapter) {
			winSetText(ui.adapter, name)
			ui.autoAdapter = name
		}
	} else if ui.autoAdapter != "" && strings.TrimSpace(winText(ui.adapter)) == ui.autoAdapter {
		winSetText(ui.adapter, "")
		ui.autoAdapter = ""
	}
	switch vpnStateCode(s) {
	case "ROUTE_OBSERVED":
		winSetText(ui.vpnLine, "VPN: \u0430\u0434\u0430\u043f\u0442\u0435\u0440 \u0438 \u043c\u0430\u0440\u0448\u0440\u0443\u0442 \u043e\u0431\u043d\u0430\u0440\u0443\u0436\u0435\u043d\u044b; \u0434\u043e\u0441\u0442\u0443\u043f \u0432 \u0441\u0435\u0442\u044c \u043d\u0435 \u0434\u043e\u043a\u0430\u0437\u0430\u043d")
	case "ADAPTER_OBSERVED":
		winSetText(ui.vpnLine, "VPN: \u0430\u0434\u0430\u043f\u0442\u0435\u0440 \u043e\u0431\u043d\u0430\u0440\u0443\u0436\u0435\u043d, \u0441\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u0435 \u043d\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u043e")
	case "AMBIGUOUS":
		winSetText(ui.vpnLine, "VPN: \u043d\u0430\u0439\u0434\u0435\u043d\u043e \u043d\u0435\u0441\u043a\u043e\u043b\u044c\u043a\u043e \u0430\u0434\u0430\u043f\u0442\u0435\u0440\u043e\u0432; \u0430\u0432\u0442\u043e\u0432\u044b\u0431\u043e\u0440 \u043d\u0435\u0432\u043e\u0437\u043c\u043e\u0436\u0435\u043d")
	case "ADAPTER_NOT_ACTIVE":
		winSetText(ui.vpnLine, "VPN: \u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0439 \u0430\u0434\u0430\u043f\u0442\u0435\u0440 \u043d\u0435 \u043e\u0431\u043d\u0430\u0440\u0443\u0436\u0435\u043d")
	default:
		winSetText(ui.vpnLine, "VPN: \u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435 \u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e")
	}
	ui.updateOwnedState()
	if !ui.running { ui.updateProductSummary() }
	ui.invalidateOldPublicView(s)
}

func (ui *managerUI) updateOwnedState() {
	owned := (&Manager{stateFolder: filepath.Join(ui.home, "active")}).ownStateExists()
	if owned {
		winSetText(ui.dpiLine, "DPI сейчас: есть запись собственного процесса. Проверьте остановку в подробностях.")
	} else {
		winSetText(ui.dpiLine, "DPI сейчас: свой процесс не зарегистрирован (обработка выключена).")
	}
}

// Terminate only the instance recorded by this manager, with PID, path and
// start time verified by Start-Profile.ps1. No Amnezia or Windows route changes.
func (ui *managerUI) restoreNetwork() {
	if ui.running {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	ui.cancel = cancel
	ui.recovering = true
	ui.toggleRun(true)
	ui.setStatus("\u041e\u0441\u0442\u0430\u043d\u0430\u0432\u043b\u0438\u0432\u0430\u044e \u0442\u043e\u043b\u044c\u043a\u043e \u0441\u0432\u043e\u0439 winws2...")
	go func() {
		defer post(ui.hwnd, wmAppDone)
		m := &Manager{home: ui.home, runtimeRoot: filepath.Join(ui.home, "runtime"), stateFolder: filepath.Join(ui.home, "active"), output: uiWriter{ui}}
		if err := m.ensureRuntime(); err != nil {
			ui.write("\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u0438\u0442\u044c \u0434\u0438\u0430\u0433\u043d\u043e\u0441\u0442\u0438\u043a\u0443.\n")
			return
		}
		if err := m.stopFilter(); err != nil {
			ui.mu.Lock()
			ui.stopError = err.Error()
			ui.mu.Unlock()
			ui.write("\u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0441\u0442\u0430\u043d\u043e\u0432\u043a\u0438 \u0441\u0432\u043e\u0435\u0433\u043e winws2.\n")
			return
		}
		ui.write("\u0421\u0432\u043e\u0439 DPI-\u043f\u0440\u043e\u0446\u0435\u0441\u0441 \u043e\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d (\u0435\u0441\u043b\u0438 \u0431\u044b\u043b). Amnezia \u043d\u0435 \u0437\u0430\u0442\u0440\u043e\u043d\u0443\u0442\u0430.\n")
	}()
	_ = ctx // Cancel is only used to preserve existing UI stop semantics.
}

func (ui *managerUI) checkInternet() {
	if ui.running {
		return
	}
	if winMessageBox(ui.hwnd, "\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u0441\u0435\u0442\u0438 \u043e\u0431\u0440\u0430\u0449\u0430\u0435\u0442\u0441\u044f \u043a \u0432\u043d\u0435\u0448\u043d\u0438\u043c HTTPS-\u0441\u0435\u0440\u0432\u0438\u0441\u0430\u043c. \u041e\u043d\u0438 \u0443\u0432\u0438\u0434\u044f\u0442 \u0438\u0441\u0445\u043e\u0434\u044f\u0449\u0438\u0439 IP. \u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c?", "Bypass Manager", 0x24) != 6 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 14*time.Second)
	ui.cancel = cancel
	ui.toggleRun(true)
	winSetText(ui.netLine, "\u0421\u0435\u0442\u044c: \u0438\u0434\u0451\u0442 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0430...")
	go func() {
		defer post(ui.hwnd, wmAppDone)
		defer cancel()
		m := &Manager{}
		result := m.egress(ctx)
		ui.mu.Lock()
		ui.lastOnline = result.Agreement
		ui.mu.Unlock()
		post(ui.hwnd, wmAppInternet)
	}()
}

func (ui *managerUI) startUIBoot() {
	ui.updateOwnedState()
	ui.updateProductSummary()
	// The previous app could have crashed while its owned WinDivert process
	// remained active. Reconcile it before performing further diagnostics.
	if (&Manager{stateFolder: filepath.Join(ui.home, "active")}).ownStateExists() {
		ui.write("\u041f\u043e\u0441\u043b\u0435 \u043f\u0440\u043e\u0448\u043b\u043e\u0433\u043e \u0437\u0430\u043f\u0443\u0441\u043a\u0430 \u043e\u0441\u0442\u0430\u043b\u0430\u0441\u044c \u0437\u0430\u043f\u0438\u0441\u044c DPI. \u041f\u0440\u043e\u0432\u0435\u0440\u044f\u044e \u0438 \u043e\u0441\u0442\u0430\u043d\u0430\u0432\u043b\u0438\u0432\u0430\u044e \u0442\u043e\u043b\u044c\u043a\u043e \u0441\u0432\u043e\u0439 \u043f\u0440\u043e\u0446\u0435\u0441\u0441.\n")
		ui.restoreNetwork()
	} else {
		ui.refreshVPN()
	}
	ui.pollStop = make(chan struct{})
	stop := ui.pollStop
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				post(ui.hwnd, wmAppRefresh)
			}
		}
	}()
}

func (ui *managerUI) advancedCtrl(parent uintptr, class, name string, style uint32, id int, x, y, w, h int32) uintptr {
	handle := ctrl(parent, class, name, style, id, x, y, w, h)
	ui.advancedControls = append(ui.advancedControls, handle)
	return handle
}
func (ui *managerUI) applyAdvanced() { ui.applyProductDetails() }

func ctrl(parent uintptr, class, name string, style uint32, id int, x, y, w, h int32) uintptr {
	instance, _, _ := procGetModule.Call(0)
	handle, _, _ := procCreate.Call(0, uintptr(unsafe.Pointer(wstr(class))), uintptr(unsafe.Pointer(wstr(name))), uintptr(style|wsChild|wsVisible), uintptr(x), uintptr(y), uintptr(w), uintptr(h), parent, uintptr(id), instance, 0)
	font, _, _ := procGuiFont.Call(17)
	if handle != 0 {
		send(handle, wmSetFont, font, 1)
	}
	return handle
}
func (ui *managerUI) initControls() {
	ctrl(ui.hwnd, "STATIC", "Bypass Manager 0.3 Alpha", 0, 0, 20, 16, 820, 26)
	ctrl(ui.hwnd, "STATIC", "\u0410\u0432\u0442\u043e\u0434\u0438\u0430\u0433\u043d\u043e\u0441\u0442\u0438\u043a\u0430 \u0431\u0435\u0437 \u0441\u0435\u0442\u0435\u0432\u044b\u0445 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0439. Amnezia \u0443\u043f\u0440\u0430\u0432\u043b\u044f\u0435\u0442\u0441\u044f \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u043e.", 0, 0, 20, 46, 820, 24)
	ui.vpnLine = ctrl(ui.hwnd, "STATIC", "VPN: \u043f\u043e\u0438\u0441\u043a \u0430\u0434\u0430\u043f\u0442\u0435\u0440\u0430...", 0, 0, 20, 80, 820, 24)
	ui.netLine = ctrl(ui.hwnd, "STATIC", "\u0421\u0435\u0442\u044c: \u043d\u0435 \u043f\u0440\u043e\u0432\u0435\u0440\u0435\u043d\u0430", 0, 0, 20, 107, 820, 24)
	ui.dpiLine = ctrl(ui.hwnd, "STATIC", "DPI: \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0430...", 0, 0, 20, 134, 820, 24)
	ui.guideButton = ctrl(ui.hwnd, "BUTTON", "Автоподбор VPN и видео", wsTabStop, idGuide, 20, 170, 285, 37)
	ui.liveButton = ctrl(ui.hwnd, "BUTTON", "Выход / скорость", wsTabStop, idLive, 315, 170, 235, 37)
	ui.stabilityButton = ctrl(ui.hwnd, "BUTTON", "Тест видео: 15 мин", wsTabStop, idStability, 565, 170, 270, 37)
	ui.guideLine = ctrl(ui.hwnd, "STATIC", "Шаг 1. Нажмите «Автоподбор VPN и видео». Программа сама выбирает следующий тест.", 0, idGuideInstruction, 20, 210, 610, 42)
	// Explicit actions live in the main window. Unlike an owned MessageBox,
	// they never disable the Stop button or block the window message loop.
	ui.guideConfirm = ctrl(ui.hwnd, "BUTTON", "Готово", wsTabStop, idGuideConfirm, 639, 215, 95, 32)
	ui.guideSkip = ctrl(ui.hwnd, "BUTTON", "Нет / пропустить", wsTabStop, idGuideSkip, 743, 215, 130, 32)
	procShow.Call(ui.guideConfirm, 0)
	procShow.Call(ui.guideSkip, 0)
	ui.publicLine = ctrl(ui.hwnd, "STATIC", "Публичный IPv4: нажмите «Проверить выход и скорость»", 0, 2017, 20, 249, 820, 23)
	ui.geoLine = ctrl(ui.hwnd, "STATIC", "Регион IP: неизвестен (определяется только по согласию)", 0, 2018, 20, 273, 820, 23)
	ui.speedLine = ctrl(ui.hwnd, "STATIC", "Скорость: не измерена, можно перепроверить в любой момент", 0, 2019, 20, 297, 820, 23)
	ui.riskLine = ctrl(ui.hwnd, "STATIC", "Сравнение с исходным IP: сначала измерьте без VPN, затем с VPN", 0, 2020, 20, 321, 820, 23)
	ui.refreshButton = ctrl(ui.hwnd, "BUTTON", "\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c", wsTabStop, idRefresh, 20, 359, 150, 32)
	ui.internetButton = ctrl(ui.hwnd, "BUTTON", "\u041f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c \u0438\u043d\u0442\u0435\u0440\u043d\u0435\u0442", wsTabStop, idInternet, 180, 359, 175, 32)
	ui.recoverButton = ctrl(ui.hwnd, "BUTTON", "\u0412\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c \u0441\u0435\u0442\u044c", wsTabStop, idRecover, 365, 359, 195, 32)
	ctrl(ui.hwnd, "BUTTON", "Собрать отчёт", wsTabStop, idReport, 571, 359, 130, 32)
	ui.advancedButton = ctrl(ui.hwnd, "BUTTON", "\u041f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u044b DPI", wsTabStop, idAdvanced, 713, 359, 140, 32)
	ui.prepareButton = ctrl(ui.hwnd, "BUTTON", "\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u0438\u0442\u044c \u0434\u0432\u0438\u0436\u043e\u043a", wsTabStop, idPrepare, 20, 400, 200, 32)
	ui.dnsButton = ctrl(ui.hwnd, "BUTTON", "\u041f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c DNS", wsTabStop, idDNS, 230, 400, 160, 32)
	ui.networkButton = ctrl(ui.hwnd, "BUTTON", "Диагностика сети", wsTabStop, idNetworkHealth, 540, 400, 145, 32)
	ui.pathButton = ctrl(ui.hwnd, "BUTTON", "Задержка / MTU", wsTabStop, idPath, 693, 400, 155, 32)
	ui.appsButton = ctrl(ui.hwnd, "BUTTON", "Программы / соединения", wsTabStop, idApplications, 20, 440, 200, 32)
	ui.mtuButton = ctrl(ui.hwnd, "BUTTON", "Проба MTU с откатом", wsTabStop, idMTUTrial, 230, 440, 215, 32)
	ui.stopButton = ctrl(ui.hwnd, "BUTTON", "\u041e\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c", wsTabStop, idStop, 400, 400, 130, 32)
	ui.status = ctrl(ui.hwnd, "STATIC", "\u041e\u0436\u0438\u0434\u0430\u043d\u0438\u0435. \u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 VPN \u043d\u0435 \u043c\u0435\u043d\u044f\u044e\u0442\u0441\u044f.", 0, 0, 20, 483, 820, 22)
	// Advanced transport/endpoint fields are hidden until expressly requested.
	ui.advancedCtrl(ui.hwnd, "STATIC", "IP VPN-\u0441\u0435\u0440\u0432\u0435\u0440\u0430", 0, 0, 20, 523, 130, 22)
	ui.endpoint = ui.advancedCtrl(ui.hwnd, "EDIT", ui.cfg.EndpointIPv4, wsBorder|wsTabStop|esAutoHScroll, 101, 160, 517, 235, 26)
	ui.advancedCtrl(ui.hwnd, "STATIC", "\u041f\u043e\u0440\u0442", 0, 0, 422, 523, 60, 22)
	port := strconv.Itoa(ui.cfg.Port)
	if ui.cfg.Port == 0 {
		port = ""
	}
	ui.port = ui.advancedCtrl(ui.hwnd, "EDIT", port, wsBorder|wsTabStop|esAutoHScroll, 102, 494, 517, 92, 26)
	ui.advancedCtrl(ui.hwnd, "STATIC", "\u0422\u0440\u0430\u043d\u0441\u043f\u043e\u0440\u0442", 0, 0, 606, 523, 90, 22)
	ui.transport = ui.advancedCtrl(ui.hwnd, "COMBOBOX", "", wsTabStop|wsVScroll|cbDropdownList, 103, 703, 517, 132, 320)
	for _, name := range []string{"AWG-UDP", "REALITY-TCP", "XHTTP-TCP"} {
		send(ui.transport, cbAddString, 0, uintptr(unsafe.Pointer(wstr(name))))
	}
	sel := uintptr(0)
	if ui.cfg.Transport == "REALITY-TCP" {
		sel = 1
	} else if ui.cfg.Transport == "XHTTP-TCP" {
		sel = 2
	}
	send(ui.transport, cbSetCurSel, sel, 0)
	ui.advancedCtrl(ui.hwnd, "STATIC", "VPN-\u0430\u0434\u0430\u043f\u0442\u0435\u0440", 0, 0, 20, 562, 135, 22)
	ui.adapter = ui.advancedCtrl(ui.hwnd, "EDIT", ui.cfg.AdapterName, wsBorder|wsTabStop|esAutoHScroll, 104, 160, 557, 245, 27)
	ui.advancedCtrl(ui.hwnd, "STATIC", "\u041f\u0440\u0438\u043e\u0440\u0438\u0442\u0435\u0442", 0, 0, 430, 562, 95, 22)
	ui.preferred = ui.advancedCtrl(ui.hwnd, "COMBOBOX", "", wsTabStop|wsVScroll|cbDropdownList, 106, 533, 557, 290, 250)
	names := []string{"\u0410\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438", "NONE", "UDP-FAKE", "UDP-REPEAT", "TLS-SPLIT", "TLS-DISORDER", "TLS-FAKESEQ", "TLS-FAKETTL"}
	preferred := uintptr(0)
	for i, name := range names {
		send(ui.preferred, cbAddString, 0, uintptr(unsafe.Pointer(wstr(name))))
		if name == ui.cfg.PreferredProfile {
			preferred = uintptr(i)
		}
	}
	send(ui.preferred, cbSetCurSel, preferred, 0)
	ui.advancedCtrl(ui.hwnd, "STATIC", "\u041f\u0430\u043f\u043a\u0430 winws2", 0, 0, 20, 605, 135, 22)
	ui.engine = ui.advancedCtrl(ui.hwnd, "EDIT", ui.cfg.BundleRoot, wsBorder|wsTabStop|esAutoHScroll, 105, 160, 598, 655, 27)
	ui.saveButton = ui.advancedCtrl(ui.hwnd, "BUTTON", "\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c DPI-\u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u044b", wsTabStop, idSave, 20, 635, 240, 35)
	ui.startButton = ui.advancedCtrl(ui.hwnd, "BUTTON", "\u0410\u0432\u0442\u043e\u043f\u043e\u0434\u0431\u043e\u0440 DPI", wsTabStop, idStart, 272, 635, 195, 35)
	ui.logs = ctrl(ui.hwnd, "EDIT", "Bypass Manager 0.3 Alpha\r\n\u0414\u043b\u044f \u043d\u0430\u0447\u0430\u043b\u0430 \u043d\u0430\u0436\u043c\u0438\u0442\u0435 \u00ab\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c\u00bb \u0438\u043b\u0438 \u00ab\u041f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c \u0438\u043d\u0442\u0435\u0440\u043d\u0435\u0442\u00bb.\r\n", wsBorder|wsVScroll|esMultiline|esAutoVScroll|esReadOnly, 110, 20, 513, 820, 326)
	procEnable.Call(ui.stopButton, 0)
	ui.initProductUI()
}

func (ui *managerUI) layout() {
	if ui.logs == 0 {
		return
	}
	var rc winRect
	procClientRect.Call(ui.hwnd, uintptr(unsafe.Pointer(&rc)))
	w, h := rc.R-rc.L, rc.B-rc.T
	if w < 730 || h < 560 {
		return
	}
	for i, handle := range []uintptr{ui.vpnLine, ui.netLine, ui.dpiLine} {
		if handle != 0 {
			procMove.Call(handle, 20, uintptr(80+27*i), uintptr(w-40), 24, 1)
		}
	}
	procMove.Call(ui.status, 20, 483, uintptr(w-40), 22, 1)
	bottom := int32(513)
	if ui.advanced {
		bottom = 683
		procMove.Call(ui.engine, 160, 598, uintptr(w-200), 27, 1)
	}
	if h-bottom < 100 {
		bottom = h - 110
	}
	procMove.Call(ui.logs, 20, uintptr(bottom), uintptr(w-45), uintptr(h-bottom-22), 1)
	ui.layoutProduct()
}

func windowCallback(hwnd uintptr, message uint32, w, l uintptr) uintptr {
	ui := activeUI
	if ui == nil {
		r, _, _ := procDefault.Call(hwnd, uintptr(message), w, l)
		return r
	}
	switch message {
	case wmCreate:
		ui.hwnd = hwnd
		ui.initControls()
		return 0
	case wmSize:
		ui.layout()
		return 0
	case wmAppBoot:
		ui.startUIBoot()
		return 0
	case wmAppRefresh:
		ui.refreshVPN()
		return 0
	case wmAppVPNState:
		ui.applyVPNStatus()
		return 0
	case wmAppLive:
		ui.applyLive()
		ui.updateProductSummary()
		return 0
	case wmAppGuideStep:
		ui.mu.Lock()
		step := ui.guideStep
		pending := ui.guidePrompt != nil
		ui.mu.Unlock()
		if !pending {
			winSetText(ui.guideLine, step)
		}
		return 0
	case wmAppGuidePrompt:
		ui.refreshGuidePromptControls()
		return 0
	case wmAppInternet:
		ui.mu.Lock()
		online := ui.lastOnline
		ui.mu.Unlock()
		if online {
			winSetText(ui.netLine, "Сеть: доступ IPv4 подтверждён (VPN не доказан)")
			ui.write("HTTPS: IPv4 observed.\n")
		} else {
			winSetText(ui.netLine, "Сеть: доступ IPv4 не подтверждён")
			ui.write("IPv4 connection not confirmed; inspect Amnezia Kill Switch.\n")
		}
		return 0
	case wmCommand:
		switch loword(w) {
		case idGuide:
			ui.startGuide()
		case idGuideConfirm:
			ui.answerGuidePrompt(true)
		case idGuideSkip:
			ui.answerGuidePrompt(false)
		case idLive:
			ui.checkLive()
		case idStability:
			if !ui.running {
				ui.startStability()
			}
		case idRefresh:
			ui.refreshVPN()
		case idInternet:
			ui.checkInternet()
		case idRecover:
			ui.restoreNetwork()
		case idAdvanced:
			ui.details = !ui.details
			if !ui.details {ui.advanced = false}
			ui.applyAdvanced()
		case idProductManual:
			if ui.details && !ui.running {
				ui.advanced = !ui.advanced
				ui.applyAdvanced()
			}
		case idSave:
			if _, err := ui.save(); err != nil {
				winMessageBox(hwnd, err.Error(), "Ошибка", 0x30)
			} else {
				ui.write("Локальные настройки сохранены.\n")
			}
		case idStart:
			if !ui.running {
				ui.start()
			}
		case idStop:
			if ui.running {
				ui.stop()
			}
		case idPrepare:
			if !ui.running {
				ui.prepareEngine()
			}
		case idDNS:
			if !ui.running {
				ui.inspectDNS()
			}
		case idNetworkHealth:
			if !ui.running {
				ui.inspectNetwork()
			}
		case idApplications:
			if !ui.running {
				ui.inspectApps()
			}
		case idMTUTrial:
			if !ui.running {
				ui.trialMTU()
			}
		case idPath:
			if !ui.running {
				ui.inspectPath()
			}
		case idReport:
			file, report, err := saveSupport(filepath.Join(ui.home, "results"))
			if err != nil {
				winMessageBox(hwnd, "Не удалось сформировать безопасный сводный отчёт.", "Bypass Manager", 0x30)
			} else {
				ui.write("Сводный отчёт latest-support.json: включено " + strconv.Itoa(report.Available) + " файлов, IP и география исключены.\n")
				if p := exec.Command("notepad.exe", file); p != nil {
					if err := p.Start(); err == nil {
						_ = p.Process.Release()
					}
				}
			}

		}
		return 0
	case wmAppLog:
		ui.flush()
		return 0
	case wmAppDone:
		ui.answerGuidePrompt(false)
		ui.flush()
		ui.toggleRun(false)
		ui.preparing = false
		ui.inspectingDNS = false
		ui.guiding = false
		ui.cancel = nil
		ui.recovering = false
		ui.updateOwnedState()
		ui.updateProductSummary()
		if !ui.closing {
			post(ui.hwnd, wmAppRefresh)
		}
		ui.mu.Lock()
		stopErr := ui.stopError
		ui.stopError = ""
		ui.mu.Unlock()
		if stopErr != "" {
			winMessageBox(hwnd, "Не удалось подтвердить остановку winws2. Проверьте процесс вручную: "+stopErr, "Ошибка остановки", 0x30)
		}
		if ui.closing {
			procDestroy.Call(hwnd)
		}
		return 0
	case wmClose:
		if ui.running {
			ui.closing = true
			ui.stop()
			return 0
		}
		procDestroy.Call(hwnd)
		return 0
	case wmDestroy:
		if ui.pollStop != nil {
			close(ui.pollStop)
			ui.pollStop = nil
		}
		if ui.lifetimeCancel != nil {
			ui.lifetimeCancel()
		}
		procPostQuit.Call(0)
		return 0
	}
	r, _, _ := procDefault.Call(hwnd, uintptr(message), w, l)
	return r
}
func guiMain() int {
	// Win32 windows and GetMessage/PostQuitMessage belong to one OS thread.
	// Without this, Go may move the goroutine between Win32 thread queues,
	// leaving a window visible but ignoring or delaying WM_CLOSE.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	// Request UAC only to manage the WinDivert process; do not modify firewall or other adapters.
	relaunched, err := maybeRelaunchElevated()
	if err != nil {
		winMessageBox(0, err.Error(), "Bypass Manager: UAC", 0x30)
		return 2
	}
	if relaunched {
		return 0
	}
	// Per-monitor DPI support; failure is nonfatal on older Windows.
	procDpiAware.Call(^uintptr(3))
	home := defaultRoot()
	cfg, _ := loadConfig(filepath.Join(home, "settings.json"))
	if cfg.BundleRoot == "" {
		cfg.BundleRoot = preferredEngineRoot(home)
	}
	if cfg.Transport == "" {
		cfg.Transport = "AWG-UDP"
	}
	lifetimeCtx, lifetimeCancel := context.WithCancel(context.Background())
	ui := &managerUI{home: home, cfg: cfg, autoAdapter: cfg.AdapterName, lifetimeCtx: lifetimeCtx, lifetimeCancel: lifetimeCancel}
	activeUI = ui
	instance, _, _ := procGetModule.Call(0)
	cursor, _, _ := procLoadCursor.Call(0, 32512)
	class := wstr("IWXA_BypassManager_03")
	wc := winClassEx{Size: uint32(unsafe.Sizeof(winClassEx{})), WndProc: syscall.NewCallback(windowCallback), Instance: instance, Cursor: cursor, Background: 6, ClassName: class}
	registered, _, _ := procRegister.Call(uintptr(unsafe.Pointer(&wc)))
	if registered == 0 {
		winMessageBox(0, "Не удалось зарегистрировать окно.", "Bypass Manager", 0x10)
		return 2
	}
	hwnd, _, _ := procCreate.Call(0, uintptr(unsafe.Pointer(class)), uintptr(unsafe.Pointer(wstr("Bypass Manager 0.3 Alpha"))), wsOverlappedWindow|wsVisible, 180, 100, 990, 845, 0, 0, instance, 0)
	if hwnd == 0 {
		winMessageBox(0, "Не удалось создать главное окно.", "Bypass Manager", 0x10)
		return 2
	}
	procShow.Call(hwnd, 5)
	procUpdate.Call(hwnd)
	post(hwnd, wmAppBoot)
	var msg winMessage
	for {
		r, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if r == 0 {
			break
		}
		if r == ^uintptr(0) {
			return 2
		}
		procTranslate.Call(uintptr(unsafe.Pointer(&msg)))
		procDispatch.Call(uintptr(unsafe.Pointer(&msg)))
	}
	activeUI = nil
	return 0
}

// Prevent unused import drift when platform implementations change.
var _ io.Writer = uiWriter{}
