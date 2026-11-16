package main

import (
	"encoding/json"
	"errors"
	"strings"
)

// VPNState contains read-only Windows interface and route observations.
// Adapter existence never proves a live VPN handshake or an internet route.
type VPNState struct {
	Checked        bool   `json:"checked"`
	AppRunning     bool   `json:"app_running"`
	CandidateCount int    `json:"candidate_count"`
	ActiveCount    int    `json:"active_count"`
	AdapterName    string `json:"adapter_name,omitempty"`
	AddressPresent bool   `json:"address_present"`
	RoutePresent   bool   `json:"route_present"`
}

func parseVPNState(b []byte) (VPNState, error) {
	var s VPNState
	if err := json.Unmarshal(b, &s); err != nil {
		return VPNState{}, err
	}
	if !s.Checked || s.CandidateCount < 0 || s.ActiveCount < 0 || s.ActiveCount > s.CandidateCount {
		return VPNState{}, errors.New("invalid VPN adapter snapshot")
	}
	if s.ActiveCount != 1 || strings.TrimSpace(s.AdapterName) == "" {
		s.AdapterName = ""
	}
	return s, nil
}

// Only a unique active adapter can populate the advanced field automatically.
// In all other cases the manager must never guess an interface or a UDP peer.
func detectedAdapter(s VPNState) (string, bool) {
	if !s.Checked || s.ActiveCount != 1 || s.AdapterName == "" {
		return "", false
	}
	return s.AdapterName, true
}

func vpnStateCode(s VPNState) string {
	if !s.Checked {
		return "UNKNOWN"
	}
	if s.ActiveCount == 0 {
		return "ADAPTER_NOT_ACTIVE"
	}
	if s.ActiveCount > 1 {
		return "AMBIGUOUS"
	}
	if s.RoutePresent && s.AddressPresent {
		return "ROUTE_OBSERVED"
	}
	return "ADAPTER_OBSERVED"
}
