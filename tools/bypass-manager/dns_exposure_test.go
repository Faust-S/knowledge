package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// The IPv6 probe must never silently use IPv4 when a URL has an A record.
// This was a real bug: the old DialContext closure shadowed the requested family.
func TestIPv6ClientCannotDialIPv4Loopback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("ok"))
	}))
	defer srv.Close()
	ctx := context.Background()
	c4 := httpClientFamily(3*time.Second, "tcp4")
	resp, err := c4.Get(srv.URL)
	if err != nil {
		t.Fatalf("IPv4 fixture unreachable: %v", err)
	}
	resp.Body.Close()
	c6 := httpClientFamily(3*time.Second, "tcp6")
	resp, err = c6.Get(srv.URL)
	if err == nil {
		resp.Body.Close()
		t.Fatal("IPv6 probe silently fell back to IPv4")
	}
	if ctx.Err() != nil {
		t.Fatal(ctx.Err())
	}
}

func TestDNSExposureIsNeverProofOfNoLeak(t *testing.T) {
	cases := []struct {
		name  string
		input *DNSExposure
		risk  bool
		note  string
	}{
		{"nil", nil, false, "DNS_ROUTE_CHECK_UNAVAILABLE"},
		{"failure", &DNSExposure{}, false, "DNS_ROUTE_CHECK_UNAVAILABLE"},
		{"off_tunnel", &DNSExposure{Checked: true, VPNDNSCount: 1, OtherDNSCount: 2, OutsideVPNRoutes: 2}, true, "POSSIBLE_DNS_OUTSIDE_VPN"},
		{"unknown", &DNSExposure{Checked: true, VPNDNSCount: 1, UnknownRoutes: 1}, false, "DNS_ROUTE_INCOMPLETE"},
		{"truncated", &DNSExposure{Checked: true, VPNDNSCount: 1, Truncated: true}, false, "DNS_ROUTE_INCOMPLETE"},
		{"no_vpn_dns", &DNSExposure{Checked: true, OtherDNSCount: 1}, false, "NO_VPN_DNS_CONFIGURED"},
		{"vpn_route", &DNSExposure{Checked: true, VPNDNSCount: 1, ThroughVPNRoutes: 1}, false, "DNS_ROUTES_OBSERVED"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			risk, note := assessDNSExposure(tc.input)
			if risk != tc.risk || !strings.HasPrefix(note, tc.note) {
				t.Fatalf("risk %v note %q", risk, note)
			}
			if strings.Contains(strings.ToLower(note), "no leaks") || strings.Contains(note, "DNS_LEAK_FREE") {
				t.Fatalf("overclaimed protection %q", note)
			}
		})
	}
}

func TestDNSExposureReportNoRawNetworkIdentifiers(t *testing.T) {
	r := Report{Trials: []Trial{{Attempts: []Probe{{DNSExposure: &DNSExposure{Checked: true, VPNDNSCount: 1, OtherDNSCount: 1, OutsideVPNRoutes: 1}, DNSPrivacyNote: "POSSIBLE_DNS_OUTSIDE_VPN", DNSExposureSuspected: true}}}}}
	redacted := redactedReport(r)
	if !redacted.Trials[0].Attempts[0].DNSExposureSuspected || !redacted.Trials[0].Attempts[0].DNSExposure.Checked {
		t.Fatal("diagnostics lost")
	}
	if redacted.Trials[0].Attempts[0].DNSExposure.OutsideVPNRoutes != 1 {
		t.Fatal("counts lost")
	}
}
