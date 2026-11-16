//go:build windows

package main

import ("context"; "strings")
func (m *Manager) observeOuterEndpoint(ctx context.Context, protocol string) (OuterEndpoint, string) {
    out, err := m.powerShell(ctx, "Get-OuterEndpoint.ps1", "-Protocol", protocol)
    if err != nil { return OuterEndpoint{}, "PROBE_ERROR" }
    return parseOuterEndpointEvidence([]byte(strings.TrimSpace(out)), protocol)
}
