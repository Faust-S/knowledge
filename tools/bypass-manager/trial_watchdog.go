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
	quit        chan struct{}
	finished    chan struct{}
	once        sync.Once
	restoreOnce sync.Once
	expired     atomic.Bool
	ctx         context.Context
	stopOwned   func()
}

func startTrialWatchdog(ctx context.Context, timeout time.Duration, stopOwned func()) *trialWatchdog {
	w := &trialWatchdog{quit: make(chan struct{}), finished: make(chan struct{}), ctx: ctx, stopOwned: stopOwned}
	go func() {
		defer close(w.finished)
		timer := time.NewTimer(timeout)
		defer timer.Stop()
		select {
		case <-w.quit:
			if ctx.Err() != nil {
				w.restoreOwned()
			}
			return
		case <-ctx.Done():
			w.restoreOwned()
		case <-timer.C:
			w.restoreOwned()
		}
	}()
	return w
}

func (w *trialWatchdog) restoreOwned() {
	w.restoreOnce.Do(func() {
		w.expired.Store(true)
		w.stopOwned()
	})
}

func (w *trialWatchdog) Stop() {
	if w == nil {
		return
	}
	w.once.Do(func() { close(w.quit) })
	<-w.finished
	// Closing quit can race with ctx cancellation. A cancelled trial must
	// always restore its owned filter even if the quit case won the select.
	if w.ctx.Err() != nil {
		w.restoreOwned()
	}
}
func (w *trialWatchdog) Expired() bool { return w != nil && w.expired.Load() }
