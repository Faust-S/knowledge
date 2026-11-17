package main

import (
	"bufio"
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

//go:embed runtime/Scripts/*.ps1 runtime/Scripts/*.psm1 runtime/Profiles/profiles.json
var embedded embed.FS

const version = "0.3.0-alpha"

// The Windows program deliberately does not start, stop, configure, or read secrets from Amnezia.
// It controls only the one winws2 instance it owns through the audited PowerShell adapter.
// A successful probe is DATA-PATH evidence, never a claimed native AWG handshake.

type Config struct {
	EndpointIPv4         string `json:"endpoint_ipv4,omitempty"`
	Port                 int    `json:"port"`
	Transport            string `json:"transport"`
	AdapterName          string `json:"adapter_name,omitempty"`
	BundleRoot           string `json:"bundle_root"`
	LastConfirmedProfile string `json:"last_confirmed_profile,omitempty"`
	PreferredProfile     string `json:"preferred_profile,omitempty"`
	LastConfirmedAt      string `json:"last_confirmed_at,omitempty"`
}

type Profile struct {
	Transport    string `json:"transport"`
	Experimental bool   `json:"experimental"`
	Why          string `json:"why"`
	Desync       string `json:"desync"`
}
type Manifest struct {
	Schema   string             `json:"schema"`
	Profiles map[string]Profile `json:"profiles"`
}

type EgressResult struct {
	IP        string         `json:"ip,omitempty"`
	Agreement bool           `json:"agreement"`
	Samples   []EgressSample `json:"samples"`
}
type EgressSample struct {
	Provider     string `json:"provider"`
	IP           string `json:"ip,omitempty"`
	Status       string `json:"status"`
	Milliseconds int64  `json:"milliseconds"`
}

type AdapterStats struct {
	Name          string `json:"name"`
	Status        string `json:"status"`
	ReceivedBytes int64  `json:"received_bytes"`
	SentBytes     int64  `json:"sent_bytes"`
}

type DownloadResult struct {
	Timings         TransferTimings `json:"timings"`
	HTTPStatus      int             `json:"http_status,omitempty"`
	URL             string          `json:"url"`
	Bytes           int64           `json:"bytes"`
	ExpectedBytes   int64           `json:"expected_bytes"`
	DurationSeconds float64         `json:"duration_seconds"`
	Mbps            float64         `json:"mbps"`
	OK              bool            `json:"ok"`
	Error           string          `json:"error,omitempty"`
}

type EndpointRoute struct {
	Name        string `json:"name"`
	Index       int    `json:"index"`
	Destination string `json:"destination"`
	Status      string `json:"status,omitempty"`
}
type Probe struct {
	TimeUTC              string           `json:"time_utc"`
	EndpointRoute        *EndpointRoute   `json:"endpoint_route,omitempty"`
	RouteLoopSuspected   bool             `json:"route_loop_suspected"`
	DNSExposure          *DNSExposure     `json:"dns_exposure,omitempty"`
	DNSExposureSuspected bool             `json:"dns_exposure_suspected"`
	DNSPrivacyNote       string           `json:"dns_privacy_note,omitempty"`
	Egress               EgressResult     `json:"egress"`
	EgressIPv6           *EgressResult    `json:"egress_ipv6,omitempty"`
	IPv6LeakSuspected    bool             `json:"ipv6_leak_suspected"`
	PrivacyNote          string           `json:"privacy_note,omitempty"`
	Downloads            []DownloadResult `json:"downloads"`
	AdapterBefore        *AdapterStats    `json:"adapter_before,omitempty"`
	AdapterAfter         *AdapterStats    `json:"adapter_after,omitempty"`
	AdapterFlow          bool             `json:"adapter_flow"`
	EgressChanged        bool             `json:"egress_changed"`
	Success              bool             `json:"success"`
	Reason               string           `json:"reason"`
}

type Trial struct {
	Profile      string  `json:"profile"`
	StartedUTC   string  `json:"started_utc"`
	CompletedUTC string  `json:"completed_utc,omitempty"`
	Status       string  `json:"status"`
	Attempts     []Probe `json:"attempts"`
	Error        string  `json:"error,omitempty"`
	ObservedMbps float64 `json:"observed_mbps,omitempty"`
}

type Report struct {
	Version       string        `json:"version"`
	StartedUTC    string        `json:"started_utc"`
	EndedUTC      string        `json:"ended_utc,omitempty"`
	EndpointIPv4  string        `json:"endpoint_ipv4,omitempty"`
	Port          int           `json:"port"`
	Transport     string        `json:"transport"`
	AdapterName   string        `json:"adapter_name,omitempty"`
	Baseline      EgressResult  `json:"baseline"`
	BaselineIPv6  *EgressResult `json:"baseline_ipv6,omitempty"`
	Trials        []Trial       `json:"trials"`
	Monitoring    []Probe       `json:"monitoring,omitempty"`
	ChosenProfile string        `json:"chosen_profile,omitempty"`
	Status        string        `json:"status"`
	Caveat        string        `json:"caveat"`
}

type Manager struct {
	ask func(string) (string, error) // Optional GUI confirmation; no VPN automation.

	cfg          Config
	home         string
	runtimeRoot  string
	stateFolder  string
	logDir       string
	reader       *bufio.Reader
	report       Report
	mu           sync.Mutex
	interrupted  bool
	input        io.Reader
	output       io.Writer
	profileState string
}

func utc() string { return time.Now().UTC().Format(time.RFC3339Nano) }

func defaultRoot() string {
	if h := os.Getenv("LOCALAPPDATA"); h != "" {
		return filepath.Join(h, "BypassManager")
	}
	if h, err := os.UserConfigDir(); err == nil {
		return filepath.Join(h, "BypassManager")
	}
	return filepath.Join(".", "BypassManager")
}

func saveJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err = os.WriteFile(tmp, append(b, '\n'), 0600); err != nil {
		return err
	}
	if err = os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

func loadConfig(path string) (Config, error) {
	var c Config
	b, err := os.ReadFile(path)
	if err != nil {
		return c, err
	}
	err = json.Unmarshal(b, &c)
	return c, err
}

func validIPv4(value string) bool {
	ip := net.ParseIP(value)
	if ip == nil || ip.To4() == nil {
		return false
	}
	if ip.String() != value {
		return false
	}
	a := ip.To4()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	if a[0] == 100 && a[1] >= 64 && a[1] <= 127 {
		return false
	}
	if a[0] == 192 && a[1] == 0 && a[2] == 2 {
		return false
	}
	if a[0] == 198 && a[1] == 51 && a[2] == 100 {
		return false
	}
	if a[0] == 203 && a[1] == 0 && a[2] == 113 {
		return false
	}
	if a[0] == 198 && (a[1] == 18 || a[1] == 19) {
		return false
	}
	if a[0] == 0 || a[0] >= 224 {
		return false
	}
	return true
}
func transportProtocol(t string) string {
	if t == "AWG-UDP" {
		return "UDP"
	}
	return "TCP"
}
func validateConfig(c Config) error {
	if !validIPv4(c.EndpointIPv4) {
		return errors.New("нужен реальный публичный IPv4 входного узла VPN (не адрес документации)")
	}
	if c.Port < 1 || c.Port > 65535 {
		return errors.New("порт должен быть 1..65535")
	}
	if c.Transport != "AWG-UDP" && c.Transport != "REALITY-TCP" && c.Transport != "XHTTP-TCP" {
		return errors.New("транспорт: AWG-UDP, REALITY-TCP или XHTTP-TCP")
	}
	if strings.TrimSpace(c.BundleRoot) == "" {
		return errors.New("укажите официальный каталог zapret-winws с winws2.exe")
	}
	return nil
}

// The unmodified control NONE is always first. A previously confirmed
// strategy, then the operator's preferred candidate, are tested next.
// Every candidate still requires a fresh VPN reconnection performed externally.
func profileOrder(c Config, m Manifest) []string {
	var available []string
	if transportProtocol(c.Transport) == "UDP" {
		available = []string{"UDP-FAKE", "UDP-REPEAT"}
	} else {
		available = []string{"TLS-SPLIT", "TLS-DISORDER", "TLS-FAKESEQ", "TLS-FAKETTL"}
	}
	result := []string{"NONE"}
	for _, name := range []string{c.LastConfirmedProfile, c.PreferredProfile} {
		if name != "NONE" && contains(available, name) {
			if _, exists := m.Profiles[name]; exists && !contains(result, name) {
				result = append(result, name)
			}
		}
	}
	for _, name := range available {
		if _, exists := m.Profiles[name]; exists && !contains(result, name) {
			result = append(result, name)
		}
	}
	return result
}
func contains(a []string, s string) bool {
	for _, x := range a {
		if x == s {
			return true
		}
	}
	return false
}

func (m *Manager) println(args ...any)          { fmt.Fprintln(m.output, args...) }
func (m *Manager) printf(f string, args ...any) { fmt.Fprintf(m.output, f, args...) }
func (m *Manager) prompt(text string) (string, error) {
	if m.ask != nil {
		return m.ask(text)
	}
	m.printf("\n%s\n> ", text)
	s, err := m.reader.ReadString('\n')
	if err != nil {
		return "", fmt.Errorf("не удалось получить подтверждение пользователя: %w", err)
	}
	return strings.TrimSpace(s), nil
}

// Do not rewrite scripts while another local diagnostic is starting.
var runtimeWriteMu sync.Mutex

func (m *Manager) ensureRuntime() error {
	runtimeWriteMu.Lock()
	defer runtimeWriteMu.Unlock()
	for _, name := range []string{"Scripts/Common.psm1", "Scripts/Start-Profile.ps1", "Scripts/Get-AdapterStats.ps1", "Scripts/Find-VpnAdapter.ps1", "Scripts/Get-EndpointRoute.ps1", "Scripts/Get-DnsExposure.ps1", "Scripts/Get-VpnStatus.ps1", "Scripts/Get-PathEvidence.ps1", "Scripts/Get-AppSockets.ps1", "Scripts/Get-LocalProxyPorts.ps1", "Scripts/Get-OuterEndpoint.ps1", "Scripts/Temporary-MTU.ps1", "Profiles/profiles.json"} {
		source := "runtime/" + name
		data, err := embedded.ReadFile(source)
		if err != nil {
			return err
		}
		target := filepath.Join(m.runtimeRoot, name)
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return err
		}
		// Skip identical files: refresh and DPI activities may overlap.
		// Changed scripts are always restored from the signed-in-binary embed.
		if existing, readErr := os.ReadFile(target); readErr == nil && bytes.Equal(existing, data) {
			continue
		}
		if err = os.WriteFile(target, data, 0600); err != nil {
			return err
		}
	}
	return nil
}
func (m *Manager) powerShell(ctx context.Context, script string, args ...string) (string, error) {
	all := []string{"-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", filepath.Join(m.runtimeRoot, "Scripts", script)}
	all = append(all, args...)
	cmd := exec.CommandContext(ctx, "powershell.exe", all...)
	// A launched child (for example, the original winws2) may inherit stdout
	// handles after PowerShell exits or is killed. Without WaitDelay,
	// CombinedOutput can wait indefinitely for those inherited pipes to close,
	// despite the caller's context deadline. Bound this wait as well.
	cmd.WaitDelay = 3 * time.Second
	// Win32 GUI applications must not show a PowerShell console on every poll.
	hideChildConsole(cmd)
	cmd.Dir = m.runtimeRoot
	b, err := cmd.CombinedOutput()
	text := strings.TrimSpace(string(b))
	if err != nil {
		return text, fmt.Errorf("PowerShell %s: %w: %s", script, err, limit(text, 1300))
	}
	return text, nil
}
func limit(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

func (m *Manager) ownStateExists() bool {
	_, err := os.Stat(filepath.Join(m.stateFolder, "winws2-owned.json"))
	return err == nil
}
func (m *Manager) stopFilter() error {
	if !m.ownStateExists() {
		m.profileState = ""
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := m.powerShell(ctx, "Start-Profile.ps1", "-Action", "Stop", "-StateFolder", m.stateFolder)
	if err != nil {
		m.println("ОШИБКА остановки winws2:", err)
		return err
	}
	m.profileState = ""
	m.println("Наш winws2 остановлен:", limit(out, 200))
	return nil
}
func (m *Manager) startFilter(profile string) error {
	if profile == "NONE" {
		m.profileState = "NONE"
		return nil
	}
	if m.ownStateExists() {
		return errors.New("найден сохранённый процесс winws2; требуется остановить его перед запуском")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	args := []string{"-Action", "Start", "-EndpointIPv4", m.cfg.EndpointIPv4, "-Port", strconv.Itoa(m.cfg.Port), "-Transport", transportProtocol(m.cfg.Transport), "-Profile", profile, "-BundleRoot", m.cfg.BundleRoot, "-StateFolder", m.stateFolder, "-DryRun"}
	out, err := m.powerShell(ctx, "Start-Profile.ps1", args...)
	if err != nil {
		return fmt.Errorf("исходные winws2/Lua не приняли профиль: %w", err)
	}
	m.println("Проверка аргументов и Lua:", limit(out, 450))
	m.println("Пробный запуск завершён, начинаю запуск собственного DPI. Ожидание ограничено 40 секундами плюс завершение каналов вывода.")
	args = args[:len(args)-1] // remove -DryRun
	out, err = m.powerShell(ctx, "Start-Profile.ps1", args...)
	if err != nil {
		return fmt.Errorf("не удалось запустить winws2: %w", err)
	}
	m.profileState = profile
	m.println("DPI включён:", profile, limit(out, 150))
	return nil
}

var egressURLs = []string{"https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com/"}

// Forcing tcp6 is essential. A dual-stack echo service could otherwise
// return an IPv4 result and falsely declare that IPv6 was tested.
var ipv6EgressURLs = []string{"https://api6.ipify.org", "https://ipv6.icanhazip.com", "https://ifconfig.co/ip"}

func httpClient(timeout time.Duration) *http.Client {
	return httpClientFamily(timeout, "tcp4")
}

func httpClientFamily(timeout time.Duration, family string) *http.Client {
	if family != "tcp4" && family != "tcp6" {
		panic("network family must be tcp4 or tcp6")
	}
	dialer := &net.Dialer{Timeout: 6 * time.Second, KeepAlive: -1}
	trans := &http.Transport{Proxy: nil, DisableKeepAlives: true, ForceAttemptHTTP2: false, MaxIdleConns: 0, TLSHandshakeTimeout: 6 * time.Second, ResponseHeaderTimeout: 8 * time.Second, DialContext: func(ctx context.Context, _ string, address string) (net.Conn, error) {
		return dialer.DialContext(ctx, family, address)
	}}
	return &http.Client{Transport: trans, Timeout: timeout, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 2 {
			return errors.New("too many redirects")
		}
		if req.URL.Scheme != "https" {
			return errors.New("redirect to insecure HTTP blocked")
		}
		return nil
	}}
}
func (m *Manager) egress(ctx context.Context) EgressResult {
	return collectEgress(ctx, egressURLs, httpClient(10*time.Second), validIPv4)
}

func (m *Manager) egressIPv6(ctx context.Context) EgressResult {
	return collectEgress(ctx, ipv6EgressURLs, httpClientFamily(10*time.Second, "tcp6"), validIPv6)
}

func collectEgress(ctx context.Context, urls []string, c *http.Client, valid func(string) bool) EgressResult {
	res := EgressResult{}
	votes := map[string]int{}
	type sample struct {
		idx   int
		value EgressSample
	}
	ch := make(chan sample, len(urls))
	for i, url := range urls {
		go func(i int, url string) {
			start := time.Now()
			r := EgressSample{Provider: url, Status: "ERROR"}
			req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
			req.Header.Set("Accept-Encoding", "identity")
			resp, err := c.Do(req)
			if err == nil {
				if resp.StatusCode == 200 {
					data, e := io.ReadAll(io.LimitReader(resp.Body, 128))
					ip := strings.TrimSpace(string(data))
					if e == nil && valid(ip) {
						r.IP = ip
						r.Status = "OK"
					}
				}
				resp.Body.Close()
			}
			r.Milliseconds = time.Since(start).Milliseconds()
			ch <- sample{i, r}
		}(i, url)
	}
	results := make([]EgressSample, len(urls))
	for range results {
		r := <-ch
		results[r.idx] = r.value
	}
	res.Samples = results
	for _, r := range results {
		if r.Status == "OK" {
			votes[r.IP]++
		}
	}
	for ip, n := range votes {
		if n >= 2 {
			res.Agreement = true
			res.IP = ip
		}
	}
	return res
}

// A full 1MiB HTTPS payload is required; HTTP 200 with zero data is NOT success.
func download(ctx context.Context, size int64) DownloadResult {
	url := fmt.Sprintf("https://speed.cloudflare.com/__down?bytes=%d", size)
	return downloadFrom(ctx, size, url)
}
func downloadFrom(ctx context.Context, size int64, url string) (r DownloadResult) {
	r = DownloadResult{URL: url, ExpectedBytes: size}
	c := httpClient(20 * time.Second)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		r.Error = "REQUEST_ERROR"
		return r
	}
	req.Header.Set("Accept-Encoding", "identity")
	req, timings := tracedRequest(req)
	defer func() { r.Timings = timings() }()
	start := time.Now()
	resp, err := c.Do(req)
	if err != nil {
		r.Error = limit(err.Error(), 180)
		return r
	}
	defer resp.Body.Close()
	r.HTTPStatus = resp.StatusCode
	if resp.StatusCode != 200 {
		r.Error = fmt.Sprintf("HTTP %d", resp.StatusCode)
		return r
	}
	n, err := io.Copy(io.Discard, io.LimitReader(resp.Body, size+1))
	r.DurationSeconds = time.Since(start).Seconds()
	r.Bytes = n
	if err != nil {
		r.Error = limit(err.Error(), 180)
		return r
	}
	if n != size {
		r.Error = fmt.Sprintf("received %d instead of %d", n, size)
		return r
	}
	r.OK = true
	if r.DurationSeconds > 0 {
		r.Mbps = float64(n) * 8.0 / r.DurationSeconds / 1e6
	}
	return r
}

func (m *Manager) adapterStats(ctx context.Context) (*AdapterStats, error) {
	text, err := m.powerShell(ctx, "Get-AdapterStats.ps1", "-Name", m.cfg.AdapterName)
	if err != nil {
		return nil, err
	}
	var a AdapterStats
	if err := json.Unmarshal([]byte(text), &a); err != nil {
		return nil, fmt.Errorf("данные адаптера не в JSON: %w; %s", err, limit(text, 300))
	}
	return &a, nil
}
func (m *Manager) discoverAdapter(ctx context.Context) error {
	if strings.TrimSpace(m.cfg.AdapterName) != "" {
		return nil
	}
	text, err := m.powerShell(ctx, "Find-VpnAdapter.ps1")
	if err != nil {
		return err
	}
	var matches []struct {
		Name        string `json:"Name"`
		Description string `json:"InterfaceDescription"`
		Status      string `json:"Status"`
	}
	if err := json.Unmarshal([]byte(text), &matches); err != nil {
		return fmt.Errorf("обнаружение адаптеров не вернуло список: %w", err)
	}
	if len(matches) != 1 {
		return fmt.Errorf("автовыбор неоднозначен: найдено %d активных VPN-адаптеров (укажите точное имя через --adapter); конфигурация Amnezia не читается", len(matches))
	}
	m.cfg.AdapterName = matches[0].Name
	m.report.AdapterName = m.cfg.AdapterName
	m.println("Обнаружен один подходящий VPN-адаптер:", m.cfg.AdapterName)
	return saveJSON(filepath.Join(m.home, "settings.json"), m.cfg)
}
func (m *Manager) endpointRoute(ctx context.Context) *EndpointRoute {
	text, err := m.powerShell(ctx, "Get-EndpointRoute.ps1", "-IPv4", m.cfg.EndpointIPv4)
	if err != nil || text == "" {
		return nil
	}
	var r EndpointRoute
	if json.Unmarshal([]byte(text), &r) != nil {
		return nil
	}
	return &r
}

func (m *Manager) vpnState(ctx context.Context) (VPNState, error) {
	text, err := m.powerShell(ctx, "Get-VpnStatus.ps1")
	if err != nil {
		return VPNState{}, err
	}
	return parseVPNState([]byte(text))
}

func (m *Manager) dnsExposure(ctx context.Context) *DNSExposure {
	queryCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	text, err := m.powerShell(queryCtx, "Get-DnsExposure.ps1", "-VpnAdapterName", m.cfg.AdapterName)
	if err != nil {
		return nil
	}
	var summary DNSExposure
	if json.Unmarshal([]byte(text), &summary) != nil || !summary.Checked {
		return nil
	}
	return &summary
}

func (m *Manager) probe(ctx context.Context, baseline EgressResult) Probe {
	return m.probeWithSizes(ctx, baseline, []int64{131072, 1048576})
}
func (m *Manager) probeWithSizes(ctx context.Context, baseline EgressResult, sizes []int64) Probe {
	p := Probe{TimeUTC: utc()}
	if m.cfg.AdapterName == "" {
		if err := m.discoverAdapter(ctx); err != nil {
			p.Reason = "нужна точная идентификация адаптера: " + err.Error()
			return p
		}
	}
	p.EndpointRoute = m.endpointRoute(ctx)
	if !endpointRouteObserved(p.EndpointRoute) {
		p.Reason = routePreflightReason(p.EndpointRoute)
		return p
	}
	if strings.EqualFold(p.EndpointRoute.Name, m.cfg.AdapterName) {
		p.RouteLoopSuspected = true
		p.Reason = "внешний IP VPN направлен обратно через VPN-адаптер; цикл маршрутизации"
		return p
	}
	// Ensure adapter activity is measured strictly around the actual successful payload transfer.
	before, err := m.adapterStats(ctx)
	if err == nil {
		p.AdapterBefore = before
	}
	p.DNSExposure = m.dnsExposure(ctx)
	p.DNSExposureSuspected, p.DNSPrivacyNote = assessDNSExposure(p.DNSExposure)
	p.Egress = m.egress(ctx)
	connectedIPv6 := m.egressIPv6(ctx)
	p.EgressIPv6 = &connectedIPv6
	if m.report.BaselineIPv6 != nil {
		p.IPv6LeakSuspected, p.PrivacyNote = assessIPv6Exposure(*m.report.BaselineIPv6, connectedIPv6)
	} else {
		p.PrivacyNote = "IPv6 baseline not measured; privacy unverified"
	}
	if p.Egress.Agreement && baseline.Agreement && p.Egress.IP != baseline.IP {
		p.EgressChanged = true
	}
	if !p.EgressChanged {
		p.Reason = "выходной адрес не подтверждён как отличающийся от исходного; возможно, VPN не передаёт трафик"
		return p
	}
	for _, size := range sizes {
		d := download(ctx, size)
		p.Downloads = append(p.Downloads, d)
		if !d.OK {
			break
		}
	}
	after, err := m.adapterStats(ctx)
	if err == nil {
		p.AdapterAfter = after
	}
	if p.AdapterBefore != nil && p.AdapterAfter != nil {
		p.AdapterFlow = p.AdapterBefore.Name == p.AdapterAfter.Name && strings.EqualFold(p.AdapterAfter.Status, "Up") && p.AdapterAfter.ReceivedBytes > p.AdapterBefore.ReceivedBytes && p.AdapterAfter.SentBytes > p.AdapterBefore.SentBytes
	}
	// A single pure policy decides whether the observations qualify as a data-path result.
	p.Success, p.Reason = assessDataPath(p, baseline, len(sizes))
	return p
}

func (m *Manager) logPath() string {
	return filepath.Join(m.logDir, "session-"+strings.ReplaceAll(m.report.StartedUTC, ":", "-")+".json")
}
func (m *Manager) persist() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := saveJSON(filepath.Join(m.logDir, "latest-session.json"), redactedReport(m.report)); err != nil {
		m.println("Ошибка журнала:", err)
	}
	if m.report.StartedUTC != "" {
		if err := saveJSON(m.logPath(), redactedReport(m.report)); err != nil {
			m.println("Ошибка истории:", err)
		}
	}
}

