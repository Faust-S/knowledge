package main

import (
    "bytes"
    "encoding/json"
    "io"
)

// This evidence never enters latest-guide.json, settings.json or
// latest-support.json. An observed process transport is not a VPN handshake.
type OuterEndpoint struct {
    SchemaVersion string `json:"schema_version"`
    Status string `json:"status"`
    Protocol string `json:"protocol"`
    IPv4 string `json:"ipv4"`
    Port int `json:"port"`
    Transport string `json:"transport"`
    Source string `json:"source"`
    PhysicalRoute bool `json:"physical_route_confirmed"`
    Signals int `json:"matching_signals"`
    AgeSeconds int `json:"observation_age_s"`
}
func parseOuterEndpointEvidence(raw []byte, protocol string) (OuterEndpoint, string) {
    if len(raw) == 0 || len(raw) > 4096 { return OuterEndpoint{}, "EVIDENCE_INVALID" }
    var s OuterEndpoint
    dec := json.NewDecoder(bytes.NewReader(raw))
    dec.DisallowUnknownFields()
    if dec.Decode(&s) != nil || dec.Decode(new(any)) != io.EOF ||
        s.SchemaVersion != "0.3.5" || s.Protocol != protocol {
        return OuterEndpoint{}, "EVIDENCE_INVALID"
    }
    if s.Status != "OBSERVED" {
        switch s.Status {
        case "NO_TRUSTED_PROCESS", "NO_OUTER_TRANSPORT", "AMBIGUOUS", "INSUFFICIENT_SIGNALS", "PROBE_ERROR":
            return OuterEndpoint{}, s.Status
        }
        return OuterEndpoint{}, "EVIDENCE_INVALID"
    }
    minSignals := 2
    if protocol == guideAWG && s.Source == "AWG_NATIVE" { minSignals = 1 }
    if !validIPv4(s.IPv4) || s.Port < 1 || s.Port > 65535 || !s.PhysicalRoute ||
        s.Signals < minSignals || s.Signals > 600 || s.AgeSeconds < 0 || s.AgeSeconds > 90 {
        return OuterEndpoint{}, "EVIDENCE_INVALID"
    }
    switch protocol {
    case guideAWG:
        if s.Transport != "AWG-UDP" || (s.Source != "WFP_UDP" && s.Source != "AWG_NATIVE") { return OuterEndpoint{}, "EVIDENCE_INVALID" }
    case guideVLESS:
        if s.Transport != "REALITY-TCP" || (s.Source != "XRAY_TCP" && s.Source != "WFP_TCP") {
            return OuterEndpoint{}, "EVIDENCE_INVALID"
        }
    default:
        return OuterEndpoint{}, "EVIDENCE_INVALID"
    }
    return s, "OBSERVED"
}
func automaticEndpointCode(code string) string {
    switch code {
    case "OBSERVED": return "AUTO_ENDPOINT_OS_TRANSPORT_OBSERVED"
    case "NO_TRUSTED_PROCESS": return "AUTO_NO_TRUSTED_VPN_PROCESS"
    case "NO_OUTER_TRANSPORT": return "AUTO_REMOTE_TRANSPORT_UNAVAILABLE"
    case "AMBIGUOUS": return "AUTO_MULTIPLE_OUTER_CANDIDATES"
    case "INSUFFICIENT_SIGNALS": return "AUTO_INSUFFICIENT_NETWORK_EVIDENCE"
    default: return "AUTO_ENDPOINT_UNVERIFIED"
    }
}

func sameOuterEndpoint(original, current OuterEndpoint) bool {
    return original.Status == "OBSERVED" && current.Status == "OBSERVED" &&
        original.Protocol == current.Protocol &&
        original.IPv4 != "" && original.IPv4 == current.IPv4 &&
        original.Port > 0 && original.Port == current.Port &&
        original.Transport == current.Transport && current.PhysicalRoute
}
