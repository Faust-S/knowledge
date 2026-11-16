//go:build !windows

package main

import "context"
func (m *Manager) observeOuterEndpoint(ctx context.Context, protocol string) (OuterEndpoint, string) {
    return OuterEndpoint{}, "PROBE_ERROR"
}
