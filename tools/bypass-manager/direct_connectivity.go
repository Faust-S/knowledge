package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Public, fixed connectivity endpoints are contacted only when the user presses
// Enable. They test the application's own TCP/TLS/HTTPS path, not the browser,
// any VPN tunnel or any specific blocked website. A captive-portal redirect,
// HTML response or HTTP error is not a successful connectivity probe.
type directProbeTarget struct {
	ID     string
	URL    string
	Expect int
	Body   string
}

var directProbeTargets = []directProbeTarget{
	{ID: "CHECK_A", URL: "https://connectivitycheck.gstatic.com/generate_204", Expect: http.StatusNoContent},
	{ID: "CHECK_B", URL: "https://cp.cloudflare.com/generate_204", Expect: http.StatusNoContent},
	{ID: "CHECK_C", URL: "https://www.msftconnecttest.com/connecttest.txt", Expect: http.StatusOK, Body: "Microsoft Connect Test"},
}

type DirectCheckSample struct {
	Source     string `json:"source"`
	State      string `json:"state"`
	DurationMS int64  `json:"duration_ms"`
}
type DirectCheckPhase struct {
	CompletedUTC string              `json:"completed_utc"`
	Passed       int                 `json:"passed"`
	Total        int                 `json:"total"`
	Samples      []DirectCheckSample `json:"samples"`
}
type DirectCheckReport struct {
	SchemaVersion  string            `json:"schema_version"`
	CheckedUTC     string            `json:"checked_utc"`
	Mode           string            `json:"mode"`
	EngineRunning  bool              `json:"engine_running"`
	State          string            `json:"state"`
	Before         *DirectCheckPhase `json:"before,omitempty"`
	After          *DirectCheckPhase `json:"after,omitempty"`
	EffectVerified bool              `json:"effect_verified"`
	Caveat         string            `json:"caveat"`
}

const directCheckCaveat = "Only fixed public HTTPS endpoints and program-origin traffic were checked. Results do not prove that DPI caused a change, that a blocked website is accessible, that the browser works, or that the public IP is hidden. No visited domains, IPs, VPN credentials or URLs are exported."

func testDirectProbe(ctx context.Context, client *http.Client, target directProbeTarget) (s DirectCheckSample) {
	start := time.Now()
	s = DirectCheckSample{Source: target.ID, State: "NETWORK_ERROR"}
	defer func() { s.DurationMS = time.Since(start).Milliseconds() }()
	req, err := http.NewRequestWithContext(ctx, "GET", target.URL, nil)
	if err != nil || req.URL.Scheme != "https" {
		return s
	}
	req.Header.Set("Accept-Encoding", "identity")
	resp, err := client.Do(req)
	if err != nil {
		var nerr net.Error
		if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(ctx.Err(), context.Canceled) || (errors.As(err, &nerr) && nerr.Timeout()) {
			s.State = "TIMEOUT"
		}
		return s
	}
	defer resp.Body.Close()
	if resp.Request == nil || resp.Request.URL.String() != target.URL {
		s.State = "UNEXPECTED_HTTP"
		return s
	}
	if resp.StatusCode != target.Expect {
		s.State = "UNEXPECTED_HTTP"
		return s
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 256))
	if err != nil {
		s.State = "INCOMPLETE_BODY"
		return s
	}
	if target.Body != "" && strings.TrimSpace(string(body)) != target.Body {
		s.State = "UNEXPECTED_BODY"
		return s
	}
	if target.Body == "" && len(body) != 0 {
		s.State = "UNEXPECTED_BODY"
		return s
	}
	s.State = "OK"
	return s
}

// All phases use a new TLS connection per request. A cached connection opened
// before WinDivert startup would invalidate the comparison after startup.
// Targets are fixed in production; tests inject httptest TLS endpoints only.
func probeDirectPhase(ctx context.Context, client *http.Client, targets []directProbeTarget) DirectCheckPhase {
	p := DirectCheckPhase{Total: len(targets), Samples: make([]DirectCheckSample, 0, len(targets))}
	if ctx.Err() != nil {
		p.CompletedUTC = utc()
		return p
	}
	// Three independent checks in parallel; a disconnected Windows machine
	// must not wait 3 x 7 seconds before the user can enable the filter.
	samples := make([]DirectCheckSample, len(targets))
	var wg sync.WaitGroup
	for i, target := range targets {
		wg.Add(1)
		go func(i int, t directProbeTarget) {
			defer wg.Done()
			attemptCtx, cancel := context.WithTimeout(ctx, 7*time.Second)
			defer cancel()
			samples[i] = testDirectProbe(attemptCtx, client, t)
		}(i, target)
	}
	wg.Wait()
	p.Samples = samples
	for _, sample := range samples {
		if sample.State == "OK" {
			p.Passed++
		}
	}
	p.CompletedUTC = utc()
	return p
}

