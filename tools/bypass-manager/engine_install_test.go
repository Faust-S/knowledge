package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGitBlobHasher(t *testing.T) {
	if githubBlobHash([]byte("test\n")) != "9daeafb9864cf43055ae93beb0afd6c7d144bfa4" {
		t.Fatal("git blob hash mismatch")
	}
}
func TestPinnedDownloadVerifiesFiles(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/bin/file" {
			w.Write([]byte("original"))
			return
		}
		http.NotFound(w, r)
	}))
	defer s.Close()
	client := s.Client()
	expected := map[string]string{"bin/file": githubBlobHash([]byte("original"))}
	got, err := fetchPinnedFiles(context.Background(), client, s.URL+"/", expected)
	if err != nil || string(got["bin/file"]) != "original" {
		t.Fatalf("verified fetch rejected: %v", err)
	}
	expected["bin/file"] = "0000000000000000000000000000000000000000"
	if _, err = fetchPinnedFiles(context.Background(), client, s.URL+"/", expected); err == nil || !strings.Contains(err.Error(), "SHA-1") {
		t.Fatalf("tamper accepted: %v", err)
	}
	expected = map[string]string{"missing": githubBlobHash([]byte("x"))}
	if _, err = fetchPinnedFiles(context.Background(), client, s.URL+"/", expected); err == nil {
		t.Fatal("missing upstream file accepted")
	}
}
func TestUpstreamManifest(t *testing.T) {
	if len(upstreamBlobs) != 7 {
		t.Fatal("requires seven upstream files")
	}
	if len(upstreamCommit) != 40 {
		t.Fatal("upstream not pinned")
	}
}
