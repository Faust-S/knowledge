package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
