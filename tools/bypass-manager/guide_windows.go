//go:build windows

package main

import (
	"context"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// The original VPN client owns protocol changes. We only control our own
// verified DPI filter. Every test is bound to a protocol/profile combination
// and its observed result; route presence is not a native VPN handshake.
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

	ctx, cancel := context.WithCancel(ui.lifetimeCtx)
	ui.cancel = cancel
	ui.guiding = true
	ui.toggleRun(true)
	ui.setStatus("Выберите используемый протокол. Остановить можно в любой момент.")
	ui.guideInstruction("Начинаю последовательную диагностику. Amnezia управляется отдельно; реальные VPN-ключи не читаю.")
	cfg := ui.guideCurrentConfig()
	go func() {
 defer cancel()
 defer post(ui.hwnd,wmAppDone)
 selected:=ui.guideChooseProtocol(ctx)
 if selected=="" {
  _=saveJSON(filepath.Join(ui.home,"results","latest-guide.json"),GuideReport{
   SchemaVersion:"0.3.2",StartedUTC:utc(),CompletedUTC:utc(),
   State:"CANCELLED",AdviceCode:"NO_PROTOCOL_SELECTED"})
  return
 }
 ui.runGuide(ctx,cfg,selected)
}()
}

func (ui *managerUI) guideObserve(ctx context.Context, m *Manager, wait time.Duration, notify func(string)) (VPNState, bool) {
	deadline := time.Now().Add(wait)
	previous := ""
	for {
		if ctx.Err() != nil {
			return VPNState{}, false
		}
		sampleCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		state, err := m.vpnState(sampleCtx)
		cancel()
		action := "DIAGNOSTICS_UNAVAILABLE"
		if err == nil {
			action = connectionGuideAction(state)
		}
		if action == "MEASURE_CONNECTION" {
			return state, true
		}
		if action != previous {
			notify(action)
			previous = action
		}
		if time.Now().After(deadline) {
			return state, false
		}
		if waitGuide(ctx, 5*time.Second) != nil {
			return state, false
		}
	}
}

func guideSourceSummary(results []GuideTransfer) string {
	failed := 0
	for _, s := range results {
		if !s.OK {
			failed++
		}
	}
	return formatInt(len(results)) + " обращений, неуспешных: " + formatInt(failed)
}

// Read advanced settings once on the Win32 UI thread. They remain optional:
// the NONE controls work without server IP/port and no settings are persisted.
func (ui *managerUI) guideCurrentConfig() Config {
	c := ui.cfg
	c.EndpointIPv4 = strings.TrimSpace(winText(ui.endpoint))
	if port, err := strconv.Atoi(strings.TrimSpace(winText(ui.port))); err == nil {
		c.Port = port
	} else {
		c.Port = 0
	}
	switch send(ui.transport, cbGetCurSel, 0, 0) {
	case 0:
		c.Transport = "AWG-UDP"
	case 1:
		c.Transport = "REALITY-TCP"
	case 2:
		c.Transport = "XHTTP-TCP"
	default:
		c.Transport = ""
	}
	c.BundleRoot = strings.TrimSpace(winText(ui.engine))
	return c
}

