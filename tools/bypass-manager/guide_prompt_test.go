package main

import (
	"context"
	"testing"
	"time"
)

func TestWaitGuideResponse(t *testing.T) {
	tests := []struct {
		name string
		response chan bool
		cancelled bool
		timeout time.Duration
		want guidePromptResult
	}{
		{"approved", func() chan bool { c := make(chan bool, 1); c <- true; return c }(), false, time.Second, guidePromptConfirmed},
		{"declined", func() chan bool { c := make(chan bool, 1); c <- false; return c }(), false, time.Second, guidePromptDeclined},
		{"timeout", make(chan bool), false, 5*time.Millisecond, guidePromptTimedOut},
		{"stopped", make(chan bool), true, time.Second, guidePromptCancelled},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if tc.cancelled {
				cancel()
			}
			if got := waitGuideResponse(ctx, tc.response, tc.timeout); got != tc.want {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestWaitGuideResponseStopWhileWaiting(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	response := make(chan bool)
	done := make(chan guidePromptResult, 1)
	go func() { done <- waitGuideResponse(ctx, response, time.Minute) }()
	cancel()
	select {
	case got := <-done:
		if got != guidePromptCancelled {
			t.Fatalf("got %v, want cancellation", got)
		}
	case <-time.After(time.Second):
		t.Fatal("stop did not release a pending confirmation")
	}
}
