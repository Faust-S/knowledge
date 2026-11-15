package main

import (
	"os"
	"path/filepath"
)

// The preferred offline layout is Bypass-Manager.exe beside a verified engine/
// directory from the original upstream. No network is needed at first launch.
// Otherwise the manager installs components into its per-user data directory.
// This function never searches PATH or trusts a random binary named winws2.exe.
func chooseEngineRoot(dataHome, executable string, verified func(string) bool) string {
	if executable != "" {
		portable := filepath.Join(filepath.Dir(executable), "engine")
		if verified(portable) {
			return portable
		}
	}
	return filepath.Join(dataHome, "engine")
}

func preferredEngineRoot(dataHome string) string {
	executable, _ := os.Executable()
	return chooseEngineRoot(dataHome, executable, enginePresent)
}