func (m *Manager) attempt(ctx context.Context, profile string, baseline EgressResult) (Trial, bool) {
	trial := Trial{Profile: profile, StartedUTC: utc(), Status: "NOT_VERIFIED"}
	if err := m.startFilter(profile); err != nil {
		trial.Status = "PROFILE_START_ERROR"
		trial.Error = err.Error()
		trial.CompletedUTC = utc()
		return trial, false
	}
	var watchdog *trialWatchdog
	if profile != "NONE" {
		watchdog = startTrialWatchdog(ctx, trialFilterMaxWait, func() {
			m.println("DPI trial expired or was cancelled; restoring only our owned filter")
			if err := m.stopFilter(); err != nil {
				m.println("DPI restoration failed:", redactText(err.Error()))
			}
		})
		defer watchdog.Stop()
	}
	if _, err := m.prompt("Теперь ПОДКЛЮЧИТЕ Amnezia самостоятельно. Если она показывает ошибку, тоже нажмите Enter. Нажмите Enter после попытки подключения:"); err != nil {
		trial.Error = err.Error()
		trial.Status = "INTERRUPTED"
		trial.CompletedUTC = utc()
		return trial, false
	}
	if watchdog.Expired() {
		trial.Status = "PROFILE_TIMEOUT"
		trial.CompletedUTC = utc()
		return trial, false
	}
	if err := ctx.Err(); err != nil {
		trial.Status = "INTERRUPTED"
		trial.Error = err.Error()
		trial.CompletedUTC = utc()
		return trial, false
	}
	m.println("Проверяю фактическую передачу через VPN...")
	for i := 0; i < 3; i++ {
		if watchdog.Expired() {
			trial.Status = "PROFILE_TIMEOUT"
			break
		}
		if ctx.Err() != nil {
			trial.Status = "INTERRUPTED"
			break
		}
		p := m.probe(ctx, baseline)
		if watchdog.Expired() {
			trial.Status = "PROFILE_TIMEOUT"
			break
		}
		trial.Attempts = append(trial.Attempts, p)
		// A missing/looped OS route is a broken prerequisite, not evidence
		// that another desynchronization strategy should be tried.
		if routePreflightBlocked(p) {
			trial.Status = "ROUTE_PRECHECK_BLOCKED"
			trial.Error = p.Reason
			trial.CompletedUTC = utc()
			return trial, false
		}
		if p.Success {
			m.printf("Подтверждён IPv4-путь данных, проба %d. Выходной IP: %s\n", i+1, p.Egress.IP)
			if p.IPv6LeakSuspected {
				m.println("ВНИМАНИЕ: исходный IPv6-выход остался прежним при работающем IPv4 VPN; возможен обход туннеля.")
			}
			if p.DNSExposureSuspected {
				m.println("ВНИМАНИЕ: в Windows настроены DNS-маршруты вне VPN. Это риск, а не наблюдавшаяся утечка DNS.")
			}
		} else {
			m.printf("Проба %d не подтверждена: %s\n", i+1, p.Reason)
		}
		if i >= 1 && p.Success && trial.Attempts[i-1].Success {
			// Require two adjacent independent successes, not one lucky response.
			trial.Status = "DATA_PATH_CONFIRMED"
			speeds := []float64{}
			for _, attempt := range trial.Attempts {
				for _, d := range attempt.Downloads {
					if d.OK {
						speeds = append(speeds, d.Mbps)
					}
				}
			}
			sort.Float64s(speeds)
			if len(speeds) > 0 {
				trial.ObservedMbps = speeds[len(speeds)/2]
			}
			trial.CompletedUTC = utc()
			return trial, true
		}
		if i < 2 {
			select {
			case <-time.After(6 * time.Second):
			case <-ctx.Done():
				break
			}
		}
	}
	trial.CompletedUTC = utc()
	return trial, false
}

