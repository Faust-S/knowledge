//go:build windows

package main

import (
	"context"
	"errors"
	"path/filepath"
	"time"
)

func directMonitorSummary(r DirectMonitorReport) string {
	switch r.State {
	case "GENERAL_HTTPS_AVAILABLE":
		return "Фоновая проверка: общие HTTPS-сервисы доступны. Доступ к конкретным сайтам не доказан."
	case "GENERAL_HTTPS_IMPAIRED":
		return "Фоновая проверка: общая HTTPS-доступность ухудшилась; повторно проверю перед действием."
	case "ENGINE_MISSING":
		return "Собственный фильтр не подтверждён; проверю ещё раз перед восстановлением."
	case "RECOVERED":
		return "Свой процесс запущен повторно и проверен. Доступность нужного сайта неизвестна."
	case "RECOVERY_FAILED", "RECOVERY_EXHAUSTED":
		return "Автовосстановление не удалось или исчерпано. Проверьте отчёт и включите вручную."
	case "ROLLBACK_APPLIED":
		return "После повторных HTTPS-ошибок собственный фильтр выключен. Причина ошибок неизвестна."
	case "ROLLBACK_FAILED":
		return "Не удалось автоматически остановить свой фильтр. Проверьте остановку вручную."
	default:
		return ""
	}
}

func recentDirectMonitor(m *Manager) (DirectMonitorReport, bool) {
	var r DirectMonitorReport
	if readStrictJSON(filepath.Join(m.home, "results", "latest-direct-monitor.json"), &r) != nil || !validDirectMonitor(r) {
		return DirectMonitorReport{}, false
	}
	at, err := time.Parse(time.RFC3339Nano, r.CheckedUTC)
	if err != nil || time.Since(at) > 3*directMonitorInterval || time.Since(at) < -time.Minute {
		return DirectMonitorReport{}, false
	}
	return r, true
}

// A separate monitor is active only while the native GUI is open. It does not
// install a service, capture browsing history or silently change system routes.
func (ui *oneUI) watchDirect() {
	ticker := time.NewTicker(directMonitorInterval)
	defer ticker.Stop()
	var supervisor directSupervisor
	for {
		select {
		case <-ui.ctx.Done():
			return
		case <-ticker.C:
		}
		ui.mu.Lock()
		wanted, busy, closing := ui.requestedOn, ui.busy, ui.closing
		ui.mu.Unlock()
		if closing {
			return
		}
		if busy {
			continue
		}
		if !wanted {
			supervisor.disarm()
			continue
		}
		supervisor.arm()
		m := ui.makeManager()
		var initial DirectCheckReport
		baselineHealthy := readStrictJSON(filepath.Join(m.home, "results", "latest-direct-check.json"), &initial) == nil &&
			validDirectCheck(initial) && initial.EngineRunning && initial.After != nil && initial.After.Passed >= 2
		ctx, done := context.WithTimeout(ui.ctx, 19*time.Second)
		state, err := m.getDirectStatus(ctx)
		var phase *DirectCheckPhase
		if err != nil {
			state = "UNKNOWN"
		}
		if state == directRunning && ctx.Err() == nil {
			p := probeDirectPhase(ctx, newDirectProbeClient(), directProbeTargets)
			phase = &p
		}
		snapshot := supervisor.observe(state, phase, baselineHealthy)
		done()
		if ui.ctx.Err() != nil {
			return
		}
		if snapshot.Action != directMonitorNone {
			ui.executeDirectMonitorAction(m, &snapshot)
		}
		if !validDirectMonitor(snapshot) {
			continue
		}
		_ = m.saveDirectMonitor(snapshot)
		// Do not overwrite a pending user action with a monitor result.
		ui.mu.Lock()
		if !ui.busy && !ui.closing {
			if snapshot.State == "ROLLBACK_APPLIED" || snapshot.State == "RECOVERY_FAILED" || snapshot.State == "RECOVERY_EXHAUSTED" {
				ui.requestedOn = false
			}
			if snapshot.EngineState != "UNKNOWN" {
				ui.result = snapshot.EngineState
				if ui.requestedOn && (snapshot.EngineState == directOff || snapshot.EngineState == directUnverified) {
					ui.result = "AUTO_RECOVERY_PENDING"
				}
				ui.cause = directMonitorSummary(snapshot)
			}
		}
		ui.mu.Unlock()
		post(ui.hwnd, oneRefreshMsg)
	}
}