func (ui *managerUI) runGuide(ctx context.Context, config Config, selected string) {
	started := time.Now()
	plan := guidePlanFor(selected)
	report := GuideReport{
		SchemaVersion: "0.3.2", StartedUTC: utc(), State: "IN_PROGRESS", PlannedVariants: len(plan),
		Caveat: "Protocol in Amnezia is user-selected and not independently verified. Route and traffic observations are not a native handshake. Video results are short tests, not guaranteed streaming. A passive local network inventory is captured before and after attempts. No IPs, SSIDs, gateways, keys, hostnames or local paths are exported.",
	}
	persist := func() {
        _ = saveJSON(filepath.Join(ui.home, "results", "latest-guide.json"), report)
        post(ui.hwnd, wmAppProductRefresh)
    }
	record := func(v GuideVariant, stage, code string) {
		if len(report.Events) >= 256 {
			report.Events = report.Events[1:]
		}
		report.Events = append(report.Events, GuideEvent{UTC: utc(), Protocol: v.Protocol, DPIProfile: v.Profile, Stage: stage, Code: code, SecondsSinceStart: int64(time.Since(started).Seconds())})
		persist()
	}
	m := &Manager{cfg: config, home: ui.home, runtimeRoot: filepath.Join(ui.home, "runtime"), stateFolder: filepath.Join(ui.home, "active"), logDir: filepath.Join(ui.home, "results"), output: uiWriter{ui}, ask: func(message string) (string, error) {
		// Engine-install consent uses the same cancellable, in-window prompt.
		// Do not reintroduce an owned modal MessageBox from a worker thread.
		if ui.guideAsk(ctx, message) {
			return "д", nil
		}
		return "н", nil
	}}
	// Collect passive interface topology before and after network experiments.
	// Reports contain only allowlisted numeric counters and category codes.
	var previousNetwork *NetworkHealth
	captureNetwork := func(phase string, v GuideVariant) {
		sampleCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()
		entry := GuideNetworkDiagnostic{UTC: utc(), Phase: phase, Protocol: v.Protocol, DPIProfile: v.Profile, State: "UNAVAILABLE"}
		snapshot, err := m.networkHealth(sampleCtx)
		if err == nil {
			entry.State = "PASSIVE_SNAPSHOT"
			entry.Snapshot = &snapshot
			entry.Findings = assessNetworkHealth(snapshot)
			if previousNetwork != nil {
				entry.Findings = append(entry.Findings, compareNetworkHealth(*previousNetwork, snapshot)...)
			}
			previousNetwork = &snapshot
			ui.write(networkAuditSummary(NetworkAudit{State: entry.State, Snapshot: snapshot, Findings: entry.Findings}) + "\n")
		}
		if len(report.NetworkDiagnostics) >= 40 {
			report.NetworkDiagnostics = report.NetworkDiagnostics[1:]
		}
		report.NetworkDiagnostics = append(report.NetworkDiagnostics, entry)
		record(v, "NETWORK_"+phase, entry.State)
	}
	filterStarted := false
	defer func() {
		if filterStarted || m.ownStateExists() {
			if err := m.stopFilter(); err != nil {
				report.State = "DPI_STOP_ERROR"
				report.AdviceCode = "OWN_FILTER_RECOVERY_REQUIRED"
				ui.write("Не удалось подтвердить отключение собственного DPI. Используйте «Восстановить сеть».\n")
			}
		}
		finalizeGuideReport(&report, ctx.Err() != nil, utc())
		persist()
		ui.write("Подробный отчёт: results/latest-guide.json (события, протоколы, профили, измерения, причины).\n")
	}()
	if err := m.ensureRuntime(); err != nil {
		report.State = "RUNTIME_UNAVAILABLE"
		report.AdviceCode = "CANNOT_INSPECT_WINDOWS"
		record(GuideVariant{}, "SETUP", guideErrorCode(err))
		return
	}
	if m.ownStateExists() {
		if err := m.stopFilter(); err != nil {
			report.State = "OWN_FILTER_RECOVERY_REQUIRED"
			report.AdviceCode = "OWNED_DPI_STOP_FAILED"
			record(GuideVariant{}, "RECOVERY", guideErrorCode(err))
			return
		}
		record(GuideVariant{}, "RECOVERY", "OWNED_DPI_STOPPED")
	}
	captureNetwork("BASELINE", GuideVariant{})
	// Baseline can be collected only while the VPN route is inactive. A missing
	// baseline is diagnostic uncertainty, not proof that a VPN is broken.
	var baseline EgressResult
	baselineCtx, baselineCancel := context.WithTimeout(ctx, 12*time.Second)
	initial, err := m.vpnState(baselineCtx)
	if err == nil && guideCanMeasureDirectBaseline(initial) {
		baseline = m.egress(baselineCtx)
	}
	baselineCancel()
	if baseline.Agreement {
		record(GuideVariant{}, "BASELINE", "BASELINE_IPV4_CONFIRMED")
	} else {
		record(GuideVariant{}, "BASELINE", "BASELINE_UNAVAILABLE")
	}

	lastProtocol := ""
	endpointConfirmed := map[string]bool{}
	manualEndpoint := config // Optional advanced entry, not a prerequisite for Premium.
	endpointRejected := map[string]bool{}
	for i, v := range plan {
		if ctx.Err() != nil {
			return
		}
		round := GuideRound{Protocol: v.Protocol, DPIProfile: v.Profile, StartedUTC: utc(), State: "NOT_VERIFIED", BaselineKnown: baseline.Agreement}
		report.Rounds = append(report.Rounds, round)
		idx := len(report.Rounds) - 1
		finish := func(state, reason string) {
			report.Rounds[idx].State = state
			report.Rounds[idx].FailureCode = reason
			report.Rounds[idx].CompletedUTC = utc()
			record(v, "ROUND_END", state)
		}
		record(v, "ROUND_START", "CANDIDATE_SELECTED")
		captureNetwork("ROUND_START", v)
		ui.guideInstruction("Вариант " + formatInt(i+1) + "/" + formatInt(len(plan)) + ": " + v.Protocol + " / " + v.Profile)
		if v.Protocol != lastProtocol {
			if lastProtocol != "" {
				if !ui.guideAsk(ctx,"Первый протокол не дал подтверждённого результата. В Amnezia отключите VPN, выберите VLESS и снова подключите. Нажмите «Готово» после переключения.") {
					finish("CANCELLED","PROTOCOL_SWITCH_NOT_CONFIRMED")
					return
				}
				record(v,"USER_ACTION","VLESS_SELECTION_CONFIRMED_BY_USER")
			} else {
				record(v,"USER_ACTION","PROTOCOL_SELECTED_BY_USER_NOT_API")
				ui.guideInstruction("Проверяю выбранный "+v.Protocol+". Если он ещё не подключён в Amnezia, нажмите «Подключить» там. Далее проверка автоматическая.")
			}
			lastProtocol=v.Protocol
		}
        // Revalidate the exact per-trial outer peer after reconnect.
        autoEndpoint:=false
        var endpointAtStart OuterEndpoint

		// The endpoint used by WinDivert must be current and protocol-compatible.
		if v.RequiresEndpoint {
			// Every filtered attempt requires fresh process/socket evidence.
			// Never cache the AmneziaWG remote peer into the VLESS phase or
			// use stale advanced fields as "automatic" discovery.
			m.cfg.EndpointIPv4 = manualEndpoint.EndpointIPv4
			m.cfg.Port = manualEndpoint.Port
			m.cfg.Transport = manualEndpoint.Transport
			endpointConfirmed[v.Protocol] = false
			autoCode := "PROBE_ERROR"
			if !endpointRejected[v.Protocol] {
				observeCtx, observeCancel := context.WithTimeout(ctx, 16*time.Second)
				observed, code := m.observeOuterEndpoint(observeCtx, v.Protocol)
				observeCancel()
				autoCode = code
				record(v, "ENDPOINT", automaticEndpointCode(autoCode))
				if code == "OBSERVED" {
					autoEndpoint = true
					endpointAtStart = observed
					m.cfg.EndpointIPv4 = observed.IPv4
					m.cfg.Port = observed.Port
					m.cfg.Transport = observed.Transport
					endpointConfirmed[v.Protocol] = true
					ui.guideInstruction("Внешний транспорт VPN обнаружен автоматически по процессам и физическому маршруту Windows. Адрес и порт не экспортируются и не сохраняются; native handshake ещё не подтверждён.")
				}
			}
			if endpointRejected[v.Protocol] {
				finish("SKIPPED", "ENDPOINT_NOT_CONFIRMED")
				continue
			}
			if !guideEndpointApplicable(m.cfg, v.Protocol) {
				finish("SKIPPED", "NO_MATCHING_VERIFIED_ENDPOINT")
				ui.guideInstruction("DPI " + v.Profile + " пропущен: Windows не подтвердила внешний транспорт " + v.Protocol + " (" + automaticEndpointCode(autoCode) + "). Вводить IP вручную не требуется. Подстановка случайного адреса и перехват пакетов запрещены.")
				continue
			}
			if !endpointConfirmed[v.Protocol] {
				if !ui.guideAsk(ctx,"Windows не обнаружила однозначный внешний узел VPN. Если вы ранее самостоятельно настроили реальный IP и порт текущего " + v.Protocol + ", подтвердите их актуальность. Иначе выберите «Нет / пропустить»: вводить адрес из Amnezia не требуется.") {
					record(v, "USER_ACTION", "ENDPOINT_NOT_CONFIRMED")
					// A refusal to confirm applies to all remaining filtered candidates.
					endpointRejected[v.Protocol] = true
					finish("SKIPPED", "ENDPOINT_NOT_CONFIRMED")
					continue
				}
				endpointConfirmed[v.Protocol] = true
			}
			if !ui.guideAsk(ctx,"Чтобы безопасно применить " + v.Profile + ", отключите соединение в Amnezia (приложение оставьте открытым). Нажмите OK после отключения. Затем менеджер включит только свой локальный DPI-фильтр и предложит снова подключить VPN.") {
				finish("CANCELLED", "DISCONNECT_NOT_CONFIRMED")
				return
			}
			// Never install WinDivert while the VPN route is still confirmed active.
			offCtx, offCancel := context.WithTimeout(ctx, 12*time.Second)
			st, offErr := m.vpnState(offCtx)
			offCancel()
			if offErr != nil || connectionGuideAction(st) == "MEASURE_CONNECTION" {
				finish("SKIPPED", "VPN_STILL_ROUTED")
				ui.guideInstruction("Маршрут VPN ещё виден. Не включаю DPI: сначала отключите подключение в Amnezia.")
				continue
			}
			routeCtx, routeCancel := context.WithTimeout(ctx, 9*time.Second)
			route := m.endpointRoute(routeCtx)
			routeCancel()
			if !endpointRouteObserved(route) || (route != nil && strings.EqualFold(route.Name, m.cfg.AdapterName)) {
				finish("SKIPPED", "OUTER_ENDPOINT_ROUTE_NOT_CONFIRMED")
				ui.guideInstruction("Невозможно подтвердить физический маршрут к внешнему VPN-серверу без туннельного цикла. Не включаю WinDivert; сначала нужна подтверждённая конфигурация/состояние сети.")
				continue
			}
			if !enginePresent(m.cfg.BundleRoot) {
				if err := installUpstream(ctx, m.cfg.BundleRoot, m.prompt, m.output); err != nil {
					finish("SKIPPED", "ENGINE_UNAVAILABLE")
					continue
				}
			}
			record(v, "FILTER", "CHECKING_LUA_AND_STARTING_OWN_DPI")
			ui.guideInstruction("Проверяю Lua оригинального winws2 и запускаю только свой DPI. Если запуск не удастся, этап завершится ошибкой, а не бесконечным ожиданием.")
			if err := m.startFilter(v.Profile); err != nil {
				finish("FAILED", "DPI_START_FAILED")
				record(v, "FILTER", guideErrorCode(err))
				ui.guideInstruction("DPI не запущен: " + guideErrorCode(err) + ". Продолжаю без неподтверждённого фильтра; подробности есть в отчёте.")
				continue
			}
			filterStarted = true
			record(v, "FILTER", "OWN_DPI_STARTED")
			// This guard prevents an unbounded test with an active packet filter.
			watchdog := startTrialWatchdog(ctx, trialFilterMaxWait, func() { _ = m.stopFilter() })
			if !ui.guideAsk(ctx,"DPI " + v.Profile + " включён. Теперь нажмите «Подключить» в Amnezia для выбранного протокола. Нажмите OK только после попытки подключения; дальше программа сама измерит результат.") {
				watchdog.Stop()
				finish("CANCELLED", "RECONNECT_CANCELLED")
				return
			}
			if watchdog.Expired() {
				watchdog.Stop()
				filterStarted = false
				finish("FAILED", "DPI_WATCHDOG_TIMEOUT")
				continue
			}
			watchdog.Stop()
		}
		ui.guideInstruction("Ожидаю VPN-маршрут, затем автоматически выполню HTTPS-тесты и измерю передачу по адаптеру.")
		state, up := ui.guideObserve(ctx, m, 65*time.Second, func(action string) { record(v, "VPN_WAIT", action) })
		if !up {
			finish("FAILED", "VPN_ROUTE_NOT_READY")
			ui.guideInstruction("Маршрут не сформирован. Следующий вариант будет предложен автоматически; чужие процессы не останавливаю.")
			if filterStarted {
				if err := m.stopFilter(); err != nil {
					report.State = "DPI_STOP_ERROR"
					report.AdviceCode = "OWNED_DPI_STOP_FAILED"
					record(v, "FILTER", "OWN_DPI_STOP_ERROR")
					return
				}
				filterStarted = false
				record(v, "FILTER", "OWN_DPI_STOPPED")
			}
			continue
		}
		report.VPNRouteObserved = true
		report.Rounds[idx].RouteObserved = true
		m.cfg.AdapterName = state.AdapterName
		record(v, "VPN_ROUTE", "ROUTE_OBSERVED_HANDSHAKE_UNVERIFIED")
		if filterStarted && autoEndpoint {
			// Reconnect can rotate the Premium server. An old exact WinDivert
			// destination must not be interpreted as the current VPN peer.
			recheckCtx, recheckCancel := context.WithTimeout(ctx, 16*time.Second)
			fresh, freshCode := m.observeOuterEndpoint(recheckCtx, v.Protocol)
			recheckCancel()
			if freshCode != "OBSERVED" || !sameOuterEndpoint(endpointAtStart, fresh) {
				record(v, "ENDPOINT_POST_RECONNECT", "AUTO_ENDPOINT_CHANGED_OR_UNVERIFIED")
				finish("FAILED", "OUTER_ENDPOINT_CHANGED_OR_UNVERIFIED")
				ui.guideInstruction("После переподключения не удалось повторно подтвердить тот же внешний сервер VPN. Останавливаю свой DPI, результат испытания недостоверен; IP и порт не экспортируются.")
				if err := m.stopFilter(); err != nil {
					report.State = "DPI_STOP_ERROR"
					report.AdviceCode = "OWNED_DPI_STOP_FAILED"
					record(v, "FILTER", "OWN_DPI_STOP_ERROR")
					return
				}
				filterStarted = false
				record(v, "FILTER", "OWN_DPI_STOPPED")
				continue
			}
			record(v, "ENDPOINT_POST_RECONNECT", "AUTO_ENDPOINT_RECHECK_MATCHED")
		}
		testCtx, testCancel := context.WithTimeout(ctx, 125*time.Second)
		before, _ := m.adapterStats(testCtx)
		eg := m.egress(testCtx)
		report.Rounds[idx].EgressObserved = eg.Agreement
		report.Rounds[idx].EgressChanged = baseline.Agreement && eg.Agreement && eg.IP != baseline.IP
		report.Rounds[idx].EgressSamples = guideIPObservations(eg)
		report.EgressObserved = eg.Agreement
		report.EgressChanged = report.Rounds[idx].EgressChanged
		record(v, "IP_CHECK", func() string {
			if eg.Agreement {
				return "CONSENSUS"
			}
			return "INCONCLUSIVE"
		}())
		ui.guideInstruction("Измеряю четыре полные HTTPS-загрузки, с резервным тестовым сервером при отказе первого. Это не тест нативного VPN-handshake.")
		_, transfers, quality := checkGuideVideo(testCtx, guideVideoFetch, waitGuide)
		testCancel()
		report.Rounds[idx].Video = quality
		report.Rounds[idx].Transfers = transfers
		report.Video = quality
		afterCtx, afterCancel := context.WithTimeout(ctx, 8*time.Second)
		after, _ := m.adapterStats(afterCtx)
		afterCancel()
		flow := before != nil && after != nil && strings.EqualFold(before.Name, after.Name) && strings.EqualFold(after.Status, "Up") && after.SentBytes > before.SentBytes && after.ReceivedBytes > before.ReceivedBytes
		report.Rounds[idx].AdapterFlow = flow
		report.AdapterFlowObserved = flow
		captureNetwork("AFTER_TRANSFER", v)
		record(v, "VIDEO", quality.Grade)
		speedNote := "скорость НЕ ИЗМЕРЕНА"
		if quality.Grade != "INCOMPLETE" && quality.Grade != "NOT_VERIFIED" {
			speedNote = "минимум " + formatMbps(quality.MinMbps) + " Мбит/с"
		}
		ui.guideInstruction("Видео-данные: " + quality.Grade + "; полных загрузок " + formatInt(quality.Successful) + "/" + formatInt(quality.Total) + ", " + speedNote + "; " + guideSourceSummary(transfers))
		if ctx.Err() != nil {
			finish("CANCELLED", "USER_CANCELLED")
			return
		}
		outcome := guideOutcome(baseline.Agreement, report.Rounds[idx].EgressChanged, flow, quality)
		if outcome == "VIDEO_USABLE_EGRESS_UNCHANGED" {
			report.State = outcome
			report.AdviceCode = "VPN_EGRESS_UNCHANGED_DO_NOT_SWITCH_DPI"
			finish(outcome, "IP_UNCHANGED_WITH_WORKING_HTTPS")
			ui.guideInstruction("Тестовые загрузки работают, но исходный IPv4 не изменился. Сохраните рабочий интернет: не переключаю DPI вслепую. Проверьте маршрутизацию/раздельное туннелирование в Amnezia.")
			return
		}
		usable := quality.Grade == "HD_1080P_CANDIDATE" || quality.Grade == "HD_720P_CANDIDATE"
		if usable && flow && (!baseline.Agreement || report.Rounds[idx].EgressChanged) {
			// If the baseline was unavailable, report data-path usability but never
			// claim the VPN identity/handshake is verified.
			if baseline.Agreement {
				report.State = "VIDEO_CANDIDATE_VPN_PATH_OBSERVED"
				report.AdviceCode = "VERIFY_REAL_VIDEO_15_MIN"
				finish("VIDEO_CANDIDATE", "VPN_DATA_PATH_OBSERVED_NOT_NATIVE_HANDSHAKE")
			} else {
				report.State = "VIDEO_CANDIDATE_EGRESS_UNVERIFIED"
				report.AdviceCode = "VERIFY_VPN_IDENTITY_AND_REAL_VIDEO"
				finish("VIDEO_CANDIDATE", "NO_BASELINE_FOR_EGRESS_COMPARISON")
			}
			ui.guideInstruction("Есть кандидат для видео. Проверьте реальное воспроизведение 15 минут. VPN-handshake нативно не доказан; активная DPI-стратегия будет работать только пока открыт менеджер.")
			if filterStarted {
				if ui.guideMonitor(ctx, m, &report, v, record, persist) && ctx.Err() == nil {
					if err := m.stopFilter(); err == nil {
						filterStarted = false
						record(v, "FILTER", "OWN_DPI_STOPPED")
					} else {
						report.State = "DPI_STOP_ERROR"
						report.AdviceCode = "OWNED_DPI_STOP_FAILED"
						record(v, "FILTER", "OWN_DPI_STOP_ERROR")
						return
					}
					report.State = "IN_PROGRESS"
					continue
				}
				return
			}
			// A working unmodified VPN stays untouched. We watch its route and
			// short data transfers until the user stops the guide or repeated
			// failures justify the next (explicitly confirmed) strategy.
			if ui.guideMonitor(ctx, m, &report, v, record, persist) && ctx.Err() == nil {
				report.State = "IN_PROGRESS"
				continue
			}
			return
		}
		if usable && !flow {
			report.State = "WEB_USABLE_VPN_UNVERIFIED"
			report.AdviceCode = "CHECK_VPN_ROUTE_AND_APP"
			finish("WEB_USABLE_VPN_UNVERIFIED", "ADAPTER_COUNTERS_NOT_CONFIRMED")
			ui.guideInstruction("HTTPS-загрузка подходит для видео, но VPN-адаптер не подтвердил поток. Не буду ломать доступ перебором DPI: сначала нужно проверить маршрут и раздельное туннелирование.")
			return
		}
		if !eg.Agreement && quality.Grade == "INCOMPLETE" && flow {
            report.State = "DIAGNOSTIC_SERVICES_UNAVAILABLE"
            report.AdviceCode = "CHECK_REAL_VIDEO_MANUALLY"
            finish("INCONCLUSIVE", "TEST_SERVICES_UNAVAILABLE_WITH_ADAPTER_FLOW")
            ui.guideInstruction("Тестовые HTTPS-сервисы недоступны, но счётчики VPN-адаптера изменились. Это не доказывает отказ Amnezia и не измеряет скорость.")
            // Previously the guide always exited here, making every DPI
            // alternative unreachable on a network where the benchmark CDN
            // itself was blocked. The user may explicitly authorize additional
            // experiments, without calling a failed CDN a VPN failure.
            if v.Profile=="NONE" && i+1<len(plan) && ctx.Err()==nil {
                if ui.guideAsk(ctx,"Сервисы проверки недоступны. Работоспособность VPN не установлена. Попробовать остальные протоколы и собственные DPI-профили? Каждый запуск потребует явного подтверждения переключения Amnezia; результат будет только диагностическим.") {
                    report.State="IN_PROGRESS"
                    report.AdviceCode=""
                    record(v,"USER_ACTION","CONTINUE_AFTER_DIAGNOSTIC_OUTAGE")
                    continue
                }
            }
            if ctx.Err()!=nil {
                report.State="CANCELLED"
                report.AdviceCode="USER_CANCELLED"
            }
            ui.guideInstruction("Дополнительные DPI-опыты не выполнялись без разрешения. Можно проверить настоящее видео самостоятельно либо повторить замер позже.")
            return
        }
		if !eg.Agreement && quality.Grade == "INCOMPLETE" {
			finish("FAILED", "NETWORK_TEST_SERVICES_INCONCLUSIVE")
		} else if quality.Grade == "INCOMPLETE" {
			finish("FAILED", "HTTPS_TRANSFER_INCOMPLETE")
		} else if quality.Grade == "SLOW_FOR_VIDEO" {
			finish("FAILED", "VIDEO_BANDWIDTH_BELOW_TARGET")
		} else {
			finish("FAILED", "VPN_DATA_PATH_NOT_CONFIRMED")
		}
		if filterStarted {
			if err := m.stopFilter(); err != nil {
				report.State = "DPI_STOP_ERROR"
				report.AdviceCode = "OWNED_DPI_STOP_FAILED"
				record(v, "FILTER", "OWN_DPI_STOP_ERROR")
				return
			} else {
				filterStarted = false
				record(v, "FILTER", "OWN_DPI_STOPPED")
			}
		}
	}
	report.State = "ALL_PROTOCOLS_UNVERIFIED"
	report.AdviceCode = "NO_COMPATIBLE_VERIFIED_ROUTE"
	ui.guideInstruction("Испытания завершены: пригодный VPN-путь для видео не подтверждён. Отчёт содержит результаты и пропуски по " + formatInt(len(plan)) + " запланированным вариантам. Поддерживаемый сервер Amnezia не угадываю.")
}

