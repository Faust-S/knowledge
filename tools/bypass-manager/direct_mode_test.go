package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDirectStateStrictAndNoFalseSuccess(t *testing.T) {
	good := []struct{ raw, state string }{
		{`{"schema_version":"1.0","state":"RUNNING","mode":"DIRECT_AUTO_TLS"}`, directRunning},
		{`{"schema_version":"1.0","state":"OFF","mode":"NONE"}`, directOff},
		{`{"schema_version":"1.0","state":"OTHER_OWNED_PROFILE","mode":"OTHER"}`, "OTHER_OWNED_PROFILE"},
		{`{"schema_version":"1.0","state":"STALE_OR_UNVERIFIED","mode":"UNKNOWN"}`, directUnverified},
	}
	for _, tc := range good {
		state, err := parseDirectStatus([]byte(tc.raw))
		if err != nil || state != tc.state {
			t.Fatalf("%s: %s %v", tc.raw, state, err)
		}
	}
	for _, raw := range []string{"", "null", "{}", `{"schema_version":"1.0","state":"RUNNING","mode":"NONE"}`, `{"schema_version":"1.0","state":"OFF","mode":"DIRECT_AUTO_TLS"}`, `{"schema_version":"1.0","state":"RUNNING","mode":"DIRECT_AUTO_TLS","ip":"1.2.3.4"}`,
		`{"schema_version":"1.0","state":"RUNNING","mode":"DIRECT_AUTO_TLS"} {}`, `{"schema_version":"1.1","state":"RUNNING","mode":"DIRECT_AUTO_TLS"}`} {
		if _, err := parseDirectStatus([]byte(raw)); err == nil {
			t.Fatalf("accepted forged state %q", raw)
		}
	}
	for _, state := range []string{directRunning, directOff, directPending, directFailed, directUnverified} {
		r := directReport(state, "TEST")
		if r.EffectVerified {
			t.Fatal("started engine became false bypass proof")
		}
		if r.EngineRunning != (state == directRunning) {
			t.Fatal("invalid state mapping")
		}
		if !strings.Contains(r.CheckedUTC, "T") {
			t.Fatal("missing timestamp")
		}
		if _, err := time.Parse(time.RFC3339Nano, r.CheckedUTC); err != nil {
			t.Fatal(err)
		}
	}
}

func TestDirectReportAddedToSanitizedSupport(t *testing.T) {
	root := t.TempDir()
	report := directReport(directRunning, "STARTED_NOT_VERIFIED")
	if err := saveJSON(filepath.Join(root, "latest-direct.json"), report); err != nil {
		t.Fatal(err)
	}
	out := buildSupportReport(root, time.Now())
	if out.Direct == nil || out.Direct.State != directRunning || out.Direct.EffectVerified {
		t.Fatalf("missing/misleading direct evidence: %+v", out.Direct)
	}
	path, _, err := saveSupport(root)
	if err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(bytes), "hostlist-auto") || strings.Contains(string(bytes), "192.168.") {
		t.Fatal("private local data in shared report")
	}
}

func TestDirectFailureHasNoRawDetailsInShareableReport(t *testing.T) {
	cases := []struct{ err, errorContains string }{
		{"pinned engine: official source unreachable at C:\\User\\alice", "ENGINE_DOWNLOAD_UNAVAILABLE"},
		{"owned process state exists", "OWNED_PROCESS_REQUIRES_STOP"},
		{"another DPI process is running", "OTHER_DPI_CONFLICT"},
		{"WinDivert driver not working", "WINDOWS_PACKET_DRIVER_UNAVAILABLE"},
	}
	for _, tc := range cases {
		code := directFailureCode(errors.New(tc.err))
		if code != tc.errorContains {
			t.Fatalf("%s became %s", tc.err, code)
		}
		if strings.Contains(code, "alice") {
			t.Fatal("private path leaked")
		}
	}
}
