package main

import (
	"strings"
	"testing"
)

func TestMTUTrialSafety(t *testing.T) {
	ok := `{"schema_version":"0.3.4","status":"TRIAL_STARTED","before_mtu":1500,"after_mtu":1420}`
	if _, err := parseMTUTrialResponse([]byte(ok)); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{
		strings.Replace(ok, `"after_mtu":1420`, `"after_mtu":1500`, 1),
		strings.Replace(ok, `"after_mtu":1420`, `"after_mtu":1200`, 1),
		strings.Replace(ok, `"status":"TRIAL_STARTED"`, `"status":"HACKED"`, 1),
		strings.Replace(ok, `"status":`, `"physical_ip":"1.2.3.4","status":`, 1),
	} {
		if _, err := parseMTUTrialResponse([]byte(bad)); err == nil {
			t.Fatal("unsafe response accepted", bad)
		}
	}
	if !mtuTrialWorthKeeping(10, 12, true) || mtuTrialWorthKeeping(10, 11, false) || mtuTrialWorthKeeping(10, 11, true) {
		t.Fatal("invalid measurement decision")
	}
}
