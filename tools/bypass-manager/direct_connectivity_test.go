package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDirectConnectivityActualTLS204AndTextAndRejectsErrors(t *testing.T) {
	s := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/204":
			w.WriteHeader(http.StatusNoContent)
		case "/microsoft":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("Microsoft Connect Test"))
		case "/redirect":
			http.Redirect(w, r, "/204", http.StatusFound)
		case "/403":
			http.Error(w, "forbidden", http.StatusForbidden)
		case "/wrong":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("captive portal"))
		case "/bad204":
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer s.Close()
	cl := s.Client()
	cl.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	cases := []struct {
		route string
		code  int
		body  string
		state string
	}{
		{"/204", 204, "", "OK"},
		{"/microsoft", 200, "Microsoft Connect Test", "OK"},
		{"/redirect", 204, "", "UNEXPECTED_HTTP"},
		{"/403", 204, "", "UNEXPECTED_HTTP"},
		{"/wrong", 200, "Microsoft Connect Test", "UNEXPECTED_BODY"},
		{"/204", 200, "", "UNEXPECTED_HTTP"},
	}
	for _, tt := range cases {
		t.Run(tt.route+tt.state, func(t *testing.T) {
			got := testDirectProbe(context.Background(), cl, directProbeTarget{ID: "CHECK_A", URL: s.URL + tt.route, Expect: tt.code, Body: tt.body})
			if got.State != tt.state || got.Source != "CHECK_A" {
				t.Fatalf("unexpected %+v", got)
			}
		})
	}
}
func TestDirectConnectivityTLSFailureIsNotSuccess(t *testing.T) {
	s := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	defer s.Close()
	// Standard client must not trust the test server certificate.
	got := testDirectProbe(context.Background(), newDirectProbeClient(), directProbeTarget{ID: "CHECK_A", URL: s.URL, Expect: 204})
	if got.State == "OK" {
		t.Fatal("untrusted TLS certificate accepted")
	}
}
func TestDirectConnectivityTimeoutAndCanceled(t *testing.T) {
	s := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(350 * time.Millisecond):
		}
		w.WriteHeader(204)
	}))
	defer s.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	got := testDirectProbe(ctx, s.Client(), directProbeTarget{ID: "CHECK_A", URL: s.URL, Expect: 204})
	if got.State != "TIMEOUT" {
		t.Fatalf("timed out request misclassified: %+v", got)
	}
}
func TestDirectConnectivityPhaseCancellationAndDuration(t *testing.T) {
	s := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(28 * time.Millisecond)
		w.WriteHeader(204)
	}))
	defer s.Close()
	targets := []directProbeTarget{{"CHECK_A", s.URL, 204, ""}, {"CHECK_B", s.URL, 204, ""}, {"CHECK_C", s.URL, 204, ""}}
	p := probeDirectPhase(context.Background(), s.Client(), targets)
	if p.Passed != 3 || len(p.Samples) != 3 {
		t.Fatalf("expected three complete TLS probes %+v", p)
	}
	if p.Samples[0].DurationMS < 20 {
		t.Fatalf("named result timing was lost: %+v", p.Samples[0])
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	p = probeDirectPhase(ctx, s.Client(), targets)
	if len(p.Samples) != 0 || p.Passed != 0 {
		t.Fatalf("cancel ignored %+v", p)
	}
}
func directFixturePhase(passed int) *DirectCheckPhase {
	samples := make([]DirectCheckSample, 3)
	for i, id := range []string{"CHECK_A", "CHECK_B", "CHECK_C"} {
		state := "NETWORK_ERROR"
		if i < passed {
			state = "OK"
		}
		samples[i] = DirectCheckSample{Source: id, State: state, DurationMS: 125}
	}
	return &DirectCheckPhase{CompletedUTC: utc(), Total: 3, Passed: passed, Samples: samples}
}
func TestDirectCheckNeverClaimsBlockBypass(t *testing.T) {
	tests := []struct {
		before, after int
		state         string
	}{
		{0, 2, "GENERAL_HTTPS_CHANGE_OBSERVED"},
		{1, 3, "GENERAL_HTTPS_CHANGE_OBSERVED"},
		{2, 3, "GENERAL_HTTPS_AVAILABLE"},
		{3, 2, "GENERAL_HTTPS_AVAILABLE"},
		{3, 1, "GENERAL_HTTPS_DEGRADED"},
		{0, 0, "GENERAL_HTTPS_STILL_IMPAIRED"},
		{1, 1, "GENERAL_HTTPS_STILL_IMPAIRED"},
	}
	for _, tt := range tests {
		r := buildDirectCheck(directFixturePhase(tt.before), directFixturePhase(tt.after), true)
		if r.State != tt.state || r.EffectVerified || !validDirectCheck(r) {
			t.Fatalf("misclassified %+v", r)
		}
		msg := directCheckSummary(r)
		if strings.Contains(msg, "обход подтвержд") || strings.Contains(msg, "ВПН включ") {
			t.Fatalf("false promise %s", msg)
		}
	}
	if x := buildDirectCheck(directFixturePhase(0), nil, true); x.State != "CHECK_INCOMPLETE" {
		t.Fatal(x)
	}
	if x := buildDirectCheck(nil, directFixturePhase(3), true); x.State != "AFTER_ONLY" {
		t.Fatal(x)
	}
	if x := buildDirectCheck(directFixturePhase(0), directFixturePhase(3), false); x.State != "ENGINE_NOT_RUNNING" {
		t.Fatal(x)
	}
}
func TestDirectCheckNoIdentifiersInShareableSupport(t *testing.T) {
	root := t.TempDir()
	m := &Manager{home: root}
	r := buildDirectCheck(directFixturePhase(0), directFixturePhase(3), true)
	if err := m.saveDirectCheck(r); err != nil {
		t.Fatal(err)
	}
	bundle := buildSupportReport(filepath.Join(root, "results"), time.Now())
	if bundle.DirectCheck == nil || bundle.DirectCheck.State != "GENERAL_HTTPS_CHANGE_OBSERVED" {
		t.Fatalf("direct evidence not exported %+v", bundle)
	}
	path, _, err := saveSupport(filepath.Join(root, "results"))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, personal := range []string{"gstatic.com", "cloudflare.com", "msftconnecttest.com", "google.com", "9.9.9.9"} {
		if strings.Contains(string(raw), personal) {
			t.Fatalf("URL or IP leaked in exported JSON: %s", personal)
		}
	}
	// A report may contain only fixed service codes. An injected URL must not
	// escape through typed, otherwise valid JSON in a support export.
	reportFile := filepath.Join(root, "results", "latest-direct-check.json")
	original, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	corrupted := strings.Replace(string(original), `"source":"CHECK_A"`, `"source":"https://private.example"`, 1)
	if corrupted == string(original) {
		t.Fatal("fixture did not inject service")
	}
	if err = os.WriteFile(reportFile, []byte(corrupted), 0600); err != nil {
		t.Fatal(err)
	}
	after := buildSupportReport(filepath.Join(root, "results"), time.Now())
	if after.DirectCheck != nil {
		t.Fatal("untrusted direct probe was exported")
	}
	found := false
	for _, source := range after.Sources {
		if source.Name == "latest-direct-check.json" && source.Status == "INVALID_OR_OLD_SCHEMA" {
			found = true
		}
	}
	if !found {
		t.Fatal("invalid direct source was not reported")
	}
}

