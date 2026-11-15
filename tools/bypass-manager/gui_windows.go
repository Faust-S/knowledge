//go:build windows

package main

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
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

// Keep public-facing logs free of endpoint addresses and other identifying IPs.
var ipv4InLog = regexp.MustCompile(`\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b`)

func cleanLog(s string) string { return ipv4InLog.ReplaceAllString(s, "[IP скрыт]") }

type managerUI struct {
	hwnd                                                                        uintptr
	home                                                                        string
	cfg                                                                         Config
	endpoint, port, adapter, engine, transport, preferred                       uintptr
	logs, status, startButton, stopButton, saveButton, prepareButton, dnsButton uintptr
	mu                                                                          sync.Mutex
	queue                                                                       []string
	cancel                                                                      context.CancelFunc
	running                                                                     bool
	preparing                                                                   bool
	inspectingDNS                                                               bool
	closing                                                                     bool
	stopError                                                                   string
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
		if len(existing) > 28000 {
			winSetText(ui.logs, existing[len(existing)-23000:])
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
	if r {
		procEnable.Call(ui.stopButton, 1)
	} else {
		procEnable.Call(ui.stopButton, 0)
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
		winMessageBox(ui.hwnd, "Подключите VPN самостоятельно и укажите точное имя активного VPN-адаптера.", "Диагностика DNS", 0x30)
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
	if ui.inspectingDNS {
		ui.setStatus("Отмена диагностики DNS...")
	} else if ui.preparing {
		ui.setStatus("Отмена подготовки движка...")
	} else {
		ui.setStatus("Завершение и остановка собственного winws2...")
	}
}

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
	ctrl(ui.hwnd, "STATIC", "Bypass Manager 0.3 Alpha", 0, 0, 20, 15, 740, 30)
	ctrl(ui.hwnd, "STATIC", "VPN запускается отдельно. Измерения IPv4 не доказывают анонимность или защиту DNS/IPv6.", 0, 0, 20, 47, 820, 22)
	ctrl(ui.hwnd, "STATIC", "Внешний IPv4", 0, 0, 20, 84, 130, 22)
	ui.endpoint = ctrl(ui.hwnd, "EDIT", ui.cfg.EndpointIPv4, wsBorder|wsTabStop|esAutoHScroll, 101, 160, 80, 235, 26)
	ctrl(ui.hwnd, "STATIC", "Порт", 0, 0, 426, 84, 70, 22)
	port := strconv.Itoa(ui.cfg.Port)
	if ui.cfg.Port == 0 {
		port = ""
	}
	ui.port = ctrl(ui.hwnd, "EDIT", port, wsBorder|wsTabStop|esAutoHScroll, 102, 510, 80, 100, 26)
	ctrl(ui.hwnd, "STATIC", "Транспорт", 0, 0, 20, 127, 130, 22)
	ui.transport = ctrl(ui.hwnd, "COMBOBOX", "", wsTabStop|wsVScroll|cbDropdownList, 103, 160, 122, 235, 320)
	for _, s := range []string{"AWG-UDP", "REALITY-TCP", "XHTTP-TCP"} {
		send(ui.transport, cbAddString, 0, uintptr(unsafe.Pointer(wstr(s))))
	}
	i := uintptr(0)
	if ui.cfg.Transport == "REALITY-TCP" {
		i = 1
	} else if ui.cfg.Transport == "XHTTP-TCP" {
		i = 2
	}
	send(ui.transport, cbSetCurSel, i, 0)
	ctrl(ui.hwnd, "STATIC", "VPN-адаптер", 0, 0, 426, 127, 130, 22)
	ui.adapter = ctrl(ui.hwnd, "EDIT", ui.cfg.AdapterName, wsBorder|wsTabStop|esAutoHScroll, 104, 560, 122, 260, 27)
	ctrl(ui.hwnd, "STATIC", "Папка winws2", 0, 0, 20, 171, 130, 22)
	ui.engine = ctrl(ui.hwnd, "EDIT", ui.cfg.BundleRoot, wsBorder|wsTabStop|esAutoHScroll, 105, 160, 166, 510, 27)
	ui.prepareButton = ctrl(ui.hwnd, "BUTTON", "Подготовить движок", wsTabStop, idPrepare, 685, 166, 140, 27)
	ctrl(ui.hwnd, "STATIC", "Приоритет", 0, 0, 20, 216, 130, 22)
	ui.preferred = ctrl(ui.hwnd, "COMBOBOX", "", wsTabStop|wsVScroll|cbDropdownList, 106, 160, 210, 235, 250)
	names := []string{"Автоматически", "NONE", "UDP-FAKE", "UDP-REPEAT", "TLS-SPLIT", "TLS-DISORDER", "TLS-FAKESEQ", "TLS-FAKETTL"}
	selection := uintptr(0)
	for i, name := range names {
		send(ui.preferred, cbAddString, 0, uintptr(unsafe.Pointer(wstr(name))))
		if name == ui.cfg.PreferredProfile {
			selection = uintptr(i)
		}
	}
	send(ui.preferred, cbSetCurSel, selection, 0)
	ctrl(ui.hwnd, "STATIC", "После NONE; при неудаче пробует другие", 0, 0, 426, 216, 390, 22)

	ui.saveButton = ctrl(ui.hwnd, "BUTTON", "Сохранить", wsTabStop, idSave, 20, 255, 137, 37)
	ui.startButton = ctrl(ui.hwnd, "BUTTON", "Автоподбор", wsTabStop, idStart, 168, 255, 161, 37)
	ui.stopButton = ctrl(ui.hwnd, "BUTTON", "Остановить", wsTabStop, idStop, 339, 255, 145, 37)
	ctrl(ui.hwnd, "BUTTON", "Открыть отчёт", wsTabStop, idReport, 497, 255, 158, 37)
	ui.dnsButton = ctrl(ui.hwnd, "BUTTON", "Проверить DNS", wsTabStop, idDNS, 663, 255, 160, 37)
	ui.status = ctrl(ui.hwnd, "STATIC", "Ожидание. Проверки не выполнены.", 0, 0, 20, 304, 800, 22)
	ui.logs = ctrl(ui.hwnd, "EDIT", "Bypass Manager 0.3 Alpha\r\nПодключение VPN проверяется по внешнему IP, скачанным данным и счётчикам адаптера.\r\nНастройки хранятся только на компьютере.\r\n", wsBorder|wsVScroll|esMultiline|esAutoVScroll|esReadOnly, 110, 20, 338, 800, 280)
	procEnable.Call(ui.stopButton, 0)
}
func (ui *managerUI) layout() {
	var rc winRect
	procClientRect.Call(ui.hwnd, uintptr(unsafe.Pointer(&rc)))
	w := rc.R - rc.L
	h := rc.B - rc.T
	if w < 680 || h < 490 {
		return
	}
	procMove.Call(ui.engine, 160, 166, uintptr(w-340), 27, 1)
	procMove.Call(ui.prepareButton, uintptr(w-165), 166, 140, 27, 1)
	procMove.Call(ui.logs, 20, 338, uintptr(w-45), uintptr(h-355), 1)
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
	case wmCommand:
		switch loword(w) {
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
		case idReport:
			file := filepath.Join(ui.home, "results", "latest-session.json")
			if _, err := os.Stat(file); err != nil {
				winMessageBox(hwnd, "Отчёт пока отсутствует.", "Bypass Manager", 0x40)
			} else {
				// Local Notepad only. No report upload, no browser access.
				func() {
					p := exec.Command("notepad.exe", file)
					if err := p.Start(); err == nil {
						_ = p.Process.Release()
					}
				}()
			}
		}
		return 0
	case wmAppLog:
		ui.flush()
		return 0
	case wmAppDone:
		ui.flush()
		ui.toggleRun(false)
		ui.preparing = false
		ui.inspectingDNS = false
		ui.cancel = nil
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
	ui := &managerUI{home: home, cfg: cfg}
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
	hwnd, _, _ := procCreate.Call(0, uintptr(unsafe.Pointer(class)), uintptr(unsafe.Pointer(wstr("Bypass Manager 0.3 Alpha"))), wsOverlappedWindow|wsVisible, 200, 150, 870, 715, 0, 0, instance, 0)
	if hwnd == 0 {
		winMessageBox(0, "Не удалось создать главное окно.", "Bypass Manager", 0x10)
		return 2
	}
	procShow.Call(hwnd, 5)
	procUpdate.Call(hwnd)
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
