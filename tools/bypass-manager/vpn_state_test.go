package main

import "testing"

func TestVPNStateIsNotProofOfTunnel(t *testing.T) {
	s, err := parseVPNState([]byte(`{"checked":true,"app_running":true,"candidate_count":1,"active_count":1,"adapter_name":"Amnezia","route_present":false,"address_present":false}`))
	if err != nil {
		t.Fatal(err)
	}
	name, ok := detectedAdapter(s)
	if !ok || name != "Amnezia" {
		t.Fatalf("adapter discovery failed: %#v", s)
	}
	if got := vpnStateCode(s); got != "ADAPTER_OBSERVED" {
		t.Fatalf("not a proven VPN route: %s", got)
	}
}

func TestVPNStateCannotGuessPeer(t *testing.T) {
	for _, tc := range []struct{ input, status string }{
		{`{"checked":true,"app_running":true,"candidate_count":0,"active_count":0}`, "ADAPTER_NOT_ACTIVE"},
		{`{"checked":true,"app_running":true,"candidate_count":2,"active_count":2,"adapter_name":"guess"}`, "AMBIGUOUS"},
		{`{"checked":true,"app_running":true,"candidate_count":1,"active_count":1,"adapter_name":"V","address_present":true,"route_present":true}`, "ROUTE_OBSERVED"},
	} {
		s, err := parseVPNState([]byte(tc.input))
		if err != nil {
			t.Fatal(err)
		}
		if got := vpnStateCode(s); got != tc.status {
			t.Fatalf("got %s want %s", got, tc.status)
		}
		if tc.status == "AMBIGUOUS" {
			if _, ok := detectedAdapter(s); ok {
				t.Fatal("ambiguous adapter was selected")
			}
		}
	}
	if _, err := parseVPNState([]byte(`{"checked":true,"active_count":2,"candidate_count":1}`)); err == nil {
		t.Fatal("invalid snapshot accepted")
	}
	if _, err := parseVPNState([]byte(`{"checked":false}`)); err == nil {
		t.Fatal("unchecked snapshot accepted")
	}
}

func TestMissingEndpointNeverBecomesGuessedConfig(t *testing.T) {
	s, _ := parseVPNState([]byte(`{"checked":true,"candidate_count":1,"active_count":1,"adapter_name":"Amnezia","route_present":true,"address_present":true}`))
	cfg := Config{AdapterName: s.AdapterName, Transport: "AWG-UDP"}
	if validateConfig(cfg) == nil {
		t.Fatal("a network adapter must not imply a verified remote UDP endpoint")
	}
}
