package main

import "testing"

func TestTuningPlanDoesNotApplyNetworkSettings(t *testing.T) {
	s := SupportReport{Network: &NetworkAudit{Snapshot: NetworkHealth{Medium: "WIFI", WiFiSignalPct: 23, VPNActive: 1, PhysicalIPv4MTU: 1300, VPNIPv4MTU: 1420}, Findings: []NetworkFinding{{Code: "PHYSICAL_PACKET_ERRORS_INCREASED"}}}, Live: &LiveAudit{EgressConsensus: true, BaselineState: "IP_UNCHANGED_POSSIBLE_DIRECT_EGRESS"}}
	plan := tuningSuggestions(s)
	if len(plan) < 4 {
		t.Fatalf("expected specific evidence-driven plan: %+v", plan)
	}
	for _, a := range plan {
		if a.AutoApplied || a.Rollback == "" || a.Compare == "" {
			t.Fatal("must be reversible proposal only")
		}
	}
}
