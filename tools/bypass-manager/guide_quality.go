package main

import (
	"context"
	"math"
	"sort"
	"time"
)

// The assisted path never invents a VPN endpoint or changes the VPN client.
// Adapter/route discovery is necessary but does not prove a VPN handshake.
func connectionGuideAction(s VPNState) string {
	if !s.Checked {
		return "DIAGNOSTICS_UNAVAILABLE"
	}
	if s.ActiveCount > 1 {
		return "MULTIPLE_ADAPTERS"
	}
	if s.ActiveCount == 1 && s.AddressPresent && s.RoutePresent && s.AdapterName != "" {
		return "MEASURE_CONNECTION"
	}
	if !s.AppRunning {
		return "OPEN_AMNEZIA"
	}
	return "CONNECT_AMNEZIA"
}

type VideoAssessment struct {
	Grade      string  `json:"grade"`
	MinMbps    float64 `json:"min_mbps,omitempty"`
	MedianMbps float64 `json:"median_mbps,omitempty"`
	Successful int     `json:"successful"`
	Total      int     `json:"total"`
}

// All full downloads must succeed. A short throughput test is evidence, not a
// guarantee of uninterrupted video, latency, packet loss or CDN availability.
func assessVideoDownloads(results []DownloadResult) VideoAssessment {
	out := VideoAssessment{Grade: "NOT_VERIFIED", Total: len(results)}
	if len(results) == 0 {
		return out
	}
	speeds := make([]float64, 0, len(results))
	for _, r := range results {
		if !r.OK || r.Bytes != r.ExpectedBytes || r.ExpectedBytes < 1048576 || r.DurationSeconds <= 0 ||
			math.IsNaN(r.Mbps) || math.IsInf(r.Mbps, 0) || r.Mbps <= 0 {
			out.Grade = "INCOMPLETE"
			return out
		}
		speeds = append(speeds, r.Mbps)
		out.Successful++
	}
	// Four independent transfers, including the last one, are required.
	// A cancelled or shortened test must not be graded as video-capable.
	if len(results) != 4 {
		out.Grade = "INCOMPLETE"
		return out
	}
	sort.Float64s(speeds)
	out.MinMbps = speeds[0]
	out.MedianMbps = speeds[len(speeds)/2]
	if out.MinMbps >= 8 {
		out.Grade = "HD_1080P_CANDIDATE"
	} else if out.MinMbps >= 4 {
		out.Grade = "HD_720P_CANDIDATE"
	} else {
		out.Grade = "SLOW_FOR_VIDEO"
	}
	return out
}

// Maximum 8 MiB of payload, four independent HTTPS requests. Never auto-test
// again after a failed download, and never run without explicit user consent.
func checkVideoQuality(ctx context.Context, fetch func(context.Context, int64) DownloadResult, pause func(context.Context, time.Duration) error) ([]DownloadResult, VideoAssessment) {
	const size int64 = 2 * 1024 * 1024
	results := make([]DownloadResult, 0, 4)
	for i := 0; i < 4; i++ {
		if ctx.Err() != nil {
			break
		}
		if i > 0 && pause(ctx, 2*time.Second) != nil {
			break
		}
		r := fetch(ctx, size)
		results = append(results, r)
		if !r.OK {
			break
		}
	}
	return results, assessVideoDownloads(results)
}

func waitGuide(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

type GuideReport struct {
	StartedUTC          string          `json:"started_utc"`
	CompletedUTC        string          `json:"completed_utc,omitempty"`
	State               string          `json:"state"`
	VPNRouteObserved    bool            `json:"vpn_route_observed"`
	EgressObserved      bool            `json:"egress_observed"`
	EgressChanged       bool            `json:"egress_changed"`
	AdapterFlowObserved bool            `json:"adapter_flow_observed"`
	Video               VideoAssessment `json:"video"`
	AdviceCode          string          `json:"advice_code"`
	// No IPs, adapter identifiers, secret configs or arbitrary error strings.
	Caveat string `json:"caveat"`
}