func TestDirectMeasuredStartOrchestration(t *testing.T) {
	for _, scenario := range []struct {
		name          string
		before, after int
		startErr      bool
		verification  bool
		want          string
		calls         int
	}{
		{"rise", 0, 3, false, true, "GENERAL_HTTPS_CHANGE_OBSERVED", 2},
		{"still", 1, 1, false, true, "GENERAL_HTTPS_STILL_IMPAIRED", 2},
		{"before-ok", 3, 3, false, true, "GENERAL_HTTPS_AVAILABLE", 2},
		{"start-failed", 0, 0, true, false, "ENGINE_NOT_RUNNING", 1},
		{"process-exited", 0, 3, false, false, "ENGINE_NOT_RUNNING", 2},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			calls := 0
			started := false
			probe := func(context.Context) DirectCheckPhase {
				calls++
				if !started {
					return *directFixturePhase(scenario.before)
				}
				return *directFixturePhase(scenario.after)
			}
			start := func(context.Context) error {
				started = true
				if scenario.startErr {
					return context.DeadlineExceeded
				}
				return nil
			}
			verify := func(context.Context) (bool, error) { return scenario.verification, nil }
			report, err := directMeasuredStart(context.Background(), start, verify, probe)
			if calls != scenario.calls || report.State != scenario.want || report.EffectVerified || !validDirectCheck(report) {
				t.Fatalf("bad orchestration %+v calls=%d err=%v", report, calls, err)
			}
			if (err != nil) != (scenario.startErr || !scenario.verification) {
				t.Fatalf("invalid success err: %v", err)
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	started := false
	report, err := directMeasuredStart(ctx, func(context.Context) error { started = true; return nil }, func(context.Context) (bool, error) { return true, nil }, func(context.Context) DirectCheckPhase { return *directFixturePhase(0) })
	if err == nil || started || report.State != "ENGINE_NOT_RUNNING" {
		t.Fatal("cancelled operation still started filter")
	}
}
