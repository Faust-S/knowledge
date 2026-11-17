//go:build windows

package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// A diagnostic chosen by the user, independent from the DPI and Amnezia
// clients. Calls to third-party HTTPS services are never made at startup.
func (ui *managerUI) checkLive() {
	ui.mu.Lock()
	if ui.liveBusy || ui.closing {
		ui.mu.Unlock()
		return
	}
	ui.mu.Unlock()
	if winMessageBox(ui.hwnd, "Проверка обратится к независимым HTTPS-сервисам, которые увидят ваш публичный IP. Будет загружено не более 66 МиБ тестовых данных. IP и приблизительный регион покажу только в окне; в общий JSON они не попадут. Если VPN отключён, запомню исходный IPv4 локально для будущего сравнения (не экспортируется). Запустить?", "Проверка выхода и скорости", 0x24) != 6 {
		return
	}
	ui.mu.Lock()
	ui.liveBusy = true
	ui.mu.Unlock()
	procEnable.Call(ui.liveButton, 0)
	winSetText(ui.speedLine, "Скорость: идёт замер...")
	ctx, cancel := context.WithTimeout(ui.lifetimeCtx, 145*time.Second)
	go func() {
		defer cancel()
		defer func() { post(ui.hwnd, wmAppLive) }()
		m := &Manager{home: ui.home, runtimeRoot: filepath.Join(ui.home, "runtime"), output: uiWriter{ui}}
		audit := LiveAudit{SchemaVersion: "0.3.3", CheckedUTC: utc(), Mode: "MANUAL_ON_DEMAND", SpeedGrade: "NOT_MEASURED", BaselineState: "UNKNOWN", Caveat: liveAuditCaveat}
		var state VPNState
		if err := m.ensureRuntime(); err == nil {
			checkCtx, stop := context.WithTimeout(ctx, 10*time.Second)
			state, _ = m.vpnState(checkCtx)
			stop()
		}
		var before, after *AdapterStats
		if state.ActiveCount == 1 && state.AdapterName != "" {
			m.cfg.AdapterName = state.AdapterName
			before, _ = m.adapterStats(ctx)
		}
		view, _ := inspectPublicView(ctx, m)
		audit.EgressConsensus = view.Consensus
		audit.GeoMatched = view.GeoMatched
		audit.VPNRouteObserved = state.Checked && state.ActiveCount == 1 && state.AddressPresent && state.RoutePresent
		baselineFile := filepath.Join(ui.home, "private-direct-baseline.json")
		if guideCanMeasureDirectBaseline(state) && view.Consensus {
			saved := PrivateBaseline{IP: view.IP, CheckedUTC: time.Now().UTC(), State: "VPN_DOWN"}
			if err := saveJSON(baselineFile, saved); err == nil {
				audit.BaselineState = "DIRECT_BASELINE_CAPTURED"
			} else {
				audit.BaselineState = "BASELINE_SAVE_FAILED"
			}
		} else {
			var stored PrivateBaseline
			if b, err := os.ReadFile(baselineFile); err == nil && json.Unmarshal(b, &stored) == nil {
				audit.BaselineState = classifyBaseline(time.Now(), view.IP, stored, state)
			} else {
				audit.BaselineState = classifyBaseline(time.Now(), view.IP, PrivateBaseline{}, state)
			}
		}
		if ctx.Err() == nil {
			audit.Samples, audit.SpeedGrade, audit.MinMbps, audit.MedianMbps, audit.Successful = runSpeedSamples(ctx)
			audit.Total = 3
		}
		if before != nil && state.AdapterName != "" {
			after, _ = m.adapterStats(ctx)
			if after != nil {
				audit.AdapterFlowObserved = strings.EqualFold(after.Name, before.Name) && after.ReceivedBytes > before.ReceivedBytes && after.SentBytes > before.SentBytes
			}
		}
		_ = saveJSON(filepath.Join(ui.home, "results", "latest-speed.json"), audit)
		// Only this in-memory message contains the actual IP and approximate location.
		ui.mu.Lock()
		ui.liveView = view
		ui.liveAudit = audit
		ui.liveBusy = false
		ui.mu.Unlock()
	}()
}

