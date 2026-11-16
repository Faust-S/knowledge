//go:build windows

package main

import (
	"context"
	"path/filepath"
	"time"
)

// Consent-gated, read-only local gateway and external ICMP diagnostics.
func (ui *managerUI) inspectPath() {
	if ui.running {
		return
	}
	if winMessageBox(ui.hwnd, "Диагностика отправит несколько ICMP-запросов локальному шлюзу и контрольному внешнему серверу, в том числе пакеты с DF. Адреса шлюза не записываются. Ответы на ICMP могут быть запрещены. Windows, MTU, DNS и VPN изменяться не будут. Продолжить?", "Задержка и MTU", 0x24) != 6 {
		return
	}
	ctx, cancel := context.WithTimeout(ui.lifetimeCtx, 32*time.Second)
	ui.cancel = cancel
	ui.toggleRun(true)
	ui.setStatus("Проверяю задержку, ICMP и размеры пакетов без изменения сети...")
	ui.write("Проверка локального шлюза и внешнего ICMP-маршрута. Пинг может фильтроваться; отсутствие ответа не равно блокировке.\n")
	go func() {
		defer cancel()
		defer post(ui.hwnd, wmAppDone)
		m := &Manager{home: ui.home, runtimeRoot: filepath.Join(ui.home, "runtime"), output: uiWriter{ui}}
		report := PathReport{SchemaVersion: "0.3.3", CheckedUTC: utc(), State: "UNKNOWN", Caveat: pathCaveat}
		if err := m.ensureRuntime(); err == nil {
			if raw, err := m.powerShell(ctx, "Get-PathEvidence.ps1"); err == nil {
				if ev, err := parsePathEvidence([]byte(raw)); err == nil {
					report.Path = ev
					report.Findings = assessPath(ev)
					report.State = "SAMPLED"
				}
			}
		}
		if ctx.Err() != nil {
			return
		}
		_ = saveJSON(filepath.Join(ui.home, "results", "latest-path.json"), report)
		if report.State != "SAMPLED" {
			ui.write("Диагностика задержки недоступна, результат не подтверждён.\n")
			return
		}
		ui.write("ICMP шлюз: " + formatInt(report.Path.Gateway.Replied) + "/" + formatInt(report.Path.Gateway.Attempted) +
			", медиана " + formatMbps(report.Path.Gateway.MedianMs) + " мс, разброс " + formatMbps(report.Path.Gateway.JitterMs) + " мс.\n")
		ui.write("ICMP внешний путь: " + formatInt(report.Path.Remote.Replied) + "/" + formatInt(report.Path.Remote.Attempted) +
			", медиана " + formatMbps(report.Path.Remote.MedianMs) + " мс. DF 1200: " + report.Path.DF1200 + ", DF 1400: " + report.Path.DF1400 + ".\n")
		for _, f := range report.Findings {
			ui.write("Путь: " + f.Code + " (" + f.Severity + ").\n")
		}
		ui.write("Отчёт latest-path.json обезличен. ICMP не подтверждает реальный PMTU или стабильность видео.\n")
	}()
}
