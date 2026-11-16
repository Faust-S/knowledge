//go:build windows

package main

import (
	"context"
	"errors"
	"path/filepath"
	"time"
)

func (m *Manager) captureAppSockets(ctx context.Context) (AppSocketCapture, error) {
	if err := m.ensureRuntime(); err != nil {
		return AppSocketCapture{}, errors.New("runtime unavailable")
	}
	raw, err := m.powerShell(ctx, "Get-AppSockets.ps1")
	if err != nil {
		return AppSocketCapture{}, errors.New("app socket inventory unavailable")
	}
	return parseAppSocketCapture([]byte(raw))
}

func (ui *managerUI) inspectApps() {
	if ui.running {
		return
	}
	if winMessageBox(ui.hwnd, "Windows покажет имена открытых программ только в этом окне. В общий отчёт попадут лишь обезличенные числовые показатели. Сокеты TCP и UDP не доказывают публичный IP каждой программы. Проверить?", "Приложения и соединения", 0x24) != 6 {
		return
	}
	ui.write("Проверяю приложения и локальные TCP/UDP-сокеты без изменения сети...\n")
	ctx, cancel := context.WithTimeout(ui.lifetimeCtx, 35*time.Second)
	go func() {
		defer cancel()
		m := &Manager{home: ui.home, runtimeRoot: filepath.Join(ui.home, "runtime"), output: uiWriter{ui}}
		local, err := m.captureAppSockets(ctx)
		if err != nil {
			ui.write("Сведения о сокетах недоступны. Не делаю вывод о маршрутах приложений.\n")
			return
		}
		audit := summarizeAppSockets(local, time.Now())
		if err := saveJSON(filepath.Join(ui.home, "results", "latest-apps.json"), audit); err != nil {
			ui.write("Не удалось сохранить обезличенный отчёт о приложениях.\n")
			return
		}
		ui.write("Приложения: " + itoa(audit.ProcessCount) + ", TCP через VPN-IP " + itoa(audit.VPNBound) + ", TCP через физический IP " + itoa(audit.PhysicalBound) + ", неизвестных " + itoa(audit.Uncertain) + ", UDP-сокетов " + itoa(audit.UDPBound) + ".\n")
		for _, line := range appSocketLocalLines(local) {
			ui.write(line + "\n")
		}
		ui.write("Это только локальные адреса привязки TCP. У UDP неизвестен удалённый маршрут. Внешний IP конкретной программы НЕ подтверждён. Файл latest-apps.json не содержит имён процессов.\n")
	}()
}
