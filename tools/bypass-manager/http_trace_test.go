package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestTraceResponseTimingsWithoutIdentifiers(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("OK"))
	}))
	defer server.Close()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, server.URL, nil)
	traced, result := tracedRequest(req)
	response, err := http.DefaultClient.Do(traced)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	timings := result()
	if timings.TTFBMs < 0 || timings.TCPConnectMs < 0 {
		t.Fatalf("negative timing: %+v", timings)
	}
	guide := toGuideTransfer(DownloadResult{Timings: timings, HTTPStatus: 200, OK: true}, "TEST_CDN_A")
	if guide.HTTPStatus != 200 || guide.Source != "TEST_CDN_A" {
		t.Fatal(guide)
	}
	jsonBytes, err := json.Marshal(guide)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(jsonBytes), server.URL) {
		t.Fatal("exposed network endpoint")
	}
}

func TestDownloadPersistsTraceAfterHttpError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(30 * time.Millisecond)
		w.WriteHeader(http.StatusForbidden)
	}))
	defer server.Close()
	r := downloadFrom(context.Background(), 2048, server.URL)
	if r.OK || r.HTTPStatus != http.StatusForbidden {
		t.Fatalf("HTTP 403 is not successful throughput: %+v", r)
	}
	if r.Timings.TTFBMs < 15 {
		t.Fatalf("HTTP 403 trace was lost: %+v", r.Timings)
	}
}

func TestDownloadRejectsMalformedURLWithoutPanic(t *testing.T) {
	r := downloadFrom(context.Background(), 1024, string([]byte{0}),)
	if r.OK || r.Error != "REQUEST_ERROR" {
		t.Fatalf("invalid request must be rejected: %+v", r)
	}
}

func TestDownloadPersistsTraceAfterCompleteResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(30 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("test"))
	}))
	defer server.Close()
	r := downloadFrom(context.Background(), 4, server.URL)
	if !r.OK || r.HTTPStatus != http.StatusOK || r.Bytes != 4 {
		t.Fatalf("expected exact full payload: %+v", r)
	}
	if r.Timings.TTFBMs < 15 {
		t.Fatalf("full transfer trace was lost: %+v", r.Timings)
	}
}
