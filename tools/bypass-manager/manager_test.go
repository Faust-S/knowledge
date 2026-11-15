package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPublicIPv4(t *testing.T) {
	for _, ip := range []string{"198.51.100.17", "203.0.113.4", "192.168.1.5", "100.64.1.1", "1.1.1.01", "[::1]"} {
		if validIPv4(ip) {
			t.Errorf("accepted nonpublic %s", ip)
		}
	}
	for _, ip := range []string{"1.1.1.1", "8.8.8.8", "9.9.9.9"} {
		if !validIPv4(ip) {
			t.Errorf("rejected public %s", ip)
		}
	}
}
func TestProfileOrder(t *testing.T) {
	m := Manifest{Profiles: map[string]Profile{"UDP-FAKE": {}, "UDP-REPEAT": {}, "TLS-SPLIT": {}, "TLS-DISORDER": {}, "TLS-FAKESEQ": {}, "TLS-FAKETTL": {}}}
	c := Config{Transport: "AWG-UDP", LastConfirmedProfile: "TLS-SPLIT"}
	got := profileOrder(c, m)
	if strings.Join(got, ",") != "NONE,UDP-FAKE,UDP-REPEAT" {
		t.Fatal(got)
	}
	c.Transport = "REALITY-TCP"
	c.LastConfirmedProfile = "TLS-DISORDER"
	got = profileOrder(c, m)
	if strings.Join(got, ",") != "NONE,TLS-DISORDER,TLS-SPLIT,TLS-FAKESEQ,TLS-FAKETTL" {
		t.Fatal(got)
	}
}
func TestConfigValidation(t *testing.T) {
	c := Config{EndpointIPv4: "8.8.8.8", Port: 51820, Transport: "AWG-UDP", AdapterName: "amnezia", BundleRoot: "C:\\bundle"}
	if err := validateConfig(c); err != nil {
		t.Fatal(err)
	}
	c.AdapterName = "" // Auto-detection is allowed after the client connects.
	if err := validateConfig(c); err != nil {
		t.Fatalf("auto-discovery was rejected: %v", err)
	}
	c.EndpointIPv4 = "203.0.113.12"
	if validateConfig(c) == nil {
		t.Fatal("documentation endpoint accepted")
	}
}
func TestClientNoImplicitProxy(t *testing.T) {
	c := httpClient(4 * time.Second)
	if c.Transport.(*http.Transport).Proxy != nil {
		t.Fatal("proxy must be disabled by default")
	}
}
func TestDownloadHTTPFailsClosed(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/bad" {
			w.WriteHeader(404)
			return
		}
		io.WriteString(w, "tiny")
	}))
	defer server.Close()
	ctx := context.Background()
	if got := downloadFrom(ctx, 128, server.URL+"/tiny"); got.OK {
		t.Fatal("short download accepted")
	}
	if got := downloadFrom(ctx, 4, server.URL+"/tiny"); !got.OK {
		t.Fatal("exact download rejected", got.Error)
	}
	if got := downloadFrom(ctx, 4, server.URL+"/bad"); got.OK {
		t.Fatal("HTTP 404 accepted")
	}

}
func TestEmbedAndManifest(t *testing.T) {
	b, err := embedded.ReadFile("runtime/Profiles/profiles.json")
	if err != nil {
		t.Fatal(err)
	}
	var m Manifest
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	if m.Profiles["UDP-FAKE"].Transport != "UDP" {
		t.Fatal("wrong UDP profile")
	}
}

func TestPreferredProfileDoesNotSkipControl(t *testing.T) {
	m := Manifest{Profiles: map[string]Profile{"UDP-FAKE": {}, "UDP-REPEAT": {}}}
	got := profileOrder(Config{Transport: "AWG-UDP", PreferredProfile: "UDP-REPEAT"}, m)
	if strings.Join(got, ",") != "NONE,UDP-REPEAT,UDP-FAKE" {
		t.Fatal(got)
	}
}
func TestRedactReportDoesNotModifyEvidence(t *testing.T) {
	r := Report{EndpointIPv4: "8.8.8.8", AdapterName: "personal", Baseline: EgressResult{IP: "1.1.1.1", Agreement: true, Samples: []EgressSample{{IP: "1.1.1.1", Status: "OK"}}}, Trials: []Trial{{Attempts: []Probe{{Egress: EgressResult{IP: "9.9.9.9", Agreement: true}, AdapterBefore: &AdapterStats{Name: "user adapter", ReceivedBytes: 14}, AdapterAfter: &AdapterStats{Name: "user adapter", ReceivedBytes: 24}, Success: true}}}}}
	safe := redactedReport(r)
	if safe.EndpointIPv4 != "" || safe.AdapterName != "" || safe.Baseline.IP != "" || safe.Baseline.Samples[0].IP != "" || safe.Trials[0].Attempts[0].Egress.IP != "" || safe.Trials[0].Attempts[0].AdapterBefore.Name != "" {
		t.Fatalf("private data exposed: %+v", safe)
	}
	if !safe.Trials[0].Attempts[0].Success || !safe.Baseline.Agreement || safe.Trials[0].Attempts[0].AdapterBefore.ReceivedBytes != 14 {
		t.Fatal("evidence corrupted")
	}
	if r.Baseline.IP != "1.1.1.1" || r.Trials[0].Attempts[0].Egress.IP != "9.9.9.9" || r.Trials[0].Attempts[0].AdapterBefore.Name != "user adapter" {
		t.Fatal("original mutated")
	}
}

