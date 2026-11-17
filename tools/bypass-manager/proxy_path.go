package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// ProxyPorts is private, read-only process/socket evidence. No port, PID,
// executable path or external IP is added to the public support report.
// Listener ownership is inferred from Windows process metadata, not proof
// that an Amnezia VPN tunnel or its native handshake works.
type ProxyPorts struct {
	SchemaVersion string `json:"schema_version"`
	Status        string `json:"status"`
	Ports         []int  `json:"ports"`
}

func parseProxyPorts(raw []byte) (ProxyPorts, error) {
	if len(raw) == 0 || len(raw) > 2048 {
		return ProxyPorts{}, errors.New("invalid local proxy inventory size")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var s ProxyPorts
	if dec.Decode(&s) != nil || dec.Decode(new(any)) != io.EOF || s.SchemaVersion != "0.3.7" {
		return ProxyPorts{}, errors.New("invalid local proxy inventory")
	}
	switch s.Status {
	case "CANDIDATES":
		if len(s.Ports) == 0 || len(s.Ports) > 8 {
			return ProxyPorts{}, errors.New("invalid local proxy candidate count")
		}
	case "NO_TRUSTED_LISTENER", "AMBIGUOUS", "UNAVAILABLE":
		if len(s.Ports) != 0 {
			return ProxyPorts{}, errors.New("unexpected local proxy candidates")
		}
	default:
		return ProxyPorts{}, errors.New("unknown local proxy inventory status")
	}
	seen := map[int]bool{}
	for _, p := range s.Ports {
		if p < 1024 || p > 65535 || seen[p] {
			return ProxyPorts{}, errors.New("invalid local proxy listener port")
		}
		seen[p] = true
	}
	return s, nil
}

type LocalProxyEvidence struct {
	State     string // OBSERVED, NO_TRUSTED_LISTENER, NO_PROXY_EGRESS, AMBIGUOUS or UNAVAILABLE
	Mode      string // SOCKS5 or HTTP
	Agreement bool
	IP        string // PRIVATE: never serialize or log this value
	Port      int    // PRIVATE: never serialize or log this value
	Sources   int
}

func proxyClientFor(port int, scheme string, timeout time.Duration) (*http.Client, error) {
	if port < 1024 || port > 65535 || (scheme != "socks5" && scheme != "http") {
		return nil, errors.New("invalid local proxy")
	}
	proxyURL := &url.URL{Scheme: scheme, Host: net.JoinHostPort("127.0.0.1", strconv.Itoa(port))}
	dialer := &net.Dialer{Timeout: 4 * time.Second, KeepAlive: -1}
	transport := &http.Transport{
		Proxy: http.ProxyURL(proxyURL), DisableKeepAlives: true, ForceAttemptHTTP2: false,
		TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 7 * time.Second,
		DialContext: func(ctx context.Context, _, address string) (net.Conn, error) {
			return dialer.DialContext(ctx, "tcp", address)
		},
	}
	return &http.Client{Transport: transport, Timeout: timeout, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if req.URL.Scheme != "https" || len(via) > 2 {
			return errors.New("insecure redirect or too many redirects")
		}
		return nil
	}}, nil
}

// Amnezia's proxy mode may expose SOCKS5 or HTTP CONNECT. Distinguish them
// using only a bounded localhost greeting; avoid wasting 10s per wrong mode.
func localProxyScheme(ctx context.Context, port int) string {
	dialer := &net.Dialer{Timeout: 500 * time.Millisecond}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		return "http"
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(650 * time.Millisecond))
	if _, err = conn.Write([]byte{5, 1, 0}); err != nil {
		return "http"
	}
	var answer [2]byte
	if _, err = io.ReadFull(conn, answer[:]); err == nil && answer[0] == 5 && answer[1] == 0 {
		return "socks5"
	}
	return "http"
}

// probeProxyPorts only contacts independent HTTPS IP services through a
// verified loopback listener belonging to an Amnezia process. It never sends
// a local port, PID or VPN key to an external service. Success proves egress
// of THIS controlled program-origin proxy request, not arbitrary applications.
func probeProxyPorts(ctx context.Context, ports []int, urls []string) LocalProxyEvidence {
	return probeProxyPortsWithClient(ctx, ports, urls, proxyClientFor)
}

// An injectable client factory permits genuine loopback SOCKS/CONNECT tests
// with a test-only CA, without disabling TLS verification in production.
func probeProxyPortsWithClient(ctx context.Context, ports []int, urls []string, makeClient func(int, string, time.Duration) (*http.Client, error)) LocalProxyEvidence {
	result := LocalProxyEvidence{State: "NO_PROXY_EGRESS"}
	found := false
	for _, port := range ports {
		scheme := localProxyScheme(ctx, port)
		for _, scheme := range []string{scheme} {
			if ctx.Err() != nil {
				return LocalProxyEvidence{State: "UNAVAILABLE"}
			}
			client, err := makeClient(port, scheme, 9*time.Second)
			if err != nil {
				continue
			}
			resultByProxy := collectEgress(ctx, urls, client, validIPv4)
			client.CloseIdleConnections()
			if !resultByProxy.Agreement {
				continue
			}
			count := 0
			for _, s := range resultByProxy.Samples {
				if s.Status == "OK" && s.IP == resultByProxy.IP {
					count++
				}
			}
			if count < 2 {
				continue
			}
			if found {
				return LocalProxyEvidence{State: "AMBIGUOUS"}
			}
			found = true
			result = LocalProxyEvidence{State: "OBSERVED", Mode: scheme, Port: port, IP: resultByProxy.IP, Agreement: true, Sources: count}
		}
	}
	return result
}

func proxyStatusCode(v LocalProxyEvidence) string {
	if v.State == "OBSERVED" && v.Agreement && v.Sources >= 2 {
		return "LOCAL_PROXY_HTTPS_EGRESS_OBSERVED"
	}
	switch v.State {
	case "AMBIGUOUS":
		return "LOCAL_PROXY_AMBIGUOUS"
	case "NO_TRUSTED_LISTENER":
		return "LOCAL_PROXY_LISTENER_NOT_FOUND"
	case "NO_PROXY_EGRESS":
		return "LOCAL_PROXY_HTTPS_UNAVAILABLE"
	default:
		return "LOCAL_PROXY_EVIDENCE_UNAVAILABLE"
	}
}
