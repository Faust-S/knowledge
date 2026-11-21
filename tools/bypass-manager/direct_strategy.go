package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Direct Strategy uses the upstream winws2 multi-profile hostlist routing.
// One native process remains running; only the named learned host is trialled.
// These records contain no visited domain and cannot prove DPI causality.
const (
	directStrategyMaxHosts = 128
	directStrategyMaxBytes = 16 * 1024
	directStrategyTrialsPerSession = 6
	directStrategyCaveat = "Two application-origin TLS connection failures were compared with two handshakes under a different winws2 host-specific strategy. A recovered TLS handshake does not establish HTTP access, browser/application success, anonymity or DPI causality. Hostnames stay in private local files."
)

type DirectStrategyReport struct {
	SchemaVersion string `json:"schema_version"`
	CheckedUTC string `json:"checked_utc"`
	State string `json:"state"`
	BaselineFailures int `json:"baseline_failures"`
	AlternativeSuccesses int `json:"alternative_successes"`
	Retained bool `json:"retained"`
	EffectVerified bool `json:"effect_verified"`
	Caveat string `json:"caveat"`
}

func newDirectStrategyReport(state string) DirectStrategyReport {
	return DirectStrategyReport{SchemaVersion: "1.0", CheckedUTC: utc(), State: state, Caveat: directStrategyCaveat}
}

func validDirectStrategyReport(r DirectStrategyReport) bool {
	if r.SchemaVersion != "1.0" || r.Caveat != directStrategyCaveat || r.EffectVerified ||
		r.BaselineFailures < 0 || r.BaselineFailures > 2 || r.AlternativeSuccesses < 0 || r.AlternativeSuccesses > 2 {
		return false
	}
	if _, err := time.Parse(time.RFC3339Nano, r.CheckedUTC); err != nil { return false }
	switch r.State {
	case "BASELINE_OK", "BASELINE_INCONCLUSIVE", "ALREADY_SELECTED", "ALTERNATIVE_TLS_CANDIDATE",
		"ALTERNATIVE_REVERTED", "TRIAL_CANCELLED", "LOCAL_FILE_ERROR", "ROLLBACK_UNVERIFIED",
		"RECOVERED_PENDING_TRIAL", "NO_CANDIDATE", "NOT_RUNNING":
		return !r.Retained || r.State == "ALTERNATIVE_TLS_CANDIDATE"
	default:
		return false
	}
}

func (m *Manager) saveDirectStrategy(r DirectStrategyReport) error {
	if !validDirectStrategyReport(r) { return errors.New("invalid direct strategy report") }
	return saveJSON(filepath.Join(m.home, "results", "latest-direct-strategy.json"), r)
}

func directAlternativePath(m *Manager) string {
	return filepath.Join(m.stateFolder, "direct-alternative-hosts.txt")
}

func readDirectAlternative(path string) ([]string, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) { return nil, nil }
	if err != nil { return nil, err }
	if !info.Mode().IsRegular() || info.Size() > directStrategyMaxBytes { return nil, errors.New("invalid private alternative hostlist") }
	data, err := os.ReadFile(path)
	if err != nil { return nil, err }
	if len(data) > directStrategyMaxBytes { return nil, errors.New("private alternative hostlist too large") }
	hosts := make([]string, 0)
	seen := make(map[string]bool)
	for _, line := range strings.Split(string(data), "\n") {
		host := strings.TrimSpace(strings.TrimSuffix(line, "\r"))
		if host == "" { continue }
		if !validDirectHost(host) || seen[host] { return nil, errors.New("invalid private alternative hostlist entry") }
		seen[host] = true
		hosts = append(hosts, host)
		if len(hosts) > directStrategyMaxHosts { return nil, errors.New("private alternative hostlist too long") }
	}
	return hosts, nil
}

// Only our app's state folder is written; existing files must be regular and
// replacement uses an adjacent temporary file to avoid partial winws2 reloads.
func writeDirectPrivateFile(path string, data []byte) error {
	if len(data) > directStrategyMaxBytes { return errors.New("private strategy file too large") }
	info, err := os.Lstat(path)
	if err == nil && !info.Mode().IsRegular() { return errors.New("private strategy file is not regular") }
	if err != nil && !errors.Is(err, os.ErrNotExist) { return err }
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil { return err }
	f, err := os.CreateTemp(filepath.Dir(path), ".direct-trial-*")
	if err != nil { return err }
	defer os.Remove(f.Name())
	if err := f.Chmod(0600); err != nil { f.Close(); return err }
	if _, err := f.Write(data); err != nil { f.Close(); return err }
	if err := f.Sync(); err != nil { f.Close(); return err }
	if err := f.Close(); err != nil { return err }
	return os.Rename(f.Name(), path)
}

func writeDirectAlternative(path string, hosts []string) error {
	if len(hosts) > directStrategyMaxHosts { return errors.New("too many alternative hosts") }
	seen := make(map[string]bool)
	for _, host := range hosts {
		if !validDirectHost(host) || seen[host] { return errors.New("invalid alternative host") }
		seen[host] = true
	}
	return writeDirectPrivateFile(path, []byte(strings.Join(hosts, "\n") + "\n"))
}

