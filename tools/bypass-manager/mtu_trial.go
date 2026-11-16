package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
)

type MTUTrialResponse struct {
	SchemaVersion string `json:"schema_version"`
	Status        string `json:"status"`
	BeforeMTU     int    `json:"before_mtu"`
	AfterMTU      int    `json:"after_mtu"`
}
type MTUTrialReport struct {
	SchemaVersion  string  `json:"schema_version"`
	CompletedUTC   string  `json:"completed_utc"`
	State          string  `json:"state"`
	BeforeMTU      int     `json:"before_mtu"`
	TrialMTU       int     `json:"trial_mtu"`
	BeforeMbps     float64 `json:"before_mbps"`
	TrialMbps      float64 `json:"trial_mbps"`
	RollbackStatus string  `json:"rollback_status"`
	Caveat         string  `json:"caveat"`
}

const mtuTrialCaveat = "Temporary IPv4 MTU-only ActiveStore A/B trial on one unambiguous physical interface. External 90-second watchdog and reboot reversion are best-effort safeguards, not an absolute crash-proof guarantee. No permanent settings, routes, DNS, IPv6 or VPN keys changed. HTTPS test egress does not prove VPN or application egress."

func parseMTUTrialResponse(raw []byte) (MTUTrialResponse, error) {
	var v MTUTrialResponse
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&v); err != nil {
		return MTUTrialResponse{}, errors.New("invalid MTU response")
	}
	var trailing any
	if d.Decode(&trailing) != io.EOF {
		return MTUTrialResponse{}, errors.New("invalid MTU trailing data")
	}
	if v.SchemaVersion != "0.3.4" || v.BeforeMTU < 0 || v.AfterMTU < 0 || v.BeforeMTU > 9000 || v.AfterMTU > 9000 {
		return MTUTrialResponse{}, errors.New("invalid MTU values")
	}
	switch v.Status {
	case "SELF_TEST_PASS", "TRIAL_AVAILABLE", "NO_UNAMBIGUOUS_PHYSICAL_INTERFACE", "PREVIEW_UNAVAILABLE", "PENDING_ROLLBACK", "WATCHDOG_NOT_READY", "TRIAL_STARTED", "TRIAL_NOT_CONFIRMED", "RESTORED", "NO_PENDING_TRIAL", "ROLLBACK_NOT_CONFIRMED":
	default:
		return MTUTrialResponse{}, errors.New("invalid MTU status")
	}
	if v.Status == "TRIAL_STARTED" && (v.BeforeMTU < 1360 || v.AfterMTU < 1280 || v.AfterMTU >= v.BeforeMTU) {
		return MTUTrialResponse{}, errors.New("unsafe MTU trial")
	}
	return v, nil
}
func mtuTrialWorthKeeping(before, after float64, afterComplete bool) bool {
	return before > 0 && afterComplete && after > before*1.15
}
