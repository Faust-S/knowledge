package main

import (
	"errors"
	"path/filepath"
	"time"
)

// The GUI owns the monitoring lifetime. Monitoring never assumes that a public
// HTTPS probe proves access to a blocked site or the egress of another app.
const directMonitorInterval = 60 * time.Second

var errInvalidDirectMonitor = errors.New("invalid direct monitor state")

const directMonitorCaveat = "Fixed HTTPS probes measure only this application's IPv4 connectivity. Auto-restart is limited to one owned-process attempt per session; persistent degradation triggers one reversible own-filter off/on comparison. No blocked site recovery, DPI causality, other-app path or IP masking is asserted."

const (
	directMonitorNone     = "NONE"
	directMonitorRestart  = "RESTART_OWN_FILTER"
	directMonitorRollback = "STOP_OWN_FILTER"
)

type DirectMonitorReport struct {
	SchemaVersion       string `json:"schema_version"`
	CheckedUTC          string `json:"checked_utc"`
	State               string `json:"state"`
	EngineState         string `json:"engine_state"`
	Passed              int    `json:"passed"`
	Total               int    `json:"total"`
	ConsecutiveImpaired int    `json:"consecutive_impaired"`
	ConsecutiveLost     int    `json:"consecutive_lost"`
	AutoRestarts        int    `json:"auto_restarts"`
	Action              string `json:"action"`
	EffectVerified      bool   `json:"effect_verified"`
	Caveat              string `json:"caveat"`
}

type directSupervisor struct {
	armed                bool
	impaired             int
	lost                 int
	restarts             int
	stoppedForRegression bool
}

func (s *directSupervisor) arm()    { s.armed = true }
func (s *directSupervisor) disarm() { *s = directSupervisor{} }

// observe only decides. The caller must re-check user intent and native PID
// ownership under the exclusive operation lock immediately before acting.
func (s *directSupervisor) observe(state string, p *DirectCheckPhase, hadWorkingHTTPS bool) DirectMonitorReport {
	r := DirectMonitorReport{SchemaVersion: "1.0", CheckedUTC: utc(), EngineState: state,
		State: "MONITOR_NOT_ARMED", Action: directMonitorNone, Caveat: directMonitorCaveat}
	if !s.armed {
		return r
	}
	switch state {
	case directRunning:
		s.lost = 0
		if !validDirectPhase(p) || p == nil || p.Total != 3 {
			s.impaired = 0
			r.State = "CHECK_INCOMPLETE"
			break
		}
		r.Passed, r.Total = p.Passed, p.Total
		if p.Passed >= 2 {
			s.impaired = 0
			r.State = "GENERAL_HTTPS_AVAILABLE"
		} else {
			s.impaired++
			r.State = "GENERAL_HTTPS_IMPAIRED"
			if hadWorkingHTTPS && s.impaired >= 2 && !s.stoppedForRegression {
				// A fail-safe rollback, not a finding of DPI causality.
				s.stoppedForRegression = true
				r.State = "ROLLBACK_REQUIRED"
				r.Action = directMonitorRollback
			}
		}
	case directOff, directUnverified:
		s.impaired = 0
		s.lost++
		r.State = "ENGINE_MISSING"
		if s.lost >= 2 {
			if s.restarts == 0 {
				s.restarts = 1
				r.State = "RESTART_REQUIRED"
				r.Action = directMonitorRestart
			} else {
				r.State = "RECOVERY_EXHAUSTED"
			}
		}
	case "OTHER_OWNED_PROFILE":
		s.impaired, s.lost = 0, 0
		r.State = "OTHER_PROFILE_UNTOUCHED"
	default:
		s.impaired, s.lost = 0, 0
		r.State = "PROCESS_STATUS_UNKNOWN"
	}
	r.ConsecutiveImpaired, r.ConsecutiveLost, r.AutoRestarts = s.impaired, s.lost, s.restarts
	return r
}

func validDirectMonitor(r DirectMonitorReport) bool {
	if r.SchemaVersion != "1.0" || r.Caveat != directMonitorCaveat || r.EffectVerified ||
		r.Passed < 0 || r.Passed > 3 || (r.Total != 0 && r.Total != 3) || r.Passed > r.Total || r.ConsecutiveImpaired < 0 || r.ConsecutiveImpaired > 100000 ||
		r.ConsecutiveLost < 0 || r.ConsecutiveLost > 100000 || r.AutoRestarts < 0 || r.AutoRestarts > 1 {
		return false
	}
	if _, err := time.Parse(time.RFC3339Nano, r.CheckedUTC); err != nil {
		return false
	}
	switch r.EngineState {
	case directOff, directRunning, directUnverified, "OTHER_OWNED_PROFILE", "UNKNOWN":
	default:
		return false
	}
	switch r.Action {
	case directMonitorNone, directMonitorRestart, directMonitorRollback:
	default:
		return false
	}
	switch r.State {
	case "MONITOR_NOT_ARMED", "CHECK_INCOMPLETE", "GENERAL_HTTPS_AVAILABLE", "GENERAL_HTTPS_IMPAIRED",
		"ROLLBACK_REQUIRED", "ROLLBACK_APPLIED", "ROLLBACK_FAILED", "ENGINE_MISSING", "RESTART_REQUIRED",
		"RECOVERED", "RECOVERY_FAILED", "RECOVERY_EXHAUSTED", "OTHER_PROFILE_UNTOUCHED", "PROCESS_STATUS_UNKNOWN",
		"FILTER_RESTORED_NO_AB_GAIN", "RESTORE_FAILED", "STOP_REQUESTED":
	default:
		return false
	}
	return true
}

func (m *Manager) saveDirectMonitor(r DirectMonitorReport) error {
	if !validDirectMonitor(r) {
		return errInvalidDirectMonitor
	}
	return saveJSON(filepath.Join(m.home, "results", "latest-direct-monitor.json"), r)
}

// A single before/after comparison can justify keeping our own filter OFF,
// but does not establish that the filter caused the original outage.
func directABOffImproved(filteredPassed int, off *DirectCheckPhase) bool {
	return filteredPassed >= 0 && filteredPassed < 2 && off != nil && validDirectPhase(off) &&
		off.Total == 3 && len(off.Samples) == 3 && off.Passed >= 2 && off.Passed > filteredPassed
}
