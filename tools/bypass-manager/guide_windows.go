//go:build windows

package main

import (
	"context"
	"path/filepath"
	"strings"
	"time"
)

// This assistant is deliberately separate from the experimental DPI sampler.
// It observes Amnezia, waits for an actual interface/route, and measures an
// ordinary encrypted HTTPS data path. It never guesses a server IP or port,
// reads subscription/keys, or starts an unverified WinDivert filter.
func (ui *managerUI) guideInstruction(message string) {
	ui.mu.Lock()
	ui.guideStep = message
	ui.mu.Unlock()
	post(ui.hwnd, wmAppGuideStep)
	ui.write(message + "\n")
}

func (ui *managerUI) startGuide() {
	if ui.running {
		return
	}
	if winMessageBox(ui.hwnd,
		"Мастер сам проверит VPN-адаптер и дождётся подключения Amnezia. Затем скачает до 8 МиБ тестовых данных по HTTPS для оценки видео. Внешние тестовые сервисы увидят исходящий IP. Продолжить?",
		"Проверка соединения и видео", 0x24) != 6 {
		return
	}
	ctx, cancel := context.WithCancel(ui.lifetimeCtx)
	ui.cancel = cancel
	ui.guiding = true
	ui.toggleRun(true)
	ui.setStatus("Мастер подключения. Можно отменить кнопкой Остановить.")
	ui.guideInstruction("Шаг 1/3. Проверяю состояние Amnezia, ключи и конфигурации не читаю...")
	go func() {
		defer cancel()
		defer post(ui.hwnd, wmAppDone)
		ui.runGuide(ctx)
	}()
}

