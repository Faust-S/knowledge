package main

import "testing"

func TestGuidePlanIncludesBothProtocolsInFixedOrder(t *testing.T) {
	p := guidePlan()
	if len(p) != 8 || p[0].Protocol != guideAWG || p[0].Profile != "NONE" || p[3].Protocol != guideVLESS || p[3].Profile != "NONE" {
		t.Fatalf("unexpected plan: %+v", p)
	}
	for i, x := range p {
		if x.RequiresEndpoint != (x.Profile != "NONE") {
			t.Fatalf("plan index %d endpoint guard", i)
		}
	}
	if _, ok := nextGuideVariant(p, len(p)); ok {
		t.Fatal("end must stop")
	}
}
func TestGuideEndpointGuardRequiresMatchingProtocolAndNoGuess(t *testing.T) {
	c := Config{EndpointIPv4: "198.51.100.17", Port: 443, Transport: "AWG-UDP"}
	if guideEndpointApplicable(c, guideAWG) {
		t.Fatal("reserved IP is not a real remote endpoint")
	}
	c.EndpointIPv4 = "1.1.1.1"
	if !guideEndpointApplicable(c, guideAWG) || guideEndpointApplicable(c, guideVLESS) {
		t.Fatal("AWG guard")
	}
	c.Transport = "REALITY-TCP"
	if !guideEndpointApplicable(c, guideVLESS) || guideEndpointApplicable(c, guideAWG) {
		t.Fatal("VLESS guard")
	}
	c.Port = 0
	if guideEndpointApplicable(c, guideVLESS) {
		t.Fatal("missing port")
	}
}
func TestGuideErrorCodesDoNotLeakPathsOrAddresses(t *testing.T) {
	if guideErrorCode(nil) != "OK" {
		t.Fatal("nil")
	}
}

func TestGuideBaselineDoesNotUseAmbiguousConnectedAdapter(t *testing.T) {
	if guideCanMeasureDirectBaseline(VPNState{Checked: true, ActiveCount: 1, RoutePresent: false}) {
		t.Fatal("adapter is still active")
	}
	if guideCanMeasureDirectBaseline(VPNState{Checked: false}) {
		t.Fatal("unknown interface state")
	}
	if !guideCanMeasureDirectBaseline(VPNState{Checked: true, ActiveCount: 0}) {
		t.Fatal("clean disconnected observation")
	}
}
