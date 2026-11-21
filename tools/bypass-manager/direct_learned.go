package main

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Auto-hostlist comes from the user's OWN winws2 and is kept private. We only
// publish aggregate counts. A successful TLS handshake does not prove HTTP
// access, browser routing, a DPI bypass, or anonymity.
const (
	directLearnedMaxFile  = 128 * 1024
	directLearnedMaxHosts = 256
	directLearnedPerTick  = 2
	directLearnedCaveat   = "Only TLS handshakes from this program to newly learned, publicly resolved IPv4 hosts were checked. No domain, IP, URL, process name, path, or visited resource is exported; TLS success is not proof of HTTP access or DPI bypass."
)

type DirectLearnedReport struct {
	SchemaVersion  string `json:"schema_version"`
	CheckedUTC     string `json:"checked_utc"`
	State          string `json:"state"`
	Learned        int    `json:"learned"`
	Probed         int    `json:"probed"`
	TLSConfirmed   int    `json:"tls_confirmed"`
	TLSFailed      int    `json:"tls_failed"`
	NotPublic      int    `json:"not_public"`
	EffectVerified bool   `json:"effect_verified"`
	Caveat         string `json:"caveat"`
}

func validDirectHost(raw string) bool {
	host := strings.TrimSpace(raw)
	if len(host) < 4 || len(host) > 253 || host != strings.ToLower(host) || strings.HasSuffix(host, ".") || net.ParseIP(host) != nil {
		return false
	}
	parts := strings.Split(host, ".")
	if len(parts) < 2 {
		return false
	}
	tld := parts[len(parts)-1]
	if len(tld) < 2 || len(tld) > 63 {
		return false
	}
	for _, blocked := range []string{"local", "localhost", "internal", "invalid", "test", "example", "onion"} {
		if tld == blocked {
			return false
		}
	}
	for _, label := range parts {
		if len(label) < 1 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for i := 0; i < len(label); i++ {
			c := label[i]
			if (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '-' {
				return false
			}
		}
	}
	for i := 0; i < len(tld); i++ {
		if tld[i] < 'a' || tld[i] > 'z' {
			return false
		}
	}
	return true
}

// Newest lines are prioritized. No private list content is ever included in
// DirectLearnedReport or the shareable support bundle.
func readDirectLearnedHosts(file string) ([]string, string) {
	info, err := os.Lstat(file)
	if errors.Is(err, os.ErrNotExist) {
		return nil, "NO_LEARNED_HOSTS"
	}
	if err != nil || !info.Mode().IsRegular() {
		return nil, "LOCAL_LIST_UNAVAILABLE"
	}
	if info.Size() > directLearnedMaxFile {
		return nil, "LOCAL_LIST_TOO_LARGE"
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return nil, "LOCAL_LIST_UNAVAILABLE"
	}
	rows := strings.Split(string(data), "\n")
	seen := make(map[string]bool)
	hosts := make([]string, 0, directLearnedMaxHosts)
	for i := len(rows) - 1; i >= 0 && len(hosts) < directLearnedMaxHosts; i-- {
		host := strings.ToLower(strings.TrimSpace(strings.TrimSuffix(rows[i], "\r")))
		// The original list syntax supports comments and flags. Do not
		// interpret flags as hostnames, wildcards or URLs.
		if !validDirectHost(host) || seen[host] {
			continue
		}
		seen[host] = true
		hosts = append(hosts, host)
	}
	if len(hosts) == 0 {
		return nil, "NO_LEARNED_HOSTS"
	}
	return hosts, "LEARNED_HOSTS_PRESENT"
}

// Restrict outbound probes to validated public IPv4 after DNS resolution.
// This avoids automatically connecting to internal or metadata addresses.
func probeDirectLearnedTLS(ctx context.Context, host string) string {
	if !validDirectHost(host) {
		return "NOT_PUBLIC"
	}
	dnsCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	ips, err := net.DefaultResolver.LookupIP(dnsCtx, "ip4", host)
	cancel()
	if err != nil || len(ips) == 0 {
		return "TLS_FAILED"
	}
	address := ""
	for _, ip := range ips {
		if ip4 := ip.To4(); ip4 != nil && validIPv4(ip4.String()) {
			address = net.JoinHostPort(ip4.String(), "443")
			break
		}
	}
	if address == "" {
		return "NOT_PUBLIC"
	}
	dialer := &net.Dialer{Timeout: 4 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp4", address)
	if err != nil {
		return "TLS_FAILED"
	}
	defer conn.Close()
	tlsConn := tls.Client(conn, &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12})
	handshakeCtx, stop := context.WithTimeout(ctx, 5*time.Second)
	defer stop()
	if tlsConn.HandshakeContext(handshakeCtx) != nil {
		return "TLS_FAILED"
	}
	return "TLS_CONFIRMED"
}

func validDirectLearned(r DirectLearnedReport) bool {
	if r.SchemaVersion != "1.0" || r.Caveat != directLearnedCaveat || r.EffectVerified ||
		r.Learned < 0 || r.Learned > directLearnedMaxHosts || r.Probed < 0 || r.Probed > directLearnedPerTick ||
		r.TLSConfirmed < 0 || r.TLSFailed < 0 || r.NotPublic < 0 ||
		r.TLSConfirmed+r.TLSFailed+r.NotPublic != r.Probed {
		return false
	}
	if _, err := time.Parse(time.RFC3339Nano, r.CheckedUTC); err != nil {
		return false
	}
	switch r.State {
	case "NO_LEARNED_HOSTS", "LOCAL_LIST_UNAVAILABLE", "LOCAL_LIST_TOO_LARGE", "NO_NEW_HOSTS", "TLS_SAMPLED":
	default:
		return false
	}
	return true
}

func (m *Manager) saveDirectLearned(r DirectLearnedReport) error {
	if !validDirectLearned(r) {
		return errors.New("invalid learned-host status")
	}
	return saveJSON(filepath.Join(m.home, "results", "latest-direct-learned.json"), r)
}

// A new domain is probed at most once while this GUI monitor is alive.
// seen is kept ONLY in memory. Do not retain or export hostnames.
func probeNewDirectLearned(ctx context.Context, file string, seen map[string]bool, attempt func(context.Context, string) string) DirectLearnedReport {
	r := DirectLearnedReport{SchemaVersion: "1.0", CheckedUTC: utc(), State: "NO_NEW_HOSTS", Caveat: directLearnedCaveat}
	hosts, state := readDirectLearnedHosts(file)
	r.Learned = len(hosts)
	if state != "LEARNED_HOSTS_PRESENT" {
		r.State = state
		return r
	}
	if len(seen) > directLearnedMaxHosts*2 {
		clear(seen)
	}
	targets := make([]string, 0, directLearnedPerTick)
	for _, host := range hosts {
		if ctx.Err() != nil || len(targets) == directLearnedPerTick {
			break
		}
		if seen[host] {
			continue
		}
		seen[host] = true
		targets = append(targets, host)
	}
	// Run only two short TLS handshakes in parallel. The input strings are
	// deliberately absent from the serialized report and from error messages.
	results := make(chan string, len(targets))
	var wg sync.WaitGroup
	for _, host := range targets {
		wg.Add(1)
		go func(host string) {
			defer wg.Done()
			probeCtx, cancel := context.WithTimeout(ctx, 7*time.Second)
			defer cancel()
			results <- attempt(probeCtx, host)
		}(host)
	}
	wg.Wait()
	close(results)
	for result := range results {
		switch result {
		case "TLS_CONFIRMED":
			r.TLSConfirmed++
		case "NOT_PUBLIC":
			r.NotPublic++
		default:
			r.TLSFailed++
		}
		r.Probed++
	}
	if r.Probed > 0 {
		r.State = "TLS_SAMPLED"
	}
	return r
}
