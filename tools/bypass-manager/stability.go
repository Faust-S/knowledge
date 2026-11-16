package main

import (
	"context"
	"math"
	"time"
)

// A full test runs 15 minutes and samples small, explicit HTTPS payloads
// alongside video playback chosen by the user. The program cannot observe
// browser stalls, DRM sessions or the browser's actual route.
const stabilityDuration = 15 * time.Minute
const stabilityInterval = 30 * time.Second

type StabilitySample struct {
	UTC                 string  `json:"utc"`
	ElapsedS            int     `json:"elapsed_s"`
	VPNRouteObserved    bool    `json:"vpn_route_observed"`
	AdapterFlowObserved bool    `json:"adapter_flow_observed"`
	HTTPSComplete       bool    `json:"https_complete"`
	TransferBytes       int64   `json:"transfer_bytes"`
	TransferMbps        float64 `json:"transfer_mbps,omitempty"`
	MeaningfulBandwidth bool    `json:"meaningful_bandwidth"`
	Source              string  `json:"source"`
	FailureCode         string  `json:"failure_code,omitempty"`
}
type StabilityReport struct {
	SchemaVersion        string            `json:"schema_version"`
	StartedUTC           string            `json:"started_utc"`
	CompletedUTC         string            `json:"completed_utc,omitempty"`
	State                string            `json:"state"`
	ElapsedS             int               `json:"elapsed_s"`
	PlannedDurationS     int               `json:"planned_duration_s"`
	Samples              []StabilitySample `json:"samples"`
	HTTPSFailures        int               `json:"https_failures"`
	RouteFailures        int               `json:"route_failures"`
	SlowBandwidthSamples int               `json:"slow_bandwidth_samples"`
	UserReportedPlayback string            `json:"user_reported_playback"`
	StartEgressConfirmed bool              `json:"start_egress_confirmed"`
	EndEgressConfirmed   bool              `json:"end_egress_confirmed"`
	EgressChangedDuring  bool              `json:"egress_changed_during"`
	NetworkBefore        *NetworkHealth    `json:"network_before,omitempty"`
	NetworkAfter         *NetworkHealth    `json:"network_after,omitempty"`
	Findings             []NetworkFinding  `json:"findings,omitempty"`
	Caveat               string            `json:"caveat"`
}

const stabilityCaveat = "User-assisted 15 minute actual browser video playback. Browser video stalls are reported by the user, not automatically measured. HTTPS samples and adapter counters do not prove the browser used the tunnel. No raw IP, SSID, gateway, ISP or VPN secrets are exported."

// runStabilitySchedule is deterministic in tests with short intervals. The
// production 900 second run must not claim success when cancelled early.
func runStabilitySchedule(ctx context.Context, duration, interval time.Duration, poll func(int) StabilitySample, onSample func(StabilitySample)) (int, bool) {
	if duration <= 0 || interval <= 0 {
		return 0, false
	}
	start := time.Now()
	samples := 0
	for {
		remaining := duration - time.Since(start)
		if remaining <= 0 {
			return samples, true
		}
		wait := interval
		if wait > remaining {
			wait = remaining
		}
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			return samples, false
		case <-timer.C:
		}
		if time.Since(start) >= duration {
			return samples, true
		}
		sample := poll(samples + 1)
		if math.IsNaN(sample.TransferMbps) || math.IsInf(sample.TransferMbps, 0) || sample.TransferMbps < 0 {
			sample.TransferMbps = 0
			sample.MeaningfulBandwidth = false
		}
		samples++
		onSample(sample)
	}
}
func assessStability(r StabilityReport) string {
	if r.State != "COMPLETED" || r.ElapsedS < 840 {
		return "NOT_COMPLETED"
	}
	if r.UserReportedPlayback != "NO_STALLS" {
		return "PLAYBACK_NOT_CONFIRMED_SMOOTH"
	}
	if r.HTTPSFailures > 0 || r.RouteFailures > 0 {
		return "NETWORK_INTERRUPTION_SUSPECTED"
	}
	if !r.StartEgressConfirmed || !r.EndEgressConfirmed || r.EgressChangedDuring {
		return "VPN_PATH_NOT_CONFIRMED"
	}
	return "USER_REPORTED_SMOOTH_PATH_OBSERVED"
}
