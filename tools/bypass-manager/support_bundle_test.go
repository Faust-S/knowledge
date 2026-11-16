package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSupportBundleIncludesOnlyWhitelistedReports(t *testing.T) {
	dir := t.TempDir()
	guide := GuideReport{SchemaVersion: "0.3.2", State: "FAILED", AdviceCode: "NO_ROUTE"}
	live := LiveAudit{SchemaVersion: "0.3.3", EgressConsensus: true, SpeedGrade: "HD_720P_CANDIDATE", MedianMbps: 7}
	if err := saveJSON(filepath.Join(dir, "latest-guide.json"), guide); err != nil {
		t.Fatal(err)
	}
	if err := saveJSON(filepath.Join(dir, "latest-speed.json"), live); err != nil {
		t.Fatal(err)
	}
	if err := saveJSON(filepath.Join(dir, "settings.json"), map[string]string{"vpn_secret": "TOP_SECRET", "endpoint_ipv4": "9.9.9.9"}); err != nil {
		t.Fatal(err)
	}
	if err := saveJSON(filepath.Join(dir, "private-direct-baseline.json"), PrivateBaseline{IP: "9.9.9.9", State: "VPN_DOWN"}); err != nil {
		t.Fatal(err)
	}
	path, report, err := saveSupport(dir)
	if err != nil || report.Available != 2 {
		t.Fatalf("available %v %+v", err, report)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(data, []byte("TOP_SECRET")) || bytes.Contains(data, []byte("9.9.9.9")) || bytes.Contains(data, []byte("private-direct-baseline")) {
		t.Fatal("private data reached exported report")
	}
	var decoded SupportReport
	if err := json.Unmarshal(data, &decoded); err != nil || decoded.Live == nil || decoded.Guide == nil {
		t.Fatal("missing subreports")
	}
}
func TestStrictReportRejectsInjectedUserFields(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "latest-speed.json"), []byte(`{"schema_version":"0.3.3","speed_grade":"FAST","ip":"9.9.9.9"}`), 0600)
	report := buildSupportReport(dir, time.Now())
	if report.Available != 0 || report.Sources[3].Status != "INVALID_OR_OLD_SCHEMA" {
		t.Fatal("unknown identity field included")
	}
}
