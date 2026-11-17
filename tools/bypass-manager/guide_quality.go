package main

import (
	"context"
	"math"
	"sort"
	"strconv"
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

// All diagnostic fields are intentionally whitelist-only. Never copy URLs,
// IP addresses, adapter names, local paths, usernames or raw error text into
// a shareable guide report. Every decision can nevertheless be reconstructed.
type GuideEvent struct {
	UTC               string `json:"utc"`
	Protocol          string `json:"protocol,omitempty"`
	DPIProfile        string `json:"dpi_profile,omitempty"`
	Stage             string `json:"stage"`
	Code              string `json:"code"`
	SecondsSinceStart int64  `json:"elapsed_s"`
}

type GuideIPSample struct {
	Source     string `json:"source"`
	Status     string `json:"status"`
	DurationMs int64  `json:"duration_ms"`
}

type GuideTransfer struct {
	Timings       TransferTimings `json:"timings"`
	HTTPStatus    int             `json:"http_status,omitempty"`
	Source        string          `json:"source"`
	OK            bool            `json:"ok"`
	Bytes         int64           `json:"bytes"`
	ExpectedBytes int64           `json:"expected_bytes"`
	Seconds       float64         `json:"seconds"`
	Mbps          float64         `json:"mbps"`
	FailureCode   string          `json:"failure_code,omitempty"`
}

type GuideRound struct {
	PostOffAttempted    bool            `json:"post_off_attempted,omitempty"`
	PostOffStopped      bool            `json:"post_off_stopped,omitempty"`
	PostOffRoute        bool            `json:"post_off_route_observed,omitempty"`
	PostOffAdapterFlow  bool            `json:"post_off_adapter_flow_observed,omitempty"`
	PostOffEgressMatch  bool            `json:"post_off_egress_match,omitempty"`
	PostOffTransfers    []GuideTransfer `json:"post_off_transfers,omitempty"`
	PostOffCompletedUTC string          `json:"post_off_completed_utc,omitempty"`
	ProxyStatus         string          `json:"local_proxy_status,omitempty"`
	ProxySources        int             `json:"local_proxy_sources,omitempty"`
	Protocol            string          `json:"protocol"`
	DPIProfile          string          `json:"dpi_profile"`
	StartedUTC          string          `json:"started_utc"`
	CompletedUTC        string          `json:"completed_utc,omitempty"`
	State               string          `json:"state"`
	FailureCode         string          `json:"failure_code,omitempty"`
	RouteObserved       bool            `json:"route_observed"`
	AdapterFlow         bool            `json:"adapter_flow_observed"`
	EgressObserved      bool            `json:"egress_observed"`
	EgressChanged       bool            `json:"egress_changed"`
	BaselineKnown       bool            `json:"baseline_known"`
	EgressSamples       []GuideIPSample `json:"egress_sources,omitempty"`
	Video               VideoAssessment `json:"video"`
	Transfers           []GuideTransfer `json:"transfers,omitempty"`
}

type GuideMonitorSample struct {
	UTC                 string  `json:"utc"`
	Protocol            string  `json:"protocol"`
	DPIProfile          string  `json:"dpi_profile"`
	RouteObserved       bool    `json:"route_observed"`
	TransferOK          bool    `json:"transfer_ok"`
	TestSource          string  `json:"test_source"`
	Bytes               int64   `json:"bytes"`
	Mbps                float64 `json:"mbps"`
	ConsecutiveFailures int     `json:"consecutive_failures"`
}

type GuideNetworkDiagnostic struct {
	UTC        string           `json:"utc"`
	Phase      string           `json:"phase"`
	Protocol   string           `json:"protocol,omitempty"`
	DPIProfile string           `json:"dpi_profile,omitempty"`
	State      string           `json:"state"`
	Snapshot   *NetworkHealth   `json:"snapshot,omitempty"`
	Findings   []NetworkFinding `json:"findings,omitempty"`
}

type GuideReport struct {
	SchemaVersion       string                   `json:"schema_version"`
	NetworkDiagnostics  []GuideNetworkDiagnostic `json:"network_diagnostics,omitempty"`
	StartedUTC          string                   `json:"started_utc"`
	CompletedUTC        string                   `json:"completed_utc,omitempty"`
	State               string                   `json:"state"`
	VPNRouteObserved    bool                     `json:"vpn_route_observed"`
	EgressObserved      bool                     `json:"egress_observed"`
	EgressChanged       bool                     `json:"egress_changed"`
	AdapterFlowObserved bool                     `json:"adapter_flow_observed"`
	Video               VideoAssessment          `json:"video"`
	AdviceCode          string                   `json:"advice_code"`
	// User-selected protocol is not verified by the adapter name. Never claim
	// evidence of a native handshake without client-side proof.
	NativeHandshakeVerified bool                 `json:"native_handshake_verified"`
	PlannedVariants         int                  `json:"planned_variants"`
	Rounds                  []GuideRound         `json:"rounds"`
	Events                  []GuideEvent         `json:"events"`
	MonitorSamples          []GuideMonitorSample `json:"monitor_samples,omitempty"`
	Caveat                  string               `json:"caveat"`
}

func guideIPObservations(r EgressResult) []GuideIPSample {
	samples := make([]GuideIPSample, 0, len(r.Samples))
	for i, s := range r.Samples {
		// Use a stable ordinal rather than storing hostnames or IPs.
		samples = append(samples, GuideIPSample{Source: "IP_CHECK_" + strconv.Itoa(i+1), Status: normalizedIPStatus(s.Status), DurationMs: s.Milliseconds})
	}
	return samples
}

func normalizedIPStatus(s string) string {
	if s == "OK" {
		return "OK"
	}
	return "ERROR"
}

func guideTransfers(rs []DownloadResult) []GuideTransfer {
	transfers := make([]GuideTransfer, 0, len(rs))
	for _, r := range rs {
		code := ""
		if !r.OK {
			code = "HTTPS_TRANSFER_INCOMPLETE"
		}
		transfers = append(transfers, GuideTransfer{Source: "HTTPS_VIDEO_SAMPLE", OK: r.OK, Bytes: r.Bytes, ExpectedBytes: r.ExpectedBytes, Seconds: r.DurationSeconds, Mbps: r.Mbps, FailureCode: code})
	}
	return transfers
}
