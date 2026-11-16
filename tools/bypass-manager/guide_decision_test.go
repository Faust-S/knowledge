package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestGuideDecisionFailClosedAndDoesNotDisruptUsableInternet(t *testing.T) {
	good := VideoAssessment{Grade: "HD_1080P_CANDIDATE", Successful: 4, Total: 4}
	cases := []struct {
		baseline, changed, flow bool
		want                    string
	}{
		{false, false, true, "VIDEO_CANDIDATE_EGRESS_UNVERIFIED"},
		{true, false, true, "VIDEO_USABLE_EGRESS_UNCHANGED"},
		{true, true, false, "WEB_USABLE_VPN_UNVERIFIED"},
		{true, true, true, "VIDEO_CANDIDATE_VPN_PATH_OBSERVED"},
	}
	for _, v := range cases {
		if got := guideOutcome(v.baseline, v.changed, v.flow, good); got != v.want {
			t.Errorf("got %s, want %s", got, v.want)
		}
	}
	if got := guideOutcome(true, true, true, VideoAssessment{Grade: "INCOMPLETE"}); got != "MEASUREMENT_INCOMPLETE" {
		t.Fatal(got)
	}
}
func TestDetailedGuideReportDoesNotExposeNetworkIdentifiers(t *testing.T) {
	eg := EgressResult{IP: "192.0.2.10", Samples: []EgressSample{{Provider: "https://sensitive.example/secret", IP: "192.0.2.10", Status: "OK", Milliseconds: 3}}}
	sample := DownloadResult{URL: "https://private.example/user", Error: "192.0.2.10 C:\\Users\\Person", ExpectedBytes: 2097152}
	report := GuideReport{SchemaVersion: "0.3.1", Rounds: []GuideRound{{Protocol: guideAWG, DPIProfile: "NONE", EgressSamples: guideIPObservations(eg), Transfers: []GuideTransfer{toGuideTransfer(sample, "TEST_CDN_A")}}}}
	raw, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"192.0.2.10", "private.example", "sensitive.example", "Person", "Users\\"} {
		if strings.Contains(string(raw), secret) {
			t.Fatalf("leaked %q in %s", secret, string(raw))
		}
	}
	if !strings.Contains(string(raw), "TEST_CDN_A") || !strings.Contains(string(raw), "IP_CHECK_1") {
		t.Fatal("missing reproducible source markers")
	}
}
