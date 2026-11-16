//go:build windows

package main

import (
	"context"
	"path/filepath"
	"time"
)

// inspectNetwork provides a standalone network diagnosis, without modifying
// DNS, VPN, adapter settings, proxy, routing, WinDivert or the provider network.
func (ui *managerUI) inspectNetwork() {
	if ui.running {
		return
	}
	ctx, cancel := context.WithTimeout(ui.lifetimeCtx, 22*time.Second)
	ui.cancel = cancel
	ui.toggleRun(true)
	ui.setStatus("Читаю схему сети Windows, ничего не изменяя...")
	ui.write("Пассивная диагностика Windows: физический адаптер, MTU, линк, ошибки пакетов, VPN-маршруты, системный прокси.\\n")
	go func() {
		defer cancel()
		defer post(ui.hwnd, wmAppDone)
		m := &Manager{home: ui.home, runtimeRoot: filepath.Join(ui.home, "runtime"), output: uiWriter{ui}}
		a := NetworkAudit{SchemaVersion: "0.3.2", CompletedUTC: utc(), State: "UNAVAILABLE", Findings: []NetworkFinding{}, Caveat: networkHealthCaveat}
		if err := m.ensureRuntime(); err == nil {
			if sample, err := m.networkHealth(ctx); err == nil {
				a.State = "PASSIVE_SNAPSHOT"
				a.Snapshot = sample
				a.Findings = assessNetworkHealth(sample)
			}
		}
		if ctx.Err() != nil {
			ui.write("Проверка сети прервана.\\n")
			return
		}
		filename := filepath.Join(ui.home, "results", "latest-network.json")
		if err := saveJSON(filename, a); err != nil {
			ui.write("Не удалось сохранить локальный отчёт о сети.\\n")
			return
		}
		if a.State != "PASSIVE_SNAPSHOT" {
			ui.write("Windows не вернула достоверный снимок сети. Причина скрыта во избежание передачи персональных сведений.\\n")
			return
		}
		ui.write(networkAuditSummary(a) + "\\n")
		for _, f := range a.Findings {
			ui.write("Сеть: " + f.Code + ". " + networkFindingText(f.Code) + "\\n")
		}
		ui.write("Отчёт: results/latest-network.json. Никакие параметры сети не изменены.\\n")
	}()
}
