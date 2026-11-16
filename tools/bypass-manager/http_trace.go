package main

import (
	"crypto/tls"
	"net/http"
	"net/http/httptrace"
	"sync"
	"time"
)

// TransferTimings contains only elapsed durations, never addresses, URLs,
// DNS answers, certificate names or socket information.
type TransferTimings struct {
	DNSMs        int64 `json:"dns_ms"`
	TCPConnectMs int64 `json:"tcp_connect_ms"`
	TLSMs        int64 `json:"tls_ms"`
	TTFBMs       int64 `json:"time_to_first_byte_ms"`
}

type httpStageRecorder struct {
	mu      sync.Mutex
	start   time.Time
	dns     time.Time
	connect time.Time
	tls     time.Time
	stages  TransferTimings
}

func tracedRequest(req *http.Request) (*http.Request, func() TransferTimings) {
	h := &httpStageRecorder{start: time.Now()}
	trace := &httptrace.ClientTrace{
		DNSStart: func(httptrace.DNSStartInfo) {
			h.mu.Lock()
			h.dns = time.Now()
			h.mu.Unlock()
		},
		DNSDone: func(httptrace.DNSDoneInfo) {
			h.mu.Lock()
			if !h.dns.IsZero() {
				h.stages.DNSMs = time.Since(h.dns).Milliseconds()
			}
			h.mu.Unlock()
		},
		ConnectStart: func(_, _ string) {
			h.mu.Lock()
			h.connect = time.Now()
			h.mu.Unlock()
		},
		ConnectDone: func(_, _ string, _ error) {
			h.mu.Lock()
			if !h.connect.IsZero() {
				h.stages.TCPConnectMs = time.Since(h.connect).Milliseconds()
			}
			h.mu.Unlock()
		},
		TLSHandshakeStart: func() {
			h.mu.Lock()
			h.tls = time.Now()
			h.mu.Unlock()
		},
		TLSHandshakeDone: func(_ tls.ConnectionState, _ error) {
			h.mu.Lock()
			if !h.tls.IsZero() {
				h.stages.TLSMs = time.Since(h.tls).Milliseconds()
			}
			h.mu.Unlock()
		},
		GotFirstResponseByte: func() {
			h.mu.Lock()
			h.stages.TTFBMs = time.Since(h.start).Milliseconds()
			h.mu.Unlock()
		},
	}
	traced := req.WithContext(httptrace.WithClientTrace(req.Context(), trace))
	result := func() TransferTimings {
		h.mu.Lock()
		defer h.mu.Unlock()
		return h.stages
	}
	return traced, result
}
