//go:build !windows

package main

import "context"

func (m *Manager) probeAmneziaLocalProxy(ctx context.Context) LocalProxyEvidence {
	return LocalProxyEvidence{State: "UNAVAILABLE"}
}