func (m *Manager) monitor(ctx context.Context, baseline EgressResult) bool {
	m.println("\nРежим наблюдения. Проверка через 45 секунд. Ctrl+C остановит НАШ winws2; Amnezia не затрагивается.")
	failures := 0
	checks := 0
	for {
		select {
		case <-ctx.Done():
			return false
		case <-time.After(45 * time.Second):
		}
		checks++
		sizes := []int64{131072}
		if checks%10 == 0 {
			sizes = []int64{131072, 1048576}
		}
		p := m.probeWithSizes(ctx, baseline, sizes)
		m.report.Monitoring = appendBoundedMonitoring(m.report.Monitoring, p)
		if p.IPv6LeakSuspected {
			m.report.Status = "DATA_PATH_OBSERVED_IPV6_LEAK_SUSPECTED"
			m.println("ВНИМАНИЕ: возможна утечка IPv6 вне VPN.")
		}
		if p.DNSExposureSuspected {
			m.report.Status = "DATA_PATH_OBSERVED_DNS_EXPOSURE_SUSPECTED"
			m.println("ВНИМАНИЕ: DNS-серверы имеют маршруты вне VPN; это пассивная оценка, не доказанная утечка.")
		}
		m.persist()
		if p.Success {
			failures = 0
			m.printf("%s  VPN-трафик подтверждён, IP %s; DPI %s\n", time.Now().Format("15:04:05"), p.Egress.IP, m.profileState)
		} else {
			failures++
			m.printf("%s  Сбой %d/3: %s\n", time.Now().Format("15:04:05"), failures, p.Reason)
			if failures >= 3 {
				return true
			}
		}
	}
}

