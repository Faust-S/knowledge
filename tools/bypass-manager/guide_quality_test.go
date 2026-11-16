package main

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestConnectionGuideAction(t *testing.T) {
	cases := []struct {
		s    VPNState
		want string
	}{
		{VPNState{}, "DIAGNOSTICS_UNAVAILABLE"},
		{VPNState{Checked: true, AppRunning: false}, "OPEN_AMNEZIA"},
		{VPNState{Checked: true, AppRunning: true, ActiveCount: 0}, "CONNECT_AMNEZIA"},
		{VPNState{Checked: true, AppRunning: true, ActiveCount: 2}, "MULTIPLE_ADAPTERS"},
		{VPNState{Checked: true, AppRunning: true, ActiveCount: 1, AddressPresent: true, AdapterName: "A"}, "CONNECT_AMNEZIA"},
		{VPNState{Checked: true, AppRunning: true, ActiveCount: 1, AddressPresent: true, RoutePresent: true, AdapterName: "A"}, "MEASURE_CONNECTION"},
	}
	for _, c := range cases {
		if got := connectionGuideAction(c.s); got != c.want {
			t.Errorf("got %s, want %s", got, c.want)
		}
	}
}
func goodVideo(mbps float64) DownloadResult {
	return DownloadResult{OK: true, Bytes: 2 * 1024 * 1024, ExpectedBytes: 2 * 1024 * 1024, DurationSeconds: 1, Mbps: mbps}
}
func TestAssessVideoDownloads(t *testing.T) {
	tests := []struct {
		samples []DownloadResult
		want    string
	}{
		{nil, "NOT_VERIFIED"},
		{[]DownloadResult{goodVideo(10), goodVideo(12), goodVideo(8)}, "INCOMPLETE"},
		{[]DownloadResult{goodVideo(50)}, "INCOMPLETE"},
		{[]DownloadResult{goodVideo(12), goodVideo(8.1), goodVideo(15), goodVideo(11)}, "HD_1080P_CANDIDATE"},
		{[]DownloadResult{goodVideo(12), goodVideo(4.3), goodVideo(8), goodVideo(7)}, "HD_720P_CANDIDATE"},
		{[]DownloadResult{goodVideo(4), goodVideo(3.2), goodVideo(8), goodVideo(7)}, "SLOW_FOR_VIDEO"},
		{[]DownloadResult{goodVideo(8), {OK: true, Bytes: 100, ExpectedBytes: 2 * 1024 * 1024, DurationSeconds: 1, Mbps: 99}, goodVideo(15), goodVideo(9)}, "INCOMPLETE"},
	}
	for _, v := range tests {
		if got := assessVideoDownloads(v.samples).Grade; got != v.want {
			t.Errorf("got %s, want %s", got, v.want)
		}
	}
}
func TestVideoCheckStopsAfterFailedTransfer(t *testing.T) {
	calls := 0
	results, grade := checkVideoQuality(context.Background(), func(ctx context.Context, n int64) DownloadResult {
		calls++
		if calls == 2 {
			return DownloadResult{ExpectedBytes: n, Bytes: 0, OK: false}
		}
		return goodVideo(12)
	}, func(context.Context, time.Duration) error { return nil })
	if calls != 2 || len(results) != 2 || grade.Grade != "INCOMPLETE" {
		t.Fatalf("results=%d calls=%d grade=%s", len(results), calls, grade.Grade)
	}
}
func TestVideoCheckCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	calls := 0
	_, _ = checkVideoQuality(ctx, func(context.Context, int64) DownloadResult { calls++; return goodVideo(12) }, func(context.Context, time.Duration) error { cancel(); return errors.New("cancelled") })
	if calls != 1 {
		t.Fatalf("cancel after first sample: %d calls", calls)
	}
}