func (ui *managerUI) runGuide(ctx context.Context) {
	report := GuideReport{StartedUTC: utc(), State: "NOT_VERIFIED", Caveat: "Short HTTPS video-capacity samples are not a guarantee of smooth streaming; adapter and route observations do not prove a VPN handshake. No DPI packet interception occurs in this assistant."}
	defer func() {
		report.CompletedUTC = utc()
		if err := saveJSON(filepath.Join(ui.home, "results", "latest-guide.json"), report); err != nil {
			ui.write("Итоговый отчёт мастера не удалось сохранить локально.\n")
		}
	}()
	m := &Manager{home: ui.home, runtimeRoot: filepath.Join(ui.home, "runtime"), stateFolder: filepath.Join(ui.home, "active"), output: uiWriter{ui}}
	if err := m.ensureRuntime(); err != nil {
		report.AdviceCode = "RUNTIME_ERROR"
		ui.guideInstruction("Не удалось подготовить средства чтения Windows. Проверьте доступ к папке приложения.")
		return
	}
	if m.ownStateExists() {
		ui.guideInstruction("С прошлого испытания осталась запись собственного DPI-фильтра. Прежде чем подключать VPN, восстанавливаю только его состояние...")
		if err := m.stopFilter(); err != nil {
			report.AdviceCode = "OWNED_DPI_RECOVERY_REQUIRED"
			ui.guideInstruction("Собственный DPI-процесс не удалось остановить. Проверьте кнопку «Восстановить сеть»; новые фильтры включаться не будут.")
			return
		}
	}

	// When disconnected, this baseline helps to distinguish VPN egress from
	// ordinary direct internet; lack of a baseline must never block guidance.
	var baseline EgressResult
	snapshot, err := m.vpnState(ctx)
	if err == nil && connectionGuideAction(snapshot) != "MEASURE_CONNECTION" {
		beforeCtx, cancel := context.WithTimeout(ctx, 11*time.Second)
		baseline = m.egress(beforeCtx)
		cancel()
	}
	start := time.Now()
	lastAdvice := ""
	for {
		if ctx.Err() != nil {
			report.AdviceCode = "CANCELLED"
			return
		}
		sampleCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		state, err := m.vpnState(sampleCtx)
		cancel()
		action := "DIAGNOSTICS_UNAVAILABLE"
		if err == nil {
			action = connectionGuideAction(state)
		}
		if action == "MEASURE_CONNECTION" {
			report.VPNRouteObserved = true
			ui.guideInstruction("Шаг 2/3. VPN-адаптер и маршрут обнаружены. Проверяю HTTPS-доступ и реальную передачу данных...")
			break
		}
		advice := ""
		switch action {
		case "OPEN_AMNEZIA":
			advice = "Шаг 1/3. Откройте AmneziaVPN и один раз нажмите «Подключить» для AmneziaWG. Ничего вводить в Bypass Manager не нужно: жду соединения автоматически."
		case "MULTIPLE_ADAPTERS":
			advice = "Найдено несколько активных VPN-адаптеров. Оставьте включённым только нужное подключение Amnezia. Автовыбор сейчас небезопасен."
		case "CONNECT_AMNEZIA":
			advice = "Шаг 1/3. Amnezia обнаружена. Нажмите «Подключить» в её окне. Мастер сам продолжит после появления маршрута."
		default:
			advice = "Не удаётся прочитать состояние VPN-адаптера Windows. Проверьте, что AmneziaVPN установлена и запущена."
		}
		if time.Since(start) > 65*time.Second && action == "CONNECT_AMNEZIA" {
			advice = "Amnezia не сформировала рабочий маршрут. В Amnezia откройте локацию → настройки (⚙) → Reload API config → Continue, затем нажмите «Подключить». Мастер продолжает ждать автоматически."
		}
		if advice != lastAdvice {
			ui.guideInstruction(advice)
			lastAdvice = advice
		}
		if time.Since(start) > 4*time.Minute {
			report.AdviceCode = "VPN_NOT_READY"
			ui.guideInstruction("Подключение за 4 минуты не подтверждено. Закройте мастер, обновите API-конфигурацию Amnezia и проверьте состояние подписки/соединения. DPI не запускался.")
			return
		}
		if waitGuide(ctx, 5*time.Second) != nil {
			report.AdviceCode = "CANCELLED"
			return
		}
	}
	onlineCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	selected, err := m.vpnState(onlineCtx)
	if err != nil || connectionGuideAction(selected) != "MEASURE_CONNECTION" {
		cancel()
		report.AdviceCode = "VPN_ROUTE_LOST"
		ui.guideInstruction("Во время проверки пропал VPN-маршрут. Дождитесь состояния подключения Amnezia и повторите проверку.")
		return
	}
	// We always know a single name from the validated snapshot. No local key
	// or server endpoint is read from Amnezia.
	m.cfg.AdapterName = selected.AdapterName
	before, _ := m.adapterStats(onlineCtx)
	eg := m.egress(onlineCtx)
	cancel()
	report.EgressObserved = eg.Agreement
	report.EgressChanged = baseline.Agreement && eg.Agreement && baseline.IP != eg.IP
	if !eg.Agreement {
		ui.guideInstruction("Шаг 3/3. Проверочные IP-сервисы не согласовали результат. Всё равно проверю загрузку видео-данных: HTTP-доступ может работать независимо от IP-эхо.")
	} else {
		ui.guideInstruction("Шаг 3/3. HTTPS отвечает. Проверяю четыре полные загрузки и провалы скорости для видео (до 8 МиБ)...")
	}
	videoCtx, stop := context.WithTimeout(ctx, 110*time.Second)
	_, quality := checkVideoQuality(videoCtx, download, waitGuide)
	stop()
	report.Video = quality
	afterCtx, afterCancel := context.WithTimeout(ctx, 8*time.Second)
	after, _ := m.adapterStats(afterCtx)
	afterCancel()
	if before != nil && after != nil {
		report.AdapterFlowObserved = strings.EqualFold(before.Name, after.Name) &&
			strings.EqualFold(after.Status, "Up") && after.ReceivedBytes > before.ReceivedBytes && after.SentBytes > before.SentBytes
	}
	if ctx.Err() != nil {
		report.AdviceCode = "CANCELLED"
		return
	}
	if !report.EgressObserved {
		report.State = "VIDEO_MEASURED_IP_UNVERIFIED"
		report.AdviceCode = "IP_CHECK_INCONCLUSIVE"
		ui.guideInstruction("Скорость измерена (минимум " + formatMbps(quality.MinMbps) + " Мбит/с), но сервисы определения выходного IP не подтвердили адрес. Интернет может работать, однако VPN-путь остаётся НЕПОДТВЕРЖДЁННЫМ.")
		return
	}
	if baseline.Agreement && !report.EgressChanged {
		report.State = "VIDEO_MEASURED_VPN_UNVERIFIED"
		report.AdviceCode = "VPN_EGRESS_NOT_CHANGED"
		ui.guideInstruction("HTTPS работает, но выходной IPv4 остался прежним. Скорость интернета измерена (минимум " + formatMbps(quality.MinMbps) + " Мбит/с), однако VPN-путь не подтверждён. Проверьте, что в Amnezia отключено раздельное туннелирование, и повторите проверку.")
		ui.write("Отчёт мастера: VIDEO_MEASURED_VPN_UNVERIFIED. Прямой интернет не следует принимать за успешный VPN.\n")
		return
	}
	// The video test remains useful for network usability even when adapter
	// counters are not readable, but it must never be called a proven VPN path.
	pathNote := " VPN подтверждён только по интерфейсу/маршруту; нативный handshake не доказан."
	if report.AdapterFlowObserved {
		pathNote = " Трафик VPN-адаптера наблюдался; нативный handshake всё ещё не доказан."
	}
	switch quality.Grade {
	case "HD_1080P_CANDIDATE":
		report.State = "VIDEO_1080P_CANDIDATE"
		report.AdviceCode = "MONITOR_STREAM"
		ui.guideInstruction("Видео: предварительно хватает для 1080p. Минимальная скорость тестов " + formatMbps(quality.MinMbps) + " Мбит/с. Проверьте настоящее видео 10–15 минут без пауз." + pathNote)
	case "HD_720P_CANDIDATE":
		report.State = "VIDEO_720P_CANDIDATE"
		report.AdviceCode = "LOWER_QUALITY_OR_CHANGE_LOCATION"
		ui.guideInstruction("Видео: предварительно достаточно для 720p, но запас для 1080p мал (минимум " + formatMbps(quality.MinMbps) + " Мбит/с). Попробуйте 720p или другую доступную локацию Amnezia." + pathNote)
	case "SLOW_FOR_VIDEO":
		report.State = "VIDEO_TOO_SLOW"
		report.AdviceCode = "CHANGE_AVAILABLE_LOCATION"
		ui.guideInstruction("Видео может останавливаться: минимальная скорость " + formatMbps(quality.MinMbps) + " Мбит/с. Выберите другую доступную локацию в Amnezia и повторите проверку. Автоперебор чужих IP не применяется." + pathNote)
	default:
		report.State = "VIDEO_UNVERIFIED"
		report.AdviceCode = "HTTPS_TRANSFER_UNSTABLE"
		ui.guideInstruction("Видео-тест не прошёл: одна или несколько полных HTTPS-загрузок не выполнены. Проверьте состояние подключения Amnezia и обновите API-конфигурацию локации. DPI-профили не включались.")
	}
	ui.write("Оценка: " + report.Video.Grade + "; полностью скачано: " + formatInt(quality.Successful) + "/" + formatInt(quality.Total) + ". Отчёт в results/latest-guide.json (без IP и ключей).\n")
}