func (m *Manager) run(ctx context.Context) error {
	m.report = Report{Version: version, StartedUTC: utc(), Port: m.cfg.Port, Transport: m.cfg.Transport, Status: "NOT_ACCEPTED", Caveat: "IPv4 data-path only. IPv6 egress comparison and passive OS DNS-route inspection cannot prove DNS leak freedom, WebRTC or browser anonymity. Native VPN handshake, long-term filtering and field acceptance are NOT verified."}
	if err := m.ensureRuntime(); err != nil {
		return err
	}
	if err := os.MkdirAll(m.logDir, 0700); err != nil {
		return err
	}
	if m.ownStateExists() {
		m.println("Найдено сохранённое состояние нашего winws2 с прошлого запуска.")
		answer, _ := m.prompt("Остановить только ранее сохранённый и проверенный собственный процесс? [д/н]")
		if strings.ToLower(answer) != "д" && strings.ToLower(answer) != "y" {
			return errors.New("старый winws2 нужно разрешить вручную; запуск отменён")
		}
		if err := m.stopFilter(); err != nil {
			return err
		}
	}
	// Conflicting filters invalidate unmodified control and cannot be silently killed.
	ctxC, cancel := context.WithTimeout(ctx, 9*time.Second)
	ps := `$a=@(Get-Process -Name 'winws2','winws','goodbyedpi','byedpi' -ErrorAction SilentlyContinue|Select-Object -ExpandProperty ProcessName);$a -join ','`
	process := exec.CommandContext(ctxC, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps)
	hideChildConsole(process)
	b, _ := process.CombinedOutput()
	cancel()
	if v := strings.TrimSpace(string(b)); v != "" {
		return fmt.Errorf("найдены сторонние DPI-процессы (%s); для чистого сравнения остановите их самостоятельно", v)
	}
	m.println("\nУсловия контрольного измерения: Amnezia отключена, другие DPI-инструменты остановлены.")
	if _, err := m.prompt("Самостоятельно ОТКЛЮЧИТЕ Amnezia (приложение оставьте открытым) и нажмите Enter:"); err != nil {
		return err
	}
	baseline := m.egress(ctx)
	m.report.Baseline = baseline
	baselineIPv6 := m.egressIPv6(ctx)
	m.report.BaselineIPv6 = &baselineIPv6
	m.persist()
	if !baseline.Agreement {
		return errors.New("нет согласованного исходного публичного IP (2 источника из 3). Не подбираем профиль по недостоверным данным")
	}
	m.println("Контрольный внешний IP:", baseline.IP)
	profilesFile, _ := embedded.ReadFile("runtime/Profiles/profiles.json")
	var manifest Manifest
	if err := json.Unmarshal(profilesFile, &manifest); err != nil {
		return err
	}
	order := profileOrder(m.cfg, manifest)
	m.println("Очередность:", strings.Join(order, " -> "))
	for idx := 0; idx < len(order); idx++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		name := order[idx]
		if idx > 0 {
			m.println("\nСмена стратегии требует нового VPN-рукопожатия, поэтому сначала отключите Amnezia.")
			if _, err := m.prompt("ОТКЛЮЧИТЕ VPN в Amnezia и нажмите Enter:"); err != nil {
				return err
			}
			if err := m.stopFilter(); err != nil {
				return err
			}
		}
		m.printf("\n========== Вариант %d/%d: %s ==========\n", idx+1, len(order), name)
		// No DPI engine is needed for the mandatory NONE control. If the
		// standalone VPN works unchanged, avoid all upstream downloads.
		// A corrupt or incomplete engine is never silently repaired.
		if err := ensureEngineForProfile(name,
			func() bool { return enginePresent(m.cfg.BundleRoot) },
			func() error { return installUpstream(ctx, m.cfg.BundleRoot, m.prompt, m.output) }); err != nil {
			m.report.Status = "ENGINE_UNAVAILABLE"
			m.persist()
			return fmt.Errorf("не удалось подготовить оригинальный DPI-движок: %w", err)
		}
		trial, ok := m.attempt(ctx, name, baseline)
		m.report.Trials = append(m.report.Trials, trial)
		m.persist()
		if !ok {
			m.println("Вариант не подтверждён. Причина:", trial.Status, trial.Error)
			if trial.Status == "ROUTE_PRECHECK_BLOCKED" {
				m.report.Status = "ROUTE_PRECHECK_BLOCKED"
				m.persist()
				return errors.New("DPI не включён: сначала восстановите маршрут внешнего VPN-узла или проверьте фактический адрес подключения")
			}
			continue
		}
		m.report.ChosenProfile = name
		m.report.Status = "DATA_PATH_OBSERVED_NOT_FIELD_ACCEPTED"
		if anyIPv6LeakSuspected(trial.Attempts) {
			m.report.Status = "DATA_PATH_OBSERVED_IPV6_LEAK_SUSPECTED"
		}
		if anyDNSExposureSuspected(trial.Attempts) {
			m.report.Status = "DATA_PATH_OBSERVED_DNS_EXPOSURE_SUSPECTED"
		}
		m.persist()
		if name != "NONE" {
			m.cfg.LastConfirmedProfile = name
		} else {
			m.cfg.LastConfirmedProfile = "NONE"
		}
		m.cfg.LastConfirmedAt = utc()
		if err := saveJSON(filepath.Join(m.home, "settings.json"), m.cfg); err != nil {
			m.println("Не удалось сохранить профиль:", err)
		}
		m.println("\nПодтверждена передача данных. Сохранил вариант", name, "; начался контроль устойчивости.")
		if m.monitor(ctx, baseline) {
			m.println("Несколько измерений подряд не подтвердили передачу; отменяю доверие к предыдущему профилю.")
			m.cfg.LastConfirmedProfile = ""
			_ = saveJSON(filepath.Join(m.home, "settings.json"), m.cfg)
			m.report.Status = "DEGRADED_FALLBACK_REQUIRED"
			m.persist()
			if idx == len(order)-1 {
				m.println("Независимых стратегий больше нет.")
				break
			}
			continue
		}
		return nil
	}
	if m.report.Status != "DEGRADED_FALLBACK_REQUIRED" {
		m.report.Status = "ALL_CANDIDATES_UNVERIFIED"
	}
	return nil
}

