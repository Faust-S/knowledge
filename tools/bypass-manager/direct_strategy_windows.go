//go:build windows

package main

import (
	"context"
	"errors"
	"path/filepath"
	"time"
)

func directStrategySummary(r DirectStrategyReport) string {
	switch r.State {
	case "ALTERNATIVE_TLS_CANDIDATE":
		return "Проблемный домен: альтернативная стратегия восстановила TLS в пробах. Доступность приложения ещё не доказана."
	case "ALTERNATIVE_REVERTED":
		return "Альтернативная стратегия не помогла. Для домена восстановлен исходный режим."
	case "BASELINE_OK":
		return "Повторная TLS-проверка проблемного домена прошла без переключения."
	case "BASELINE_INCONCLUSIVE":
		return "Причина отказа не подтверждена. Стратегия не менялась."
	case "ROLLBACK_UNVERIFIED":
		return "Не удалось подтвердить откат стратегии. Автоподбор остановлен."
	case "LOCAL_FILE_ERROR":
		return "Не удалось обновить приватный список стратегий. Изменения не подтверждены."
	default:
		return ""
	}
}

// An exclusive lock prevents the native button from starting/stopping while
// the winws2 hot-reloaded hostlist is being changed. The UI can still accept
// Stop; ready() makes the in-flight trial revert before the stop obtains lock.
func (ui *oneUI) tuneDirectLearned(m *Manager, epoch uint64, seen map[string]bool) (bool, string) {
	ui.operationMu.Lock()
	defer ui.operationMu.Unlock()
	ready := func() bool {
		ui.mu.Lock()
		defer ui.mu.Unlock()
		return ui.requestedOn && !ui.busy && !ui.closing && ui.operationEpoch == epoch
	}
	if !ready() || ui.ctx.Err() != nil { return false, "" }
	checkCtx, cancel := context.WithTimeout(ui.ctx, 12*time.Second)
	state, err := m.getDirectStatus(checkCtx)
	cancel()
	if err != nil || state != directRunning { return false, "" }
	alternative := directAlternativePath(m)
	learned := filepath.Join(m.stateFolder, "direct-auto-hosts.txt")
	host, err := nextDirectStrategyHost(learned, alternative, seen)
	if err != nil {
		_ = m.saveDirectLocalFailure(err)
		return false, "Не удалось прочитать список проблемных соединений."
	}
	if host == "" { return false, "" }
	trialCtx, end := context.WithTimeout(ui.ctx, 46*time.Second)
	defer end()
	settle := func(ctx context.Context) error {
		timer := time.NewTimer(800*time.Millisecond)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
			return nil
		}
	}
	report, err := trialDirectAlternative(trialCtx, host, alternative, probeDirectLearnedTLS, ready, settle)
	_ = m.saveDirectStrategy(report)
	if err != nil {
		_ = m.saveDirectLocalFailure(err)
	}
	if report.State == "ROLLBACK_UNVERIFIED" {
		// If host-specific rollback could not be confirmed, stop only our
		// owned process rather than continue with a surprise rule.
		stopErr := m.stopDirect()
		if stopErr != nil { _ = m.saveDirectLocalFailure(errors.Join(err, stopErr)) }
		ui.mu.Lock()
		if ui.operationEpoch == epoch { ui.requestedOn = false }
		ui.mu.Unlock()
	}
	return true, directStrategySummary(report)
}

// Revert a provisional strategy after a crash, before a new auto-selection.
// It is intentionally independent from connectivity probes or VPN state.
func (ui *oneUI) recoverPendingDirectStrategy() bool {
	ui.operationMu.Lock()
	defer ui.operationMu.Unlock()
	m := ui.makeManager()
	recovered, err := recoverDirectStrategyTrial(directAlternativePath(m))
	if err != nil {
		_ = m.saveDirectLocalFailure(err)
		_ = m.saveDirectStrategy(newDirectStrategyReport("ROLLBACK_UNVERIFIED"))
		return false
	}
	if recovered {
		_ = m.saveDirectStrategy(newDirectStrategyReport("RECOVERED_PENDING_TRIAL"))
	}
	return true
}
