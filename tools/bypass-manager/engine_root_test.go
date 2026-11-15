package main

import (
	"path/filepath"
	"testing"
)

func TestChooseEngineRootOfflinePortable(t *testing.T) {
	dataHome := filepath.Join("home with spaces", "BypassManager")
	executable := filepath.Join("portable folder", "Bypass-Manager.exe")
	portable := filepath.Join("portable folder", "engine")
	if actual := chooseEngineRoot(dataHome, executable, func(path string) bool {
		return path == portable
	}); actual != portable {
		t.Fatalf("verified portable engine ignored: %q", actual)
	}
	expectedLocal := filepath.Join(dataHome, "engine")
	if actual := chooseEngineRoot(dataHome, executable, func(string) bool { return false }); actual != expectedLocal {
		t.Fatalf("local engine fallback failed: %q", actual)
	}
	if actual := chooseEngineRoot(dataHome, "", func(string) bool { t.Fatal("unexpected probe"); return true }); actual != expectedLocal {
		t.Fatalf("missing executable fallback failed: %q", actual)
	}
}
