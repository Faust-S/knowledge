package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestAppSnapshotNeverExportsProcessNames(t *testing.T) {
	in := AppSocketCapture{SchemaVersion: "0.3.4", Checked: true, TCPChecked: true, UDPChecked: true, ProcessCount: 2, PhysicalBound: 1, PhysicalClassificationComplete: true, NonVPNPhysicalBound: 1, VPNBound: 2, UDPBound: 1, Programs: []AppSocketLocal{{Name: "veryPrivateApp.exe", Category: "OTHER", PhysicalBound: 1, UDPBound: 1}, {Name: "firefox", Category: "BROWSER", VPNBound: 2}}}
	b, _ := json.Marshal(in)
	parsed, err := parseAppSocketCapture(b)
	if err != nil {
		t.Fatal(err)
	}
	a := summarizeAppSockets(parsed, time.Now())
	j, _ := json.Marshal(a)
	if strings.Contains(string(j), "veryPrivateApp") || strings.Contains(string(j), "firefox") {
		t.Fatal("leaked local process name")
	}
	if len(a.Categories) != 2 || a.PhysicalBound != 1 {
		t.Fatalf("bad summary %+v", a)
	}
	if !strings.Contains(strings.Join(a.Findings, ","), "NON_VPN_APP_PHYSICAL_BINDING_OBSERVED_NOT_EGRESS_PROOF") {
		t.Fatal("missing caution")
	}
}
func TestAppSnapshotRejectsRawEndpointsAndBadNames(t *testing.T) {
	s := `{"schema_version":"0.3.4","checked":true,"tcp_checked":true,"process_count":1,"programs":[{"name":"alice private.exe","category":"OTHER","vpn_bound":0,"physical_bound":0,"loopback":0,"uncertain":1,"udp_bound":0}]}`
	x, err := parseAppSocketCapture([]byte(s))
	if err != nil {
		t.Fatal(err)
	}
	if x.Programs[0].Name != "[hidden]" {
		t.Fatal("should hide free text")
	}
	s = strings.Replace(s, `"category":"OTHER"`, `"remote_ip":"1.2.3.4","category":"OTHER"`, 1)
	if _, err = parseAppSocketCapture([]byte(s)); err == nil {
		t.Fatal("accepted identifying endpoint")
	}
	if _, err = parseAppSocketCapture([]byte(`{"schema_version":"0.3.4","checked":false,"tcp_checked":true,"process_count":0}`)); err == nil {
		t.Fatal("accepted unchecked inventory")
	}
}

func TestApplicationCategoriesCannotProveEgress(t *testing.T) {
	c := AppSocketCapture{SchemaVersion: "0.3.4", Checked: true, TCPChecked: true, ProcessCount: 20, PhysicalBound: 2, UDPBound: 3, Programs: []AppSocketLocal{{Name: "msedge", Category: "BROWSER", PhysicalBound: 2, UDPBound: 3}}}
	a := summarizeAppSockets(c, time.Now())
	for _, want := range []string{"UDP_REMOTE_UNKNOWN", "PHYSICAL_BINDING_CLASSIFICATION_UNKNOWN", "APPLICATION_LIST_PARTIAL"} {
		if !strings.Contains(strings.Join(a.Findings, ","), want) {
			t.Fatal("missing conservative finding", want)
		}
	}
	if strings.Contains(a.Caveat, "proves") {
		t.Fatal("must not claim VPN proof")
	}
}

// The VPN client's outer TCP connection MUST leave via a physical adapter.
// It is not a leak of traffic from ordinary applications.
func TestPhysicalVPNTransportIsNotFlaggedAsApplicationEgress(t *testing.T) {
	c := AppSocketCapture{SchemaVersion: "0.3.4", Checked: true, TCPChecked: true,
		PhysicalClassificationComplete: true, PhysicalBound: 3,
		VPNClientPhysicalBound: 3, NonVPNPhysicalBound: 0, ProcessCount: 2,
		Programs: []AppSocketLocal{{Name: "amnezia", Category: "VPN_CLIENT", PhysicalBound: 3}}}
	b, _ := json.Marshal(c)
	parsed, err := parseAppSocketCapture(b)
	if err != nil {
		t.Fatal(err)
	}
	audit := summarizeAppSockets(parsed, time.Now())
	findings := strings.Join(audit.Findings, ",")
	if !strings.Contains(findings, "VPN_CLIENT_PHYSICAL_TRANSPORT_EXPECTED") || strings.Contains(findings, "NON_VPN_APP_PHYSICAL_BINDING_OBSERVED") {
		t.Fatalf("VPN outer transport misclassified: %+v", audit)
	}
	if suggestions := tuningSuggestions(SupportReport{Apps: &audit}); len(suggestions) != 0 {
		t.Fatalf("VPN physical transport should not prompt leak warning: %+v", suggestions)
	}
	js, _ := json.Marshal(audit)
	if strings.Contains(string(js), "amnezia") {
		t.Fatal("process name leaked to export")
	}
}

func TestPhysicalBindingClassificationRejectsInconsistentTotals(t *testing.T) {
	c := AppSocketCapture{SchemaVersion: "0.3.4", Checked: true, TCPChecked: true,
		PhysicalClassificationComplete: true, PhysicalBound: 2,
		NonVPNPhysicalBound: 2, VPNClientPhysicalBound: 1, ProcessCount: 1}
	b, _ := json.Marshal(c)
	if _, err := parseAppSocketCapture(b); err == nil {
		t.Fatal("accepted contradictory classification")
	}
}

func TestMixedPhysicalAndVPNBindingStillWarnsForOtherApps(t *testing.T) {
	c := AppSocketCapture{SchemaVersion: "0.3.4", Checked: true, TCPChecked: true,
		PhysicalClassificationComplete: true, PhysicalBound: 5,
		NonVPNPhysicalBound: 2, VPNClientPhysicalBound: 3, ProcessCount: 3}
	a := summarizeAppSockets(c, time.Now())
	if !strings.Contains(strings.Join(a.Findings, ","), "NON_VPN_APP_PHYSICAL_BINDING_OBSERVED_NOT_EGRESS_PROOF") {
		t.Fatal("missing ordinary-app route warning")
	}
	plan := tuningSuggestions(SupportReport{Apps: &a})
	if len(plan) != 1 || plan[0].Code != "APPLICATION_SOURCE_BINDING_REVIEW" {
		t.Fatalf("wrong plan: %+v", plan)
	}
}
