package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const guideMirrorURL = "https://fsn1-speed.hetzner.com/100MB.bin"

// The mirror uses HTTP byte ranges; a full 2 MiB 206 response is required.
// Never silently download 100 MB when the server ignores Range. Providers
// have independent failure modes, so failure of one must not be mistaken for
// evidence of a broken VPN.
func guideRangeDownload(ctx context.Context, size int64, url string) DownloadResult {
	out := DownloadResult{ExpectedBytes: size}
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		out.Error = "REQUEST_ERROR"
		return out
	}
	req.Header.Set("Range", fmt.Sprintf("bytes=0-%d", size-1))
	req.Header.Set("Accept-Encoding", "identity")
	start := time.Now()
	resp, err := httpClient(20 * time.Second).Do(req)
	if err != nil {
		out.Error = "MIRROR_NETWORK_ERROR"
		return out
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent || !strings.HasPrefix(resp.Header.Get("Content-Range"), fmt.Sprintf("bytes 0-%d/", size-1)) {
		out.Error = "RANGE_NOT_SUPPORTED"
		return out
	}
	n, err := io.Copy(io.Discard, io.LimitReader(resp.Body, size+1))
	out.DurationSeconds = time.Since(start).Seconds()
	out.Bytes = n
	if err != nil || n != size {
		out.Error = "MIRROR_TRANSFER_INCOMPLETE"
		return out
	}
	out.OK = true
	if out.DurationSeconds > 0 {
		out.Mbps = float64(n) * 8 / out.DurationSeconds / 1e6
	}
	return out
}

// A failure on the first test CDN can be local to that CDN. Record both
// attempts; only the full successful transfer contributes to video quality.
func checkGuideVideo(ctx context.Context,
	fetch func(context.Context, int64, int) DownloadResult,
	pause func(context.Context, time.Duration) error,
) ([]DownloadResult, []GuideTransfer, VideoAssessment) {
	const size int64 = 2 * 1024 * 1024
	selected := make([]DownloadResult, 0, 4)
	transfers := make([]GuideTransfer, 0, 8)
	for i := 0; i < 4 && ctx.Err() == nil; i++ {
		if i > 0 && pause(ctx, 2*time.Second) != nil {
			break
		}
		sample := fetch(ctx, size, 0)
		transfers = append(transfers, toGuideTransfer(sample, "TEST_CDN_A"))
		if !sample.OK && ctx.Err() == nil {
			sample = fetch(ctx, size, 1)
			transfers = append(transfers, toGuideTransfer(sample, "TEST_CDN_B"))
		}
		selected = append(selected, sample)
		if !sample.OK {
			break
		}
	}
	return selected, transfers, assessVideoDownloads(selected)
}

func toGuideTransfer(r DownloadResult, source string) GuideTransfer {
	code := safeGuideDownloadFailure(r)
	return GuideTransfer{Source: source, OK: r.OK, Bytes: r.Bytes, ExpectedBytes: r.ExpectedBytes, Seconds: r.DurationSeconds, Mbps: r.Mbps, FailureCode: code}
}

func guideVideoFetch(ctx context.Context, size int64, provider int) DownloadResult {
	if provider == 1 {
		return guideRangeDownload(ctx, size, guideMirrorURL)
	}
	return download(ctx, size)
}

// Network errors may contain user-specific URLs, IP addresses and local
// diagnostics. Only fixed error categories or numeric HTTP status codes are
// emitted into shareable reports.
func safeGuideDownloadFailure(r DownloadResult) string {
	if r.OK {
		return ""
	}
	if r.Bytes > 0 && r.Bytes != r.ExpectedBytes {
		return "PARTIAL_TRANSFER"
	}
	e := strings.ToLower(r.Error)
	if strings.HasPrefix(r.Error, "HTTP ") {
		status, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(r.Error, "HTTP ")))
		if err == nil && status >= 100 && status <= 599 {
			return fmt.Sprintf("HTTP_%d", status)
		}
	}
	switch {
	case strings.Contains(e, "deadline"), strings.Contains(e, "timeout"), strings.Contains(e, "time out"):
		return "TIMEOUT"
	case strings.Contains(e, "no such host"), strings.Contains(e, "server misbehaving"), strings.Contains(e, "lookup"):
		return "DNS_ERROR"
	case strings.Contains(e, "certificate"), strings.Contains(e, "x509"):
		return "TLS_CERTIFICATE_ERROR"
	case strings.Contains(e, "tls"), strings.Contains(e, "handshake"):
		return "TLS_NEGOTIATION_ERROR"
	case strings.Contains(e, "range_not_supported"):
		return "RANGE_NOT_SUPPORTED"
	case strings.Contains(e, "connection refused"):
		return "CONNECTION_REFUSED"
	case strings.Contains(e, "transfer_incomplete"):
		return "TRANSFER_INCOMPLETE"
	default:
		return "NETWORK_ERROR_REDACTED"
	}
}
