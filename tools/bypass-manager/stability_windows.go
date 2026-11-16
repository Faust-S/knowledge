//go:build windows

package main

import (
	"context"
	"path/filepath"
	"strings"
	"time"
)

// A real-browser playback trial: the owner plays a selected video for fifteen
// minutes; we observe the network concurrently. We do not claim browser
// buffering is machine-observed or that the browser route equals our route.
func (ui *managerUI) startStability() {
	if ui.running {
		return
	}
	if winMessageBox(ui.hwnd, "Откройте в браузере реальное видео и запустите воспроизведение. После нажатия «Да» начнётся 15-минутный мониторинг сети: проверка VPN-маршрута и короткие HTTPS-пробы каждые 30 секунд, а затем вопрос о зависаниях видео. При остановке тест будет помечен НЕЗАВЕРШЁННЫМ. Тестовые сервисы увидят IP подключения. Начать после запуска видео?", "15 минут: просмотр видео", 0x24) != 6 {
		return
	}
	ctx, cancel := context.WithCancel(ui.lifetimeCtx)
	ui.cancel = cancel
	ui.toggleRun(true)
	ui.setStatus("Идёт 15-минутный просмотр видео и мониторинг сетевого пути...")
	ui.write("Начинаю 15 минут. В браузере должно играть настоящее видео. Результаты сохраняю каждые 30 секунд.\n")
	go func() { defer cancel(); defer post(ui.hwnd, wmAppDone); ui.runStability(ctx) }()
}

func (ui *managerUI) runStability(ctx context.Context) {
	started := time.Now()
	report := StabilityReport{SchemaVersion: "0.3.3", StartedUTC: utc(), State: "RUNNING", PlannedDurationS: 900, UserReportedPlayback: "NOT_ASKED", Caveat: stabilityCaveat}
	filename := filepath.Join(ui.home, "results", "latest-stability.json")
	persist := func() { _ = saveJSON(filename, report) }
	defer func() {
		report.CompletedUTC = utc()
		report.ElapsedS = int(time.Since(started).Seconds())
		if report.State == "RUNNING" {
			report.State = "INTERRUPTED"
		}
		persist()
		ui.write("Тест 15 мин: " + assessStability(report) + ". Отчёт latest-stability.json; закрытый браузерный трафик не инспектируется.\n")
	}()
	m := &Manager{home: ui.home, runtimeRoot: filepath.Join(ui.home, "runtime"), output: uiWriter{ui}}
	if err := m.ensureRuntime(); err != nil {
		report.State = "DIAGNOSTICS_UNAVAILABLE"
		return
	}
	firstCtx, stop := context.WithTimeout(ctx, 14*time.Second)
	initialEgress := m.egress(firstCtx)
	firstNetwork, networkErr := m.networkHealth(firstCtx)
	stop()
	if networkErr == nil {
		report.NetworkBefore = &firstNetwork
	}
	report.StartEgressConfirmed = initialEgress.Agreement
	persist()
	count, complete := runStabilitySchedule(ctx, stabilityDuration, stabilityInterval, func(i int) StabilitySample {
		sample := StabilitySample{UTC: utc(), ElapsedS: int(time.Since(started).Seconds()), Source: "TEST_CDN_A"}
		pollCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		vpn, err := m.vpnState(pollCtx)
		sample.VPNRouteObserved = err == nil && connectionGuideAction(vpn) == "MEASURE_CONNECTION"
		var before *AdapterStats
		if sample.VPNRouteObserved {
			m.cfg.AdapterName = vpn.AdapterName
			before, _ = m.adapterStats(pollCtx)
		}
		size := int64(131072)
		if i%4 == 0 {
			size = 2 * 1024 * 1024
			sample.MeaningfulBandwidth = true
		}
		trial := guideVideoFetch(pollCtx, size, 0)
		if !trial.OK && ctx.Err() == nil {
			sample.Source = "TEST_CDN_B"
			trial = guideVideoFetch(pollCtx, size, 1)
		}
		sample.HTTPSComplete = trial.OK && trial.Bytes == size
		sample.TransferBytes = trial.Bytes
		if sample.MeaningfulBandwidth && sample.HTTPSComplete {
			sample.TransferMbps = trial.Mbps
		}
		if !sample.HTTPSComplete {
			sample.FailureCode = safeGuideDownloadFailure(trial)
		}
		if before != nil {
			after, err := m.adapterStats(pollCtx)
			sample.AdapterFlowObserved = err == nil && after != nil && strings.EqualFold(before.Name, after.Name) && after.ReceivedBytes > before.ReceivedBytes && after.SentBytes > before.SentBytes
		}
		return sample
	}, func(sample StabilitySample) {
		if len(report.Samples) >= 50 {
			report.Samples = report.Samples[1:]
		}
		report.Samples = append(report.Samples, sample)
		if !sample.HTTPSComplete {
			report.HTTPSFailures++
		}
		if !sample.VPNRouteObserved {
			report.RouteFailures++
		}
		if sample.MeaningfulBandwidth && sample.HTTPSComplete && sample.TransferMbps < 4 {
			report.SlowBandwidthSamples++
		}
		persist()
		if sample.ElapsedS%120 < 30 {
			status := "OK"
			if !sample.HTTPSComplete {
				status = "ОШИБКА ПРОБЫ"
			}
			ui.write("15 мин: " + formatInt(sample.ElapsedS/60) + " мин, проба " + status + ", маршрут VPN " + func() string {
				if sample.VPNRouteObserved {
					return "найден"
				}
				return "не подтверждён"
			}() + ".\n")
		}
	})
	_ = count
	if !complete || ctx.Err() != nil {
		report.State = "INTERRUPTED"
		return
	}
	lastCtx, lastCancel := context.WithTimeout(ctx, 15*time.Second)
	endEgress := m.egress(lastCtx)
	report.EndEgressConfirmed = endEgress.Agreement
	report.EgressChangedDuring = initialEgress.Agreement && endEgress.Agreement && initialEgress.IP != endEgress.IP
	afterNetwork, err := m.networkHealth(lastCtx)
	lastCancel()
	if err == nil {
		report.NetworkAfter = &afterNetwork
		if report.NetworkBefore != nil {
			report.Findings = compareNetworkHealth(*report.NetworkBefore, afterNetwork)
		}
	}
	report.ElapsedS = 900
	report.State = "COMPLETED"
	// Confirmation must be explicit. The program cannot read player buffering.
	if winMessageBox(ui.hwnd, "15 минут закончились. Видео действительно воспроизводилось все 15 минут БЕЗ остановок и буферизации? Нажмите «Да» только если вы наблюдали это лично.", "Результат просмотра", 0x24) == 6 {
		report.UserReportedPlayback = "NO_STALLS"
	} else {
		report.UserReportedPlayback = "STALLS_OR_UNCERTAIN"
	}
	ui.write("Проверка завершена. Фактическое воспроизведение: " + report.UserReportedPlayback + ". Это человеческое подтверждение, не автоматическая запись браузерных событий.\n")
}
