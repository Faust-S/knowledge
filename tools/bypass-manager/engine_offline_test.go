package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInstallPinnedOfflineBundleAtomicSuccess(t *testing.T) {
	base := t.TempDir()
	source := filepath.Join(base, "engine")
	dest := filepath.Join(base, "private", "engine")
	files := map[string][]byte{
		"winws2.exe":         []byte("unchanged-upstream-engine"),
		"lua/zapret-lib.lua": []byte("upstream-Lua-library"),
	}
	manifest := map[string]string{}
	for name, data := range files {
		path := filepath.Join(source, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, data, 0644); err != nil {
			t.Fatal(err)
		}
		manifest[name] = githubBlobHash(data)
	}
	if err := installPinnedBundle(context.Background(), source, dest, manifest); err != nil {
		t.Fatal(err)
	}
	for name, want := range manifest {
		data, err := os.ReadFile(filepath.Join(dest, filepath.FromSlash(name)))
		if err != nil || githubBlobHash(data) != want {
			t.Fatalf("invalid copied engine %s: %v", name, err)
		}
	}
	if _, err := os.Stat(filepath.Join(dest, "UPSTREAM-ORIGIN.txt")); err != nil {
		t.Fatal("missing pinned origin note", err)
	}
	// Never overwrite a directory, including the existing active installation.
	if err := installPinnedBundle(context.Background(), source, dest, manifest); err == nil {
		t.Fatal("bundle unexpectedly overwrote installed engine")
	}
}
func TestInstallPinnedOfflineBundleNoPartialInstallOnCorruption(t *testing.T) {
	cases := []struct {
		name, source string
		data         []byte
	}{
		{"tampered", "winws2.exe", []byte("WRONG")},
		{"incomplete", "missing.dll", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			base := t.TempDir()
			src := filepath.Join(base, "source")
			dest := filepath.Join(base, "target")
			if err := os.MkdirAll(src, 0755); err != nil {
				t.Fatal(err)
			}
			if tc.data != nil {
				if err := os.WriteFile(filepath.Join(src, tc.source), tc.data, 0644); err != nil {
					t.Fatal(err)
				}
			}
			err := installPinnedBundle(context.Background(), src, dest, map[string]string{tc.source: githubBlobHash([]byte("EXPECTED"))})
			if err == nil {
				t.Fatal("untrusted component accepted")
			}
			if _, statErr := os.Stat(dest); !os.IsNotExist(statErr) {
				t.Fatalf("partial engine directory left: %v", statErr)
			}
		})
	}
}
func TestInstallPinnedOfflineBundleRejectsCanceledAndUnsafePaths(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := installPinnedBundle(ctx, t.TempDir(), filepath.Join(t.TempDir(), "engine"), map[string]string{"x": "sha"}); err == nil {
		t.Fatal("cancellation ignored")
	}
	for _, name := range []string{"../escape", "/absolute.exe", "\\windows.dll", "x\\y", ""} {
		err := installPinnedBundle(context.Background(), t.TempDir(), filepath.Join(t.TempDir(), "engine"), map[string]string{name: "bad"})
		if err == nil || !strings.Contains(err.Error(), "invalid bundled engine path") {
			t.Fatalf("unsafe path %q accepted: %v", name, err)
		}
	}
}

// Windows CI injects the same seven original files it will package in ZIP.
// This test proves a disconnected first-run installation really works with
// those exact hashes, without contacting the upstream host.
func TestPinnedBundleRealFiles(t *testing.T) {
	source := os.Getenv("BYPASS_CI_ENGINE_ROOT")
	if source == "" {
		t.Skip("CI engine bundle not injected")
	}
	dest := filepath.Join(t.TempDir(), "runtime", "engine")
	if err := installPinnedBundle(context.Background(), source, dest, upstreamBlobs); err != nil {
		t.Fatal(err)
	}
	if !enginePresent(dest) {
		t.Fatal("offline installer created an invalid engine")
	}
}
