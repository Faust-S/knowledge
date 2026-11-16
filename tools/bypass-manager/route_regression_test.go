package main

import (
	"strings"
	"testing"
)

func TestRoutePreflightFailsClosedAndDoesNotTriggerNextDPI(t *testing.T) {
	cases := []struct {
		route   *EndpointRoute
		loop    bool
		blocked bool
	}{
		{nil, false, true},
		{&EndpointRoute{Status: "NO_ROUTE"}, false, true},
		{&EndpointRoute{Status: "LOOKUP_ERROR"}, false, true},
		{&EndpointRoute{Name: "Ethernet", Index: 17, Destination: "0.0.0.0/0", Status: "LOOKUP_ERROR"}, false, true},
		{&EndpointRoute{Name: "Ethernet", Index: 17, Destination: "0.0.0.0/0", Status: "ROUTE_FOUND"}, false, false},
		{&EndpointRoute{Name: "AmneziaVPN", Index: 17, Destination: "0.0.0.0/0", Status: "ROUTE_FOUND"}, true, true},
	}
	for i, tt := range cases {
		if got := routePreflightBlocked(Probe{EndpointRoute: tt.route, RouteLoopSuspected: tt.loop}); got != tt.blocked {
			t.Errorf("case %d: blocked=%v want %v", i, got, tt.blocked)
		}
	}
	if !strings.Contains(routePreflightReason(&EndpointRoute{Status: "NO_ROUTE"}), "Kill Switch") {
		t.Fatal("Missing route reason must explain possible VPN/Windows cause")
	}
	if !strings.Contains(routePreflightReason(&EndpointRoute{Status: "LOOKUP_ERROR"}), "Сбой") {
		t.Fatal("Failed Windows route API must be distinct from missing route")
	}
}