func (ui *managerUI) applyLive() {
	ui.mu.Lock()
	view, audit := ui.liveView, ui.liveAudit
	ui.mu.Unlock()
	procEnable.Call(ui.liveButton, 1)
	age, _ := howOld(view.CheckedUTC, time.Now())
	if view.Consensus {
		winSetText(ui.publicLine, "Как видят HTTPS-сервисы ("+age+"), IPv4: "+view.IP+" (несколько источников)")
	} else {
		winSetText(ui.publicLine, "Внешний IPv4: НЕ ПОДТВЕРЖДЁН независимыми HTTPS-сервисами")
	}
	if view.GeoMatched {
		location := view.Country
		if view.Region != "" {
			location += " / " + view.Region
		}
		if view.City != "" {
			location += " / " + view.City
		}
		extra := ""
		if view.ASN != "" {
			extra = " · " + view.ASN
		}
		winSetText(ui.geoLine, "Предположительный регион IP ("+age+"): "+location+extra)
	} else {
		winSetText(ui.geoLine, "Регион IP: не подтверждён (геосервисы недоступны или вернули другой адрес)")
	}
	quality := "Скорость: НЕ ИЗМЕРЕНА"
	if audit.Successful >= 2 && audit.SpeedGrade != "SPEED_NOT_VERIFIED" {
		quality = "Скорость: минимум " + formatMbps(audit.MinMbps) + " Мбит/с, медиана " + formatMbps(audit.MedianMbps) + " Мбит/с; " + audit.SpeedGrade
	}
	winSetText(ui.speedLine, quality)
	comparison := "Сравнение IP: нет свежей контрольной пробы без VPN; утечки НЕ исключены"
	switch audit.BaselineState {
	case "DIRECT_BASELINE_CAPTURED":
		comparison = "Снята контрольная проба БЕЗ VPN. Подключите Amnezia и повторите замер"
	case "IP_UNCHANGED_POSSIBLE_DIRECT_EGRESS":
		comparison = "ВНИМАНИЕ: IP совпадает с адресом без VPN! Возможен прямой выход"
	case "IP_DIFFERENT_FROM_DIRECT_BASELINE":
		comparison = "IP отличается от исходного. Маршрут браузера ещё не доказан"
	case "STALE_DIRECT_BASELINE":
		comparison = "Исходный IP устарел. Нужна новая контрольная проба без VPN"
	case "VPN_ROUTE_UNVERIFIED":
		comparison = "VPN-маршрут не подтверждён. Скорость может быть обычным интернетом"
	case "LOCAL_PROXY_POSSIBLE_NOT_TESTED":
		comparison = "TUN не обнаружен, Amnezia запущена: возможен Local Proxy. Этот тест не проверял путь прокси или приложений"
	}
	winSetText(ui.riskLine, comparison)
	switch audit.BaselineState {
	case "DIRECT_BASELINE_CAPTURED":
		ui.write("Сохранён исходный IPv4 без активного VPN. Он останется только в приватной папке программы.\n")
	case "IP_UNCHANGED_POSSIBLE_DIRECT_EGRESS":
		ui.write("ВНИМАНИЕ: внешний IPv4 совпадает с исходным адресом БЕЗ VPN. Возможен прямой выход.\n")
	case "IP_DIFFERENT_FROM_DIRECT_BASELINE":
		ui.write("Внешний IPv4 отличается от недавно измеренного адреса без VPN. Но путь браузера и нативное рукопожатие не доказаны.\n")
	default:
		ui.write("Сравнение с выходом без VPN не подтверждено (" + audit.BaselineState + "). Не выдаю успешный HTTPS за доказательство VPN.\n")
	}
	if audit.SpeedGrade == "SPEED_NOT_VERIFIED" || audit.SpeedGrade == "NOT_MEASURED" {
		ui.write("Тест скорости не завершился. В latest-speed.json записаны причины по отдельным CDN, НЕ 0 Мбит/с.\n")
	}
	ui.write("Итог быстрого замера: " + audit.SpeedGrade + ". Отчёт latest-speed.json не содержит внешний IP, страну, имя оператора или адреса подключения.\n")
}