func directContainsHost(hosts []string, host string) bool {
	for _, entry := range hosts { if entry == host { return true } }
	return false
}

func directTrialJournal(path string) string { return path + ".pending" }

// Crash recovery removes a provisional host only; previously selected hosts
// remain unchanged. A pending file is PRIVATE and never added to support JSON.
func recoverDirectStrategyTrial(path string) (bool, error) {
	journal := directTrialJournal(path)
	info, err := os.Lstat(journal)
	if errors.Is(err, os.ErrNotExist) { return false, nil }
	if err != nil { return false, err }
	if !info.Mode().IsRegular() || info.Size() > 300 { return false, errors.New("invalid direct trial journal") }
	data, err := os.ReadFile(journal)
	if err != nil { return false, err }
	host := strings.TrimSpace(string(data))
	if !validDirectHost(host) { return false, errors.New("invalid pending host") }
	hosts, err := readDirectAlternative(path)
	if err != nil { return false, err }
	kept := make([]string, 0, len(hosts))
	for _, item := range hosts { if item != host { kept = append(kept, item) } }
	if len(kept) != len(hosts) {
		if err := writeDirectAlternative(path, kept); err != nil { return false, err }
	}
	if err := os.Remove(journal); err != nil && !errors.Is(err, os.ErrNotExist) { return false, err }
	return true, nil
}

// Choose from the ORIGINAL winws2 auto-learned list, never arbitrary guessed
// domains. A domain is tested at most once per GUI session.
func nextDirectStrategyHost(learnedPath, alternativePath string, seen map[string]bool) (string, error) {
	hosts, status := readDirectLearnedHosts(learnedPath)
	if status == "LOCAL_LIST_UNAVAILABLE" || status == "LOCAL_LIST_TOO_LARGE" { return "", errors.New("auto hostlist unavailable") }
	alternatives, err := readDirectAlternative(alternativePath)
	if err != nil { return "", err }
	for _, host := range hosts {
		if seen[host] || directContainsHost(alternatives, host) { continue }
		seen[host] = true
		return host, nil
	}
	return "", nil
}

// A verified native filter must already be running. The caller serializes
// this trial against user Start/Stop and rejects stale user intent via ready.
// The probe is the real TLS client in production, injectable in local tests.
func trialDirectAlternative(ctx context.Context, host, path string,
	probe func(context.Context, string) string, ready func() bool, settle func(context.Context) error,
) (result DirectStrategyReport, retErr error) {
	result = newDirectStrategyReport("BASELINE_INCONCLUSIVE")
	if !validDirectHost(host) { return newDirectStrategyReport("NO_CANDIDATE"), nil }
	previous, err := readDirectAlternative(path)
	if err != nil { return newDirectStrategyReport("LOCAL_FILE_ERROR"), err }
	if directContainsHost(previous, host) { return newDirectStrategyReport("ALREADY_SELECTED"), nil }
	if len(previous) >= directStrategyMaxHosts { return newDirectStrategyReport("LOCAL_FILE_ERROR"), errors.New("alternative hostlist capacity reached") }
	for i := 0; i < 2; i++ {
		if ctx.Err() != nil || !ready() { result.State = "TRIAL_CANCELLED"; return result, ctx.Err() }
		observed := probe(ctx, host)
		// No strategy trial for resolver errors or private endpoints.
		if observed != "TLS_FAILED" && observed != "TCP_FAILED" {
			if observed == "TLS_CONFIRMED" { result.State = "BASELINE_OK" }
			return result, nil
		}
		result.BaselineFailures++
	}
	if ctx.Err() != nil || !ready() { result.State = "TRIAL_CANCELLED"; return result, ctx.Err() }
	// The crash journal is created BEFORE adding the host to the live list.
	if err := writeDirectPrivateFile(directTrialJournal(path), []byte(host+"\n")); err != nil {
		result.State = "LOCAL_FILE_ERROR"
		return result, err
	}
	defer func() {
		if result.Retained { return }
		if _, err := recoverDirectStrategyTrial(path); err != nil {
			result.State = "ROLLBACK_UNVERIFIED"
			retErr = errors.Join(retErr, err)
		}
	}()
	if err := writeDirectAlternative(path, append(previous, host)); err != nil {
		result.State = "LOCAL_FILE_ERROR"
		return result, err
	}
	if err := settle(ctx); err != nil { result.State = "TRIAL_CANCELLED"; return result, err }
	for i := 0; i < 2; i++ {
		if ctx.Err() != nil || !ready() { result.State = "TRIAL_CANCELLED"; return result, ctx.Err() }
		if probe(ctx, host) != "TLS_CONFIRMED" {
			result.State = "ALTERNATIVE_REVERTED"
			return result, nil
		}
		result.AlternativeSuccesses++
	}
	if ctx.Err() != nil || !ready() { result.State = "TRIAL_CANCELLED"; return result, ctx.Err() }
	if err := os.Remove(directTrialJournal(path)); err != nil {
		result.State = "LOCAL_FILE_ERROR"
		return result, fmt.Errorf("clear temporary strategy journal: %w", err)
	}
	result.State, result.Retained = "ALTERNATIVE_TLS_CANDIDATE", true
	return result, nil
}
