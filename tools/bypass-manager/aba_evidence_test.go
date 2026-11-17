package main

import (
	"context"
	"testing"
	"time"
)

func validABAWithSpeed() *GuideReport {
	r := modelThroughput()
	f := &r.Rounds[1]
	f.PostOffAttempted = true
	f.PostOffStopped = true
	f.PostOffRoute = true
	f.PostOffAdapterFlow = true
	f.PostOffEgressMatch = true
	f.PostOffTransfers = modelFull("TEST_CDN_A", 2097152, 4)
	return r
}
func TestABASpeedReversalAndRecovery(t *testing.T) {
	r := validABAWithSpeed()
	got := assessDPIEffect(r)
	if got.State != "ABA_POSSIBLE_SPEED_REVERSAL" || got.PostOffMbps <= 0 {
		t.Fatalf("expected plausible reversal: %+v", got)
	}
	r.Rounds[1].PostOffTransfers = modelFull("TEST_CDN_A", 2097152, 12)
	if got = assessDPIEffect(r); got.State != "ABA_NOT_REPRODUCED" {
		t.Fatalf("independent recovery was mislabeled: %+v", got)
	}
	r.Rounds[1].PostOffTransfers = modelFull("TEST_CDN_B", 2097152, 4)
	if got = assessDPIEffect(r); got.State != "ABA_INCONCLUSIVE" {
		t.Fatal(got)
	}
	r.Rounds[1].PostOffTransfers = modelFull("TEST_CDN_A", 2097152, 4)[:1]
	if got = assessDPIEffect(r); got.State != "ABA_INCONCLUSIVE" {
		t.Fatal(got)
	}
	r.Rounds[1].PostOffTransfers = modelFull("TEST_CDN_A", 2097152, 4)
	r.Rounds[1].PostOffEgressMatch = false
	if got = assessDPIEffect(r); got.State != "ABA_INCONCLUSIVE" {
		t.Fatal(got)
	}
}
func TestABAAvailabilityReversalAndNoReproduction(t *testing.T) {
	r := modelAvailability()
	f := &r.Rounds[1]
	f.PostOffAttempted = true
	f.PostOffStopped = true
	f.PostOffRoute = true
	f.PostOffAdapterFlow = true
	f.PostOffEgressMatch = true
	f.PostOffTransfers = []GuideTransfer{
		{Source: "TEST_CDN_A", ExpectedBytes: 2097152, FailureCode: "TIMEOUT"},
		{Source: "TEST_CDN_A", ExpectedBytes: 2097152, FailureCode: "HTTP_403"},
	}
	if got := assessDPIEffect(r); got.State != "ABA_POSSIBLE_AVAILABILITY_REVERSAL" {
		t.Fatalf("not detected: %+v", got)
	}
	f.PostOffTransfers = modelFull("TEST_CDN_A", 2097152, 8)
	if got := assessDPIEffect(r); got.State != "ABA_NOT_REPRODUCED" {
		t.Fatalf("false DPI causality: %+v", got)
	}
	f.PostOffTransfers = modelFull("TEST_CDN_B", 2097152, 8)
	if got := assessDPIEffect(r); got.State != "ABA_INCONCLUSIVE" {
		t.Fatalf("different CDN: %+v", got)
	}
}
func TestABAThirdPhaseWaitsAndKeepsSameProvider(t *testing.T) {
	requested := []int{}
	fake := func(_ context.Context, n int64, p int) DownloadResult {
		if n != 2097152 {
			t.Fatalf("wrong size %d", n)
		}
		requested = append(requested, p)
		return DownloadResult{OK: true, ExpectedBytes: n, Bytes: n, DurationSeconds: 1, Mbps: 10}
	}
	noWait := func(context.Context, time.Duration) error { return nil }
	got := collectPostOffTransfers(context.Background(), 2097152, 1, fake, noWait)
	if len(got) != 2 || len(requested) != 2 || requested[0] != 1 || requested[1] != 1 || got[0].Source != "TEST_CDN_B" {
		t.Fatalf("wrong A prime control: %+v %v", got, requested)
	}
	if got := collectPostOffTransfers(context.Background(), 2097152, 3, fake, noWait); len(got) != 0 {
		t.Fatal(got)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got := collectPostOffTransfers(ctx, 2097152, 0, fake, noWait); len(got) != 0 {
		t.Fatal(got)
	}
}
