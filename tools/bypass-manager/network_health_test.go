package main

import (
	"encoding/json"
	"strings"
	"testing"
)

const healthyHealthJSON = `{"schema_version":"0.3.2","checked":true,"physical_active":1,"physical_ambiguous":false,"medium":"ETHERNET","link_mbps":1000,"wifi_signal_pct":-1,"physical_ipv4_mtu":1500,"physical_metric":25,"receive_errors":0,"send_errors":0,"receive_discards":0,"send_discards":0,"vpn_active":1,"vpn_ipv4_mtu":1376,"vpn_metric":5,"vpn_full_route":true,"proxy_enabled":false}`

func TestHealthStrictPrivacySchema(t *testing.T) {
	snapshot, err := parseNetworkHealth([]byte(healthyHealthJSON))
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.LinkMbps != 1000 || snapshot.Medium != "ETHERNET" {
		t.Fatal(snapshot)
	}
	if len(assessNetworkHealth(snapshot)) != 0 {
		t.Fatalf("false warnings: %+v", assessNetworkHealth(snapshot))
	}
	payload := strings.TrimSuffix(healthyHealthJSON, "}") + `,"ssid":"Private Wi-Fi","gateway":"192.168.1.1"}`
	if _, err := parseNetworkHealth([]byte(payload)); err == nil {
		t.Fatal("accepted identifying fields")
	}
	if _, err := parseNetworkHealth([]byte(healthyHealthJSON + "{}")); err == nil {
		t.Fatal("accepted multiple json objects")
	}
	bad := strings.Replace(healthyHealthJSON, `"medium":"ETHERNET"`, `"medium":"PrivateSSID"`, 1)
	if _, err := parseNetworkHealth([]byte(bad)); err == nil {
		t.Fatal("accepted unapproved medium")
	}
}

func TestHealthFindingsAndDeltas(t *testing.T) {
	a, err := parseNetworkHealth([]byte(healthyHealthJSON))
	if err != nil {
		t.Fatal(err)
	}
	a.Medium, a.WiFiSignalPct, a.LinkMbps = "WIFI", 35, 28
	a.ProxyEnabled, a.VPNFullRoute, a.VPNActive = true, false, 2
	a.VPNIPv4MTU = 1800
	wanted := []string{"WIFI_SIGNAL_LOW", "LOW_LINK_CAPACITY", "MULTIPLE_TUNNEL_ADAPTERS", "SYSTEM_PROXY_CONFIGURATION_PRESENT", "VPN_MTU_EXCEEDS_LOCAL_LINK"}
	got := assessNetworkHealth(a)
	for _, v := range wanted {
		found := false
		for _, f := range got {
			if f.Code == v {
				found = true
			}
		}
		if !found {
			t.Fatalf("missing %s among %+v", v, got)
		}
	}
	b := a
	b.ReceiveErrors = 4
	b.SendDiscards = 20
	if len(compareNetworkHealth(a, b)) != 2 {
		t.Fatalf("expected 2 counter change findings: %+v", compareNetworkHealth(a, b))
	}
	b.LinkMbps = 1000
	if len(compareNetworkHealth(a, b)) != 0 {
		t.Fatal("compared different links")
	}
}

func TestHealthReportDoesNotExposePrivateMetadata(t *testing.T) {
	a, _ := parseNetworkHealth([]byte(healthyHealthJSON))
	r := NetworkAudit{SchemaVersion: "0.3.2", State: "PASSIVE_SNAPSHOT", Snapshot: a, Findings: assessNetworkHealth(a), Caveat: networkHealthCaveat}
	b, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	for _, disallowed := range []string{"ssid", "mac", "bssid", "gateway", "provider", "adapter_name", "proxy_url", "dns_server"} {
		if strings.Contains(strings.ToLower(string(b)), disallowed) {
			t.Fatalf("unexpected identity field %s", disallowed)
		}
	}
}

func TestHealthInvalidInputs(t *testing.T) {
	for _, content := range []string{
		`{"checked":false,"schema_version":"0.3.2"}`,
		strings.Replace(healthyHealthJSON, `"wifi_signal_pct":-1`, `"wifi_signal_pct":101`, 1),
		strings.Replace(healthyHealthJSON, `"physical_ipv4_mtu":1500`, `"physical_ipv4_mtu":250`, 1),
		strings.Replace(healthyHealthJSON, `"link_mbps":1000`, `"link_mbps":-4`, 1),
	} {
		if _, err := parseNetworkHealth([]byte(content)); err == nil {
			t.Fatalf("accepted invalid health: %s", content)
		}
	}
}