func newDirectProbeClient() *http.Client {
	c := httpClient(7 * time.Second)
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return c
}
func directCheckOutcome(before, after *DirectCheckPhase, running bool) string {
	if !running {
		return "ENGINE_NOT_RUNNING"
	}
	if after == nil || after.Total != 3 || len(after.Samples) != after.Total {
		return "CHECK_INCOMPLETE"
	}
	if before == nil || before.Total != 3 || len(before.Samples) != before.Total {
		return "AFTER_ONLY"
	}
	switch {
	case before.Passed < 2 && after.Passed >= 2:
		return "GENERAL_HTTPS_CHANGE_OBSERVED"
	case before.Passed >= 2 && after.Passed >= 2:
		return "GENERAL_HTTPS_AVAILABLE"
	case before.Passed >= 2 && after.Passed < 2:
		return "GENERAL_HTTPS_DEGRADED"
	default:
		return "GENERAL_HTTPS_STILL_IMPAIRED"
	}
}
func buildDirectCheck(before, after *DirectCheckPhase, running bool) DirectCheckReport {
	return DirectCheckReport{SchemaVersion: "1.0", CheckedUTC: utc(), Mode: "DIRECT_AUTO_TLS", EngineRunning: running, State: directCheckOutcome(before, after, running), Before: before, After: after, EffectVerified: false, Caveat: directCheckCaveat}
}
func (m *Manager) saveDirectCheck(r DirectCheckReport) error {
	return saveJSON(filepath.Join(m.home, "results", "latest-direct-check.json"), r)
}
func directCheckSummary(r DirectCheckReport) string {
	if !r.EngineRunning {
		return "HTTPS проверка не проводилась: обработчик не включён."
	}
	if r.Before == nil || r.After == nil {
		return "Не удалось сопоставить HTTPS до и после запуска."
	}
	switch r.State {
	case "GENERAL_HTTPS_CHANGE_OBSERVED":
		return fmt.Sprintf("HTTPS до %d/3, после %d/3: доступность пробных сервисов выросла, причина не доказана.", r.Before.Passed, r.After.Passed)
	case "GENERAL_HTTPS_AVAILABLE":
		return fmt.Sprintf("HTTPS до %d/3, после %d/3: связь была доступна и без DPI.", r.Before.Passed, r.After.Passed)
	case "GENERAL_HTTPS_DEGRADED":
		return fmt.Sprintf("HTTPS до %d/3, после %d/3: доступность снизилась. Проверьте подключение.", r.Before.Passed, r.After.Passed)
	case "GENERAL_HTTPS_STILL_IMPAIRED":
		return fmt.Sprintf("HTTPS до %d/3, после %d/3: общая доступность всё ещё ограничена.", r.Before.Passed, r.After.Passed)
	default:
		return "Проверка HTTPS не завершена; улучшение не подтверждено."
	}
}

func validDirectPhase(p *DirectCheckPhase) bool {
	if p == nil {
		return true
	}
	if _, err := time.Parse(time.RFC3339Nano, p.CompletedUTC); err != nil {
		return false
	}
	if p.Total != 3 || p.Passed < 0 || p.Passed > 3 || len(p.Samples) > 3 || len(p.Samples) != p.Total {
		return false
	}
	ids := map[string]bool{}
	passed := 0
	for _, s := range p.Samples {
		if s.Source != "CHECK_A" && s.Source != "CHECK_B" && s.Source != "CHECK_C" {
			return false
		}
		if ids[s.Source] || s.DurationMS < 0 || s.DurationMS > 60000 {
			return false
		}
		ids[s.Source] = true
		switch s.State {
		case "OK":
			passed++
		case "NETWORK_ERROR", "TIMEOUT", "UNEXPECTED_HTTP", "INCOMPLETE_BODY", "UNEXPECTED_BODY":
		default:
			return false
		}
	}
	return passed == p.Passed
}
func validDirectCheck(r DirectCheckReport) bool {
	if r.SchemaVersion != "1.0" || r.Mode != "DIRECT_AUTO_TLS" || r.EffectVerified || r.Caveat != directCheckCaveat {
		return false
	}
	if !validDirectPhase(r.Before) || !validDirectPhase(r.After) {
		return false
	}
	if _, err := time.Parse(time.RFC3339Nano, r.CheckedUTC); err != nil {
		return false
	}
	return r.State == directCheckOutcome(r.Before, r.After, r.EngineRunning)
}

// directMeasuredStart executes the actual start path between fresh TCP/TLS
// phases. Injectable operations allow a real TLS loopback model to exercise
// ordering, failed launch, process exit, and cancel without packet capture.
// The verdict never asserts that DPI caused any observed improvement.
func directMeasuredStart(
	ctx context.Context,
	start func(context.Context) error,
	verify func(context.Context) (bool, error),
	probe func(context.Context) DirectCheckPhase,
) (DirectCheckReport, error) {
	baseline := probe(ctx)
	before := &baseline
	if err := ctx.Err(); err != nil {
		return buildDirectCheck(before, nil, false), err
	}
	if err := start(ctx); err != nil {
		return buildDirectCheck(before, nil, false), err
	}
	if err := ctx.Err(); err != nil {
		return buildDirectCheck(before, nil, false), err
	}
	followup := probe(ctx)
	after := &followup
	if err := ctx.Err(); err != nil {
		return buildDirectCheck(before, after, false), err
	}
	ok, err := verify(ctx)
	if err != nil {
		return buildDirectCheck(before, after, false), err
	}
	if !ok {
		return buildDirectCheck(before, after, false), errors.New("direct engine exited during connectivity checks")
	}
	return buildDirectCheck(before, after, true), nil
}
