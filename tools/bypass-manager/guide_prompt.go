package main

import (
	"context"
	"time"
)

type guidePromptResult uint8

const (
	guidePromptConfirmed guidePromptResult = iota
	guidePromptDeclined
	guidePromptCancelled
	guidePromptTimedOut
)

// An unresponsive human-action step must never hold a packet filter or GUI
// indefinitely. Context cancellation always takes priority if already set.
func waitGuideResponse(ctx context.Context, response <-chan bool, timeout time.Duration) guidePromptResult {
	if ctx.Err() != nil {
		return guidePromptCancelled
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return guidePromptCancelled
	case accepted := <-response:
		if ctx.Err() != nil {
			return guidePromptCancelled
		}
		if accepted {
			return guidePromptConfirmed
		}
		return guidePromptDeclined
	case <-timer.C:
		if ctx.Err() != nil {
			return guidePromptCancelled
		}
		return guidePromptTimedOut
	}
}
