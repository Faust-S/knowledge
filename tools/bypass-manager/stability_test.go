package main

import (
	"context"
	"testing"
	"time"
)

func TestStabilityScheduleCompletesAndInterrupts(t *testing.T) {
	n, full := runStabilitySchedule(context.Background(), 30*time.Millisecond, 8*time.Millisecond, func(i int) StabilitySample { return StabilitySample{ElapsedS: i, HTTPSComplete: true} }, func(StabilitySample) {})
	if !full || n < 2 {
		t.Fatalf("expected completed small run, n=%d full=%v", n, full)
	}
	ctx, cancel := context.WithCancel(context.Background())
	n, full = runStabilitySchedule(ctx, time.Second, time.Millisecond, func(i int) StabilitySample { return StabilitySample{} }, func(StabilitySample) { cancel() })
	if full || n != 1 {
		t.Fatalf("cancellation ignored %d %v", n, full)
	}
}
func TestStabilityAssessmentNeverPromisesVideoWithoutUser(t *testing.T) {
	r := StabilityReport{State: "COMPLETED", ElapsedS: 900, StartEgressConfirmed: true, EndEgressConfirmed: true}
	if assessStability(r) != "PLAYBACK_NOT_CONFIRMED_SMOOTH" {
		t.Fatal("false grade")
	}
	r.UserReportedPlayback = "NO_STALLS"
	r.RouteFailures = 1
	if assessStability(r) != "NETWORK_INTERRUPTION_SUSPECTED" {
		t.Fatal("route interrupted")
	}
	r.RouteFailures = 0
	if assessStability(r) != "USER_REPORTED_SMOOTH_PATH_OBSERVED" {
		t.Fatal("report observed outcome")
	}
	r.ElapsedS = 400
	if assessStability(r) != "NOT_COMPLETED" {
		t.Fatal("short session accepted")
	}
}
