package main

import (
	"context"
	"encoding/json"
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
	p := Probe{Egress: EgressResult{IP: "9.9.9.9", Agreement: true}, AdapterFlow: true, Downloads: []DownloadResult{{OK: true, Bytes: 131072, ExpectedBytes: 131072}}}
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
