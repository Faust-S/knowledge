package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// This suite replays production decisions and makes actual loopback HTTP/TLS
// requests. It never starts winws2, changes routes, contacts Amnezia or
// claims a synthetic tunnel constitutes native VPN evidence.
type modeledCase struct {
	ID       string   `json:"id"`
	Area     string   `json:"area"`
	Result   string   `json:"result"`
	Expected string   `json:"expected"`
	Status   string   `json:"status"`
	Evidence []string `json:"evidence"`
	FieldGap string   `json:"field_gap,omitempty"`
}
type modeledMatrix struct {
	Schema         string        `json:"schema_version"`
	Commit         string        `json:"source_commit,omitempty"`
	Environment    string        `json:"environment"`
	ModelOnly      bool          `json:"model_only"`
	Total          int           `json:"total"`
	Passed         int           `json:"passed"`
	Failed         int           `json:"failed"`
	KnownFieldGaps int           `json:"known_field_gaps"`
	Cases          []modeledCase `json:"cases"`
}
type modelDefinition struct {
	id, area, want, gap string
	run                 func(*testing.T) (string, []string)
}

func modelGuide(control, filtered GuideRound, started bool) *GuideReport {
	r := &GuideReport{SchemaVersion: "0.3.2", StartedUTC: "2026-11-17T12:00:00Z", CompletedUTC: "2026-11-17T12:03:00Z", State: "ALL_PROTOCOLS_UNVERIFIED", Rounds: []GuideRound{control, filtered}}
	if started {
		r.Events = []GuideEvent{{Stage: "FILTER", Code: "OWN_DPI_STARTED", Protocol: filtered.Protocol, DPIProfile: filtered.DPIProfile}}
	}
	return r
}
func modelRound(protocol, profile string) GuideRound {
	return GuideRound{Protocol: protocol, DPIProfile: profile, State: "FAILED", StartedUTC: "2026-11-17T12:00:00Z", CompletedUTC: "2026-11-17T12:01:00Z", RouteObserved: true, AdapterFlow: true, Video: VideoAssessment{Grade: "INCOMPLETE"}}
}
func modelFull(source string, size int64, mbps float64) []GuideTransfer {
	return []GuideTransfer{{Source: source, OK: true, Bytes: size, ExpectedBytes: size, Seconds: 1, Mbps: mbps},
		{Source: source, OK: true, Bytes: size, ExpectedBytes: size, Seconds: 1, Mbps: mbps * 1.02}}
}
func modelAvailability() *GuideReport {
	base := modelRound(guideVLESS, "NONE")
	base.Transfers = []GuideTransfer{{Source: "TEST_CDN_A", ExpectedBytes: 2097152, FailureCode: "TIMEOUT"}, {Source: "TEST_CDN_B", ExpectedBytes: 2097152, FailureCode: "HTTP_503"}}
	active := modelRound(guideVLESS, "TLS-SPLIT")
	active.Transfers = modelFull("TEST_CDN_A", 2097152, 12)
	active.Video = VideoAssessment{Grade: "HD_1080P_CANDIDATE", Successful: 4, Total: 4}
	return modelGuide(base, active, true)
}
func modelRecoveredCDN() *GuideReport {
	r := modelAvailability()
	r.Rounds[0].Video = VideoAssessment{Grade: "HD_720P_CANDIDATE", Successful: 4, Total: 4}
	r.Rounds[0].Transfers = append(r.Rounds[0].Transfers, modelFull("TEST_CDN_B", 2097152, 11)...)
	return r
}
func modelThroughput() *GuideReport {
	base := modelRound(guideAWG, "NONE")
	base.Video.Grade = "HD_720P_CANDIDATE"
	base.BaselineKnown = true
	base.EgressChanged = true
	base.Transfers = modelFull("TEST_CDN_A", 2097152, 4)
	active := modelRound(guideAWG, "UDP-FAKE")
	active.Video.Grade = "HD_1080P_CANDIDATE"
	active.BaselineKnown = true
	active.EgressChanged = true
	active.Transfers = modelFull("TEST_CDN_A", 2097152, 12)
	return modelGuide(base, active, true)
}
func modelHTTP(t *testing.T, status int, bytes int) (DownloadResult, string) {
	t.Helper()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		if bytes > 0 {
			_, _ = w.Write(make([]byte, bytes))
		}
	}))
	defer s.Close()
	out := downloadFrom(context.Background(), 2097152, s.URL)
	return out, safeGuideDownloadFailure(out)
}
func TestBypassFieldSimulation(t *testing.T) {
	const mb int64 = 2097152
	now := time.Date(2026, 11, 17, 15, 0, 0, 0, time.UTC)
	definitions := []modelDefinition{
		{"S01", "protocol", "VLESS_FIRST", "", func(t *testing.T) (string, []string) {
			p := guidePlanFor(guideVLESS)
			if len(p) == 5 && p[0].Protocol == guideVLESS && p[0].Profile == "NONE" {
				return "VLESS_FIRST", []string{"5 variants", "starts NONE"}
			}
			return "WRONG_PLAN", nil
		}},
		{"S02", "protocol", "AWG_CONTROL", "", func(t *testing.T) (string, []string) {
			p := guidePlanFor(guideAWG)
			if len(p) == 8 && p[0].Protocol == guideAWG {
				return "AWG_CONTROL", []string{"8 variants", "starts NONE"}
			}
			return "WRONG_PLAN", nil
		}},
		{"S03", "vpn", "VIDEO_CANDIDATE_VPN_PATH_OBSERVED", "Native handshake and user video remain unverified", func(t *testing.T) (string, []string) {
			return guideOutcome(true, true, true, VideoAssessment{Grade: "HD_1080P_CANDIDATE"}), []string{"control IP changed", "adapter flow", "4 complete modeled downloads"}
		}},
		{"S04", "vpn", "VIDEO_USABLE_EGRESS_UNCHANGED", "Split tunnel or direct egress requires independent inspection", func(t *testing.T) (string, []string) {
			return guideOutcome(true, false, true, VideoAssessment{Grade: "HD_720P_CANDIDATE"}), []string{"same public IP", "adapter counters can still change"}
		}},
		{"S05", "vpn", "WEB_USABLE_VPN_UNVERIFIED", "Browser/app egress is not separately observed", func(t *testing.T) (string, []string) {
			return guideOutcome(true, true, false, VideoAssessment{Grade: "HD_1080P_CANDIDATE"}), []string{"HTTPS works", "no adapter flow"}
		}},
		{"S06", "vpn", "VIDEO_CANDIDATE_EGRESS_UNVERIFIED", "No disconnected baseline", func(t *testing.T) (string, []string) {
			return guideOutcome(false, false, true, VideoAssessment{Grade: "HD_720P_CANDIDATE"}), []string{"route observed", "baseline absent"}
		}},
		{"S07", "vpn", "CONNECT_AMNEZIA", "Proxy-only VLESS without TUN cannot currently be qualified by the adapter-first guide", func(t *testing.T) (string, []string) {
			return connectionGuideAction(VPNState{Checked: true, AppRunning: true, ActiveCount: 0}), []string{"VLESS client up", "no TUN adapter", "known product gap"}
		}},
		{"S08", "fallback", "HD_1080P_CANDIDATE", "Does not prove native VPN route", func(t *testing.T) (string, []string) {
			calls := 0
			_, results, q := checkGuideVideo(context.Background(), func(_ context.Context, n int64, source int) DownloadResult {
				calls++
				if source == 0 {
					return DownloadResult{ExpectedBytes: n, Error: "HTTP 403", HTTPStatus: 403}
				}
				return DownloadResult{OK: true, Bytes: n, ExpectedBytes: n, DurationSeconds: 1, Mbps: 12}
			}, func(context.Context, time.Duration) error { return nil })
			if calls != 8 || len(results) != 8 {
				return "BAD_FALLBACK", nil
			}
			return q.Grade, []string{"4 CDN A HTTP 403", "4 CDN B full success"}
		}},
		{"S09", "fallback", "INCOMPLETE", "Both independent CDN failed", func(t *testing.T) (string, []string) {
			_, rs, q := checkGuideVideo(context.Background(), func(_ context.Context, n int64, source int) DownloadResult {
				return DownloadResult{ExpectedBytes: n, Error: "HTTP 503", HTTPStatus: 503}
			}, func(context.Context, time.Duration) error { return nil })
			return q.Grade, []string{fmt.Sprintf("attempts=%d", len(rs)), "no Mbps measurement"}
		}},
		{"S10", "http", "HTTP_403", "Real loopback HTTP, not an external CDN", func(t *testing.T) (string, []string) {
			r, c := modelHTTP(t, 403, 0)
			if r.OK {
				return "FALSE_SUCCESS", nil
			}
			return c, []string{"actual HTTP response", "status 403", "0 bytes"}
		}},
		{"S11", "http", "PARTIAL_TRANSFER", "Real loopback HTTP", func(t *testing.T) (string, []string) {
			r, c := modelHTTP(t, 200, 65536)
			return c, []string{fmt.Sprintf("bytes=%d/2097152", r.Bytes), "HTTP 200 truncated"}
		}},
		{"S12", "http", "TLS_CERTIFICATE_ERROR", "Self-signed loopback TLS, no external site", func(t *testing.T) (string, []string) {
			s := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
			defer s.Close()
			r := downloadFrom(context.Background(), mb, s.URL)
			return safeGuideDownloadFailure(r), []string{"untrusted x509 certificate", "no VPN involved"}
		}},
		{"S13", "http", "TIMEOUT", "Short synthetic deadline on real loopback HTTP", func(t *testing.T) (string, []string) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				select {
				case <-r.Context().Done():
				case <-time.After(110 * time.Millisecond):
				}
			}))
			defer s.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
			defer cancel()
			r := downloadFrom(ctx, mb, s.URL)
			return safeGuideDownloadFailure(r), []string{"request deadline 20ms", "delayed response"}
		}},
		{"S14", "http", "RANGE_NOT_SUPPORTED", "Real loopback HTTP", func(t *testing.T) (string, []string) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200); _, _ = w.Write(make([]byte, mb)) }))
			defer s.Close()
			r := guideRangeDownload(context.Background(), mb, s.URL)
			return r.Error, []string{"range ignored", "200 instead of 206"}
		}},
		{"S15", "http", "RANGE_OK", "Real loopback HTTP", func(t *testing.T) (string, []string) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Range", "bytes 0-2097151/104857600")
				w.WriteHeader(206)
				_, _ = w.Write(make([]byte, mb))
			}))
			defer s.Close()
			r := guideRangeDownload(context.Background(), mb, s.URL)
			if r.OK && r.Bytes == mb {
				return "RANGE_OK", []string{"206 exact 2 MiB"}
			}
			return "BAD_RANGE", nil
		}},
		{"S16", "speed", "SLOW_FOR_VIDEO", "Four throughput values modeled, not real user bandwidth", func(t *testing.T) (string, []string) {
			return assessVideoDownloads([]DownloadResult{goodVideo(12), goodVideo(6), goodVideo(2.8), goodVideo(4)}).Grade, []string{"4 full transfers", "minimum 2.8 Mbps"}
		}},
		{"S17", "speed", "SPEED_NOT_VERIFIED", "No successful benchmark completion", func(t *testing.T) (string, []string) {
			_, grade, _, _, _ := testSpeed(context.Background(), func(_ context.Context, n int64, provider int) DownloadResult {
				return DownloadResult{ExpectedBytes: n, Error: "HTTP 403"}
			})
			return grade, []string{"both CDNs blocked", "not zero Mbps"}
		}},
		{"S18", "dpi", "NOT_TESTED", "No owned filter was started", func(t *testing.T) (string, []string) {
			r := modelAvailability()
			r.Events = nil
			return assessDPIEffect(r).State, []string{"filter not started"}
		}},
		{"S19", "dpi", "POSSIBLE_AVAILABILITY_IMPROVEMENT", "CDN may recover independently; causality not established", func(t *testing.T) (string, []string) {
			e := assessDPIEffect(modelAvailability())
			return e.State, []string{fmt.Sprintf("control failures=%d", e.ControlFailures), fmt.Sprintf("post-filter full=%d", e.FilteredSuccesses)}
		}},
		{"S20", "dpi", "NOT_COMPARABLE", "Fallback CDN already provided working video in control", func(t *testing.T) (string, []string) {
			return assessDPIEffect(modelRecoveredCDN()).State, []string{"CDN A 403 in NONE", "CDN B full success in NONE", "CDN A later recovered"}
		}},
		{"S21", "dpi", "POSSIBLE_IMPROVEMENT", "Matched throughput alone does not prove DPI caused gain", func(t *testing.T) (string, []string) {
			e := assessDPIEffect(modelThroughput())
			return e.State, []string{fmt.Sprintf("before=%.1f Mbps", e.ControlMbps), fmt.Sprintf("after=%.1f Mbps", e.ProfileMbps)}
		}},
		{"S22", "dpi", "NOT_COMPARABLE", "Different CDN payload not comparable", func(t *testing.T) (string, []string) {
			r := modelThroughput()
			r.Rounds[1].Transfers = modelFull("TEST_CDN_B", mb, 14)
			return assessDPIEffect(r).State, []string{"CDN_A vs CDN_B"}
		}},
		{"S23", "dpi", "NOT_COMPARABLE", "Adapter traffic lost after DPI", func(t *testing.T) (string, []string) {
			r := modelThroughput()
			r.Rounds[1].AdapterFlow = false
			return assessDPIEffect(r).State, []string{"post-filter adapter counters absent"}
		}},
		{"S24", "endpoint", "CHANGED", "Real server rotation not performed", func(t *testing.T) (string, []string) {
			a := OuterEndpoint{Status: "OBSERVED", Protocol: guideAWG, IPv4: "9.9.9.9", Port: 443, Transport: "AWG-UDP", PhysicalRoute: true}
			b := a
			b.IPv4 = "1.1.1.1"
			if !sameOuterEndpoint(a, b) {
				return "CHANGED", []string{"physical route still valid", "outer IP rotated"}
			}
			return "FALSE_MATCH", nil
		}},
		{"S25", "endpoint", "AMBIGUOUS", "Windows WFP signals emulated", func(t *testing.T) (string, []string) {
			b := []byte(`{"schema_version":"0.3.5","status":"AMBIGUOUS","protocol":"VLESS"}`)
			_, code := parseOuterEndpointEvidence(b, guideVLESS)
			return code, []string{"multiple candidate peers"}
		}},
		{"S26", "route", "BLOCKED", "Windows route table not changed", func(t *testing.T) (string, []string) {
			route := &EndpointRoute{Status: "ROUTE_FOUND", Name: "Amnezia", Index: 9, Destination: "0.0.0.0/0"}
			if routePreflightBlocked(Probe{EndpointRoute: route, RouteLoopSuspected: true}) {
				return "BLOCKED", []string{"outer endpoint loops through VPN adapter"}
			}
			return "FALSE_SAFE", nil
		}},
		{"S27", "cancel", "CANCELLED", "No owned process ever started", func(t *testing.T) (string, []string) {
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			code := waitGuideResponse(ctx, make(chan bool), time.Second)
			if code == guidePromptCancelled {
				return "CANCELLED", []string{"user stopped confirmation"}
			}
			return "NOT_CANCELLED", nil
		}},
		{"S28", "report", "GUIDE_INCOMPLETE", "Synthetic prematurely closed guide", func(t *testing.T) (string, []string) {
			r := GuideReport{State: "IN_PROGRESS", Rounds: []GuideRound{{State: "NOT_VERIFIED"}}}
			finalizeGuideReport(&r, false, "finished")
			if r.Rounds[0].State != "INCONCLUSIVE" {
				return "ROUND_STUCK", nil
			}
			return r.State, []string{"open round terminal", "CompletedUTC populated"}
		}},
		{"S29", "freshness", "STALE", "No recent speed should be shown as live", func(t *testing.T) (string, []string) {
			_, old := howOld(now.Add(-90*time.Minute).Format(time.RFC3339), now)
			if old {
				return "STALE", []string{"90 min old", "freshness limit 15 min"}
			}
			return "FRESH", nil
		}},
		{"S30", "apps", "NOT_PER_APP_EGRESS_PROOF", "Per-application public IP not observed", func(t *testing.T) (string, []string) {
			a := summarizeAppSockets(AppSocketCapture{Checked: true, TCPChecked: true, UDPChecked: true, ProcessCount: 2, VPNBound: 1, PhysicalBound: 1, NonVPNPhysicalBound: 1, PhysicalClassificationComplete: true}, now)
			for _, f := range a.Findings {
				if f == "NON_VPN_APP_PHYSICAL_BINDING_OBSERVED_NOT_EGRESS_PROOF" {
					return "NOT_PER_APP_EGRESS_PROOF", []string{f}
				}
			}
			return "FALSE_VERIFIED", nil
		}},
		{"S31", "streaming", "PLAYBACK_NOT_CONFIRMED_SMOOTH", "15-minute elapsed time modeled, not observed", func(t *testing.T) (string, []string) {
			return assessStability(StabilityReport{State: "COMPLETED", ElapsedS: 900, StartEgressConfirmed: true, EndEgressConfirmed: true}), []string{"no actual user video confirmation"}
		}},
		{"S32", "streaming", "VPN_PATH_NOT_CONFIRMED", "15-minute playback modeled, route exit still unproven", func(t *testing.T) (string, []string) {
			return assessStability(StabilityReport{State: "COMPLETED", ElapsedS: 900, StartEgressConfirmed: false, EndEgressConfirmed: false, UserReportedPlayback: "NO_STALLS"}), []string{"browser route cannot be inferred from local HTTPS"}
		}},
		{"S33", "egress", "IP_UNCHANGED_POSSIBLE_DIRECT_EGRESS", "Public IP source is modeled", func(t *testing.T) (string, []string) {
			base := PrivateBaseline{IP: "9.9.9.9", State: "VPN_DOWN", CheckedUTC: now.Add(-time.Minute)}
			s := VPNState{Checked: true, ActiveCount: 1, RoutePresent: true}
			return classifyBaseline(now, "9.9.9.9", base, s), []string{"VPN adapter up", "external IPv4 same as direct"}
		}},
		{"S34", "egress", "STALE_DIRECT_BASELINE", "Baseline older than 6 hours", func(t *testing.T) (string, []string) {
			base := PrivateBaseline{IP: "9.9.9.9", State: "VPN_DOWN", CheckedUTC: now.Add(-7 * time.Hour)}
			s := VPNState{Checked: true, ActiveCount: 1, RoutePresent: true}
			return classifyBaseline(now, "1.1.1.1", base, s), []string{"old direct baseline", "new public IP cannot prove tunnel"}
		}},
		{"S35", "route", "DIAGNOSTICS_UNAVAILABLE", "Windows snapshot not available", func(t *testing.T) (string, []string) {
			return connectionGuideAction(VPNState{}), []string{"no route snapshot", "must not claim VPN failed"}
		}},
		{"S36", "baseline", "BASELINE_UNAVAILABLE", "Amnezia may serve VLESS local proxy with no TUN; no disconnected direct evidence", func(t *testing.T) (string, []string) {
			s := VPNState{Checked: true, AppRunning: true, ActiveCount: 0}
			if !guideCanMeasureDirectBaseline(s) {
				return "BASELINE_UNAVAILABLE", []string{"client running", "no TUN", "cannot assume VPN disconnected"}
			}
			return "FALSE_DIRECT_BASELINE", nil
		}},
	}
	output := modeledMatrix{Schema: "0.3.6-model-1", Commit: os.Getenv("GITHUB_SHA"), Environment: "loopback HTTP/TLS + deterministic state scenarios", ModelOnly: true, Total: len(definitions), Cases: make([]modeledCase, 0, len(definitions))}
	for _, scenario := range definitions {
		var actual string
		var evidence []string
		t.Run(scenario.id, func(t *testing.T) {
			actual, evidence = scenario.run(t)
			if actual != scenario.want {
				t.Errorf("%s: got %s, want %s (%v)", scenario.area, actual, scenario.want, evidence)
			}
		})
		state := "PASS"
		if actual != scenario.want {
			state = "FAIL"
			output.Failed++
		} else {
			output.Passed++
		}
		if scenario.gap != "" {
			output.KnownFieldGaps++
		}
		output.Cases = append(output.Cases, modeledCase{ID: scenario.id, Area: scenario.area, Result: actual, Expected: scenario.want, Status: state, Evidence: evidence, FieldGap: scenario.gap})
	}
	if dest := os.Getenv("BYPASS_SIM_REPORT"); dest != "" {
		if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
			t.Fatal(err)
		}
		data, err := json.MarshalIndent(output, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(dest, append(data, '\n'), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if output.Failed != 0 {
		t.Fatalf("simulation failed %d/%d", output.Failed, output.Total)
	}
	t.Logf("FIELD MODEL: %d/%d PASS, %d scenarios retain explicit field-acceptance limits", output.Passed, output.Total, output.KnownFieldGaps)
}