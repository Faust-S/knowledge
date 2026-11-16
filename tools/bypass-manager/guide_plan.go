package main

import (
	"strings"
)

// The order is deterministic. Only the owner of Amnezia can change its
// protocol. Profile selection is automatic but may require a human reconnect.
const (
	guideAWG   = "AMNEZIAWG"
	guideVLESS = "VLESS"
)

type GuideVariant struct {
	Protocol         string `json:"protocol"`
	Profile          string `json:"dpi_profile"`
	RequiresEndpoint bool   `json:"requires_endpoint"`
}

func guidePlan() []GuideVariant {
	return []GuideVariant{
		{Protocol: guideAWG, Profile: "NONE"},
		{Protocol: guideAWG, Profile: "UDP-FAKE", RequiresEndpoint: true},
		{Protocol: guideAWG, Profile: "UDP-REPEAT", RequiresEndpoint: true},
		{Protocol: guideVLESS, Profile: "NONE"},
		{Protocol: guideVLESS, Profile: "TLS-SPLIT", RequiresEndpoint: true},
		{Protocol: guideVLESS, Profile: "TLS-DISORDER", RequiresEndpoint: true},
		{Protocol: guideVLESS, Profile: "TLS-FAKESEQ", RequiresEndpoint: true},
		{Protocol: guideVLESS, Profile: "TLS-FAKETTL", RequiresEndpoint: true},
	}
}

// A field from an old Amnezia session is NOT evidence for a current endpoint.
// It must match the selected transport and receive a separate human confirmation.
func guideEndpointApplicable(c Config, protocol string) bool {
	if !validIPv4(c.EndpointIPv4) || c.Port <= 0 || c.Port > 65535 {
		return false
	}
	switch protocol {
	case guideAWG:
		return c.Transport == "AWG-UDP"
	case guideVLESS:
		return c.Transport == "REALITY-TCP" || c.Transport == "XHTTP-TCP"
	}
	return false
}

// Only short, fixed codes enter a shareable report. Untrusted PowerShell/network
// diagnostics must not be included as arbitrary strings.
func guideErrorCode(err error) string {
	if err == nil {
		return "OK"
	}
	s := strings.ToLower(err.Error())
	switch {
	case strings.Contains(s, "deadline"), strings.Contains(s, "timeout"):
		return "TIMEOUT"
	case strings.Contains(s, "cancel"):
		return "CANCELLED"
	case strings.Contains(s, "network"), strings.Contains(s, "connection"), strings.Contains(s, "dial"):
		return "NETWORK_ERROR"
	case strings.Contains(s, "permission"), strings.Contains(s, "access is denied"):
		return "PERMISSION_ERROR"
	default:
		return "EXECUTION_ERROR_REDACTED"
	}
}

func nextGuideVariant(plan []GuideVariant, index int) (GuideVariant, bool) {
	if index < 0 || index >= len(plan) {
		return GuideVariant{}, false
	}
	return plan[index], true
}
