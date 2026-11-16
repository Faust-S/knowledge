package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestAppSnapshotNeverExportsProcessNames(t *testing.T) {
	in := AppSocketCapture{SchemaVersion: "0.3.4", Checked: true, TCPChecked: true, UDPChecked: true, ProcessCount: 2, PhysicalBound: 1, VPNBound: 2, UDPBound: 1, Programs: []AppSocketLocal{{Name: "veryPrivateApp.exe", Category: "OTHER", PhysicalBound: 1, UDPBound: 1}, {Name: "firefox", Category: "BROWSER", VPNBound: 2}}}
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
	if !strings.Contains(strings.Join(a.Findings, ","), "PHYSICAL_BINDING_OBSERVED") {
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
	for _, want := range []string{"UDP_REMOTE_UNKNOWN", "PHYSICAL_BINDING_OBSERVED", "APPLICATION_LIST_PARTIAL"} {
		if !strings.Contains(strings.Join(a.Findings, ","), want) {
			t.Fatal("missing conservative finding", want)
		}
	}
	if strings.Contains(a.Caveat, "proves") {
		t.Fatal("must not claim VPN proof")
	}
}
