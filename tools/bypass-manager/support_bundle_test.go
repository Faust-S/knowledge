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

func TestSupportBundleAppsAndMTUAvoidProcessIdentity(t *testing.T) {
	dir := t.TempDir()
	app := AppAudit{SchemaVersion: "0.3.4", State: "OBSERVED_NOT_VERIFIED", ProcessCount: 3, PhysicalBound: 2, Findings: []string{"PHYSICAL_BINDING_OBSERVED"}, Caveat: appAuditCaveat}
	mtu := MTUTrialReport{SchemaVersion: "0.3.4", State: "NO_REPRODUCIBLE_GAIN_REVERTED", BeforeMTU: 1500, TrialMTU: 1420, RollbackStatus: "RESTORED", Caveat: mtuTrialCaveat}
	if err := saveJSON(filepath.Join(dir, "latest-apps.json"), app); err != nil {
		t.Fatal(err)
	}
	if err := saveJSON(filepath.Join(dir, "latest-mtu-trial.json"), mtu); err != nil {
		t.Fatal(err)
	}
	if err := saveJSON(filepath.Join(dir, "app-details-local.json"), map[string]string{"process": "veryPrivateApp.exe", "endpoint": "9.9.9.9"}); err != nil {
		t.Fatal(err)
	}
	_, got, err := saveSupport(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got.Apps == nil || got.MTU == nil || got.Available != 2 {
		t.Fatalf("subreports missing %+v", got)
	}
	blob, _ := json.Marshal(got)
	if bytes.Contains(blob, []byte("veryPrivateApp")) || bytes.Contains(blob, []byte("9.9.9.9")) {
		t.Fatal("privacy boundary breached")
	}
	// Unknown fields in the shareable app schema are rejected, including the local process name.
	os.WriteFile(filepath.Join(dir, "latest-apps.json"), []byte(`{"schema_version":"0.3.4","process_count":1,"name":"AliceApp"}`), 0600)
	got = buildSupportReport(dir, time.Now())
	if got.Apps != nil {
		t.Fatal("raw local process name accepted by exported report")
	}
}

func TestSupportBundleClearlyMarksOldEvidenceAndEffect(t *testing.T) {
 dir:=t.TempDir()
 now:=time.Date(2026,11,17,15,0,0,0,time.UTC)
 report:=GuideReport{SchemaVersion:"0.3.2",State:"DIAGNOSTIC_SERVICES_UNAVAILABLE",CompletedUTC:now.Add(-time.Hour).Format(time.RFC3339),Rounds:[]GuideRound{{Protocol:guideAWG,DPIProfile:"NONE",State:"INCONCLUSIVE"}}}
 file:=filepath.Join(dir,"latest-guide.json")
 if err:=saveJSON(file,report);err!=nil {t.Fatal(err)}
 earlier:=now.Add(-time.Hour)
 if err:=os.Chtimes(file,earlier,earlier);err!=nil {t.Fatal(err)}
 out:=buildSupportReport(dir,now)
 if out.Summary!="HISTORICAL_ONLY" || out.Sources[0].Status!="STALE_INCLUDED" || out.Effect==nil || out.Effect.State!="NOT_TESTED" {t.Fatalf("wrong freshness/effect: %+v",out)}
 if err:=os.Chtimes(file,now,now);err!=nil {t.Fatal(err)}
 out=buildSupportReport(dir,now)
 if out.Sources[0].Status!="INCLUDED" || out.Summary!="READ_ONLY_RECONSTRUCTION" {t.Fatalf("fresh report not included: %+v",out)}
}
