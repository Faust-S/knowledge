package main

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
	"testing"
)

func TestGitBlobHasher(t *testing.T) {
	if githubBlobHash([]byte("test\n")) != "9daeafb9864cf43055ae93beb0afd6c7d144bfa4" {
		t.Fatal("git blob hash did not match known object")
	}
}
func TestArchiveRejectsIncomplete(t *testing.T) {
	buf := new(bytes.Buffer)
	w := zip.NewWriter(buf)
	f, err := w.Create("zapret-win-bundle-master/zapret-winws/lua/zapret-lib.lua")
	if err != nil {
		t.Fatal(err)
	}
	io.WriteString(f, "fake")
	if err = w.Close(); err != nil {
		t.Fatal(err)
	}
	_, err = selectedUpstreamArchive(buf.Bytes())
	if err == nil || !strings.Contains(err.Error(), "SHA-1") {
		t.Fatalf("accepted unverified or incomplete archive: %v", err)
	}
}
func TestUpstreamManifest(t *testing.T) {
	if len(upstreamBlobs) != 7 {
		t.Fatal("must verify seven official engine files")
	}
	if len(upstreamCommit) != 40 {
		t.Fatal("commit not pinned")
	}
}
