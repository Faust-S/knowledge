package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"
)

// DirectReport contains only operational status, never private visited domains,
// external IP, browser addresses or VPN profiles.
type DirectReport struct {
	SchemaVersion  string `json:"schema_version"`
	CheckedUTC     string `json:"checked_utc"`
	State          string `json:"state"`
	Mode           string `json:"mode"`
	EngineRunning  bool   `json:"engine_running"`
	EffectVerified bool   `json:"effect_verified"`
	Outcome        string `json:"outcome"`
}

const (
	directRunning    = "RUNNING"
	directOff        = "OFF"
	directPending    = "STARTING"
	directFailed     = "FAILED"
	directUnverified = "STALE_OR_UNVERIFIED"
)

// Fixed non-sensitive codes are safe for support exports and usable by the UI.
func directFailureCode(err error) string {
	if err == nil {
		return "OK"
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "existing owned") || strings.Contains(msg, "owned process state"):
		return "OWNED_PROCESS_REQUIRES_STOP"
	case strings.Contains(msg, "another dpi") || strings.Contains(msg, "existing dpi"):
		return "OTHER_DPI_CONFLICT"
	case strings.Contains(msg, "pinned engine") || strings.Contains(msg, "official source"):
		return "ENGINE_DOWNLOAD_UNAVAILABLE"
	case strings.Contains(msg, "dry run") || strings.Contains(msg, "option parser") || strings.Contains(msg, "original engine"):
		return "ENGINE_PROFILE_NOT_ACCEPTED"
	case strings.Contains(msg, "administrator") || strings.Contains(msg, "access denied") || strings.Contains(msg, "uac"):
		return "WINDOWS_ELEVATION_REQUIRED"
	case strings.Contains(msg, "driver") || strings.Contains(msg, "windivert"):
		return "WINDOWS_PACKET_DRIVER_UNAVAILABLE"
	case strings.Contains(msg, "cancel"):
		return "CANCELLED"
	default:
		return "LOCAL_DPI_OPERATION_FAILED"
	}
}

func directReport(state, outcome string) DirectReport {
	return DirectReport{SchemaVersion: "1.0", CheckedUTC: utc(), State: state,
		Mode: "DIRECT_AUTO_TLS", EngineRunning: state == directRunning, EffectVerified: false, Outcome: outcome}
}
func (m *Manager) saveDirectReport(report DirectReport) error {
	return saveJSON(filepath.Join(m.home, "results", "latest-direct.json"), report)
}

func parseDirectStatus(b []byte) (string, error) {
	if len(b) == 0 || len(b) > 2048 {
		return "", errors.New("direct status missing")
	}
	var v struct {
		SchemaVersion string `json:"schema_version"`
		State         string `json:"state"`
		Mode          string `json:"mode"`
	}
	dec := json.NewDecoder(strings.NewReader(string(b)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&v); err != nil {
		return "", err
	}
	var trailing any
	if err := dec.Decode(&trailing); err != io.EOF {
		return "", errors.New("trailing direct status")
	}
	if v.SchemaVersion != "1.0" {
		return "", errors.New("unsupported status schema")
	}
	switch v.State {
	case directOff:
		if v.Mode != "NONE" {
			return "", errors.New("invalid off mode")
		}
	case directRunning:
		if v.Mode != "DIRECT_AUTO_TLS" {
			return "", errors.New("invalid running mode")
		}
	case "OTHER_OWNED_PROFILE":
		if v.Mode != "OTHER" {
			return "", errors.New("invalid existing mode")
		}
	case directUnverified:
		if v.Mode != "DIRECT_AUTO_TLS" && v.Mode != "OTHER" && v.Mode != "UNKNOWN" {
			return "", errors.New("invalid stale mode")
		}
	default:
		return "", errors.New("unknown direct status")
	}
	return v.State, nil
}
func (m *Manager) getDirectStatus(ctx context.Context) (string, error) {
	if err := m.ensureRuntime(); err != nil {
		return "", err
	}
	raw, err := m.powerShell(ctx, "Start-Direct.ps1", "-Action", "Status", "-StateFolder", m.stateFolder)
	if err != nil {
		return "", err
	}
	return parseDirectStatus([]byte(raw))
}

// Enable immediately installs the native engine if absent, then starts a
// bounded TLS-only auto-hostlist profile. This never requires Amnezia, a VPN
// server IP, network route changes or a browser extension.
func (m *Manager) startDirect(ctx context.Context) error {
	defer func() {
		// A cancelled PowerShell launcher may already have spawned winws2 before
		// returning. Reconcile only our recorded PID and never leave a surprise
		// packet-intercepting process running after Cancel/Close.
		if ctx.Err() != nil && m.ownStateExists() {
			_ = m.stopFilter()
		}
	}()
	if m.ownStateExists() {
		return errors.New("existing owned DPI state; stop it before switching modes")
	}
	if err := m.ensureRuntime(); err != nil {
		return fmt.Errorf("runtime: %w", err)
	}
	if m.cfg.BundleRoot == "" {
		m.cfg.BundleRoot = preferredEngineRoot(m.home)
	}
	if !enginePresent(m.cfg.BundleRoot) {
		// The primary user action explicitly initiates the one-time download of
		// pinned official engine components, never a subscription or VPN profile.
		if err := installUpstream(ctx, m.cfg.BundleRoot, func(string) (string, error) { return "д", nil }, m.output); err != nil {
			return fmt.Errorf("pinned engine: %w", err)
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	args := []string{"-Action", "Start", "-BundleRoot", m.cfg.BundleRoot, "-StateFolder", m.stateFolder, "-DryRun"}
	dryCtx, stop := context.WithTimeout(ctx, 30*time.Second)
	output, err := m.powerShell(dryCtx, "Start-Direct.ps1", args...)
	stop()
	if err != nil {
		return fmt.Errorf("direct profile rejected by original engine: %w", err)
	}
	if !strings.Contains(output, "DIRECT_DRY_RUN_PASS") {
		return errors.New("original engine did not confirm dry run")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	startCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	output, err = m.powerShell(startCtx, "Start-Direct.ps1", args[:len(args)-1]...)
	cancel()
	if err != nil {
		return fmt.Errorf("native direct start failed: %w", err)
	}
	if !strings.Contains(output, "DIRECT_STARTED") {
		return errors.New("native direct start not confirmed")
	}
	// The owned WinDivert process can exit after PowerShell returned. Check PID
	// and creation time through the same operating-system identity code.
	checkCtx, done := context.WithTimeout(context.Background(), 12*time.Second)
	state, checkErr := m.getDirectStatus(checkCtx)
	done()
	if checkErr != nil || state != directRunning {
		return fmt.Errorf("direct process is not running after start: state %s (%v)", state, checkErr)
	}
	m.profileState = "DIRECT-AUTO-TLS"
	return nil
}
func (m *Manager) stopDirect() error { return m.stopFilter() }
