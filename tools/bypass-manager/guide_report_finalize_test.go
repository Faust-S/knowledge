package main

import "testing"

func TestFinalizeGuideReportAfterDeclinedStep(t *testing.T) {
	r := GuideReport{State: "IN_PROGRESS", Rounds: []GuideRound{{State: "FAILED", CompletedUTC: "old"}, {State: "NOT_VERIFIED"}}}
	finalizeGuideReport(&r, false, "final")
	if r.State != "GUIDE_INCOMPLETE" || r.AdviceCode != "GUIDE_INTERRUPTED_BEFORE_RESULT" || r.CompletedUTC != "final" {
		t.Fatalf("not finalized: %+v", r)
	}
	if r.Rounds[0].State != "FAILED" || r.Rounds[0].CompletedUTC != "old" {
		t.Fatal("must not overwrite completed evidence")
	}
	if r.Rounds[1].State != "INCONCLUSIVE" || r.Rounds[1].CompletedUTC != "final" || r.Rounds[1].FailureCode != "INTERRUPTED_BEFORE_RESULT" {
		t.Fatalf("unfinished round was not closed: %+v", r.Rounds[1])
	}
}

func TestFinalizeGuideReportOnStop(t *testing.T) {
	r := GuideReport{State: "IN_PROGRESS", Rounds: []GuideRound{{State: "NOT_VERIFIED"}}}
	finalizeGuideReport(&r, true, "end")
	if r.State != "CANCELLED" || r.AdviceCode != "USER_CANCELLED" || r.Rounds[0].State != "CANCELLED" {
		t.Fatalf("not cancelled cleanly: %+v", r)
	}
}

func TestFinalizeGuideReportPreservesTerminalOutcome(t *testing.T) {
	r := GuideReport{State: "DIAGNOSTIC_SERVICES_UNAVAILABLE", AdviceCode: "CHECK_REAL_VIDEO_MANUALLY", Rounds: []GuideRound{{State: "INCONCLUSIVE", CompletedUTC: "done"}}}
	finalizeGuideReport(&r, false, "end")
	if r.State != "DIAGNOSTIC_SERVICES_UNAVAILABLE" || r.AdviceCode != "CHECK_REAL_VIDEO_MANUALLY" || r.Rounds[0].State != "INCONCLUSIVE" {
		t.Fatalf("finalizer changed observed decision: %+v", r)
	}
}
