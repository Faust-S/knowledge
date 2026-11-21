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
		return "Без фильтра HTTPS стал доступнее. Собственный фильтр выключен; причинность не доказана."
	case "FILTER_RESTORED_NO_AB_GAIN":
		return "Без фильтра HTTPS не улучшился. Восстановлен прежний фильтр."
	case "RESTORE_FAILED":
		return "Проверка A/B завершилась, но повторный запуск фильтра не удался. См. отчёт."
	case "STOP_REQUESTED":
		return "Выполняется ручное выключение фильтра."
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
	canTune := ui.recoverPendingDirectStrategy()
	ticker := time.NewTicker(directMonitorInterval)
	defer ticker.Stop()
	var supervisor directSupervisor
	seenLearned := map[string]bool{}
	seenStrategies := map[string]bool{}
	trialCount := 0
	for {
		select {
		case <-ui.ctx.Done():
			return
		case <-ticker.C:
		}
		ui.mu.Lock()
		wanted, busy, closing, epoch := ui.requestedOn, ui.busy, ui.closing, ui.operationEpoch
		ui.mu.Unlock()
		if closing {
			return
		}
		if busy {
			continue
		}
		if !wanted {
			supervisor.disarm()
			clear(seenLearned)
			clear(seenStrategies)
			trialCount = 0
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
			if ctx.Err() == nil {
				learned := probeNewDirectLearned(ctx, filepath.Join(m.stateFolder, "direct-auto-hosts.txt"), seenLearned, probeDirectLearnedTLS)
				_ = m.saveDirectLearned(learned)
			}
		}
		snapshot := supervisor.observe(state, phase, baselineHealthy)
		done()
		if ui.ctx.Err() != nil {
			return
		}
		ui.mu.Lock()
		obsolete := ui.operationEpoch != epoch || !ui.requestedOn || ui.busy
		ui.mu.Unlock()
		if obsolete {
			continue
		}
		if snapshot.Action != directMonitorNone {
			ui.executeDirectMonitorAction(m, &snapshot)
		}
		trialNote := ""
		// Tune one newly learned host at a time. Never do this while the
		// three public probes show general network impairment.
		if canTune && snapshot.State == "GENERAL_HTTPS_AVAILABLE" && trialCount < directStrategyTrialsPerSession {
			if attempted, note := ui.tuneDirectLearned(m, epoch, seenStrategies); attempted {
				trialCount++
				trialNote = note
			} else {
				trialNote = note
			}
		}
		if !validDirectMonitor(snapshot) {
			continue
		}
		_ = m.saveDirectMonitor(snapshot)
		// Do not overwrite a pending user action with a monitor result.
		ui.mu.Lock()
		if !ui.busy && !ui.closing && ui.operationEpoch == epoch {
			if snapshot.State == "ROLLBACK_APPLIED" || snapshot.State == "RESTORE_FAILED" || snapshot.State == "RECOVERY_FAILED" || snapshot.State == "RECOVERY_EXHAUSTED" {
				ui.requestedOn = false
			}
			if snapshot.EngineState != "UNKNOWN" {
				ui.result = snapshot.EngineState
				if ui.requestedOn && (snapshot.EngineState == directOff || snapshot.EngineState == directUnverified) {
					ui.result = "AUTO_RECOVERY_PENDING"
				}
				ui.cause = directMonitorSummary(snapshot)
				if trialNote != "" { ui.cause = trialNote }
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
		// Compare public HTTPS with our filter OFF. If availability does
		// not improve, restore the exact prior owned native filter.
		offCtx, endOff := context.WithTimeout(context.Background(), 10*time.Second)
		off := probeDirectPhase(offCtx, newDirectProbeClient(), directProbeTargets)
		endOff()
		if directABOffImproved(r.Passed, &off) {
			r.State, r.EngineState = "ROLLBACK_APPLIED", directOff
			_ = m.saveDirectReport(directReport(directOff, "AUTO_AB_HTTPS_AVAILABLE_WITHOUT_FILTER_NOT_CAUSAL_PROOF"))
			_ = m.saveDirectLocalFailure(nil)
			return
		}
		ui.mu.Lock()
		stillWanted := ui.requestedOn
		ui.mu.Unlock()
		if !stillWanted {
			r.State, r.EngineState = "STOP_REQUESTED", directOff
			return
		}
		// Window close must not strand the user's previously running
		// filter OFF. Finish restoring using a bounded independent context.
		restoreCtx, endRestore := context.WithTimeout(context.Background(), 75*time.Second)
		err = m.startDirect(restoreCtx)
		endRestore()
		if err == nil {
			checkCtx, endCheck := context.WithTimeout(context.Background(), 12*time.Second)
			var verified string
			verified, err = m.getDirectStatus(checkCtx)
			endCheck()
			if err == nil && verified != directRunning {
				err = errors.New("direct filter could not be verified after A/B restoration")
			}
		}
		if err != nil {
			r.State, r.EngineState = "RESTORE_FAILED", directOff
			if m.ownStateExists() {
				if stopErr := m.stopDirect(); stopErr != nil {
					r.EngineState = directUnverified
					err = errors.Join(err, stopErr)
				}
			}
			_ = m.saveDirectReport(directReport(r.EngineState, "AUTO_AB_RESTORE_FAILED"))
			_ = m.saveDirectLocalFailure(err)
			return
		}
		r.State, r.EngineState = "FILTER_RESTORED_NO_AB_GAIN", directRunning
		_ = m.saveDirectReport(directReport(directRunning, "AUTO_AB_NO_GAIN_OFF_FILTER_RESTORED"))
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
