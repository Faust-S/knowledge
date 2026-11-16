package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestGuideMirrorExactRange(t *testing.T) {
	const size int64 = 1024 * 1024
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Range") != "bytes=0-1048575" {
			t.Errorf("unexpected range: %q", r.Header.Get("Range"))
		}
		w.Header().Set("Content-Range", "bytes 0-1048575/104857600")
		w.WriteHeader(206)
		_, _ = w.Write([]byte(strings.Repeat("a", int(size))))
	}))
	defer server.Close()
	sample := guideRangeDownload(context.Background(), size, server.URL)
	if !sample.OK || sample.Bytes != size {
		t.Fatalf("range failed: %+v", sample)
	}
}
func TestGuideMirrorRejectsEntireLargeFile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		_, _ = w.Write([]byte(strings.Repeat("a", 2*1024*1024)))
	}))
	defer server.Close()
	sample := guideRangeDownload(context.Background(), 1024*1024, server.URL)
	if sample.OK || sample.Bytes != 0 || sample.Error != "RANGE_NOT_SUPPORTED" {
		t.Fatalf("must not accept oversized file: %+v", sample)
	}
}
func TestGuideFallbackDistinguishesCDNFailure(t *testing.T) {
	calls := 0
	selected, steps, quality := checkGuideVideo(context.Background(), func(ctx context.Context, n int64, provider int) DownloadResult {
		calls++
		if provider == 0 {
			return DownloadResult{ExpectedBytes: n, Error: "HTTP 502"}
		}
		return DownloadResult{OK: true, Bytes: n, ExpectedBytes: n, Mbps: 12, DurationSeconds: 1}
	}, func(context.Context, time.Duration) error { return nil })
	if calls != 8 || len(steps) != 8 || len(selected) != 4 || quality.Grade != "HD_1080P_CANDIDATE" {
		t.Fatalf("calls %d, steps %d, grade %s", calls, len(steps), quality.Grade)
	}
	if steps[0].Source != "TEST_CDN_A" || steps[1].Source != "TEST_CDN_B" || steps[0].FailureCode == "" {
		t.Fatal("missing source diagnostic")
	}
}

func TestGuideMirrorRetainsTimingOnIncompleteRange(t *testing.T) {
	const size int64 = 1024 * 1024
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(30 * time.Millisecond)
		w.Header().Set("Content-Range", "bytes 0-1048575/104857600")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("truncated"))
	}))
	defer server.Close()
	r := guideRangeDownload(context.Background(), size, server.URL)
	if r.OK || r.HTTPStatus != http.StatusPartialContent || r.Bytes == size {
		t.Fatalf("truncated download should be refused: %+v", r)
	}
	if r.Timings.TTFBMs < 15 {
		t.Fatalf("response timing disappeared on failed range: %+v", r.Timings)
	}
}