func (ui *managerUI) guideMonitor(ctx context.Context, m *Manager, report *GuideReport, v GuideVariant, record func(GuideVariant, string, string), persist func()) bool {
	ui.guideInstruction("Наблюдаю устойчивость. Для остановки нажмите «Остановить»; собственный DPI будет выключен. Amnezia останется без изменений.")
	misses := 0
	for ctx.Err() == nil {
		if waitGuide(ctx, 45*time.Second) != nil {
			return false
		}
		testCtx, cancel := context.WithTimeout(ctx, 28*time.Second)
		state, err := m.vpnState(testCtx)
		source := "TEST_CDN_A"
		trial := guideVideoFetch(testCtx, 131072, 0)
		if !trial.OK && testCtx.Err() == nil {
			source = "TEST_CDN_B"
			trial = guideVideoFetch(testCtx, 131072, 1)
		}
		cancel()
		healthy := err == nil && connectionGuideAction(state) == "MEASURE_CONNECTION" && trial.OK
		if healthy {
			misses = 0
			record(v, "MONITOR", "PATH_OK")
		} else {
			misses++
			record(v, "MONITOR", "PATH_NOT_CONFIRMED")
		}
		sample := GuideMonitorSample{UTC: utc(), Protocol: v.Protocol, DPIProfile: v.Profile, RouteObserved: err == nil && connectionGuideAction(state) == "MEASURE_CONNECTION", TransferOK: trial.OK, TestSource: source, Bytes: trial.Bytes, Mbps: trial.Mbps, ConsecutiveFailures: misses}
		report.MonitorSamples = append(report.MonitorSamples, sample)
		if len(report.MonitorSamples) > 256 {
			report.MonitorSamples = report.MonitorSamples[1:]
		}
		persist()
		if misses >= 3 {
			report.State = "CONNECTION_DEGRADED"
			report.AdviceCode = "AUTO_TRY_NEXT_CANDIDATE"
			ui.guideInstruction("Три последовательные проверки не подтвердили путь. Останавливаю собственный DPI и перехожу к следующему совместимому варианту, при необходимости запросив переподключение Amnezia.")
			return true
		}
	}
	return false
}
