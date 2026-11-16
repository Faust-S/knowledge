package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
)

type PingEvidence struct {
	Status    string  `json:"status"`
	Attempted int     `json:"attempted"`
	Replied   int     `json:"replied"`
	MedianMs  float64 `json:"median_ms"`
	P95Ms     float64 `json:"p95_ms"`
	JitterMs  float64 `json:"jitter_ms"`
}
type PathEvidence struct {
	SchemaVersion string       `json:"schema_version"`
	Checked       bool         `json:"checked"`
	Gateway       PingEvidence `json:"gateway"`
	Remote        PingEvidence `json:"remote"`
	DF1200        string       `json:"df_1200"`
	DF1400        string       `json:"df_1400"`
}
type PathReport struct {
	SchemaVersion string           `json:"schema_version"`
	CheckedUTC    string           `json:"checked_utc"`
	State         string           `json:"state"`
	Path          PathEvidence     `json:"path"`
	Findings      []NetworkFinding `json:"findings"`
	Caveat        string           `json:"caveat"`
}

const pathCaveat = "ICMP replies are optional and can be filtered by a router or VPN. No return is UNKNOWN, not packet loss proof or an MTU diagnosis. The remote check follows current Windows routes, which may include a VPN. No settings changed."

func validPingEvidence(p PingEvidence) bool {
	if p.Attempted < 0 || p.Attempted > 20 || p.Replied < 0 || p.Replied > p.Attempted {
		return false
	}
	if p.Status != "OK" && p.Status != "PARTIAL" && p.Status != "NO_REPLIES" && p.Status != "UNKNOWN" {
		return false
	}
	for _, v := range []float64{p.MedianMs, p.P95Ms, p.JitterMs} {
		if v < 0 || v > 50000 || math.IsNaN(v) || math.IsInf(v, 0) {
			return false
		}
	}
	if p.Replied == 0 && (p.MedianMs != 0 || p.P95Ms != 0 || p.JitterMs != 0) {
		return false
	}
	return true
}
func parsePathEvidence(raw []byte) (PathEvidence, error) {
	var v PathEvidence
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&v); err != nil {
		return PathEvidence{}, errors.New("invalid sanitized path report")
	}
	var trailing any
	if err := d.Decode(&trailing); err != io.EOF {
		return PathEvidence{}, errors.New("unexpected trailing path data")
	}
	if !v.Checked || v.SchemaVersion != "0.3.3" || !validPingEvidence(v.Gateway) || !validPingEvidence(v.Remote) {
		return PathEvidence{}, errors.New("invalid path sample")
	}
	for _, p := range []string{v.DF1200, v.DF1400} {
		if p != "REPLIED" && p != "NO_REPLY" && p != "UNKNOWN" {
			return PathEvidence{}, errors.New("invalid DF outcome")
		}
	}
	return v, nil
}
func assessPath(v PathEvidence) []NetworkFinding {
	out := []NetworkFinding{}
	if !v.Checked {
		return addFinding(out, "PATH_PROBE_UNAVAILABLE", "UNKNOWN")
	}
	if v.Gateway.Replied == 0 {
		out = addFinding(out, "GATEWAY_ICMP_INCONCLUSIVE", "UNKNOWN")
	}
	if v.Gateway.Replied > 0 && v.Gateway.Replied < v.Gateway.Attempted {
		out = addFinding(out, "GATEWAY_REPLY_LOSS", "POTENTIAL")
	}
	if v.Gateway.JitterMs >= 30 {
		out = addFinding(out, "LOCAL_LATENCY_VARIATION", "POTENTIAL")
	}
	if v.Remote.Replied == 0 {
		out = addFinding(out, "REMOTE_ICMP_INCONCLUSIVE", "UNKNOWN")
	}
	if v.Remote.Replied > 0 && v.Remote.Replied < v.Remote.Attempted {
		out = addFinding(out, "REMOTE_REPLY_LOSS", "POTENTIAL")
	}
	if v.Remote.JitterMs >= 75 {
		out = addFinding(out, "REMOTE_LATENCY_VARIATION", "POTENTIAL")
	}
	if v.DF1200 == "REPLIED" && v.DF1400 == "NO_REPLY" {
		out = addFinding(out, "DF_LARGE_ECHO_INCONCLUSIVE", "UNKNOWN")
	}
	return out
}