func TestAssessDataPathFailClosed(t *testing.T) {
	baseline := EgressResult{IP: "1.1.1.1", Agreement: true}
	p := Probe{EndpointRoute: &EndpointRoute{Name: "Ethernet", Index: 7, Destination: "0.0.0.0/0"}, Egress: EgressResult{IP: "9.9.9.9", Agreement: true}, AdapterFlow: true, Downloads: []DownloadResult{{OK: true, Bytes: 131072, ExpectedBytes: 131072}}}
	if ok, _ := assessDataPath(p, baseline, 1); !ok {
		t.Fatal("valid synthetic data path rejected")
	}
	p.Egress.Agreement = false
	if ok, _ := assessDataPath(p, baseline, 1); ok {
		t.Fatal("accepted without egress consensus")
	}
	p.Egress.Agreement = true
	p.AdapterFlow = false
	if ok, _ := assessDataPath(p, baseline, 1); ok {
		t.Fatal("accepted without adapter proof")
	}
	p.AdapterFlow = true
	p.Downloads[0].Bytes = 7
	if ok, _ := assessDataPath(p, baseline, 1); ok {
		t.Fatal("accepted truncated download")
	}
	p.Downloads[0].Bytes = 131072
	p.RouteLoopSuspected = true
	if ok, _ := assessDataPath(p, baseline, 1); ok {
		t.Fatal("accepted endpoint route loop")
	}
}

func TestRouteMustBeObservedToConfirmDataPath(t *testing.T) {
	base := EgressResult{IP: "1.1.1.1", Agreement: true}
	p := Probe{Egress: EgressResult{IP: "9.9.9.9", Agreement: true}, AdapterFlow: true,
		Downloads: []DownloadResult{{OK: true, Bytes: 131072, ExpectedBytes: 131072}}}
	if ok, _ := assessDataPath(p, base, 1); ok {
		t.Fatal("accepted an unknown route")
	}
	p.EndpointRoute = &EndpointRoute{Name: "Ethernet", Index: 12, Destination: "0.0.0.0/0"}
	if ok, _ := assessDataPath(p, base, 1); !ok {
		t.Fatal("rejected observed route")
	}
	p.EndpointRoute.Index = 0
	if ok, _ := assessDataPath(p, base, 1); ok {
		t.Fatal("accepted route with unknown interface index")
	}
}

func TestMandatoryControlNeedsNoEngine(t *testing.T) {
	if requiresDPIEngine("NONE") {
		t.Fatal("NONE must work without a DPI engine")
	}
	for _, profile := range []string{"UDP-FAKE", "UDP-REPEAT", "TLS-SPLIT", "TLS-FAKESEQ"} {
		if !requiresDPIEngine(profile) {
			t.Errorf("missing engine requirement for %s", profile)
		}
	}
}

func TestMonitoringTailIsBounded(t *testing.T) {
	var history []Probe
	for i := 0; i < maxMonitoringSamples*3; i++ {
		history = appendBoundedMonitoring(history, Probe{Reason: fmt.Sprintf("sample-%d", i)})
	}
	if len(history) != maxMonitoringSamples {
		t.Fatalf("got %d", len(history))
	}
	if history[0].Reason != fmt.Sprintf("sample-%d", maxMonitoringSamples*2) {
		t.Fatalf("oldest retained item %q", history[0].Reason)
	}
	if history[len(history)-1].Reason != fmt.Sprintf("sample-%d", maxMonitoringSamples*3-1) {
		t.Fatalf("last retained item %q", history[len(history)-1].Reason)
	}
}

