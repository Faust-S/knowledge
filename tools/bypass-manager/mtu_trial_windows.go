//go:build windows

package main

import (
	"context"
	"path/filepath"
	"time"
)

// A temporary ActiveStore-only A/B check. The separate PowerShell watchdog
// attempts to restore original MTU after 90 seconds even if the GUI crashes.
// Neither an improvement nor a changed public IP is assumed from socket data.
func (ui *managerUI) trialMTU() {
	if ui.running {
		return
	}
	warning := "Временная проба MTU может нарушить соединение до 90 секунд. Изменяется только IPv4 MTU единственного активного физического адаптера, без DNS, маршрутов и настроек VPN. Независимый процесс попытается вернуть исходный MTU после сбоя и не позднее 90 секунд. Это не абсолютная гарантия отката. Продолжить?"
	if winMessageBox(ui.hwnd, warning, "Проба MTU с откатом", 0x24) != 6 {
		return
	}
	ui.toggleRun(true)
	ctx, cancel := context.WithTimeout(ui.lifetimeCtx, 80*time.Second)
	ui.cancel = cancel
	go func() {
		defer cancel()
		defer post(ui.hwnd, wmAppDone)
		m := &Manager{home: ui.home, runtimeRoot: filepath.Join(ui.home, "runtime"), output: uiWriter{ui}}
		report := MTUTrialReport{SchemaVersion: "0.3.4", CompletedUTC: utc(), State: "NOT_STARTED", RollbackStatus: "NOT_NEEDED", Caveat: mtuTrialCaveat}
		defer func() {
			report.CompletedUTC = utc()
			_ = saveJSON(filepath.Join(ui.home, "results", "latest-mtu-trial.json"), report)
		}()
		if err := m.ensureRuntime(); err != nil {
			report.State = "RUNTIME_UNAVAILABLE"
			return
		}
		previewRaw, err := m.powerShell(ctx, "Temporary-MTU.ps1", "-Mode", "Preview")
		if err != nil {
			report.State = "MTU_PREVIEW_UNAVAILABLE"
			ui.write("Не удалось предварительно проверить допустимость MTU-пробы.\n")
			return
		}
		preview, err := parseMTUTrialResponse([]byte(previewRaw))
		if err != nil || preview.Status != "TRIAL_AVAILABLE" {
			report.State = "MTU_PREVIEW_UNAVAILABLE"
			ui.write("MTU-проба недоступна: нет однозначного физического адаптера или требуется восстановить предыдущую пробу.\n")
			return
		}
		ui.write("Измеряю исходную полную HTTPS-загрузку. Отдельный внешний IP не определяю.\n")
		sampleCtx, finish := context.WithTimeout(ctx, 18*time.Second)
		before := guideVideoFetch(sampleCtx, 2*1024*1024, 0)
		finish()
		source := 0
		if !before.OK || before.Bytes != 2*1024*1024 {
			sampleCtx, finish = context.WithTimeout(ctx, 18*time.Second)
			before = guideVideoFetch(sampleCtx, 2*1024*1024, 1)
			finish()
			source = 1
		}
		if !before.OK || before.Bytes != 2*1024*1024 {
			report.State = "BASELINE_DOWNLOAD_UNAVAILABLE"
			ui.write("Исходная HTTPS-загрузка неполная; менять MTU без контрольной точки нельзя.\n")
			return
		}
		report.BeforeMbps = before.Mbps
		raw, err := m.powerShell(ctx, "Temporary-MTU.ps1", "-Mode", "Start")
		started, startErr := parseMTUTrialResponse([]byte(raw))
		if err != nil || startErr != nil || started.Status != "TRIAL_STARTED" {
			report.State = "TRIAL_NOT_CONFIRMED"
			ui.write("MTU-тест не включился. Настройки не считаются изменёнными; при наличии старого журнала восстановит watchdog.\n")
			return
		}
		report.BeforeMTU = started.BeforeMTU
		report.TrialMTU = started.AfterMTU
		report.State = "TRIAL_IN_PROGRESS"
		report.RollbackStatus = "PENDING"
		ui.write("MTU временно уменьшен. Проверяю ту же HTTPS-загрузку; после пробы исходное значение будет восстановлено.\n")
		// Always call immediate rollback under an independent context, even when
		// the GUI request is cancelled; the external watchdog is a second layer.
		defer func() {
			restoreCtx, done := context.WithTimeout(context.Background(), 15*time.Second)
			defer done()
			result, e := m.powerShell(restoreCtx, "Temporary-MTU.ps1", "-Mode", "Restore")
			restore, re := parseMTUTrialResponse([]byte(result))
			if e != nil || re != nil || (restore.Status != "RESTORED" && restore.Status != "NO_PENDING_TRIAL") {
				report.RollbackStatus = "ROLLBACK_UNVERIFIED_WATCHDOG_PENDING"
				ui.write("Немедленный откат не подтверждён. Независимый watchdog должен вернуть MTU к исходному значению; проверьте сеть.\n")
			} else {
				report.RollbackStatus = "RESTORED"
				ui.write("Исходный MTU восстановлен и проверен.\n")
			}
		}()
		sampleCtx, finish = context.WithTimeout(ctx, 18*time.Second)
		after := guideVideoFetch(sampleCtx, 2*1024*1024, source)
		finish()
		if !after.OK || after.Bytes != 2*1024*1024 {
			report.State = "TRIAL_TRANSFER_FAILED"
			ui.write("При временном MTU HTTPS-загрузка не удалась. Возвращаю исходные параметры.\n")
			return
		}
		report.TrialMbps = after.Mbps
		if mtuTrialWorthKeeping(before.Mbps, after.Mbps, true) {
			report.State = "MEASURABLE_IMPROVEMENT_REVERTED"
			ui.write("Однократная HTTPS-проба ускорилась; значение MTU всё равно возвращается. Требуются повторные испытания до постоянного изменения.\n")
		} else {
			report.State = "NO_REPRODUCIBLE_GAIN_REVERTED"
			ui.write("Устойчивое улучшение на одной полной загрузке не доказано. Исходный MTU возвращается.\n")
		}
	}()
}
