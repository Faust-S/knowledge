package main

import "fmt"

// Evidence gate used by the live probe and independent synthetic tests.
// This proves an observed data path, NOT a native VPN handshake nor bypass.
func assessDataPath(p Probe, baseline EgressResult, expectedDownloads int) (bool, string) {
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
