package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDirectSupervisorBoundedProcessRecovery(t *testing.T) {
	var s directSupervisor
	if r := s.observe(directOff, nil, true); r.Action != directMonitorNone || r.State != "MONITOR_NOT_ARMED" {
		t.Fatal(r)
	}
	s.arm()
	if r := s.observe(directUnverified, nil, true); r.Action != directMonitorNone || r.State != "ENGINE_MISSING" {
		t.Fatal(r)
	}
	if r := s.observe(directUnverified, nil, true); r.Action != directMonitorRestart || r.AutoRestarts != 1 {
		t.Fatal(r)
	}
	if r := s.observe(directUnverified, nil, true); r.Action != directMonitorNone || r.State != "RECOVERY_EXHAUSTED" {
		t.Fatal(r)
	}
	if r := s.observe("OTHER_OWNED_PROFILE", nil, true); r.Action != directMonitorNone || r.State != "OTHER_PROFILE_UNTOUCHED" {
		t.Fatal(r)
	}
	s.disarm()
	if r := s.observe(directOff, nil, true); r.State != "MONITOR_NOT_ARMED" || r.AutoRestarts != 0 {
		t.Fatal(r)
	}
}

func TestDirectSupervisorOnlyRollsBackConfirmedRegression(t *testing.T) {
	for _, prior := range []bool{false, true} {
		var s directSupervisor
		s.arm()
		if r := s.observe(directRunning, directFixturePhase(3), prior); r.State != "GENERAL_HTTPS_AVAILABLE" {
			t.Fatal(r)
		}
		if r := s.observe(directRunning, directFixturePhase(1), prior); r.Action != directMonitorNone {
			t.Fatal(r)
		}
		r := s.observe(directRunning, directFixturePhase(0), prior)
		if prior && r.Action != directMonitorRollback {
			t.Fatal(r)
		}
		if !prior && (r.Action != directMonitorNone || r.State != "GENERAL_HTTPS_IMPAIRED") {
			t.Fatal(r)
		}
		if r := s.observe(directRunning, directFixturePhase(0), prior); r.Action != directMonitorNone {
			t.Fatal(r)
		}
	}
}

func TestDirectSupervisorIncompleteSamplesCannotTriggerAction(t *testing.T) {
	var s directSupervisor
	s.arm()
	incomplete := &DirectCheckPhase{CompletedUTC: utc(), Passed: 0, Total: 3}
	for i := 0; i < 4; i++ {
		if r := s.observe(directRunning, incomplete, true); r.Action != directMonitorNone || r.ConsecutiveImpaired != 0 {
			t.Fatal(r)
		}
	}
	if r := s.observe(directRunning, directFixturePhase(0), true); r.Action != directMonitorNone {
		t.Fatal(r)
	}
	if r := s.observe(directRunning, directFixturePhase(2), true); r.ConsecutiveImpaired != 0 {
		t.Fatal(r)
	}
}

func TestDirectMonitorReportRejectsIdentifiersAndUnknownStates(t *testing.T) {
	r := DirectMonitorReport{SchemaVersion: "1.0", CheckedUTC: utc(), State: "GENERAL_HTTPS_AVAILABLE",
		EngineState: directRunning, Total: 3, Passed: 2, Action: directMonitorNone, Caveat: directMonitorCaveat}
	if !validDirectMonitor(r) {
		t.Fatal("normal report invalid")
	}
	temp := t.TempDir()
	m := &Manager{home: temp}
	if err := m.saveDirectMonitor(r); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(temp, "results", "latest-direct-monitor.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "gstatic.com") || strings.Contains(string(b), "winws2.exe") {
		t.Fatal("private fields")
	}
	var got DirectMonitorReport
	if err = json.Unmarshal(b, &got); err != nil || !validDirectMonitor(got) {
		t.Fatal(err)
	}
	r.State = "https://private.example"
	if validDirectMonitor(r) {
		t.Fatal("untrusted state")
	}
	r.State = "GENERAL_HTTPS_AVAILABLE"
	r.Caveat = "domain=secret.example"
	if validDirectMonitor(r) {
		t.Fatal("untrusted caveat")
	}
	r.Caveat = directMonitorCaveat
	r.CheckedUTC = time.Time{}.String()
	if validDirectMonitor(r) {
		t.Fatal("untrusted time")
	}
}

func TestDirectABOffImprovedRequiresFreshCompleteIndependentHTTPS(t *testing.T) {
	if !directABOffImproved(0, directFixturePhase(2)) || !directABOffImproved(1, directFixturePhase(3)) {
		t.Fatal("lost clear A/B improvement")
	}
	if directABOffImproved(0, nil) || directABOffImproved(0, &DirectCheckPhase{Total:3,Passed:3}) || directABOffImproved(2, directFixturePhase(3)) || directABOffImproved(0,directFixturePhase(1)) {
		t.Fatal("false A/B improvement")
	}
}

func TestMonitorConsecutiveFailuresResetOnIncompleteOrUnknown(t *testing.T) {
	var s directSupervisor
	s.arm()
	if r:=s.observe(directRunning,directFixturePhase(0),true);r.ConsecutiveImpaired!=1 { t.Fatal(r) }
	if r:=s.observe(directRunning,nil,true);r.State!="CHECK_INCOMPLETE" || r.ConsecutiveImpaired!=0 { t.Fatal(r) }
	if r:=s.observe(directRunning,directFixturePhase(0),true);r.Action!=directMonitorNone { t.Fatal(r) }
	if r:=s.observe("UNKNOWN",nil,true);r.ConsecutiveImpaired!=0 || r.ConsecutiveLost!=0 { t.Fatal(r) }
	if r:=s.observe(directUnverified,nil,true);r.Action!=directMonitorNone { t.Fatal(r) }
	if r:=s.observe(directRunning,directFixturePhase(2),true);r.ConsecutiveLost!=0 { t.Fatal(r) }
}
