package main

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestWatchdogRestoresOnTimeout(t *testing.T) {
	var count atomic.Int32
	w := startTrialWatchdog(context.Background(), 25*time.Millisecond, func() { count.Add(1) })
	<-w.finished
	if !w.Expired() || count.Load() != 1 {
		t.Fatalf("expected one timeout restoration; expired=%v count=%d", w.Expired(), count.Load())
	}
	w.Stop()
	w.Stop()
}
func TestWatchdogStopsAfterSuccess(t *testing.T) {
	var count atomic.Int32
	w := startTrialWatchdog(context.Background(), 40*time.Millisecond, func() { count.Add(1) })
	w.Stop()
	time.Sleep(65 * time.Millisecond)
	if w.Expired() || count.Load() != 0 {
		t.Fatalf("watchdog acted after success; count=%d", count.Load())
	}
}
func TestWatchdogRestoresOnCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var count atomic.Int32
	w := startTrialWatchdog(ctx, time.Minute, func() { count.Add(1) })
	cancel()
	w.Stop()
	if !w.Expired() || count.Load() != 1 {
		t.Fatal("cancelled trial left filter active")
	}
}
