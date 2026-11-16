package main

import (
	"fmt"
	"net"
	"strings"
)

// Evidence gate used by the live probe and independent synthetic tests.
// This proves an observed data path, NOT a native VPN handshake nor bypass.
func assessDataPath(p Probe, baseline EgressResult, expectedDownloads int) (bool, string) {
	if !endpointRouteObserved(p.EndpointRoute) {
		return false, "маршрут к внешнему узлу VPN не подтверждён"
	}
	if p.RouteLoopSuspected {
		return false, "VPN endpoint routed through its own tunnel"
	}
	if !p.Egress.Agreement || !baseline.Agreement || p.Egress.IP == "" || p.Egress.IP == baseline.IP {
		return false, "выходной IP не подтверждён как отличный от исходного"
	}
	if !p.AdapterFlow {
		return false, "трафик Rx/Tx VPN-адаптера не подтверждён"
	}
	if expectedDownloads < 1 || len(p.Downloads) != expectedDownloads {
		return false, "недостаточно проверок передачи данных"
	}
	for _, d := range p.Downloads {
		if !d.OK || d.ExpectedBytes <= 0 || d.Bytes != d.ExpectedBytes {
			return false, "реальная загрузка HTTPS не подтверждена"
		}
	}
	return true, fmt.Sprintf("наблюдался путь данных: %d загрузок, изменение внешнего IP, движение счётчиков адаптера; native-handshake не проверен", expectedDownloads)
}

// An uncertain route may actually send the outer VPN packets back through
// the tunnel or a different interface. Never upgrade a partial observation
// to a verified path when Windows route lookup failed.
func endpointRouteObserved(r *EndpointRoute) bool {
	return r != nil && (r.Status == "" || r.Status == "ROUTE_FOUND") && strings.TrimSpace(r.Name) != "" && r.Index > 0 && strings.TrimSpace(r.Destination) != ""
}

func requiresDPIEngine(profile string) bool { return profile != "NONE" }

const maxMonitoringSamples = 512

// Preserve the most recent checks, not an unbounded per-session log. At 45s
// intervals this is ~6.4 hours of detailed evidence; never quadratic history.
func appendBoundedMonitoring(history []Probe, next Probe) []Probe {
	if len(history) < maxMonitoringSamples {
		return append(history, next)
	}
	// Avoid retaining backing arrays larger than the advertised limit.
	trimmed := make([]Probe, maxMonitoringSamples)
	copy(trimmed, history[len(history)-(maxMonitoringSamples-1):])
	trimmed[maxMonitoringSamples-1] = next
	return trimmed
}

// A global IPv6 address is only a candidate egress observation, never
// evidence of anonymity. Reject RFC 3849 documentation and local addresses.
func validIPv6(value string) bool {
	ip := net.ParseIP(value)
	if ip == nil || ip.To4() != nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLinkLocalUnicast() {
		return false
	}
	doc := net.ParseIP("2001:db8::")
	_, docNet, _ := net.ParseCIDR("2001:db8::/32")
	return !ip.Equal(doc) && !docNet.Contains(ip)
}

// This can identify an especially clear possible bypass: the same public
// IPv6 is observed both with VPN disconnected and with an IPv4 VPN data path.
// Different IPv6 egress (or no response) does NOT establish leak freedom.
func assessIPv6Exposure(before, after EgressResult) (bool, string) {
	if !before.Agreement || !validIPv6(before.IP) {
		return false, "IPv6 before VPN not confirmed; privacy unknown"
	}
	if !after.Agreement || !validIPv6(after.IP) {
		return false, "IPv6 after VPN not confirmed; privacy unknown"
	}
	if before.IP == after.IP {
		return true, "POSSIBLE_IPV6_BYPASS: same public IPv6 before/after VPN"
	}
	return false, "IPv6 egress changed; DNS/WebRTC/browser anonymity unverified"
}

func anyIPv6LeakSuspected(probes []Probe) bool {
	for _, p := range probes {
		if p.IPv6LeakSuspected {
			return true
		}
	}
	return false
}

// Injection points let tests prove that NONE never probes the file system or
// downloads the original engine, while real profiles always check it first.
func ensureEngineForProfile(profile string, available func() bool, install func() error) error {
	if !requiresDPIEngine(profile) {
		return nil
	}
	if available() {
		return nil
	}
	return install()
}

// A failed route lookup must halt the trial instead of falling through to a
// live DPI profile. This distinction was found in a real field report.
func routePreflightBlocked(p Probe) bool {
	return !endpointRouteObserved(p.EndpointRoute) || p.RouteLoopSuspected
}

func routePreflightReason(r *EndpointRoute) string {
	if r == nil {
		return "Windows не вернула сведения о маршруте к VPN-узлу; DPI не будет включён"
	}
	switch r.Status {
	case "NO_ROUTE":
		return "Windows не нашла маршрут к VPN-узлу: проверьте сеть, Kill Switch и фактический адрес сервера"
	case "LOOKUP_ERROR":
		return "Сбой чтения маршрутов Windows; DPI не будет включён до исправления диагностики"
	default:
		return "Не удалось подтвердить исходящий маршрут VPN-узла; DPI не будет включён"
	}
}
