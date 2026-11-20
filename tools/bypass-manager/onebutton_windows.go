//go:build windows

package main

import (
	"context"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

const (
	oneToggleID         = 3101
	oneSpeedID          = 3102
	oneReportID         = 3103
	oneRefreshMsg       = 0x8010
	oneOperationDoneMsg = 0x8011
	oneSpeedDoneMsg     = 0x8012
)

func int32Height(n int32) uintptr { return uintptr(uint64(int64(n))) }

var oneActive *oneUI

type oneUI struct {
	hwnd                                                                                                            uintptr
	title, subtitle, headline, description, button, measure, report, status, ipLine, geoLine, speedLine, smallPrint uintptr
	titleFont, headlineFont                                                                                         uintptr
	mu                                                                                                              sync.Mutex
	busy, closing, speedBusy                                                                                        bool
	cancel                                                                                                          context.CancelFunc
	result                                                                                                          string
	cause                                                                                                           string
	current                                                                                                         string
	view                                                                                                            PublicView
	speedAudit                                                                                                      LiveAudit
	ctx                                                                                                             context.Context
	lifetimeCancel                                                                                                  context.CancelFunc
	pollStop                                                                                                        chan struct{}
}

func oneBtnText(h uintptr, s string) {
	if h != 0 {
		winSetText(h, s)
	}
}
func (ui *oneUI) setState(state, reason string) {
	ui.current = state
	switch state {
	case directRunning:
		oneBtnText(ui.headline, "Включено · локальная адаптация HTTPS")
		oneBtnText(ui.description, "Движок запущен без VPN. Проблемные домены определяются автоматически.\nУспех обхода конкретного сайта пока не подтверждён.")
		oneBtnText(ui.button, "Выключить")
	case directOff:
		oneBtnText(ui.headline, "Выключено")
		oneBtnText(ui.description, "Одна кнопка включает локальную адаптацию TLS. VPN и адрес сервера не требуются.\nКомпоненты winws2 проверяются из архива. Отдельный VPN не нужен.")
		oneBtnText(ui.button, "Включить")
	case "OTHER_OWNED_PROFILE":
		oneBtnText(ui.headline, "Найден прежний режим DPI")
		oneBtnText(ui.description, "Сначала выключите собственный предыдущий фильтр. Другие приложения не затрагиваются.")
		oneBtnText(ui.button, "Выключить")
	case directUnverified:
		oneBtnText(ui.headline, "Требуется восстановление собственного процесса")
		oneBtnText(ui.description, "Запись есть, но принадлежность процесса не подтверждена.\nВосстановление откажется завершать чужой процесс.")
		oneBtnText(ui.button, "Проверить остановку")
	case directPending:
		oneBtnText(ui.headline, "Включаю локальную адаптацию...")
		oneBtnText(ui.description, "Проверяю оригинальные компоненты и запускаю только собственный WinDivert-фильтр.")
		oneBtnText(ui.button, "Отменить")
	case "STOPPING":
		oneBtnText(ui.headline, "Выключаю свой обработчик...")
		oneBtnText(ui.description, "Проверяю PID и время запуска, чужие процессы не останавливаю.")
		oneBtnText(ui.button, "Ожидание")
	default:
		oneBtnText(ui.headline, "Не удалось включить обработку")
		oneBtnText(ui.description, "Работоспособность интернета не считается восстановленной.\nПричина доступна в отчёте. Повторное включение не требует VPN.")
		oneBtnText(ui.button, "Включить")
	}
	if reason != "" {
		oneBtnText(ui.status, reason)
	}
}
func (ui *oneUI) init() {
	ui.title = ctrl(ui.hwnd, "STATIC", "Bypass Manager", 0, 0, 24, 18, 780, 32)
	ui.subtitle = ctrl(ui.hwnd, "STATIC", "Автономная адаптация интернет-соединений Windows · VPN не обязателен", 0, 0, 24, 62, 780, 28)
	ui.headline = ctrl(ui.hwnd, "STATIC", "Проверяю состояние...", 0, 0, 24, 125, 780, 38)
	ui.description = ctrl(ui.hwnd, "STATIC", "Локальная адаптация HTTPS. Нет привязки к Amnezia.", 0, 0, 24, 175, 780, 56)
	ui.button = ctrl(ui.hwnd, "BUTTON", "Включить", wsTabStop, oneToggleID, 24, 250, 280, 54)
	ui.measure = ctrl(ui.hwnd, "BUTTON", "Скорость и регион", wsTabStop, oneSpeedID, 312, 250, 220, 54)
	ui.report = ctrl(ui.hwnd, "BUTTON", "Отчёт", wsTabStop, oneReportID, 540, 250, 165, 54)
	ui.ipLine = ctrl(ui.hwnd, "STATIC", "Внешний IP: ещё не измерен", 0, 0, 24, 329, 780, 25)
	ui.geoLine = ctrl(ui.hwnd, "STATIC", "Регион: ещё не определён", 0, 0, 24, 363, 780, 25)
	ui.speedLine = ctrl(ui.hwnd, "STATIC", "Скорость: ещё не измерена", 0, 0, 24, 397, 780, 25)
	ui.status = ctrl(ui.hwnd, "STATIC", "Готово к работе", 0, 0, 24, 447, 780, 28)
	ui.smallPrint = ctrl(ui.hwnd, "STATIC", "При включении проверяются три открытых HTTPS-сервиса; они увидят IP программы.\nЛокальная адаптация не скрывает IP и не заменяет VPN.", 0, 0, 24, 475, 780, 50)
	f, _, _ := gdiDLL.NewProc("CreateFontW").Call(uintptr(int32Height(-25)), 0, 0, 0, 600, 0, 0, 0, 1, 0, 0, 0, 0, uintptr(unsafe.Pointer(wstr("Segoe UI"))))
	if f != 0 {
		ui.titleFont = f
		send(ui.title, wmSetFont, f, 1)
	}
	g, _, _ := gdiDLL.NewProc("CreateFontW").Call(uintptr(int32Height(-21)), 0, 0, 0, 600, 0, 0, 0, 1, 0, 0, 0, 0, uintptr(unsafe.Pointer(wstr("Segoe UI"))))
	if g != 0 {
		ui.headlineFont = g
		send(ui.headline, wmSetFont, g, 1)
	}
}
func (ui *oneUI) layout() {
	if ui.button == 0 {
		return
	}
	var rc winRect
	procClientRect.Call(ui.hwnd, uintptr(unsafe.Pointer(&rc)))
	w := rc.R - rc.L
	if w < 640 {
		return
	}
	move := func(h uintptr, x, y, width, height int32) {
		procMove.Call(h, uintptr(x), uintptr(y), uintptr(width), uintptr(height), 1)
	}
	move(ui.title, 24, 18, w-48, 36)
	move(ui.subtitle, 24, 62, w-48, 27)
	move(ui.headline, 24, 120, w-48, 40)
	move(ui.description, 24, 168, w-48, 55)
	space := (w - 48 - 16) / 3
	move(ui.button, 24, 247, space, 54)
	move(ui.measure, 24+space+8, 247, space, 54)
	move(ui.report, 24+2*(space+8), 247, space, 54)
	move(ui.ipLine, 24, 327, w-48, 25)
	move(ui.geoLine, 24, 361, w-48, 25)
	move(ui.speedLine, 24, 395, w-48, 25)
	move(ui.status, 24, 443, w-48, 28)
	move(ui.smallPrint, 24, 471, w-48, 55)
}
func (ui *oneUI) makeManager() *Manager {
	home := defaultRoot()
	return &Manager{home: home, runtimeRoot: filepath.Join(home, "runtime"), stateFolder: filepath.Join(home, "active"), logDir: filepath.Join(home, "results"),
		cfg: Config{BundleRoot: preferredEngineRoot(home)}, output: io.Discard}
}
func (ui *oneUI) checkState() {
	ui.mu.Lock()
	if ui.busy || ui.closing {
		ui.mu.Unlock()
		return
	}
	ui.mu.Unlock()
	go func() {
		m := ui.makeManager()
		ctx, cancel := context.WithTimeout(ui.ctx, 14*time.Second)
		defer cancel()
		state, err := m.getDirectStatus(ctx)
		if err != nil {
			state = directUnverified
		}
		ui.mu.Lock()
		if !ui.busy {
			ui.result = state
			ui.cause = ""
			if state == directRunning {
				var prior DirectCheckReport
				if err := readStrictJSON(filepath.Join(m.home, "results", "latest-direct-check.json"), &prior); err == nil && validDirectCheck(prior) {
					stamp, parseErr := time.Parse(time.RFC3339Nano, prior.CheckedUTC)
					if parseErr == nil && time.Since(stamp) < 15*time.Minute && time.Since(stamp) > -time.Minute {
						ui.cause = directCheckSummary(prior)
					}
				}
			}
		}
		ui.mu.Unlock()
		post(ui.hwnd, oneRefreshMsg)
	}()
}
func (ui *oneUI) toggle() {
	ui.mu.Lock()
	if ui.busy {
		cancel := ui.cancel
		ui.mu.Unlock()
		if cancel != nil {
			cancel()
			oneBtnText(ui.status, "Отменяю действие и проверяю остановку своего фильтра...")
		}
		return
	}
	desired := "start"
	if ui.current == directRunning || ui.current == directUnverified || ui.current == "OTHER_OWNED_PROFILE" {
		desired = "stop"
	}
	ctx, cancel := context.WithCancel(ui.ctx)
	ui.busy = true
	ui.cancel = cancel
	ui.mu.Unlock()
	if desired == "start" {
		ui.setState(directPending, "Подготавливаю оригинальный движок. Проверка доступа к сайту ещё не выполнялась.")
	} else {
		ui.setState("STOPPING", "Останавливаю только собственный DPI-процесс.")
	}
	go func() {
		defer cancel()
		m := ui.makeManager()
		var err error
		state := directOff
		var outcome DirectCheckReport
		if desired == "start" {
			_ = m.saveDirectReport(directReport(directPending, "CHECKING_BEFORE_START"))
			outcome, err = directMeasuredStart(ctx, m.startDirect,
				func(ctx context.Context) (bool, error) {
					checkCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
					defer cancel()
					v, e := m.getDirectStatus(checkCtx)
					return v == directRunning, e
				},
				func(ctx context.Context) DirectCheckPhase {
					return probeDirectPhase(ctx, newDirectProbeClient(), directProbeTargets)
				},
			)
			_ = m.saveDirectCheck(outcome)
			if err == nil {
				state = directRunning
			}
			if err != nil && m.ownStateExists() {
				// If the native process dies during the post-start probe,
				// release only our own verified handle instead of leaving an
				// unexplained WinDivert filter or pretending it is stopped.
				if stopErr := m.stopDirect(); stopErr != nil {
					state = directUnverified
				}
			}
		} else {
			if x := m.ensureRuntime(); x != nil {
				err = x
			} else {
				err = m.stopDirect()
			}
		}
		reason := ""
		if err != nil {
			state = directFailed
			reason = "Операция не выполнена: " + directFailureCode(err) + ". Подробнее в отчёте."
		} else if state == directRunning {
			reason = directCheckSummary(outcome)
		} else {
			reason = "Собственный DPI-фильтр остановлен. Маршруты и VPN не изменялись."
		}
		// Correctly classify cancellation: we must not report RUNNING on Cancel.
		if ctx.Err() != nil {
			if err == nil && state == directRunning {
				_ = m.stopDirect()
			}
			checkCtx, stop := context.WithTimeout(context.Background(), 12*time.Second)
			verified, checkErr := m.getDirectStatus(checkCtx)
			stop()
			if checkErr != nil {
				state = directUnverified
			} else {
				state = verified
			}
			reason = "Отмена обработана; фактическое состояние процесса проверено повторно."
		}
		report := directReport(state, "STARTED_NOT_VERIFIED")
		if state == directOff {
			report.Outcome = "STOPPED"
		}
		if state == directFailed {
			report.Outcome = directFailureCode(err)
		}
		if state == directUnverified {
			report.Outcome = "OWNED_PROCESS_REQUIRES_STOP"
		}
		if ctx.Err() != nil {
			report.Outcome = "CANCELLED_RECHECK_REQUIRED"
		}
		_ = m.saveDirectReport(report)
		ui.mu.Lock()
		ui.result = state
		ui.cause = reason
		ui.busy = false
		ui.cancel = nil
		ui.mu.Unlock()
		post(ui.hwnd, oneOperationDoneMsg)
	}()
}
func (ui *oneUI) measureNow() {
	ui.mu.Lock()
	if ui.speedBusy || ui.closing {
		ui.mu.Unlock()
		return
	}
	ui.speedBusy = true
	ui.mu.Unlock()
	procEnable.Call(ui.measure, 0)
	oneBtnText(ui.speedLine, "Измеряю скорость через HTTPS...")
	oneBtnText(ui.status, "Тест обращается к внешним серверам. Они увидят IP этого приложения.")
	go func() {
		ctx, cancel := context.WithTimeout(ui.ctx, 145*time.Second)
		defer cancel()
		m := ui.makeManager()
		view, _ := inspectPublicView(ctx, m)
		audit := LiveAudit{SchemaVersion: "0.3.3", CheckedUTC: utc(), Mode: "MANUAL_ON_DEMAND", SpeedGrade: "SPEED_NOT_VERIFIED", BaselineState: "VPN_ROUTE_UNVERIFIED", Caveat: liveAuditCaveat}
		if ctx.Err() == nil {
			audit.Samples, audit.SpeedGrade, audit.MinMbps, audit.MedianMbps, audit.Successful = runSpeedSamples(ctx)
			audit.Total = 3
		}
		_ = saveJSON(filepath.Join(m.home, "results", "latest-speed.json"), audit)
		ui.mu.Lock()
		ui.view = view
		ui.speedAudit = audit
		ui.speedBusy = false
		ui.mu.Unlock()
		post(ui.hwnd, oneSpeedDoneMsg)
	}()
}
func (ui *oneUI) applySpeed() {
	ui.mu.Lock()
	view, audit := ui.view, ui.speedAudit
	ui.mu.Unlock()
	procEnable.Call(ui.measure, 1)
	if view.Consensus {
		oneBtnText(ui.ipLine, "Внешний IP этого приложения: "+view.IP)
	} else {
		oneBtnText(ui.ipLine, "Внешний IP: независимые проверки не согласованы")
	}
	if view.GeoMatched {
		place := strings.TrimSpace(strings.Join([]string{view.Country, view.Region, view.City}, " / "))
		oneBtnText(ui.geoLine, "Предположительный регион: "+place)
	} else {
		oneBtnText(ui.geoLine, "Регион: не удалось подтвердить по IP")
	}
	if audit.Successful >= 2 && audit.MinMbps > 0 {
		oneBtnText(ui.speedLine, fmt.Sprintf("HTTPS: минимум %.1f, медиана %.1f Мбит/с", audit.MinMbps, audit.MedianMbps))
	} else {
		oneBtnText(ui.speedLine, "Скорость: полных измерений недостаточно")
	}
	oneBtnText(ui.status, "Проверено только подключение Bypass Manager. Выход браузера/VPN не доказывается.")
}
func (ui *oneUI) showReport() {
	m := ui.makeManager()
	file, s, err := saveSupport(filepath.Join(m.home, "results"))
	if err != nil {
		oneBtnText(ui.status, "Не удалось сформировать локальный отчёт.")
		return
	}
	oneBtnText(ui.status, fmt.Sprintf("Отчёт собран: %d источников. IP и посещённые домены исключены.", s.Available))
	cmd := exec.Command("notepad.exe", file)
	if err := cmd.Start(); err == nil {
		_ = cmd.Process.Release()
	}
}
func (ui *oneUI) boot() {
	ui.checkState()
	ui.pollStop = make(chan struct{})
	go func() {
		t := time.NewTicker(15 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ui.pollStop:
				return
			case <-ui.ctx.Done():
				return
			case <-t.C:
				ui.checkState()
			}
		}
	}()
}
func oneWindowCallback(hwnd uintptr, message uint32, w, l uintptr) uintptr {
	ui := oneActive
	if ui == nil {
		r, _, _ := procDefault.Call(hwnd, uintptr(message), w, l)
		return r
	}
	switch message {
	case wmCreate:
		ui.hwnd = hwnd
		ui.init()
		return 0
	case wmSize:
		ui.layout()
		return 0
	case wmAppBoot:
		ui.boot()
		return 0
	case oneRefreshMsg:
		ui.mu.Lock()
		st, reason, busy := ui.result, ui.cause, ui.busy
		ui.mu.Unlock()
		if !busy && st != "" {
			ui.setState(st, reason)
		}
		return 0
	case oneOperationDoneMsg:
		ui.mu.Lock()
		st, reason, closing := ui.result, ui.cause, ui.closing
		ui.mu.Unlock()
		ui.setState(st, reason)
		if closing {
			procDestroy.Call(hwnd)
		}
		return 0
	case oneSpeedDoneMsg:
		ui.applySpeed()
		return 0
	case wmCommand:
		switch loword(w) {
		case oneToggleID:
			ui.toggle()
		case oneSpeedID:
			ui.measureNow()
		case oneReportID:
			ui.showReport()
		}
		return 0
	case wmClose:
		ui.mu.Lock()
		busy := ui.busy
		ui.closing = true
		cancel := ui.cancel
		ui.mu.Unlock()
		if busy {
			if cancel != nil {
				cancel()
			}
			oneBtnText(ui.status, "Ожидаю завершения отмены, прежде чем закрыть окно.")
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
		for _, f := range []uintptr{ui.titleFont, ui.headlineFont} {
			if f != 0 {
				gdiDLL.NewProc("DeleteObject").Call(f)
			}
		}
		procPostQuit.Call(0)
		return 0
	}
	r, _, _ := procDefault.Call(hwnd, uintptr(message), w, l)
	return r
}
func oneButtonGuiMain() int {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	relaunched, err := maybeRelaunchElevated()
	if err != nil {
		winMessageBox(0, err.Error(), "Bypass Manager", 0x30)
		return 2
	}
	if relaunched {
		return 0
	}
	procDpiAware.Call(^uintptr(3))
	ctx, cancel := context.WithCancel(context.Background())
	ui := &oneUI{ctx: ctx, lifetimeCancel: cancel}
	oneActive = ui
	instance, _, _ := procGetModule.Call(0)
	cursor, _, _ := procLoadCursor.Call(0, 32512)
	class := wstr("IWXA_BypassManager_OneButton")
	wc := winClassEx{Size: uint32(unsafe.Sizeof(winClassEx{})), WndProc: syscall.NewCallback(oneWindowCallback), Instance: instance, Cursor: cursor, Background: 6, ClassName: class}
	ok, _, _ := procRegister.Call(uintptr(unsafe.Pointer(&wc)))
	if ok == 0 {
		return 2
	}
	hwnd, _, _ := procCreate.Call(0, uintptr(unsafe.Pointer(class)), uintptr(unsafe.Pointer(wstr("Bypass Manager · Windows"))), wsOverlappedWindow|wsVisible, 180, 100, 830, 590, 0, 0, instance, 0)
	if hwnd == 0 {
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
	oneActive = nil
	return 0
}
