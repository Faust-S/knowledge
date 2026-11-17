package main

import (
	"context"
	"fmt"
	"sort"
	"time"
)

// A/B/A is a local correlation test: A (before), B (owned DPI), A' (after
// stopping only our DPI). Even a consistent reversal cannot prove a network
// operator or third-party CDN didn't change state independently.
func classifyABARollback(control, filtered GuideRound, candidate DPIEffect, sourceKey string) DPIEffect {
	if !filtered.PostOffAttempted {
		return candidate
	} // legacy A/B evidence
	if !filtered.PostOffStopped || !filtered.PostOffRoute || !filtered.PostOffAdapterFlow || !filtered.PostOffEgressMatch {
		candidate.State = "ABA_INCONCLUSIVE"
		return candidate
	}
	if candidate.State == "POSSIBLE_IMPROVEMENT" || candidate.State == "POSSIBLE_REGRESSION" || candidate.State == "NO_CLEAR_GAIN" {
		speeds := guideRoundSpeeds(GuideRound{Transfers: filtered.PostOffTransfers})[sourceKey]
		if len(speeds) < 2 {
			candidate.State = "ABA_INCONCLUSIVE"
			return candidate
		}
		sort.Float64s(speeds)
		post := speeds[len(speeds)/2]
		candidate.PostOffMbps = post
		switch {
		case candidate.State == "POSSIBLE_IMPROVEMENT" && post <= candidate.ControlMbps*1.2 && post <= candidate.ProfileMbps*0.8:
			candidate.State = "ABA_POSSIBLE_SPEED_REVERSAL"
		case candidate.State == "POSSIBLE_IMPROVEMENT" && post >= candidate.ProfileMbps*0.9:
			candidate.State = "ABA_NOT_REPRODUCED"
		case candidate.State == "POSSIBLE_REGRESSION" && post >= candidate.ControlMbps*0.8 && post >= candidate.ProfileMbps*1.2:
			candidate.State = "ABA_POSSIBLE_SPEED_REVERSAL"
		default:
			candidate.State = "ABA_INCONCLUSIVE"
		}
		return candidate
	}
	if candidate.State == "POSSIBLE_AVAILABILITY_IMPROVEMENT" {
		// A' must fail twice at the SAME CDN and byte count that B completed.
		// A' completing twice means the CDN also works after DPI was removed,
		// strongly undermining the claimed need for DPI.
		type key struct {
			source string
			bytes  int64
		}
		failed := map[key]int{}
		success := map[key]int{}
		for _, s := range filtered.PostOffTransfers {
			if s.Source == "" || s.ExpectedBytes < 1048576 {
				continue
			}
			k := key{s.Source, s.ExpectedBytes}
			if !s.OK && s.FailureCode != "" {
				failed[k]++
			}
			if s.OK && s.Bytes == s.ExpectedBytes && s.Seconds > 0 {
				success[k]++
			}
		}
		for _, a := range control.Transfers {
			if a.OK || a.Source == "" || a.FailureCode == "" || a.ExpectedBytes < 1048576 {
				continue
			}
			k := key{a.Source, a.ExpectedBytes}
			bCount := 0
			for _, b := range filtered.Transfers {
				if b.Source == k.source && b.ExpectedBytes == k.bytes && b.OK && b.Bytes == b.ExpectedBytes && b.Seconds > 0 {
					bCount++
				}
			}
			if bCount < 2 {
				continue
			}
			if failed[k] >= 2 {
				candidate.State = "ABA_POSSIBLE_AVAILABILITY_REVERSAL"
				return candidate
			}
			if success[k] >= 2 {
				candidate.State = "ABA_NOT_REPRODUCED"
				return candidate
			}
		}
		candidate.State = "ABA_INCONCLUSIVE"
	}
	return candidate
}

func guideSpeedKey(source string, size int64) string { return fmt.Sprintf("%s/%d", source, size) }

// Only the same 2 MiB payload from the same provider is useful as A'.
// Cancellation cannot leave the program retrying a CDN in the background.
func collectPostOffTransfers(ctx context.Context, size int64, provider int,
	fetch func(context.Context, int64, int) DownloadResult,
	pause func(context.Context, time.Duration) error) []GuideTransfer {
	if size != 2*1024*1024 || (provider != 0 && provider != 1) {
		return nil
	}
	source := "TEST_CDN_A"
	if provider == 1 {
		source = "TEST_CDN_B"
	}
	result := make([]GuideTransfer, 0, 2)
	for i := 0; i < 2 && ctx.Err() == nil; i++ {
		if i > 0 && pause(ctx, 2*time.Second) != nil {
			break
		}
		r := fetch(ctx, size, provider)
		result = append(result, toGuideTransfer(r, source))
	}
	return result
}