func (ui *oneUI) executeDirectMonitorAction(m *Manager, r *DirectMonitorReport) {
	ui.operationMu.Lock()
	defer ui.operationMu.Unlock()
	ui.mu.Lock()
	wanted := ui.requestedOn && !ui.busy && !ui.closing
	ui.mu.Unlock()
	if !wanted || ui.ctx.Err() != nil {
		r.Action = directMonitorNone
		r.State = "MONITOR_NOT_ARMED"
		return
	}
	verifyCtx, cancel := context.WithTimeout(ui.ctx, 15*time.Second)
	current, err := m.getDirectStatus(verifyCtx)
	cancel()
	if err != nil {
		r.Action = directMonitorNone
		r.State = "PROCESS_STATUS_UNKNOWN"
		r.EngineState = "UNKNOWN"
		return
	}
	if r.Action == directMonitorRollback {
		if current != directRunning {
			r.Action = directMonitorNone
			r.State = "PROCESS_STATUS_UNKNOWN"
			r.EngineState = current
			return
		}
		err = m.stopDirect() // rechecks PID, start time, executable
		if err != nil {
			r.State = "ROLLBACK_FAILED"
			r.EngineState = directUnverified
			_ = m.saveDirectLocalFailure(err)
			return
		}
		r.State, r.EngineState = "ROLLBACK_APPLIED", directOff
		_ = m.saveDirectReport(directReport(directOff, "AUTO_STOPPED_ON_REPEATED_HTTPS_LOSS"))
		_ = m.saveDirectLocalFailure(nil)
		return
	}
	if r.Action != directMonitorRestart {
		return
	}
	if current != directOff && current != directUnverified {
		r.Action = directMonitorNone
		r.State = "PROCESS_STATUS_UNKNOWN"
		r.EngineState = current
		return
	}
	if m.ownStateExists() {
		// A stale record may describe a reused PID. The existing native Stop
		// must refuse to kill anything if identity is inconsistent.
		if err = m.stopDirect(); err != nil {
			r.State, r.EngineState = "RECOVERY_FAILED", directUnverified
			_ = m.saveDirectLocalFailure(err)
			return
		}
	}
	startCtx, done := context.WithTimeout(ui.ctx, 85*time.Second)
	outcome, startErr := directMeasuredStart(startCtx, m.startDirect,
		func(ctx context.Context) (bool, error) {
			checkCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
			defer cancel()
			state, err := m.getDirectStatus(checkCtx)
			return state == directRunning, err
		}, func(ctx context.Context) DirectCheckPhase {
			return probeDirectPhase(ctx, newDirectProbeClient(), directProbeTargets)
		})
	done()
	_ = m.saveDirectCheck(outcome)
	if startErr == nil && ui.ctx.Err() == nil {
		r.State, r.EngineState = "RECOVERED", directRunning
		_ = m.saveDirectReport(directReport(directRunning, "AUTO_RESTARTED_UNVERIFIED"))
		_ = m.saveDirectLocalFailure(nil)
		return
	}
	if startErr == nil {
		startErr = context.Canceled
	}
	// Cancellation or a failed retry must never leave a surprise owned process.
	if m.ownStateExists() {
		if stopErr := m.stopDirect(); stopErr != nil {
			startErr = errors.Join(startErr, stopErr)
			r.EngineState = directUnverified
		} else {
			r.EngineState = directOff
		}
	} else {
		r.EngineState = directOff
	}
	r.State = "RECOVERY_FAILED"
	_ = m.saveDirectReport(directReport(r.EngineState, "AUTO_RECOVERY_FAILED"))
	_ = m.saveDirectLocalFailure(startErr)
}
