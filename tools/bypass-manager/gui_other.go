//go:build !windows

package main

// Windows desktop UI is not available in the Linux test host.
func guiMain() int { return 2 }

// New native one-button UI is intentionally Windows-only.
func oneButtonGuiMain() int { return 2 }
