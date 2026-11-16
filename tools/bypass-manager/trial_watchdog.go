package main

import (
	"context"
	"sync"
	"sync/atomic"
	"time"
)

// A pending human reconnection must not leave our WinDivert filter active
// forever. This watchdog is limited to the initial filtered trial: once the
// data path has been verified, long-running monitoring has its own lifecycle.
const trialFilterMaxWait = 90 * time.Second

type trialWatchdog struct {
	quit     chan struct{}
	finished chan struct{}
	once     sync.Once
	expired  atomic.Bool
}

func startTrialWatchdog(ctx context.Context, timeout time.Duration, stopOwned func()) *trialWatchdog {
	w := &trialWatchdog{quit: make(chan struct{}), finished: make(chan struct{})}
	go func() {
		defer close(w.finished)
		timer := time.NewTimer(timeout)
		defer timer.Stop()
		select {
		case <-w.quit:
			return
		case <-ctx.Done():
			w.expired.Store(true)
			stopOwned()
		case <-timer.C:
			w.expired.Store(true)
			stopOwned()
		}
	}()
	return w
}

func (w *trialWatchdog) Stop() {
	if w == nil {
		return
	}
	w.once.Do(func() { close(w.quit) })
	<-w.finished
}
func (w *trialWatchdog) Expired() bool { return w != nil && w.expired.Load() }
