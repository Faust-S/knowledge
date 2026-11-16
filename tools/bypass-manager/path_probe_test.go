package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPathEvidenceNeverAcceptsIdentifiers(t *testing.T) {
	good := PathEvidence{SchemaVersion: "0.3.3", Checked: true, Gateway: PingEvidence{Status: "OK", Attempted: 6, Replied: 6, MedianMs: 2}, Remote: PingEvidence{Status: "UNKNOWN"}, DF1200: "REPLIED", DF1400: "NO_REPLY"}
	b, _ := json.Marshal(good)
	if _, err := parsePathEvidence(b); err != nil {
		t.Fatal(err)
	}
	if _, err := parsePathEvidence([]byte(strings.TrimSuffix(string(b), "}") + `,"ssid":"private-name"}`)); err == nil {
		t.Fatal("unexpected network identifying field accepted")
	}
}
func TestPathFindingsRespectICMPLimits(t *testing.T) {
	p := PathEvidence{Checked: true, Gateway: PingEvidence{Status: "NO_REPLIES", Attempted: 6}, Remote: PingEvidence{Status: "NO_REPLIES", Attempted: 6}, DF1200: "NO_REPLY", DF1400: "NO_REPLY"}
	codes := assessPath(p)
	if len(codes) != 2 || codes[0].Code != "GATEWAY_ICMP_INCONCLUSIVE" {
		t.Fatalf("unexpected findings: %+v", codes)
	}
	p.Gateway = PingEvidence{Status: "PARTIAL", Attempted: 6, Replied: 4, MedianMs: 10, JitterMs: 60}
	codes = assessPath(p)
	if len(codes) < 3 {
		t.Fatal("expected packet replies and jitter warnings")
	}
}