func TestIPv6RiskClassificationNeverClaimsAnonymity(t *testing.T) {
	a := EgressResult{IP: "2606:4700:4700::1111", Agreement: true}
	same, note := assessIPv6Exposure(a, a)
	if !same || !strings.Contains(note, "POSSIBLE_IPV6_BYPASS") {
		t.Fatal("same public IPv6 must warn")
	}
	different := EgressResult{IP: "2606:4700:4700::1001", Agreement: true}
	risk, note := assessIPv6Exposure(a, different)
	if risk || !strings.Contains(note, "unverified") {
		t.Fatal("different IPv6 is not anonymity proof")
	}
	risk, note = assessIPv6Exposure(a, EgressResult{})
	if risk || !strings.Contains(note, "unknown") {
		t.Fatal("missing measurement cannot prove privacy")
	}
	for _, invalid := range []string{"2001:db8::1", "fd00::1", "fe80::1", "::1", "1.1.1.1"} {
		if validIPv6(invalid) {
			t.Errorf("nonpublic IPv6 accepted %s", invalid)
		}
	}
	if !validIPv6("2606:4700:4700::1111") {
		t.Fatal("public IPv6 rejected")
	}
}

func TestIPv6NeverExposedInExport(t *testing.T) {
	b := EgressResult{IP: "2606:4700:4700::1111", Agreement: true, Samples: []EgressSample{{IP: "2606:4700:4700::1111"}}}
	a := EgressResult{IP: "2606:4700:4700::1001", Agreement: true}
	r := Report{BaselineIPv6: &b, Trials: []Trial{{Attempts: []Probe{{EgressIPv6: &a, PrivacyNote: "IPv6 different"}}}}}
	safe := redactedReport(r)
	if safe.BaselineIPv6 == nil || safe.Trials[0].Attempts[0].EgressIPv6 == nil {
		t.Fatal("lost privacy evidence classification")
	}
	if safe.BaselineIPv6.IP != "" || safe.BaselineIPv6.Samples[0].IP != "" || safe.Trials[0].Attempts[0].EgressIPv6.IP != "" {
		t.Fatal("IPv6 address leaked to JSON")
	}
	if r.BaselineIPv6.IP == "" || r.Trials[0].Attempts[0].EgressIPv6.IP == "" {
		t.Fatal("redaction mutated live evidence")
	}
}

func TestEgressConsensusIsNotFirstResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/a":
			io.WriteString(w, "8.8.8.8\n")
		case "/b", "/c":
			io.WriteString(w, "9.9.9.9\n")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	urls := []string{server.URL + "/a", server.URL + "/b", server.URL + "/c"}
	got := collectEgress(context.Background(), urls, httpClient(time.Second), validIPv4)
	if !got.Agreement || got.IP != "9.9.9.9" || len(got.Samples) != 3 {
		t.Fatalf("bad consensus %+v", got)
	}
	got = collectEgress(context.Background(), urls[:1], httpClient(time.Second), validIPv4)
	if got.Agreement {
		t.Fatalf("one independent provider accepted %+v", got)
	}
}

func TestIPv6EgressConsensusRequiresTwoValidAnswers(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/a", "/b":
			io.WriteString(w, "2606:4700:4700::1111\n")
		case "/c":
			io.WriteString(w, "2001:db8::1\n") // Documentation prefix.
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	urls := []string{server.URL + "/a", server.URL + "/b", server.URL + "/c"}
	got := collectEgress(context.Background(), urls, httpClient(time.Second), validIPv6)
	if !got.Agreement || got.IP != "2606:4700:4700::1111" || got.Samples[2].Status != "ERROR" {
		t.Fatalf("IPv6 consensus accepted invalid sample or failed: %+v", got)
	}
}

func TestEngineInstallHappensOnlyForRequiredProfile(t *testing.T) {
	checks, installs := 0, 0
	available := func() bool { checks++; return false }
	install := func() error { installs++; return nil }
	if err := ensureEngineForProfile("NONE", available, install); err != nil {
		t.Fatal(err)
	}
	if checks != 0 || installs != 0 {
		t.Fatal("control touched DPI engine")
	}
	if err := ensureEngineForProfile("UDP-FAKE", available, install); err != nil {
		t.Fatal(err)
	}
	if checks != 1 || installs != 1 {
		t.Fatal("DPI profile did not install missing engine")
	}
	if err := ensureEngineForProfile("UDP-REPEAT", func() bool { return true }, install); err != nil {
		t.Fatal(err)
	}
	if installs != 1 {
		t.Fatal("existing engine was installed again")
	}
}

func TestSensitiveFreeTextIsNotExported(t *testing.T) {
	text := `Windows error C:\Users\Example Name\AppData\Local\vpn.conf, user@example.net, public 8.8.8.8`
	safe := redactText(text)
	if strings.Contains(safe, "Example Name") || strings.Contains(safe, "user@example.net") || strings.Contains(safe, "8.8.8.8") {
		t.Fatalf("unredacted private details %q", safe)
	}
	route := Probe{Reason: "нужна точная идентификация адаптера: adapter account-private-label unavailable"}
	safeReason := redactProbe(route).Reason
	if safeReason != "ADAPTER_DISCOVERY_UNVERIFIED" {
		t.Fatalf("private adapter detail: %s", safeReason)
	}
}
