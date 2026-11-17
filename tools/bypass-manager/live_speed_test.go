package main

import (
	"context"
	"testing"
	"time"
)

func TestAdaptiveSpeedSizesAndFallBack(t *testing.T) {
	sizes := []int64{}
	trials := 0
	samples, grade, min, median, good := testSpeed(context.Background(), func(_ context.Context, n int64, provider int) DownloadResult {
		sizes = append(sizes, n)
		trials++
		if trials == 3 && provider == 0 {
			return DownloadResult{ExpectedBytes: n, Error: "HTTP 429"}
		}
		return DownloadResult{OK: true, ExpectedBytes: n, Bytes: n, Mbps: 60, DurationSeconds: 1}
	})
	if len(sizes) != 4 || sizes[0] != 2*1024*1024 || sizes[1] != 16*1024*1024 || sizes[2] != 16*1024*1024 || sizes[3] != 16*1024*1024 {
		t.Fatalf("sizes %v", sizes)
	}
	if grade != "HD_1080P_CANDIDATE" || min != 60 || median != 60 || good != 3 || len(samples) != 4 {
		t.Fatalf("result %v %v %v %v", grade, min, good, len(samples))
	}
}
func TestSpeedFailureNotZeroSpeed(t *testing.T) {
	samples, grade, minimum, _, ok := testSpeed(context.Background(), func(_ context.Context, n int64, p int) DownloadResult {
		return DownloadResult{ExpectedBytes: n, Error: "timeout"}
	})
	if grade != "SPEED_NOT_VERIFIED" || ok != 0 || minimum != 0 || len(samples) != 2 {
		t.Fatal("failed endpoint must be inconclusive")
	}
}
func TestBaselineRequiresDownSnapshotAndRecentComparison(t *testing.T) {
	now := time.Now()
	connected := VPNState{Checked: true, ActiveCount: 1, RoutePresent: true}
	b := PrivateBaseline{IP: "9.9.9.9", CheckedUTC: now, State: "VPN_DOWN"}
	if classifyBaseline(now, "9.9.9.9", b, connected) != "IP_UNCHANGED_POSSIBLE_DIRECT_EGRESS" {
		t.Fatal("same IP")
	}
	if classifyBaseline(now, "1.1.1.1", b, connected) != "IP_DIFFERENT_FROM_DIRECT_BASELINE" {
		t.Fatal("different")
	}
	if classifyBaseline(now.Add(7*time.Hour), "1.1.1.1", b, connected) != "STALE_DIRECT_BASELINE" {
		t.Fatal("expired")
	}
	if classifyBaseline(now, "1.1.1.1", b, VPNState{Checked: true, ActiveCount: 0}) != "VPN_ROUTE_UNVERIFIED" {
		t.Fatal("no VPN route")
	}
}

func TestLiveSpeedDoesNotTreatLocalProxyAsDisconnectedDirectBaseline(t *testing.T) {
	now := time.Now()
	s := VPNState{Checked: true, AppRunning: true, ActiveCount: 0}
	if guideCanMeasureDirectBaseline(s) {
		t.Fatal("client-running no TUN classified as disconnected")
	}
	if got := classifyBaseline(now, "9.9.9.9", PrivateBaseline{}, s); got != "LOCAL_PROXY_POSSIBLE_NOT_TESTED" {
		t.Fatal(got)
	}
}
