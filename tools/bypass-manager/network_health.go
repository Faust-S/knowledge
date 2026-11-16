package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

// NetworkHealth is a deliberately non-identifying, passive Windows network
// snapshot. No raw adapter names, MAC, SSID/BSSID, gateways, IPs, DNS servers,
// provider identifiers, proxy URLs, paths or error messages may enter this type.
// Zero values mean unknown unless the field explicitly defines otherwise.
// Counters are cumulative, so only differences between snapshots suggest changes.
type NetworkHealth struct {
	SchemaVersion     string `json:"schema_version"`
	Checked           bool   `json:"checked"`
	PhysicalActive    int    `json:"physical_active"`
	PhysicalAmbiguous bool   `json:"physical_ambiguous"`
	Medium            string `json:"medium"`
	LinkMbps          int    `json:"link_mbps"`
	WiFiSignalPct     int    `json:"wifi_signal_pct"` // -1 when unavailable
	PhysicalIPv4MTU   int    `json:"physical_ipv4_mtu"`
	PhysicalMetric    int    `json:"physical_metric"`
	ReceiveErrors     int64  `json:"receive_errors"`
	SendErrors        int64  `json:"send_errors"`
	ReceiveDiscards   int64  `json:"receive_discards"`
	SendDiscards      int64  `json:"send_discards"`
	VPNActive         int    `json:"vpn_active"`
	VPNIPv4MTU        int    `json:"vpn_ipv4_mtu"`
	VPNMetric         int    `json:"vpn_metric"`
	VPNFullRoute      bool   `json:"vpn_full_route"`
	ProxyEnabled      bool   `json:"proxy_enabled"`
}

type NetworkFinding struct {
	Code     string `json:"code"`
	Severity string `json:"severity"`
}

type NetworkAudit struct {
	SchemaVersion string           `json:"schema_version"`
	CompletedUTC  string           `json:"completed_utc"`
	State         string           `json:"state"`
	Snapshot      NetworkHealth    `json:"snapshot"`
	Findings      []NetworkFinding `json:"findings"`
	Caveat        string           `json:"caveat"`
}

const networkHealthCaveat = "Read-only local network inventory; no actual packet capture, ISP identification, VPN handshake or real-world DPI success. Counts are cumulative. No network settings changed."

func parseNetworkHealth(raw []byte) (NetworkHealth, error) {
	var s NetworkHealth
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields() // no unexpected raw identifying fields may slip into a report
	if err := d.Decode(&s); err != nil {
		return NetworkHealth{}, errors.New("invalid sanitized network inventory JSON")
	}
	var trailing any
	if err := d.Decode(&trailing); err != io.EOF {
		return NetworkHealth{}, errors.New("extra network inventory data")
	}
	if s.SchemaVersion != "0.3.2" || !s.Checked || s.PhysicalActive < 0 || s.PhysicalActive > 256 ||
		s.VPNActive < 0 || s.VPNActive > 256 || s.PhysicalMetric < 0 || s.VPNMetric < 0 ||
		s.LinkMbps < 0 || s.LinkMbps > 100000 || s.WiFiSignalPct < -1 || s.WiFiSignalPct > 100 ||
		s.ReceiveErrors < 0 || s.SendErrors < 0 || s.ReceiveDiscards < 0 || s.SendDiscards < 0 ||
		!validHealthMTU(s.PhysicalIPv4MTU) || !validHealthMTU(s.VPNIPv4MTU) {
		return NetworkHealth{}, errors.New("invalid network inventory values")
	}
	switch s.Medium {
	case "WIFI", "ETHERNET", "CELLULAR", "OTHER", "UNKNOWN":
	default:
		return NetworkHealth{}, errors.New("unexpected network medium")
	}
	if s.PhysicalAmbiguous && s.Medium != "UNKNOWN" {
		return NetworkHealth{}, errors.New("ambiguous physical interface")
	}
	return s, nil
}

func validHealthMTU(mtu int) bool { return mtu == 0 || (mtu >= 576 && mtu <= 65535) }

func addFinding(list []NetworkFinding, code, severity string) []NetworkFinding {
	return append(list, NetworkFinding{Code: code, Severity: severity})
}

// Findings are hypotheses to investigate, never diagnoses or instructions to
// disable firewall, antivirus, IPv6, VPN kill switch or routing safeguards.
func assessNetworkHealth(s NetworkHealth) []NetworkFinding {
	found := make([]NetworkFinding, 0, 8)
	if !s.Checked {
		return addFinding(found, "NETWORK_INVENTORY_UNAVAILABLE", "UNKNOWN")
	}
	if s.PhysicalActive == 0 {
		found = addFinding(found, "NO_ACTIVE_PHYSICAL_INTERFACE", "UNKNOWN")
	}
	if s.PhysicalAmbiguous {
		found = addFinding(found, "MULTIPLE_PHYSICAL_PATHS", "INFO")
	}
	if s.Medium == "WIFI" && s.WiFiSignalPct >= 0 && s.WiFiSignalPct < 50 {
		found = addFinding(found, "WIFI_SIGNAL_LOW", "POTENTIAL")
	}
	if s.LinkMbps > 0 && s.LinkMbps < 30 {
		found = addFinding(found, "LOW_LINK_CAPACITY", "POTENTIAL")
	}
	if s.VPNActive > 1 {
		found = addFinding(found, "MULTIPLE_TUNNEL_ADAPTERS", "POTENTIAL")
	}
	if s.VPNActive == 1 && !s.VPNFullRoute {
		found = addFinding(found, "VPN_FULL_ROUTE_NOT_OBSERVED", "UNKNOWN")
	}
	if s.ProxyEnabled {
		found = addFinding(found, "SYSTEM_PROXY_CONFIGURATION_PRESENT", "INFO")
	}
	if s.PhysicalIPv4MTU != 0 && s.VPNIPv4MTU > s.PhysicalIPv4MTU {
		found = addFinding(found, "VPN_MTU_EXCEEDS_LOCAL_LINK", "POTENTIAL")
	}
	if s.ReceiveErrors > 0 || s.SendErrors > 0 || s.ReceiveDiscards > 0 || s.SendDiscards > 0 {
		found = addFinding(found, "NONZERO_LIFETIME_PACKET_COUNTERS", "INFO")
	}
	return found
}

