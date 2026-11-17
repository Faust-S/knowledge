//go:build windows

package main

import (
	"context"
	"time"
)

func (m *Manager) probeAmneziaLocalProxy(ctx context.Context) LocalProxyEvidence {
	if err := m.ensureRuntime(); err != nil {
		return LocalProxyEvidence{State: "UNAVAILABLE"}
	}
	raw, err := m.powerShell(ctx, "Get-LocalProxyPorts.ps1")
	if err != nil {
		return LocalProxyEvidence{State: "UNAVAILABLE"}
	}
	capture, err := parseProxyPorts([]byte(raw))
	if err != nil {
		return LocalProxyEvidence{State: "UNAVAILABLE"}
	}
	if capture.Status != "CANDIDATES" {
		return LocalProxyEvidence{State: capture.Status}
	}
	probeCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	return probeProxyPorts(probeCtx, capture.Ports, egressURLs)
}