func main() {
	if runtime.GOOS == "windows" && len(os.Args) == 1 {
		os.Exit(guiMain())
	}
	os.Exit(realMain())
}
func realMain() int {
	if runtime.GOOS != "windows" {
		fmt.Fprintln(os.Stderr, "Этот исполняемый файл предназначен для Windows 10/11 x64")
		return 2
	}
	relaunched, err := maybeRelaunchElevated()
	if err != nil {
		fmt.Fprintln(os.Stderr, "Запуск от администратора:", err)
		return 2
	}
	if relaunched {
		return 0
	}
	home := defaultRoot()
	var c Config
	var endpoint, transport, adapter, bundle string
	var port int
	var reset, stopOnly, statusOnly bool
	flag.StringVar(&endpoint, "endpoint", "", "публичный IPv4 внешнего VPN-узла")
	flag.IntVar(&port, "port", 0, "порт внешнего VPN-узла")
	flag.StringVar(&transport, "transport", "", "AWG-UDP | REALITY-TCP | XHTTP-TCP")
	flag.StringVar(&adapter, "adapter", "", "имя адаптера Amnezia (Get-NetAdapter)")
	flag.StringVar(&bundle, "bundle", "", "каталог официального zapret-winws")
	flag.BoolVar(&reset, "reset", false, "настроить снова")
	flag.BoolVar(&stopOnly, "stop", false, "остановить только свой winws2 и выйти")
	flag.BoolVar(&statusOnly, "status", false, "проверить состояние своего winws2")
	flag.Parse()
	m := &Manager{home: home, runtimeRoot: filepath.Join(home, "runtime"), stateFolder: filepath.Join(home, "active"), logDir: filepath.Join(home, "results"), reader: bufio.NewReader(os.Stdin), input: os.Stdin, output: os.Stdout}
	fmt.Println("Bypass Manager", version, "| отдельный клиент Amnezia | НЕ подтверждено в целевой сети")
	if stopOnly || statusOnly {
		if err := m.ensureRuntime(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		if statusOnly {
			if m.ownStateExists() {
				fmt.Println("Сохранено состояние собственного winws2; состояние PID проверяется при --stop")
			} else {
				fmt.Println("Своего процесса winws2 не зарегистрировано")
			}
			return 0
		}
		if err := m.stopFilter(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		return 0
	}
	if !reset {
		if old, err := loadConfig(filepath.Join(home, "settings.json")); err == nil {
			c = old
		}
	}
	original := c
	if endpoint != "" {
		c.EndpointIPv4 = endpoint
	}
	if port != 0 {
		c.Port = port
	}
	if transport != "" {
		c.Transport = strings.ToUpper(transport)
	}
	if adapter != "" {
		c.AdapterName = adapter
	}
	if bundle != "" {
		c.BundleRoot = bundle
	}
	if c.BundleRoot == "" {
		c.BundleRoot = preferredEngineRoot(home)
	}
	if c.Transport == "" {
		c.Transport = "AWG-UDP"
	}
	if c.EndpointIPv4 == "" {
		s, _ := m.prompt("Укажите публичный IPv4 входного узла Amnezia (только адрес, БЕЗ ключей):")
		c.EndpointIPv4 = s
	}
	if port == 0 && (c.Port == 0 || reset) {
		p, _ := m.prompt("Укажите ФАКТИЧЕСКИЙ порт внешнего узла из Endpoint (без предположений):")
		c.Port, _ = strconv.Atoi(p)
	}
	if transport == "" && (reset || c.LastConfirmedAt == "" && c.Transport == "AWG-UDP") {
		s, _ := m.prompt("Транспорт внешнего узла: AWG-UDP (Enter), REALITY-TCP или XHTTP-TCP:")
		if s != "" {
			c.Transport = strings.ToUpper(s)
		}
	}
	if adapter == "" && (c.AdapterName == "" || reset) {
		s, _ := m.prompt("Необязательно: точное имя VPN-адаптера Amnezia (Enter = автообнаружение после подключения):")
		c.AdapterName = s
	}
	if original.EndpointIPv4 != c.EndpointIPv4 || original.Port != c.Port || original.Transport != c.Transport {
		c.LastConfirmedAt = ""
		c.LastConfirmedProfile = ""
	}
	m.cfg = c
	if err := validateConfig(c); err != nil {
		fmt.Fprintln(os.Stderr, "Ошибка настроек:", err)
		return 2
	}
	if err := saveJSON(filepath.Join(home, "settings.json"), c); err != nil {
		fmt.Fprintln(os.Stderr, "Ошибка сохранения:", err)
		return 2
	}
	// SIGINT is a console Ctrl+C; defer cleanup for a normal exit or interruption.
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	defer func() {
		if m.ownStateExists() {
			if err := m.stopFilter(); err != nil {
				m.println("ВНИМАНИЕ: состояние winws2 неопределённо, выполните Stop вручную из документации")
			}
		}
		m.report.EndedUTC = utc()
		m.persist()
	}()
	if err := m.run(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "Проверка прервана:", err)
		m.report.Status = "ERROR_OR_INTERRUPTED"
		m.persist()
		return 1
	}
	fmt.Println("\nЗавершено. Отчёт:", filepath.Join(m.logDir, "latest-session.json"))
	return 0
}
