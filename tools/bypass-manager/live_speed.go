package main

import (
	"context"
	"math"
	"sort"
	"time"
)

// LiveAudit is safe to share. NEVER add the observed IP, country, city, ISP,
// local interface name or the private baseline file to this JSON schema.
type LiveAudit struct {
	SchemaVersion       string          `json:"schema_version"`
	CheckedUTC          string          `json:"checked_utc"`
	Mode                string          `json:"mode"`
	EgressConsensus     bool            `json:"egress_consensus"`
	GeoMatched          bool            `json:"geo_matches_ip"`
	BaselineState       string          `json:"baseline_comparison"`
	VPNRouteObserved    bool            `json:"vpn_route_observed"`
	AdapterFlowObserved bool            `json:"adapter_flow_observed"`
	SpeedGrade          string          `json:"speed_grade"`
	MinMbps             float64         `json:"min_mbps"`
	MedianMbps          float64         `json:"median_mbps"`
	Successful          int             `json:"successful"`
	Total               int             `json:"total"`
	Samples             []GuideTransfer `json:"samples"`
	Caveat              string          `json:"caveat"`
}

const liveAuditCaveat = "Only program-origin HTTPS egress is observed, never the browser or a native VPN handshake. IP/geo are shown locally, not exported. VPN identity requires a fresh disconnected baseline and correct routing; short downloads cannot guarantee stable video."

func pickSampleSize(mbps float64) int64 {
	const MiB int64 = 1024 * 1024
	switch {
	case mbps >= 100:
		return 32 * MiB
	case mbps >= 35:
		return 16 * MiB
	case mbps >= 15:
		return 8 * MiB
	case mbps >= 5:
		return 4 * MiB
	default:
		return 2 * MiB
	}
}

func testSpeed(ctx context.Context, fetch func(context.Context, int64, int) DownloadResult) ([]GuideTransfer, string, float64, float64, int) {
	const MiB int64 = 1024 * 1024
	sizes := []int64{2 * MiB, 0, 0}
	raw := make([]GuideTransfer, 0, 6)
	speeds := make([]float64, 0, 3)
	for i := 0; i < len(sizes) && ctx.Err() == nil; i++ {
		size := sizes[i]
		first := fetch(ctx, size, 0)
		raw = append(raw, toGuideTransfer(first, "TEST_CDN_A"))
		if !first.OK && ctx.Err() == nil {
			first = fetch(ctx, size, 1)
			raw = append(raw, toGuideTransfer(first, "TEST_CDN_B"))
		}
		if !first.OK || first.Bytes != size || first.Mbps <= 0 || math.IsInf(first.Mbps, 0) || math.IsNaN(first.Mbps) {
			break
		}
		speeds = append(speeds, first.Mbps)
		if i == 0 {
			sizes[1] = pickSampleSize(first.Mbps)
			sizes[2] = sizes[1]
		}
	}
	if len(speeds) < 2 {
		return raw, "SPEED_NOT_VERIFIED", 0, 0, len(speeds)
	}
	sort.Float64s(speeds)
	min, median := speeds[0], speeds[len(speeds)/2]
	grade := "PARTIAL"
	if len(speeds) == 3 {
		switch {
		case min >= 8:
			grade = "HD_1080P_CANDIDATE"
		case min >= 4:
			grade = "HD_720P_CANDIDATE"
		default:
			grade = "SLOW_FOR_VIDEO"
		}
	}
	return raw, grade, min, median, len(speeds)
}

// Individual speed samples are intentionally bounded. Maximum expected total
// payload: 2 + 32 + 32 = 66 MiB, and every transfer has a timeout.
func runSpeedSamples(ctx context.Context) ([]GuideTransfer, string, float64, float64, int) {
	return testSpeed(ctx, guideVideoFetch)
}

// Compare only a recent baseline observed with the VPN interface DOWN.
// This comparison is informative; a new physical connection can invalidate it.
func classifyBaseline(now time.Time, ip string, baseline PrivateBaseline, vpn VPNState) string {
	if vpn.Checked && vpn.AppRunning && vpn.ActiveCount == 0 {
		// A client may be using Amnezia Premium Local Proxy while TUN is down.
		// This is not a verified direct baseline or a verified system VPN.
		return "LOCAL_PROXY_POSSIBLE_NOT_TESTED"
	}
	if !vpn.Checked || vpn.ActiveCount != 1 || !vpn.RoutePresent {
		return "VPN_ROUTE_UNVERIFIED"
	}
	if baseline.IP == "" || baseline.CheckedUTC.IsZero() || baseline.State != "VPN_DOWN" {
		return "NO_VERIFIED_DIRECT_BASELINE"
	}
	if now.Sub(baseline.CheckedUTC) < 0 || now.Sub(baseline.CheckedUTC) > 6*time.Hour {
		return "STALE_DIRECT_BASELINE"
	}
	if ip == "" {
		return "EGRESS_UNVERIFIED"
	}
	if baseline.IP == ip {
		return "IP_UNCHANGED_POSSIBLE_DIRECT_EGRESS"
	}
	return "IP_DIFFERENT_FROM_DIRECT_BASELINE"
}

type PrivateBaseline struct {
	IP         string    `json:"ip"`
	CheckedUTC time.Time `json:"checked_utc"`
	State      string    `json:"state"`
}