// Counter changes are only meaningful if the same physical category and link
// are observed. A driver reset or adapter switch must not be called packet loss.
func compareNetworkHealth(before, after NetworkHealth) []NetworkFinding {
	out := make([]NetworkFinding, 0, 2)
	if !before.Checked || !after.Checked || before.Medium == "UNKNOWN" || after.Medium != before.Medium ||
		before.PhysicalAmbiguous || after.PhysicalAmbiguous || before.PhysicalActive != 1 || after.PhysicalActive != 1 ||
		before.LinkMbps != after.LinkMbps {
		return out
	}
	if after.ReceiveErrors > before.ReceiveErrors || after.SendErrors > before.SendErrors {
		out = addFinding(out, "PHYSICAL_PACKET_ERRORS_INCREASED", "POTENTIAL")
	}
	if after.ReceiveDiscards > before.ReceiveDiscards || after.SendDiscards > before.SendDiscards {
		out = addFinding(out, "PHYSICAL_PACKET_DISCARDS_INCREASED", "POTENTIAL")
	}
	return out
}

// The user-facing text must be selected from fixed strings, not a PowerShell
// exception or an adapter name that can accidentally contain personal data.
func networkFindingText(code string) string {
	switch code {
	case "NETWORK_INVENTORY_UNAVAILABLE":
		return "Не удалось прочитать параметры сети Windows. Требуется отдельная проверка диагностических служб."
	case "NO_ACTIVE_PHYSICAL_INTERFACE":
		return "Основной физический интерфейс не определён. Возможно, используется виртуальный или нестандартный адаптер."
	case "MULTIPLE_PHYSICAL_PATHS":
		return "Обнаружено несколько возможных физических маршрутов. Для настройки нужен контроль активного подключения."
	case "WIFI_SIGNAL_LOW":
		return "Слабый Wi-Fi. Сравните с Ethernet или проверьте расстояние, помехи и диапазон роутера."
	case "LOW_LINK_CAPACITY":
		return "Низкая согласованная скорость локального линка. Проверьте кабель, порт или Wi-Fi перед изменением VPN."
	case "MULTIPLE_TUNNEL_ADAPTERS":
		return "Активно несколько виртуальных VPN-адаптеров. Проверьте конфликты маршрутов, ничего автоматически не отключая."
	case "VPN_FULL_ROUTE_NOT_OBSERVED":
		return "Полный IPv4-маршрут VPN не найден. Проверьте намеренный split tunneling и фактический путь трафика."
	case "SYSTEM_PROXY_CONFIGURATION_PRESENT":
		return "В Windows включён пользовательский прокси/PAC. Проверьте, не направляет ли он приложения мимо ожидаемого канала."
	case "VPN_MTU_EXCEEDS_LOCAL_LINK":
		return "MTU туннеля больше локального. Проверьте PMTU, не меняйте MTU вслепую."
	case "NONZERO_LIFETIME_PACKET_COUNTERS":
		return "Счётчики ошибок/отбросов не нулевые. Нужна проверка прироста во время нагрузки, а не вывод по абсолютному числу."
	case "PHYSICAL_PACKET_ERRORS_INCREASED":
		return "Во время измерения выросли счётчики ошибок физического адаптера. Проверьте драйвер, кабель и Wi-Fi."
	case "PHYSICAL_PACKET_DISCARDS_INCREASED":
		return "Во время измерения выросли отброшенные пакеты физического адаптера. Проверьте локальные перегрузки и драйвер."
	default:
		return "Требуется дополнительная проверка сети."
	}
}

func networkAuditSummary(a NetworkAudit) string {
	parts := make([]string, 0, len(a.Findings))
	for _, f := range a.Findings {
		parts = append(parts, f.Code)
	}
	if len(parts) == 0 {
		parts = append(parts, "NO_OBVIOUS_LOCAL_WARNING")
	}
	return fmt.Sprintf("Сеть: %s, физ. интерфейсов %d, тип %s, линк %d Мбит/с, Wi-Fi %d%%, VPN %d, MTU %d/%d. Проверки: %s",
		a.State, a.Snapshot.PhysicalActive, a.Snapshot.Medium, a.Snapshot.LinkMbps,
		a.Snapshot.WiFiSignalPct, a.Snapshot.VPNActive, a.Snapshot.PhysicalIPv4MTU, a.Snapshot.VPNIPv4MTU,
		strings.Join(parts, ", "))
}

// networkHealth runs an OS-owned, read-only script from the embedded bundle.
// Raw output or PowerShell stderr must never become a user-shareable report.
func (m *Manager) networkHealth(ctx context.Context) (NetworkHealth, error) {
	raw, err := m.powerShell(ctx, "Get-NetworkHealth.ps1")
	if err != nil {
		return NetworkHealth{}, errors.New("network inventory command unavailable")
	}
	return parseNetworkHealth([]byte(raw))
}
